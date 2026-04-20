# Writing a tool

A tool is a pair of files that live together in a folder:

```
tools/my-thing/
  my-thing.json   manifest — the name that registers the component
  my-thing.js     component file — default-exports the mount fn
```

Components are **always** loaded through their manifest. The runtime does
not support registering a component from a raw JS URL — the manifest is
what decides the tag name, so the name travels with the tool instead of
being derived from a filename by the caller.

## Manifest

```json
{
  "name": "my-thing",
  "url": "./my-thing.js"
}
```

`name` is the base tag name (must contain a hyphen per custom-element
rules, unless you want the runtime to namespace it for you). `url` is the
component file, resolved relative to the manifest URL.

## Component file

```js
export default (element) => {
  // set up DOM on `element`
  return () => {
    // optional cleanup — undo anything you did above
  };
};
```

- The default export is the mount fn. It receives the mount target.
- It may return a cleanup fn or nothing.
- It must **not** be `async`. `await` is fine inside inner helpers that
  you call from the mount fn, but the mount fn itself has to return
  synchronously (so the runtime gets the cleanup fn, not a promise).

## Reaching ancestors

Walk the component chain with `element.findClosest(pred)` or
`element.findParent(pred)` — the first checks `element` itself, the
second starts one level up. The predicate takes a `ComponentElement` and
returns a boolean.

```js
const loader = element.findClosest(
  (a) => typeof a.loadComponent === "function",
);
```

## Ad-hoc surface on your element

A component can stash anything it likes on its own element — a canvas
stashes `canvas` / `ctx`, a loader stashes `loadModule` / `loadComponent`,
etc. Descendants find them with `findClosest`.

**Do not extend the `ComponentElement` / `Component` type to advertise
these slots.** They are a local convention per-component, not a runtime
primitive. Typing them on the shared surface would force every unrelated
consumer to know about flavors that only matter inside one subtree.

If you need a TS name for the local shape, declare it next to the
component that stashes it and narrow at the use site (see how
[packages/demo/src/main.ts](../src/main.ts) types its `<module-root>`
loader).

## Code-library modules

Some files aren't components — they're small code libs that a component
wants to call into (e.g. an id source, a formatter, a client stub). Those
use a sibling convention:

```js
// id-source.js
export default (element) => {
  // `element` is the loader that imported this file
  let n = 0;
  return {
    next() {
      n += 1;
      return n;
    },
  };
};
```

Consumers pull them in with `loader.loadModule(url)` where `url` is the
JS file directly — no manifest, no tag registration. `loadModule` is only
provided by components that choose to act as loaders (`<module-root>` in
the demo); discover them via `findClosest`.
