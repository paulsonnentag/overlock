import type { ComponentManifest, ComponentElement, MountFn } from "./types.js";
import { Stores, type ComponentId } from "./stores.js";
import { wrap, type WrapContext } from "./proxy.js";

type Claim = { scope: string; rewriteTo?: string };

type MountRecord = { id: ComponentId; userCleanup: () => void };

export function createRuntime(root: HTMLElement): Runtime {
  return new Runtime(root);
}

/**
 * One mount root. Owns its component registry, namespace allocator, and a
 * `MutationObserver` over the root element, and tears them all down on
 * `destroy()`. Each manifest URL should be loaded at most once per instance
 * via `loadComponent` — repeated calls will refetch and produce duplicate
 * registrations.
 */
export class Runtime {
  // Mount registry: what to run when a tag is seen, and how to tear it down.
  readonly #registry = new Map<string, MountFn>();
  readonly #mounted = new WeakMap<Element, MountRecord>();

  // Tag allocation: per-baseName claim + per-scope namespace memo.
  readonly #claims = new Map<string, Claim>();
  readonly #namespaceByScope = new Map<string, string>();

  // Attribution backing stores. The proxy handed to each component routes all
  // cross-component-visible writes (style/class/attr/child) through here, so
  // unmount can fully reverse a component's contributions.
  readonly #stores = new Stores();
  readonly #wrapCtx: WrapContext;

  // DOM binding: root element plus the observer (null once destroyed).
  readonly #rootEl: HTMLElement;
  #observer: MutationObserver | null = null;

  constructor(root: HTMLElement) {
    this.#rootEl = root;
    this.#wrapCtx = {
      stores: this.#stores,
      isComponent: (tag: string) => this.#registry.has(tag),
    };
    this.#forEachElementIn(root, (el) => this.#mountIfRegistered(el));
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            this.#forEachElement(node, (el) => this.#mountIfRegistered(el));
          }
        }
        for (const node of record.removedNodes) {
          if (node instanceof Element) {
            this.#forEachElement(node, (el) => {
              this.#unmountIfMounted(el);
              // Drop per-element bookkeeping for nodes that have left the
              // document. Reverse-index entries keyed by componentId are
              // cleaned by the contributing component's own unmount/unwind.
              this.#stores.evictElement(el);
            });
          }
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    this.#observer = observer;
  }

  loadComponent(manifestUrl: string): Promise<string> {
    this.#assertAlive();
    return this.#doLoad(manifestUrl);
  }

  destroy(): void {
    if (this.#observer === null) return;
    this.#observer.disconnect();
    this.#observer = null;
    this.#forEachElementIn(this.#rootEl, (el) => this.#unmountIfMounted(el));
  }

  #assertAlive(): void {
    if (this.#observer === null) {
      throw new Error("Runtime instance has been destroyed");
    }
  }

  async #doLoad(manifestUrl: string): Promise<string> {
    const url = new URL(manifestUrl, location.href);

    const res = await fetch(url.href);
    if (!res.ok) {
      throw new Error(`Failed to fetch manifest: ${res.status} ${res.statusText}`);
    }

    const manifest: ComponentManifest = await res.json();

    if (!manifest.name || !manifest.url) {
      throw new Error(`Invalid manifest at ${manifestUrl}: missing "name" or "url"`);
    }

    const moduleUrl = new URL(manifest.url, url).href;
    const mod = await import(/* @vite-ignore */ moduleUrl);
    const mountFn = mod.default;

    if (typeof mountFn !== "function") {
      throw new Error(
        `Module at ${moduleUrl} does not default-export a function`,
      );
    }

    const scope = toScope(url);
    const name = this.#allocateTag(manifest.name, scope);
    this.#registerComponent(name, mountFn);

    return name;
  }

  #registerComponent(name: string, mountFn: MountFn): void {
    const previous = this.#registry.get(name);
    this.#registry.set(name, mountFn);

    this.#forEachElementIn(this.#rootEl, (el) => {
      if (el.localName !== name) return;
      if (previous && this.#mounted.has(el)) this.#unmountIfMounted(el);
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
      this.#forEachElementIn(this.#rootEl, (el) => {
        if (el.localName === baseName) this.#replaceElement(el, oldTag);
      });
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
    if (this.#mounted.has(el)) return;
    const rewriteTag = this.#claims.get(el.localName)?.rewriteTo;
    if (rewriteTag) {
      this.#replaceElement(el, rewriteTag);
      return;
    }
    const mountFn = this.#registry.get(el.localName);
    if (!mountFn) return;

    const id: ComponentId = Symbol(`component:${el.localName}`);
    const proxy = wrap(el as HTMLElement, id, this.#wrapCtx) as ComponentElement;
    const cleanup = mountFn(proxy);
    const userCleanup = typeof cleanup === "function" ? cleanup : noop;
    this.#mounted.set(el, { id, userCleanup });
  }

  #unmountIfMounted(el: Element): void {
    const rec = this.#mounted.get(el);
    if (!rec) return;
    this.#mounted.delete(el);
    try {
      rec.userCleanup();
    } finally {
      // Reverse every contribution this component made: clears its style
      // entries (reconciling each property to the next-most-recent
      // contributor or removing it), zeroes its class ref-counts, drops its
      // attribute writes, and detaches any children it injected that are
      // still attached.
      this.#stores.unwind(rec.id);
    }
  }

  #replaceElement(oldEl: Element, newTag: string): void {
    const parent = oldEl.parentNode;
    if (!parent) return;
    const newEl = document.createElement(newTag);
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

function noop(): void {}
