export type ComponentManifest = {
  name: string;
  url: string;
};

/**
 * Generic predicate over elements — used by `findParent` / `findClosest`
 * to filter ancestors in the component chain, but intentionally named
 * without an "ancestor" flavor so it can be reused for any element test.
 */
export type ElementPredicate = (el: ComponentElement) => boolean;

/**
 * The element handed to a component's mount function. It is a `Proxy` over
 * the live DOM element bound to the calling component's identity: every
 * style/class/attribute/child mutation through it is attributed to that
 * component and reversed on unmount. Reads pass through to the live element.
 *
 * Outward navigation goes through `findParent` / `findClosest`, which walk
 * the registered-component chain (skipping plain DOM ancestors) and return
 * a proxy bound to the caller's identity, or `null` if nothing matches.
 *
 * Components may stash arbitrary ad-hoc properties on their element (e.g.
 * a paint-canvas stashing `canvas`/`ctx`/`color`; a module-root stashing a
 * `loadModule`/`loadComponent` pair). Those are application-level
 * conventions, not runtime primitives, and are intentionally not typed on
 * this surface — consumers reach them through `findClosest` + a predicate
 * and handle narrowing at the use site.
 */
export type ComponentElement = HTMLElement & {
  /**
   * Walk the component chain (exclusive of self) and return the nearest
   * ancestor for which `predicate` is truthy, or `null` if none matches.
   */
  findParent(predicate: ElementPredicate): ComponentElement | null;
  /**
   * Like `findParent`, but tests `this` first (mirrors `Element.closest`).
   */
  findClosest(predicate: ElementPredicate): ComponentElement | null;
};

export type MountFn = (el: ComponentElement) => void | (() => void);
