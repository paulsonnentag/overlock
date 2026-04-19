import { Stores, type ComponentId } from "./stores.js";

/**
 * Context passed through every wrap. `isComponent` lets `parentComponent`
 * walk to the nearest ancestor whose tag the runtime recognises without the
 * proxy having to know how the registry is shaped.
 */
export type WrapContext = {
  stores: Stores;
  isComponent: (tag: string) => boolean;
};

/**
 * Wrap a live element in a per-component identity proxy. Reads pass through
 * to the live element (so observers see the same DOM as everyone else);
 * writes that affect cross-component state are routed through `stores` and
 * attributed to `id`.
 */
export function wrap(
  target: HTMLElement,
  id: ComponentId,
  ctx: WrapContext,
): HTMLElement {
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "parentComponent") return parentComponentLookup(t, id, ctx);
      if (prop === "style") return styleProxy(t, id, ctx.stores);
      if (prop === "classList") return classListProxy(t, id, ctx.stores);

      if (CHILD_OPS.has(prop)) {
        return interceptedChildOp(prop as ChildOpName, t, id, ctx.stores);
      }
      if (prop === "setAttribute") {
        return (name: string, value: string): void =>
          ctx.stores.writeAttr(id, t, name, String(value));
      }
      if (prop === "removeAttribute") {
        return (name: string): void => ctx.stores.clearAttr(id, t, name);
      }
      if (prop === "toggleAttribute") {
        return (name: string, force?: boolean): boolean => {
          const has = t.hasAttribute(name);
          const want = force === undefined ? !has : force;
          if (want) ctx.stores.writeAttr(id, t, name, "");
          else ctx.stores.clearAttr(id, t, name);
          return t.hasAttribute(name);
        };
      }

      if (prop === "innerHTML" || prop === "outerHTML") {
        // getters are fine; the disallow is for writes via the `set` trap.
        return (t as unknown as Record<string, unknown>)[prop as string];
      }

      // Passthrough. Bind functions so brand-checks succeed when called.
      const v = (t as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof v === "function" ? (v as Function).bind(t) : v;
    },

    set(t, prop, value) {
      if (prop === "innerHTML") {
        throw new Error(
          "innerHTML setter is not supported on component proxies; build nodes and use appendChild",
        );
      }
      if (prop === "outerHTML") {
        throw new Error("outerHTML is not supported on component proxies");
      }
      const attrName = PROP_TO_ATTR.get(prop as string);
      if (attrName !== undefined) {
        ctx.stores.writeAttr(id, t, attrName, String(value));
        return true;
      }
      // Custom JS properties (e.g. paint-canvas exposing `el.canvas`) and
      // anything else fall through to the live element. Not attributed.
      (t as unknown as Record<PropertyKey, unknown>)[prop] = value;
      return true;
    },
  }) as HTMLElement;
}

/**
 * HTMLElement properties that mirror real attributes. Writes through the
 * proxy's `set` trap are routed via `setAttribute`-equivalent attribution so
 * they snapshot/reconcile like any other attribute write.
 */
const PROP_TO_ATTR = new Map<string, string>([
  ["id", "id"],
  ["className", "class"],
  ["title", "title"],
  ["dir", "dir"],
  ["lang", "lang"],
  ["hidden", "hidden"],
  ["tabIndex", "tabindex"],
  ["slot", "slot"],
]);

type ChildOpName =
  | "appendChild"
  | "insertBefore"
  | "append"
  | "prepend"
  | "removeChild"
  | "replaceChild";

const CHILD_OPS = new Set<PropertyKey>([
  "appendChild",
  "insertBefore",
  "append",
  "prepend",
  "removeChild",
  "replaceChild",
]);

function interceptedChildOp(
  op: ChildOpName,
  target: HTMLElement,
  id: ComponentId,
  stores: Stores,
): (...args: unknown[]) => unknown {
  switch (op) {
    case "appendChild":
      return (child: unknown): Node => {
        const node = child as Node;
        stores.registerChild(id, target, node);
        return target.appendChild(node);
      };
    case "insertBefore":
      return (child: unknown, ref: unknown): Node => {
        const node = child as Node;
        stores.registerChild(id, target, node);
        return target.insertBefore(node, ref as Node | null);
      };
    case "append":
      return (...args: unknown[]): void => {
        const nodes = args.map((a) => coerceNode(a, target));
        for (const n of nodes) stores.registerChild(id, target, n);
        target.append(...nodes);
      };
    case "prepend":
      return (...args: unknown[]): void => {
        const nodes = args.map((a) => coerceNode(a, target));
        for (const n of nodes) stores.registerChild(id, target, n);
        target.prepend(...nodes);
      };
    case "removeChild":
      return (child: unknown): Node => {
        const node = child as Node;
        const owner = stores.ownerOfChild(target, node);
        if (owner !== id) {
          throw new Error(
            "removeChild: this component does not own the given child",
          );
        }
        stores.forgetChild(target, node);
        return target.removeChild(node);
      };
    case "replaceChild":
      return (newChild: unknown, oldChild: unknown): Node => {
        const oldNode = oldChild as Node;
        const newNode = newChild as Node;
        const owner = stores.ownerOfChild(target, oldNode);
        if (owner !== id) {
          throw new Error(
            "replaceChild: this component does not own the node being replaced",
          );
        }
        stores.forgetChild(target, oldNode);
        stores.registerChild(id, target, newNode);
        return target.replaceChild(newNode, oldNode);
      };
  }
}

/** `append`/`prepend` accept strings (which the DOM converts to text nodes).
 * We do the conversion ourselves so we have an explicit Node reference to
 * register against the writer's ownership set. */
function coerceNode(value: unknown, target: HTMLElement): Node {
  if (value instanceof Node) return value;
  return target.ownerDocument.createTextNode(String(value));
}

/**
 * Style sub-proxy. Reads return live values from the CSSStyleDeclaration so
 * everyone sees the same effective value. Writes are attributed and routed
 * through `Stores.writeStyle`, which reconciles the inline style.
 */
function styleProxy(
  target: HTMLElement,
  id: ComponentId,
  stores: Stores,
): CSSStyleDeclaration {
  const proxy = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "cssText") {
          throw new Error("style.cssText is not supported on component proxies");
        }
        if (prop === "setProperty") {
          return (name: string, value: string, _priority?: string): void => {
            stores.writeStyle(id, target, name, value);
          };
        }
        if (prop === "removeProperty") {
          return (name: string): string => {
            const previous = target.style.getPropertyValue(name);
            stores.clearStyle(id, target, name);
            return previous;
          };
        }
        // Any other read -- including camelCase property names, getPropertyValue,
        // length, item, [Symbol.iterator] -- delegates to the live style.
        // Bind functions so internal `this` brand checks succeed.
        const v = (target.style as unknown as Record<PropertyKey, unknown>)[
          prop
        ];
        return typeof v === "function" ? (v as Function).bind(target.style) : v;
      },
      set(_, prop, value) {
        if (prop === "cssText") {
          throw new Error(
            "style.cssText is not supported on component proxies",
          );
        }
        if (typeof prop !== "string") return true;
        stores.writeStyle(id, target, prop, String(value));
        return true;
      },
      deleteProperty(_, prop) {
        if (typeof prop === "string") stores.clearStyle(id, target, prop);
        return true;
      },
    },
  );
  return proxy as unknown as CSSStyleDeclaration;
}

/**
 * classList sub-proxy. add/remove/toggle/replace go through ref-counts;
 * everything else (`contains`, iteration, `value`, `length`) delegates to the
 * live DOMTokenList.
 */
function classListProxy(
  target: HTMLElement,
  id: ComponentId,
  stores: Stores,
): DOMTokenList {
  const live = target.classList;
  const proxy = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "add") {
          return (...names: string[]): void => {
            for (const n of names) stores.bumpClass(id, target, n);
          };
        }
        if (prop === "remove") {
          return (...names: string[]): void => {
            for (const n of names) stores.decrementClass(id, target, n);
          };
        }
        if (prop === "toggle") {
          return (name: string, force?: boolean): boolean => {
            const has = live.contains(name);
            const want = force === undefined ? !has : force;
            if (want) stores.bumpClass(id, target, name);
            else stores.decrementClass(id, target, name);
            return live.contains(name);
          };
        }
        if (prop === "replace") {
          return (oldName: string, newName: string): boolean => {
            if (!live.contains(oldName)) return false;
            stores.decrementClass(id, target, oldName);
            stores.bumpClass(id, target, newName);
            return true;
          };
        }
        const v = (live as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof v === "function" ? (v as Function).bind(live) : v;
      },
    },
  );
  return proxy as unknown as DOMTokenList;
}

function parentComponentLookup(
  target: HTMLElement,
  id: ComponentId,
  ctx: WrapContext,
): HTMLElement | null {
  let cur: HTMLElement | null = target.parentElement;
  while (cur && !ctx.isComponent(cur.localName)) {
    cur = cur.parentElement;
  }
  return cur ? wrap(cur, id, ctx) : null;
}
