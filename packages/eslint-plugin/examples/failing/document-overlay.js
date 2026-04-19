// expect: no-restricted-globals
export default function (element) {
  document.body.append(element);
  return () => {};
}
