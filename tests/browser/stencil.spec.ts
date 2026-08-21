/**
 * §67's stencil mask against a real WebGL 2 driver (R-7, 2026-08-11) — the
 * pixel half of the packet the fake-GL suites prove the call sequence of.
 *
 * ## What only a browser can answer
 *
 * `packages/render-webgl/tests` proves the GL *sequence* a stencil material
 * issues, and `tests/integration/stencil-masking.test.ts` proves the whole
 * composition — mask pass, masked pass, restore — down to the individual
 * `stencilFunc` arguments. Neither rasterises anything, and neither has a
 * stencil buffer: a fake context records `enable(STENCIL_TEST)` just as happily
 * whether or not the surface it belongs to has eight bits per pixel to test
 * against.
 *
 * The claim left over is the one §67 exists for and the one a fake context
 * cannot make: **a mask written by one draw actually clips the next**. Whether
 * the context attribute produced a buffer, whether the per-view clear reset it,
 * and whether the driver's stencil test does what the enum says are all
 * properties of the driver — so they are checked here, on the same
 * ANGLE-over-SwiftShader rasteriser every other gate in this directory uses.
 *
 * ## Why this spec builds its own page
 *
 * `batching.spec.ts`'s argument, and one more of its own. Every other browser
 * gate drives a built site in `examples/`; this one has no site to drive,
 * because the stencil buffer is an opt-in **context attribute** and no example
 * asks for it. Adding a tenth example — plus a tenth preview server — to
 * demonstrate one renderer option would cost the suite a server and the
 * repository a page nobody would visit. So the fixture
 * (`fixtures/stencil-page.ts`) is bundled here with Vite's JavaScript API and
 * injected into a page served by the first site's server, which supplies the
 * `http:` origin a WebGL context wants.
 *
 * ## The measurement, and why it is a ratio
 *
 * The probe renders one two-draw scene twice into one canvas — once with the
 * fill's stencil test on, once with it off — and reads the framebuffer back
 * inside each call. The scene's geometry fixes the answer: the mask covers
 * 2 × 2 world units of a 8 × 6 view, the fill covers 6 × 4, so the masked frame
 * must paint **one sixth** of the unmasked frame's orange pixels, in the middle
 * of the canvas and nowhere else.
 *
 * That is asserted three ways, because each catches a different failure:
 *
 * | assertion | what it catches |
 * | --------- | --------------- |
 * | the unmasked frame paints ~40% of the canvas | a blank canvas, which would pass every ratio test |
 * | the masked frame paints 1/6 of that, ±10% | a mask that did not clip at all (ratio 1), or clipped everything (ratio 0) |
 * | every orange pixel of the masked frame lies inside the mask's rectangle | a mask that clipped *something* but in the wrong place |
 *
 * Nothing here is a golden image: the gate runs on SwiftShader, and this file
 * follows the `chromium` project's rule that every assertion is a measurement
 * with margin (§92). **Measured on the first run (2026-08-11,
 * ANGLE/SwiftShader): 38 400 orange pixels unmasked, 6 400 masked — a ratio of
 * 0.1667 against the geometry's 0.1667, with the masked box exactly
 * x 120…199, y 80…159, i.e. the mask's 80 × 80 device pixels centred on a
 * 320 × 240 canvas.**
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
 * The scene's world extents, restated from the fixture for the reason every
 * other spec here restates its example's constants: importing them would let a
 * wrong scene agree with a wrong expectation.
 */
const VIEW_WIDTH = 8;
const VIEW_HEIGHT = 6;
const MASK_WIDTH = 2;
const MASK_HEIGHT = 2;
const FILL_WIDTH = 6;
const FILL_HEIGHT = 4;

/** Draw calls the scene costs either way: the mask pass and the fill pass. */
const DRAW_CALLS = 2;

/** The masked frame's share of the unmasked frame's orange, from the geometry. */
const EXPECTED_RATIO = (MASK_WIDTH * MASK_HEIGHT) / (FILL_WIDTH * FILL_HEIGHT);

/**
 * Tolerance on that ratio — 10% relative, which is a few pixels of edge
 * rounding on each of the four sides of a 80 × 80 device-pixel rectangle. The
 * failures this test exists for move the ratio to 1 or to 0.
 */
const RATIO_TOLERANCE = 0.1;

/** Half the mask's size in device pixels, plus one pixel of edge allowance. */
const MASK_HALF_X = (MASK_WIDTH / VIEW_WIDTH) * WIDTH * 0.5 + 1;
const MASK_HALF_Y = (MASK_HEIGHT / VIEW_HEIGHT) * HEIGHT * 0.5 + 1;

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/stencil-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "stencil-page" },
    },
  });
  // Vite's `build` returns one of three shapes depending on how it was
  // configured; only the rolled-up chunks are wanted, and they are read
  // defensively rather than through a cast, so a Vite upgrade that changes the
  // shape fails here loudly instead of injecting an empty script.
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

/** Whether a pixel is the fill's orange rather than the black clear. */
function isOrange(pixels: readonly number[], index: number): boolean {
  return pixels[index] > 120 && pixels[index + 2] < 120;
}

/** Counts the orange pixels, and the bounding box they occupy. */
function orangeExtent(pixels: readonly number[]): {
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let count = 0;
  let minX = WIDTH;
  let maxX = -1;
  let minY = HEIGHT;
  let maxY = -1;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (!isOrange(pixels, (y * WIDTH + x) * 4)) continue;
      count += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { count, minX, maxX, minY, maxY };
}

test.describe("§67 a stencil mask clips the draw after it (R-7)", () => {
  test("the masked fill covers the mask's rectangle and nothing else", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-stencil-ready='1']", {
      timeout: 30_000,
    });

    const unmasked = (await page.evaluate(() =>
      window.fourStencilProbe?.(false),
    )) as Probe;
    const masked = (await page.evaluate(() =>
      window.fourStencilProbe?.(true),
    )) as Probe;

    // Masking is render state, not a draw: the frame costs the same two calls
    // either way (§57 — nothing here is a second pipeline).
    expect(unmasked.drawCalls).toBe(DRAW_CALLS);
    expect(masked.drawCalls).toBe(DRAW_CALLS);
    expect(masked.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    const before = orangeExtent(unmasked.pixels);
    const after = orangeExtent(masked.pixels);
    const ratio = after.count / before.count;
    console.log(
      `stencil: ${String(before.count)} orange pixels unmasked, ` +
        `${String(after.count)} masked — ratio ${ratio.toFixed(4)} ` +
        `(expected ${EXPECTED_RATIO.toFixed(4)}); masked box ` +
        `x ${String(after.minX)}…${String(after.maxX)}, ` +
        `y ${String(after.minY)}…${String(after.maxY)}`,
    );

    // A blank canvas would pass every ratio comparison below.
    const expectedFill =
      ((FILL_WIDTH * FILL_HEIGHT) / (VIEW_WIDTH * VIEW_HEIGHT)) *
      WIDTH *
      HEIGHT;
    expect(before.count).toBeGreaterThan(expectedFill * 0.9);

    // The mask clipped, and clipped by the right amount.
    expect(ratio).toBeGreaterThan(EXPECTED_RATIO * (1 - RATIO_TOLERANCE));
    expect(ratio).toBeLessThan(EXPECTED_RATIO * (1 + RATIO_TOLERANCE));

    // And clipped in the right *place*: every surviving pixel is inside the
    // mask's rectangle, centred on the canvas.
    expect(after.minX).toBeGreaterThanOrEqual(WIDTH / 2 - MASK_HALF_X);
    expect(after.maxX).toBeLessThanOrEqual(WIDTH / 2 + MASK_HALF_X);
    expect(after.minY).toBeGreaterThanOrEqual(HEIGHT / 2 - MASK_HALF_Y);
    expect(after.maxY).toBeLessThanOrEqual(HEIGHT / 2 + MASK_HALF_Y);
  });
});
