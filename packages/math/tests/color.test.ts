import { describe, expect, it } from "vitest";

import {
  linearToSrgb,
  linearToSrgbRGB,
  linearToSrgbRGBA,
  parseColor,
  parseColorRGB,
  srgbToLinear,
  srgbToLinearRGB,
  srgbToLinearRGBA,
  type ColorRGB,
  type ColorRGBA,
} from "../src/index.js";

/**
 * §60a's colour management at the value-type layer (R-15, 2026-08-08).
 *
 * `color.ts` sat at 0% coverage from the 2026-08-04 hoist until this file: it
 * declared types only, and a type has nothing to execute. The module now carries
 * the transfer functions and the CSS parser, so it is covered like every other
 * math module.
 */
describe("sRGB transfer functions (§60a)", () => {
  it("pins the endpoints and the piecewise breakpoints exactly", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);

    // Below the breakpoint the curve is the linear segment, exactly.
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 15);
    expect(linearToSrgb(0.0031308)).toBeCloseTo(0.0031308 * 12.92, 15);
  });

  it("decodes mid-sRGB to the documented linear value", () => {
    // The number `UnlitMaterial`'s caveat block and every colour-management
    // reference quote: 0.5 sRGB is 21.4% linear, not 50%.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404114048223255, 15);
    expect(linearToSrgb(0.21404114048223255)).toBeCloseTo(0.5, 12);
  });

  it("round-trips across the whole 0…1 range", () => {
    for (let i = 0; i <= 255; i += 1) {
      const encoded = i / 255;
      expect(linearToSrgb(srgbToLinear(encoded))).toBeCloseTo(encoded, 12);
    }
  });

  it("extends oddly rather than clamping, in both directions (§60a extended range)", () => {
    expect(srgbToLinear(-0.5)).toBeCloseTo(-srgbToLinear(0.5), 15);
    expect(linearToSrgb(-0.5)).toBeCloseTo(-linearToSrgb(0.5), 15);
    // Above 1 nothing saturates: an HDR emissive survives a round trip.
    expect(srgbToLinear(4)).toBeGreaterThan(4);
    expect(linearToSrgb(srgbToLinear(4))).toBeCloseTo(4, 12);
    // …including below the negative breakpoint, the linear segment mirrored.
    expect(srgbToLinear(-0.02)).toBeCloseTo(-0.02 / 12.92, 15);
    expect(linearToSrgb(-0.001)).toBeCloseTo(-0.001 * 12.92, 15);
  });

  it("passes non-finite components through instead of throwing", () => {
    expect(Number.isNaN(srgbToLinear(Number.NaN))).toBe(true);
    expect(Number.isNaN(linearToSrgb(Number.NaN))).toBe(true);
    expect(srgbToLinear(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(linearToSrgb(Number.NEGATIVE_INFINITY)).toBe(
      Number.NEGATIVE_INFINITY,
    );
  });
});

describe("tuple conversions (§7b out-parameter discipline)", () => {
  it("writes into out, returns it, and leaves the source alone", () => {
    const source: ColorRGB = [0.5, 0.25, 1];
    const out: ColorRGB = [0, 0, 0];
    expect(srgbToLinearRGB(source, out)).toBe(out);
    expect(out[0]).toBeCloseTo(srgbToLinear(0.5), 15);
    expect(out[1]).toBeCloseTo(srgbToLinear(0.25), 15);
    expect(out[2]).toBeCloseTo(1, 12);
    expect(source).toEqual([0.5, 0.25, 1]);

    const back: ColorRGB = [0, 0, 0];
    expect(linearToSrgbRGB(out, back)).toBe(back);
    expect(back[0]).toBeCloseTo(0.5, 12);
    expect(back[1]).toBeCloseTo(0.25, 12);
    expect(back[2]).toBeCloseTo(1, 12);
  });

  it("copies alpha instead of transferring it", () => {
    const source: ColorRGBA = [0.5, 0.5, 0.5, 0.25];
    const out: ColorRGBA = [0, 0, 0, 1];
    expect(srgbToLinearRGBA(source, out)).toBe(out);
    expect(out[3]).toBe(0.25);
    expect(out[0]).toBeCloseTo(0.21404114048223255, 15);

    const back: ColorRGBA = [0, 0, 0, 0];
    expect(linearToSrgbRGBA(out, back)).toBe(back);
    expect(back[3]).toBe(0.25);
    expect(back[0]).toBeCloseTo(0.5, 12);
  });

  it("converts in place when source and out are the same array", () => {
    const rgb: ColorRGB = [0.5, 0.5, 0.5];
    srgbToLinearRGB(rgb, rgb);
    expect(rgb[0]).toBeCloseTo(0.21404114048223255, 15);
    linearToSrgbRGB(rgb, rgb);
    expect(rgb[0]).toBeCloseTo(0.5, 12);

    const rgba: ColorRGBA = [0.5, 0.5, 0.5, 0.75];
    srgbToLinearRGBA(rgba, rgba);
    expect(rgba[3]).toBe(0.75);
    linearToSrgbRGBA(rgba, rgba);
    expect(rgba[0]).toBeCloseTo(0.5, 12);
    expect(rgba[3]).toBe(0.75);
  });
});

describe("parseColor — the CSS subset (§60a: strings denote sRGB)", () => {
  it("parses every hex length, case-insensitively", () => {
    expect(parseColor("#f00")).toEqual([1, 0, 0, 1]);
    expect(parseColor("#F00")).toEqual([1, 0, 0, 1]);
    expect(parseColor("#ff0000")).toEqual([1, 0, 0, 1]);
    expect(parseColor("#00ff00ff")).toEqual([0, 1, 0, 1]);

    const short = parseColor("#0f08");
    expect(short[0]).toBe(0);
    expect(short[1]).toBe(1);
    expect(short[2]).toBe(0);
    expect(short[3]).toBeCloseTo(8 / 15, 15);

    const grey = parseColor("#a0a0a0");
    expect(grey[0]).toBeCloseTo(0xa0 / 255, 15);
    expect(grey[3]).toBe(1);
  });

  it("ignores surrounding whitespace", () => {
    expect(parseColor("  #ffffff \n")).toEqual([1, 1, 1, 1]);
  });

  it("parses rgb()/rgba() in comma, space and slash syntax, with percentages", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual([1, 0, 0, 1]);
    expect(parseColor("RGBA(255,0,0,0.5)")).toEqual([1, 0, 0, 0.5]);
    expect(parseColor("rgb(255 0 0)")).toEqual([1, 0, 0, 1]);
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual([1, 0, 0, 0.5]);
    expect(parseColor("rgba(100%, 0%, 0%, 1)")).toEqual([1, 0, 0, 1]);
    expect(parseColor("rgb(+255, .0, 0)")).toEqual([1, 0, 0, 1]);

    const half = parseColor("rgb(128, 128, 128)");
    expect(half[0]).toBeCloseTo(128 / 255, 15);
  });

  it("does not clamp what the string said (§60a extended range)", () => {
    const over = parseColor("rgb(300, 0, -10)");
    expect(over[0]).toBeCloseTo(300 / 255, 15);
    expect(over[2]).toBeCloseTo(-10 / 255, 15);
  });

  it("resolves transparent and the sixteen CSS Level 1 keywords", () => {
    expect(parseColor("transparent")).toEqual([0, 0, 0, 0]);
    expect(parseColor("TRANSPARENT")).toEqual([0, 0, 0, 0]);
    expect(parseColor("black")).toEqual([0, 0, 0, 1]);
    expect(parseColor("White")).toEqual([1, 1, 1, 1]);
    expect(parseColor("lime")).toEqual([0, 1, 0, 1]);
    expect(parseColor("fuchsia")).toEqual([1, 0, 1, 1]);
    expect(parseColor("aqua")).toEqual([0, 1, 1, 1]);
    expect(parseColor("yellow")).toEqual([1, 1, 0, 1]);

    const teal = parseColor("teal");
    expect(teal[1]).toBeCloseTo(0x80 / 255, 15);
    for (const keyword of [
      "silver",
      "gray",
      "maroon",
      "red",
      "purple",
      "green",
      "olive",
      "navy",
      "blue",
    ]) {
      expect(parseColor(keyword)[3]).toBe(1);
    }
  });

  it("fills a caller's out array and returns it", () => {
    const out: ColorRGBA = [9, 9, 9, 9];
    expect(parseColor("#000000", out)).toBe(out);
    expect(out).toEqual([0, 0, 0, 1]);
    expect(parseColor("rgb(255 255 255)", out)).toBe(out);
    expect(out).toEqual([1, 1, 1, 1]);
    expect(parseColor("transparent", out)).toBe(out);
    expect(out).toEqual([0, 0, 0, 0]);
    expect(parseColor("red", out)).toBe(out);
    expect(out).toEqual([1, 0, 0, 1]);
  });

  it("refuses everything outside the tier, loudly and by name (§85)", () => {
    for (const bad of [
      "#ff",
      "#fffff",
      "#gggggg",
      "#1234567",
      "hsl(0, 100%, 50%)",
      "rgb(255, 0)",
      "rgb(1, 2, 3, 4, 5)",
      "rgb(255, , 0)",
      "rgb(255 0 0 /)",
      "rgb(a, b, c)",
      "rgb(1, 2, 3%%)",
      "rgba(1, 2, 3, x)",
      "currentColor",
      "rebeccapurple",
      "",
    ]) {
      expect(() => parseColor(bad)).toThrow(TypeError);
      expect(() => parseColor(bad)).toThrow(/§60a/);
    }
  });
});

describe("parseColorRGB — the light/emissive form (§68, §59)", () => {
  it("drops the alpha and fills an optional out", () => {
    expect(parseColorRGB("#ff8000")).toEqual([1, 0x80 / 255, 0]);
    expect(parseColorRGB("rgba(255, 0, 0, 0.25)")).toEqual([1, 0, 0]);

    const out: ColorRGB = [9, 9, 9];
    expect(parseColorRGB("white", out)).toBe(out);
    expect(out).toEqual([1, 1, 1]);
  });

  it("composes with the transfer functions the way §60a asks", () => {
    // The whole authored-colour path in one line: a CSS string denotes sRGB
    // (§60a), a light colour is linear-light, so the string is decoded.
    const lightColor: ColorRGB = [0, 0, 0];
    srgbToLinearRGB(parseColorRGB("#808080"), lightColor);
    expect(lightColor[0]).toBeCloseTo(srgbToLinear(0x80 / 255), 15);
  });

  it("refuses what parseColor refuses", () => {
    expect(() => parseColorRGB("hsl(0 0% 0%)")).toThrow(TypeError);
  });
});
