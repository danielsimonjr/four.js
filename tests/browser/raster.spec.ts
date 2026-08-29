/**
 * §77a raster painting against a real browser (RFC 0004, 2026-08-29) — the
 * pixel half of the packet whose buffer arithmetic the unit suite proves.
 *
 * A real `<canvas>` 2D context is painted two-toned by application code, read
 * through the §77a adapter (`origin: "top-left"`, `getImageData`), carried by
 * a `CanvasTexture`, and drawn by the WebGL 2 backend through the upload path
 * every texture already uses. The claims only a browser can make:
 *
 * 1. **Painted pixels reach the screen, the right way up.** The half painted
 *    at the top of the host canvas renders at the top of the quad — the one
 *    flip rule, end to end. (A vertically mirrored minimap is RFC 0004's
 *    motivating bug report.)
 * 2. **Dirty tracking is honest.** A host-canvas repaint alone changes
 *    nothing; `invalidate()` alone changes nothing; `update()` is the one
 *    call that re-reads and re-uploads — nothing in the engine polls.
 *
 * Per §92 there are no goldens in the `chromium` project: assertions are
 * counted thresholds against pure primaries, which are fixed points of the
 * sRGB transfer curve, so they hold with or without an output transform.
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

type Color = readonly [number, number, number];

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
  readonly glError: number;
  readonly updated: boolean | null;
}

/** Bundles the fixture once for the whole file — R-9's `bundleFixture`. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/raster-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "raster-page" },
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

/** The RGB at framebuffer pixel (x, y) — GL rows: y = 0 is the BOTTOM. */
function at(probe: Probe, x: number, y: number): Color {
  const index = (y * WIDTH + x) * 4;
  return [
    probe.pixels[index],
    probe.pixels[index + 1],
    probe.pixels[index + 2],
  ];
}

/** Whether a pixel is dominated by one channel — tolerant of the sRGB decode. */
function dominated(color: Color, channel: 0 | 1 | 2): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (i === channel) {
      if (color[i] < 200) return false;
    } else if (color[i] > 50) {
      return false;
    }
  }
  return true;
}

/**
 * Counts how many pixels of a 20 × 20 box are dominated by `channel`. The two
 * boxes sit inside the upper and lower halves of the 160 × 120-pixel quad,
 * which is centred on the 320 × 240 canvas.
 */
function boxCount(probe: Probe, half: "upper" | "lower", channel: 0 | 1 | 2) {
  // The quad spans y 60…180; its horizontal middle is x 160.
  const centerY = half === "upper" ? 150 : 90;
  let count = 0;
  for (let y = centerY - 10; y < centerY + 10; y += 1) {
    for (let x = 150; x < 170; x += 1) {
      if (dominated(at(probe, x, y), channel)) count += 1;
    }
  }
  return count;
}

test.describe("§77a raster painting on a real driver (RFC 0004)", () => {
  test("painted pixels render the right way up, and only update() re-uploads", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-raster-ready='1']", {
      timeout: 30_000,
    });

    const probe = async (
      top: Color,
      bottom: Color,
      mode: string,
    ): Promise<Probe> =>
      (await page.evaluate(
        ([t, b, m]) =>
          window.fourRasterProbe?.(
            t as [number, number, number],
            b as [number, number, number],
            m as never,
          ),
        [top, bottom, mode] as const,
      )) as Probe;

    // 1. First frame: red painted at the TOP of the host canvas, blue below.
    const first = await probe([255, 0, 0], [0, 0, 255], "update");
    expect(first.updated).toBe(true);
    expect(first.drawCalls).toBe(1);
    expect(first.glError).toBe(0);
    expect(first.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    // Orientation, end to end: the top-painted half is the UPPER half of the
    // quad on screen; a missing (or doubled) flip would swap these counts.
    expect(boxCount(first, "upper", 0)).toBeGreaterThan(350); // red above
    expect(boxCount(first, "lower", 2)).toBeGreaterThan(350); // blue below
    expect(boxCount(first, "upper", 2)).toBe(0);
    expect(boxCount(first, "lower", 0)).toBe(0);
    // And the background cleared black around the quad.
    expect(at(first, 5, 5)).toEqual([0, 0, 0]);

    // 2. The application repaints its canvas green/red and tells the engine
    // nothing: the screen must still show the OLD picture — nothing polls.
    const paintOnly = await probe([0, 255, 0], [255, 0, 0], "paint-only");
    expect(paintOnly.updated).toBeNull();
    expect(paintOnly.glError).toBe(0);
    expect(boxCount(paintOnly, "upper", 0)).toBeGreaterThan(350); // still red
    expect(boxCount(paintOnly, "lower", 2)).toBeGreaterThan(350); // still blue
    expect(boxCount(paintOnly, "upper", 1)).toBe(0); // no green anywhere yet

    // 3. invalidate() alone: stale, but never read — update() is
    // application-driven by decision (RFC 0004 Q6), so still the old picture.
    const invalidateOnly = await probe(
      [0, 255, 0],
      [255, 0, 0],
      "invalidate-only",
    );
    expect(invalidateOnly.glError).toBe(0);
    expect(boxCount(invalidateOnly, "upper", 0)).toBeGreaterThan(350);
    expect(boxCount(invalidateOnly, "upper", 1)).toBe(0);

    // 4. update(): the stale flag set in step 3 is consumed, the repaint hook
    // paints green/red, and the new picture reaches the screen.
    const second = await probe([0, 255, 0], [255, 0, 0], "update");
    expect(second.updated).toBe(true);
    expect(second.glError).toBe(0);
    expect(boxCount(second, "upper", 1)).toBeGreaterThan(350); // green above
    expect(boxCount(second, "lower", 0)).toBeGreaterThan(350); // red below
    expect(boxCount(second, "upper", 0)).toBe(0);

    console.log(
      "raster painting on SwiftShader: first frame upper-red " +
        `${String(boxCount(first, "upper", 0))}/400, lower-blue ` +
        `${String(boxCount(first, "lower", 2))}/400; after update ` +
        `upper-green ${String(boxCount(second, "upper", 1))}/400`,
    );
  });
});
