/**
 * §49/§56's `Text` node against a real WebGL 2 driver (R-28, 2026-08-13) — the
 * pixel half of the packet the fake-GL suites prove the call sequence of.
 *
 * ## What only a browser can answer
 *
 * `packages/four/tests/text-node.test.ts` proves the quads a string becomes and
 * `tests/integration/text-rendering.test.ts` proves that a label issues one
 * `drawElements` through the pipeline a textured `Renderable` already used.
 * Neither rasterises anything, so neither can say that **the letters appear**.
 * That claim is a fragment shader sampling per-vertex uv into an atlas cell, and
 * its failure modes — uv off by a cell, the gutter bleeding, alpha blended the
 * wrong way round, a Y flip that draws every glyph upside down — all produce a
 * frame that a fake context reports as a perfectly good draw call.
 *
 * The second claim is R-30's: `NEAREST` and `LINEAR` are one `texParameteri`
 * with a different enum, and only a rasteriser can say they differ.
 *
 * ## Why this spec builds its own page
 *
 * The technique R-9's batching gate established, for its reason: a text
 * demonstration is a gate fixture, not a site anyone should visit, and a tenth
 * example would cost the suite a tenth preview server. The fixture
 * (`fixtures/text-page.ts`) is bundled with Vite's JavaScript API and injected
 * into a page served by the first site's server, which supplies the `http:`
 * origin a WebGL context wants.
 *
 * ## The assertions, and why each is a threshold
 *
 * Per §92 there are no golden images in the `chromium` project — SwiftShader
 * rasterises differently from a GPU. So the ink is counted rather than matched,
 * and it is counted against **two references drawn by the same driver in the
 * same call sequence**: the empty string (which must leave the canvas black)
 * and the other filter. A blank canvas, a solid canvas, and a canvas of the
 * wrong colour all fail; a Chromium point release does not.
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
 * Drawn glyphs in the fixture's `"MOTOR 42\nOK"` — eleven characters, of which
 * the space and the newline emit no quad.
 */
const GLYPHS = 9;

/**
 * Ink the label must lay down, as a fraction of the canvas.
 *
 * Nine 5 × 7 letterforms at ~19 device pixels per font pixel would be far more;
 * the floor is deliberately loose because it exists to fail a **blank** canvas
 * and a canvas showing one glyph, not to pin a rasteriser's coverage.
 */
const MIN_INK_FRACTION = 0.01;

/**
 * Ink the label must **not** exceed. A label that painted its whole quad — the
 * failure mode of an atlas sampled at the wrong uv, or of alpha ignored — would
 * cover the entire block, which is a third of this canvas.
 */
const MAX_INK_FRACTION = 0.2;

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
  readonly glyphs: number;
  readonly width: number;
}

/** Bundles the fixture once for the whole file — R-9's `bundleFixture`. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/text-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "text-page" },
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

/** Pixels with any visible channel — the label is drawn on black. */
function inkedPixels(probe: Probe): number {
  let inked = 0;
  for (let i = 0; i < probe.pixels.length; i += 4) {
    if (
      probe.pixels[i] > 8 ||
      probe.pixels[i + 1] > 8 ||
      probe.pixels[i + 2] > 8
    ) {
      inked += 1;
    }
  }
  return inked;
}

test.describe("§56 text draws glyphs on a real driver (R-28)", () => {
  test("one draw call paints a legible label, and §77's filter changes it", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-text-ready='1']", {
      timeout: 30_000,
    });

    const nearest = (await page.evaluate(() =>
      window.fourTextProbe?.("nearest"),
    )) as Probe;
    const linear = (await page.evaluate(() =>
      window.fourTextProbe?.("linear"),
    )) as Probe;
    const blank = (await page.evaluate(() =>
      window.fourTextProbe?.("blank"),
    )) as Probe;

    // R-28's headline claim, as a number: the whole label is one draw.
    expect(nearest.drawCalls).toBe(1);
    expect(nearest.glyphs).toBe(GLYPHS);
    expect(nearest.pixels).toHaveLength(WIDTH * HEIGHT * 4);
    expect(nearest.width).toBeGreaterThan(0);

    const nearestInk = inkedPixels(nearest);
    const linearInk = inkedPixels(linear);
    const blankInk = inkedPixels(blank);

    console.log(
      `text on SwiftShader: nearest ${String(nearestInk)} inked, ` +
        `linear ${String(linearInk)}, empty string ${String(blankInk)} ` +
        `of ${String(WIDTH * HEIGHT)} pixels`,
    );

    // The empty string draws nothing at all — the reference that makes every
    // count below mean "the glyphs are there" rather than "something is".
    expect(blank.glyphs).toBe(0);
    expect(blankInk).toBe(0);

    for (const [name, ink] of [
      ["nearest", nearestInk],
      ["linear", linearInk],
    ] as const) {
      expect(ink, `${name}: nothing was painted`).toBeGreaterThan(
        WIDTH * HEIGHT * MIN_INK_FRACTION,
      );
      expect(ink, `${name}: the whole quad was painted`).toBeLessThan(
        WIDTH * HEIGHT * MAX_INK_FRACTION,
      );
    }

    // R-30, the pixel half: the two filters are one enum apart and the driver
    // must be able to tell. `LINEAR` spreads coverage over a glyph's edge
    // texels, so it inks strictly more pixels than `NEAREST` does.
    expect(linearInk).toBeGreaterThan(nearestInk);

    // **Two lines, with a gap between them.** This is the shape assertion, and
    // it is deliberately threshold-free rather than a row index: a row number
    // pins the rasteriser's exact glyph extent, which is precisely what a gate
    // in this directory must not do (§92). What is asserted is the *structure*
    // of a two-line label — some rows inked, some rows blank, and at least one
    // run of blank rows strictly between two inked ones, which is the leading
    // that `layoutText` put there.
    const at = (x: number, y: number): number => {
      const index = ((HEIGHT - 1 - y) * WIDTH + x) * 4;
      return Math.max(
        nearest.pixels[index],
        nearest.pixels[index + 1],
        nearest.pixels[index + 2],
      );
    };
    const inkedRows: boolean[] = [];
    for (let y = 0; y < HEIGHT; y += 1) {
      let inked = false;
      for (let x = 0; x < WIDTH && !inked; x += 1) inked = at(x, y) > 8;
      inkedRows.push(inked);
    }
    const first = inkedRows.indexOf(true);
    const last = inkedRows.lastIndexOf(true);
    const blankBetween = inkedRows
      .slice(first, last)
      .filter((inked) => !inked).length;

    console.log(
      `two-line label: rows ${String(first)}…${String(last)} carry ink, ` +
        `${String(blankBetween)} blank rows between them`,
    );

    expect(first).toBeGreaterThan(0);
    expect(last).toBeLessThan(HEIGHT - 1);
    // The leading between the two lines: a single-line label, or one whose
    // second line landed on top of the first, leaves no blank row inside.
    expect(blankBetween).toBeGreaterThan(0);
    // Nothing in the corners: a label that filled its quad, or one drawn at the
    // wrong scale, would reach them.
    expect(at(1, 1)).toBeLessThanOrEqual(8);
    expect(at(WIDTH - 2, HEIGHT - 2)).toBeLessThanOrEqual(8);
  });
});
