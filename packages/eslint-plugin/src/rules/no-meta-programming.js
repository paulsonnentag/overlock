const FORBIDDEN_GLOBALS = new Set([
  "Reflect",
  "Proxy",
  "WeakRef",
  "FinalizationRegistry",
  "Symbol",
]);

const FORBIDDEN_FUNCTION_MEMBERS = new Set(["call", "apply", "bind"]);

const FORBIDDEN_OBJECT_MEMBERS = new Set([
  "getPrototypeOf",
  "setPrototypeOf",
  "defineProperty",
  "defineProperties",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "getOwnPropertySymbols",
  "create",
  "assign",
  "freeze",
  "seal",
  "fromEntries",
]);

function memberName(node) {
  if (!node || node.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return null;
}

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
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid the meta-programming surface (Reflect, Proxy, classes, with, async, generators, etc.).",
    },
    schema: [],
    messages: {
      forbiddenGlobal: "`{{ name }}` is forbidden meta-programming surface.",
      functionMember: "`.{{ name }}` (function-prototype method) is not allowed on any value.",
      objectMember: "`Object.{{ name }}` is forbidden meta-programming surface.",
      withStatement: "`with` statements are not allowed.",
      classDecl: "`class` declarations are not allowed.",
      classExpr: "`class` expressions are not allowed.",
      staticBlock: "Static class blocks are not allowed.",
      argumentsId: "The `arguments` identifier is not allowed.",
      generator: "Generator functions are not allowed.",
      asyncFn: "`async` functions are not allowed.",
      awaitExpr: "`await` is not allowed.",
      yieldExpr: "`yield` is not allowed.",
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (isBindingPosition(node)) return;
        if (node.name === "arguments") {
          context.report({ node, messageId: "argumentsId" });
          return;
        }
        if (FORBIDDEN_GLOBALS.has(node.name)) {
          context.report({ node, messageId: "forbiddenGlobal", data: { name: node.name } });
        }
      },
      MemberExpression(node) {
        const name = memberName(node);
        if (!name) return;
        if (FORBIDDEN_FUNCTION_MEMBERS.has(name)) {
          context.report({ node: node.property, messageId: "functionMember", data: { name } });
          return;
        }
        if (
          FORBIDDEN_OBJECT_MEMBERS.has(name) &&
          node.object.type === "Identifier" &&
          node.object.name === "Object"
        ) {
          context.report({ node: node.property, messageId: "objectMember", data: { name } });
        }
      },
      WithStatement(node) {
        context.report({ node, messageId: "withStatement" });
      },
      ClassDeclaration(node) {
        context.report({ node, messageId: "classDecl" });
      },
      ClassExpression(node) {
        context.report({ node, messageId: "classExpr" });
      },
      StaticBlock(node) {
        context.report({ node, messageId: "staticBlock" });
      },
      "FunctionDeclaration[generator=true]"(node) {
        context.report({ node, messageId: "generator" });
      },
      "FunctionExpression[generator=true]"(node) {
        context.report({ node, messageId: "generator" });
      },
      "FunctionDeclaration[async=true]"(node) {
        context.report({ node, messageId: "asyncFn" });
      },
      "FunctionExpression[async=true]"(node) {
        context.report({ node, messageId: "asyncFn" });
      },
      "ArrowFunctionExpression[async=true]"(node) {
        context.report({ node, messageId: "asyncFn" });
      },
      AwaitExpression(node) {
        context.report({ node, messageId: "awaitExpr" });
      },
      YieldExpression(node) {
        context.report({ node, messageId: "yieldExpr" });
      },
    };
  },
};
