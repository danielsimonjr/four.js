import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the browser gates (WP-3.8, extended by WP-5.8,
 * WP-6.6, WP-7.7, WP-9.4 and the post-plan UI proof).
 *
 * The suite drives **six built example sites** in headless Chromium:
 *
 * | site | port | specs | what it gates |
 * | ---- | ---- | ----- | ------------- |
 * | `examples/first-2d-scene` | {@link PORT} | `example`, `smoothness`, `animation`, `interaction` | the page loads clean, the canvas is not blank, it animates smoothly, and the pointer reaches it (§106, §106a) |
 * | `examples/physics-playground` | {@link PLAYGROUND_PORT} | `playground` | §108's mixed 2D/3D physics demo: gravity, collisions, impulses and sensors through one API |
 * | `examples/mechanism` | {@link MECHANISM_PORT} | `mechanism` | §109's jointed mechanism: a motorised shaft, three hinges, a limited slider, a spring and two limit switches, stable under a real-time load and reconfigurable while running |
 * | `examples/blending` | {@link BLENDING_PORT} | `blending` | §110's physics-animation blending: an animated chain handed to the solver as a ragdoll and blended back onto its animation, without abrupt discontinuities |
 * | `examples/particles-demo` | {@link PARTICLES_PORT} | `particles` | §112's particle demonstration: a seeded CPU fountain under §27 fields bouncing off a collision plane, plus a click burst, each drawn as one instanced draw call |
 * | `examples/ui-demo` | {@link UI_PORT} | `ui` | §73–§75's retained-mode UI: a `@four/ui` panel of buttons and labels laid out by the package, skinned by the application, driven by real pointer and keyboard input (the WP-11.5 packet-intent closure) |
 *
 * **In the `chromium` project there are no golden images** — SwiftShader
 * rasterises slightly differently from a GPU, so every assertion in
 * `tests/browser` is a threshold, never a pixel match (§92). This sentence was
 * unqualified ("There are no golden images") until 2026-08-05, which stopped
 * being true when the `visual` project below landed on 2026-08-04: that project
 * runs `tests/visual` and *does* compare committed PNG goldens, legitimately,
 * because both sides of its comparison are SwiftShader. See the comment on the
 * `visual` project for the scope of the exception.
 *
 * Run **all six** builds first: the web servers below serve the *built* `dist`
 * directories, which are gitignored and may be absent.
 *
 * ```sh
 * pnpm example:build          # examples/first-2d-scene/dist
 * pnpm playground:build       # examples/physics-playground/dist
 * pnpm mechanism:build        # examples/mechanism/dist
 * pnpm blending:build         # examples/blending/dist
 * pnpm particles-demo:build   # examples/particles-demo/dist
 * pnpm ui-demo:build          # examples/ui-demo/dist
 * pnpm test:browser
 * ```
 *
 * `use.baseURL` stays the first site's, so every pre-existing spec keeps
 * navigating with `page.goto("/")` unchanged; `playground.spec.ts`,
 * `mechanism.spec.ts`, `blending.spec.ts`, `particles.spec.ts` and `ui.spec.ts`
 * name their own absolute URLs, and restate {@link PLAYGROUND_PORT} /
 * {@link MECHANISM_PORT} / {@link BLENDING_PORT} / {@link PARTICLES_PORT} /
 * {@link UI_PORT} for the reason the other specs restate the example's
 * scene constants — a browser gate checks the built page from the outside, and
 * a spec that imported this file would drag a second copy of the config into
 * every worker.
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

/**
 * Preview port for `examples/mechanism` — §109's demonstration.
 *
 * A third entry rather than a third run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4175 is the next free port above
 * the playground's and is restated verbatim in `tests/browser/mechanism.spec.ts`.
 */
const MECHANISM_PORT = 4175;

/**
 * Preview port for `examples/blending` — §110's demonstration.
 *
 * A fourth entry rather than a fourth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4176 is the next free port above
 * the mechanism's and is restated verbatim in `tests/browser/blending.spec.ts`.
 */
const BLENDING_PORT = 4176;

/**
 * Preview port for `examples/particles-demo` — §112's demonstration.
 *
 * A fifth entry rather than a fifth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4177 is the next free port above
 * the blending demo's and is restated verbatim in
 * `tests/browser/particles.spec.ts`.
 *
 * This site is the cheap tier deliberately (plan §6h): it carries no physics
 * package and therefore no WebAssembly image, so it bundles to ~20 kB gzip —
 * the `first-2d-scene` order of magnitude, not the playground's ~670 kB. A fifth
 * server is only worth its §86 cost if the site it serves is small.
 */
const PARTICLES_PORT = 4177;

/**
 * Preview port for `examples/ui-demo` — the §73–§75 UI demonstration.
 *
 * A sixth entry rather than a sixth run, for {@link PLAYGROUND_PORT}'s reason:
 * `vite preview` serves exactly one `dist`, and Playwright starts every entry of
 * a `webServer` array before the first test. 4178 is the next free port above
 * the particles demo's and is restated verbatim in `tests/browser/ui.spec.ts`.
 *
 * Like the particles demo, this site is the cheap tier: no physics package, no
 * WebAssembly image — `ui`, `input`, `text`, `scene` and the WebGL backend
 * bundle to ~25 kB gzip.
 */
const UI_PORT = 4178;

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
  projects: [
    {
      name: "chromium",
      testDir: "tests/browser",
      use: { browserName: "chromium" },
    },
    // §92's visual category (seeded 2026-08-04): golden-image comparison of
    // pages that are static at rest, compared SwiftShader-to-SwiftShader —
    // the launch args below force that rasteriser everywhere, so the
    // "no golden images" doctrine above (about SwiftShader-vs-GPU drift)
    // does not apply to this project. Goldens live next to the specs and are
    // committed; refresh with `npx playwright test --project visual
    // --update-snapshots` after reviewing the failure diff.
    {
      name: "visual",
      testDir: "tests/visual",
      use: { browserName: "chromium" },
    },
  ],
  // All six sites are started before the first test and torn down after the
  // last, so one `pnpm test:browser` run covers every spec in `testDir`. The
  // entries use different ports, so they coexist rather than race for one.
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
    {
      command: `npx vite preview examples/mechanism --port ${String(MECHANISM_PORT)} --strictPort`,
      url: `http://localhost:${String(MECHANISM_PORT)}`,
      reuseExistingServer: false,
      // One Rapier wasm image rather than two (the mechanism is a `"2d"` world),
      // so this bundle is about half the playground's.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/blending --port ${String(BLENDING_PORT)} --strictPort`,
      url: `http://localhost:${String(BLENDING_PORT)}`,
      reuseExistingServer: false,
      // One Rapier wasm image, like the mechanism's: `examples/blending` is a
      // single `"2d"` world, plus the animation package the other examples that
      // animate already pull in.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/particles-demo --port ${String(PARTICLES_PORT)} --strictPort`,
      url: `http://localhost:${String(PARTICLES_PORT)}`,
      reuseExistingServer: false,
      // No wasm at all: this bundle is ~20 kB gzip, so the first request is the
      // fastest of the six. The generous timeout is kept for uniformity.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npx vite preview examples/ui-demo --port ${String(UI_PORT)} --strictPort`,
      url: `http://localhost:${String(UI_PORT)}`,
      reuseExistingServer: false,
      // The particles demo's tier: no wasm, ~25 kB gzip of JavaScript.
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
