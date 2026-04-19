// expect: no-dynamic-code, no-restricted-globals
export default function (element) {
  eval("element.innerHTML = '<img onerror=alert(1)>'");
  return () => {};
}
