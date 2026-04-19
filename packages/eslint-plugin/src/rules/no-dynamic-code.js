export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid every form of runtime code construction (`eval`, `Function`, `import()`, tagged templates).",
    },
    schema: [],
    messages: {
      eval: "`eval` is not allowed.",
      functionCtor: "`Function` constructor calls are not allowed.",
      importExpr: "Dynamic `import()` is not allowed.",
      taggedTemplate: "Tagged template literals are not allowed.",
    },
  },
  create(context) {
    function isFunctionCtor(callee) {
      return callee && callee.type === "Identifier" && callee.name === "Function";
    }
    return {
      Identifier(node) {
        if (node.name !== "eval") return;
        const parent = node.parent;
        if (parent && parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
          return;
        }
        if (parent && (parent.type === "Property" || parent.type === "MethodDefinition") && parent.key === node && !parent.computed) {
          return;
        }
        context.report({ node, messageId: "eval" });
      },
      NewExpression(node) {
        if (isFunctionCtor(node.callee)) {
          context.report({ node, messageId: "functionCtor" });
        }
      },
      CallExpression(node) {
        if (isFunctionCtor(node.callee)) {
          context.report({ node, messageId: "functionCtor" });
        }
      },
      ImportExpression(node) {
        context.report({ node, messageId: "importExpr" });
      },
      TaggedTemplateExpression(node) {
        context.report({ node, messageId: "taggedTemplate" });
      },
    };
  },
};
