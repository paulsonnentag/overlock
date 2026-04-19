// expect: no-top-level-side-effects, no-restricted-globals
console.log("init");

export default function (element) {
  return () => {};
}
