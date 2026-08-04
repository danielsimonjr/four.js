import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "docs/**",
      "**/*.tsbuildinfo",
      // Vendored from MathTS and kept byte-identical with the copy in llm-wiki, so
      // it is not ours to restyle — reformatting it here would guarantee the two
      // copies drift. It carries its own tsconfig and is verified by running it
      // (`pnpm graph`) plus QDG's unit tests (`pnpm graph:test`), not by this config.
      "tools/create-dependency-graph/**",
      "tools/query-dependency-graph/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.js", "*.mjs", "*.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message:
            "Determinism (§33): no wall clock in simulation code — inject time via TimeState.",
        },
        {
          object: "Math",
          property: "random",
          message:
            "Determinism (§33): use the seeded RNG instead of Math.random.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message: "Named exports only (plan §1 rule 7).",
        },
      ],
    },
  },
  {
    // Tooling configs (ESLint, Vite, Vitest, …) are consumed through
    // default-export contracts we do not control.
    files: [
      "eslint.config.js",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.ts",
      "**/*.config.mts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // Examples live outside every package tsconfig, so the project service
    // cannot type them; lint them without type information.
    files: ["examples/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/tests/**"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
);
