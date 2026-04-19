export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Imports must be relative; re-exports from another module and dynamic `import()` are forbidden.",
    },
    schema: [],
    messages: {
      bareSpecifier:
        "Import source `{{ source }}` must start with `./` or `../` (no bare or absolute specifiers).",
      reexport: "Re-exports from another module are not allowed.",
      dynamic: "Dynamic `import()` is not allowed.",
    },
  },
  create(context) {
    function isRelative(source) {
      return typeof source === "string" && (source.startsWith("./") || source.startsWith("../"));
    }
    return {
      ImportDeclaration(node) {
        const source = node.source && node.source.value;
        if (!isRelative(source)) {
          context.report({
            node: node.source ?? node,
            messageId: "bareSpecifier",
            data: { source: String(source) },
          });
        }
      },
      ExportAllDeclaration(node) {
        context.report({ node, messageId: "reexport" });
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          context.report({ node, messageId: "reexport" });
        }
      },
      ImportExpression(node) {
        context.report({ node, messageId: "dynamic" });
      },
    };
  },
};
