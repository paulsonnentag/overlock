const CANVAS_W = 600;
const CANVAS_H = 400;
const DEFAULT_COLOR = "#1f2937";

export default (element) => {
  element.style.display = "inline-block";
  element.style.padding = "8px";
  element.style.background = "#f9f9f9";
  element.style.border = "1px solid #ddd";
  element.style.borderRadius = "8px";

  const canvas = element.ownerDocument.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.style.display = "block";
  canvas.style.marginTop = "8px";
  canvas.style.background = "#fff";
  canvas.style.border = "1px solid #ddd";
  canvas.style.borderRadius = "4px";
  canvas.style.cursor = "crosshair";

  element.appendChild(canvas);
  element.canvas = canvas;
  element.ctx = canvas.getContext("2d");
  element.color = DEFAULT_COLOR;

  return () => {
    element.removeChild(canvas);
    element.canvas = undefined;
    element.ctx = undefined;
    element.color = undefined;
  };
}
