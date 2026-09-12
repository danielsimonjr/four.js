import { describe, expect, it } from "vitest";
import {
  IdentityShapingEngine,
  buildGlyphAtlas,
  layoutText,
  validateFontBytes,
} from "../src/index.js";
describe("shaping seam", () => {
  it("tracks UTF16 clusters, monotonic handles and lifecycle", () => {
    const e = new IdentityShapingEngine(),
      fontId = e.addFont(new Uint8Array());
    expect(e.addFont(new Uint8Array())).not.toBe(fontId);
    expect(
      e
        .shape({ text: "𝄞a", fontId })[0]
        .glyphs.map((g) => [g.glyphId, g.cluster]),
    ).toEqual([
      [0x1d11e, 0],
      [97, 2],
    ]);
    expect(() => e.shape({ text: "a", fontId, direction: "ttb" })).toThrow(
      expect.objectContaining({ code: "NOT_IMPLEMENTED" }),
    );
    e.removeFont(fontId);
    expect(() => e.removeFont(fontId)).toThrow();
    e.dispose();
    expect(() => e.addFont(new Uint8Array())).toThrow();
  });
  it("validates limits separately from content", () => {
    for (const limit of [0, -1, NaN, Infinity])
      expect(() => validateFontBytes(new Uint8Array(), limit)).toThrow(
        RangeError,
      );
    expect(() => validateFontBytes(new Uint8Array(2), 1)).toThrow(
      expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }),
    );
  });
  it("preserves legacy numbers exactly, except additive clusters", () => {
    const atlas = buildGlyphAtlas(),
      shaper = new IdentityShapingEngine(),
      fontId = shaper.addFont(new Uint8Array());
    expect(atlas.glyphsById?.get(65)).toBe(atlas.glyphs.get("A"));
    for (const text of [
      "",
      "a",
      "abc",
      "Hello world",
      "a\nb",
      "\n",
      "a\r\nb",
      " a ",
      "123",
      "!?",
      "𝄞a",
      "a\nbbb\n",
    ])
      for (const size of [1, 0.3])
        for (const align of ["left", "center", "right"] as const)
          for (const letterSpacing of [0, 0.02, -0.01]) {
            const options = { size, align, letterSpacing };
            const shaped = layoutText(text, atlas, {
              ...options,
              shaper,
              fontId,
            });
            expect({
              ...shaped,
              quads: shaped.quads.map(({ cluster: _cluster, ...quad }) => quad),
            }).toEqual(layoutText(text, atlas, options));
          }
    expect(() => layoutText("", atlas, { size: 1, shaper })).toThrow(
      RangeError,
    );
    const rtl = layoutText("abc", atlas, {
      size: 1,
      shaper,
      fontId,
      direction: "rtl",
    });
    expect(rtl.quads[0].x0).toBeGreaterThan(rtl.quads[1].x0);
  });
});

it("places independent LTR/RTL runs, ligatures, offsets and source clusters", () => {
  class Runs extends IdentityShapingEngine {
    override shape() {
      return [
        {
          script: "latn",
          direction: "ltr" as const,
          glyphs: [
            {
              glyphId: 65,
              cluster: 0,
              advanceX: 600,
              advanceY: 0,
              offsetX: 100,
              offsetY: 200,
            },
          ],
        },
        {
          script: "arab",
          direction: "rtl" as const,
          glyphs: [
            {
              glyphId: 66,
              cluster: 2,
              advanceX: 500,
              advanceY: 0,
              offsetX: 0,
              offsetY: 0,
            },
            {
              glyphId: 67,
              cluster: 3,
              advanceX: 400,
              advanceY: 0,
              offsetX: 0,
              offsetY: 0,
            },
          ],
        },
      ];
    }
  }
  // Structural adapter deliberately avoids the identity atlas-metric specialization.
  const runs = new Runs();
  const shaper = {
    name: "test",
    version: "1",
    addFont: () => "font",
    removeFont() {},
    dispose() {},
    shape: () => runs.shape(),
  };
  const atlas = buildGlyphAtlas();
  const layout = layoutText("fiab\nfiab", atlas, {
    size: 1,
    shaper,
    fontId: "font",
  });
  expect(layout.quads.map((q) => q.cluster)).toEqual([0, 2, 3, 5, 7, 8]);
  expect(layout.quads.slice(0, 3).map((q) => q.x0)).toEqual([0.1, 1, 0.6]);
  expect(layout.width).toBe(1.5);
  expect(layout.quads[0].y0).toBeCloseTo(
    0.2 - atlas.descent / atlas.lineHeight,
  );
});

it("identity shaping preserves custom character atlas metrics without glyph-ID mappings", () => {
  const original = buildGlyphAtlas();
  const atlas = {
    ...original,
    glyphsById: undefined,
    glyphs: new Map(original.glyphs).set("A", {
      ...original.glyphs.get("A")!,
      width: 3,
      advance: 11,
    }),
  };
  const shaper = new IdentityShapingEngine();
  const fontId = shaper.addFont(new Uint8Array());
  const options = { size: 0.7, letterSpacing: 0.03 };
  const shaped = layoutText("A B\nAA", atlas, { ...options, shaper, fontId });
  expect({
    ...shaped,
    quads: shaped.quads.map(({ cluster: _cluster, ...q }) => q),
  }).toEqual(layoutText("A B\nAA", atlas, options));
  shaper.dispose();
});
