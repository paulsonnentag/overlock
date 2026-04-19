// expect: no-restricted-imports
import _ from "lodash";

export default function (element) {
  element.value = _;
  return () => {};
}
