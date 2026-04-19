// expect: no-computed-member
export default function (element) {
  const key = "innerHTML";
  element[key] = "<img onerror=alert(1)>";
  return () => {};
}
