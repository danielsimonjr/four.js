import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the browser gates (WP-3.8, extended by WP-5.8).
 *
 * The suite drives **two built example sites** in headless Chromium:
 *
 * | site | port | specs | what it gates |
 * | ---- | ---- | ----- | ------------- |
 * | `examples/first-2d-scene` | {@link PORT} | `example`, `smoothness`, `animation`, `interaction` | the page loads clean, the canvas is not blank, it animates smoothly, and the pointer reaches it (§106, §106a) |
 * | `examples/physics-playground` | {@link PLAYGROUND_PORT} | `playground` | §108's mixed 2D/3D physics demo: gravity, collisions, impulses and sensors through one API |
 *
 * There are no golden images — SwiftShader rasterises slightly differently from
 * a GPU, so every assertion is a threshold, never a pixel match (§92).
 *
 * Run **both** builds first: the web servers below serve the *built* `dist`
 * directories, which are gitignored and may be absent.
 *
 * ```sh
 * pnpm example:build      # examples/first-2d-scene/dist
 * pnpm playground:build   # examples/physics-playground/dist
 * pnpm test:browser
 * ```
 *
 * `use.baseURL` stays the first site's, so every pre-existing spec keeps
 * navigating with `page.goto("/")` unchanged; `playground.spec.ts` names its
 * own absolute URL, and restates {@link PLAYGROUND_PORT} for the reason the
 * other specs restate the example's scene constants — a browser gate checks the
 * built page from the outside, and a spec that imported this file would drag a
 * second copy of the config into every worker.
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

/** Preview port for `examples/first-2d-scene` — the suite's `baseURL`. */
const PORT = 4173;

/**
 * Preview port for `examples/physics-playground`.
 *
 * A second port rather than a second run: the two sites are independent Vite
 * builds, `vite preview` serves exactly one `dist` each, and Playwright starts
 * every entry of a `webServer` array before the first test. 4174 is the next
 * free port above {@link PORT} and is restated verbatim in
 * `tests/browser/playground.spec.ts`.
 */
const PLAYGROUND_PORT = 4174;

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
  // Both sites are started before the first test and torn down after the last,
  // so one `pnpm test:browser` run covers every spec in `testDir`. The entries
  // use different ports, so they coexist rather than race for one.
  webServer: [
    {
      command: `npx vite preview examples/first-2d-scene --port ${String(PORT)} --strictPort`,
      url: `http://localhost:${String(PORT)}`,
      // A stale server could be serving an older build than the one just built.
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/physics-playground --port ${String(PLAYGROUND_PORT)} --strictPort`,
      url: `http://localhost:${String(PLAYGROUND_PORT)}`,
      reuseExistingServer: false,
      // The playground's bundle carries two Rapier wasm images and is ~4 MB, so
      // the *first* request is slower than the example's; the server itself
      // still starts in well under a second.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
