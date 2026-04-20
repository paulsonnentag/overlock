const TOOL_NAME = "line";
const FALLBACK_COLOR = "#1f2937";
const STROKE_WIDTH = 2;

export default function (element) {
  const host = element.findClosest((a) => a.canvas);
  if (!host) return () => {};
  const canvas = host.canvas;
  const ctx = host.ctx;

  const button = element.ownerDocument.createElement("button");
  button.appendChild(element.ownerDocument.createTextNode("Line"));
  button.style.padding = "4px 12px";
  button.style.cursor = "pointer";
  button.style.border = "1px solid #ddd";
  button.style.borderRadius = "4px";
  element.appendChild(button);

  function syncSelected() {
    const active = canvas.dataset.selectedTool === TOOL_NAME;
    button.style.background = active ? "#1f2937" : "#fff";
    button.style.color = active ? "#fff" : "#1f2937";
  }
  syncSelected();

  function onSelect() {
    canvas.dataset.selectedTool = TOOL_NAME;
    syncSelected();
  }
  button.addEventListener("click", onSelect);

  function onHostClick() {
    syncSelected();
  }
  host.addEventListener("click", onHostClick);

  let drawing = false;
  let lastX = 0;
  let lastY = 0;

  function onDown(event) {
    if (event.target !== canvas) return;
    if (canvas.dataset.selectedTool !== TOOL_NAME) return;
    drawing = true;
    lastX = event.offsetX;
    lastY = event.offsetY;
    canvas.setPointerCapture(event.pointerId);
  }

  function onMove(event) {
    if (!drawing) return;
    ctx.strokeStyle = host.color || FALLBACK_COLOR;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(event.offsetX, event.offsetY);
    ctx.stroke();
    lastX = event.offsetX;
    lastY = event.offsetY;
  }

  function onUp(event) {
    if (!drawing) return;
    drawing = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);

  return () => {
    button.removeEventListener("click", onSelect);
    host.removeEventListener("click", onHostClick);
    host.removeEventListener("pointerdown", onDown);
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerup", onUp);
    host.removeEventListener("pointercancel", onUp);
    element.removeChild(button);
  };
}
