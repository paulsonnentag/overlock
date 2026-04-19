# @overlock/runtime

Runtime for the Overlock attribution-proxy sandbox. Workspace-private while it bakes.

**What works today:**

- Component registry keyed by tag name, with namespace allocation and tag rewriting on collision.
- `MutationObserver` over a chosen root element that mounts/unmounts components as their tags appear and disappear.
- `loadComponent(manifestUrl)` that fetches a JSON manifest and dynamic-`import()`s the module.
- `element.parentComponent` on the value handed to a mount function: returns the nearest ancestor whose tag is in the registry (the parent **component**, not the parent DOM node), or `null` at the root.

**What's coming next:**

- The attribution Proxy: every DOM mutation a tool performs is attributed to the tool's identity and reversed when the tool unmounts.
- Replacing the dynamic-`import()` loader with something that respects the JS subset enforced by [`overlock`](../eslint-plugin/README.md).

See [../eslint-plugin/RULES.md](../eslint-plugin/RULES.md) for the runtime model the lint pins to.
