import overlock from "@overlock/verifier/plugin";

export default [
  {
    ignores: ["public/tools/bad-line/**"],
  },
  {
    files: ["public/tools/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
    plugins: { overlock },
    rules: overlock.configs.recommended.rules,
  },
];
