function isPureInitializer(node) {
  if (!node) return true;
  switch (node.type) {
    case "Literal":
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return true;
    case "TemplateLiteral":
      return node.expressions.length === 0;
    case "UnaryExpression":
      return isPureInitializer(node.argument);
    case "ArrayExpression":
      return node.elements.every((el) => el === null || isPureInitializer(el));
    case "ObjectExpression":
      return node.properties.every((p) => {
        if (p.type !== "Property") return false;
        if (p.computed) return false;
        return isPureInitializer(p.value);
      });
    default:
      return false;
  }
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Top-level code may only declare imports, the default export, functions, and pure const bindings.",
    },
    schema: [],
    messages: {
      forbidden: "Top-level `{{ kind }}` is not allowed; module evaluation must be side-effect-free.",
      mutableBinding: "Top-level bindings must be `const`, not `{{ kind }}`.",
      impureInitializer:
        "Top-level `const` initialisers must be literals, functions, or pure object/array literals.",
      topLevelAwait: "Top-level `await` is not allowed.",
    },
  },
  create(context) {
    return {
      Program(program) {
        for (const stmt of program.body) {
          switch (stmt.type) {
            case "ImportDeclaration":
            case "ExportDefaultDeclaration":
            case "FunctionDeclaration":
              break;
            case "VariableDeclaration":
              if (stmt.kind !== "const") {
                context.report({
                  node: stmt,
                  messageId: "mutableBinding",
                  data: { kind: stmt.kind },
                });
                break;
              }
              for (const d of stmt.declarations) {
                if (!isPureInitializer(d.init)) {
                  context.report({ node: d, messageId: "impureInitializer" });
                }
              }
              break;
            default:
              context.report({
                node: stmt,
                messageId: "forbidden",
                data: { kind: stmt.type },
              });
          }
        }
      },
    };
  },
};
