/**
 * §47's `ScreenCamera` against a real WebGL 2 driver (R-37, 2026-08-21) — the
 * pixel half of the packet the unit and integration suites prove the matrices
 * of.
 *
 * ## What only a browser can answer
 *
 * `packages/scene/tests/screen-camera.test.ts` proves the projection maps pixel
 * `(24, 24)` to the NDC coordinate those pixels name, and
 * `tests/integration/screen-camera.test.ts` proves the application feeds it the
 * surface and the two-view recipe draws each item once. Neither rasterises
 * anything, so neither can make the claim this feature exists to earn: **a
 * 100 × 40 panel authored at pixel (20, 30) covers exactly those device
 * pixels, and no others.**
 *
 * That is a claim about the interaction between an orthographic box derived
 * from a surface size, the viewport rectangle, and the driver's own
 * rasterisation rule — and the only way to check it is to draw the panel and
 * measure the lit rectangle.
 *
 * ## The tolerance, and why it is zero
 *
 * Exact. The panel's edges fall on integer pixel boundaries, so every rule that
 * fills a pixel whose centre is inside the primitive agrees on which pixels
 * those are; a half-pixel error in the projection — the classic screen-space
 * bug — moves an edge by a whole pixel and fails here. `batching.spec.ts`
 * allows a small difference because it compares two ways of evaluating the same
 * product; there is nothing of the kind to compare here.
 *
 * ## Three origins, three corners
 *
 * The same authored rectangle is drawn once per §47 origin. Under `"top-left"`
 * it is 30 px from the **top**; under `"bottom-left"` the identical numbers put
 * it 30 px from the **bottom**; under `"centered"` they measure from the middle
 * of the surface. The three measured rectangles are what pins §7a's "screen
 * space may be Y-down, and it reconciles at the camera".
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/** Canvas size, restated from the fixture. */
const WIDTH = 320;
const HEIGHT = 240;

/** Panel size and inset, restated from the fixture. */
const PANEL_WIDTH = 100;
const PANEL_HEIGHT = 40;
const INSET_X = 20;
const INSET_Y = 30;

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Half-open pixel rectangle, in `readPixels` space (origin bottom-left). */
interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  count: number;
}

/** Bounding box of every non-background pixel in a readback. */
function litBounds(pixels: readonly number[]): Bounds {
  const bounds: Bounds = {
    minX: WIDTH,
    maxX: -1,
    minY: HEIGHT,
    maxY: -1,
    count: 0,
  };
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4;
      if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) {
        bounds.count += 1;
        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
      }
    }
  }
  return bounds;
}

/** Bundles the fixture once for the whole file. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/screen-camera-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "screen-camera-page" },
    },
  });
  // Vite's `build` returns one of three shapes; only the rolled-up chunks are
  // wanted, read defensively rather than through a cast (`batching.spec.ts`).
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

test.describe("§47 ScreenCamera lays out in pixels (R-37)", () => {
  test("puts the same authored rectangle in three corners, pixel-exactly", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-screen-camera-ready='1']", {
      timeout: 30_000,
    });

    const topLeft = (await page.evaluate(() =>
      window.fourScreenCameraProbe?.("top-left"),
    )) as Probe;
    const bottomLeft = (await page.evaluate(() =>
      window.fourScreenCameraProbe?.("bottom-left"),
    )) as Probe;
    const centered = (await page.evaluate(() =>
      window.fourScreenCameraProbe?.("centered"),
    )) as Probe;

    expect(topLeft.drawCalls).toBe(1);
    expect(topLeft.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    // Every probe lights exactly the panel's area — no more, no less.
    const area = PANEL_WIDTH * PANEL_HEIGHT;
    for (const probe of [topLeft, bottomLeft, centered]) {
      expect(litBounds(probe.pixels).count).toBe(area);
    }

    // `readPixels` has a bottom-left origin, so a top-left layout's Y is
    // mirrored: 30 px from the top of 240 is row 240 − 30 − 40 = 170.
    const top = litBounds(topLeft.pixels);
    expect([top.minX, top.maxX]).toEqual([INSET_X, INSET_X + PANEL_WIDTH - 1]);
    expect([top.minY, top.maxY]).toEqual([
      HEIGHT - INSET_Y - PANEL_HEIGHT,
      HEIGHT - INSET_Y - 1,
    ]);

    // The identical numbers, measured from the bottom instead.
    const bottom = litBounds(bottomLeft.pixels);
    expect([bottom.minX, bottom.maxX]).toEqual([
      INSET_X,
      INSET_X + PANEL_WIDTH - 1,
    ]);
    expect([bottom.minY, bottom.maxY]).toEqual([
      INSET_Y,
      INSET_Y + PANEL_HEIGHT - 1,
    ]);

    // And from the middle of the surface, Y up.
    const middle = litBounds(centered.pixels);
    expect([middle.minX, middle.maxX]).toEqual([
      WIDTH / 2 + INSET_X,
      WIDTH / 2 + INSET_X + PANEL_WIDTH - 1,
    ]);
    expect([middle.minY, middle.maxY]).toEqual([
      HEIGHT / 2 + INSET_Y,
      HEIGHT / 2 + INSET_Y + PANEL_HEIGHT - 1,
    ]);
  });
});
