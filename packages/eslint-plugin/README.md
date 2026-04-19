# overlock

ESLint plugin that pins **tool components** to the JavaScript subset required by the Overlock attribution-proxy runtime. The runtime hands every tool a Proxy-wrapped element and reverses each mutation when the tool unmounts; this lint forbids the metaprogramming and reflection paths that would let untrusted code reach around the proxy.

See [RULES.md](./RULES.md) for the runtime model, the JS subset, and the rule catalogue.

## Quick start

From the monorepo root:

```sh
pnpm install
pnpm --filter overlock test
```

The test suite runs ESLint against the components in `examples/passing/` (which must lint clean) and `examples/failing/` (each prefixed with an `// expect: rule-id, ...` comment listing the rules that must fire).

## Using the plugin

```js
// eslint.config.js
import overlock from "overlock";

export default [
  {
    files: ["src/tools/**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    plugins: { overlock },
    rules: overlock.configs.recommended.rules,
  },
];
```

The `recommended` config turns all eight rules on as errors:

- `overlock/tool-shape`
- `overlock/no-restricted-globals`
- `overlock/no-restricted-imports`
- `overlock/no-top-level-side-effects`
- `overlock/no-dynamic-code`
- `overlock/no-computed-member`
- `overlock/no-prototype-access`
- `overlock/no-meta-programming`
