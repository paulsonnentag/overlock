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
  /**
   * Convention slot for a scoped module loader. A component that wants to
   * be a loader for its subtree stashes a function here in its mount fn;
   * consumers find it via `element.findClosest(a => a.loadModule)`.
   */
  loadModule?: (specifier: string) => Promise<unknown>;
};

export type MountFn = (el: ComponentElement) => void | (() => void);
