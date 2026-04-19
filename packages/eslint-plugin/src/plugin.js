import toolShape from "./rules/tool-shape.js";
import noRestrictedGlobals from "./rules/no-restricted-globals.js";
import noRestrictedImports from "./rules/no-restricted-imports.js";
import noTopLevelSideEffects from "./rules/no-top-level-side-effects.js";
import noDynamicCode from "./rules/no-dynamic-code.js";
import noComputedMember from "./rules/no-computed-member.js";
import noPrototypeAccess from "./rules/no-prototype-access.js";
import noMetaProgramming from "./rules/no-meta-programming.js";

const rules = {
  "tool-shape": toolShape,
  "no-restricted-globals": noRestrictedGlobals,
  "no-restricted-imports": noRestrictedImports,
  "no-top-level-side-effects": noTopLevelSideEffects,
  "no-dynamic-code": noDynamicCode,
  "no-computed-member": noComputedMember,
  "no-prototype-access": noPrototypeAccess,
  "no-meta-programming": noMetaProgramming,
};

const recommendedRules = Object.fromEntries(
  Object.keys(rules).map((id) => [`overlock/${id}`, "error"]),
);

const plugin = {
  meta: { name: "overlock", version: "0.1.0" },
  rules,
  configs: {
    recommended: {
      rules: recommendedRules,
    },
  },
};

export default plugin;
