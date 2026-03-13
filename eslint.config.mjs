import { defineConfig } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";

export default defineConfig(
  {
    ignores: ["dist/", "test/*.js"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-shadow": ["error", { allow: ["err"] }],
      "handle-callback-err": "error",
      "prefer-arrow-callback": "error",
      "no-buffer-constructor": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-use-before-define": [
        "error",
        { functions: false },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "no-prototype-builtins": "off",
    },
  },
  {
    files: ["ui/**/*.ts", "ui/**/*.tsx"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["seed/*.js"],
    languageOptions: {
      parserOptions: {
        project: null,
      },
      globals: {
        declare: "readonly",
        clear: "readonly",
        commit: "readonly",
        ext: "readonly",
        log: "readonly",
        args: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-shadow": "off",
      "no-shadow": ["error", { allow: ["err", "total"] }],
    },
  },
);
