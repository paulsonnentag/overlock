export type ComponentManifest = {
  name: string;
  url: string;
};

/**
 * The element handed to a component's mount function. It is a `Proxy` over
 * the live DOM element bound to the calling component's identity: every
 * style/class/attribute/child mutation through it is attributed to that
 * component and reversed on unmount. Reads pass through to the live element.
 *
 * `parentComponent` is the only outward-navigation primitive surfaced by the
 * proxy; it returns a fresh proxy over the nearest registered ancestor (with
 * the same identity), or `null` at the root.
 */
export type ComponentElement = HTMLElement & {
  readonly parentComponent: ComponentElement | null;
};

export type MountFn = (el: ComponentElement) => void | (() => void);
