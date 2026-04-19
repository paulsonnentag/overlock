import * as componentStore from "./component-store.js";
import { wrap } from "./proxy.js";
import type { ComponentElement, MountFn } from "./types.js";

type AttrEntry = {
  snapshot: string | null;
  contribs: Map<Component, string>;
};

/**
 * One mounted component. Owns:
 *
 * - The live element it is mounted on (mutable across rename via swap-in-place).
 * - The user's cleanup function returned from their mount fn.
 * - Per-element attribution bookkeeping (style / attr / class / child) keyed
 *   by **writer Component** instance. Both the component's own writes and
 *   foreign writes from other components land here; the per-prop reducer
 *   (last-insertion-wins for style/attr, ref-count for class) determines what
 *   actually goes on `this.el`.
 * - A reverse `#touched` set of every other Component this one has written
 *   to. On `unmount`, the writer asks each target to scrub anything keyed by
 *   the writer; per-slot data lives only on the target side.
 */
export class Component {
  el: HTMLElement;
  #userCleanup: () => void = noop;
  #unmounted = false;

  readonly #styles = new Map<string, Map<Component, string>>();
  readonly #attrs = new Map<string, AttrEntry>();
  readonly #classes = new Map<string, Map<Component, number>>();
  readonly #children = new Map<Node, Component>();

  readonly #touched = new Set<Component>();

  constructor(el: HTMLElement) {
    this.el = el;
  }

  mount(mountFn: MountFn): void {
    componentStore.register(this.el, this);
    const proxy = wrap(this, this) as ComponentElement;
    const cleanup = mountFn(proxy);
    this.#userCleanup = typeof cleanup === "function" ? cleanup : noop;
  }

  unmount(): void {
    if (this.#unmounted) return;
    try {
      this.#userCleanup();
    } finally {
      // Flip the flag before scrubbing targets: if a target is itself
      // partway through unmounting and tries to call back into us, our own
      // clear methods short-circuit (see #unmounted check below).
      this.#unmounted = true;
      for (const target of this.#touched) {
        target.removeContributionsFrom(this);
      }
      this.#touched.clear();
      componentStore.unregister(this.el);
    }
  }

  /**
   * Swap-in-place rename: build a new element with `newTag`, migrate
   * attributes / own custom JS keys / children, replace in the parent, and
   * move the store entry from the old element to the new one so existing
   * proxies (which resolve `this.el` lazily) follow transparently.
   *
   * Per-element bookkeeping (`#styles` etc.) stays on this Component
   * instance — it isn't tied to the element identity, so nothing to migrate.
   */
  rename(newTag: string): void {
    const oldEl = this.el;
    const newEl = oldEl.ownerDocument.createElement(newTag);

    for (const attr of Array.from(oldEl.attributes)) {
      newEl.setAttribute(attr.name, attr.value);
    }
    for (const key of Object.keys(oldEl)) {
      // Components stash custom JS-only properties (e.g. paint-canvas exposes
      // `el.canvas`) directly on the element; carry them across so cross-
      // component reads via `host.canvas` keep working.
      (newEl as unknown as Record<string, unknown>)[key] = (
        oldEl as unknown as Record<string, unknown>
      )[key];
    }
    moveChildren(oldEl, newEl);

    const parent = oldEl.parentNode;
    if (parent) parent.replaceChild(newEl, oldEl);

    componentStore.unregister(oldEl);
    this.el = newEl;
    componentStore.register(newEl, this);
  }

  // ---- style ----

  recordStyle(writer: Component, prop: string, value: string): void {
    let perProp = this.#styles.get(prop);
    if (!perProp) this.#styles.set(prop, (perProp = new Map()));
    // delete-then-set so a re-write moves to the end of insertion order
    perProp.delete(writer);
    perProp.set(writer, value);
    writer.#trackTarget(this);
    this.#reconcileStyle(prop);
  }

  clearStyle(writer: Component, prop: string): void {
    if (this.#unmounted) return;
    const perProp = this.#styles.get(prop);
    if (!perProp) return;
    if (!perProp.delete(writer)) return;
    if (perProp.size === 0) this.#styles.delete(prop);
    this.#reconcileStyle(prop);
  }

  // ---- attributes ----

  recordAttr(writer: Component, name: string, value: string): void {
    const entry = this.#getOrCreateAttr(name);
    entry.contribs.delete(writer);
    entry.contribs.set(writer, value);
    writer.#trackTarget(this);
    this.#reconcileAttr(name);
  }

  clearAttr(writer: Component, name: string): void {
    if (this.#unmounted) return;
    const entry = this.#attrs.get(name);
    if (!entry) return;
    if (!entry.contribs.delete(writer)) return;
    this.#reconcileAttr(name);
  }

  // ---- classList ----

  bumpClass(writer: Component, name: string): void {
    const perClass = this.#getOrCreateClassMap(name);
    perClass.set(writer, (perClass.get(writer) ?? 0) + 1);
    writer.#trackTarget(this);
    this.#reconcileClass(name);
  }

  decrementClass(writer: Component, name: string): void {
    if (this.#unmounted) return;
    const perClass = this.#classes.get(name);
    if (!perClass) return;
    const cur = perClass.get(writer);
    if (cur === undefined) return;
    if (cur <= 1) perClass.delete(writer);
    else perClass.set(writer, cur - 1);
    this.#reconcileClass(name);
  }

  // ---- child ownership ----

  registerChild(writer: Component, child: Node): void {
    this.#children.set(child, writer);
    writer.#trackTarget(this);
  }

  ownerOfChild(child: Node): Component | undefined {
    return this.#children.get(child);
  }

  forgetChild(child: Node): void {
    this.#children.delete(child);
  }

  /**
   * Called by `writer.unmount()`. Scrubs every entry on this target keyed by
   * `writer`, reconciling each affected slot. Cheaper than the dual-side
   * reverse-index alternative and keeps per-slot data in exactly one place.
   *
   * No-op once this Component is itself unmounted: its bookkeeping no longer
   * affects anything that's still on the page.
   */
  removeContributionsFrom(writer: Component): void {
    if (this.#unmounted) return;

    for (const [prop, perProp] of this.#styles) {
      if (!perProp.delete(writer)) continue;
      if (perProp.size === 0) this.#styles.delete(prop);
      this.#reconcileStyle(prop);
    }

    for (const [name, entry] of this.#attrs) {
      if (!entry.contribs.delete(writer)) continue;
      this.#reconcileAttr(name);
    }

    for (const [name, perClass] of this.#classes) {
      if (!perClass.delete(writer)) continue;
      this.#reconcileClass(name);
    }

    for (const [child, owner] of this.#children) {
      if (owner !== writer) continue;
      this.#children.delete(child);
      if (child.parentNode === this.el) this.el.removeChild(child);
    }
  }

  #trackTarget(target: Component): void {
    this.#touched.add(target);
  }

  #reconcileStyle(prop: string): void {
    const perProp = this.#styles.get(prop);
    const style = this.el.style;
    if (!perProp || perProp.size === 0) {
      style.removeProperty(toCssProp(prop));
      return;
    }
    let winner = "";
    for (const v of perProp.values()) winner = v;
    style.setProperty(toCssProp(prop), winner);
  }

  #reconcileAttr(name: string): void {
    const entry = this.#attrs.get(name);
    if (!entry) return;
    if (entry.contribs.size === 0) {
      if (entry.snapshot === null) this.el.removeAttribute(name);
      else this.el.setAttribute(name, entry.snapshot);
      return;
    }
    let winner = "";
    for (const v of entry.contribs.values()) winner = v;
    this.el.setAttribute(name, winner);
  }

  #reconcileClass(name: string): void {
    const perClass = this.#classes.get(name);
    let total = 0;
    if (perClass) for (const c of perClass.values()) total += c;
    if (total > 0) this.el.classList.add(name);
    else this.el.classList.remove(name);
  }

  #getOrCreateAttr(name: string): AttrEntry {
    let entry = this.#attrs.get(name);
    if (!entry) {
      const snapshot = this.el.hasAttribute(name)
        ? this.el.getAttribute(name)
        : null;
      entry = { snapshot, contribs: new Map() };
      this.#attrs.set(name, entry);
    }
    return entry;
  }

  #getOrCreateClassMap(name: string): Map<Component, number> {
    let perClass = this.#classes.get(name);
    if (!perClass) this.#classes.set(name, (perClass = new Map()));
    return perClass;
  }
}

function moveChildren(from: Element, to: Element): void {
  const move = (from as unknown as { moveBefore?: Function }).moveBefore;
  if (typeof move === "function") {
    while (from.firstChild) {
      // moveBefore preserves iframe state, focus, video playback, etc.
      (to as unknown as {
        moveBefore: (node: Node, ref: Node | null) => void;
      }).moveBefore(from.firstChild, null);
    }
    return;
  }
  while (from.firstChild) to.appendChild(from.firstChild);
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

function noop(): void {}
