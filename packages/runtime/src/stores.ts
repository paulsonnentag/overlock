/**
 * Per-element backing stores for the attribution proxy.
 *
 * The proxy never mutates the DOM directly. Every write goes into one of the
 * four forward stores below, recorded against the calling component's id, and
 * a reconcile pass writes the *effective* value back to the live element. On
 * unmount, `unwind()` walks the matching reverse-index entries and reverses
 * every contribution; reconcile re-derives the effective value from whoever's
 * left.
 *
 * Forward stores are keyed by element via `WeakMap`, so they don't keep
 * elements alive. Reverse-index entries are keyed by component id and dropped
 * wholesale on unmount.
 */

export type ComponentId = symbol;

type StyleEntry = Map<string /* prop */, Map<ComponentId, string>>;

type AttrEntry = {
  snapshot: string | null;
  contribs: Map<ComponentId, string>;
};

type ClassEntry = Map<string /* className */, Map<ComponentId, number>>;

type ChildEntry = Map<Node, ComponentId>;

type ReverseEntry = {
  styles: Map<Element, Set<string>>;
  classes: Map<Element, Set<string>>;
  attrs: Map<Element, Set<string>>;
  children: Map<Element, Set<Node>>;
};

export class Stores {
  readonly #style = new WeakMap<Element, StyleEntry>();
  readonly #attr = new WeakMap<Element, Map<string, AttrEntry>>();
  readonly #class = new WeakMap<Element, ClassEntry>();
  readonly #child = new WeakMap<Element, ChildEntry>();
  readonly #reverse = new Map<ComponentId, ReverseEntry>();

  // ---- style ----

  writeStyle(id: ComponentId, el: Element, prop: string, value: string): void {
    const entry = this.#getOrCreateStyle(el);
    let perProp = entry.get(prop);
    if (!perProp) entry.set(prop, (perProp = new Map()));
    // delete-then-set so a re-write moves us to the end of insertion order
    perProp.delete(id);
    perProp.set(id, value);
    const reverse = this.#trackReverse(id);
    if (!reverse.styles.has(el)) reverse.styles.set(el, new Set());
    reverse.styles.get(el)!.add(prop);
    this.#reconcileStyle(el, prop);
  }

  clearStyle(id: ComponentId, el: Element, prop: string): void {
    const entry = this.#style.get(el);
    const perProp = entry?.get(prop);
    if (!perProp) return;
    perProp.delete(id);
    if (perProp.size === 0) entry!.delete(prop);
    this.#reverse.get(id)?.styles.get(el)?.delete(prop);
    this.#reconcileStyle(el, prop);
  }

  #reconcileStyle(el: Element, prop: string): void {
    const perProp = this.#style.get(el)?.get(prop);
    const style = (el as HTMLElement).style;
    if (!perProp || perProp.size === 0) {
      style.removeProperty(toCssProp(prop));
      return;
    }
    let winner = "";
    for (const v of perProp.values()) winner = v;
    style.setProperty(toCssProp(prop), winner);
  }

  #getOrCreateStyle(el: Element): StyleEntry {
    let entry = this.#style.get(el);
    if (!entry) this.#style.set(el, (entry = new Map()));
    return entry;
  }

  // ---- attributes ----

  writeAttr(id: ComponentId, el: Element, name: string, value: string): void {
    const entry = this.#getOrCreateAttr(el, name);
    entry.contribs.delete(id);
    entry.contribs.set(id, value);
    const reverse = this.#trackReverse(id);
    if (!reverse.attrs.has(el)) reverse.attrs.set(el, new Set());
    reverse.attrs.get(el)!.add(name);
    this.#reconcileAttr(el, name);
  }

  clearAttr(id: ComponentId, el: Element, name: string): void {
    const entry = this.#attr.get(el)?.get(name);
    if (!entry) return;
    entry.contribs.delete(id);
    this.#reverse.get(id)?.attrs.get(el)?.delete(name);
    this.#reconcileAttr(el, name);
  }

  #reconcileAttr(el: Element, name: string): void {
    const entry = this.#attr.get(el)?.get(name);
    if (!entry) {
      // never tracked -- nothing to do
      return;
    }
    if (entry.contribs.size === 0) {
      if (entry.snapshot === null) el.removeAttribute(name);
      else el.setAttribute(name, entry.snapshot);
      // entry kept around so the snapshot is preserved if a future writer arrives
      return;
    }
    let winner = "";
    for (const v of entry.contribs.values()) winner = v;
    el.setAttribute(name, winner);
  }

  #getOrCreateAttr(el: Element, name: string): AttrEntry {
    let bucket = this.#attr.get(el);
    if (!bucket) this.#attr.set(el, (bucket = new Map()));
    let entry = bucket.get(name);
    if (!entry) {
      const snapshot = el.hasAttribute(name) ? el.getAttribute(name) : null;
      entry = { snapshot, contribs: new Map() };
      bucket.set(name, entry);
    }
    return entry;
  }

  // ---- classList ----

  bumpClass(id: ComponentId, el: Element, name: string): void {
    const perClass = this.#getOrCreateClassMap(el, name);
    perClass.set(id, (perClass.get(id) ?? 0) + 1);
    const reverse = this.#trackReverse(id);
    if (!reverse.classes.has(el)) reverse.classes.set(el, new Set());
    reverse.classes.get(el)!.add(name);
    this.#reconcileClass(el, name);
  }

  decrementClass(id: ComponentId, el: Element, name: string): void {
    const perClass = this.#class.get(el)?.get(name);
    if (!perClass) return;
    const cur = perClass.get(id);
    if (cur === undefined) return;
    if (cur <= 1) {
      perClass.delete(id);
      this.#reverse.get(id)?.classes.get(el)?.delete(name);
    } else {
      perClass.set(id, cur - 1);
    }
    this.#reconcileClass(el, name);
  }

  #reconcileClass(el: Element, name: string): void {
    const perClass = this.#class.get(el)?.get(name);
    let total = 0;
    if (perClass) for (const c of perClass.values()) total += c;
    if (total > 0) el.classList.add(name);
    else el.classList.remove(name);
  }

  #getOrCreateClassMap(el: Element, name: string): Map<ComponentId, number> {
    let entry = this.#class.get(el);
    if (!entry) this.#class.set(el, (entry = new Map()));
    let perClass = entry.get(name);
    if (!perClass) entry.set(name, (perClass = new Map()));
    return perClass;
  }

  // ---- child ownership ----

  registerChild(id: ComponentId, parent: Element, child: Node): void {
    let entry = this.#child.get(parent);
    if (!entry) this.#child.set(parent, (entry = new Map()));
    entry.set(child, id);
    const reverse = this.#trackReverse(id);
    if (!reverse.children.has(parent)) reverse.children.set(parent, new Set());
    reverse.children.get(parent)!.add(child);
  }

  ownerOfChild(parent: Element, child: Node): ComponentId | undefined {
    return this.#child.get(parent)?.get(child);
  }

  forgetChild(parent: Element, child: Node): void {
    const entry = this.#child.get(parent);
    if (!entry) return;
    const id = entry.get(child);
    if (id === undefined) return;
    entry.delete(child);
    this.#reverse.get(id)?.children.get(parent)?.delete(child);
  }

  // ---- reverse index / lifecycle ----

  #trackReverse(id: ComponentId): ReverseEntry {
    let entry = this.#reverse.get(id);
    if (!entry) {
      entry = {
        styles: new Map(),
        classes: new Map(),
        attrs: new Map(),
        children: new Map(),
      };
      this.#reverse.set(id, entry);
    }
    return entry;
  }

  /**
   * Reverse every contribution this component has made: clear styles (which
   * reconciles to the next-most-recent contributor or removes the property),
   * decrement every class to zero, drop attribute writes, and detach every
   * still-attached child it injected.
   */
  unwind(id: ComponentId): void {
    const entry = this.#reverse.get(id);
    if (!entry) return;
    this.#reverse.delete(id);

    for (const [el, props] of entry.styles) {
      for (const prop of props) {
        const perProp = this.#style.get(el)?.get(prop);
        if (!perProp) continue;
        perProp.delete(id);
        if (perProp.size === 0) this.#style.get(el)!.delete(prop);
        this.#reconcileStyle(el, prop);
      }
    }

    for (const [el, names] of entry.classes) {
      for (const name of names) {
        const perClass = this.#class.get(el)?.get(name);
        if (!perClass) continue;
        perClass.delete(id);
        this.#reconcileClass(el, name);
      }
    }

    for (const [el, names] of entry.attrs) {
      for (const name of names) {
        const attrEntry = this.#attr.get(el)?.get(name);
        if (!attrEntry) continue;
        attrEntry.contribs.delete(id);
        this.#reconcileAttr(el, name);
      }
    }

    for (const [parent, children] of entry.children) {
      for (const child of children) {
        // Clear ownership first so a re-entrant MutationObserver pass is a no-op.
        this.#child.get(parent)?.delete(child);
        if (child.parentNode === parent) parent.removeChild(child);
      }
    }
  }

  /**
   * Drop all bookkeeping keyed on this element. Call when the element leaves
   * the document, so per-element entries don't accumulate against nodes that
   * are gone for good. Per-component reverse-index entries elsewhere will be
   * cleaned up by the next `unwind` of the contributing component.
   */
  evictElement(el: Element): void {
    this.#style.delete(el);
    this.#attr.delete(el);
    this.#class.delete(el);
    this.#child.delete(el);
  }
}

/**
 * `style.foo = "..."` sets the camelCase property; `setProperty` and
 * `removeProperty` take the dashed CSS name. We always reconcile through the
 * dashed form so custom properties (`--foo`) and vendor prefixes work
 * uniformly.
 */
function toCssProp(prop: string): string {
  if (prop.startsWith("--")) return prop;
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
