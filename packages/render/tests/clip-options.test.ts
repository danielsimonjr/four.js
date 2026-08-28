/**
 * §67's `clip` construction option (R-23, 2026-08-28) — the spelling §79's
 * readers restore a drawable through.
 *
 * `clip` is a `Node` field, but the option lives on `RenderableOptions`
 * because it only means something on a node that draws (the mask is the
 * node's own geometry). `Shape2DOptions` and `TextOptions` extend
 * `RenderableOptions` and forward wholesale, so they are covered by
 * construction; `Sprite` filters its options by hand and is therefore tested
 * by name.
 */

import { planeGeometry } from "@four/geometry";
import { SpriteMaterial, UnlitMaterial } from "@four/materials";
import { describe, expect, it } from "vitest";

import { Rectangle, Renderable, Sprite, Texture } from "../src/index.js";

function texture(): Texture {
  return new Texture({
    width: 1,
    height: 1,
    data: new Uint8Array([255, 255, 255, 255]),
  });
}

describe("RenderableOptions.clip (§67)", () => {
  it("defaults to false and accepts true", () => {
    const plain = new Renderable(planeGeometry(), new UnlitMaterial());
    expect(plain.clip).toBe(false);
    const clipping = new Renderable(planeGeometry(), new UnlitMaterial(), {
      clip: true,
    });
    expect(clipping.clip).toBe(true);
  });

  it("flows through a §50 shape's options unfiltered", () => {
    const shape = new Rectangle({
      width: 2,
      height: 1,
      clip: true,
      material: new UnlitMaterial(),
    });
    expect(shape.clip).toBe(true);
  });

  it("passes through Sprite's hand-filtered options", () => {
    const sprite = new Sprite(new SpriteMaterial({ texture: texture() }), {
      clip: true,
    });
    expect(sprite.clip).toBe(true);
    const plain = new Sprite(new SpriteMaterial({ texture: texture() }));
    expect(plain.clip).toBe(false);
  });
});
