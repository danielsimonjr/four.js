import { defineConfig } from "vitest/config";

// Cross-package suites (integration, visual, determinism) live in tests/;
// per-package unit tests are run by each package's own `vitest run`.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
