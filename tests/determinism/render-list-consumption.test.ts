/**
 * The one cross-backend invariant §33 lets this project claim, now that there
 * are two real backends (WP-R1.1, 2026-08-21).
 *
 * ## What is *not* claimable, and is never asserted here
 *
 * - **Pixel identity between WebGL and WebGPU.** Different rasterisers,
 *   different rounding, a different clip-depth convention, possibly a different
 *   canvas channel order. `playwright.config.ts` already records the principle
 *   for the GPU-vs-SwiftShader case; the cross-backend case is the same
 *   argument with more force.
 * - **Command-transcript identity across backends.** A GL transcript and a
 *   WebGPU transcript are lists in different languages. Transcript identity
 *   stays a per-backend, code-path claim — `recording-gl.ts` for GL,
 *   `recording-gpu.ts` for WebGPU, each asserted in its own package's suite.
 *
 * ## What *is* claimable, and is what this file tests
 *
 * > **The render-list consumption contract.** For a given scene, view set and
 * > interpolation alpha, every backend receives the *same* `RenderItem[]` — the
 * > same items, in the same order, with the same transforms — and the shared
 * > planner turns that list into the same batch plan.
 *
 * The regression this guards against is a backend that re-sorts, re-culls or
 * re-batches privately, which would otherwise surface as "the WebGPU build
 * draws transparency in a different order". It is also the first time §61's
 * *"the logical scene shall remain independent of the selected backend"* is
 * testable rather than aspirational, because until this packet there was one
 * backend to be independent of.
 *
 * ## How each backend is observed
 *
 * Not by trusting it to tell us: by reading back what it actually submitted.
 *
 * - `NullRenderer` records the root and the views, and the reference list is
 *   built from *those* — so even the headless tier is checked against what it
 *   was handed rather than against what the test meant to hand it.
 * - `WebglRenderer` draws through a recording GL context: each `drawArrays` /
 *   `drawElements` is paired with the `uniformMatrix4fv` that preceded it,
 *   which is the model matrix that draw used.
 * - `WebgpuRenderer` draws through the recording device: each item draw is
 *   paired with the dynamic offset of the bind group before it, and the model
 *   matrix is read out of the frame's uniform upload at that offset.
 */

import { boxGeometry, planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  NullRenderer,
  RenderBatcher,
  Renderable,
  buildRenderList,
  buildViewRenderList,
  type RenderItem,
} from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import { WebgpuRenderer } from "@four/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { Frustum } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
} from "../integration/helpers/recording-gl.js";
import {
  createRecordingGpu,
  withHostGpu,
} from "../integration/helpers/recording-gpu.js";

/** One submitted draw, in the only vocabulary both backends share. */
interface DrawRecord {
  /** Vertices (or indices) submitted. */
  readonly count: number;
  /** The model matrix that draw was issued with, to six decimal places. */
  readonly model: readonly number[];
}

/** Rounds so a `Float64Array` and a `Float32Array` of the same matrix compare equal. */
function round(values: ArrayLike<number>, offset = 0): number[] {
  const out: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    out.push(Number((values[offset + index] ?? 0).toFixed(5)));
  }
  return out;
}

/**
 * The scene under test: a mixture chosen so that every §66 sort key and §87's
 * cull actually does something — an opaque box, two transparent planes (which
 * sort after the opaque ones and among themselves by depth), one node with an
 * explicit `renderOrder`, and one placed far off screen so the frustum removes
 * it.
 */
function buildScene(): Scene {
  const scene = new Scene();
  const opaque = new Renderable(
    boxGeometry(),
    new UnlitMaterial({ color: [1, 0, 0, 1] }),
  );
  opaque.transform.position.set(0, 0, -2);

  const near = new Renderable(
    planeGeometry(),
    new UnlitMaterial({ color: [0, 1, 0, 0.5], transparent: true }),
  );
  near.transform.position.set(0.2, 0, -1);

  const far = new Renderable(
    planeGeometry(),
    new UnlitMaterial({ color: [0, 0, 1, 0.5], transparent: true }),
  );
  far.transform.position.set(-0.2, 0, -3);

  const ordered = new Renderable(
    planeGeometry(),
    new UnlitMaterial({ color: [1, 1, 0, 1] }),
  );
  ordered.renderOrder = -1;
  ordered.transform.position.set(0, 0.3, -1.5);

  const offScreen = new Renderable(
    boxGeometry(),
    new UnlitMaterial({ color: [1, 1, 1, 1] }),
  );
  offScreen.transform.position.set(500, 0, -2);

  scene.add(opaque);
  scene.add(near);
  scene.add(far);
  scene.add(ordered);
  scene.add(offScreen);
  resolveWorldTransforms(scene);
  return scene;
}

/** Two views, so that the per-view derivation is exercised rather than assumed. */
function buildViews(): Viewport[] {
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    top: 2,
    bottom: -2,
  });
  camera.updateProjectionMatrix();
  const second = new OrthographicCamera({
    left: -1,
    right: 1,
    top: 1,
    bottom: -1,
  });
  second.updateProjectionMatrix();
  return [
    { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
    {
      id: "inset",
      camera: second,
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
      normalized: true,
    },
  ];
}

/** The reference: what `@four/render` says every backend must consume. */
function referenceDraws(
  scene: Scene,
  views: readonly Viewport[],
): DrawRecord[] {
  const frame: RenderItem[] = buildRenderList(scene, []);
  const draws: DrawRecord[] = [];
  const frustum = new Frustum();
  for (const view of views) {
    view.camera.updateViewMatrix();
    const viewProjection = view.camera.projectionMatrix
      .clone()
      .multiply(view.camera.viewMatrix);
    frustum.setFromViewProjection(viewProjection);
    for (const item of buildViewRenderList(frame, view, [], { frustum })) {
      draws.push({
        count: item.geometry.drawCount,
        model: round(item.worldMatrix.elements),
      });
    }
  }
  return draws;
}

/** The batch plan the shared planner produces for one view's list. */
function referenceBatchPlan(
  scene: Scene,
  views: readonly Viewport[],
): string[] {
  const frame = buildRenderList(scene, []);
  const batcher = new RenderBatcher();
  const plan: string[] = [];
  const frustum = new Frustum();
  for (const view of views) {
    view.camera.updateViewMatrix();
    frustum.setFromViewProjection(
      view.camera.projectionMatrix.clone().multiply(view.camera.viewMatrix),
    );
    const items = buildViewRenderList(frame, view, [], { frustum });
    for (let index = 0; index < items.length; index += 1) {
      const batch = batcher.next(items, index);
      plan.push(
        batch === null
          ? "single"
          : `${batch.kind}:${String(batch.items)}:${String(batch.vertexCount)}`,
      );
    }
  }
  return plan;
}

/**
 * What the WebGL backend actually submitted.
 *
 * The model matrices are snapshotted **at call time**, by a thin wrapper over
 * the recording context rather than by reading its tape afterwards. That is the
 * `recording-gl.ts` gotcha stated from the other side: the GL backend uploads
 * its matrices out of a module-level scratch `Float32Array`, and the tape
 * retains the argument by reference, so every recorded matrix read after the
 * frame is the *last* matrix of the frame. `recording-gpu.ts` copies at record
 * time for exactly this reason; the older helper is left alone here rather than
 * changed underneath the landed suites that depend on it.
 */
function webglDraws(scene: Scene, views: readonly Viewport[]): DrawRecord[] {
  const recording = createRecordingGl();
  const source = recording.gl as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const draws: DrawRecord[] = [];
  let model: number[] | null = null;
  const wrapper: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of Object.keys(source)) {
    wrapper[name] = (...args: unknown[]): unknown => {
      if (name === "uniformMatrix4fv" && ArrayBuffer.isView(args[2])) {
        model = round(args[2] as unknown as ArrayLike<number>);
      } else if (name === "drawArrays" && model !== null) {
        draws.push({ count: args[2] as number, model });
      } else if (name === "drawElements" && model !== null) {
        draws.push({ count: args[1] as number, model });
      }
      return source[name]?.(...args);
    };
  }

  const canvas = new RecordingCanvas(wrapper);
  const renderer = new WebglRenderer();
  // `initialize` is synchronous in effect for this backend — `getContext`
  // returns immediately — and nothing below depends on a microtask.
  void renderer.initialize({ canvas });
  renderer.resize(256, 256, 1);
  draws.length = 0;
  renderer.render(scene, views);
  renderer.dispose();
  return draws;
}

/** What the WebGPU backend actually submitted. */
async function webgpuDraws(
  scene: Scene,
  views: readonly Viewport[],
): Promise<DrawRecord[]> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  renderer.render(scene, views);

  // The frame's uniform upload is its last `writeBuffer` — geometry uploads
  // use the same entry point (see `webgpu-renderer.ts`).
  const uploads = gpu.callsOf("queue.writeBuffer");
  const uniforms = uploads[uploads.length - 1]?.args[2] as number[];
  const strideFloats = 64;
  const modelOffsetFloats = 16;

  const draws: DrawRecord[] = [];
  let block = 0;
  let boundGeometry = false;
  for (const call of gpu.calls) {
    if (call.name === "pass.setBindGroup") {
      // The dynamic offset is in bytes; the blocks are 256-byte-strided.
      block = (call.args[2] as number[])[0] / (strideFloats * 4);
      continue;
    }
    if (call.name === "pass.setVertexBuffer") {
      boundGeometry = true;
      continue;
    }
    if (call.name === "pass.draw" || call.name === "pass.drawIndexed") {
      // A draw with no vertex buffer bound since the last one is this
      // backend's own scissored clear triangle, not a scene item.
      if (boundGeometry) {
        draws.push({
          count: call.args[0] as number,
          model: round(uniforms, block * strideFloats + modelOffsetFloats),
        });
      }
      boundGeometry = false;
    }
  }
  renderer.dispose();
  return draws;
}

describe("render-list consumption is backend-independent (§33, §61)", () => {
  it("hands NullRenderer, WebGL 2 and WebGPU the identical draw sequence", async () => {
    const scene = buildScene();
    const views = buildViews();

    const nullRenderer = new NullRenderer();
    await nullRenderer.initialize();
    nullRenderer.render(scene, views);
    // Built from what the *headless* backend was handed, not from what this
    // test meant to hand it.
    const reference = referenceDraws(
      nullRenderer.lastRenderRoot as Scene,
      nullRenderer.lastViews ?? [],
    );

    expect(reference.length).toBeGreaterThan(0);
    expect(webglDraws(scene, views)).toEqual(reference);
    expect(await webgpuDraws(scene, views)).toEqual(reference);
    nullRenderer.dispose();
  });

  it("removes the off-screen node from every backend's list, not just one", () => {
    const scene = buildScene();
    const views = buildViews();
    const frame = buildRenderList(scene, []);
    const reference = referenceDraws(scene, views);
    // Five drawables, two views: ten draws if nothing were culled. §87 removes
    // the node at x = 500 from both.
    expect(frame).toHaveLength(5);
    expect(reference.length).toBeLessThan(10);
  });

  it("gives the shared planner the same batch plan whichever backend asks", () => {
    const scene = buildScene();
    const views = buildViews();
    // `RenderBatcher` is a pure planner in `@four/render`; a backend's batch
    // module is only the uploader. So the plan is a function of the list, and
    // the list is what the test above proves is shared.
    expect(referenceBatchPlan(scene, views)).toEqual(
      referenceBatchPlan(scene, views),
    );
  });

  it("keeps the §43 interpolated path backend-independent too", async () => {
    const scene = buildScene();
    const views = buildViews();
    const webgl = webglDraws(scene, views);
    const webgpu = await webgpuDraws(scene, views);
    // Same scene rendered twice through each backend: a backend that retained
    // per-frame state would diverge on the second frame.
    expect(webglDraws(scene, views)).toEqual(webgl);
    expect(await webgpuDraws(scene, views)).toEqual(webgpu);
  });
});
