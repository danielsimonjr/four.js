/**
 * §60 node materials across the packages that have to agree about them, on
 * the WebGPU backend (RFC 0001; WP-R1.9 — the twin of
 * `node-materials.test.ts`): `@four/materials` carries the IR and the
 * material, `@four/render` the `"node"` item kind and the §70 graph effect,
 * `@four/render-webgpu` the lazily registered WGSL emitter and pipeline
 * store.
 *
 * The same three composition claims, restated for this backend:
 *
 * 1. **Byte-identity for node-material-free scenes** — the identical device
 *    transcript whether or not `registerWebgpuNodeMaterialPipeline()` was
 *    called; and a node material met *without* registration is skipped —
 *    absent from the transcript, never drawn flat.
 * 2. **Lazy compilation is observable** — and one step lazier than GL:
 *    initialize compiles **zero** modules (the whole pipeline cache is lazy
 *    here), and the first node frame adds exactly one node module however
 *    many materials share the graph's structure.
 * 3. **A §70 graph effect draws through the same registered pipeline**, with
 *    the pass's uniforms packed into its block and its source sampled.
 */

import { planeGeometry } from "@four/geometry";
import {
  NodeMaterial,
  NodeMaterialBuilder,
  ShaderGraphBuilder,
  UnlitMaterial,
} from "@four/materials";
import { RenderTarget, Renderable } from "@four/render";
import {
  WebgpuRenderer,
  clearRegisteredWebgpuNodeMaterialPipeline,
  registerWebgpuNodeMaterialPipeline,
} from "@four/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

interface Rig {
  readonly renderer: WebgpuRenderer;
  readonly recording: RecordingGpu;
  readonly views: readonly Viewport[];
}

async function createRig(): Promise<Rig> {
  const recording = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(recording.gpu, async () => {
    await renderer.initialize({ canvas: recording.canvas });
  });
  renderer.resize(320, 240, 1);
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 5);
  recording.reset();
  return { renderer, recording, views: [createFullscreenViewport(camera)] };
}

/** A gradient node material — §58's linear-gradient tier, exact per fragment. */
function gradientMaterial(): NodeMaterial {
  const builder = new NodeMaterialBuilder();
  const t = builder.uv().swizzle("x");
  builder.output.color = builder.mix([0, 0, 1, 1], [1, 0.5, 0, 1], t);
  return builder.build();
}

afterEach(() => {
  clearRegisteredWebgpuNodeMaterialPipeline();
});

describe("byte-identity for node-material-free scenes (RFC 0001's gate, WebGPU)", () => {
  // Shared geometry objects, so the two rigs' buffer labels — which carry
  // the geometry id — compare byte for byte (the GL twin needs no such care:
  // its transcript carries no labels).
  const wide = planeGeometry({ width: 2, height: 2 });
  const unit = planeGeometry();

  /** One frame of a small plain scene on a fresh rig; the transcript. */
  async function plainTranscript(): Promise<string[]> {
    const rig = await createRig();
    const scene = new Scene();
    scene.add(
      new Renderable(wide, new UnlitMaterial()),
      new Renderable(unit, new UnlitMaterial({ transparent: true })),
    );
    resolveWorldTransforms(scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    return rig.recording.transcript();
  }

  it("registration alone changes not one recorded call of a plain frame", async () => {
    clearRegisteredWebgpuNodeMaterialPipeline();
    const before = await plainTranscript();
    registerWebgpuNodeMaterialPipeline();
    const after = await plainTranscript();
    expect(after).toEqual(before);
  });

  it("skips an unregistered node material — absent, never flat colour", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      clearRegisteredWebgpuNodeMaterialPipeline();
      const bare = await createRig();
      const bareScene = new Scene();
      bareScene.add(new Renderable(unit, new UnlitMaterial()));
      resolveWorldTransforms(bareScene);
      bare.recording.reset();
      bare.renderer.render(bareScene, bare.views);
      const withoutNode = bare.recording.transcript();

      const rig = await createRig();
      const scene = new Scene();
      scene.add(new Renderable(unit, new UnlitMaterial()));
      scene.add(new Renderable(planeGeometry(), gradientMaterial()));
      resolveWorldTransforms(scene);
      rig.recording.reset();
      rig.renderer.render(scene, rig.views);

      expect(rig.recording.transcript()).toEqual(withoutNode);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the WebGPU node pipeline, end to end (§60, §62; WP-R1.9)", () => {
  it("compiles on the first node frame — one module for N materials sharing a graph", async () => {
    registerWebgpuNodeMaterialPipeline();
    const rig = await createRig();
    const scene = new Scene();
    // Three materials, one graph structure (three distinct builder runs
    // emitting identical WGSL): the program-share claim as a compile count.
    scene.add(
      new Renderable(planeGeometry(), gradientMaterial()),
      new Renderable(planeGeometry(), gradientMaterial()),
      new Renderable(planeGeometry(), gradientMaterial()),
    );
    resolveWorldTransforms(scene);

    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    // Two modules: the frame's clear draw compiles its own (this backend's
    // cache is wholly lazy), plus exactly one node module for all three
    // materials — and one node pipeline over it.
    const labels = rig.recording
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { label?: string }).label);
    // The node module compiles during the frame's pre-pass sizing, before
    // the clear draw's — beginFrame is where first-sight compilation lives.
    expect(labels).toEqual(["four:node:surface", "four:clear"]);
    expect(rig.recording.countOf("pass.drawIndexed")).toBe(3);

    // The next frame compiles nothing further.
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    expect(rig.recording.countOf("device.createShaderModule")).toBe(0);
    expect(rig.recording.countOf("device.createRenderPipeline")).toBe(0);
    expect(rig.recording.countOf("pass.drawIndexed")).toBe(3);
  });

  it("initialize compiles zero modules, registered or not (lazy proof)", async () => {
    registerWebgpuNodeMaterialPipeline();
    const recording = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(recording.gpu, async () => {
      await renderer.initialize({ canvas: recording.canvas });
    });
    expect(recording.countOf("device.createShaderModule")).toBe(0);
    expect(recording.countOf("device.createRenderPipeline")).toBe(0);
    renderer.dispose();
  });

  it("draws a §70 graph effect through the registered pipeline", async () => {
    registerWebgpuNodeMaterialPipeline();
    const rig = await createRig();
    const source = new RenderTarget({ width: 8, height: 8 });

    const screen = new ShaderGraphBuilder("screen");
    screen.output.color = screen
      .sampler("source")
      .multiply(screen.uniform("gain", "float"));

    rig.recording.reset();
    rig.renderer.renderEffect({
      kind: "effect",
      source: source.colorTexture,
      effect: {
        kind: "graph",
        graph: screen.graph(),
        uniforms: { gain: 0.5 },
      },
    });

    // One compiled screen module, one full-screen triangle, the pass's
    // uniform packed into the block at its lane.
    expect(rig.recording.countOf("device.createShaderModule")).toBe(1);
    expect(rig.recording.countOf("pass.draw")).toBe(1);
    expect(rig.recording.countOf("queue.submit")).toBe(1);
    const uploads = rig.recording.callsOf("queue.writeBuffer");
    const block = uploads[uploads.length - 1].args[2] as number[];
    expect(block[4]).toBe(0.5);
  });

  it("skips an unregistered graph effect entirely", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      clearRegisteredWebgpuNodeMaterialPipeline();
      const rig = await createRig();
      const source = new RenderTarget({ width: 8, height: 8 });
      const screen = new ShaderGraphBuilder("screen");
      screen.output.color = screen.sampler("source");
      rig.recording.reset();
      rig.renderer.renderEffect({
        kind: "effect",
        source: source.colorTexture,
        effect: { kind: "graph", graph: screen.graph() },
      });
      expect(rig.recording.countOf("pass.draw")).toBe(0);
      expect(rig.recording.countOf("device.createShaderModule")).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});
