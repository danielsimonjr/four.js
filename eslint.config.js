import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "docs/**",
      "**/*.tsbuildinfo",
      // Agent worktrees (already gitignored): each is a full second checkout of
      // the repository, and linting one from here means unresolvable project
      // service references and double-linting everything it contains.
      ".claude/worktrees/**",
      // Dogfooding scratch (already gitignored): throwaway consumer apps written to
      // exercise the published surface from outside — a flight sim, a two-cylinder
      // engine, the README quick-start extracted verbatim. They are deliberately
      // written the way a *user* would write them, so they neither share this
      // config's project service nor should be held to the library's own rules.
      // Without this, `bun run lint` fails on any machine that has run a dogfooding
      // pass, while CI stays green because the directory is gitignored — the exact
      // green-in-CI/broken-locally shape this repo has been fixing all day.
      ".dogfood/**",
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
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
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
