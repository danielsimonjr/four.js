/**
 * §55 sprites, §56 text and §65 batching on the WebGPU backend (WP-R1.3),
 * composed from the real packages — `@four/render`'s `Sprite` and `Texture`,
 * `@four/materials`' `SpriteMaterial`, `@four/text`'s atlas, `four`'s `Text`.
 *
 * Three families of claims:
 *
 * 1. **A sprite is the sprite pipeline**: one quad over the position stream,
 *    uv derived from the `quad` uniform (frames included — R-29's affine
 *    reparametrization), the texture through the same group-1 cache the unlit
 *    `map` variant uses.
 * 2. **Text needs no pipeline of its own** — `text-rendering.test.ts`'s R-28
 *    claims, restated in WebGPU vocabulary: a label is **one** draw through
 *    the textured unlit pipeline, its transcript is a textured `Renderable`'s
 *    over the same material, and labels over one material merge under §65
 *    with nothing taught about text.
 * 3. **Batching is the uploader behind the shared planner**: sprite runs and
 *    glyph runs collapse to one `drawIndexed`, and §84's counters show it.
 */

import { UnlitMaterial, SpriteMaterial } from "@four/materials";
import {
  Renderable,
  Sprite,
  Texture,
  createRenderStatistics,
} from "@four/render";
import { WebgpuRenderer, createWgpuBatching } from "@four/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { buildGlyphAtlas } from "@four/text";
import { Text } from "four";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

const atlas = buildGlyphAtlas();

interface Rig {
  readonly renderer: WebgpuRenderer;
  readonly gpu: RecordingGpu;
  readonly views: readonly Viewport[];
}

async function createRig(): Promise<Rig> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(64, 64, 1);
  const camera = new OrthographicCamera({
    left: -8,
    right: 8,
    bottom: -6,
    top: 6,
  });
  camera.transform.position.set(0, 0, 5);
  gpu.reset();
  return { renderer, gpu, views: [createFullscreenViewport(camera)] };
}

/** A 4 × 4 opaque texture. */
function texture(): Texture {
  return new Texture({
    width: 4,
    height: 4,
    data: new Uint8Array(4 * 4 * 4).fill(255),
  });
}

/** An unlit ink over the built-in glyph atlas (§56). */
function ink(): UnlitMaterial {
  return new UnlitMaterial({ map: new Texture(atlas), transparent: true });
}

/** The frame's uniform upload — the last `writeBuffer` of the tape. */
function uniformUpload(gpu: RecordingGpu): number[] {
  const uploads = gpu.callsOf("queue.writeBuffer");
  return uploads[uploads.length - 1]?.args[2] as number[];
}

/** The labels of every pipeline the tape compiled. */
function pipelineLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createRenderPipeline")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

describe("§55 sprites on WebGPU (WP-R1.3)", () => {
  it("draws a Sprite through the sprite pipeline, one texture at group 1", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const sprite = new Sprite(new SpriteMaterial({ texture: texture() }), {
      width: 2,
      height: 2,
    });
    scene.add(sprite);
    resolveWorldTransforms(scene);

    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.render(scene, views);

    expect(
      pipelineLabels(gpu).some((label) => label.startsWith("four:sprite|")),
    ).toBe(true);
    expect(gpu.countOf("queue.writeTexture")).toBe(1);
    expect(
      gpu.callsOf("pass.setBindGroup").filter((call) => call.args[0] === 1),
    ).toHaveLength(1);
    // The sprite quad is indexed: two triangles, one draw.
    expect(gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(6);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(2);

    // The uploaded quad uniform is the anchored rectangle: a centred 2 × 2
    // quad spans [-1, 1] on both axes.
    const data = uniformUpload(gpu);
    const quad = 64 + 36; // block 1 (256 B = 64 floats), quad at 144 B = 36 floats.
    expect(data.slice(quad, quad + 4)).toEqual([-1, -1, 2, 2]);
  });

  it("reparametrizes the quad uniform for §55's frame", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const sprite = new Sprite(new SpriteMaterial({ texture: texture() }), {
      width: 2,
      height: 2,
    });
    // The top-right 2 × 2 texel cell of the 4 × 4 texture.
    sprite.setFrame(2, 2, 2, 2);
    scene.add(sprite);
    resolveWorldTransforms(scene);
    renderer.render(scene, views);

    // The rectangle the whole texture would occupy so the quad shows the
    // frame: offset by a whole cell, twice the size.
    const data = uniformUpload(gpu);
    const quad = 64 + 36;
    expect(data.slice(quad, quad + 4)).toEqual([-3, -3, 4, 4]);
  });

  it("merges sprites sharing a material into one draw under §65", async () => {
    const { renderer, gpu, views } = await createRig();
    renderer.batching = createWgpuBatching();
    const scene = new Scene();
    const material = new SpriteMaterial({ texture: texture() });
    for (let index = 0; index < 3; index += 1) {
      const sprite = new Sprite(material);
      sprite.transform.position.set(index * 1.5 - 1.5, 0, 0);
      scene.add(sprite);
    }
    resolveWorldTransforms(scene);

    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.render(scene, views);

    // Three quads, 18 indices, one merged draw through the batch pipeline.
    expect(gpu.countOf("pass.drawIndexed")).toBe(1);
    expect(gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(18);
    expect(
      pipelineLabels(gpu).some((label) => label.startsWith("four:batch|")),
    ).toBe(true);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(6);
  });
});

describe("§56 text on WebGPU (WP-R1.3) — R-28's claims, restated", () => {
  it("draws a whole label as one textured unlit draw", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const label = new Text(atlas, ink(), { text: "Motor 42", size: 1 });
    scene.add(label);
    resolveWorldTransforms(scene);

    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.render(scene, views);

    // Seven drawn glyphs, one draw, one atlas upload — through the unlit
    // `map` variant WP-R1.2 landed, with nothing added for text.
    expect(statistics.drawCalls).toBe(1);
    expect(gpu.countOf("pass.drawIndexed")).toBe(1);
    expect(gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(42);
    expect(gpu.countOf("queue.writeTexture")).toBe(1);
    expect(
      pipelineLabels(gpu).some((label) =>
        label.startsWith("four:unlit|-|map|"),
      ),
    ).toBe(true);
  });

  it("emits the transcript of a textured renderable over the same material", async () => {
    // `Text` adds nothing to the frame path: a label and a plain `Renderable`
    // carrying the label's own geometry and material record the same
    // commands, call for call.
    const label = new Text(atlas, ink(), { text: "A", size: 2 });

    const textRig = await createRig();
    const textScene = new Scene();
    textScene.add(label);
    resolveWorldTransforms(textScene);
    textRig.renderer.render(textScene, textRig.views);

    const plainRig = await createRig();
    const plainScene = new Scene();
    plainScene.add(new Renderable(label.geometry, label.material));
    resolveWorldTransforms(plainScene);
    plainRig.renderer.render(plainScene, plainRig.views);

    expect(textRig.gpu.transcript()).toEqual(plainRig.gpu.transcript());
  });

  it("merges labels over one material into one draw — §65's glyph batching", async () => {
    const { renderer, gpu, views } = await createRig();
    renderer.batching = createWgpuBatching();
    const scene = new Scene();
    const shared = ink();
    for (let index = 0; index < 4; index += 1) {
      const label = new Text(atlas, shared, { text: "AB", size: 1 });
      label.transform.position.set(0, index * 1.5 - 3, 0);
      scene.add(label);
    }
    resolveWorldTransforms(scene);

    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    renderer.render(scene, views);

    // 4 labels × 2 glyphs × 6 indices, one merged draw.
    expect(gpu.countOf("pass.drawIndexed")).toBe(1);
    expect(gpu.callsOf("pass.drawIndexed")[0]?.args[0]).toBe(48);
    expect(statistics.drawCalls).toBe(1);
  });

  it("clips a label like any draw (§67 meets §56)", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const panel = new Renderable(
      // A quad to mask with, from the label's own vocabulary: any drawable
      // shape serves (§67's path-mask tier).
      new Text(atlas, ink(), { text: "█", size: 4 }).geometry,
      new UnlitMaterial(),
    );
    panel.clip = true;
    panel.add(new Text(atlas, ink(), { text: "clipped", size: 1 }));
    scene.add(panel);
    resolveWorldTransforms(scene);
    renderer.render(scene, views);

    const labels = pipelineLabels(gpu);
    expect(labels.some((label) => label.includes("|s:always,255,1,"))).toBe(
      true,
    );
    expect(
      labels.some(
        (label) =>
          label.startsWith("four:unlit|-|map|") &&
          label.includes("|s:equal,1,0,"),
      ),
    ).toBe(true);
  });
});
