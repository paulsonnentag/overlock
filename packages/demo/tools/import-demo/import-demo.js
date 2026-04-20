const BADGE_URL = "/tools/import-demo/badge.json";
const IDS_URL = "/tools/import-demo/id-source.js";

export default (element) => {
  const loader = element.findClosest(
    (ancestor) => typeof ancestor.loadComponent === "function",
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

  let disposed = false;

  async function boot() {
    const ids = await loader.loadModule(IDS_URL);
    const badgeTag = await loader.loadComponent(BADGE_URL);
    if (disposed) return;
    slot.textContent = "";
    slot.style.color = "#111827";
    const tagEl = element.ownerDocument.createElement(badgeTag);
    const counter = element.ownerDocument.createElement("span");
    counter.textContent = "#" + ids.next();
    counter.style.marginLeft = "6px";
    counter.style.color = "#6b7280";
    slot.appendChild(tagEl);
    slot.appendChild(counter);
  }

  boot().catch((err) => {
    if (disposed) return;
    const message = err && err.message ? err.message : String(err);
    slot.textContent = "load failed: " + message;
    slot.style.color = "#b91c1c";
  });

  return () => {
    disposed = true;
    element.removeChild(label);
    element.removeChild(slot);
  };
};
