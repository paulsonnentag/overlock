export default {
  meta: {
    type: "problem",
    docs: { description: "Enforce the tool-component file shape." },
    schema: [],
    messages: {
      missing: "Tool file must have an `export default function` declaration.",
      multipleDefault: "Tool file may have only one default export.",
      otherExport: "Tool file may not have any exports other than the default export.",
      notFunction: "Default export must be a function (declaration, expression, or arrow).",
      noParam: "Tool function must accept exactly one parameter (the host element).",
      tooManyParams: "Tool function must accept exactly one parameter (the host element).",
      destructured: "Tool function parameter must be a plain identifier, not a destructuring pattern.",
      rest: "Tool function parameter must not be a rest parameter.",
      defaultValue: "Tool function parameter must not have a default value.",
      generator: "Tool function may not be a generator.",
      asyncFn: "Tool function may not be async.",
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
