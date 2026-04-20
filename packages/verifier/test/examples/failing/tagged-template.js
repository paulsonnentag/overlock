// expect: no-dynamic-code
const tag = (s) => s.raw[0];

export default function (element) {
  tag`hello ${element}`;
  return () => {};
}
