import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the browser gate (WP-3.8).
 *
 * The suite drives the built `examples/first-2d-scene` bundle in headless
 * Chromium and asserts the three things a renderer-phase exit needs from a real
 * browser: the page loads clean, the canvas is not blank, and it animates.
 * There are no golden images — SwiftShader rasterises slightly differently from
 * a GPU, so every assertion is a threshold, never a pixel match (§92).
 *
 * Run `pnpm example:build` first: the web server below serves the *built*
 * `examples/first-2d-scene/dist`, which is gitignored and may be absent.
 */

/**
 * Locations of a Chromium executable inside a `PLAYWRIGHT_BROWSERS_PATH` tree,
 * as `[directory prefix, path of the binary inside it]`. The full browser is
 * listed first: it works headless *and* headed, so `--headed` debugging keeps
 * working. Layouts differ between Playwright releases, hence several
 * candidates.
 */
const CHROMIUM_BINARIES: readonly (readonly [string, string])[] = [
  ["chromium-", join("chrome-linux", "chrome")],
  [
    "chromium-",
    join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
  ],
  ["chromium_headless_shell-", join("chrome-linux", "headless_shell")],
  [
    "chromium_headless_shell-",
    join("chrome-headless-shell-linux64", "chrome-headless-shell"),
  ],
];

/**
 * Finds a pre-installed Chromium when the sandbox ships a browser revision that
 * differs from the one this Playwright release downloads by default.
 *
 * Returns `undefined` when nothing usable is found — including when
 * `PLAYWRIGHT_BROWSERS_PATH` is unset, which is the CI case: there
 * `npx playwright install chromium` puts the matching revision where Playwright
 * looks for it, and Playwright's own resolution is correct.
 */
function findPreinstalledChromium(): string | undefined {
  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"];
  if (root === undefined || root === "" || root === "0" || !existsSync(root)) {
    return undefined;
  }
  const entries = readdirSync(root).sort();
  for (const [prefix, binary] of CHROMIUM_BINARIES) {
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const candidate = join(root, entry, binary);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const PORT = 4173;

export default defineConfig({
  testDir: "tests/browser",
  // Failure artifacts (traces, error context) live inside the already-ignored
  // `node_modules`, so a failed run never leaves untracked files in the tree.
  outputDir: "node_modules/.playwright/test-results",
  // Two of the three tests compare frames over wall-clock time; sharing a CPU
  // with a parallel worker makes those thresholds noisy under SwiftShader.
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  reporter: process.env["CI"] !== undefined ? "list" : "line",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    // Software rasterisation is the point: CI machines have no GPU, and a GPU
    // that *is* present must not change what the gate measures. ANGLE over
    // SwiftShader gives a real WebGL 2 context in both cases.
    launchOptions: {
      executablePath: findPreinstalledChromium(),
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npx vite preview examples/first-2d-scene --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    // A stale server could be serving an older build than the one just built.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
