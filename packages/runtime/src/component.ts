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
    try {
      const cleanup = mountFn(proxy);
      this.#userCleanup = typeof cleanup === "function" ? cleanup : noop;
    } catch (err) {
      // The mount fn threw before returning a cleanup; there is nothing
      // for the runtime to run on unmount. Leave `#userCleanup` as the
      // no-op and surface the failure inside the component's own element
      // so the user sees it in situ rather than on the console.
      this.#userCleanup = noop;
      this.#renderError(err);
    }
  }

  unmount(): void {
    if (this.#unmounted) return;
    try {
      try {
        this.#userCleanup();
      } catch (err) {
        // Tear-down path: the user's cleanup threw. The element is being
        // removed anyway so there is no useful way to render the error in
        // place; just log and let the reverse-index scrub below run, so
        // attribution state doesn't leak onto siblings that outlive us.
        console.error("[overlock] cleanup threw", err);
      }
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

  /**
   * Turn the element into a read-only error badge when the mount fn threw
   * synchronously. Wipes any children the mount fn may have appended
   * before throwing, pins the full message to `title`/`aria-label` so the
   * native tooltip always has the full text, and writes a single span with
   * a warning glyph plus the first line of the message. After a frame we
   * measure the element and, if it's too small to read, collapse the span
   * to just the glyph — the tooltip still carries everything.
   */
  #renderError(err: unknown): void {
    const message =
      err instanceof Error ? (err.message || err.name) : String(err);
    const firstLine = message.split("\n", 1)[0] ?? message;

    const el = this.el;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.title = message;
    el.setAttribute("aria-label", message);

    const badge = el.ownerDocument.createElement("span");
    badge.style.display = "inline-flex";
    badge.style.alignItems = "center";
    badge.style.gap = "4px";
    badge.style.padding = "2px 6px";
    badge.style.background = "#fef2f2";
    badge.style.border = "1px solid #fecaca";
    badge.style.borderRadius = "4px";
    badge.style.color = "#991b1b";
    badge.style.font =
      "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    badge.style.maxWidth = "100%";
    badge.style.overflow = "hidden";
    badge.style.textOverflow = "ellipsis";
    badge.style.whiteSpace = "nowrap";
    badge.textContent = `${ERROR_GLYPH} ${firstLine}`;
    el.appendChild(badge);

    const applyAdaptiveText = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < ERROR_MIN_WIDTH || rect.height < ERROR_MIN_HEIGHT) {
        badge.textContent = ERROR_GLYPH;
      } else {
        badge.textContent = `${ERROR_GLYPH} ${firstLine}`;
      }
    };
    // One frame so layout has caught up with the just-cleared children.
    requestAnimationFrame(applyAdaptiveText);
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(applyAdaptiveText);
      ro.observe(el);
      // Tie the observer's lifetime to the mounted component so tearing
      // down the subtree disconnects it cleanly.
      this.#userCleanup = () => ro.disconnect();
    }
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

// Below these bounds the inline error badge is collapsed to a glyph-only
// form; the full message stays reachable via the native tooltip on the
// element's `title`. Tuned so a typical icon-sized toolbar button stays
// readable as text but a tiny dot stays sane.
const ERROR_MIN_WIDTH = 140;
const ERROR_MIN_HEIGHT = 24;
const ERROR_GLYPH = "\u26A0"; // ⚠
