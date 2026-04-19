const ALLOWED = new Set([
  "Math",
  "JSON",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "Promise",
  "Infinity",
  "NaN",
  "undefined",
]);

function isBindingPosition(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
    return true;
  }
  if (
    (parent.type === "Property" || parent.type === "MethodDefinition") &&
    parent.key === node &&
    !parent.computed
  ) {
    return true;
  }
  if (
    (parent.type === "VariableDeclarator" ||
      parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ClassDeclaration" ||
      parent.type === "ClassExpression") &&
    parent.id === node
  ) {
    return true;
  }
  if (
    (parent.type === "ImportSpecifier" ||
      parent.type === "ImportDefaultSpecifier" ||
      parent.type === "ImportNamespaceSpecifier") &&
    parent.local === node
  ) {
    return true;
  }
  if (parent.type === "ExportSpecifier") return true;
  if (
    (parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ArrowFunctionExpression") &&
    parent.params.includes(node)
  ) {
    return true;
  }
  if (parent.type === "CatchClause" && parent.param === node) return true;
  if (parent.type === "LabeledStatement" && parent.label === node) return true;
  if (parent.type === "BreakStatement" && parent.label === node) return true;
  if (parent.type === "ContinueStatement" && parent.label === node) return true;
  if (parent.type === "ArrayPattern" || parent.type === "ObjectPattern") return true;
  if (parent.type === "RestElement" && parent.argument === node) return true;
  if (parent.type === "AssignmentPattern" && parent.left === node) return true;
  if (parent.type === "Property" && parent.value === node) {
    const grand = parent.parent;
    if (grand && grand.type === "ObjectPattern") return true;
  }
  return false;
}

function isLocallyBound(scope, name) {
  let current = scope;
  while (current) {
    if (current.type === "global") return false;
    for (const v of current.variables) {
      if (v.name === name) return true;
    }
    current = current.upper;
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Only the documented identifier allowlist may be referenced as a free name.",
    },
    schema: [],
    messages: {
      forbidden: "`{{ name }}` is not in the allowlist of permitted free identifiers.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Identifier(node) {
        if (isBindingPosition(node)) return;
        if (ALLOWED.has(node.name)) return;
        const scope = sourceCode.getScope
          ? sourceCode.getScope(node)
          : context.getScope();
        if (isLocallyBound(scope, node.name)) return;
        context.report({ node, messageId: "forbidden", data: { name: node.name } });
      },
    };
  },
};
