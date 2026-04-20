export default function (element) {
  const badge = element.ownerDocument.createElement("span");
  badge.textContent = "loaded via scoped import";
  badge.style.padding = "2px 8px";
  badge.style.background = "#16a34a";
  badge.style.color = "#fff";
  badge.style.borderRadius = "4px";
  badge.style.fontFamily = "ui-monospace, monospace";
  badge.style.fontSize = "11px";
  element.appendChild(badge);

  return () => {
    element.removeChild(badge);
  };
}
