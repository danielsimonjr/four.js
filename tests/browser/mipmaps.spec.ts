/**
 * §77's mip chain against a real WebGL 2 driver (R-30b, 2026-08-21) — the pixel
 * half of the packet whose call sequence the fake-GL suites prove.
 *
 * ## What only a browser can answer
 *
 * `packages/render/tests/sprite.test.ts` proves what `Texture` resolves,
 * `packages/render-webgl/tests/webgl-renderer.test.ts` proves which GL calls the
 * cache issues, and `tests/integration/texture-mipmaps.test.ts` proves that a
 * texture asking for nothing changes no transcript. None of them rasterises
 * anything — and a mip chain exists for exactly one reason a call sequence
 * cannot show: **what a minified texture looks like**.
 *
 * A 256 × 256 one-texel checkerboard drawn about thirty pixels wide is an 8×
 * minification. Point-sampled, each pixel is one near-black or near-white texel
 * and the pattern depends on where the quad landed — the shimmer. Trilinearly
 * sampled off a chain, each pixel is close to the checkerboard's average, and
 * the same sub-pixel nudge barely moves it.
 *
 * ## Why the assertions are thresholds, and against what
 *
 * Per §92 there are no golden images in the `chromium` project — SwiftShader
 * rasterises differently from a GPU — so the frame is *measured*, and every
 * measurement is compared against a reference drawn by the same driver in the
 * same call sequence: the other filtering mode. A blank canvas, a black canvas,
 * and a chain that never got generated all fail; a Chromium point release does
 * not.
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
 * How far from mid-grey a channel must be to count as "extreme" — i.e. as a
 * pixel that took the checkerboard's black or white rather than their average.
 */
const EXTREME = 96;

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
  readonly glError: number;
  readonly anisotropy: boolean;
}

/** Bundles the fixture once for the whole file — R-9's `bundleFixture`. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/mipmaps-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "mipmaps-page" },
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

/**
 * Luma of every pixel in a fixed 20 × 20 box at the centre of the canvas —
 * comfortably inside the ~30-pixel quad in every mode.
 *
 * A **fixed** box rather than "every pixel that is not black": the un-mipmapped
 * frame's dark checker cells *are* black, so a brightness threshold would
 * silently drop exactly the pixels that carry the claim, and the two modes
 * would be measured over different populations.
 */
function samples(probe: Probe): number[] {
  const box = 20;
  const values: number[] = [];
  for (let y = (HEIGHT - box) / 2; y < (HEIGHT + box) / 2; y += 1) {
    for (let x = (WIDTH - box) / 2; x < (WIDTH + box) / 2; x += 1) {
      values.push(probe.pixels[(y * WIDTH + x) * 4]);
    }
  }
  return values;
}

/** Mean of a sample; `0` for an empty one (which the caller asserts against). */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** The fraction of sampled pixels that took a near-black or near-white texel. */
function extremeFraction(probe: Probe): number {
  const values = samples(probe);
  let count = 0;
  for (const luma of values) {
    if (Math.abs(luma - 128) > EXTREME) count += 1;
  }
  return count / values.length;
}

/** Pixels anywhere on the canvas carrying ink — "the quad was drawn at all". */
function inked(probe: Probe): number {
  let count = 0;
  for (let i = 0; i < probe.pixels.length; i += 4) {
    if (
      probe.pixels[i] > 8 ||
      probe.pixels[i + 1] > 8 ||
      probe.pixels[i + 2] > 8
    ) {
      count += 1;
    }
  }
  return count;
}

test.describe("§77 mipmaps on a real driver (R-30b)", () => {
  test("a mip chain turns a minified checkerboard from noise into its average", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-mipmap-ready='1']", {
      timeout: 30_000,
    });

    const probe = async (mode: string, nudge = 0): Promise<Probe> =>
      (await page.evaluate(
        ([m, n]) => window.fourMipmapProbe?.(m as never, n),
        [mode, nudge] as const,
      )) as Probe;

    const none = await probe("none");
    const trilinear = await probe("trilinear");
    const anisotropic = await probe("anisotropic");

    // The frame is real: one draw, a quad on screen, and a driver with nothing
    // to complain about.
    for (const [name, frame] of [
      ["none", none],
      ["trilinear", trilinear],
      ["anisotropic", anisotropic],
    ] as const) {
      expect(frame.drawCalls, `${name}: not one draw`).toBe(1);
      expect(frame.glError, `${name}: the driver reported an error`).toBe(0);
      expect(frame.pixels).toHaveLength(WIDTH * HEIGHT * 4);
      expect(inked(frame), `${name}: nothing was drawn`).toBeGreaterThan(200);
    }

    console.log(
      "minified checkerboard on SwiftShader: extreme-pixel fraction — " +
        `bilinear, no chain ${extremeFraction(none).toFixed(3)}, ` +
        `trilinear ${extremeFraction(trilinear).toFixed(3)}, ` +
        `anisotropic ${extremeFraction(anisotropic).toFixed(3)}; ` +
        `extension ${trilinear.anisotropy ? "present" : "absent"}`,
    );

    // **The headline claim.** A bilinear tap inside one checker cell keeps the
    // checkerboard's black and white; a mip chain averages them away. Measured
    // over the same fixed box in both frames, so it is the *filtering* being
    // compared and not the quad's coverage.
    expect(extremeFraction(none)).toBeGreaterThan(0.5);
    expect(extremeFraction(trilinear)).toBeLessThan(0.1);

    // Same texture, same average: a chain must not darken or brighten the
    // surface, only stop it from aliasing.
    expect(Math.abs(mean(samples(trilinear)) - 128)).toBeLessThan(48);

    // **The shimmer, as a number.** Nudge the quad by a fraction of a pixel:
    // with no chain the sample set changes and the mean moves; with one it
    // barely does. This is the claim a call sequence cannot make.
    // Measured **per pixel**, not as a difference of means: a checkerboard that
    // swapped its black and white cells has the same mean and is a completely
    // different image, which is exactly what shimmering is.
    const drift = (before: Probe, after: Probe): number => {
      const a = samples(before);
      const b = samples(after);
      let total = 0;
      for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
      return total / a.length;
    };
    const nudge = 32 / WIDTH / 2;
    const noneDrift = drift(none, await probe("none", nudge));
    const mippedDrift = drift(trilinear, await probe("trilinear", nudge));
    console.log(
      `half-pixel nudge, mean per-pixel change: no chain ${noneDrift.toFixed(1)}, ` +
        `trilinear ${mippedDrift.toFixed(1)}`,
    );
    // The un-mipmapped frame changes by roughly half of full range — cells
    // swapping black for white — while the trilinear one moves a fraction of
    // that. The factor is asserted at two rather than at the ~3 SwiftShader
    // measures, because this is a threshold gate and not a golden (§92): what
    // must hold on every driver is "markedly steadier", not a number.
    expect(noneDrift).toBeGreaterThan(8);
    expect(mippedDrift).toBeLessThan(noneDrift / 2);

    // Anisotropy is a *request* (§62): where SwiftShader offers the extension
    // the parameter is written and the frame still draws; where it does not,
    // the request is dropped and the frame is the trilinear one. Either way it
    // never turns a legal scene into a failure — which is the whole policy.
    expect(extremeFraction(anisotropic)).toBeLessThan(0.1);
  });
});
