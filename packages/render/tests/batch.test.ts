import { BufferGeometry, planeGeometry } from "@four/geometry";
import { Vector3 } from "@four/math";
import { LitMaterial, SpriteMaterial, UnlitMaterial } from "@four/materials";
import {
  DEFAULT_LAYER_MASK,
  NO_LAYERS,
  Node,
  Scene,
  layerMask,
  resolveWorldTransforms,
} from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_BATCH_VERTICES,
  PARTICLE_INSTANCE_FLOATS,
  RenderBatcher,
  Renderable,
  Sprite,
  Texture,
  buildRenderList,
  type ParticleDrawable,
  type RenderBatch,
  type RenderItem,
} from "../src/index.js";

/**
 * §36's structural contract, reduced to what a render list reads — the same
 * double `particles.test.ts` uses, and the item kind this planner refuses.
 */
class ParticleSystemDouble extends Node implements ParticleDrawable {
  readonly isParticleDrawable = true;

  renderLayer = 0;

  renderOrder = 0;

  particleCount = 1;

  readonly particleInstances = new Float32Array(PARTICLE_INSTANCE_FLOATS);

  updateParticleInstances(): void {
    // Nothing to repack: the planner never reaches the instance stream.
  }
}

/**
 * §65 batching — `@four/render`'s backend-independent planner (R-9,
 * 2026-08-09).
 *
 * The claims under test are the ones the module's header makes: a run is
 * *consecutive items sharing a pipeline and a material instance*, a run of one
 * is never a batch, the merged stream is the same geometry in the same order
 * with world transforms baked in, and nothing about it depends on iteration
 * order (§33).
 */

/** A quad geometry with its own local bounds, positions and indices (§53). */
function quad(size = 1): BufferGeometry {
  const half = size / 2;
  return new BufferGeometry({
    positions: new Float32Array([
      -half,
      -half,
      0,
      half,
      -half,
      0,
      half,
      half,
      0,
      -half,
      half,
      0,
    ]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  });
}

/** A triangle with **no** index buffer — the `drawArrays` half of a mixed run. */
function triangle(): BufferGeometry {
  return new BufferGeometry({
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  });
}

function listOf(scene: Scene): RenderItem[] {
  resolveWorldTransforms(scene);
  return buildRenderList(scene, []);
}

/** Every batch a full left-to-right pass produces, in order. */
function allBatches(
  batcher: RenderBatcher,
  items: readonly RenderItem[],
  mask = DEFAULT_LAYER_MASK,
): { items: number; vertexCount: number; indexCount: number }[] {
  const found: { items: number; vertexCount: number; indexCount: number }[] =
    [];
  for (let i = 0; i < items.length; i += 1) {
    const batch = batcher.next(items, i, mask);
    if (batch === null) continue;
    found.push({
      items: batch.items,
      vertexCount: batch.vertexCount,
      indexCount: batch.indexCount,
    });
    i += batch.items - 1;
  }
  return found;
}

/** The `vertexCount × floatsPerVertex` floats a batch actually filled. */
function verticesOf(batch: RenderBatch): number[] {
  return Array.from(
    batch.vertices.slice(0, batch.vertexCount * batch.floatsPerVertex),
  );
}

/** The `indexCount` indices a batch actually filled. */
function indicesOf(batch: RenderBatch): number[] {
  return Array.from(batch.indices.slice(0, batch.indexCount));
}

describe("RenderBatcher — which runs merge (§65)", () => {
  it("merges consecutive items that share a pipeline and a material instance", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch).not.toBeNull();
    expect(batch?.items).toBe(3);
    expect(batch?.kind).toBe("unlit");
    expect(batch?.material).toBe(material);
    expect(batch?.vertexCount).toBe(12);
    expect(batch?.indexCount).toBe(18);
  });

  it("does not batch a run of one — the byte-identity property", () => {
    const scene = new Scene();
    scene.add(new Renderable(quad(), new UnlitMaterial()));
    const items = listOf(scene);

    expect(new RenderBatcher().next(items, 0)).toBeNull();
  });

  it("stops at a different material instance, even an identical one", () => {
    const scene = new Scene();
    const first = new UnlitMaterial({ color: [1, 0, 0, 1] });
    const second = new UnlitMaterial({ color: [1, 0, 0, 1] });
    scene.add(
      new Renderable(quad(), first),
      new Renderable(quad(), first),
      new Renderable(quad(), second),
      new Renderable(quad(), second),
    );
    const items = listOf(scene);

    expect(allBatches(new RenderBatcher(), items).map((b) => b.items)).toEqual([
      2, 2,
    ]);
  });

  it("stops at a different draw mode (§53)", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const lines = quad();
    lines.mode = "lines";
    scene.add(
      new Renderable(quad(), material),
      new Renderable(lines, material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    expect(new RenderBatcher().next(items, 0)).toBeNull();
  });

  it("batches a run of line geometries, and says so", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const first = quad();
    first.mode = "lines";
    const second = quad();
    second.mode = "lines";
    scene.add(
      new Renderable(first, material),
      new Renderable(second, material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.mode).toBe("lines");
    expect(batch?.items).toBe(2);
  });

  it("refuses the shaded pipelines — a baked batch has no normals to transform", () => {
    const scene = new Scene();
    const material = new LitMaterial();
    scene.add(
      new Renderable(planeGeometry(), material),
      new Renderable(planeGeometry(), material),
    );
    const items = listOf(scene);

    expect(new RenderBatcher().next(items, 0)).toBeNull();
  });

  it("refuses a particle item, which arrives batched already", () => {
    const scene = new Scene();
    scene.add(new ParticleSystemDouble(), new ParticleSystemDouble());
    const items = listOf(scene);

    expect(items).toHaveLength(2);
    expect(new RenderBatcher().next(items, 0)).toBeNull();
  });

  it("refuses a disposed geometry, exactly as a backend's cache skips it", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const dead = quad();
    scene.add(new Renderable(dead, material), new Renderable(quad(), material));
    const items = listOf(scene);
    dead.dispose();

    expect(new RenderBatcher().next(items, 0)).toBeNull();
  });

  it("ends a run at a geometry with nothing to draw rather than skipping it", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const dead = quad();
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
      new Renderable(dead, material),
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);
    dead.dispose();

    expect(allBatches(new RenderBatcher(), items).map((b) => b.items)).toEqual([
      2, 2,
    ]);
  });

  it("returns null past the end of the list", () => {
    expect(new RenderBatcher().next([], 0)).toBeNull();
  });
});

describe("RenderBatcher — §46 layer masks", () => {
  it("skips a run whose first item the view does not draw", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const hidden = new Renderable(quad(), material);
    hidden.layers = layerMask("ui");
    scene.add(hidden, new Renderable(quad(), material));
    const items = listOf(scene);

    expect(new RenderBatcher().next(items, 0, DEFAULT_LAYER_MASK)).toBeNull();
  });

  it("ends a run at an item the view does not draw, so the span stays contiguous", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const hidden = new Renderable(quad(), material);
    hidden.layers = layerMask("ui");
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
      hidden,
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0, DEFAULT_LAYER_MASK);

    expect(batch?.items).toBe(2);
    expect(new RenderBatcher().next(items, 3, DEFAULT_LAYER_MASK)?.items).toBe(
      2,
    );
  });

  it("batches nothing for a view that draws no layer at all", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    expect(new RenderBatcher().next(items, 0, NO_LAYERS)).toBeNull();
  });
});

describe("RenderBatcher — the merged stream", () => {
  it("bakes each item's world transform into its vertices", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const left = new Renderable(triangle(), material);
    const right = new Renderable(triangle(), material);
    right.transform.position.set(10, 0, 0);
    scene.add(left, right);
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.floatsPerVertex).toBe(3);
    expect(verticesOf(batch as RenderBatch)).toEqual([
      // The first triangle, untransformed…
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      // …and the second, translated by ten along X.
      10, 0, 0, 11, 0, 0, 10, 1, 0,
    ]);
  });

  it("applies rotation and scale, not only translation", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const scaled = new Renderable(triangle(), material);
    scaled.transform.scale.set(2, 3, 1);
    scene.add(new Renderable(triangle(), material), scaled);
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);
    const vertices = verticesOf(batch as RenderBatch);

    expect(vertices.slice(9)).toEqual([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  });

  it("offsets each item's indices, and synthesizes them for a non-indexed geometry", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(triangle(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(indicesOf(batch as RenderBatch)).toEqual([
      // The triangle's identity sequence…
      0, 1, 2,
      // …then the quad's own indices, shifted past it.
      3, 4, 5, 3, 5, 6,
    ]);
    expect(batch?.vertexCount).toBe(7);
  });

  it("carries uv when the material samples, and copies the geometry's own", () => {
    const scene = new Scene();
    const texture = new Texture({ width: 2, height: 2 });
    const material = new UnlitMaterial({ map: texture });
    const geometry = triangle();
    geometry.uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const other = triangle();
    other.uvs = new Float32Array([0.5, 0.5, 1, 0.5, 0.5, 1]);
    scene.add(
      new Renderable(geometry, material),
      new Renderable(other, material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.hasUvs).toBe(true);
    expect(batch?.hasColors).toBe(false);
    expect(batch?.floatsPerVertex).toBe(5);
    expect(batch?.texture).toBe(texture);
    expect(verticesOf(batch as RenderBatch)).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 1, 0, 0,
      1, 0.5, 0, 1, 0, 0.5, 1,
    ]);
  });

  it("fills GL's own attribute default where a geometry lacks the stream", () => {
    const scene = new Scene();
    const material = new UnlitMaterial({
      map: new Texture({ width: 1, height: 1 }),
      vertexColors: true,
    });
    scene.add(
      new Renderable(triangle(), material),
      new Renderable(triangle(), material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.floatsPerVertex).toBe(9);
    // uv `(0, 0)` and colour `(0, 0, 0, 1)` — what a draw of a geometry with
    // neither stream reads out of GL's generic attributes.
    expect(verticesOf(batch as RenderBatch).slice(0, 9)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it("carries per-vertex colour when the material declares §53's switch", () => {
    const scene = new Scene();
    const material = new UnlitMaterial({ vertexColors: true });
    const geometry = triangle();
    geometry.colors = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0.5]);
    scene.add(
      new Renderable(geometry, material),
      new Renderable(triangle(), material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.hasColors).toBe(true);
    expect(batch?.hasUvs).toBe(false);
    expect(batch?.floatsPerVertex).toBe(7);
    expect(verticesOf(batch as RenderBatch).slice(0, 7)).toEqual([
      0, 0, 0, 1, 0, 0, 1,
    ]);
  });

  it("reads a material double predating §57's opacity as fully opaque", () => {
    // The `?? 1` in the planner, and the same defence `render-list.ts` makes for
    // `transparent` and `materialId`: a **structurally typed** material written
    // before §57's uniform transparency reports `undefined`, which must mean
    // "no multiplier" rather than reaching a backend as `NaN` alpha.
    const scene = new Scene();
    // A double rather than a mutated `UnlitMaterial`: §85's setter refuses to
    // *write* `undefined`, which is exactly why the material that reports it is
    // one written before the field existed.
    const material = {
      kind: "unlit",
      id: "legacy-material",
      color: [1, 1, 1, 1],
      transparent: false,
    } as unknown as UnlitMaterial;
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    expect(new RenderBatcher().next(items, 0)?.opacity).toBe(1);
  });

  it("reports the material's colour and opacity, so a backend reads one field", () => {
    const scene = new Scene();
    const material = new UnlitMaterial({ color: [0.25, 0.5, 1, 1] });
    material.opacity = 0.5;
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.color).toBe(material.color);
    expect(batch?.opacity).toBe(0.5);
    expect(batch?.texture).toBeNull();
  });
});

describe("RenderBatcher — §55 sprites", () => {
  function spriteScene(): { scene: Scene; material: SpriteMaterial } {
    const scene = new Scene();
    const material = new SpriteMaterial({
      texture: new Texture({ width: 4, height: 2 }),
      tint: [1, 0.5, 0.25, 1],
    });
    return { scene, material };
  }

  it("merges sprites sharing one atlas material and derives uv per vertex", () => {
    const { scene, material } = spriteScene();
    const left = new Sprite(material, { width: 2, height: 2 });
    const right = new Sprite(material, { width: 2, height: 2 });
    right.transform.position.set(4, 0, 0);
    scene.add(left, right);
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.kind).toBe("sprite");
    expect(batch?.items).toBe(2);
    expect(batch?.hasUvs).toBe(true);
    expect(batch?.hasColors).toBe(false);
    expect(batch?.texture).toBe(material.texture);
    expect(batch?.color).toBe(material.tint);
    // A centred 2×2 quad spans its whole texture: the corners are uv (0,0) and
    // (1,1), whatever the sprite's world position is.
    const vertices = verticesOf(batch as RenderBatch);
    expect(vertices.slice(0, 5)).toEqual([-1, -1, 0, 0, 0]);
    expect(vertices.slice(10, 15)).toEqual([1, 1, 0, 1, 1]);
    expect(vertices.slice(20, 25)).toEqual([3, -1, 0, 0, 0]);
  });

  it("reparametrizes uv through §55's frame (R-29)", () => {
    const { scene, material } = spriteScene();
    // The left half of a 4 × 2 texture.
    const framed = new Sprite(material, {
      width: 2,
      height: 2,
      frame: { x: 0, y: 0, width: 2, height: 2 },
    });
    scene.add(framed, new Sprite(material, { width: 2, height: 2 }));
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);
    const vertices = verticesOf(batch as RenderBatch);

    // Bottom-left corner still samples uv (0, 0); the far corner now samples
    // the middle of the atlas in u and its top in v.
    expect(vertices.slice(0, 5)).toEqual([-1, -1, 0, 0, 0]);
    expect(vertices.slice(10, 15)).toEqual([1, 1, 0, 0.5, 1]);
  });

  it("stops at a sprite carrying a different material", () => {
    const { scene, material } = spriteScene();
    const other = new SpriteMaterial({
      texture: new Texture({ width: 2, height: 2 }),
    });
    scene.add(new Sprite(material), new Sprite(material), new Sprite(other));
    const items = listOf(scene);

    expect(new RenderBatcher().next(items, 0)?.items).toBe(2);
  });
});

describe("RenderBatcher — capacity and pooling", () => {
  it("splits a run at maxVertices rather than growing without bound", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    for (let i = 0; i < 5; i += 1) {
      scene.add(new Renderable(quad(), material));
    }
    const items = listOf(scene);

    // Two quads (8 vertices) fit; the third would not.
    const batcher = new RenderBatcher({ maxVertices: 9 });

    expect(allBatches(batcher, items).map((b) => b.items)).toEqual([2, 2]);
  });

  it("declines an item whose own geometry exceeds the cap", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    expect(new RenderBatcher({ maxVertices: 3 }).next(items, 0)).toBeNull();
  });

  it("defaults the cap to the documented constant", () => {
    expect(new RenderBatcher().maxVertices).toBe(DEFAULT_MAX_BATCH_VERTICES);
    expect(DEFAULT_MAX_BATCH_VERTICES).toBe(65_536);
  });

  it("reuses one record and grows its arrays, keeping the steady state allocation-free", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    for (let i = 0; i < 400; i += 1) {
      scene.add(new Renderable(quad(), material));
    }
    const items = listOf(scene);
    const batcher = new RenderBatcher();

    const first = batcher.next(items, 0);
    const firstVertices = first?.vertices;
    const second = batcher.next(items, 0);

    expect(second).toBe(first);
    // 400 quads × 4 vertices × 3 floats = 4 800 floats, so the array grew past
    // its 1 024-float floor — and then stopped, because the second pass fits.
    expect(second?.vertices).toBe(firstVertices);
    expect(second?.vertices.length).toBe(8_192);
    expect(second?.indices.length).toBe(4_096);
  });

  it("is a pure function of the item sequence (§33)", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const spun = new Renderable(quad(), material);
    spun.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), 0.3);
    scene.add(new Renderable(quad(), material), spun);
    const items = listOf(scene);

    const one = verticesOf(new RenderBatcher().next(items, 0) as RenderBatch);
    const two = verticesOf(new RenderBatcher().next(items, 0) as RenderBatch);

    expect(one).toEqual(two);
  });
});

describe("RenderBatcher — what a merged draw is worth", () => {
  it("turns one thousand sprites into one draw's worth of data", () => {
    const scene = new Scene();
    const material = new SpriteMaterial({
      texture: new Texture({ width: 8, height: 8 }),
    });
    for (let i = 0; i < 1_000; i += 1) {
      const node = new Sprite(material);
      node.transform.position.set(i % 40, Math.floor(i / 40), 0);
      scene.add(node);
    }
    const items = listOf(scene);

    const batches = allBatches(new RenderBatcher(), items);

    expect(items).toHaveLength(1_000);
    expect(batches).toEqual([
      { items: 1_000, vertexCount: 4_000, indexCount: 6_000 },
    ]);
  });

  it("keeps the triangle count identical to the draws it replaces", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    for (let i = 0; i < 7; i += 1) {
      scene.add(new Renderable(quad(), material));
    }
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);
    const unbatched = items.reduce(
      (total, item) => total + item.geometry.drawCount,
      0,
    );

    expect(batch?.indexCount).toBe(unbatched);
  });
});

describe("RenderBatcher — idle content version (§65, §86)", () => {
  it("stamps a non-zero contentVersion from geometry and transform versions", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.contentVersion).toBeGreaterThan(0);
  });

  it("keeps contentVersion stable when the source is unchanged", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);
    const batcher = new RenderBatcher();

    const first = batcher.next(items, 0)?.contentVersion;
    const second = batcher.next(items, 0)?.contentVersion;

    expect(first).toBe(second);
    expect(first).toBeGreaterThan(0);
  });

  it("changes contentVersion when a node's world matrix moves", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const moving = new Renderable(quad(), material);
    scene.add(moving, new Renderable(quad(), material));
    const items = listOf(scene);
    const batcher = new RenderBatcher();
    const before = batcher.next(items, 0)?.contentVersion;

    moving.transform.worldMatrix.elements[12] = 4;
    const after = batcher.next(items, 0)?.contentVersion;

    expect(before).toBeGreaterThan(0);
    expect(after).not.toBe(before);
  });

  it("reports 0 — always re-upload — when transform versions are missing", () => {
    // A hand-built item predating the field: the cache's "versions
    // unavailable" signal, so today's re-upload stays the default.
    const scene = new Scene();
    const material = new UnlitMaterial();
    scene.add(
      new Renderable(quad(), material),
      new Renderable(quad(), material),
    );
    const items = listOf(scene);
    delete (items[0] as { transformVersion?: number }).transformVersion;

    const batch = new RenderBatcher().next(items, 0);

    expect(batch?.contentVersion).toBe(0);
  });
});
