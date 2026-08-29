/**
 * §60's node materials against a real WebGL 2 driver (RFC 0001 — gap R-14,
 * 2026-08-28) — the pixel half of the node pipeline.
 *
 * ## What only a browser can answer
 *
 * The unit and integration suites prove everything down to the emitted GLSL
 * bytes and the individual uploads on fake contexts. What no double can prove
 * is that the **emitted source means what we think** on a real driver — that
 * the compiler accepts it and the fragment arithmetic paints the picture the
 * graph describes. So a graph-painted quad must render *measurably* here, on
 * the same ANGLE/SwiftShader rasteriser as every other gate in this
 * directory.
 *
 * ## Why there is no golden
 *
 * The claim is arithmetic, and the `chromium` project's rule is that every
 * assertion is a measurement (§92). The fixture paints a **radial** gradient
 * — `mix(inner, outer, saturate(2 · |uv − ½|))` — and this spec re-computes
 * that exact expression per probed pixel and compares channels within a
 * 3/255 tolerance (8-bit quantisation plus one rounding step; the gradient
 * spans 255 values, so a faceted or vertex-interpolated approximation misses
 * by far more). The centre/corner separation is the categorical half: all
 * four corners are the outer colour, so **any** per-vertex path paints the
 * centre outer-coloured, while the graph's fragment stage computes the inner
 * colour there — R-16's recorded boundary ("per-vertex colour is silently
 * faceted for everything else"), measured.
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

/** World units per the fixture's camera: 40 device pixels per unit. */
const SCALE = 40;

/** The quad: 4×4 world units centred on the origin. */
const QUAD_HALF = 2;

/** The gradient stops, restated from the fixture. */
const INNER = [1, 0.2, 0, 1];
const OUTER = [0, 0.2, 1, 1];

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file — `skinning.spec.ts`'s shape. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/node-material-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "node-material-page" },
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

/** The framebuffer index of the pixel whose centre is world `(x, y)`. */
function pixelIndex(worldX: number, worldY: number): number {
  const px = Math.round(worldX * SCALE + WIDTH / 2);
  const py = Math.round(worldY * SCALE + HEIGHT / 2);
  return (py * WIDTH + px) * 4;
}

/** The fixture's exact fragment expression, per channel, at world `(x, y)`. */
function analytic(worldX: number, worldY: number): [number, number, number] {
  // uv over the 4×4 quad: (world + 2) / 4, per axis.
  const u = (worldX + QUAD_HALF) / (2 * QUAD_HALF);
  const v = (worldY + QUAD_HALF) / (2 * QUAD_HALF);
  const t = Math.min(1, 2 * Math.hypot(u - 0.5, v - 0.5));
  return [0, 1, 2].map((channel) =>
    Math.round((INNER[channel] + (OUTER[channel] - INNER[channel]) * t) * 255),
  ) as [number, number, number];
}

test.describe("§60 node materials paint per fragment on a real driver (RFC 0001)", () => {
  test("a radial gradient graph renders exactly, in one draw", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-node-material-ready='1']", {
      timeout: 30_000,
    });

    const probe = (await page.evaluate(() =>
      window.fourNodeMaterialProbe?.(),
    )) as Probe;

    expect(probe.drawCalls).toBe(1);
    expect(probe.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    // Analytic agreement: a scanline across the quad's middle plus a
    // diagonal, every probe within 3/255 of the exact expression per channel.
    const probes: [number, number][] = [];
    for (let x = -1.8; x <= 1.8; x += 0.3) {
      probes.push([Number(x.toFixed(2)), 0]);
      probes.push([Number(x.toFixed(2)), Number((x / 2).toFixed(2))]);
    }
    let worst = 0;
    for (const [x, y] of probes) {
      const index = pixelIndex(x, y);
      const expected = analytic(x, y);
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = Math.abs(
          probe.pixels[index + channel] - expected[channel],
        );
        worst = Math.max(worst, difference);
      }
    }
    console.log(
      `node-material: ${String(probes.length)} probes, worst channel ` +
        `difference ${String(worst)}/255`,
    );
    expect(worst).toBeLessThanOrEqual(3);

    // The categorical half: the centre is the inner colour, the corners the
    // outer one — the picture per-vertex interpolation cannot produce, since
    // all four corners share the outer colour.
    const centre = pixelIndex(0, 0);
    expect(probe.pixels[centre]).toBeGreaterThan(250); // R ≈ 255
    expect(probe.pixels[centre + 2]).toBeLessThan(5); // B ≈ 0
    const corner = pixelIndex(1.9, 1.9);
    expect(probe.pixels[corner]).toBeLessThan(5); // R ≈ 0
    expect(probe.pixels[corner + 2]).toBeGreaterThan(250); // B ≈ 255
    // Outside the quad: the black clear, so the gradient ends at its edge.
    const outside = pixelIndex(2.5, 2.5);
    expect(probe.pixels[outside]).toBeLessThan(5);
    expect(probe.pixels[outside + 2]).toBeLessThan(5);
  });
});
