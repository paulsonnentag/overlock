// expect: no-prototype-access
export default function (element) {
  element.constructor.prototype.appendChild = () => {};
  return () => {};
}
