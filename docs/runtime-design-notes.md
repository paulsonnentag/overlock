# Runtime design notes

Working notes from a design conversation about the `@overlock/runtime`
attribution-proxy system. The first half captures what was implemented; the
second half captures the structural refactoring discussion that followed and
the model we converged on (but did not yet implement).

## Part 1: What was implemented

### Goal

A component model where:

- A component is `(element) => cleanup`.
- Components mutate elements through what looks like normal DOM (`style`,
  `appendChild`, `setAttribute`, …).
- Every mutation is **attributed** to the component that made it; on cleanup
  every change that component made is fully reversed.
- Conflicts on shared properties (e.g. two components writing
  `style.background`) are resolved peer-to-peer: contributions coexist, the
  most recent wins, removal of the current winner falls back to the next-most-
  recent automatically.

### Scope adjustments vs. the original design doc

Three deviations decided during the conversation:

- **Reads are live, not per-caller.** `proxy.style.color`,
  `proxy.classList.contains`, `proxy.getAttribute`, `proxy.children`, etc. all
  return what's actually on the element. The doc's "a component sees only
  what it has put in" rule was dropped.
- **No `find(interface)` resolver.** `parentComponent` (existing helper)
  remains the only outward-navigation primitive.
- **No conflict-introspection API yet.** The data is in the bookkeeping;
  exposing it is a deferred follow-up.

### Files that changed

- New: `packages/runtime/src/stores.ts` — four `WeakMap`-keyed forward stores
  (style / attribute / class / child-ownership) plus a per-`ComponentId`
  reverse index. `reconcile*` functions write the live winner back to the
  element; `unwind(id)` reverses every contribution a component made;
  `evictElement(el)` drops per-element bookkeeping when an element leaves the
  document.
- New: `packages/runtime/src/proxy.ts` — `wrap(target, id, ctx)` returns a
  `Proxy<HTMLElement>` whose `get` trap intercepts `style` (sub-proxy),
  `classList` (sub-proxy), `parentComponent` (re-wraps the nearest registered
  ancestor), the child mutators (`appendChild` / `insertBefore` / `append` /
  `prepend` / `removeChild` / `replaceChild`), and the attribute mutators
  (`setAttribute` / `removeAttribute` / `toggleAttribute`). The `set` trap
  routes mirrored attribute properties (`id`, `className`, `title`, `dir`,
  `lang`, `hidden`, `tabIndex`, `slot`) through attribution; throws on
  `innerHTML` / `outerHTML` setters; passes everything else through (so
  `paint-canvas`'s `el.canvas = ...` keeps working).
- Modified: `packages/runtime/src/runtime.ts` — mints a
  `Symbol("component:<tag>")` per mount, builds the proxy via `wrap()`, stores
  a `MountRecord { id, userCleanup }` in `#mounted`, runs `userCleanup()`
  then `unwind(id)` on unmount in a `try / finally`, extends the
  `MutationObserver` removal branch to call `stores.evictElement(el)`. The
  old live-node `parentComponent` getter is gone — `parentComponent` is now
  a Proxy `get` trap.
- Modified: `packages/runtime/src/types.ts` — JSDoc only; `ComponentElement`'s
  shape unchanged (the proxy presents the same surface).

### Demo compatibility

Existing tools (`canvas`, `rect`, `line`, `color-picker`) keep working
unchanged because:

- `paint-canvas` does `element.canvas = canvas; element.color = "..."` —
  custom JS properties land on the live element via the `set` trap's
  passthrough branch. Other tools' `host.canvas` reads (via `parentComponent`)
  hit the `get` trap's passthrough branch and return the live property.
- `rect.js` does `element.appendChild(button)` and on cleanup
  `element.removeChild(button)` — both go through intercepted child ops;
  ownership recorded; manual cleanup still works. If the dev forgets to
  detach, `unwind` does it.
- `rect.js` writes `button.style.background = ...` directly — `button` is a
  raw element the tool created (not a proxy), so plain DOM, untracked. Tool
  owns that subtree outright.
- `host.parentComponent` walk in `rect.js` to find the canvas host — proxy's
  `parentComponent` getter walks ancestors and re-wraps.
- `canvas.dataset.selectedTool = "rect"` — `canvas` here is the raw
  `<canvas>` exposed via `host.canvas`, not a proxy, so `dataset` writes pass
  through unattributed.

---

## Part 2: Refactoring discussion (not yet implemented)

The implemented code packs everything into `Runtime` plus a `Stores` helper.
The discussion explored cleaner splits.

### Iteration 1: extract a `Mounter` coordinator

Idea: reduce `Runtime` to "just the `MutationObserver`", move element
lifecycle methods (mount / unmount / registry / loading / tag allocation /
stores) into a `Mounter` class.

Rejected on the basis that "Mounter" is a singleton coordinator and the user
wanted a per-instance abstraction.

### Iteration 2: per-instance `Component` class

Idea: `Component` (or `MountedComponent`) holds `id`, `el`, `userCleanup`,
exposes `unmount()` that runs cleanup then reverses contributions. `Runtime`
keeps the registry, naming, observer, and shared `Stores` / `WrapContext`,
just instantiating a `Component` per mount.

Settled on the name `Component`, with the additional decision that **rename
should also live on `Component`** — `Runtime` decides what should be mounted
or renamed; `Component` performs the actual DOM operation.

### The rename discussion

Rename is fundamentally **destroy old element + create new element + move
attributes + move children**. The DOM does not let you mutate `tagName`.

Two strategies surfaced:

1. **Swap and let the observer remount.** Component does `replaceChild`; the
   `MutationObserver` removal/addition records drive an unmount + remount
   via the existing code path. Simple, but the user's mount fn re-runs and
   any cross-component decoration on the old element is lost.

2. **Swap in place.** Component creates the new element, uses the new
   `Element.prototype.moveBefore()` API to migrate children (preserves iframe
   state, focus, video playback), copies own custom JS properties from old
   to new, migrates `Stores` per-element entries old → new, updates
   `Runtime.#mounted`. The proxy needs a `{ current: el }` indirection so the
   user's stored proxy reference survives. The mount fn does **not** re-run.

   The MutationObserver still fires for both the removed and the added
   element; runtime ignores them by checking `#mounted` (already-mounted →
   skip; not-in-mounted → skip) — no double-mount, no double-unmount.

Both strategies are buildable. No pick was made.

### The "remember mounted components and iterate on rename" question

Today's `#allocateTag` walks the DOM via `forEachElementIn(rootEl, …)` to
find every element with the conflicting `localName`. The alternative is to
keep an iterable collection of mounted components on `Runtime` and filter by
tag.

Verdict: works, with two small notes:

- `WeakMap<Element, Component>` is not iterable, so we'd add a parallel
  `Set<Component>` (or `Map<ComponentId, Component>`). `WeakMap` stays for
  the observer's `el → Component` lookup.
- Stray (unregistered, unmounted) elements with the conflicting baseName
  wouldn't be caught at rewrite-time; they'd be renamed lazily on next mount
  attempt via the existing `#claims.get(el.localName)?.rewriteTo` check.
  Probably fine.

### The big insight: kill `Stores`, put per-element bookkeeping on `Component`

The repeated question — "can we get rid of `Stores` and store this on
`Component`?" — kept getting pushed back because of cross-component
attribution. The breakthrough was realizing:

> **Every proxy in the system targets an element that has a mounted
> `Component` on it.**

Reasons:

- The mount handshake gives a component a proxy over its own root → that
  root is itself a Component.
- `parentComponent` walks up until it finds a registered tag → by the
  registry check, that ancestor has (or will have) a Component.
- There is no other way to obtain a proxy. Plain elements
  (`<div class="toolbar">`, the `<button>` `rect-tool` builds, …) are never
  proxied — components mutate them as raw DOM.

Therefore "the per-element bookkeeping for X" can live **on the Component
mounted at X**. There is no need for a shared `Stores` keyed by element —
the element-owning Component *is* that store.

#### How writes route

When B does `host.style.background = "lavender"` (`host` = A's element):

- The proxy was created via `parentComponentLookup` and knows: writer = B's
  id, target = A's element.
- Instead of `stores.writeStyle(B.id, A.el, "background", "lavender")`, it
  calls `aComponent.recordStyle(B.id, "background", "lavender")`.
- `aComponent` holds its own
  `#styles: Map<prop, Map<writerId, value>>` and reconciles `A.el.style`
  from it.

A's own writes (writer id = A) and B's writes (writer id = B) land in the
**same** map — A's Component's `#styles` for the `background` slot. The
insertion-order-of-`Map` recency trick still works. Reconcile picks the last
entry. Fall-back behavior on unmount is unchanged.

#### What lives where in this model

```
Runtime
  registry / claims / allocator
  loadComponent
  MutationObserver
  WeakMap<Element, Component>           // for observer + parentComponent lookup
  Set<Component>                        // iterable for rename / destroy

Component (per mount)
  id, el (or { current: el } ref), userCleanup
  #styles / #classes / #attrs / #children    // forward bookkeeping for THIS element,
                                              // keyed by writer id
  #touched: Map<Component, { styles: Set<string>; ... }>
                                              // reverse index: what other Components
                                              // I have written to (so unmount can reverse)
  recordStyle(writerId, prop, value)         // public; proxies call this
  clearStyle(writerId, prop)                 // ...etc for class/attr/child
  unmount()                                  // userCleanup + walk #touched + reconcile self
  swapTo(newTag) / mount() / ...             // depending on rename strategy
```

The proxy's wrap context shrinks from `{ stores, isComponent }` to
`{ componentFor: (el) => Component | undefined, isComponent }`.
`parentComponent` can be tightened to require a *mounted* ancestor (not just
a registered tag), closing a tiny race where the tag is registered but the
mount hasn't run yet.

#### What this gets us

- `Stores` class disappears entirely.
- `evictElement` disappears — bookkeeping for an element *is* its Component's
  bookkeeping; when the Component unmounts (which happens when its element
  is removed), the bookkeeping goes with it.
- `WrapContext` is just `{ componentFor, isComponent }`.
- Cross-component reconciliation is preserved: same `Map<writerId, value>`
  insertion-order trick, just stored on the target Component instead of in a
  global `WeakMap`.

#### Caveats

1. **Mount ordering inside a single mutation batch.** If A and B both mount
   in the same batch and B's mount fn calls `root.parentComponent` before A
   is mounted, we'd return null. Today's `forEachElement` walks parent-first
   via `TreeWalker`, so A mounts before B in normal cases. Tightening
   `parentComponent` to require a mounted ancestor makes the invariant
   explicit.

2. **Lifetime.** B's reverse index holds direct references to the Components
   it touched. If A unmounts before B, A's Component lingers (referenced by
   B) until B unmounts. B's `unmount` then calls `aComponent.clearStyle(...)`
   on a no-longer-mounted A. Cheapest fix: A flips an `#unmounted = true`
   flag and its `clearX` methods become no-ops once flipped.

3. **Cross-component contributions across rename.** If A's element is
   renamed, B's contributions to it are keyed on A's Component — which is
   either reborn (swap-and-remount) or kept (swap-in-place). In the
   swap-in-place model the bookkeeping moves with the Component naturally;
   in the swap-and-remount model it's lost (same as today).

---

## Decisions still open

- **Rename strategy**: swap-and-let-observer-remount (simpler, loses
  decoration) vs. swap-in-place with `moveBefore` and proxy ref indirection
  (preserves mount, more code).
- **Bookkeeping location**: keep `Stores` (current code) vs. move
  per-element bookkeeping onto `Component` per the insight above.

Both refactor proposals are documented in `.cursor/plans/` plan files but
have not been executed.

---

## Part 3: Implemented (Component refactor)

The Iteration 2 + "big insight" refactor has now landed. Resolved decisions:

### Architecture

- New singleton module `packages/runtime/src/component-store.ts` — a
  process-wide `WeakMap<Element, Component>` exposing
  `register / unregister / lookup`. Both `Runtime` (mount/unmount path,
  `parentComponent` walk) and `Component` (self-registration on mount,
  unregister-then-register on rename) talk to it. The store is intentionally
  global; two `Runtime` instances over disjoint subtrees coexist fine.
- New per-mount class `packages/runtime/src/component.ts` — owns `el`
  (mutable across rename), `#userCleanup`, the four per-element bookkeeping
  maps (`#styles / #attrs / #classes / #children`), a reverse `#touched:
  Set<Component>`, plus `mount / unmount / rename / record* / clear* /
  removeContributionsFrom`.
- `packages/runtime/src/stores.ts` deleted. `Stores`, `ComponentId`, and
  `evictElement` are gone.
- `Runtime` slimmed to registry, claims, namespace allocator, the
  `MutationObserver`, and `#mounted: Set<Component>` for iteration. Mount
  path constructs a `Component` and calls `comp.mount(mountFn)`; unmount
  path calls `comp.unmount()`.

### Identity

No `ComponentId` symbols. The Component instance itself is the identity —
all per-writer maps are keyed by `Component`. `#-private` methods on one
instance can be called by another instance (e.g.
`writer.#trackTarget(this)` from inside a target's `recordStyle`).

### Bookkeeping discipline

Per-slot data lives in exactly one place: on the **target** Component. The
**writer** keeps only `#touched: Set<Component>` of "targets I have written
to". On `unmount`, the writer iterates `#touched` and calls
`target.removeContributionsFrom(this)`; the target walks its own four maps,
strips inner entries keyed by the writer, and reconciles each affected
slot.

This costs O(slots-on-target) per cross-component edge instead of
O(slots-this-writer-touched-on-target), but avoids storing per-slot data
twice.

### Rename: swap-in-place

`Component.rename(newTag)`:

1. Build new element with `document.createElement(newTag)`.
2. Copy attributes.
3. Copy own custom JS keys (so e.g. `paint-canvas`'s `el.canvas` survives).
4. Migrate children using `Element.prototype.moveBefore` if available,
   `appendChild` fallback otherwise.
5. `parent.replaceChild(newEl, oldEl)`.
6. `componentStore.unregister(oldEl); this.el = newEl; componentStore.register(newEl, this);`.

Per-element bookkeeping (`#styles` etc.) is bound to the Component
instance, not the element identity, so nothing to migrate.

### Proxy: target/writer pair, lazy `el` resolution

`wrap(target: Component, writer: Component): HTMLElement`. The Proxy is
constructed over a sacrificial `{}`; every trap reads `target.el` lazily on
each access. Effect: a swap-in-place rename is invisible to user-held proxy
references — the same proxy object keeps working after its underlying
element is swapped out.

`WrapContext` is gone; the proxy imports `componentStore` directly.

### `parentComponent` tightened

`parentComponentLookup` walks ancestors until it finds one with a
**mounted** Component (`componentStore.lookup(cur) !== undefined`), not
just one with a registered tag. Closes the race where the tag is registered
but the mount hasn't run yet.

### Observer: `isConnected` guard on removal

`Component.rename` can move children one-by-one between the old and new
element (under the `appendChild` fallback path), and the
`MutationObserver` reports each move as a remove-from-oldEl record on the
child. The observer now skips removed nodes that are still
`isConnected` — by the time the microtask flushes, a moved child is back
in the document, and we don't want to spuriously unmount it.

### Allocator iterates `#mounted`, not the DOM

`Runtime.#allocateTag`'s rewrite branch (when a baseName claim flips on
collision) iterates `this.#mounted` and calls `comp.rename(oldTag)` on each
match, rather than walking the DOM with a `TreeWalker`. Stray unregistered
elements with the conflicting baseName are still handled lazily by the
`#mountIfRegistered` rewrite check.

### What this gets us

- `Stores` and `evictElement` are gone.
- Cross-component reconciliation preserved: same `Map<writer, value>`
  insertion-order trick, just stored on the target Component.
- Public API (`createRuntime / Runtime / ComponentManifest /
  ComponentElement / MountFn`) unchanged. Demo tools work without changes.
