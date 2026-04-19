export default function (root) {
  root.style.padding = "16px";
  root.style.background = "white";
  const heading = root.ownerDocument.createElement("h1");
  heading.appendChild(root.ownerDocument.createTextNode("Hello"));
  root.appendChild(heading);
  return () => {};
}
