import overlock from "./src/plugin.js";

export default [
  {
    files: ["examples/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
    },
    plugins: {
      overlock,
    },
    rules: overlock.configs.recommended.rules,
  },
];
