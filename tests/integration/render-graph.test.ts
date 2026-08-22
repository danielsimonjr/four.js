/**
 * R-5 — §63's render graph, driving the real WebGL 2 backend (2026-08-07).
 *
 * `RenderGraph` lives in `@four/render` and knows nothing about GL; the claim
 * that makes it worth having is a claim about three packages agreeing, and no
 * unit test inside any one of them can check it:
 *
 * 1. **A graph is a driver, not a backend.** A two-pass graph must emit the
 *    *identical* GL call sequence — same calls, same arguments, same order —
 *    as the two hand-written `renderer.render(root, views, interpolation,
 *    target)` calls it replaces. If it does not, "adopt the graph" stops being
 *    a refactor and starts being a rendering change. This is asserted call for
 *    call against a recording context, which is why the file exists.
 * 2. **The graph's static ordering rule and the backend's runtime refusal are
 *    the same rule.** R-4 made the backend *drop* a draw whose material samples
 *    the target being drawn into. `RenderGraph.validate()` reports that
 *    statically as `"feedback"` — and here the two are checked against each
 *    other on one scene: the validator names it, the backend then does not draw
 *    it.
 * 3. **The no-graph path is untouched.** An application that never constructs a
 *    graph renders exactly as before; the graph is a separate module with no
 *    side effects (§98's backend-free orchestration layer), so it is not even
 *    loaded.
 *
 * The scenes are real — a real `Scene`, a real `OrthographicCamera`, real
 * `planeGeometry`, real materials, a real `RenderTarget` — and only the GL
 * context is a double, for the reason `packages/render-webgl/tests` gives at
 * length. What a real driver adds is checked by the Playwright gate.
 */

import { planeGeometry } from "@four/geometry";
import { SpriteMaterial, UnlitMaterial } from "@four/materials";
import { RenderGraph, RenderTarget, Renderable, Sprite } from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
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

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  // §87 (R-8, 2026-08-09; tests typecheck gate, 2026-08-21): this said
  // `{ height: 4, aspect: 1 }` — two fields `OrthographicCameraOptions` does
  // not have, so the object was accepted and every property ignored, leaving
  // the default unit box `[-1, 1]²`. The box below is the 4 × 4 view the
  // harness always meant.
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
  });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    views: [createFullscreenViewport(camera)],
  };
}

/**
 * A two-pass scene: an off-screen `source` quad drawn into `target`, and an
 * on-screen `screen` quad whose §57 `map` is that target's colour attachment.
 *
 * The `map` assignment is the compile-time half of R-4's seam, exercised here
 * through the graph: `RenderTarget.colorTexture` satisfies `MaterialTexture`
 * with no cast and no adapter.
 */
function twoPassScene(test: Harness): {
  target: RenderTarget;
  offscreenRoot: Scene;
} {
  const target = new RenderTarget({ width: 64, height: 64 });

  const offscreenRoot = new Scene();
  offscreenRoot.add(
    new Renderable(planeGeometry(), new UnlitMaterial({ color: [1, 0, 0, 1] })),
  );

  test.scene.add(
    new Renderable(
      planeGeometry(),
      new UnlitMaterial({ color: [1, 1, 1, 1], map: target.colorTexture }),
    ),
  );

  return { target, offscreenRoot };
}

/** Resolves world transforms (§7, §64) the way `Application` does per frame. */
function resolve(test: Harness, ...roots: readonly Scene[]): void {
  resolveWorldTransforms(test.scene);
  for (const root of roots) {
    resolveWorldTransforms(root);
  }
}

describe("R-5 — a render graph drives the WebGL 2 backend (§63)", () => {
  it("emits the identical GL sequence as the hand-written render calls it replaces", async () => {
    const test = await harness();
    const { target, offscreenRoot } = twoPassScene(test);
    const offscreenViews = [
      createFullscreenViewport(new OrthographicCamera(), "offscreen"),
    ];

    // Warm every cache: programs, geometry buffers, the target's framebuffer.
    // A first frame is not comparable to a second one on any backend, and the
    // question here is what a *steady-state* frame costs, not what start-up
    // does.
    resolve(test, offscreenRoot);
    test.renderer.render(offscreenRoot, offscreenViews, undefined, target);
    test.renderer.render(test.scene, test.views);

    // Frame A: written by hand, exactly as an application does today.
    test.recorder.reset();
    resolve(test, offscreenRoot);
    test.renderer.render(offscreenRoot, offscreenViews, undefined, target);
    test.renderer.render(test.scene, test.views);
    const byHand = test.recorder.transcript();

    // Frame B: the same two passes, expressed as a graph.
    const graph = new RenderGraph();
    graph.addPass("world", {
      root: offscreenRoot,
      views: offscreenViews,
      target,
    });
    graph.addPass(
      "composite",
      { root: test.scene, views: test.views },
      { inputs: ["world"] },
    );

    test.recorder.reset();
    resolve(test, offscreenRoot);
    expect(graph.execute(test.renderer)).toBe(2);
    const byGraph = test.recorder.transcript();

    expect(byGraph).toEqual(byHand);
    // …and the frame really did do something: an off-screen bind, a bind back
    // to the default framebuffer, and two draws.
    expect(byGraph.length).toBeGreaterThan(0);
    expect(test.recorder.countOf("bindFramebuffer")).toBe(2);
    expect(test.recorder.countOf("drawElements")).toBe(2);
  });

  it("a well-ordered graph validates clean and binds the target's colour attachment", async () => {
    const test = await harness();
    const { target, offscreenRoot } = twoPassScene(test);

    const graph = new RenderGraph();
    graph.addPass("world", {
      root: offscreenRoot,
      views: [createFullscreenViewport(new OrthographicCamera(), "offscreen")],
      target,
    });
    graph.addPass(
      "composite",
      { root: test.scene, views: test.views },
      { inputs: ["world"] },
    );

    expect(graph.validate()).toEqual([]);

    resolve(test, offscreenRoot);
    graph.execute(test.renderer);

    // The texture the on-screen draw bound is the one the backend attached to
    // the off-screen framebuffer — the whole of render-to-texture, reached
    // through the graph.
    const attached = test.recorder.callsOf("framebufferTexture2D")[0]?.args[3];
    expect(attached).toBeDefined();
    const bound = test.recorder
      .callsOf("bindTexture")
      .some((call) => call.args[1] === attached);
    expect(bound).toBe(true);
  });

  it("names the feedback loop the backend refuses (§63 + R-4, one rule)", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 64, height: 64 });

    // One pass, drawing into the very target its material samples. A sprite,
    // because §55's pipeline has nothing left to draw without its texture and
    // R-4 therefore drops the draw outright — the sharpest runtime signal the
    // backend gives for what `validate()` reports statically. (A surface
    // material's `map` is refused too, but its draw survives untextured; the
    // issue documentation says so.)
    const root = new Scene();
    root.add(new Sprite(new SpriteMaterial({ texture: target.colorTexture })));

    const graph = new RenderGraph();
    graph.addPass("mirror", { root, views: test.views, target });

    const issues = graph.validate();
    expect(issues.map((issue) => issue.code)).toEqual(["feedback"]);
    expect(issues[0].target).toBe(target);

    // And the backend agrees at runtime: the pass binds the framebuffer and
    // clears, but issues no draw at all.
    resolveWorldTransforms(root);
    resolve(test);
    test.recorder.reset();
    graph.execute(test.renderer);

    expect(test.recorder.countOf("bindFramebuffer")).toBeGreaterThan(0);
    expect(test.recorder.countOf("clear")).toBeGreaterThan(0);
    expect(test.recorder.countOf("drawElements")).toBe(0);
    expect(test.recorder.countOf("drawArrays")).toBe(0);
  });

  it("a disabled pass issues no GL at all (§63 enable/disable)", async () => {
    const test = await harness();
    const { target, offscreenRoot } = twoPassScene(test);

    const graph = new RenderGraph();
    graph.addPass("world", {
      root: offscreenRoot,
      views: [createFullscreenViewport(new OrthographicCamera(), "offscreen")],
      target,
    });
    graph.addPass("composite", { root: test.scene, views: test.views });

    resolve(test, offscreenRoot);
    graph.execute(test.renderer);

    graph.setPassEnabled("world", false);
    test.recorder.reset();
    resolve(test, offscreenRoot);
    expect(graph.execute(test.renderer)).toBe(1);

    // No framebuffer was bound: the off-screen pass did not merely draw
    // nothing, it did not run.
    expect(test.recorder.countOf("bindFramebuffer")).toBe(0);
    expect(test.recorder.countOf("drawElements")).toBe(1);
  });

  it("leaves nothing behind for the next direct render call", async () => {
    // The regression this guards: adopting a graph for one frame must not
    // change what the *next* plain `renderer.render` does. The renderer's
    // program-lifetime mirrors (R-19) genuinely make a frame's GL depend on
    // what the previous frame drew, so the comparison is between two frames
    // with identical predecessors — one preceded by hand-written calls, one by
    // the same calls issued through a graph.
    const test = await harness();
    const { target, offscreenRoot } = twoPassScene(test);
    const offscreenViews = [
      createFullscreenViewport(new OrthographicCamera(), "offscreen"),
    ];

    const preludeByHand = (): void => {
      resolve(test, offscreenRoot);
      test.renderer.render(offscreenRoot, offscreenViews, undefined, target);
    };

    const graph = new RenderGraph();
    graph.addPass("world", {
      root: offscreenRoot,
      views: offscreenViews,
      target,
    });
    const preludeByGraph = (): void => {
      resolve(test, offscreenRoot);
      graph.execute(test.renderer);
    };

    // Warm every cache, then measure the on-screen frame after each prelude.
    preludeByHand();
    test.renderer.render(test.scene, test.views);

    preludeByHand();
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    const afterHand = test.recorder.transcript();

    preludeByGraph();
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);
    const afterGraph = test.recorder.transcript();

    expect(afterGraph).toEqual(afterHand);
    // R-4's property, re-proved through the graph: an on-screen frame issues
    // *no* framebuffer call, not even an unbind — so a graph's off-screen pass
    // cannot have left one bound behind.
    expect(
      afterHand.filter((call) => call.startsWith("bindFramebuffer")),
    ).toEqual([]);
  });
});
