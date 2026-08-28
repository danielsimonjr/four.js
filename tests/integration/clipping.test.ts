/**
 * R-23 — §67's clipping API, across the four packages that have to agree on it
 * (2026-08-28).
 *
 * R-7 landed the substrate (a `StencilState` a material can declare, a buffer,
 * a backend that applies both); this packet lands the *scene-graph* half:
 * `node.clip = true` masks the node's subtree to its own drawn shape, nested
 * clips intersect, and the whole arrangement is composed by the render list
 * into §57-shaped records the R-7 backend already knows how to apply. No unit
 * test inside one package can check that agreement — `@four/scene` owns the
 * flag, `@four/render` owns the allocator and the mask emission,
 * `@four/render-webgl` is where any of it becomes GL, and `four` owns §79 —
 * so this file drives the real renderer over the recording context.
 *
 * Five claims:
 *
 * 1. **A scene that names no clip is byte-identical.** Zero stencil calls,
 *    zero extra draws — and the deeper recorded proof is not here but in
 *    `stencil-masking.test.ts`'s `FRAME_BEFORE_R7`, a transcript recorded
 *    before either R-7 *or* this packet existed, which still passes untouched.
 * 2. **The composition is the R-7 stencil grammar**, emitted by the engine:
 *    per view, each clip's mask draws first (always/replace onto its own bit
 *    plane, colour and depth off), then content tests `equal` over the
 *    accumulated planes — so nesting intersects with no per-clip bookkeeping.
 * 3. **Per-view correctness**: every view re-clears the stencil buffer and
 *    redraws every mask, because a stencil buffer is per surface, not per
 *    frame.
 * 4. **§65 stays sound**: a clip boundary ends a batch run, so a scroll view's
 *    content cannot be merged into — and escape through — its neighbour's.
 * 5. **The ninth clip spills, with §67's required diagnostic** — through the
 *    real frame path, not just the allocator.
 *
 * The pixel half — nested clips visibly intersecting on a real driver — is
 * `tests/browser/clipping.spec.ts`.
 */

import { resetDevWarnings } from "@four/core";
import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import { MAX_CLIP_PLANES, Renderable } from "@four/render";
import { GL, WebglRenderer, createGlBatching } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

afterEach(() => {
  vi.restoreAllMocks();
  resetDevWarnings();
});

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

/** A renderer over a recording context whose surface has stencil bits. */
async function harness(stencil = true): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({
    canvas: new RecordingCanvas(recorder.gl),
    stencil,
  });
  renderer.resize(256, 256);

  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -3,
    right: 3,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 8);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    views: [createFullscreenViewport(camera)],
  };
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
  test.recorder.reset();
  test.renderer.render(test.scene, test.views);
}

/** The frame's stencil-relevant calls, `name(args…)`, in order. */
function stencilLines(recorder: RecordingGl): string[] {
  return recorder
    .transcript()
    .filter(
      (line) =>
        line.startsWith("stencil") ||
        line.startsWith(`enable(${String(GL.STENCIL_TEST)})`) ||
        line.startsWith(`disable(${String(GL.STENCIL_TEST)})`),
    );
}

describe("R-23 — a scene that names no clip is byte-identical (§67)", () => {
  it("issues zero stencil calls and zero extra draws", async () => {
    const test = await harness(false);
    test.scene.add(panel("left"));
    test.scene.add(panel("right"));
    steadyFrame(test);

    expect(stencilLines(test.recorder)).toEqual([]);
    expect(test.recorder.countOf("colorMask")).toBe(0);
    expect(test.recorder.countOf("drawElements")).toBe(2);
  });
});

describe("R-23 — nested clips intersect through the real frame (§67)", () => {
  it("writes both planes before testing content against their union", async () => {
    const test = await harness();
    const outer = panel("outer");
    outer.clip = true;
    const inner = panel("inner");
    inner.clip = true;
    const content = panel("content");
    inner.add(content);
    outer.add(inner);
    test.scene.add(outer);
    steadyFrame(test);

    expect(stencilLines(test.recorder)).toEqual([
      // Both masks, plane by plane, ahead of all content.
      `enable(${String(GL.STENCIL_TEST)})`,
      `stencilFunc(${String(GL.ALWAYS)}, 1, 255)`,
      `stencilOp(${String(GL.KEEP)}, ${String(GL.KEEP)}, ${String(GL.REPLACE)})`,
      "stencilMask(1)",
      `stencilFunc(${String(GL.ALWAYS)}, 2, 255)`,
      "stencilMask(2)",
      // The outer panel's own draw: unclipped by its own clip.
      `disable(${String(GL.STENCIL_TEST)})`,
      // The inner panel: tested by the outer plane only.
      `enable(${String(GL.STENCIL_TEST)})`,
      `stencilFunc(${String(GL.EQUAL)}, 1, 1)`,
      `stencilOp(${String(GL.KEEP)}, ${String(GL.KEEP)}, ${String(GL.KEEP)})`,
      "stencilMask(0)",
      // The content: both planes — the intersection, in one test.
      `stencilFunc(${String(GL.EQUAL)}, 3, 3)`,
      // Exit envelope (R-7): test off, write mask reopened for the next clear.
      `disable(${String(GL.STENCIL_TEST)})`,
      "stencilMask(255)",
    ]);
    // Mask draws are colourless and depthless; content restores both.
    expect(test.recorder.callsOf("colorMask").map((call) => call.args)).toEqual(
      [
        [false, false, false, false],
        [true, true, true, true],
      ],
    );
    // Five draws: two masks, outer, inner, content.
    expect(test.recorder.countOf("drawElements")).toBe(5);
  });

  it("re-clears and re-masks per view — a stencil buffer is per surface", async () => {
    const test = await harness();
    const clip = panel("clip");
    clip.clip = true;
    clip.add(panel("content"));
    test.scene.add(clip);
    const camera = test.views[0].camera;
    test.views.push({
      ...createFullscreenViewport(camera),
      id: "inset",
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
    steadyFrame(test);

    const clears = test.recorder.callsOf("clear");
    expect(clears).toHaveLength(2);
    for (const clear of clears) {
      expect(Number(clear.args[0]) & GL.STENCIL_BUFFER_BIT).toBe(
        GL.STENCIL_BUFFER_BIT,
      );
    }
    // The mask writes twice — once per view, after that view's clear.
    const maskWrites = test.recorder
      .callsOf("stencilFunc")
      .filter((call) => call.args[0] === GL.ALWAYS);
    expect(maskWrites).toHaveLength(2);
  });
});

describe("R-23 — a clip boundary ends a §65 batch run", () => {
  it("draws a straddling same-material run as two batches, not one", async () => {
    const test = await harness();
    test.renderer.batching = createGlBatching();
    const shared = new UnlitMaterial();
    // Two unclipped quads, then two inside a clip, all one material: without
    // the clip key the four would merge into one call.
    test.scene.add(panel("a", shared));
    test.scene.add(panel("b", shared));
    const clip = panel("clip", shared);
    clip.clip = true;
    clip.add(panel("c", shared));
    clip.add(panel("d", shared));
    test.scene.add(clip);
    steadyFrame(test);

    // The mask draw, then two merged runs: [a, b, clip] and [c, d]. A batch
    // draws through `drawElements` from the batcher's own buffers.
    expect(test.recorder.countOf("drawElements")).toBe(3);
    // The clipped run still tests against the mask's plane.
    const tested = test.recorder
      .callsOf("stencilFunc")
      .filter((call) => call.args[0] === GL.EQUAL);
    expect(tested).toHaveLength(1);
    expect(tested[0].args).toEqual([GL.EQUAL, 1, 1]);
  });
});

describe("R-23 — §67's required diagnostic through the frame path", () => {
  it("draws eight masks, spills the ninth subtree, and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const test = await harness();
    for (let index = 0; index <= MAX_CLIP_PLANES; index += 1) {
      const clip = panel(`clip-${String(index)}`);
      clip.clip = true;
      clip.add(panel(`content-${String(index)}`));
      test.scene.add(clip);
    }
    steadyFrame(test);

    // Eight mask writes (ALWAYS), not nine; every content draw still draws.
    const maskWrites = test.recorder
      .callsOf("stencilFunc")
      .filter((call) => call.args[0] === GL.ALWAYS);
    expect(maskWrites).toHaveLength(MAX_CLIP_PLANES);
    // 8 masks + 9 clip panels + 9 children = 26 draws — the ninth subtree
    // spills past its boundary rather than vanishing behind it.
    expect(test.recorder.countOf("drawElements")).toBe(26);
    // Warned once across the warm-up and the steady frame (once per list).
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("§67");
  });
});
