import { createRuntime, type MountFn, type Runtime } from "@overlock/runtime";
import { verify } from "@overlock/verifier";

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
    loader.loadComponent = (url: string) => loadComponentVerified(runtime, new URL(url, location.href).href);
    return () => {
      loader.loadModule = undefined;
      loader.loadComponent = undefined;
    };
  });

  await loadComponentVerified(runtime, "/tools/canvas/canvas.json");
  await loadComponentVerified(runtime, "/tools/line/line.json");
  await loadComponentVerified(runtime, "/tools/rect/rect.json");
  await loadComponentVerified(runtime, "/tools/color-picker/color-picker.json");
  await loadComponentVerified(runtime, "/tools/import-demo/import-demo.json");
  await loadComponentVerified(runtime, "/tools/bad-line/bad-line.json");
}

void main();

/**
 * Fetch a manifest, fetch the referenced JS source, run the browser
 * verifier against it, then dynamic-import the same URL (browsers serve
 * the cached fetch so there's no blob URL and no duplicate network hit)
 * and register the default export under the manifest's name.
 *
 * Any failure — unreachable manifest, invalid manifest, verifier
 * rejection, import/shape mismatch — throws. Callers that care can
 * `.catch` it; callers that fire-and-forget let it become an unhandled
 * rejection, which surfaces in devtools on its own. The tool's tag in
 * the page stays unregistered and renders as nothing.
 */
async function loadComponentVerified(runtime: Runtime, manifestUrl: string): Promise<string> {
  const url = new URL(manifestUrl, location.href);
  const manifestRes = await fetch(url.href);
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch manifest ${url.href}: ${manifestRes.status} ${manifestRes.statusText}`);
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
async function loadModuleVerified(element: HTMLElement, url: string): Promise<unknown> {
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
async function fetchVerifyImportDefault(jsUrl: string): Promise<(element: HTMLElement) => unknown> {
  const srcRes = await fetch(jsUrl);
  if (!srcRes.ok) {
    throw new Error(`Failed to fetch ${jsUrl}: ${srcRes.status} ${srcRes.statusText}`);
  }
  const src = await srcRes.text();
  verify(src, jsUrl);
  const mod = (await import(/* @vite-ignore */ jsUrl)) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(`Module at ${jsUrl} does not default-export a function`);
  }
  return mod.default as (element: HTMLElement) => unknown;
}
