/**
 * `ImageWidget` (§73, A-12) — a box, a §79 logical key, and the intrinsic size
 * §74 asks for. The pixels are the skin's.
 */

import { Vector2 } from "@four/math";
import { describe, expect, it } from "vitest";

import { ImageWidget } from "../src/image.js";
import type { WidgetSkin } from "../src/widget.js";

describe("ImageWidget", () => {
  it("measures nothing until it is told the natural size", () => {
    const image = new ImageWidget({ source: "textures/avatar.png" });
    const out = new Vector2(9, 9);

    image.measureIntrinsic(out);

    expect([out.x, out.y]).toEqual([0, 0]);
    expect(image.source).toBe("textures/avatar.png");
  });

  it("uses the natural size as §74's intrinsic image size", () => {
    const image = new ImageWidget({ naturalWidth: 64, naturalHeight: 48 });
    image.layout();

    expect(image.measuredWidth).toBe(64);
    expect(image.measuredHeight).toBe(48);
  });

  it("lets an explicit box win over the natural size", () => {
    const image = new ImageWidget({
      naturalWidth: 64,
      naturalHeight: 48,
      width: 20,
    });
    image.layout();

    expect(image.measuredWidth).toBe(20);
    expect(image.measuredHeight).toBe(48);
  });

  it("is inert data by default, like a label", () => {
    expect(new ImageWidget().interactive).toBe(false);
    expect(new ImageWidget({ interactive: true }).interactive).toBe(true);
    expect(new ImageWidget().source).toBeNull();
    expect(new ImageWidget().checked).toBeNull();
  });

  it("tells the skin when the source or the natural size changed", () => {
    const seen: string[] = [];
    const image = new ImageWidget({ source: "a.png" });
    image.skin = {
      onContentChange: () => seen.push("content"),
      onLayout: () => seen.push("layout"),
    } satisfies WidgetSkin;
    seen.length = 0;

    image.source = "b.png";
    image.source = "b.png"; // idempotent
    image.naturalWidth = 10;
    image.naturalWidth = 10;
    image.naturalHeight = 12;
    image.naturalHeight = 12;
    image.source = null;

    expect(seen).toEqual(["content", "content", "content", "content"]);
    expect(image.source).toBeNull();
    expect([image.naturalWidth, image.naturalHeight]).toEqual([10, 12]);
  });

  it("refuses a natural size that is not a length (§85)", () => {
    expect(() => new ImageWidget({ naturalWidth: -1 })).toThrow(RangeError);
    expect(() => new ImageWidget({ naturalHeight: Number.NaN })).toThrow(
      RangeError,
    );

    const image = new ImageWidget();
    expect(() => (image.naturalWidth = Infinity)).toThrow(RangeError);
    expect(() => (image.naturalHeight = -0.5)).toThrow(RangeError);
  });
});
