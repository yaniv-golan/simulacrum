import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "artifacts/**",
      "output/**",
      "src/model/generated/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { globals: { ...globals.browser, ...globals.es2022 } },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["src/model/assembly-compiler.js"],
    rules: {
      complexity: ["error", 15],
      "max-lines-per-function": [
        "error",
        { max: 120, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["src/model/assembly-compiler-*.js"],
    rules: {
      complexity: ["error", 20],
    },
  },
  {
    files: ["src/model/challenge-lab.js", "src/model/failure-analysis.js"],
    rules: {
      complexity: ["error", 15],
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["src/presentation/component-mesh-factory.js"],
    rules: {
      complexity: ["error", 12],
      "max-lines-per-function": [
        "error",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["src/presentation/component-visual-builders/*.js"],
    rules: {
      complexity: ["error", 12],
      "max-lines-per-function": [
        "error",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: [
      "src/model/challenge-evaluators.js",
      "src/model/failure-event-extractors.js",
    ],
    rules: {
      complexity: ["error", 15],
    },
  },
  {
    files: [
      "scripts/**/*.mjs",
      "test/**/*.js",
      "examples/**/*.mjs",
      "packages/**/*.js",
      "eslint.config.js",
      "vite.config.js",
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.es2022 },
    },
  },
];
