// expect: no-meta-programming
class Foo {
  static {}
}

export default function (element) {
  element.dataset.foo = String(Foo);
  return () => {};
}
