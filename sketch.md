# Design doc

## The rule

A tool is `export default function (element)`. Inside the function it may only:

1. **Mutate its own DOM subtree.** Standard DOM APIs on `element` and its
   descendants — `appendChild`, `innerHTML`, `style`, `setAttribute`,
   `addEventListener` (on its own nodes), `canvas.getContext('2d')`, etc.
2. **Get a handle to the parent component.** `element.parentComponent` is
   the nearest ancestor that is itself a registered component (plain DOM
   ancestors are skipped), wrapped in the same identity-bound proxy.
3. **Read/write data and call methods on those capabilities.** The capability
   exposes only whitelisted methods (`screenToPage`, `setCamera`, `change`,
   `value`, `at`, ...).
4. **Register event handlers on the parent element** through the capability
   (`parent.addEventListener(type, handler)`) — but may not otherwise mutate
   it. No style, no children, no attributes, no innerHTML, no `querySelector`.

Nothing else is reachable. No `document`, no `window`, no sibling DOM, no
cross-tool DOM traversal, no imports of arbitrary modules.

## Whitelist (concrete)

### On own subtree — full standard DOM

Everything the tool does to `element` and its descendants is unrestricted:

- Construction: `element.appendChild`, `createElement` (via a bound
  `element.ownerDocument.createElement` or equivalent), `cloneNode`,
  `removeChild`, `replaceChild`, `insertBefore`.
- Styling: `el.style`, `el.className`, `el.classList`, `el.setAttribute`,
  CSS via inline style or a `<style>` child.
- Content: `el.textContent`, `el.innerHTML`, `el.innerText`.
- Events: `el.addEventListener` / `removeEventListener` on own nodes; handlers
  may call `event.preventDefault()`, `event.stopPropagation()`, read
  `clientX/Y`, `pressure`, `target` (target is opaque — treat as a token).
- Measurement: `el.getBoundingClientRect`, `el.offsetWidth/Height`,
  `el.scrollTop/Height/Left/Width`.
- Canvas: `canvas.getContext('2d')` and the full 2D API.
- SVG: constructed as DOM like everything else.

### Ancestor capability handle — the real element, restricted

`element.parentComponent` returns the **nearest ancestor component element**, wrapped
in a Proxy that restricts its property/method surface. The tool calls
standard DOM methods like `parent.getBoundingClientRect()`,
`parent.addEventListener('pointerdown', ...)`, plus whatever the parent has
`provide`d onto itself (`parent.screenToPage`, `parent.setCamera`, etc.).

No new method names to learn — if it exists on `HTMLElement`, and it's safe,
the tool just calls it.

**How the whitelist is derived from TypeScript's DOM types.** Every property
and method on `Element` / `HTMLElement` / `Node` / `EventTarget` falls into
one of four buckets, and the bucket can be computed mechanically from
`lib.dom.d.ts`:

| Bucket                       | Rule                                          | Access      |
| ---------------------------- | --------------------------------------------- | ----------- |
| Pure reads                   | `readonly` prop or method, return type is a primitive / `DOMRect` / `DOMRectList` / `DOMTokenList` / `CSSStyleDeclaration` (read-only proxy) | allow |
| DOM-returning reads          | Return type includes `Node` / `Element` / `NodeList` / `HTMLCollection` | **block** (would escape the sandbox — `parentElement`, `children`, `querySelector`, `closest`, `getRootNode`, `ownerDocument`, `nextSibling`, …) |
| Mutators                     | Non-`readonly` prop setter, or method whose name is `append*` / `insert*` / `remove*` / `replace*` / `set*` / `scroll*` (setter) / `focus` / `blur` / `click` / `prepend` / innerHTML setter | **block** |
| Special-cased                | `addEventListener`, `removeEventListener`, `setPointerCapture`, `releasePointerCapture`, `dispatchEvent` (with type filter) | allow, with auto-dispose wrapper |

The readonly/writable distinction is already encoded in `lib.dom.d.ts`:

```ts
interface Element {
  readonly tagName: string;                     // allowed
  readonly clientWidth: number;                 // allowed
  readonly children: HTMLCollection;            // BLOCKED — returns DOM
  readonly parentElement: HTMLElement | null;   // BLOCKED — escapes
  id: string;                                   // blocked (writable)
  getBoundingClientRect(): DOMRect;             // allowed
  querySelector(...): Element | null;           // BLOCKED — returns DOM
  setAttribute(name, value): void;              // BLOCKED — mutator
  addEventListener(...): void;                  // special-cased → allow
  ...
}
```

So the whitelist generator is literally: walk every member of every DOM
interface, keep the ones where `readonly === true` and the return type,
transitively, never mentions `Node | Element | ParentNode | ChildNode |
ShadowRoot | Document | DocumentFragment | NodeList | HTMLCollection`.
Add the four special-cased event/pointer-capture methods by name.

Net effect on ancestor elements:

- **Geometry**: `parent.getBoundingClientRect()`, `parent.clientWidth`,
  `parent.offsetWidth`, `parent.scrollTop` (read), `parent.scrollHeight`,
  `parent.tagName`, `parent.id` (read), `parent.hasAttribute(name)`,
  `parent.getAttribute(name)` — all allowed.
- **Events**: `parent.addEventListener(type, handler, options?)` and
  `parent.removeEventListener(type, handler)` — standard signatures; the
  proxy auto-`removeEventListener`s on tool unmount.
- **Pointer capture**: `parent.setPointerCapture(id)` /
  `parent.releasePointerCapture(id)` — allowed (standard DOM names).
- **Domain methods**: whatever the parent's `mount` function assigned on
  itself — `parent.screenToPage(x, y)`, `parent.setCamera(c)`,
  `parent.change(fn)`, etc. These are
  forwarded through the proxy as-is (own-properties assigned by `provide`
  pass through; inherited DOM properties go through the whitelist filter).
- **Mutation**: `parent.style.cursor = 'grab'`, `parent.appendChild(...)`,
  `parent.innerHTML = ...`, `parent.setAttribute(...)` — all throw.
- **Traversal**: `parent.querySelector(...)`, `parent.children`,
  `parent.parentElement`, `parent.closest(...)` — all throw. If a tool
  needs to reach a further ancestor it chains `element.parentComponent.parentComponent`.

The same proxy wraps any "foreign" DOM node the tool receives: the `target`
of events that originate on a parent, nodes returned by blessed methods
like `surface.getContainerEl()` (now fine to return the real element, it's
wrapped). The tool's **own** descendants are unwrapped and have the full
DOM surface.

### Root-provided services (also blessed)

Exposed via `element.parentComponent` (chained as needed) or as a capability on `element`:

- `fs.readFile(url)` — read-only filesystem.
- `plugins.byType(type)` — plugin registry.
- `portal(descriptor)` — opens an overlay outside the tool's subtree, the
  only way to render into `document.body`. Returned handle supports `.close()`.
- `onGlobal('keydown', handler)` — global key handler (replaces
  `document.addEventListener`). Auto-disposed on unmount.
- `uid()` — stable id generator (replaces `Date.now() + Math.random()`).

### Global pure functions — allowed

`Math.*`, `JSON.*`, `Date.*`, `Promise`, `structuredClone`, `Array`, `Object`,
`Map`, `Set`, `WeakMap`, `WeakSet`, `Intl.*`, `URL`, `TextEncoder/Decoder`,
`requestAnimationFrame` / `cancelAnimationFrame`, `performance.now`,
`window.devicePixelRatio` (read). No `fetch`, no `setTimeout`/`setInterval`
(use `rAF`), no `navigator.*` except via blessed services.

## What this covers

Straight-forward; most tools become trivially conforming:

- **`rectangle/tool.js`**, **`ellipse/tool.js`**, **`line/tool.js`**,
  **`text/tool.js`**, **`counter/tool.js`**, **`markdown/card.js`** — pure
  renderers over a data ref. Only touch own subtree.
- **`paper/paper.js`** — creates a container div and renders shapes into it.
  All DOM is its own.
- **`sparkle-marker/tool.js`**, **`rainbow-marker/tool.js`** — create a
  canvas child inside `element`, draw, animate with `rAF`. Only use own
  subtree plus allowed globals. (Drop the `parseColor` trick that allocates
  a detached canvas via `document.createElement`; do it as an own child.)
- **`rectangle/button.js`**, **`ellipse/button.js`**, **`line/button.js`**,
  **`sparkle-marker/button.js`**, **`rainbow-marker/button.js`**,
  **`color-picker/button.js`** — renders a button in own subtree, plus
  `surface.addEventListener('pointerdown'|'pointermove'|'pointerup', ...)`
  and `surface.setPointerCapture(id)`. Read/write shapes via methods the
  surface component provides on itself. Exact same DOM API the code uses today.
- **`viewport/tool.js`** — already uses `containerEl.addEventListener('wheel')`
  and `containerEl.getBoundingClientRect()`; both survive the whitelist
  verbatim. The one line that breaks is `getComputedStyle(el)` on an event
  ancestor to detect scroll-trap — that's a global and reads a foreign
  node's computed styles. Replace with a blessed `surface.isScrollable(target)`
  or drop the nicety.
- **`file-browser/tool.js`**, **`llm/tool.js`**, **`inspector/tool.js`**
  (partially), **`json/tool.js`**, **`map/tool.js`**, **`stack/tool.js`**,
  **`dock-layout/tool.js`**, **`tic-tac-toe/tool.js`**, **`parts-bin/tool.js`**,
  **`embed/tool.js`**, **`resize/card.js`**, **`world-drop/card.js`** — all
  fit naturally; they mutate own DOM + read/write refs.

## Exceptions — what doesn't fit without extra blessed capabilities

These are the concrete cases that break the rule. Each needs a targeted
escape hatch, or a change in behaviour.

### 1. Cursor on the parent surface — `hand/button.js`

```js
surface.style.cursor = 'grabbing'; // style is a writable property → blocked
```

`CSSStyleDeclaration` is entirely writable in the DOM types, so the whole
`.style` surface is blocked by the general rule. Fix: parent provides
`surface.setCursor(name)` (owned method, survives the proxy). Push-style so
multiple tools can stack.

### 2. Modal overlays outside the subtree — `selection/button.js` context menu

`document.body.appendChild(overlay)` opens a viewport-covering modal.

Fix: root-provided `portal({ clientX, clientY, content })` returning a handle
the tool fills like any other subtree. Portal children still follow the
rule (own subtree only).

### 3. Global keybindings — `selection`, `text`, others

`document.addEventListener('keydown', ...)` listens anywhere.

Fix: root-provided `onGlobal('keydown', handler)` with the same auto-dispose
semantics. Handler only fires when the owning tool's subtree (or a root-
blessed focus scope) is focused/selected.

### 4. Hit-testing outside own subtree — `selection`, `eraser` pickup

Uses `document.elementFromPoint(x, y)` and `surface.querySelectorAll('ref-view')`
to find which shape is under the cursor across sibling tools.

Fix: blessed `surface.hitTest(clientX, clientY) → { shapeId, subSurface? }`.
The surface (which mounted the shapes) is the only party that knows the map,
and can answer without leaking DOM nodes.

### 5. Cross-surface drag lift — `selection` drag-overlay

Does `dragOriginalParent.moveBefore(wrapper, null)` on a sibling shape's
wrapper to "lift" it into a viewport overlay while dragging.

Fix: blessed `surface.liftShape(shapeId) → { drop(targetSurface, x, y) }`.
The surface owns the DOM and performs the move internally. Alternative:
drop the visual lift and do pure data-driven drag (simpler, good enough for
most cases).

### 6. Walking descendants to inspect — `inspector/tool.js`

Walks the ref-view tree under the root and highlights other tools' DOM via
`el.style.filter = ...`.

Fix: this is inherently privileged. Make it a **root-only** tool with the
blessed `instrumentation` capability: `getTree()`, `highlight(nodeId)`,
`onMounted(fn)`, `onUnmounted(fn)`. Regular tools can't get this capability.

### 7. Self-delete — `eraser/tool.js`

Walks `element.closest('ref-view').ref...` to find its own shape id and
delete itself from the parent's shapes map.

Fix: pass the tool's own `shapeId` and the enclosing `shapesRef` at mount
time as part of the capability surface (`element.self` → `{ id, remove() }`).

### 8. Exposing methods on own element for other tools — `paper`, `text`

`paper.js` does `element.screenToPage = ...` so descendants can use it.
`text/tool.js` does `element.addExtension = ...` to accept CodeMirror plugins.

Fix: `element.provide(name, api)` — the component assigns named methods on
itself (e.g. `screenToPage`, `addExtension`), and descendants reach them by
calling `element.parentComponent.foo(...)`. This is what makes
`parentComponent` useful: the wrapped proxy forwards own-properties the
component has installed via `provide`.

### 9. External libraries — `zod`, `perfect-freehand`, `@codemirror/*`,
`marked`, `solid-js`

Not covered by DOM-only at all. Options:

- Inline small helpers (perfect-freehand stroke math is ~150 lines, doable).
- For `zod`: validation can be data-level and optional; parent decides.
- For `codemirror` / `marked`: these run entirely inside the tool's subtree
  and only mutate own DOM. They're compatible in principle, but they're
  still imports. If "no imports" is a rule, these tools must be shipped as
  bundled modules. If "bundled imports allowed so long as they only touch
  the passed-in element" is a rule, they stay.
- `solid-js` / reactive rendering: same — it's a library that mounts into a
  host element. Keep it.

Recommendation: allow **pure libraries** (no top-level side effects, no
document/window globals at module init) and **UI libraries that render
into a provided host element only**. Block libraries that touch global
state at import time (`llm/tool.js` does `document.adoptedStyleSheets = ...`
at module load — that would be banned; use a `<style>` tag in the subtree
instead).

## Execution plan

### Phase 0 — Generate the whitelist from `lib.dom.d.ts` (1 day)

Use the TypeScript compiler API to walk every member of `EventTarget`,
`Node`, `Element`, `HTMLElement`, `SVGElement`, `HTMLCanvasElement`, and
their relevant mixins. For each member emit:

```ts
type MemberDecision =
  | { kind: 'allow', name: string }           // readonly, non-Node-returning
  | { kind: 'blockEscapes', name: string }    // readonly but returns Node-ish
  | { kind: 'blockMutates', name: string }    // writable prop / mutator method
  | { kind: 'special', name: string };        // event/pointer-capture
```

Commit the generated whitelist as a JSON file so reviewers can see exactly
what's in and out. Regenerate on TS version bumps.

### Phase 1 — Inventory violations (1 day)

For each tool, grep for disallowed usage:

| Pattern                                                         | Outcome |
| --------------------------------------------------------------- | ------- |
| `document.\w+`                                                   | flag    |
| `window.\w+` (except `devicePixelRatio`, `innerWidth/Height`)   | flag    |
| Assignment to a foreign element's property (`X.style = `, `X.foo = `) | flag |
| `<foreign>.appendChild`, `insertBefore`, `removeChild`, etc.    | flag    |
| `<foreign>.querySelector(All)?`, `.closest`, `.children`, `.parentElement` | flag |
| `getComputedStyle`                                              | flag    |
| `setTimeout` / `setInterval`                                    | flag    |
| `fetch`                                                         | flag    |
| Imports not matching `\./` or an allowlisted lib                | flag    |

Most tools have zero hits. Inspector, selection, hand, eraser, llm are the
serious offenders.

### Phase 2 — Wrap `parentComponent` reads in the whitelist proxy (2 days)

Change `parentComponent` so its return value is a Proxy over the real
ancestor component element. The Proxy's `get`/`set` handlers consult the
generated whitelist:

- Own-properties assigned by `provide` (e.g. `screenToPage`, `setCamera`)
  pass through unchanged.
- Inherited DOM members are looked up by name in the whitelist JSON.
- `addEventListener`/`removeEventListener` are wrapped to auto-unregister
  on tool unmount.
- Everything else throws `TypeError: '<name>' is not accessible on a
  foreign element`.

Extend the same proxy to any DOM node returned by a blessed method
(`surface.getContainerEl()`) and to `event.target` on events registered
through the proxy.

Run every scene. Every illegal call throws with a clear message.

### Phase 3 — Add the six blessed methods (3–5 days)

1. `surface.setCursor(name)` → fixes `hand`.
2. `root.portal(descriptor)` + `root.onGlobal('keydown', handler)` →
   fixes selection modal + keybindings + text Escape.
3. `surface.hitTest(x, y)` → fixes selection and eraser pickup.
4. `element.self` (id + `remove()`) → fixes eraser self-delete.
5. `surface.liftShape(id)` or drop the visual lift → fixes cross-surface
   drag.
6. `root.instrumentation` as a privileged-only capability → inspector.

### Phase 4 — Sandbox enforcement (3 days)

Run each tool module in a realm where:

- `globalThis.document`, `globalThis.window`, `fetch`, `setTimeout`, etc.
  are absent.
- The module receives `element` as its only argument. The `element` itself
  is the real DOM node (tool has full authority over its own subtree), but
  any DOM node it can reach *from* the parent (via `parentComponent` or
  blessed returns) is wrapped in the whitelist proxy from Phase 2.
- `import` is resolved through an allowlist.

This is `ShadowRealm` or `iframe` or just stripping globals at module load
+ a linted module resolver. Start with the Proxy + stripped globals; move
to realm isolation once the behaviour is proven.

### Phase 5 — Mechanical tool migration (ongoing)

Per tool: read the violation list, replace each with the blessed call.
Most tools need **zero** changes once Phase 2 lands, because the call
sites use standard DOM names already. The real work is the five
offenders: hand (`setCursor`), selection (hit-test + portal + key-binds
+ drag), eraser (self + hit-test), inspector (instrumentation), llm
(drop `adoptedStyleSheets`, use a `<style>` child).

## Summary

- **What tools can do**: anything with standard DOM on their own subtree,
  plus the readonly / non-Node-returning subset of DOM methods on ancestors,
  plus `addEventListener` / `removeEventListener` /
  `setPointerCapture` / `releasePointerCapture` on ancestors, plus
  owned-methods the ancestor `provide`d.
- **What they can't do**: touch any DOM they didn't create (any mutator
  on a foreign element throws), traverse the tree (`querySelector`,
  `children`, `parentElement` all throw), reach `document`/`window`, or
  import arbitrary modules.
- **The whitelist is not hand-written** — it's generated from
  `lib.dom.d.ts` by taking every member that is `readonly` and whose
  return type doesn't transitively include a Node-ish type, plus four
  special-cased methods (`addEventListener`, `removeEventListener`,
  `setPointerCapture`, `releasePointerCapture`). Regenerated per TS
  release.
- **The minimum new API** is five blessed domain methods (`setCursor`,
  `hitTest`, `liftShape`, `portal`, `onGlobal`), a `self` handle, and the
  symmetric `element.provide(schema, api)`.
- **The cost** is rewriting selection / hand / eraser / inspector, and
  dropping a few DOM tricks (the scrollable-ancestor check in viewport,
  the `adoptedStyleSheets` in llm).
- **What doesn't fit at all** is the inspector in its current form — it
  requires a privileged read view of the whole tree; that becomes an
  explicit capability rather than casual DOM traversal.
