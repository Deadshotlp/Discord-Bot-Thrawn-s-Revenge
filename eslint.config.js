import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "data/"]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_"
      }],
      "no-console": "off",
      "eqeqeq": ["error", "smart"],
      "prefer-const": "error"
    }
  }
];
