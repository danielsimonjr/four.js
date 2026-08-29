/**
 * §71's id-buffer picking against a real WebGL 2 driver (RFC 0005,
 * 2026-08-28) — the pixel half of the picking service.
 *
 * ## What only a browser can answer
 *
 * `tests/integration/pixel-picking.test.ts` proves the pass down to the
 * individual `uniform4fv` and `readPixels` arguments, on a fake context with
 * no buffer behind it — the read-back there is *staged*. The claims left
 * over are the packet's own: that the flat id program compiles and links on
 * a real driver, that a known pixel of the id target really holds the
 * front-most candidate's encoded index after rasterisation and the depth /
 * submission-order rules, and that WebGL 2's non-stalling read-back path
 * (`PIXEL_PACK_BUFFER` + `fenceSync`/`clientWaitSync` + `getBufferSubData`)
 * round-trips those bytes — all on the same ANGLE/SwiftShader rasteriser as
 * every other gate in this directory.
 *
 * ## The measurement
 *
 * The scene (restated from the fixture, deliberately — a gate checks a page
 * from the outside): an 8 × 6 view; `back` 4 × 4 at the centre with
 * `renderOrder 0`; `front` 2 × 2 at the centre with `renderOrder 1`,
 * co-planar; `aside` 2 × 2 at (+3, 0). Every assertion distinguishes a
 * *specific* failure: centre → `front` separates the id pass from one that
 * lost the §66 submission order (co-planar draws under `LEQUAL` resolve by
 * order — the wrong answer there is `back`, not garbage); (−0.375, 0) →
 * `back`; (+0.75, 0) → `aside`; (−0.9, −0.9) → nothing, the cleared texel.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { build } from "vite";

/** Restates `PORT` in `playwright.config.ts` — the site whose origin is borrowed. */
const PORT = 4173;

/**
 * NDC probe points, restated from the fixture's geometry: the view spans
 * x ∈ [−4, 4], y ∈ [−3, 3], so world (x, y) sits at NDC (x / 4, y / 3).
 */
const CENTRE: [number, number] = [0, 0];
/** World (−1.5, 0): inside `back`'s 4 × 4, outside `front`'s 2 × 2. */
const ON_BACK: [number, number] = [-0.375, 0];
/** World (+3, 0): the bystander's centre. */
const ON_ASIDE: [number, number] = [0.75, 0];
/** World (−3.6, −2.7): the empty corner — the clear colour's texel. */
const ON_NOTHING: [number, number] = [-0.9, -0.9];

/** Bundles the fixture once for the whole file — `clipping.spec.ts`'s shape. */
async function bundleFixture(): Promise<string> {
  const entry = fileURLToPath(
    new URL("fixtures/picking-page.ts", import.meta.url),
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
      lib: { entry, formats: ["es"], fileName: "picking-page" },
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

test.describe("§71 id-buffer picking on a real driver (RFC 0005)", () => {
  test("a known pixel resolves to the known node, front-most first", async ({
    page,
  }) => {
    const code = await bundleFixture();
    // The first site's server supplies an `http:` origin; the page itself is
    // replaced, so nothing of that example is under test here.
    await page.goto(`http://localhost:${String(PORT)}/`);
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: code, type: "module" });
    await page.waitForSelector("body[data-picking-ready='1']", {
      timeout: 30_000,
    });

    const ids = await page.evaluate(() => window.fourPickIds);
    expect(ids).toBeDefined();
    if (ids === undefined) {
      return;
    }
    expect(ids.back).toMatch(/^node-\d+$/);
    expect(new Set([ids.back, ids.front, ids.aside]).size).toBe(3);

    const probe = async (point: readonly [number, number]) =>
      page.evaluate(
        ([ndcX, ndcY]) => window.fourPickProbe?.(ndcX, ndcY),
        point,
      );

    // The two co-planar quads resolve by §66 submission order — the id pass
    // kept the picture's order, not merely its geometry.
    await expect(probe(CENTRE)).resolves.toBe(ids.front);
    await expect(probe(ON_BACK)).resolves.toBe(ids.back);
    await expect(probe(ON_ASIDE)).resolves.toBe(ids.aside);
    // The empty corner reads the cleared texel: identity 0, "nothing there".
    await expect(probe(ON_NOTHING)).resolves.toBeNull();
  });
});
