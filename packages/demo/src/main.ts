import { createRuntime, MountFn, Runtime } from "@overlock/runtime";
import { verify } from "@overlock/verifier";

const MANIFESTS = [
  "/tools/canvas/canvas.json",
  "/tools/line/line.json",
  "/tools/rect/rect.json",
  "/tools/color-picker/color-picker.json",
  "/tools/import-demo/import-demo.json",
  "/tools/bad-line/bad-line.json",
];

// Properties the <module-root> loader stashes on its own element for
// descendants to discover via `findClosest`. These are a local convention
// of this demo — `ComponentElement` is intentionally kept free of
// loader-flavored slots so the runtime doesn't grow an opinion about what
// ad-hoc surface components are allowed to expose.
type ModuleRootLoader = {
  loadModule(url: string): Promise<unknown>;
  loadComponent(url: string): Promise<string>;
};

type Manifest = { name: string; url: string };

async function main() {
  const app = document.getElementById("app")!;
  const runtime = createRuntime(app);

  // <module-root> is defined inline here — no verification, no manifest —
  // because it's part of the page's own code, not a loaded tool. It stashes
  // `loadModule`/`loadComponent` on itself so descendants can walk up with
  // `findClosest` and bootstrap more code or components off of it.
  runtime.define("module-root", (element) => {
    const loader = element as typeof element & Partial<ModuleRootLoader>;
    loader.loadModule = (url: string) => loadModuleVerified(element, url);
    loader.loadComponent = (url: string) =>
      loadComponentVerified(runtime, new URL(url, location.href).href);
    return () => {
      loader.loadModule = undefined;
      loader.loadComponent = undefined;
    };
  });

  const results = await Promise.allSettled(
    MANIFESTS.map((url) => loadComponentVerified(runtime, url)),
  );
  (window as unknown as { runtime: typeof runtime }).runtime = runtime;

  const rejections = collectRejections(results);
  if (rejections.length > 0) {
    app.appendChild(renderRejectionBox(rejections));
  }
}

main().catch((err) => {
  const app = document.getElementById("app")!;
  const pre = document.createElement("pre");
  pre.style.color = "#b91c1c";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = String(err && err.message ? err.message : err);
  app.appendChild(pre);
  console.error(err);
});

/**
 * Fetch a manifest, fetch the referenced JS source, run the browser
 * verifier against it, then dynamic-import the same URL (browsers serve
 * the cached fetch so there's no blob URL and no duplicate network hit)
 * and register the default export under the manifest's name.
 */
async function loadComponentVerified(
  runtime: Runtime,
  manifestUrl: string,
): Promise<string> {
  const url = new URL(manifestUrl, location.href);
  const manifestRes = await fetch(url.href);
  if (!manifestRes.ok) {
    throw new Error(
      `Failed to fetch manifest ${url.href}: ${manifestRes.status} ${manifestRes.statusText}`,
    );
  }
  const manifest = (await manifestRes.json()) as Manifest;
  if (!manifest.name || !manifest.url) {
    throw new Error(`Invalid manifest at ${url.href}: missing "name" or "url"`);
  }

  const jsUrl = new URL(manifest.url, url).href;
  const fn = await fetchVerifyImportDefault(jsUrl);
  runtime.define(manifest.name, fn as MountFn);
  return manifest.name;
}

/**
 * Fetch a code-library JS URL, verify its source, dynamic-import it, and
 * call the default export once with the loader element. Returns whatever
 * the module produced (typically an object of helpers).
 */
async function loadModuleVerified(
  element: HTMLElement,
  url: string,
): Promise<unknown> {
  const jsUrl = new URL(url, location.href).href;
  const fn = await fetchVerifyImportDefault(jsUrl);
  return fn(element);
}

/**
 * Shared fetch-then-verify-then-import used by both loaders. The dynamic
 * `import()` reuses the same URL as the fetch so the browser serves the
 * just-validated source from its HTTP cache instead of making a second
 * request or us resorting to blob URLs. Returns the module's default
 * export, asserting it is a function — both component mount fns and code
 * libraries are single-function modules in this convention.
 */
async function fetchVerifyImportDefault(
  jsUrl: string,
): Promise<(element: HTMLElement) => unknown> {
  const srcRes = await fetch(jsUrl);
  if (!srcRes.ok) {
    throw new Error(
      `Failed to fetch ${jsUrl}: ${srcRes.status} ${srcRes.statusText}`,
    );
  }
  const src = await srcRes.text();
  verify(src, jsUrl);
  const mod = (await import(/* @vite-ignore */ jsUrl)) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(`Module at ${jsUrl} does not default-export a function`);
  }
  return mod.default as (element: HTMLElement) => unknown;
}

type Rejection = { manifest: string; reason: unknown };

function collectRejections(
  results: PromiseSettledResult<string>[],
): Rejection[] {
  const rejections: Rejection[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "rejected") {
      rejections.push({ manifest: MANIFESTS[i], reason: r.reason });
    }
  }
  return rejections;
}

function renderRejectionBox(rejections: Rejection[]): HTMLElement {
  const box = document.createElement("div");
  box.style.padding = "12px";
  box.style.background = "#fef2f2";
  box.style.border = "1px solid #fecaca";
  box.style.borderRadius = "8px";
  box.style.color = "#991b1b";
  box.style.fontFamily = "ui-monospace, SFMono-Regular, monospace";
  box.style.whiteSpace = "pre-wrap";

  const heading = document.createElement("strong");
  heading.textContent = `Verifier rejected ${rejections.length} tool${rejections.length > 1 ? "s" : ""}:`;
  box.appendChild(heading);

  for (const { manifest, reason } of rejections) {
    const pre = document.createElement("pre");
    pre.style.margin = "8px 0 0 0";
    pre.style.whiteSpace = "pre-wrap";
    const message =
      reason && typeof reason === "object" && "message" in reason
        ? (reason as Error).message
        : String(reason);
    pre.textContent = `(${manifest})\n${message}`;
    box.appendChild(pre);
  }
  return box;
}
