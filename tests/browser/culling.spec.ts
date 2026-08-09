/**
 * §87 frustum culling against a real WebGL 2 driver (R-8, 2026-08-09) — the
 * pixel half of the packet the fake-GL suites prove the call sequence of.
 *
 * ## What only a browser can answer
 *
 * `packages/render/tests/view-list.test.ts` proves which items a derivation
 * keeps, `packages/render-webgl/tests` proves which draws the backend then
 * issues, and `tests/integration/view-culling.test.ts` proves that a frame with
 * nothing off screen emits the pre-R-8 GL transcript call for call. None of
 * them rasterises anything, so none of them can make the claim culling actually
 * has to earn: **removing a draw the camera cannot see changes no pixel.**
 *
 * That claim is about the interaction between a conservative bounding sphere,
 * six extracted planes, and the driver's own clipping — and the only way to
 * check it is to draw the scene twice into one canvas, once with §49's
 * `frustumCulled` on and once with it off, and compare the readbacks.
 *
 * ## The tolerance, and why it is zero
 *
 * `batching.spec.ts` allows a small difference and says why: a batch bakes
 * world transforms on the CPU, so the same product is evaluated two ways. A
 * cull does nothing of the kind. It removes draws and touches nothing else —
 * same matrices, same uniforms, same order for every survivor — so the two
 * frames must be **bit-identical**, and the comparison here is exact. A single
 * differing pixel means a bound was too small or a plane was wrong, which is
 * the one failure mode of this feature that matters.
 *
 * ## Why this spec builds its own page
 *
 * Same argument as `batching.spec.ts`, and the same technique: the fixture
 * (`fixtures/culling-page.ts`) is bundled with Vite's JavaScript API and
 * injected into a page served by the first site's server, which supplies the
 * `http:` origin a WebGL context wants. Culling is on by default in every
 * example already, so what needs a fixture is the *comparison* — a page that
 * can turn the flag off — not a demonstration.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Canvas size, restated from the fixture (a gate checks a page from outside). */
const WIDTH = 320;
const HEIGHT = 240;

/**
 * Draws the scene costs with §49's flag off: nine on-screen quads, nine off to
 * the right, and the one straddling the right plane. Restated from the fixture.
 */
const UNCULLED_DRAW_CALLS = 19;

/**
 * Draws the same scene costs with the flag on: the nine on-screen quads and the
 * straddler. The nine that are 40 world units to the right are gone; the
 * straddler is **not**, which is the assertion that separates a correct
 * conservative test from one that culls by node origin.
 */
const CULLED_DRAW_CALLS = 10;

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/culling-page.ts", import.meta.url),
  );
  if (!existsSync(entry)) {
    throw new Error(`fixture missing: ${entry}`);
  }
  const result = await build({
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      target: "es2022",
      lib: { entry, formats: ["es"], fileName: "culling-page" },
    },
  });
  // Vite's `build` returns one of three shapes depending on how it was
  // configured; only the rolled-up chunks are wanted, and they are read
  // defensively rather than through a cast — `batching.spec.ts`'s argument.
  const outputs: unknown = Array.isArray(result) ? result[0] : result;
  const chunks: unknown[] =
    typeof outputs === "object" && outputs !== null && "output" in outputs
      ? (outputs as { output: unknown[] }).output
      : [];
  let code = "";
  for (const chunk of chunks) {
    if (typeof chunk === "object" && chunk !== null && "code" in chunk) {
      code += `${String(chunk.code)}\n`;
    }
  }
  if (code === "") {
    throw new Error("the fixture bundled to nothing");
  }
  return code;
}

test.describe("§87 culling removes draws and no pixels (R-8)", () => {
  test("a culled frame is bit-identical to the uncalled one, in ten draws instead of nineteen", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-culling-ready='1']", {
      timeout: 30_000,
    });

    const unculled = (await page.evaluate(() =>
      window.fourCullingProbe?.(false),
    )) as Probe;
    const culled = (await page.evaluate(() =>
      window.fourCullingProbe?.(true),
    )) as Probe;

    expect(unculled.drawCalls).toBe(UNCULLED_DRAW_CALLS);
    expect(culled.drawCalls).toBe(CULLED_DRAW_CALLS);
    expect(culled.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    let differing = 0;
    let drawn = 0;
    for (let i = 0; i < culled.pixels.length; i += 4) {
      let pixelDelta = 0;
      for (let c = 0; c < 4; c += 1) {
        pixelDelta = Math.max(
          pixelDelta,
          Math.abs(culled.pixels[i + c] - unculled.pixels[i + c]),
        );
      }
      if (pixelDelta > 0) differing += 1;
      // Something has to be on screen for the comparison to mean anything.
      if (
        unculled.pixels[i] > 8 ||
        unculled.pixels[i + 1] > 8 ||
        unculled.pixels[i + 2] > 8
      ) {
        drawn += 1;
      }
    }

    console.log(
      `culled vs unculled: ${String(differing)} of ${String(
        WIDTH * HEIGHT,
      )} pixels differ; ${String(drawn)} pixels are non-background`,
    );

    // A blank canvas would pass every comparison above.
    expect(drawn).toBeGreaterThan(WIDTH * HEIGHT * 0.05);
    expect(differing).toBe(0);
  });
});
