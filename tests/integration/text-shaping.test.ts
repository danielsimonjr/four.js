/** Goldens recorded 2026-09-11, harfbuzzjs@0.4.13, pinned OFL fixtures. */
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HarfBuzzShapingEngine } from "../../packages/text/src/harfbuzz/index.js";
import { buildGlyphAtlas, layoutText } from "@fourjs/text";
it("shapes Latin and Arabic reproducibly and lays out font glyph IDs", async () => {
  const e = await HarfBuzzShapingEngine.create({
    wasm: readFileSync(
      new URL(
        "../../packages/text/node_modules/harfbuzzjs/hb.wasm",
        import.meta.url,
      ),
    ),
  });
  const latin = e.addFont(
    readFileSync(
      new URL("../fixtures/fonts/NotoSans-Regular.ttf", import.meta.url),
    ),
  );
  const arabic = e.addFont(
    readFileSync(
      new URL("../fixtures/fonts/NotoSansArabic-Regular.ttf", import.meta.url),
    ),
  );
  const builtin = buildGlyphAtlas();
  const atlas = { ...builtin, glyphsById: new Map() };
  for (const [text, fontId, script, direction, ids, advances, xs] of [
    ["fi", latin, "latn", "ltr", [1652], [602], [0]],
    ["لا", arabic, "arab", "rtl", [704], [582], [0]],
    [
      "Hello",
      latin,
      "latn",
      "ltr",
      [43, 72, 79, 79, 82],
      [741, 564, 258, 258, 605],
      [0, 0.741, 1.305, 1.563, 1.821],
    ],
  ] as const) {
    const query = { text, fontId, script, direction, features: { liga: 1 } };
    const runs = e.shape(query);
    expect(e.shape(query)).toEqual(runs);
    expect(runs[0].glyphs.map((g) => g.glyphId)).toEqual(ids);
    expect(runs[0].glyphs.map((g) => g.advanceX)).toEqual(advances);
    expect(runs[0].glyphs.map((g) => g.cluster)).toEqual(
      text === "Hello" ? [0, 1, 2, 3, 4] : [0],
    );
    const options = { ...query, size: 1, shaper: e };
    const layout = layoutText(text, atlas, options);
    expect(layoutText(text, atlas, options)).toEqual(layout);
    expect(layout.quads.map((q) => q.x0)).toEqual(xs);
  }
  e.dispose();
});
