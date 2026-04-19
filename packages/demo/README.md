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
<paint-canvas>
  <div class="toolbar">
    <line-tool></line-tool>
    <rect-tool></rect-tool>
    <color-picker></color-picker>
  </div>
</paint-canvas>
```

- `<paint-canvas>` creates a real `<canvas>` element, then exposes `element.canvas`, `element.ctx`, and `element.color` (defaulting to `#1f2937`) on its own host element. It is the parent component for everything else.
- `<line-tool>` and `<rect-tool>` walk up via `element.parentComponent` until they find a host that has a `canvas` property. Each one renders a button. On click they set `canvas.dataset.selectedTool` to their name; while drawing they read that data attribute to decide whether the gesture is theirs, and read `host.color` to pick the stroke colour. They register pointer events on the host (not on the canvas), and filter to events whose target is the canvas.
- `<color-picker>` does the same `parentComponent` walk and renders a row of colour swatches. Clicking a swatch writes `host.color`; the line and rectangle tools read it on the next gesture.
- Sibling tools coordinate purely through plain DOM `click` event bubbling on the host. Each tool listens for `click` on its host and re-syncs its highlight from `canvas.dataset.selectedTool` / `host.color`. No `CustomEvent`, no `MutationObserver` — neither is in the lint allowlist.

## Verify-on-load

The dev server has a verify-on-load Vite plugin (`verify-plugin.ts`) that intercepts `tools/**/*.js` requests, runs ESLint with `overlock/recommended` against the source, and either passes the file through or replies with a JS module that throws on import. The dynamic `import()` inside `runtime.loadComponent` then rejects, and the failure surfaces as a red box in `#app` while the other tools still mount.

The demo ships a checked-in `tools/bad-line/bad-line.js` that breaks several rules at once (top-level `console.log`, `eval`, computed member access, `document` reference). On every page load `main.ts` asks the runtime to load it, and you should see the verifier rejecting it in the red box on the page. The legal tools mount alongside.

```
Verifier rejected 1 tool:
(/tools/bad-line/bad-line.json)
[overlock verify] /tools/bad-line/bad-line.js failed verification:
  bad-line.js:5:1  overlock/no-restricted-globals  `console` is not in the allowlist of permitted free identifiers
  bad-line.js:5:1  overlock/no-top-level-side-effects  Top-level `ExpressionStatement` is not allowed
  bad-line.js:11:3  overlock/no-restricted-globals  `eval` is not in the allowlist
  bad-line.js:11:3  overlock/no-dynamic-code  `eval` is not allowed
  bad-line.js:13:3  overlock/no-computed-member  Computed member access must use a string or number literal key
  bad-line.js:15:3  overlock/no-restricted-globals  `document` is not in the allowlist
```

To try a different violation, edit `tools/line/line.js` (a legal tool) and add e.g. `eval("0");` to the mount function. Reload — the line tool joins the rejected list while the rest of the page keeps working. Revert to bring it back.

### Why `pnpm lint` doesn't trip on `bad-line`

`eslint.config.js` adds `tools/bad-line/**` to its `ignores`, so the CLI walks past it and CI stays green. The dev middleware constructs ESLint with `ignore: false`, so it always lints every tool source the runtime asks for — the runtime is the gatekeeper and cannot opt out, while the CLI is just a fast pre-CI shortcut.

## What this isn't yet

The verifier here runs as a Vite dev middleware, not inside the runtime itself. The end goal — described in [docs/loader-and-hmr.md](../../docs/loader-and-hmr.md) — is for the runtime to own module evaluation, walk each tool's import closure, verify and rewrite each module to call into a per-tool registry, and run the same path in production. This demo is the loose-coupled prototype that proves the verifier and the runtime agree on what a tool looks like.

## Scripts

- `pnpm dev` — Vite dev server with verify-on-load.
- `pnpm build` — production build (no verifier; run `pnpm lint` in CI).
- `pnpm lint` — ESLint CLI on `tools/**/*.js`. Same rules as the dev middleware.
- `pnpm typecheck` — `tsc --noEmit` on `main.ts` and `verify-plugin.ts`.
