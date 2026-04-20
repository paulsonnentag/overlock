import type { Linter } from "eslint";

declare const plugin: Linter.Plugin & {
  configs: {
    recommended: {
      rules: Linter.RulesRecord;
    };
  };
};

export default plugin;
