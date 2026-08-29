/**
 * §58's paint-object tier against a real WebGL 2 driver (2026-08-29 —
 * R-16's follow-up, unblocked by RFC 0001) — the pixel half of the
 * paint-to-graph lowering.
 *
 * ## What only a browser can answer
 *
 * The unit suites evaluate the lowered graph in JS and the determinism gate
 * pins its emitted GLSL bytes; what no double can prove is that those bytes,
 * compiled by a real driver, paint the picture the *paint* describes — and
 * that the selector `mix`, the baked colour stream, and §61's LEQUAL
 * stroke-over-fill rule all agree inside one real draw. So a
 * gradient-filled, solid-stroked `Rectangle` must render *measurably* here,
 * on the same ANGLE/SwiftShader rasteriser as every other gate
 * (`node-material.spec.ts`'s technique, restated through the §58 authoring
 * surface).
 *
 * ## Why there is no golden
 *
 * The claim is arithmetic (§92, the `chromium` project's rule): the fixture
 * paints `radial(center 0, radius 2, INNER → OUTER)` and this spec
 * re-computes that exact expression per probed pixel within a 3/255
 * tolerance. The centre/corner separation is the categorical half — every
 * fill vertex of a rectangle lies at or beyond the gradient radius, so
 * **any** per-vertex path paints the centre the outer colour, while the
 * lowered graph's fragment stage computes the inner colour there. The
 * stroke band is the selector's half: green pixels exactly where the band
 * lies, over the fill it overlaps.
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

/** The rectangle: 4×4 world units centred on the origin. */
const HALF = 2;

/** The gradient reaches its last stop at this radius, in world units. */
const GRADIENT_RADIUS = 2;

/** The stroke band: half a unit, centred on the outline. */
const STROKE_HALF_WIDTH = 0.25;

/** The paints, restated from the fixture. */
const INNER = [1, 0.2, 0, 1];
const OUTER = [0, 0.2, 1, 1];
const STROKE = [0, 255, 0];

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file — `skinning.spec.ts`'s shape. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/shape-paint-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "shape-paint-page" },
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

/** The fixture's exact radial-gradient expression, per channel. */
function analytic(worldX: number, worldY: number): [number, number, number] {
  const t = Math.min(1, Math.hypot(worldX, worldY) / GRADIENT_RADIUS);
  return [0, 1, 2].map((channel) =>
    Math.round((INNER[channel] + (OUTER[channel] - INNER[channel]) * t) * 255),
  ) as [number, number, number];
}

test.describe("§58 paint objects paint per fragment on a real driver", () => {
  test("a gradient fill and a solid stroke render exactly, in one draw", async ({
    page,
  }) => {
    const code = await bundleFixture();
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-shape-paint-ready='1']", {
      timeout: 30_000,
    });

    const probe = (await page.evaluate(() =>
      window.fourShapePaintProbe?.(),
    )) as Probe;

    // Fill and stroke are one geometry through one derived material: one draw.
    expect(probe.drawCalls).toBe(1);
    expect(probe.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    // Analytic agreement across the fill: a scanline and a diagonal, kept
    // inside the stroke band's inner edge (|x|, |y| < 1.75), every probe
    // within 3/255 of the exact expression per channel.
    const probes: [number, number][] = [];
    for (let x = -1.6; x <= 1.6; x += 0.2) {
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
      `shape-paint: ${String(probes.length)} probes, worst channel ` +
        `difference ${String(worst)}/255`,
    );
    expect(worst).toBeLessThanOrEqual(3);

    // The categorical half: the centre is the inner colour, which no
    // per-vertex interpolation over this geometry can produce — every fill
    // vertex lies at or beyond the gradient radius.
    const centre = pixelIndex(0, 0);
    expect(probe.pixels[centre]).toBeGreaterThan(250); // R ≈ 255
    expect(probe.pixels[centre + 2]).toBeLessThan(5); // B ≈ 0

    // The pad rule: a corner-ward fill pixel beyond `radius` but inside the
    // stroke band's inner edge holds the last stop's colour exactly.
    const padded = pixelIndex(1.55, 1.55); // |p| ≈ 2.19 > 2
    expect(probe.pixels[padded]).toBeLessThan(5); // R ≈ 0
    expect(probe.pixels[padded + 2]).toBeGreaterThan(250); // B ≈ 255

    // The selector half: the stroke band is solid green — probed inside the
    // outline (over the fill it covers, §61's LEQUAL letting the later
    // triangles through), outside it, and on two different edges.
    for (const [x, y] of [
      [HALF - STROKE_HALF_WIDTH / 2, 0], // inner half of the band, over fill
      [HALF + STROKE_HALF_WIDTH / 2, 0], // outer half, past the outline
      [0, -HALF + STROKE_HALF_WIDTH / 2], // another edge
    ] as const) {
      const index = pixelIndex(x, y);
      expect(probe.pixels[index]).toBeLessThan(5);
      expect(probe.pixels[index + 1]).toBe(STROKE[1]);
      expect(probe.pixels[index + 2]).toBeLessThan(5);
    }

    // Outside the band: the black clear, so the band ends where it says.
    const outside = pixelIndex(2.5, 2.5);
    expect(probe.pixels[outside]).toBeLessThan(5);
    expect(probe.pixels[outside + 1]).toBeLessThan(5);
    expect(probe.pixels[outside + 2]).toBeLessThan(5);
  });
});
