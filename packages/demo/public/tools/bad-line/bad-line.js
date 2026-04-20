// This tool is intentionally illegal. Every line below breaks one of the
// rules in `overlock/recommended`; the verify-on-load middleware in the
// dev server returns a throwing module instead of this source so the
// runtime's `loadComponent` Promise rejects fail-closed.

console.log("bad-line: top-level side effect"); // no-top-level-side-effects + no-restricted-globals

const ACCESSOR = "innerHTML";

export default function (element) {
  const code = "element.style.background = 'red'";
  eval(code); // no-dynamic-code + no-restricted-globals

  element[ACCESSOR] = "<button>Bad Line</button>"; // no-computed-member

  document.body.appendChild(element); // no-restricted-globals (document)

  return () => {};
}
