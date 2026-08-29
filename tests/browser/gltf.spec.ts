/**
 * §78's loader against a real WebGL 2 driver (A-19's closing packet,
 * 2026-08-29) — the pixel half of the glTF tier.
 *
 * ## What only a browser can answer
 *
 * The unit and integration suites prove the parse, the assembly, and the
 * recorded draw. What no double can prove is that the **committed fixture
 * files** — bytes on disk, loaded through the injected `FetchLike`, decoded
 * by explicit little-endian arithmetic, assembled into a `StandardMaterial`
 * mesh — rasterise as the picture their author meant on the same
 * ANGLE/SwiftShader stack as every other gate here.
 *
 * ## Why there is no golden
 *
 * The `chromium` project's rule (§92): every assertion is a threshold
 * measurement, never a pixel match. The fixture is an emissive orange unit
 * quad at node translation (0.5, 0.25): orange must fill the quad's own
 * world rectangle and be absent from an equal rectangle beside it — a blank
 * canvas, a missing buffer, an unapplied node transform, and a dropped
 * material each fail at least one of the two counts.
 */

import { readFileSync, existsSync } from "node:fs";
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

/** Device pixels per world unit, both axes (320/8 = 240/6 = 40). */
const SCALE = WIDTH / VIEW_WIDTH;

function pixelX(worldX: number): number {
  return Math.round((worldX + VIEW_WIDTH / 2) * SCALE);
}

function pixelY(worldY: number): number {
  return Math.round((worldY + VIEW_HEIGHT / 2) * SCALE);
}

/**
 * The two probe rectangles, in world units. The quad is a unit square whose
 * node sits at (0.5, 0.25), so it covers x ∈ [0, 1] × y ∈ [−0.25, 0.75];
 * IN sits 0.15 inside every edge, OUT is the same-size rectangle two units
 * to the left, which nothing in the scene reaches.
 */
const IN = { x0: 0.15, x1: 0.85, y0: -0.1, y1: 0.6 };
const OUT = { x0: -1.85, x1: -1.15, y0: -0.1, y1: 0.6 };

interface Probe {
  readonly pixels: number[];
  readonly drawCalls: number;
}

/** Bundles the fixture once for the whole file — `clipping.spec.ts`'s shape. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/gltf-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "gltf-page" },
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

/** The committed fixture files, base64, read on the Node side. */
function fixtureFiles(): Record<string, string> {
  const directory = fileURLToPath(
    new URL("../fixtures/gltf/", import.meta.url),
  );
  const files: Record<string, string> = {};
  for (const name of ["quad.gltf", "quad.bin"]) {
    files[name] = readFileSync(`${directory}${name}`).toString("base64");
  }
  return files;
}

/** Whether a pixel is the fixture's emissive orange rather than the clear. */
function isOrange(pixels: readonly number[], index: number): boolean {
  return pixels[index] > 120 && pixels[index + 2] < 120;
}

/** Orange pixels inside a world-space rectangle. */
function orangeIn(
  pixels: readonly number[],
  rect: { x0: number; x1: number; y0: number; y1: number },
): number {
  let count = 0;
  for (let y = pixelY(rect.y0); y < pixelY(rect.y1); y += 1) {
    for (let x = pixelX(rect.x0); x < pixelX(rect.x1); x += 1) {
      if (isOrange(pixels, (y * WIDTH + x) * 4)) {
        count += 1;
      }
    }
  }
  return count;
}

/** A probe rectangle's own area, in device pixels. */
function areaOf(rect: {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}): number {
  return (
    (pixelX(rect.x1) - pixelX(rect.x0)) * (pixelY(rect.y1) - pixelY(rect.y0))
  );
}

test.describe("§78: the committed glTF fixture renders on a real driver", () => {
  test("quad.gltf + quad.bin load, assemble, and draw where authored", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-gltf-ready='1']", {
      timeout: 30_000,
    });

    const probe = (await page.evaluate(
      (files) => window.fourGltfProbe?.(files),
      fixtureFiles(),
    )) as Probe;

    expect(probe.drawCalls).toBe(1);
    expect(probe.pixels).toHaveLength(WIDTH * HEIGHT * 4);

    const inside = orangeIn(probe.pixels, IN);
    const outside = orangeIn(probe.pixels, OUT);
    console.log(
      `gltf: quad region ${String(inside)} of ${String(areaOf(IN))} orange ` +
        `pixels; empty region ${String(outside)} of ${String(areaOf(OUT))}`,
    );

    // The loaded quad fills its own rectangle and nothing else's — a missing
    // buffer, transform, or material fails at least one count.
    expect(inside).toBeGreaterThan(areaOf(IN) * 0.9);
    expect(outside).toBeLessThan(areaOf(OUT) * 0.02);
  });
});
