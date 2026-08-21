import { defineConfig } from "vitest/config";

// Shared coverage gate for the per-package unit suites.
//
// This config is never used by `pnpm run test`: the per-package `test` scripts
// keep running plain `vitest run --passWithNoTests`, so the normal path pays no
// instrumentation cost. The root `coverage` script runs each `packages/*`
// package against this file instead — every package sits at the same depth, so
// the relative path `../../vitest.coverage.config.ts` is uniform, and Vitest's
// project root stays the package directory the command was executed in.
//
// The `include` glob is therefore package-relative: `src/**/*.ts` is the
// package's own source. `coverage.all` (Vitest's default) keeps files that no
// test ever imports in the denominator, so a package cannot pass by shipping
// untested modules.
export default defineConfig({
  test: {
    passWithNoTests: true,
    // Instrumented runs are far slower than plain ones, and the default 5 s
    // timeout does not account for it. Measured 2026-08-21 on the >65 536-vertex
    // index-widening test in packages/render:
    //
    //     plain           242 ms
    //     with coverage  3222 ms   (13x)
    //     on CI          5590 ms   -> exceeded the 5 s default, red build
    //
    // The test was not flaky and not slow: it was systematically near the limit
    // once instrumented, and the CI runner is slower than a workstation, so it
    // crossed there and passed here. Raising the timeout for THIS config only is
    // the fix -- the plain `test` scripts keep the 5 s default, so a genuine
    // performance regression on the normal path still fails fast. This is a
    // timeout, not a budget: a hung test still fails, it just takes longer.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Text only. Vitest's default reporter set also writes `html`, `clover`,
      // and `json` into `packages/*/coverage/`; that directory is gitignored but
      // NOT ignored by `eslint.config.js`, so the generated `block-navigation.js`
      // and friends turn `pnpm run lint` red after any coverage run. This gate
      // only needs the terminal table and the threshold check.
      reporter: ["text"],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95,
      },
    },
  },
});
