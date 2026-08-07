/**
 * Unit tests for §77's `Texture`, §55's `Sprite`, and the sprite half of §64's
 * render list.
 *
 * Three things are being pinned here, and it is worth naming them because they
 * are the contracts the WebGL backend and §56's text tier both build on:
 *
 * 1. **Lifecycle and versioning.** A texture's `version` is a backend's cache
 *    key (§53's contract, reused verbatim by §77), so every mutation that a
 *    backend must notice has to advance it, and no mutation that a backend must
 *    *not* re-upload for may.
 * 2. **The quad is a function of anchor and size.** The vertex positions are
 *    asserted directly for the corner anchors, because the anchor convention
 *    (`(0,0)` = bottom-left, Y-up per §7a) is the sort of thing that is
 *    off-by-one-flip forever if nobody writes it down as numbers.
 * 3. **The render list discriminates.** A sprite item must arrive with
 *    `kind: "sprite"` and a `SpriteMaterial`, side by side with unlit items and
 *    sorted by the same §66 keys — that discriminant is the only thing standing
 *    between a textured quad and the flat-colour pipeline.
 */

import { planeGeometry } from "@four/geometry";
import { SpriteMaterial, UnlitMaterial } from "@four/materials";
import { PoseBuffer, Scene } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  Renderable,
  Sprite,
  Texture,
  buildInterpolatedRenderList,
  buildRenderList,
  isSpriteItem,
  isUnlitItem,
  type RenderItem,
  type SpriteRenderItem,
  type TextureSource,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/** A 2×2 RGBA8 source: four texels, sixteen bytes. */
function checkerSource(): TextureSource {
  return {
    width: 2,
    height: 2,
    // prettier-ignore
    data: new Uint8Array([
      255, 0, 0, 255,   0, 0, 255, 255,
      0, 0, 255, 255,   255, 0, 0, 255,
    ]),
  };
}

function texture(): Texture {
  return new Texture(checkerSource());
}

function spriteMaterial(): SpriteMaterial {
  return new SpriteMaterial({ texture: texture() });
}

/** The quad's four corners as `[x, y]` pairs, in vertex order. */
function corners(sprite: Sprite): [number, number][] {
  const p = sprite.geometry.positions;
  return [0, 1, 2, 3].map((i) => [p[i * 3], p[i * 3 + 1]]);
}

// ---------------------------------------------------------------------------
// Texture (§77).
// ---------------------------------------------------------------------------

describe("Texture — construction and validation (§77, §85)", () => {
  it("exposes the source's size and data at version 0", () => {
    const source = checkerSource();
    const map = new Texture(source);

    expect(map.source).toBe(source);
    expect(map.width).toBe(2);
    expect(map.height).toBe(2);
    expect(map.data).toBe(source.data);
    expect(map.version).toBe(0);
    expect(map.disposed).toBe(false);
  });

  it("reports null data for a source that carries none", () => {
    const map = new Texture({ width: 4, height: 4 });

    expect(map.data).toBeNull();
    expect(map.width).toBe(4);
  });

  it("assigns monotonic, unique ids", () => {
    const first = texture();
    const second = texture();

    expect(first.id).toMatch(/^texture-\d+$/);
    expect(second.id).not.toBe(first.id);

    const ordinal = (t: Texture): number =>
      Number(t.id.slice("texture-".length));
    expect(ordinal(second)).toBe(ordinal(first) + 1);
  });

  it("rejects a non-integer, zero, or negative dimension (§85)", () => {
    expect(() => new Texture({ width: 0, height: 1 })).toThrow(RangeError);
    expect(() => new Texture({ width: 1, height: -2 })).toThrow(RangeError);
    expect(() => new Texture({ width: 1.5, height: 1 })).toThrow(RangeError);
    expect(() => new Texture({ width: Number.NaN, height: 1 })).toThrow(
      RangeError,
    );
  });

  it("rejects data whose length is not width · height · 4 (§77, §85)", () => {
    expect(
      () => new Texture({ width: 2, height: 2, data: new Uint8Array(15) }),
    ).toThrow(/16 bytes; got 15/);
  });
});

describe("Texture — versioning (§53's contract, reused by §77)", () => {
  it("bumps the version once when a new source is assigned", () => {
    const map = texture();

    map.source = { width: 1, height: 1, data: new Uint8Array(4) };

    expect(map.version).toBe(1);
    expect(map.width).toBe(1);
    expect(map.data).toHaveLength(4);
  });

  it("validates an assigned source and leaves the old one in place on failure", () => {
    const map = texture();
    const original = map.source;

    expect(() => {
      map.source = { width: 3, height: 3, data: new Uint8Array(4) };
    }).toThrow(RangeError);
    expect(map.source).toBe(original);
    expect(map.version).toBe(0);
  });

  it("does not see an in-place texel edit until markDirty announces it", () => {
    const map = texture();

    map.data![0] = 7;
    expect(map.version).toBe(0);

    map.markDirty();
    expect(map.version).toBe(1);
  });
});

describe("Texture — disposal (§83)", () => {
  it("drops the texel data, marks itself disposed, and bumps the version", () => {
    const map = texture();

    map.dispose();

    expect(map.disposed).toBe(true);
    expect(map.data).toBeNull();
    expect(map.version).toBe(1);
  });

  it("is idempotent", () => {
    const map = texture();

    map.dispose();
    map.dispose();

    expect(map.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sprite (§55).
// ---------------------------------------------------------------------------

describe("Sprite — defaults and validation (§55, §85)", () => {
  it("is a scene node with a centred anchor, unit size, and zero sort keys", () => {
    const material = spriteMaterial();
    const sprite = new Sprite(material);

    expect(sprite.material).toBe(material);
    expect([sprite.anchor.x, sprite.anchor.y]).toEqual([0.5, 0.5]);
    expect(sprite.width).toBe(1);
    expect(sprite.height).toBe(1);
    expect(sprite.renderLayer).toBe(0);
    expect(sprite.renderOrder).toBe(0);
    expect(sprite.visible).toBe(true);
  });

  it("takes size, anchor, and sort keys from its options", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 3,
      height: 2,
      anchor: { x: 0, y: 1 },
      renderLayer: 2,
      renderOrder: 5,
    });

    expect(sprite.width).toBe(3);
    expect(sprite.height).toBe(2);
    expect([sprite.anchor.x, sprite.anchor.y]).toEqual([0, 1]);
    expect(sprite.renderLayer).toBe(2);
    expect(sprite.renderOrder).toBe(5);
  });

  it("copies the anchor rather than holding the caller's object", () => {
    const anchor = { x: 0.25, y: 0.75 };
    const sprite = new Sprite(spriteMaterial(), { anchor });

    anchor.x = 1;

    expect(sprite.anchor.x).toBe(0.25);
  });

  it("rejects a non-positive or non-finite extent (§85)", () => {
    expect(() => new Sprite(spriteMaterial(), { width: 0 })).toThrow(
      RangeError,
    );
    expect(() => new Sprite(spriteMaterial(), { height: -1 })).toThrow(
      RangeError,
    );
    expect(
      () => new Sprite(spriteMaterial(), { width: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);

    const sprite = new Sprite(spriteMaterial());
    expect(() => {
      sprite.width = 0;
    }).toThrow(RangeError);
    expect(sprite.width).toBe(1);
  });

  it("rejects a non-finite anchor component (§85)", () => {
    expect(
      () => new Sprite(spriteMaterial(), { anchor: { x: Number.NaN, y: 0 } }),
    ).toThrow(RangeError);
    expect(() => new Sprite(spriteMaterial()).setAnchor(0, Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("Sprite — the quad built from anchor and size (§55, §7a)", () => {
  it("centres the quad on the origin at the default anchor", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 4, height: 2 });

    expect(corners(sprite)).toEqual([
      [-2, -1], // bottom-left
      [2, -1], // bottom-right
      [2, 1], // top-right
      [-2, 1], // top-left
    ]);
  });

  it("puts the bottom-left corner on the origin at anchor (0, 0) — Y-up (§7a)", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 4,
      height: 2,
      anchor: { x: 0, y: 0 },
    });

    expect(corners(sprite)).toEqual([
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ]);
  });

  it("puts the top-right corner on the origin at anchor (1, 1)", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 4,
      height: 2,
      anchor: { x: 1, y: 1 },
    });

    expect(corners(sprite)).toEqual([
      [-4, -2],
      [0, -2],
      [0, 0],
      [-4, 0],
    ]);
  });

  it("accepts an anchor outside [0, 1], placing the origin off the quad", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 2,
      height: 2,
      anchor: { x: 2, y: 0 },
    });

    expect(corners(sprite)).toEqual([
      [-4, 0],
      [-2, 0],
      [-2, 2],
      [-4, 2],
    ]);
  });

  it("winds two counter-clockwise triangles, flat in Z", () => {
    const sprite = new Sprite(spriteMaterial());

    expect(Array.from(sprite.geometry.indices!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(sprite.geometry.mode).toBe("triangles");
    expect(sprite.geometry.vertexCount).toBe(4);
    expect(sprite.geometry.drawCount).toBe(6);
    const z = [0, 1, 2, 3].map((i) => sprite.geometry.positions[i * 3 + 2]);
    expect(z).toEqual([0, 0, 0, 0]);
  });

  it("gives the geometry bounds that are exactly the quad (the backend's uv rect)", () => {
    const sprite = new Sprite(spriteMaterial(), {
      width: 3,
      height: 5,
      anchor: { x: 0, y: 0 },
    });

    const bounds = sprite.geometry.computeBounds();

    expect([bounds.min.x, bounds.min.y]).toEqual([0, 0]);
    expect([bounds.max.x, bounds.max.y]).toEqual([3, 5]);
  });
});

describe("Sprite — §55's `extends Renderable` (2026-08-06)", () => {
  it("is a Renderable, and reaches the render list through one instanceof", () => {
    const sprite = new Sprite(spriteMaterial());

    expect(sprite).toBeInstanceOf(Renderable);
    // The inherited members: the three the class used to re-declare, gone.
    expect(sprite.renderLayer).toBe(0);
    expect(sprite.renderOrder).toBe(0);
    expect(sprite.material.kind).toBe("sprite");
  });

  it("takes the layer and order options every renderable takes", () => {
    const sprite = new Sprite(spriteMaterial(), {
      renderLayer: 2,
      renderOrder: -3,
    });

    expect(sprite.renderLayer).toBe(2);
    expect(sprite.renderOrder).toBe(-3);
  });

  it("hands its own quad to the base, and keeps deriving it", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });

    // Read through the base's slot: the override is what rebuilds it, so both
    // views of `geometry` are the same live quad.
    const asRenderable: Renderable<SpriteMaterial> = sprite;
    expect(asRenderable.geometry).toBe(sprite.geometry);

    sprite.width = 4;
    expect(asRenderable.geometry).toBe(sprite.geometry);
    expect(corners(sprite)[1][0]).toBe(2);
  });
});

describe("Sprite — rebuilds (§53 version contract)", () => {
  it("keeps one geometry instance across a resize and bumps its version", () => {
    const sprite = new Sprite(spriteMaterial());
    const geometry = sprite.geometry;
    const version = geometry.version;

    sprite.width = 8;

    expect(sprite.geometry).toBe(geometry);
    expect(geometry.version).toBeGreaterThan(version);
    expect(corners(sprite)[1][0]).toBe(4);
  });

  it("rebuilds after setAnchor", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });

    sprite.setAnchor(0, 0);

    expect(corners(sprite)[0]).toEqual([0, 0]);
  });

  it("rebuilds after an in-place anchor write announced with markDirty", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });
    expect(sprite.geometry.version).toBeGreaterThan(0); // force the first build

    sprite.anchor.x = 0;
    sprite.markDirty();

    expect(corners(sprite)[0][0]).toBe(0);
  });

  it("does not notice an in-place anchor write that was never announced", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });
    expect(sprite.geometry.version).toBeGreaterThan(0); // force the first build

    sprite.anchor.x = 0;

    expect(corners(sprite)[0][0]).toBe(-1);
  });

  it("rebuilds at most once for a burst of edits", () => {
    const sprite = new Sprite(spriteMaterial());
    const version = sprite.geometry.version;

    sprite.width = 2;
    sprite.height = 3;
    sprite.setAnchor(0, 0);

    expect(sprite.geometry.version).toBe(version + 1);
  });
});

describe("Sprite — disposal (§83)", () => {
  it("disposes the quad it owns and nothing else", () => {
    const material = spriteMaterial();
    const map = material.texture;
    const sprite = new Sprite(material);
    const geometry = sprite.geometry;

    sprite.dispose();

    expect(sprite.disposed).toBe(true);
    expect(geometry.disposed).toBe(true);
    expect(geometry.drawCount).toBe(0);
    expect(material.disposed).toBe(false);
    expect(map.disposed).toBe(false);
  });

  it("is idempotent and leaves the geometry emptied", () => {
    const sprite = new Sprite(spriteMaterial());

    sprite.dispose();
    sprite.dispose();

    expect(sprite.geometry.positions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Render list (§64) with sprites.
// ---------------------------------------------------------------------------

describe("buildRenderList — sprites (§64, §55)", () => {
  function sceneWith(...nodes: (Renderable | Sprite)[]): Scene {
    const scene = new Scene();
    scene.add(...nodes);
    return scene;
  }

  it("emits a sprite item with kind 'sprite', its quad, and its material", () => {
    const material = spriteMaterial();
    const sprite = new Sprite(material, { width: 2, height: 2 });
    const out: RenderItem[] = [];

    const list = buildRenderList(sceneWith(sprite), out);

    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("sprite");
    expect(list[0].geometry).toBe(sprite.geometry);
    expect(list[0].material).toBe(material);
    expect(list[0].worldMatrix).toBe(sprite.transform.worldMatrix);
  });

  it("tags a Renderable's item 'unlit' alongside it", () => {
    const renderable = new Renderable(planeGeometry(), new UnlitMaterial());
    const out: RenderItem[] = [];

    const list = buildRenderList(
      sceneWith(renderable, new Sprite(spriteMaterial())),
      out,
    );

    expect(list.map((item) => item.kind)).toEqual(["unlit", "sprite"]);
  });

  it("narrows through isSpriteItem / isUnlitItem", () => {
    const out: RenderItem[] = [];
    const list = buildRenderList(
      sceneWith(
        new Renderable(planeGeometry(), new UnlitMaterial()),
        new Sprite(spriteMaterial()),
      ),
      out,
    );

    const sprites: SpriteRenderItem[] = list.filter(isSpriteItem);
    expect(sprites).toHaveLength(1);
    expect(sprites[0].material.tint).toEqual([1, 1, 1, 1]);
    expect(list.filter(isUnlitItem)).toHaveLength(1);
  });

  it("sorts sprites and renderables together by the §66 keys", () => {
    const behind = new Sprite(spriteMaterial(), { renderOrder: -1 });
    const front = new Sprite(spriteMaterial(), { renderLayer: 1 });
    const middle = new Renderable(planeGeometry(), new UnlitMaterial());
    const out: RenderItem[] = [];

    const list = buildRenderList(sceneWith(front, middle, behind), out);

    expect(list.map((item) => item.geometry)).toEqual([
      behind.geometry,
      middle.geometry,
      front.geometry,
    ]);
  });

  it("rebuilds a stale quad while collecting, so the item is never stale", () => {
    const sprite = new Sprite(spriteMaterial(), { width: 2, height: 2 });
    const out: RenderItem[] = [];
    buildRenderList(sceneWith(sprite), out);

    sprite.width = 6;
    const list = buildRenderList(sceneWith(sprite), out);

    expect(list[0].geometry.positions[3]).toBe(3);
  });

  it("prunes a hidden sprite exactly as it prunes a hidden renderable (§6)", () => {
    const sprite = new Sprite(spriteMaterial());
    sprite.visible = false;
    const out: RenderItem[] = [];

    expect(buildRenderList(sceneWith(sprite), out)).toHaveLength(0);
  });

  it("carries the discriminant through the §43 interpolated builder too", () => {
    const sprite = new Sprite(spriteMaterial());
    sprite.transform.position.set(1, 2, 0);
    const out: RenderItem[] = [];

    const list = buildInterpolatedRenderList(
      sceneWith(sprite),
      new PoseBuffer(),
      0.5,
      out,
    );

    expect(list[0].kind).toBe("sprite");
    expect(list[0].worldMatrix).not.toBe(sprite.transform.worldMatrix);
    expect(list[0].worldMatrix.elements[12]).toBe(1);
  });

  it("rewrites a pooled item's kind when the list changes shape", () => {
    const out: RenderItem[] = [];
    buildRenderList(sceneWith(new Sprite(spriteMaterial())), out);
    const pooled = out[0];

    const list = buildRenderList(
      sceneWith(new Renderable(planeGeometry(), new UnlitMaterial())),
      out,
    );

    // The same pooled object, re-tagged — a stale "sprite" here would send a
    // flat-colour material down the textured pipeline.
    expect(list[0]).toBe(pooled);
    expect(list[0].kind).toBe("unlit");
  });
});
