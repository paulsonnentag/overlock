const BADGE_MODULE_URL = "/tools/import-demo/badge.js";

export default function (element) {
  const loader = element.findClosest(
    (ancestor) => typeof ancestor.loadModule === "function",
  );

  element.style.display = "inline-flex";
  element.style.alignItems = "center";
  element.style.gap = "6px";
  element.style.fontSize = "12px";

  const label = element.ownerDocument.createElement("span");
  label.textContent = "lazy:";
  label.style.color = "#6b7280";
  element.appendChild(label);

  const slot = element.ownerDocument.createElement("span");
  slot.textContent = "loading...";
  slot.style.color = "#6b7280";
  element.appendChild(slot);

  if (!loader) {
    slot.textContent = "no loader in scope";
    slot.style.color = "#b91c1c";
    return () => {
      element.removeChild(label);
      element.removeChild(slot);
    };
  }

  let cleanupMounted = null;
  let disposed = false;

  function onLoaded(mod) {
    if (disposed) return;
    slot.textContent = "";
    const result = mod.default(slot);
    cleanupMounted = typeof result === "function" ? result : null;
  }

  function onFailed(err) {
    if (disposed) return;
    const message = err && err.message ? err.message : String(err);
    slot.textContent = "load failed: " + message;
    slot.style.color = "#b91c1c";
  }

  loader.loadModule(BADGE_MODULE_URL).then(onLoaded, onFailed);

  return () => {
    disposed = true;
    if (cleanupMounted) cleanupMounted();
    element.removeChild(label);
    element.removeChild(slot);
  };
}
