/**
 * WP-R1.7 — §69's shadow tier and §57's stencil parity on the WebGPU backend,
 * across the packages that have to agree on them (2026-08-29).
 *
 * The cross-package half of the packet: `@four/scene` owns the light and the
 * volume (`DirectionalLight`, `DirectionalLightShadow`), `@four/render` owns
 * the collection and §49's item flags — the *same* collector and the same
 * flags the GL backend consumes — `@four/materials` owns §57's `StencilState`,
 * and `@four/render-webgpu` is where the record becomes a depth-only pass,
 * a `depth32float` map, and a `sampler_comparison` binding. The intra-package
 * halves live in `packages/render-webgpu/tests`.
 *
 * Five claims:
 *
 * 1. **A scene whose light does not cast is byte-identical.** The whole
 *    feature is gated on `SceneLights.hasShadow`, and a non-casting frame
 *    records the exact tape it records with the shadow tier absent — asserted
 *    as an A/B over the real scene classes, not a recording of the past.
 * 2. **Switching the light on renders a map and samples it** — one extra
 *    render pass into the samplable `depth32float` target, the light's own
 *    matrix in the block tail, and the comparison-sampler variant of the lit
 *    module.
 * 3. **§49's two flags reach the GPU** — a caster that opted out is not
 *    drawn into the map, and a receiver that opted out draws through the
 *    plain landed pipeline, not the `|sh:y` variant.
 * 4. **A sprite casts nothing** — a depth-only pass would cast the §55
 *    rectangle rather than the texture (`gl-shadow.ts`'s rule, mirrored).
 * 5. **R-7's mask-by-hand tier reaches the hardware on a clipless frame** —
 *    R1.3's recorded residue, retired: a §57 `StencilState` alone now selects
 *    the stencil-carrying format on screen, with no renderer option (WebGPU
 *    has none, deliberately) and no clip.
 */

import { boxGeometry, planeGeometry } from "@four/geometry";
import {
  LitMaterial,
  SpriteMaterial,
  StencilState,
  UnlitMaterial,
} from "@four/materials";
import { Matrix4 } from "@four/math";
import { Renderable, Sprite, Texture } from "@four/render";
import { WebgpuRenderer } from "@four/render-webgpu";
import {
  SHADOW_MATRIX_OFFSET,
  SHADOW_PARAMS_OFFSET,
} from "@four/render-webgpu";
import {
  DirectionalLight,
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

interface Rig {
  readonly renderer: WebgpuRenderer;
  readonly gpu: RecordingGpu;
  readonly scene: Scene;
  readonly views: readonly Viewport[];
}

/** The 8 × 8 orthographic rig the other WebGPU suites use. */
async function createRig(): Promise<Rig> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);
  gpu.reset();
  return { renderer, gpu, scene, views: [createFullscreenViewport(camera)] };
}

/** A ground plane and a caster box, lit — §69's canonical scene. */
function populate(
  scene: Scene,
  castShadow: boolean,
): {
  sun: DirectionalLight;
  ground: Renderable;
  box: Renderable;
} {
  const sun = new DirectionalLight({ intensity: 2, castShadow });
  sun.transform.position.set(0, 5, 0);
  scene.add(sun);
  const ground = new Renderable(
    planeGeometry({ width: 6, height: 6 }),
    new LitMaterial({ color: [0.8, 0.8, 0.8, 1] }),
  );
  scene.add(ground);
  const box = new Renderable(
    boxGeometry({ width: 1, height: 1, depth: 1 }),
    new LitMaterial({ color: [0.5, 0.2, 0.2, 1] }),
  );
  box.transform.position.set(0, 1, 0);
  scene.add(box);
  resolveWorldTransforms(scene);
  return { sun, ground, box };
}

/** The recorded render-pass labels, in order. */
function passLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("encoder.beginRenderPass")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The labels of every WGSL module the tape compiled. */
function moduleLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createShaderModule")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The labels of every pipeline the tape created. */
function pipelineLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createRenderPipeline")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The frame's lights upload — the last `writeBuffer` of a shaded frame. */
function lightsUpload(gpu: RecordingGpu): number[] {
  const uploads = gpu.callsOf("queue.writeBuffer");
  const last = uploads[uploads.length - 1];
  if (last === undefined) {
    throw new Error("the frame uploaded nothing");
  }
  return last.args[2] as number[];
}

describe("WP-R1.7 — a non-casting scene is byte-identical (claim 1)", () => {
  it("records the same tape whether the shadow tier was toggled off or never touched", async () => {
    // The A/B: one sun never asked to cast; the other was constructed
    // casting and switched off before the frame. `hasShadow` gates the whole
    // tier, so the two frames must be the identical command sequence — which
    // is also the sequence every pre-R1.7 lit scene recorded, since a
    // non-casting frame touches no shadow object at all. The two rigs share
    // the geometry objects, so the tapes agree about ids too and the
    // comparison is full-tape.
    const ground = planeGeometry({ width: 6, height: 6 });
    const box = boxGeometry({ width: 1, height: 1, depth: 1 });
    const render = async (touched: boolean): Promise<string[]> => {
      const rig = await createRig();
      const sun = new DirectionalLight({ intensity: 2, castShadow: touched });
      sun.transform.position.set(0, 5, 0);
      rig.scene.add(sun);
      rig.scene.add(
        new Renderable(ground, new LitMaterial({ color: [0.8, 0.8, 0.8, 1] })),
      );
      rig.scene.add(
        new Renderable(box, new LitMaterial({ color: [0.5, 0.2, 0.2, 1] })),
      );
      resolveWorldTransforms(rig.scene);
      if (touched) {
        sun.shadow.mapSize = 512;
        sun.castShadow = false;
      }
      rig.renderer.render(rig.scene, rig.views);
      return rig.gpu.transcript();
    };
    const untouched = await render(false);
    const toggledOff = await render(true);
    expect(toggledOff).toEqual(untouched);
    const tape = untouched.join("\n");
    expect(tape).not.toContain("four:shadow");
    expect(tape).not.toContain("sampler_comparison");
    expect(tape).not.toContain("depth32float");
  });
});

describe("WP-R1.7 — a casting light renders a map and samples it (claims 2–4)", () => {
  it("adds the caster pass, the samplable map, and the comparison variant", async () => {
    const rig = await createRig();
    const { sun } = populate(rig.scene, true);
    sun.shadow.mapSize = 512;
    sun.shadow.bias = 0.002;
    sun.shadow.normalBias = 0.01;
    rig.renderer.render(rig.scene, rig.views);

    // One shadow pass before the views pass.
    expect(passLabels(rig.gpu)).toEqual(["four:shadow", "four:views"]);

    // The map is the R1.6 samplable row: depth32float, TEXTURE_BINDING.
    const depthAllocation = rig.gpu
      .callsOf("device.createTexture")
      .map(
        (call) =>
          call.args[0] as { label?: string; format?: string; size?: number[] },
      )
      .find((descriptor) =>
        String(descriptor.label).startsWith("four:render-target-depth:"),
      );
    expect(depthAllocation?.format).toBe("depth32float");
    expect(depthAllocation?.size).toEqual([512, 512]);

    // The receivers compile the shadowed variant, whose module carries the
    // distinct binding types GL has no analogue for.
    expect(moduleLabels(rig.gpu)).toEqual(
      expect.arrayContaining(["four:shadow", "four:lit|n|sh"]),
    );
    const shadowedModule = rig.gpu
      .callsOf("device.createShaderModule")
      .map((call) => call.args[0] as { label?: string; code?: string })
      .find((descriptor) => descriptor.label === "four:lit|n|sh");
    expect(shadowedModule?.code).toContain("texture_depth_2d");
    expect(shadowedModule?.code).toContain("sampler_comparison");
    expect(shadowedModule?.code).toContain("textureSampleCompareLevel");

    // The light's own matrix and settings ride the block tail, exactly as
    // the scene computed them.
    const floats = lightsUpload(rig.gpu);
    const expected = new Matrix4();
    sun.computeShadowMatrix(expected);
    const matrixBase = SHADOW_MATRIX_OFFSET / 4;
    for (let index = 0; index < 16; index += 1) {
      expect(floats[matrixBase + index]).toBe(
        Math.fround(expected.elements[index]),
      );
    }
    const params = SHADOW_PARAMS_OFFSET / 4;
    expect(floats[params]).toBe(Math.fround(0.002));
    expect(floats[params + 1]).toBe(Math.fround(0.01));
    expect(floats[params + 2]).toBe(Math.fround(1 / 512));
  });

  it("honours §49's two flags and the sprite exclusion on the GPU", async () => {
    const rig = await createRig();
    const { ground, box } = populate(rig.scene, true);
    // The ground occludes nothing useful and opts out of casting; the box
    // opts out of receiving; the sprite may not cast its rectangle.
    ground.castShadow = false;
    box.receiveShadow = false;
    const texture = new Texture({
      width: 2,
      height: 2,
      data: new Uint8Array(16),
    });
    rig.scene.add(
      new Sprite(new SpriteMaterial({ texture }), { width: 1, height: 1 }),
    );
    resolveWorldTransforms(rig.scene);
    rig.renderer.render(rig.scene, rig.views);

    // Caster pass draws exactly one item: the box.
    const names = rig.gpu.calls.map((call) => call.name);
    const shadowStart = names.indexOf("encoder.beginRenderPass");
    const viewsStart = names.indexOf(
      "encoder.beginRenderPass",
      shadowStart + 1,
    );
    const casterDraws = names
      .slice(shadowStart, viewsStart)
      .filter((name) => name === "pass.draw" || name === "pass.drawIndexed");
    expect(casterDraws).toHaveLength(1);

    // The ground receives (|sh:y); the box draws the plain landed pipeline.
    const labels = pipelineLabels(rig.gpu);
    expect(labels.some((label) => label.endsWith("|n:y|sh:y"))).toBe(true);
    expect(
      labels.some(
        (label) => label.startsWith("four:lit") && label.endsWith("|n:y"),
      ),
    ).toBe(true);
  });
});

describe("WP-R1.7 — §57 stencil parity on clipless frames (claim 5)", () => {
  it("lets a StencilState alone select the stencil format and reach hardware", async () => {
    const rig = await createRig();
    // R-7's composition, by hand and clipless: a mask that writes bit 1 with
    // colour off, and a fill that tests `equal` — the two materials the
    // browser parity spec rasterises.
    const mask = new Renderable(
      planeGeometry({ width: 2, height: 2 }),
      new UnlitMaterial({
        color: [0, 0, 0, 0],
        colorWrite: false,
        depthWrite: false,
        stencil: new StencilState({
          func: "always",
          ref: 1,
          passOp: "replace",
        }),
      }),
    );
    rig.scene.add(mask);
    const fill = new Renderable(
      planeGeometry({ width: 6, height: 4 }),
      new UnlitMaterial({
        color: [0.95, 0.45, 0.1, 1],
        stencil: new StencilState({ func: "equal", ref: 1, writeMask: 0 }),
      }),
    );
    fill.transform.position.set(0, 0, -0.5);
    rig.scene.add(fill);
    resolveWorldTransforms(rig.scene);
    rig.renderer.render(rig.scene, rig.views);

    const tape = rig.gpu.transcript().join("\n");
    // The frame allocated the stencil-carrying format with no clip in the
    // scene and no option on the renderer (there is none), cleared its
    // planes per view, baked both records, and set the shared reference.
    expect(tape).toContain("depth24plus-stencil8");
    expect(tape).toContain('"stencilLoadOp":"load"');
    expect(tape).toContain('"compare":"always"');
    expect(tape).toContain('"compare":"equal"');
    expect(
      rig.gpu.callsOf("pass.setStencilReference").map((call) => call.args[0]),
    ).toEqual([1]);
  });

  it("keeps a stencil-less scene free of every stencil spelling", async () => {
    const rig = await createRig();
    rig.scene.add(
      new Renderable(
        planeGeometry({ width: 2, height: 2 }),
        new UnlitMaterial({ color: [1, 1, 1, 1] }),
      ),
    );
    resolveWorldTransforms(rig.scene);
    rig.renderer.render(rig.scene, rig.views);
    const tape = rig.gpu.transcript().join("\n");
    expect(tape).not.toContain("depth24plus-stencil8");
    expect(tape).not.toContain("stencilLoadOp");
    expect(tape).not.toContain("stencilFront");
  });
});
