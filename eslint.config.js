import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "data/", "addons/"]
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
  },
  {
    // Das Dashboard läuft ohne Build-Schritt direkt im Browser.
    files: ["web/public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  }
];
