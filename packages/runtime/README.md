# @overlock/runtime

Runtime for the Overlock attribution-proxy sandbox. Workspace-private while it bakes.

**What works today:**

- Component registry keyed by tag name, with namespace allocation and tag rewriting on collision.
- `MutationObserver` over a chosen root element that mounts/unmounts components as their tags appear and disappear.
- `loadComponent(manifestUrl)` that fetches a JSON manifest and dynamic-`import()`s the module.
- `element.findParent(predicate)` and `element.findClosest(predicate)` on the value handed to a mount function: walk the registered-component chain (skipping plain DOM ancestors) and return the first ancestor — or for `findClosest`, also `element` itself — for which the predicate is truthy, or `null` if none matches. `findClosest` mirrors `Element.closest` semantics.
- `runtime.define(name, mountFn)` for inline component registration without a manifest fetch — useful for root-level wiring (e.g. a `<module-root>` that stashes a scoped module loader on itself).

**What's coming next:**

- The attribution Proxy: every DOM mutation a tool performs is attributed to the tool's identity and reversed when the tool unmounts.
- Replacing the dynamic-`import()` loader with something that respects the JS subset enforced by [`overlock`](../eslint-plugin/README.md).

See [../eslint-plugin/RULES.md](../eslint-plugin/RULES.md) for the runtime model the lint pins to.
