// expect: no-meta-programming, no-restricted-globals
export default function (element) {
  Reflect.get(element, "x");
  return () => {};
}
