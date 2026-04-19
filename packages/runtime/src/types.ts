export type ComponentManifest = {
  name: string;
  url: string;
};

export type ComponentElement = HTMLElement & {
  /** Nearest ancestor whose tag is in the runtime's component registry,
   * or null at the root. Skips plain DOM nodes. */
  readonly parentComponent: ComponentElement | null;
};

export type MountFn = (el: ComponentElement) => void | (() => void);
