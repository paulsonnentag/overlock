const STYLE = {
  display: "inline-flex",
  gap: "8px",
  fontFamily: "monospace",
};

function applyStyle(node, style) {
  node.style.display = style.display;
  node.style.gap = style.gap;
  node.style.fontFamily = style.fontFamily;
}

export default function (element) {
  const store = element.parentComponent;

  applyStyle(element, STYLE);

  const decrement = element.createChild("button");
  decrement.appendChild(element.createText("-"));

  const display = element.createChild("span");
  const initial = store ? store.get() : 0;
  display.appendChild(element.createText(String(initial)));

  const increment = element.createChild("button");
  increment.appendChild(element.createText("+"));

  function render(value) {
    display.textContent = String(value);
  }

  function onDec() {
    if (!store) return;
    const next = store.get() - 1;
    store.set(next);
    render(next);
  }

  function onInc() {
    if (!store) return;
    const next = store.get() + 1;
    store.set(next);
    render(next);
  }

  decrement.addEventListener("click", onDec);
  increment.addEventListener("click", onInc);

  return () => {
    decrement.removeEventListener("click", onDec);
    increment.removeEventListener("click", onInc);
  };
}
