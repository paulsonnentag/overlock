# demo

A small canvas drawing app that exercises both halves of overlock end-to-end:

- `@overlock/runtime` mounts four tool components into the page via `createRuntime` + `loadComponent`.
- The `overlock` ESLint plugin runs on every tool source as the runtime fetches it. Verification is fail-closed: a tool that breaks the JS subset never mounts.

## Run it

```sh
pnpm install
pnpm --filter demo dev
```

Open `http://localhost:5173`. Pick the Line or Rectangle tool, pick a colour, and drag inside the white canvas. The drawn shape uses the currently-selected colour.

## How the tools cooperate

The DOM is:

```html
<module-root>
  <paint-canvas>
    <div class="toolbar">
      <line-tool></line-tool>
      <rect-tool></rect-tool>
      <color-picker></color-picker>
      <import-demo></import-demo>
    </div>
  </paint-canvas>
</module-root>
```

- `<module-root>` is registered inline from `src/main.ts` via `runtime.define(...)` and stashes two methods on its own element:
  - `element.loadModule(url)` dynamic-`import()`s the module and _calls_ its default export once with the `<module-root>` element, resolving to whatever it returned.
  - `element.loadComponent(url)` dynamic-`import()`s the module and hands its default export to the runtime as a mount fn, resolving to the registered tag name.

  Descendants reach either method by walking up with `element.findClosest(a => a.loadComponent)`.
- `<paint-canvas>` creates a real `<canvas>` element, then exposes `element.canvas`, `element.ctx`, and `element.color` (defaulting to `#1f2937`) on its own host element. It is the parent component for everything inside the toolbar.
- `<line-tool>` and `<rect-tool>` find the canvas host with `element.findClosest(a => a.canvas)`. Each one renders a button. On click they set `canvas.dataset.selectedTool` to their name; while drawing they read that data attribute to decide whether the gesture is theirs, and read `host.color` to pick the stroke colour. They register pointer events on the host (not on the canvas), and filter to events whose target is the canvas.
- `<color-picker>` does the same `findClosest` lookup and renders a row of colour swatches. Clicking a swatch writes `host.color`; the line and rectangle tools read it on the next gesture.
- `<import-demo>` walks up to the loader and exercises both entry points:
  - `await loader.loadModule("/tools/import-demo/id-source.js")` — a code module whose default export returns a counter object. The tile uses it to stamp a serial number on its output.
  - `await loader.loadComponent("/tools/import-demo/badge.js")` — a component module whose default export is a mount fn. The returned tag name is instantiated in the DOM and the runtime mounts it automatically.

## Module shape

Every module — component or code lib — has the same default-export shape: a function taking one element argument. The element is the mount target for components, or the loader itself for code libs. The return value is an optional cleanup fn for components, or an arbitrary value (typically an API object) for code libs.

```js
// Component module (canvas, line, rect, color-picker, import-demo, badge)
export default (element) => {
  return () => {};
};

// Code-lib module (id-source)
export default (element) => ({
  next() {},
});
```
- Sibling tools coordinate purely through plain DOM `click` event bubbling on the host. Each tool listens for `click` on its host and re-syncs its highlight from `canvas.dataset.selectedTool` / `host.color`. No `CustomEvent`, no `MutationObserver` — neither is in the lint allowlist.

## Verify-on-load

The dev server has a verify-on-load Vite plugin (`src/verify-plugin.ts`) that intercepts `tools/**/*.js` requests, runs ESLint with `overlock/recommended` against the source, and either passes the file through or replies with a JS module that throws on import. `src/main.ts` fetches the source through `verify` from `@overlock/verifier` before dynamic-`import()`ing it, so failures surface the same way whether the plugin caught them first or the in-page verifier did: `loadComponentVerified` throws, the tag stays unregistered, and the page renders the rest normally. Broken tools produce no DOM — they just fail to claim a tag.

The fire-and-forget `for (const url of MANIFESTS)` loop does not await or `.catch` the returned promise, so verifier rejections become unhandled promise rejections and surface in devtools directly:

```
Uncaught (in promise) Error: /tools/bad-line/bad-line.js failed verification:
  bad-line.js:6:1  overlock/no-top-level-side-effects  Top-level `ExpressionStatement` is not allowed
  bad-line.js:6:1  overlock/no-restricted-globals  `console` is not in the allowlist
  bad-line.js:12:3  overlock/no-dynamic-code  `eval` is not allowed
  bad-line.js:12:3  overlock/no-restricted-globals  `eval` is not in the allowlist
  bad-line.js:14:11  overlock/no-computed-member  Computed member access must use a string or number literal key
  bad-line.js:16:3  overlock/no-restricted-globals  `document` is not in the allowlist
```

The demo ships a checked-in `tools/bad-line/bad-line.js` that breaks several rules at once (top-level `console.log`, `eval`, computed member access, `document` reference). On every page load `src/main.ts` asks the runtime to load it; it fails verification and nothing is placed in the DOM for it. The legal tools mount alongside.

To try a different violation, edit `tools/line/line.js` (a legal tool) and add e.g. `eval("0");` to the mount function. Reload — the Line button is gone, the other tools still work, and the verifier message is in the console. Revert to bring it back.

### Why `pnpm lint` doesn't trip on `bad-line`

`eslint.config.js` adds `tools/bad-line/**` to its `ignores`, so the CLI walks past it and CI stays green. The dev middleware constructs ESLint with `ignore: false`, so it always lints every tool source the runtime asks for — the runtime is the gatekeeper and cannot opt out, while the CLI is just a fast pre-CI shortcut.

## What this isn't yet

The verifier here runs as a Vite dev middleware, not inside the runtime itself. The end goal — described in [docs/loader-and-hmr.md](../../docs/loader-and-hmr.md) — is for the runtime to own module evaluation, walk each tool's import closure, verify and rewrite each module to call into a per-tool registry, and run the same path in production. This demo is the loose-coupled prototype that proves the verifier and the runtime agree on what a tool looks like.

## Scripts

- `pnpm dev` — Vite dev server with verify-on-load.
- `pnpm build` — production build (no verifier; run `pnpm lint` in CI).
- `pnpm lint` — ESLint CLI on `tools/**/*.js`. Same rules as the dev middleware.
- `pnpm typecheck` — `tsc --noEmit` on `src/**/*.ts`.
