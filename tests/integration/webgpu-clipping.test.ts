/**
 * §67 clipping on the WebGPU backend (WP-R1.3) — the R-23 grammar, re-spoken
 * in pass commands and pipeline state instead of GL calls.
 *
 * `clipping.test.ts` proves the composition (`@four/scene`'s flag,
 * `@four/render`'s allocator and mask emission) against the WebGL backend;
 * this file proves the *second application* of the same records, which is what
 * makes the clip API a design rather than a GL feature. The claims restated:
 *
 * 1. **A scene that names no clip is byte-identical** — the frame's transcript
 *    carries no stencil format, no stencil ops, no reference command; the
 *    depth attachment stays `depth24plus`. (The deeper proof is that every
 *    WP-R1.1/R1.2 transcript expectation in the landed suites passes
 *    untouched.)
 * 2. **The stencil format is a per-frame decision.** A frame that clips
 *    allocates `depth24plus-stencil8` and stencil-carrying pipelines; the same
 *    renderer, given a clipless scene next, reallocates back down. This is the
 *    backend's structural difference from GL — no `{ stencil: true }` option,
 *    no clip-without-stencil diagnostic, because the backend owns its depth
 *    attachment and can always widen it (see `DEPTH_STENCIL_FORMAT`).
 * 3. **The grammar is R-7's**: per view, masks first (always/replace onto
 *    their own planes, colour and depth off), the clear draw zeroes the
 *    stencil rectangle, content tests `equal` over the accumulated planes, and
 *    nesting intersects through the reference values alone.
 * 4. **§65 stays sound**: a clip boundary ends a batch run on this backend's
 *    own uploader too.
 * 5. **The ninth clip spills, with §67's required diagnostic** — through the
 *    real frame path.
 */

import { resetDevWarnings } from "@four/core";
import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import { MAX_CLIP_PLANES, Renderable } from "@four/render";
import { WebgpuRenderer, createWgpuBatching } from "@four/render-webgpu";
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

afterEach(() => {
  vi.restoreAllMocks();
  resetDevWarnings();
});

interface Harness {
  readonly gpu: RecordingGpu;
  readonly renderer: WebgpuRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

/** A renderer over the recording device — no stencil option exists, or needs to. */
async function harness(): Promise<Harness> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);

  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -3,
    right: 3,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 8);
  scene.add(camera);
  gpu.reset();
  return { gpu, renderer, scene, views: [createFullscreenViewport(camera)] };
}

/** A named unlit plane. */
function panel(name: string, material = new UnlitMaterial()): Renderable {
  const node = new Renderable(planeGeometry(), material);
  node.name = name;
  return node;
}

/** One steady-state frame: warm the caches, reset the tape, draw once. */
function steadyFrame(test: Harness): void {
  resolveWorldTransforms(test.scene);
  test.renderer.render(test.scene, test.views);
  test.gpu.reset();
  test.renderer.render(test.scene, test.views);
}

/** Every recorded stencil reference, in order. */
function references(gpu: RecordingGpu): number[] {
  return gpu
    .callsOf("pass.setStencilReference")
    .map((call) => call.args[0] as number);
}

/** The labels of every pipeline compiled since the last reset. */
function pipelineLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createRenderPipeline")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

describe("R-23 on WebGPU — §67 through the real frame path", () => {
  it("keeps a clipless scene free of every stencil spelling (claim 1)", async () => {
    const test = await harness();
    test.scene.add(panel("plain"));
    steadyFrame(test);

    const transcript = test.gpu.transcript().join("\n");
    expect(transcript).toContain("pass.drawIndexed");
    expect(transcript).not.toContain("depth24plus-stencil8");
    expect(transcript).not.toContain("stencilLoadOp");
    expect(transcript).not.toContain("stencilFront");
    expect(transcript).not.toContain("setStencilReference");
  });

  it("decides the depth format per frame, both directions (claim 2)", async () => {
    const test = await harness();
    const clip = panel("clip");
    clip.clip = true;
    clip.add(panel("content"));
    test.scene.add(clip);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    // The clipping frame allocated the stencil-carrying attachment and told
    // the pass to keep its stencil aspect.
    const formats = (): string[] =>
      test.gpu
        .callsOf("device.createTexture")
        .map((call) => (call.args[0] as { format: string }).format);
    expect(formats()).toEqual(["depth24plus-stencil8"]);
    const pass = test.gpu.callsOf("encoder.beginRenderPass")[0]?.args[0] as {
      depthStencilAttachment: { stencilLoadOp?: string };
    };
    expect(pass.depthStencilAttachment.stencilLoadOp).toBe("load");

    // The same renderer, a clipless scene: back down to WP-R1.1's format.
    clip.clip = false;
    test.gpu.reset();
    test.renderer.render(test.scene, test.views);
    expect(formats()).toEqual(["depth24plus"]);
    expect(test.gpu.transcript().join("\n")).not.toContain("stencilLoadOp");
  });

  it("writes masks first, clears stencil per view, tests content equal (claim 3)", async () => {
    const test = await harness();
    const clip = panel("clip");
    clip.clip = true;
    clip.add(panel("content"));
    test.scene.add(clip);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    const labels = pipelineLabels(test.gpu);
    // The clear zeroes the planes inside its scissored triangle…
    expect(
      labels.some(
        (label) => label.startsWith("four:clear") && label.includes(",zero"),
      ),
    ).toBe(true);
    // …the mask writes its plane with colour, depth test and depth writes off
    // (the `-` triple is §57's three switches, forced)…
    expect(
      labels.some(
        (label) =>
          label.startsWith("four:unlit|-|-|none|-|-|-") &&
          label.includes("|s:always,255,1,keep,keep,replace"),
      ),
    ).toBe(true);
    // …and the content tests equal over the accumulated planes, read-only.
    expect(
      labels.some((label) => label.includes("|s:equal,1,0,keep,keep,keep")),
    ).toBe(true);
    // Mask ref and test ref are both plane 1: one pass command serves both.
    expect(references(test.gpu)).toEqual([1]);
  });

  it("redraws every mask in every view — a stencil buffer is per surface", async () => {
    const test = await harness();
    const clip = panel("clip");
    clip.clip = true;
    clip.add(panel("content"));
    test.scene.add(clip);
    resolveWorldTransforms(test.scene);

    const camera = test.views[0].camera;
    test.renderer.render(test.scene, [
      {
        id: "left",
        camera,
        x: 0,
        y: 0,
        width: 0.5,
        height: 1,
        normalized: true,
      },
      {
        id: "right",
        camera,
        x: 0.5,
        y: 0,
        width: 0.5,
        height: 1,
        normalized: true,
      },
    ]);
    // Per view: mask + panel + content (indexed) and the clear (non-indexed).
    expect(test.gpu.countOf("pass.drawIndexed")).toBe(6);
    expect(test.gpu.countOf("pass.draw")).toBe(2);
  });

  it("intersects nested clips through the accumulated reference (claim 3)", async () => {
    const test = await harness();
    const outer = panel("outer");
    outer.clip = true;
    const inner = panel("inner");
    inner.clip = true;
    inner.add(panel("leaf"));
    outer.add(inner);
    test.scene.add(outer);
    steadyFrame(test);

    // Masks 1 and 2; the outer's own item is unclipped; the inner's own item
    // tests the outer's plane; the leaf tests the conjunction.
    expect(references(test.gpu)).toEqual([1, 2, 1, 3]);
  });

  it("ends a §65 batch run at a clip boundary (claim 4)", async () => {
    const test = await harness();
    test.renderer.batching = createWgpuBatching();
    const shared = new UnlitMaterial({ color: [1, 0.5, 0, 1] });
    const left = panel("left");
    left.clip = true;
    left.add(panel("left-a", shared));
    left.add(panel("left-b", shared));
    const right = panel("right");
    right.clip = true;
    right.add(panel("right-a", shared));
    right.add(panel("right-b", shared));
    test.scene.add(left);
    test.scene.add(right);
    steadyFrame(test);

    // Four panels over one material would be one merged draw; two clip
    // records make it two, so one scroll view's content cannot escape through
    // its neighbour's. The masks and the two clip panels draw unmerged.
    const merged = test.gpu
      .callsOf("pass.setIndexBuffer")
      .filter((call) => call.args[1] === "uint32");
    expect(merged).toHaveLength(2);
  });

  it("draws eight masks, spills the ninth subtree, and warns once (claim 5)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const test = await harness();
    for (let index = 0; index <= MAX_CLIP_PLANES; index += 1) {
      const clip = panel(`clip-${String(index)}`);
      clip.clip = true;
      clip.add(panel(`content-${String(index)}`));
      test.scene.add(clip);
    }
    steadyFrame(test);

    // 8 masks + 9 clip panels + 9 children = 26 indexed draws — the ninth
    // subtree spills past its boundary rather than vanishing behind it.
    expect(test.gpu.countOf("pass.drawIndexed")).toBe(26);
    // Eight planes written, eight tested, in plane order both times.
    const bits = [1, 2, 4, 8, 16, 32, 64, 128];
    expect(references(test.gpu)).toEqual([...bits, ...bits]);
    // Warned once across the warm-up and the steady frame (once per list).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("§67");
  });
});
