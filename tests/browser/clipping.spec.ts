/**
 * §67's nested node-level clips against a real WebGL 2 driver (R-23,
 * 2026-08-28) — the pixel half of the clipping API.
 *
 * ## What only a browser can answer
 *
 * `tests/integration/clipping.test.ts` proves the composition down to the
 * individual `stencilFunc` arguments, on a fake context with no buffer behind
 * it. The claim left over is the packet's own: two masks written into
 * *different bit planes of one real stencil buffer*, tested as a conjunction,
 * actually confine a draw to their **intersection**. Whether eight planes
 * exist, whether a write mask of `0b10` really leaves plane 0 alone, and
 * whether `EQUAL` over `readMask 0b11` means "both" are all driver properties
 * — so they are measured here, on the same ANGLE/SwiftShader rasteriser as
 * every other gate in this directory.
 *
 * ## Why this spec builds its own page, and why there is no golden
 *
 * The fixture argument is `stencil.spec.ts`'s verbatim (a stencil drawing
 * buffer is an opt-in context attribute no example asks for). No golden image
 * is added because the claim is *geometric* — a count and a bounding box carry
 * it exactly, with margins, per the `chromium` project's
 * every-assertion-is-a-measurement rule (§92) — and a golden would re-pin
 * every anti-aliased edge of a region the arithmetic already pins.
 *
 * ## The measurement
 *
 * The scene (restated from the fixture, deliberately): an 8 × 6 view, two
 * 4 × 4 clip panels centred at (−1, 0) and (+1, 0), and an orange rectangle
 * filling the whole view under both of them. Clipped, the orange must survive
 * exactly on x ∈ [−1, 1] × y ∈ [−2, 2] — **one sixth** of the view, and a
 * region *neither clip alone* would produce (each alone leaves one third, and
 * their union five ninths — so the ratio separates intersection from every
 * single-mask failure, not just from "did not clip").
 *
 * **Measured on the first run (2026-08-28, ANGLE/SwiftShader): 76 800 orange
 * pixels unclipped, 12 800 clipped — ratio 0.1667 against the geometry's
 * 0.1667, box x 120…199, y 40…199.**
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

/** The scene's world extents, restated from the fixture. */
const VIEW_WIDTH = 8;
const VIEW_HEIGHT = 6;
const CLIP_SIZE = 4;
const CLIP_OFFSET = 1;

/** The intersection's world extents: x ∈ [−1, 1], y ∈ [−2, 2]. */
const INTERSECTION_WIDTH = CLIP_SIZE - 2 * CLIP_OFFSET;
const INTERSECTION_HEIGHT = CLIP_SIZE;

/**
 * Draw calls. Unclipped: the two (invisible) panels and the content. Clipped:
 * those three plus one mask draw per clip — a mask is a real draw (§84), and
 * pinning the count is what catches a ninth-plane-style regression that
 * silently stopped emitting masks.
 */
const UNCLIPPED_DRAW_CALLS = 3;
const CLIPPED_DRAW_CALLS = 5;

/** The clipped frame's share of the unclipped frame's orange, from geometry. */
const EXPECTED_RATIO =
  (INTERSECTION_WIDTH * INTERSECTION_HEIGHT) / (VIEW_WIDTH * VIEW_HEIGHT);

/**
 * What a *single* mask (or the union of both) would leave instead — the
 * nearest wrong answers, stated so the tolerance below is visibly narrower
 * than the gap to either: 1/3 for one mask, 5/9 for the union, 1/6 expected.
 */
const SINGLE_MASK_RATIO = (CLIP_SIZE * CLIP_SIZE) / (VIEW_WIDTH * VIEW_HEIGHT);

/** Tolerance on the ratio — 10% relative, a few pixels of edge rounding. */
const RATIO_TOLERANCE = 0.1;

/** The intersection's device-pixel half-extents, plus one pixel of allowance. */
const HALF_X = (INTERSECTION_WIDTH / VIEW_WIDTH) * WIDTH * 0.5 + 1;
const HALF_Y = (INTERSECTION_HEIGHT / VIEW_HEIGHT) * HEIGHT * 0.5 + 1;

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file — `stencil.spec.ts`'s shape. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/clipping-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "clipping-page" },
    },
  });
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

/** Whether a pixel is the content's orange rather than the black clear. */
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

test.describe("§67 nested clips intersect on a real driver (R-23)", () => {
  test("content survives exactly on the two masks' intersection", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-clipping-ready='1']", {
      timeout: 30_000,
    });

    const unclipped = (await page.evaluate(() =>
      window.fourClippingProbe?.(false),
    )) as Probe;
    const clipped = (await page.evaluate(() =>
      window.fourClippingProbe?.(true),
    )) as Probe;

    // A clip costs one extra draw per mask and not a pipeline: the counts pin
    // both that the masks were emitted and that nothing else was.
    expect(unclipped.drawCalls).toBe(UNCLIPPED_DRAW_CALLS);
    expect(clipped.drawCalls).toBe(CLIPPED_DRAW_CALLS);
    expect(clipped.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    const before = orangeExtent(unclipped.pixels);
    const after = orangeExtent(clipped.pixels);
    const ratio = after.count / before.count;
    console.log(
      `clipping: ${String(before.count)} orange pixels unclipped, ` +
        `${String(after.count)} clipped — ratio ${ratio.toFixed(4)} ` +
        `(expected ${EXPECTED_RATIO.toFixed(4)}, one mask alone ` +
        `${SINGLE_MASK_RATIO.toFixed(4)}); clipped box ` +
        `x ${String(after.minX)}…${String(after.maxX)}, ` +
        `y ${String(after.minY)}…${String(after.maxY)}`,
    );

    // A blank canvas would pass every ratio comparison below: the unclipped
    // content fills the view.
    expect(before.count).toBeGreaterThan(WIDTH * HEIGHT * 0.9);

    // The intersection, not one mask, not the union, not everything, not
    // nothing. The tolerance band around 1/6 excludes 1/3 by a factor of two.
    expect(ratio).toBeGreaterThan(EXPECTED_RATIO * (1 - RATIO_TOLERANCE));
    expect(ratio).toBeLessThan(EXPECTED_RATIO * (1 + RATIO_TOLERANCE));
    expect(EXPECTED_RATIO * (1 + RATIO_TOLERANCE)).toBeLessThan(
      SINGLE_MASK_RATIO,
    );

    // And in the right place: every surviving pixel lies inside the
    // intersection rectangle, centred on the canvas.
    expect(after.minX).toBeGreaterThanOrEqual(WIDTH / 2 - HALF_X);
    expect(after.maxX).toBeLessThanOrEqual(WIDTH / 2 + HALF_X);
    expect(after.minY).toBeGreaterThanOrEqual(HEIGHT / 2 - HALF_Y);
    expect(after.maxY).toBeLessThanOrEqual(HEIGHT / 2 + HALF_Y);
  });
});
