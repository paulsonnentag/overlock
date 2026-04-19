export default function (root) {
  const host = root.parentComponent;
  if (!host) return () => {};
  host.style.background = "lavender";
  host.style.outline = "2px solid red";
  const badge = root.ownerDocument.createElement("span");
  badge.appendChild(root.ownerDocument.createTextNode("*"));
  badge.style.position = "absolute";
  badge.style.top = "4px";
  badge.style.right = "4px";
  host.appendChild(badge);
  return () => {};
}
