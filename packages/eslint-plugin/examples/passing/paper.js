const PAPER_INTERFACE = "paper-surface";

const DEFAULTS = {
  background: "white",
  padding: "16px",
};

function makeChild(element, tag) {
  const child = element.createChild(tag);
  child.style.background = DEFAULTS.background;
  child.style.padding = DEFAULTS.padding;
  return child;
}

export default function (root) {
  root.style.background = DEFAULTS.background;
  root.provide(PAPER_INTERFACE, { name: "paper" });
  const inner = makeChild(root, "div");
  inner.appendChild(root.createText("hello"));
  return () => {};
}
