import type { ComponentManifest, MountFn } from "./types.js";
import { Component } from "./component.js";
import * as componentStore from "./component-store.js";

type Claim = { scope: string; rewriteTo?: string };

export function createRuntime(root: HTMLElement): Runtime {
  return new Runtime(root);
}

/**
 * One mount root. Owns its component registry, namespace allocator, and a
 * `MutationObserver` over the root element, and tears them all down on
 * `destroy()`. Each manifest URL should be loaded at most once per instance
 * via `loadComponent` — repeated calls will refetch and produce duplicate
 * registrations.
 *
 * Per-mount state (proxy bookkeeping, attribution, DOM swap mechanics) lives
 * on `Component` instances. This class is just registry + observer + the
 * iterable set of mounts it owns.
 */
export class Runtime {
  // Mount registry: what to run when a tag is seen.
  readonly #registry = new Map<string, MountFn>();

  // Tag allocation: per-baseName claim + per-scope namespace memo.
  readonly #claims = new Map<string, Claim>();
  readonly #namespaceByScope = new Map<string, string>();

  // Components mounted by this runtime. Lookup-by-element goes through the
  // singleton `component-store`; this set is just for iteration during the
  // tag rewrite walk in `#allocateTag` and during `destroy`.
  readonly #mounted = new Set<Component>();

  readonly #rootEl: HTMLElement;
  #observer: MutationObserver | null = null;

  constructor(root: HTMLElement) {
    this.#rootEl = root;
    this.#forEachElementIn(root, (el) => this.#mountIfRegistered(el));
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            this.#forEachElement(node, (el) => this.#mountIfRegistered(el));
          }
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          // A node that is still connected has been moved, not removed —
          // e.g. `Component.rename` migrates children from old to new
          // element, which the observer reports as remove+add records on
          // the children individually. Skip the spurious unmount.
          if (node.isConnected) continue;
          this.#forEachElement(node, (el) => {
            if (el.isConnected) return;
            this.#unmountIfMounted(el);
          });
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    this.#observer = observer;
  }

  /**
   * Fetch a component manifest (`{ name, url }`) from `manifestUrl`,
   * dynamic-`import()` the JS module it references, and register its
   * default export as a mount fn under a tag derived from `manifest.name`
   * and disambiguated via `#allocateTag`. Resolves to the final tag name.
   *
   * This is the *only* way to register a component from a URL. Direct
   * JS-module loading is deliberately not supported — components are
   * always loaded through a manifest so the tag name is explicit and
   * travels with the component rather than being derived from a filename.
   */
  async loadComponent(manifestUrl: string): Promise<string> {
    this.#assertAlive();
    const url = new URL(manifestUrl, location.href);

    const res = await fetch(url.href);
    if (!res.ok) {
      throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);
    }

    const manifest: ComponentManifest = await res.json();
    if (!manifest.name || !manifest.url) {
      throw new Error(`Invalid manifest at ${manifestUrl}: missing "name" or "url"`);
    }

    const moduleUrl = new URL(manifest.url, url);
    const mod = await import(/* @vite-ignore */ moduleUrl.href);
    const mountFn = mod.default;
    if (typeof mountFn !== "function") {
      throw new Error(
        `Module at ${moduleUrl.href} does not default-export a function`,
      );
    }

    const name = this.#allocateTag(manifest.name, toScope(url));
    this.#registerComponent(name, mountFn);
    return name;
  }

  /**
   * Register a component inline, without fetching a manifest. The caller
   * chooses the tag name (must contain a hyphen, per custom-element rules)
   * and hands over the mount fn directly. Intended for root-level wiring
   * from the embedding page — e.g. a `<module-root>` that stashes helpers
   * on itself for its subtree to discover via `findClosest`.
   *
   * If an existing component is registered under the same name, any
   * currently-mounted instance is unmounted and re-mounted against the new
   * mount fn — same behavior as `#registerComponent` in `loadComponent`.
   */
  define(name: string, mountFn: MountFn): void {
    this.#assertAlive();
    if (!name.includes("-")) {
      throw new Error(`define(${name}): tag must contain a hyphen`);
    }
    this.#registerComponent(name, mountFn);
  }

  destroy(): void {
    if (this.#observer === null) return;
    this.#observer.disconnect();
    this.#observer = null;
    for (const comp of Array.from(this.#mounted)) {
      comp.unmount();
    }
    this.#mounted.clear();
  }

  #assertAlive(): void {
    if (this.#observer === null) {
      throw new Error("Runtime instance has been destroyed");
    }
  }

  #registerComponent(name: string, mountFn: MountFn): void {
    const previous = this.#registry.get(name);
    this.#registry.set(name, mountFn);

    this.#forEachElementIn(this.#rootEl, (el) => {
      if (el.localName !== name) return;
      if (previous && componentStore.lookup(el)) this.#unmountIfMounted(el);
      this.#mountIfRegistered(el);
    });
  }

  #allocateTag(baseName: string, scope: string): string {
    if (!baseName.includes("-")) {
      return `${this.#getOrCreateNamespace(scope)}:${baseName}`;
    }
    const claim = this.#claims.get(baseName);
    if (claim === undefined) {
      this.#claims.set(baseName, { scope });
      return baseName;
    }
    if (claim.scope === scope) {
      let suffix = 2;
      while (this.#registry.has(`${baseName}-${suffix}`)) suffix++;
      return `${baseName}-${suffix}`;
    }
    if (!claim.rewriteTo) {
      const oldTag = `${this.#getOrCreateNamespace(claim.scope)}:${baseName}`;
      const prevFn = this.#registry.get(baseName);
      if (prevFn) {
        this.#registry.set(oldTag, prevFn);
        this.#registry.delete(baseName);
      }
      claim.rewriteTo = oldTag;
      // Iterate currently-mounted Components rather than walking the DOM:
      // every element that needs renaming has a Component on it (it was
      // mounted under the now-disputed baseName).
      for (const comp of Array.from(this.#mounted)) {
        if (comp.el.localName === baseName) comp.rename(oldTag);
      }
    }
    return `${this.#getOrCreateNamespace(scope)}:${baseName}`;
  }

  #getOrCreateNamespace(scope: string): string {
    const cached = this.#namespaceByScope.get(scope);
    if (cached) return cached;

    const parts = scope.split(".");
    const taken = new Set(this.#namespaceByScope.values());
    let namespace = scope;
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts.slice(i).join(".");
      if (!taken.has(candidate)) {
        namespace = candidate;
        break;
      }
    }

    this.#namespaceByScope.set(scope, namespace);
    return namespace;
  }

  #mountIfRegistered(el: Element): void {
    if (componentStore.lookup(el)) return;
    const rewriteTag = this.#claims.get(el.localName)?.rewriteTo;
    if (rewriteTag) {
      this.#replaceElement(el, rewriteTag);
      return;
    }
    const mountFn = this.#registry.get(el.localName);
    if (!mountFn) return;

    const comp = new Component(el as HTMLElement);
    this.#mounted.add(comp);
    comp.mount(mountFn);
  }

  #unmountIfMounted(el: Element): void {
    const comp = componentStore.lookup(el);
    if (!comp || !this.#mounted.has(comp)) return;
    this.#mounted.delete(comp);
    comp.unmount();
  }

  /**
   * Used for stray/unmounted elements with a baseName that was claimed after
   * insertion (mount path's rewrite branch). Mounted elements with the same
   * baseName go through `Component.rename` instead.
   */
  #replaceElement(oldEl: Element, newTag: string): void {
    const parent = oldEl.parentNode;
    if (!parent) return;
    const newEl = oldEl.ownerDocument.createElement(newTag);
    for (const attr of Array.from(oldEl.attributes)) {
      newEl.setAttribute(attr.name, attr.value);
    }
    while (oldEl.firstChild) newEl.appendChild(oldEl.firstChild);
    parent.replaceChild(newEl, oldEl);
  }

  #forEachElement(el: Element, fn: (el: Element) => void): void {
    fn(el);
    this.#forEachElementIn(el, fn);
  }

  #forEachElementIn(root: Element, fn: (el: Element) => void): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as Element | null;
    while (node) {
      fn(node);
      node = walker.nextNode() as Element | null;
    }
  }
}

function toScope(url: URL): string {
  const hostParts = url.hostname.split(".").filter(Boolean).reverse().map(slug);
  const pathParts = url.pathname
    .split("/")
    .filter(Boolean)
    .slice(0, -2)
    .map(slug);
  return [...hostParts, ...pathParts].join(".") || "local";
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
