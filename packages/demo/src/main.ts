import { createRuntime } from "@overlock/runtime";

const MANIFESTS = [
  "/tools/canvas/canvas.json",
  "/tools/line/line.json",
  "/tools/rect/rect.json",
  "/tools/color-picker/color-picker.json",
  "/tools/import-demo/import-demo.json",
  "/tools/bad-line/bad-line.json",
];

async function main() {
  const app = document.getElementById("app")!;
  const runtime = createRuntime(app);

  // Root-level loader: any tool mounted under <module-root> can call
  // `loadModule(element, "./foo.js")` and `findClosest` will bubble up to
  // this component. Nested loader components can shadow it for a subtree.
  runtime.define("module-root", (element) => {
    element.loadModule = (specifier: string): Promise<unknown> =>
      import(/* @vite-ignore */ new URL(specifier, location.href).href);
    return () => {
      element.loadModule = undefined;
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
