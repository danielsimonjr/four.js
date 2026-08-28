/**
 * WP-R1.6's off-screen tier across the packages that have to agree about it,
 * on the WebGPU backend — the restatement of `render-to-texture.test.ts`,
 * `render-effects.test.ts` and `render-graph.test.ts`'s composition claims in
 * the vocabulary this backend speaks:
 *
 * 1. **A target rendered into is a texture sampled from** (R-4's point): a
 *    real `RenderTarget` drawn by one pass feeds a real material's `map` in
 *    the next, with no texel upload anywhere — the pixels never leave the
 *    device.
 * 2. **The graph is a driver here too** (R-5): `RenderGraph.execute` over
 *    this backend emits the identical command transcript as the hand-written
 *    `render` + `renderEffect` sequence it replaces — the byte-identity
 *    discipline, applied to orchestration.
 * 3. **The validator's `"feedback"` and the backend's refusal are one rule**
 *    (R-4): the graph names the pass statically, and the backend then draws
 *    nothing for it.
 * 4. **`readPixels` is the honest asynchronous whole-target form** (§61,
 *    RFC 0005), 256-byte-aligned on the wire and tightly packed in the
 *    result.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  COPY_EFFECT,
  RenderGraph,
  RenderTarget,
  Renderable,
  supportsScreenEffects,
} from "@four/render";
import { WebgpuRenderer } from "@four/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
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
  readonly views: readonly Viewport[];
}

/** An initialized renderer over a recording device, with one fullscreen view. */
async function createRig(): Promise<Rig> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(64, 64, 1);
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
    near: 0.1,
    far: 10,
  });
  camera.position.set(0, 0, 5);
  gpu.reset();
  return { renderer, gpu, views: [createFullscreenViewport(camera)] };
}

/** A world scene: one plain plane. */
function worldScene(): Scene {
  const scene = new Scene();
  scene.add(
    new Renderable(
      planeGeometry({ width: 1, height: 1 }),
      new UnlitMaterial({ color: [1, 0, 0, 1] }),
    ),
  );
  return scene;
}

/** A composite scene: one plane sampling `target`'s colour attachment. */
function compositeScene(target: RenderTarget): Scene {
  const scene = new Scene();
  scene.add(
    new Renderable(
      planeGeometry({ width: 2, height: 2 }),
      new UnlitMaterial({ color: [1, 1, 1, 1], map: target.colorTexture }),
    ),
  );
  return scene;
}

describe("WebGPU render-to-texture, composed from the real packages", () => {
  it("draws into a target, then samples it, with no texel ever uploaded", async () => {
    const { renderer, gpu, views } = await createRig();
    const target = new RenderTarget({ width: 32, height: 32 });
    const world = worldScene();
    const composite = compositeScene(target);

    renderer.render(world, views, undefined, target);
    renderer.render(composite, views);
    renderer.render(composite, views);

    // The pixels live in the attachment; there is nothing to upload (R-4).
    expect(gpu.countOf("queue.writeTexture")).toBe(0);
    // One target allocation, one sampling bind group, three submits.
    expect(
      gpu
        .callsOf("device.createTexture")
        .filter((call) =>
          String((call.args[0] as { label?: string }).label).startsWith(
            "four:render-target:",
          ),
        ),
    ).toHaveLength(1);
    expect(
      gpu
        .callsOf("device.createBindGroup")
        .filter((call) =>
          String((call.args[0] as { label?: string }).label).startsWith(
            "four:render-target-map:",
          ),
        ),
    ).toHaveLength(1);
    expect(gpu.countOf("queue.submit")).toBe(3);

    renderer.dispose();
    target.dispose();
  });

  it("executes a world → effect graph as exactly the hand-written call sequence", async () => {
    const target = new RenderTarget({ width: 64, height: 64 });
    const world = worldScene();

    // Hand-written sequence, recorded.
    const byHand = await createRig();
    byHand.renderer.render(world, byHand.views, undefined, target);
    byHand.renderer.renderEffect({
      kind: "effect",
      source: target.colorTexture,
      effect: { kind: "grade", exposure: 1.25 },
    });
    const handTape = byHand.gpu.transcript();
    byHand.renderer.dispose();

    // The same two passes as a graph, over a fresh renderer and device.
    const byGraph = await createRig();
    expect(supportsScreenEffects(byGraph.renderer)).toBe(true);
    const graph = new RenderGraph();
    graph.addPass("world", { root: world, views: byGraph.views, target });
    graph.addPass(
      "grade",
      {
        kind: "effect",
        source: target.colorTexture,
        effect: { kind: "grade", exposure: 1.25 },
      },
      { inputs: ["world"] },
    );
    expect(graph.validate()).toEqual([]);
    expect(graph.execute(byGraph.renderer)).toBe(2);

    // Full-tape identity: handle serials and uniform bytes included, the
    // strongest form the recording double supports (WP-R1.4's standard).
    expect(byGraph.gpu.transcript()).toEqual(handTape);
    byGraph.renderer.dispose();
    target.dispose();
  });

  it("names a feedback pass statically, and the backend then draws nothing for it", async () => {
    const { renderer, gpu, views } = await createRig();
    const target = new RenderTarget({ width: 32, height: 32 });
    const graph = new RenderGraph();
    graph.addPass("world", { root: worldScene(), views, target });
    // A copy whose destination is its own source: the mistake §70 refuses.
    graph.addPass(
      "loop",
      {
        kind: "effect",
        source: target.colorTexture,
        effect: COPY_EFFECT,
        target,
      },
      { inputs: ["world"] },
    );

    const issues = graph.validate();
    expect(issues.map((issue) => issue.code)).toContain("feedback");

    gpu.reset();
    graph.execute(renderer);
    // The world pass ran; the feedback pass was skipped whole — one submit,
    // no effect pass, no effect pipeline (the R-4 refusal, restated).
    expect(gpu.countOf("queue.submit")).toBe(1);
    expect(
      gpu.calls.filter(
        (call) =>
          call.name === "encoder.beginRenderPass" &&
          String((call.args[0] as { label?: string }).label).startsWith(
            "four:effect",
          ),
      ),
    ).toHaveLength(0);

    renderer.dispose();
    target.dispose();
  });

  it("reads a rendered target back through the aligned, asynchronous path", async () => {
    const { renderer, gpu, views } = await createRig();
    // 3 texels wide: 12-byte rows, so the copy must pad to 256 and the
    // result must strip that padding back out.
    const target = new RenderTarget({ width: 3, height: 2 });
    renderer.render(worldScene(), views, undefined, target);

    const pixels = await renderer.readPixels(target);
    expect(pixels.byteLength).toBe(3 * 2 * 4);
    const copy = gpu.callsOf("encoder.copyTextureToBuffer")[0];
    expect(copy?.args[1]).toMatchObject({ bytesPerRow: 256, rowsPerImage: 2 });
    // The staging buffer does not outlive the read.
    expect(gpu.countOf("buffer.unmap")).toBe(1);

    renderer.dispose();
    target.dispose();
  });
});
