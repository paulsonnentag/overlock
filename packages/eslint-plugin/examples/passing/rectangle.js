const STROKE = "#0af";

export default function (element) {
  element.style.background = STROKE;
  element.style.border = "1px solid black";
  element.style.width = "120px";
  element.style.height = "80px";
  return () => {};
}
