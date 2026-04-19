# Overlock sandbox rules

A specification for **tool components** — small JavaScript modules supplied by potentially untrusted authors and mounted into a host page. Two artifacts work together to keep them safe:

- A **runtime** that hands every tool a Proxy-wrapped element. Every DOM mutation the tool performs is attributed to the tool's identity and reversed when the tool unmounts. Conflicts between tools are resolved peer-to-peer.
- This **lint**, which pins the source to a JavaScript subset in which the proxy's identity tracking cannot be bypassed by reflection or dynamic code.

The runtime is described in a separate package; this document specifies what the lint enforces and why.

## The runtime model (one-page summary)

A tool component is:

```js
export default function (element) {
  // mutate `element`, register listeners, read element.parentComponent, ...
  return () => { /* optional cleanup */ };
}
```

`element` is not a raw DOM node. It is a Proxy whose handler holds the tool's identity. The handler:

- **Attributes every write** — `element.style.color = "red"`, `element.appendChild(child)`, `element.setAttribute(...)`. The runtime records the previous value so it can be restored when the tool unmounts.
- **Filters every read of a DOM node** — `element.parentElement`, `element.children[0]`, `event.target` come back as Proxies bound to the same tool identity, never as raw nodes. There is no `unwrap` operation. The proxy is the only handle.
- **Reconciles conflicts peer-to-peer**: when two tools touch the same property the last writer wins, and the runtime knows the previous value belonged to the other tool, so the rollback chain stays consistent.

`element.parentComponent` returns the same kind of identity-bound Proxy over the nearest ancestor that is itself a registered component (plain DOM ancestors are skipped), or `null` at the root. The tool calls standard DOM methods on it (`addEventListener`, `style`, `appendChild`) plus whatever methods the parent component has assigned on itself; the proxy attributes the writes the same way.

The contract is therefore: **whatever a tool can syntactically express, the runtime either attributes correctly or throws.** There is no per-API whitelist.

## Why the lint exists

The runtime guarantee — "the proxy is the only handle" — only holds if the tool's source cannot:

- Reach a real (un-proxied) DOM node by reflection or prototype probing.
- Build code at runtime that the runtime never sees at install time.
- Resolve property names the linter cannot see.
- Reach hostile globals.
- Run code at module load (before the proxy is even created).
- Hide behaviour inside language constructs the lint is not equipped to analyse.

The lint forbids all of these syntactically. Eight rules, all hard errors, no autofixes.

## JS subset

| Forbidden construct | Rule | Why the runtime needs this |
| --- | --- | --- |
| Two top-level exports, named exports, non-function default export, destructured / rest / default-value parameter, async/generator default | `tool-shape` | The mount function is the only entry point; the runtime calls it with one argument (the proxy) and expects a plain function back as the cleanup. |
| Free identifier not in `Math, JSON, Number, String, Boolean, Array, Object, Error, TypeError, RangeError, SyntaxError, Promise, Infinity, NaN, undefined` | `no-restricted-globals` | `document`, `window`, `globalThis`, `Reflect`, `Proxy`, `setTimeout`, `fetch`, `console`, … all reach un-proxied state. |
| `import` source not starting with `./` or `../`, `export … from`, `import(expr)` | `no-restricted-imports` | The dependency graph has to be locally inspectable; the runtime loader resolves only relative paths. |
| Top-level `let`/`var`, expression statements, calls, top-level `await` | `no-top-level-side-effects` | Module evaluation runs before the proxy exists; nothing observable may happen at that point. |
| `eval`, `new Function(...)`, `Function(...)`, `import(expr)`, tagged templates | `no-dynamic-code` | Code constructed at runtime can name properties the lint can't see. |
| `obj[expr]` where `expr` is not a string/number `Literal` | `no-computed-member` | A computed property name is opaque to every other rule; it can spell `__proto__`, `constructor`, `call`, … |
| `.constructor`, `.__proto__`, `.prototype` | `no-prototype-access` | All three escape the proxy: the prototype of a proxy-wrapped value still points to the real DOM prototype. |
| `Reflect`, `Proxy`, `WeakRef`, `FinalizationRegistry`, `Symbol`, `.call`/`.apply`/`.bind`, `Object.{getPrototypeOf,setPrototypeOf,defineProperty,defineProperties,getOwnPropertyDescriptor,getOwnPropertyDescriptors,getOwnPropertyNames,getOwnPropertySymbols,create,assign,freeze,seal,fromEntries}`, `with`, `class`, static blocks, `arguments`, generator/async functions, `await`, `yield` | `no-meta-programming` | Each construct either probes the un-proxied target, escapes identity tracking, or produces a control-flow shape the runtime has not been built to attribute. |

Allowed identifier reads at module scope: `Math, JSON, Number, String, Boolean, Array, Object, Error, TypeError, RangeError, SyntaxError, Promise, Infinity, NaN, undefined`.

## Rule catalogue

All rules emit hard errors. None autofix. None requires cross-file analysis or type information.

1. **`tool-shape`** — exactly one `ExportDefaultDeclaration` whose declaration is a `FunctionDeclaration`, `FunctionExpression`, or `ArrowFunctionExpression` with one non-destructured, non-rest, non-default-valued parameter. No other top-level exports. The function may not be async or a generator. The optional return value is the runtime's cleanup callback; the lint does not constrain its shape.
2. **`no-restricted-globals`** — every free identifier reference is checked. Allowed: `Math, JSON, Number, String, Boolean, Array, Object, Error, TypeError, RangeError, SyntaxError, Promise, Infinity, NaN, undefined`. Anything else is reported.
3. **`no-restricted-imports`** — `ImportDeclaration` source must start with `./` or `../`. `ExportAllDeclaration`, `ExportNamedDeclaration` with a `source`, and `ImportExpression` are reported.
4. **`no-top-level-side-effects`** — top level may contain only `ImportDeclaration`, `ExportDefaultDeclaration` (the function), `FunctionDeclaration`, and `VariableDeclaration` of kind `const` whose initialiser is a literal, template literal with no expressions, arrow, function expression, unary on a literal, or pure object/array of pure values. No `let`, no `var`, no expression statements, no top-level `await`.
5. **`no-dynamic-code`** — `eval` reference, `new Function(...)`, bare `Function(...)` call, `ImportExpression`, `TaggedTemplateExpression`.
6. **`no-computed-member`** — `MemberExpression` with `computed: true` whose property is not a string or number `Literal`.
7. **`no-prototype-access`** — `MemberExpression` whose static property name is `constructor`, `__proto__`, or `prototype`.
8. **`no-meta-programming`** — `Reflect`, `Proxy`, `WeakRef`, `FinalizationRegistry`, `Symbol` references; `.call`, `.apply`, `.bind` member access on any value; the listed `Object.*` meta methods; `WithStatement`; `ClassDeclaration` / `ClassExpression`; static blocks; `arguments` identifier; generator functions; `async` functions; `AwaitExpression`; `YieldExpression`.

## Worked rejections

### `tool-shape`

```js
export const helper = () => {};       // FAIL: extra top-level export
export default function ({ tag }) {}  // FAIL: destructured parameter
```

The runtime mounts exactly one default export and passes exactly one proxy. Anything else is unreachable from the runtime's perspective and would have to mean something the runtime has not agreed to.

### `no-restricted-globals`

```js
export default function (element) {
  document.body.append(element); // FAIL: `document` is a forbidden global
}
```

`document` is the un-proxied root of the page; reaching it bypasses every attribution.

### `no-restricted-imports`

```js
import _ from "lodash"; // FAIL: bare specifier
```

The runtime loader only resolves relative paths inside the tool package.

### `no-top-level-side-effects`

```js
console.log("init"); // FAIL: top-level expression statement (and forbidden global)
export default function (element) {}
```

Module evaluation happens before the runtime has produced the proxy, so any side effect at that point necessarily targets un-proxied state.

### `no-dynamic-code`

```js
const tag = (s) => s.raw[0];
export default function (element) {
  tag`alert(${1})`; // FAIL: tagged template
}
```

Tagged templates hand the literal pieces to a function as raw strings — the same primitive `eval` would need to assemble code the lint cannot see.

### `no-computed-member`

```js
export default function (element) {
  const key = "innerHTML";
  element[key] = "<img onerror=alert(1)>"; // FAIL: computed access with non-literal key
}
```

A computed key with a non-literal name defeats every other property-name rule (`no-prototype-access`, `no-meta-programming`).

### `no-prototype-access`

```js
export default function (element) {
  element.constructor.prototype.appendChild = () => {}; // FAIL: constructor + prototype
}
```

The prototype of a proxy-wrapped DOM node is still the real DOM prototype; mutating it leaks past every attribution.

### `no-meta-programming`

```js
export default function (element) {
  Reflect.get(element, "x"); // FAIL: Reflect (and no-restricted-globals)
}
```

`Reflect.get` invokes the proxy's `[[Get]]` trap with a private receiver; combined with `Object.getOwnPropertyDescriptor` it can extract the un-proxied target. The only safe answer is to forbid the identifier.

```js
class Foo { static {} } // FAIL: class + static block
export default function (element) {}
```

Classes carry a `prototype` and `constructor` link the lint cannot reason about cheaply, and static blocks run at evaluation time.

## Out of scope

- The runtime itself (Proxy implementation, identity propagation, reconciliation, MutationObserver-based recovery).
- Cross-file analysis. Each file is linted independently; `no-restricted-imports` keeps the dependency graph trivial.
- TypeScript anywhere. The source under analysis is JS by design (types can lie about runtime shape); the rule code is JS for the same reason ESLint plugins typically are.
- Pseudo-class styling, `cssText`, `innerHTML` setters, `style.setProperty(prop, val, "important")`. These are runtime concerns; the proxy decides whether to attribute or throw.
