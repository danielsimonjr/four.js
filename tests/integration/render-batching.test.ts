/**
 * §65 batching across the packages that have to agree about it (R-9,
 * 2026-08-09) — `@four/scene` builds the graph, `@four/render` plans the runs,
 * `@four/render-webgl` issues the draws.
 *
 * Three claims live only in the composition, which is why they are here rather
 * than in either package's unit suite:
 *
 * 1. **A renderer with no batcher emits the identical GL sequence** it emitted
 *    before the batcher existed, and so does a renderer *with* one over a scene
 *    that has nothing to batch. Both are asserted as full transcripts, call for
 *    call and argument for argument — the byte-identity discipline this
 *    repository applies to every frame-path change.
 * 2. **A batched frame draws the same triangles, in the same order.** The
 *    stream the backend uploads is compared against the world-space geometry
 *    computed independently in the test from the scene graph, so "the batch is
 *    the draws it replaced" is checked rather than argued.
 * 3. **§66's key 3 is what makes an interleaved scene batchable at all** — the
 *    `R-10 → R-9` dependency the gap analysis records, demonstrated on one
 *    scene by planning it twice.
 */

import { planeGeometry } from "@four/geometry";
import { Matrix4 } from "@four/math";
import { SpriteMaterial, UnlitMaterial } from "@four/materials";
import {
  RenderBatcher,
  Renderable,
  Sprite,
  Texture,
  buildRenderList,
  createRenderStatistics,
  groupRenderListByPipeline,
  resetRenderStatistics,
  type RenderItem,
} from "@four/render";
import { WebglRenderer, createGlBatching } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

/** `GL_ARRAY_BUFFER`; the backend's own `GL` record is not exported to tests. */
const ARRAY_BUFFER = 0x8892;

interface Rig {
  readonly renderer: WebglRenderer;
  readonly recording: RecordingGl;
  readonly views: readonly Viewport[];
}

async function createRig(): Promise<Rig> {
  const recording = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
  const camera = new OrthographicCamera({
    left: -8,
    right: 8,
    bottom: -6,
    top: 6,
  });
  return { renderer, recording, views: [createFullscreenViewport(camera)] };
}

/** A quad-carrying renderable at `(x, y)`, sharing whatever material it is given. */
function tile(material: UnlitMaterial, x: number, y = 0): Renderable {
  const node = new Renderable(planeGeometry({ width: 2, height: 2 }), material);
  node.transform.position.set(x, y, 0);
  return node;
}

/** A 2 × 2 opaque texture — enough for a sprite material to be legal (§55). */
function atlas(): Texture {
  return new Texture({ width: 2, height: 2 });
}

/** World-space positions of every item in the list, in list order (§7). */
function worldPositions(items: readonly RenderItem[]): number[] {
  const out: number[] = [];
  const world = new Matrix4();
  for (const item of items) {
    world.copy(item.worldMatrix);
    const e = world.elements;
    const positions = item.geometry.positions;
    for (let v = 0; v < item.geometry.vertexCount; v += 1) {
      const x = positions[v * 3];
      const y = positions[v * 3 + 1];
      const z = positions[v * 3 + 2];
      out.push(
        Math.fround(e[0] * x + e[4] * y + e[8] * z + e[12]),
        Math.fround(e[1] * x + e[5] * y + e[9] * z + e[13]),
        Math.fround(e[2] * x + e[6] * y + e[10] * z + e[14]),
      );
    }
  }
  return out;
}

/**
 * The interleaved vertex stream a batch uploaded, trimmed to `floats`.
 *
 * The **first** frame allocates the buffer's store with `bufferData`, which
 * hands GL the planner's whole staging array — longer than the batch, and
 * zero-filled past it (see `batch.ts`'s "grow and stop" pool). Later frames
 * upload exactly their own floats through the five-argument `bufferSubData`.
 * Both are read here, and both are trimmed by the caller's count.
 */
function uploadedVertices(recording: RecordingGl, floats: number): number[] {
  const call = recording
    .callsOf("bufferData")
    .find((entry) => entry.args[0] === ARRAY_BUFFER);
  if (call === undefined) throw new Error("no vertex upload was recorded");
  return Array.from(call.args[1] as ArrayLike<number>).slice(0, floats);
}

describe("§65 batching — a renderer that never opted in (R-9)", () => {
  it("emits the identical transcript with and without a batcher, when nothing batches", async () => {
    const build = (): Scene => {
      const scene = new Scene();
      // Alternating materials: no two adjacent draws share one, so the batcher
      // finds nothing anywhere in the list.
      const first = new UnlitMaterial({ color: [1, 0, 0, 1] });
      const second = new UnlitMaterial({ color: [0, 0, 1, 1] });
      scene.add(tile(first, -2), tile(second, 0), tile(first, 2));
      resolveWorldTransforms(scene);
      return scene;
    };

    const plain = await createRig();
    plain.renderer.render(build(), plain.views);
    const withBatcher = await createRig();
    withBatcher.renderer.batching = createGlBatching();
    withBatcher.renderer.render(build(), withBatcher.views);

    expect(withBatcher.recording.transcript()).toEqual(
      plain.recording.transcript(),
    );
  });

  it("emits the identical transcript for a single sprite — nothing to batch", async () => {
    const build = (): Scene => {
      const scene = new Scene();
      scene.add(new Sprite(new SpriteMaterial({ texture: atlas() })));
      resolveWorldTransforms(scene);
      return scene;
    };

    const plain = await createRig();
    plain.renderer.render(build(), plain.views);
    const withBatcher = await createRig();
    withBatcher.renderer.batching = createGlBatching();
    withBatcher.renderer.render(build(), withBatcher.views);

    expect(withBatcher.recording.countOf("drawElements")).toBe(1);
    expect(withBatcher.recording.transcript()).toEqual(
      plain.recording.transcript(),
    );
  });
});

describe("§65 batching — the merged draw is the draws it replaced", () => {
  it("uploads exactly the world-space geometry, in list order", async () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const left = tile(material, -3, 1);
    const right = tile(material, 3, -1);
    right.transform.scale.set(2, 2, 1);
    scene.add(left, right);
    resolveWorldTransforms(scene);
    const rig = await createRig();
    rig.renderer.batching = createGlBatching();
    rig.recording.reset();

    rig.renderer.render(scene, rig.views);

    const expected = worldPositions(buildRenderList(scene, []));
    expect(uploadedVertices(rig.recording, expected.length)).toEqual(expected);
    expect(rig.recording.countOf("drawElements")).toBe(1);
  });

  it("keeps §84's triangle count while collapsing its draw calls", async () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    for (let i = 0; i < 12; i += 1) {
      scene.add(tile(material, i - 6));
    }
    resolveWorldTransforms(scene);
    const rig = await createRig();
    const statistics = createRenderStatistics();
    rig.renderer.statistics = statistics;

    rig.renderer.render(scene, rig.views);
    const unbatched = { ...statistics };
    resetRenderStatistics(statistics);
    rig.renderer.batching = createGlBatching();
    rig.renderer.render(scene, rig.views);

    expect(unbatched).toEqual({ drawCalls: 12, triangles: 24, instances: 12 });
    expect(statistics).toEqual({ drawCalls: 1, triangles: 24, instances: 1 });
  });

  it("draws a thousand atlas sprites in one call", async () => {
    const scene = new Scene();
    const material = new SpriteMaterial({ texture: atlas() });
    for (let i = 0; i < 1_000; i += 1) {
      const node = new Sprite(material, { width: 0.1, height: 0.1 });
      node.transform.position.set(
        (i % 40) * 0.2 - 4,
        Math.floor(i / 40) * 0.2 - 3,
        0,
      );
      scene.add(node);
    }
    resolveWorldTransforms(scene);
    const rig = await createRig();
    const statistics = createRenderStatistics();
    rig.renderer.statistics = statistics;
    rig.renderer.batching = createGlBatching();

    rig.renderer.render(scene, rig.views);

    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(2_000);
  });

  it("is deterministic: two runs of the same scene upload the same bytes (§33)", async () => {
    const build = (): Scene => {
      const scene = new Scene();
      const material = new UnlitMaterial();
      for (let i = 0; i < 6; i += 1) {
        scene.add(tile(material, i - 3, i * 0.25));
      }
      resolveWorldTransforms(scene);
      return scene;
    };

    const one = await createRig();
    one.renderer.batching = createGlBatching();
    one.renderer.render(build(), one.views);
    const two = await createRig();
    two.renderer.batching = createGlBatching();
    two.renderer.render(build(), two.views);

    expect(two.recording.transcript()).toEqual(one.recording.transcript());
  });
});

describe("§66 key 3 unblocks §65 (R-10 → R-9)", () => {
  it("turns an interleaved scene from four draws into two batches", () => {
    const scene = new Scene();
    const first = new UnlitMaterial();
    const second = new UnlitMaterial();
    scene.add(
      tile(first, -3),
      tile(second, -1),
      tile(first, 1),
      tile(second, 3),
    );
    resolveWorldTransforms(scene);
    const items = buildRenderList(scene, []);
    const batcher = new RenderBatcher();

    // As authored: no two adjacent items share a material.
    const before = [0, 1, 2, 3].map((i) => batcher.next(items, i)?.items ?? 0);

    groupRenderListByPipeline(items);
    const after: number[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const batch = batcher.next(items, i);
      if (batch === null) continue;
      after.push(batch.items);
      i += batch.items - 1;
    }

    expect(before).toEqual([0, 0, 0, 0]);
    expect(after).toEqual([2, 2]);
  });
});
