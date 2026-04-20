import { createRuntime } from "@overlock/runtime";

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

async function main() {
  const app = document.getElementById("app")!;
  const runtime = createRuntime(app);

  // Any tool mounted under <module-root> can walk up with
  // `element.findClosest(a => typeof a.loadComponent === "function")` and
  // bootstrap more code or components off of it. Nested loader components
  // can shadow this one for a subtree.
  //
  // `loadModule(url)` takes a JS URL — it dynamic-imports the file and
  // *calls* its default export once with this loader's own element,
  // returning whatever came back (typically an object for code libs).
  //
  // `loadComponent(manifestUrl)` takes a *manifest* URL and hands it to
  // the runtime, which fetches the JSON, imports the referenced JS file,
  // registers its default export as a mount fn under the manifest's name,
  // and returns the final tag name.
  runtime.define("module-root", (element) => {
    const loader = element as typeof element & Partial<ModuleRootLoader>;
    loader.loadModule = async (url: string) => {
      const mod = await import(
        /* @vite-ignore */ new URL(url, location.href).href
      );
      if (typeof mod.default !== "function") {
        throw new Error(`Module at ${url} does not default-export a function`);
      }
      return mod.default(element);
    };
    loader.loadComponent = (url: string) =>
      runtime.loadComponent(new URL(url, location.href).href);
    return () => {
      loader.loadModule = undefined;
      loader.loadComponent = undefined;
    };
  });

  const results = await Promise.allSettled(
    MANIFESTS.map((url) => runtime.loadComponent(url)),
  );
  (window as unknown as { runtime: typeof runtime }).runtime = runtime;

  const rejections = results
    .map((r, i) => ({ r, manifest: MANIFESTS[i] }))
    .filter(
      (entry): entry is { r: PromiseRejectedResult; manifest: string } =>
        entry.r.status === "rejected",
    );
  if (rejections.length === 0) return;

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

  for (const { r, manifest } of rejections) {
    const pre = document.createElement("pre");
    pre.style.margin = "8px 0 0 0";
    pre.style.whiteSpace = "pre-wrap";
    const reason = r.reason as Error | string | undefined;
    const message =
      reason && typeof reason === "object" && "message" in reason
        ? (reason as Error).message
        : String(reason);
    pre.textContent = `(${manifest})\n${message}`;
    box.appendChild(pre);
  }
  app.appendChild(box);
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
