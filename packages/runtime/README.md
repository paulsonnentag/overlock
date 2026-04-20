# @overlock/runtime

Runtime for the Overlock attribution-proxy sandbox. Workspace-private while it bakes.

**What works today:**

- Component registry keyed by tag name, with namespace allocation and tag rewriting on collision.
- `MutationObserver` over a chosen root element that mounts/unmounts components as their tags appear and disappear.
- `loadComponent(manifestUrl)` that fetches a JSON manifest and dynamic-`import()`s the module.
- `loadComponentFromModule(url, scope)` that dynamic-`import()`s a JS URL directly (no manifest), invokes the module's outer init with `scope`, and registers the returned mount fn under a tag derived from the URL filename. Intended for loader components that expose `element.loadComponent` to their subtree.
- `element.findParent(predicate)` and `element.findClosest(predicate)` on the value handed to a mount function: walk the registered-component chain (skipping plain DOM ancestors) and return the first ancestor — or for `findClosest`, also `element` itself — for which the predicate is truthy, or `null` if none matches. `findClosest` mirrors `Element.closest` semantics.
- `runtime.define(name, mountFn)` for inline component registration without a manifest fetch — useful for root-level wiring (e.g. a `<module-root>` that stashes a scoped module loader on itself).

**Module shape.** A loadable module's default export is a single function `(element) => result`. Whether it's a component or a code library depends only on how the caller loads it, not on the module itself.

```js
// Component module: element is the mount target, result is an optional cleanup
export default (element) => {
  return () => {};
};

// Code-lib module: element is the loader, result is whatever API it wants to expose
export default (element) => ({
  next() {},
});
```

A loader component stashes two methods on itself; consumers walk up to them with `element.findClosest(a => a.loadComponent)`:

- `element.loadModule(url)` — dynamic-`import()`s the module, _calls_ its default export once with the loader element, and resolves to whatever it returned. Natural fit for code libs that want an API object bound to their load site.
- `element.loadComponent(url)` — dynamic-`import()`s the module and hands its default export to `loadComponentFromModule` as the mount fn, resolving to the tag name it was ultimately registered under. The runtime then invokes the mount fn per mounted instance with the instance's element.

**What's coming next:**

- The attribution Proxy: every DOM mutation a tool performs is attributed to the tool's identity and reversed when the tool unmounts.
- Replacing the dynamic-`import()` loader with something that respects the JS subset enforced by [`overlock`](../eslint-plugin/README.md).

See [../eslint-plugin/RULES.md](../eslint-plugin/RULES.md) for the runtime model the lint pins to.
