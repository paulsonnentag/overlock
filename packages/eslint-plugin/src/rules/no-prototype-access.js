const FORBIDDEN = new Set(["constructor", "__proto__", "prototype"]);

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Forbid access to `constructor`, `__proto__`, and `prototype` on any value.",
    },
    schema: [],
    messages: {
      forbidden: "Access to `{{ name }}` would escape the runtime proxy.",
    },
  },
  create(context) {
    function memberName(node) {
      if (!node) return null;
      if (!node.computed && node.property.type === "Identifier") {
        return node.property.name;
      }
      if (
        node.computed &&
        node.property.type === "Literal" &&
        typeof node.property.value === "string"
      ) {
        return node.property.value;
      }
      return null;
    }
    return {
      MemberExpression(node) {
        const name = memberName(node);
        if (name && FORBIDDEN.has(name)) {
          context.report({ node: node.property, messageId: "forbidden", data: { name } });
        }
      },
    };
  },
};
