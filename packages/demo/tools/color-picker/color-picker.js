const COLORS = ["#1f2937", "#dc2626", "#16a34a", "#2563eb", "#f59e0b"];
const SWATCH_SIZE = "20px";

export default function (element) {
  let host = element.parentComponent;
  while (host && !host.canvas) {
    host = host.parentComponent;
  }
  if (!host) return () => {};

  element.style.display = "inline-flex";
  element.style.gap = "4px";
  element.style.alignItems = "center";

  const swatches = [];

  function syncSelected() {
    for (const entry of swatches) {
      const active = host.color === entry.color;
      entry.button.style.outline = active ? "2px solid #1f2937" : "1px solid #ddd";
      entry.button.style.outlineOffset = active ? "2px" : "0";
    }
  }

  function makeHandler(color) {
    return function () {
      host.color = color;
      syncSelected();
    };
  }

  for (const color of COLORS) {
    const button = element.ownerDocument.createElement("button");
    button.title = color;
    button.style.width = SWATCH_SIZE;
    button.style.height = SWATCH_SIZE;
    button.style.padding = "0";
    button.style.border = "1px solid #ddd";
    button.style.borderRadius = "4px";
    button.style.background = color;
    button.style.cursor = "pointer";
    const handler = makeHandler(color);
    button.addEventListener("click", handler);
    element.appendChild(button);
    swatches.push({ color, button, handler });
  }

  function onHostClick() {
    syncSelected();
  }
  host.addEventListener("click", onHostClick);

  syncSelected();

  return () => {
    host.removeEventListener("click", onHostClick);
    for (const entry of swatches) {
      entry.button.removeEventListener("click", entry.handler);
      element.removeChild(entry.button);
    }
  };
}
