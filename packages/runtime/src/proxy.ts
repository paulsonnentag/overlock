import * as componentStore from "./component-store.js";
import type { Component } from "./component.js";

/**
 * Wrap a `(target, writer)` pair as an `HTMLElement`-shaped Proxy.
 *
 * - `target` is the Component whose element the caller will operate on.
 * - `writer` is the Component on whose behalf those operations are recorded.
 *
 * Reads resolve `target.el` lazily on every access so a swap-in-place
 * `Component.rename` is invisible to user-held proxy references — the same
 * proxy keeps working after its underlying element is swapped out.
 *
 * Writes routed through this proxy land on `target`'s per-element
 * bookkeeping, attributed to `writer`. There is no shared store anymore —
 * every proxy in the system targets a real, mounted Component, and that
 * Component owns the bookkeeping for its own element.
 */
export function wrap(target: Component, writer: Component): HTMLElement {
  return new Proxy({} as HTMLElement, {
    get(_, prop) {
      const t = target.el;
      if (prop === "parentComponent") return parentComponentLookup(t, writer);
      if (prop === "style") return styleProxy(target, writer);
      if (prop === "classList") return classListProxy(target, writer);

      if (CHILD_OPS.has(prop)) {
        return interceptedChildOp(prop as ChildOpName, target, writer);
      }
      if (prop === "setAttribute") {
        return (name: string, value: string): void =>
          target.recordAttr(writer, name, String(value));
      }
      if (prop === "removeAttribute") {
        return (name: string): void => target.clearAttr(writer, name);
      }
      if (prop === "toggleAttribute") {
        return (name: string, force?: boolean): boolean => {
          const has = t.hasAttribute(name);
          const want = force === undefined ? !has : force;
          if (want) target.recordAttr(writer, name, "");
          else target.clearAttr(writer, name);
          return target.el.hasAttribute(name);
        };
      }

      if (prop === "innerHTML" || prop === "outerHTML") {
        return (t as unknown as Record<string, unknown>)[prop as string];
      }

      const v = (t as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof v === "function" ? (v as Function).bind(t) : v;
    },

    set(_, prop, value) {
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
        target.recordAttr(writer, attrName, String(value));
        return true;
      }
      // Custom JS properties (e.g. paint-canvas exposing `el.canvas`) and
      // anything else fall through to the live element. Not attributed.
      (target.el as unknown as Record<PropertyKey, unknown>)[prop] = value;
      return true;
    },

    has(_, prop) {
      return prop in target.el;
    },

    getPrototypeOf() {
      return Object.getPrototypeOf(target.el);
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
  target: Component,
  writer: Component,
): (...args: unknown[]) => unknown {
  switch (op) {
    case "appendChild":
      return (child: unknown): Node => {
        const node = child as Node;
        target.registerChild(writer, node);
        return target.el.appendChild(node);
      };
    case "insertBefore":
      return (child: unknown, ref: unknown): Node => {
        const node = child as Node;
        target.registerChild(writer, node);
        return target.el.insertBefore(node, ref as Node | null);
      };
    case "append":
      return (...args: unknown[]): void => {
        const nodes = args.map((a) => coerceNode(a, target.el));
        for (const n of nodes) target.registerChild(writer, n);
        target.el.append(...nodes);
      };
    case "prepend":
      return (...args: unknown[]): void => {
        const nodes = args.map((a) => coerceNode(a, target.el));
        for (const n of nodes) target.registerChild(writer, n);
        target.el.prepend(...nodes);
      };
    case "removeChild":
      return (child: unknown): Node => {
        const node = child as Node;
        const owner = target.ownerOfChild(node);
        if (owner !== writer) {
          throw new Error(
            "removeChild: this component does not own the given child",
          );
        }
        target.forgetChild(node);
        return target.el.removeChild(node);
      };
    case "replaceChild":
      return (newChild: unknown, oldChild: unknown): Node => {
        const oldNode = oldChild as Node;
        const newNode = newChild as Node;
        const owner = target.ownerOfChild(oldNode);
        if (owner !== writer) {
          throw new Error(
            "replaceChild: this component does not own the node being replaced",
          );
        }
        target.forgetChild(oldNode);
        target.registerChild(writer, newNode);
        return target.el.replaceChild(newNode, oldNode);
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
 * through `target.recordStyle`, which reconciles the inline style.
 */
function styleProxy(target: Component, writer: Component): CSSStyleDeclaration {
  const proxy = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "cssText") {
          throw new Error("style.cssText is not supported on component proxies");
        }
        if (prop === "setProperty") {
          return (name: string, value: string, _priority?: string): void => {
            target.recordStyle(writer, name, value);
          };
        }
        if (prop === "removeProperty") {
          return (name: string): string => {
            const previous = target.el.style.getPropertyValue(name);
            target.clearStyle(writer, name);
            return previous;
          };
        }
        const live = target.el.style;
        const v = (live as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof v === "function" ? (v as Function).bind(live) : v;
      },
      set(_, prop, value) {
        if (prop === "cssText") {
          throw new Error(
            "style.cssText is not supported on component proxies",
          );
        }
        if (typeof prop !== "string") return true;
        target.recordStyle(writer, prop, String(value));
        return true;
      },
      deleteProperty(_, prop) {
        if (typeof prop === "string") target.clearStyle(writer, prop);
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
function classListProxy(target: Component, writer: Component): DOMTokenList {
  const proxy = new Proxy(
    {},
    {
      get(_, prop) {
        const live = target.el.classList;
        if (prop === "add") {
          return (...names: string[]): void => {
            for (const n of names) target.bumpClass(writer, n);
          };
        }
        if (prop === "remove") {
          return (...names: string[]): void => {
            for (const n of names) target.decrementClass(writer, n);
          };
        }
        if (prop === "toggle") {
          return (name: string, force?: boolean): boolean => {
            const has = live.contains(name);
            const want = force === undefined ? !has : force;
            if (want) target.bumpClass(writer, name);
            else target.decrementClass(writer, name);
            return target.el.classList.contains(name);
          };
        }
        if (prop === "replace") {
          return (oldName: string, newName: string): boolean => {
            if (!live.contains(oldName)) return false;
            target.decrementClass(writer, oldName);
            target.bumpClass(writer, newName);
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
  writer: Component,
): HTMLElement | null {
  let cur: HTMLElement | null = target.parentElement;
  while (cur && !componentStore.lookup(cur)) {
    cur = cur.parentElement;
  }
  if (!cur) return null;
  const comp = componentStore.lookup(cur)!;
  return wrap(comp, writer);
}
