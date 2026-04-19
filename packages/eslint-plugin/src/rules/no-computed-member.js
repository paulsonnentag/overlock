export default {
  meta: {
    type: "problem",
    docs: {
      description: "Computed member access is only allowed with a string or number literal key.",
    },
    schema: [],
    messages: {
      forbidden:
        "Computed member access must use a string or number literal key, not `{{ kind }}`.",
    },
  },
  create(context) {
    function isLiteralKey(node) {
      if (!node) return false;
      if (node.type !== "Literal") return false;
      const v = node.value;
      return typeof v === "string" || typeof v === "number";
    }
    return {
      MemberExpression(node) {
        if (!node.computed) return;
        if (isLiteralKey(node.property)) return;
        context.report({
          node: node.property,
          messageId: "forbidden",
          data: { kind: node.property.type },
        });
      },
    };
  },
};
