export default {
  meta: {
    type: "problem",
    docs: { description: "Enforce the module default-export shape." },
    schema: [],
    messages: {
      missing: "Module file must have an `export default function` declaration.",
      multipleDefault: "Module file may have only one default export.",
      otherExport: "Module file may not have any exports other than the default export.",
      notFunction: "Default export must be a function (declaration, expression, or arrow).",
      noParam: "Default export must accept exactly one parameter (the element).",
      tooManyParams: "Default export must accept exactly one parameter (the element).",
      destructured: "Default-export parameter must be a plain identifier, not a destructuring pattern.",
      rest: "Default-export parameter must not be a rest parameter.",
      defaultValue: "Default-export parameter must not have a default value.",
      generator: "Default export may not be a generator.",
      asyncFn: "Default export may not be async.",
    },
  },
  create(context) {
    return {
      Program(program) {
        const defaults = program.body.filter((s) => s.type === "ExportDefaultDeclaration");
        const others = program.body.filter(
          (s) => s.type === "ExportNamedDeclaration" || s.type === "ExportAllDeclaration",
        );
        for (const o of others) {
          context.report({ node: o, messageId: "otherExport" });
        }
        if (defaults.length === 0) {
          context.report({ node: program, messageId: "missing" });
          return;
        }
        for (const d of defaults.slice(1)) {
          context.report({ node: d, messageId: "multipleDefault" });
        }
        const fn = defaults[0].declaration;
        if (
          !fn ||
          (fn.type !== "FunctionDeclaration" &&
            fn.type !== "FunctionExpression" &&
            fn.type !== "ArrowFunctionExpression")
        ) {
          context.report({ node: defaults[0], messageId: "notFunction" });
          return;
        }
        if (fn.generator) context.report({ node: fn, messageId: "generator" });
        if (fn.async) context.report({ node: fn, messageId: "asyncFn" });
        if (fn.params.length === 0) {
          context.report({ node: fn, messageId: "noParam" });
          return;
        }
        if (fn.params.length > 1) {
          context.report({ node: fn.params[1], messageId: "tooManyParams" });
        }
        const p = fn.params[0];
        if (p.type === "RestElement") {
          context.report({ node: p, messageId: "rest" });
        } else if (p.type === "AssignmentPattern") {
          context.report({ node: p, messageId: "defaultValue" });
        } else if (p.type !== "Identifier") {
          context.report({ node: p, messageId: "destructured" });
        }
      },
    };
  },
};
