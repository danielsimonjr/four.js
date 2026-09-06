/**
 * §67 rectangular scissor — default-off, snapshotted onto the item, and a
 * batch-run breaker. A scene that never names a rectangle must keep the
 * runs it had before the field existed.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import { Scene, resolveWorldTransforms } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  Rectangle,
  RenderBatcher,
  Renderable,
  Sprite,
  SpriteMaterial,
  Texture,
  buildRenderList,
  intersectScissor,
  scissorsEqual,
} from "../src/index.js";

function texture(): Texture {
  return new Texture({
    width: 1,
    height: 1,
    data: new Uint8Array([255, 255, 255, 255]),
  });
}

describe("intersectScissor / scissorsEqual", () => {
  it("treats null and undefined as the same absence", () => {
    expect(scissorsEqual(null, undefined)).toBe(true);
    expect(scissorsEqual(undefined, undefined)).toBe(true);
    expect(scissorsEqual({ x: 0, y: 0, width: 1, height: 1 }, null)).toBe(
      false,
    );
  });

  it("compares by value, not only by identity", () => {
    expect(
      scissorsEqual(
        { x: 10, y: 20, width: 30, height: 40 },
        { x: 10, y: 20, width: 30, height: 40 },
      ),
    ).toBe(true);
    expect(
      scissorsEqual(
        { x: 10, y: 20, width: 30, height: 40 },
        { x: 10, y: 20, width: 31, height: 40 },
      ),
    ).toBe(false);
  });

  it("intersects and clamps empty extents at zero", () => {
    expect(
      intersectScissor(
        { x: 0, y: 0, width: 100, height: 80 },
        { x: 50, y: 40, width: 80, height: 80 },
      ),
    ).toEqual({ x: 50, y: 40, width: 50, height: 40 });
    expect(
      intersectScissor(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: 20, width: 5, height: 5 },
      ),
    ).toEqual({ x: 20, y: 20, width: 0, height: 0 });
  });
});

describe("Renderable.scissor (§67)", () => {
  it("defaults to null and accepts a rectangle", () => {
    const plain = new Renderable(planeGeometry(), new UnlitMaterial());
    expect(plain.scissor).toBeNull();
    const boxed = new Renderable(planeGeometry(), new UnlitMaterial(), {
      scissor: { x: 8, y: 16, width: 32, height: 24 },
    });
    expect(boxed.scissor).toEqual({ x: 8, y: 16, width: 32, height: 24 });
  });

  it("flows through a §50 shape's options unfiltered", () => {
    const shape = new Rectangle({
      width: 2,
      height: 1,
      scissor: { x: 1, y: 2, width: 3, height: 4 },
      material: new UnlitMaterial(),
    });
    expect(shape.scissor).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("passes through Sprite's inherited options", () => {
    const sprite = new Sprite(new SpriteMaterial({ texture: texture() }), {
      scissor: { x: 0, y: 0, width: 64, height: 32 },
    });
    expect(sprite.scissor).toEqual({ x: 0, y: 0, width: 64, height: 32 });
  });
});

describe("buildRenderList snapshots scissor", () => {
  it("writes null on every item that never named one", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(new Renderable(planeGeometry(), material));
    resolveWorldTransforms(scene);
    const list = buildRenderList(scene, []);
    expect(list).toHaveLength(1);
    expect(list[0]?.scissor ?? null).toBeNull();
  });

  it("copies the node's rectangle onto the item", () => {
    const scene = new Scene();
    const rect = { x: 12, y: 24, width: 48, height: 36 };
    scene.add(
      new Renderable(planeGeometry(), new UnlitMaterial(), { scissor: rect }),
    );
    resolveWorldTransforms(scene);
    const list = buildRenderList(scene, []);
    expect(list[0]?.scissor).toBe(rect);
  });
});

describe("§67 scissor × §65 batching", () => {
  it("keeps an un-scissored scene's runs", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(new Renderable(planeGeometry(), material));
    scene.add(new Renderable(planeGeometry(), material));
    resolveWorldTransforms(scene);
    const list = buildRenderList(scene, []);
    const batch = new RenderBatcher().next(list, 0);
    expect(batch?.items).toBe(2);
    expect(batch?.scissor ?? null).toBeNull();
  });

  it("does not merge same-material draws across a scissor boundary", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(new Renderable(planeGeometry(), material));
    scene.add(
      new Renderable(planeGeometry(), material, {
        scissor: { x: 0, y: 0, width: 10, height: 10 },
      }),
    );
    resolveWorldTransforms(scene);
    const list = buildRenderList(scene, []);
    expect(new RenderBatcher().next(list, 0)).toBeNull();
  });

  it("merges independently written identical rectangles", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(planeGeometry(), material, {
        scissor: { x: 4, y: 8, width: 16, height: 16 },
      }),
    );
    scene.add(
      new Renderable(planeGeometry(), material, {
        scissor: { x: 4, y: 8, width: 16, height: 16 },
      }),
    );
    resolveWorldTransforms(scene);
    const list = buildRenderList(scene, []);
    const batch = new RenderBatcher().next(list, 0);
    expect(batch?.items).toBe(2);
    expect(batch?.scissor).toEqual({ x: 4, y: 8, width: 16, height: 16 });
  });
});
