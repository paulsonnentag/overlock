const PALETTE = ["#ff5", "#5ff", "#f5f", "#5f5"];

function pickColor(seed) {
  const i = (seed * 9301 + 49297) % PALETTE.length;
  return PALETTE.at(i);
}

export default function (element) {
  const surface = element.parentComponent;
  if (!surface) return () => {};

  const canvas = element.createChild("canvas");
  canvas.style.position = "absolute";
  canvas.style.pointerEvents = "none";

  const ctx = canvas.getContext("2d");

  function onMove(event) {
    const x = event.clientX;
    const y = event.clientY;
    ctx.fillStyle = pickColor(x + y);
    ctx.fillRect(x, y, 4, 4);
  }

  surface.addEventListener("pointermove", onMove);
  return () => {
    surface.removeEventListener("pointermove", onMove);
  };
}
