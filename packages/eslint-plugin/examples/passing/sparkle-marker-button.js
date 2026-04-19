const LABEL = "sparkle";

export default function (element) {
  const palette = element.parentComponent;

  const button = element.createChild("button");
  button.style.padding = "4px 8px";
  button.style.background = "#222";
  button.style.color = "white";
  button.appendChild(element.createText(LABEL));

  function activate() {
    if (palette) palette.select(LABEL);
  }

  button.addEventListener("click", activate);
  return () => {
    button.removeEventListener("click", activate);
  };
}
