import overlock from "overlock";

export default [
  {
    ignores: ["tools/bad-line/**"],
  },
  {
    files: ["tools/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
    plugins: { overlock },
    rules: overlock.configs.recommended.rules,
  },
];
