/**
 * R-37 — §47's `ScreenCamera` end to end: `scene` builds the projection,
 * `four`'s `Application` feeds it the surface, `render`/`render-webgl` draw the
 * screen-space pass beside the world pass (2026-08-21).
 *
 * Three claims no single package can make on its own:
 *
 * 1. **The standard recipe works.** One scene, two full-surface views with
 *    disjoint §46 layers — a world camera for the world layer, a `ScreenCamera`
 *    for the UI layer — draws each item exactly once and lays the UI out in
 *    pixels. This is the arrangement `R-38` proved the *masking* half of and
 *    `R-37` owes the *camera* half of; together they discharge the §118
 *    flagship's camera-parented panel workaround.
 * 2. **A scene with no screen camera is byte-identical.** Its frame is the one
 *    it always was — which is this packet's byte-identity claim, and an easy
 *    one to make honestly: nothing on the frame path changed at all.
 *    `Application.resize`, the one function that grew a branch, is not on it.
 *
 *    The stronger-sounding A/B — "the world view emits the same calls whether
 *    or not a UI pass follows" — is deliberately **not** asserted here, because
 *    the recording GL double cannot express it: it stores the caller's uniform
 *    arrays by reference, so reading a transcript after a later frame reports
 *    that later frame's numbers. Two transcripts are comparable only when both
 *    frames wrote the same values last, which is exactly what an A/B with
 *    different view counts breaks. Claim 1 makes the same point on the
 *    bindings, which the double does record by value.
 * 3. **Pixels land where the layout says.** A 96 × 32 panel placed at
 *    `(24, 24)` under a top-left origin occupies exactly the NDC rectangle
 *    those pixels name, on a 640 × 480 surface, and moves as the surface
 *    resizes.
 *
 * The scenes are real; only the GL context is a double (`render-graph.test.ts`
 * argues that at length).
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import { Renderable } from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  ScreenCamera,
  createFullscreenViewport,
  defineLayer,
  layerMask,
  resetLayers,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { Application } from "four/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

const WIDTH = 640;
const HEIGHT = 480;

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly world: OrthographicCamera;
  readonly ui: ScreenCamera;
}

/** A quad `w × h` pixels with its **top-left** corner at `(x, y)`. */
function panel(x: number, y: number, w: number, h: number): Renderable {
  const node = new Renderable(
    planeGeometry({ width: w, height: h }),
    new UnlitMaterial({ color: [0.9, 0.4, 0.1, 1] }),
  );
  // `planeGeometry` is centred on its origin, so the node sits at the middle of
  // the rectangle a layout would describe by its corner.
  node.transform.position.set(x + w / 2, y + h / 2, 0);
  return node;
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(WIDTH, HEIGHT);

  const scene = new Scene();
  const world = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -3,
    top: 3,
    near: 0.1,
    far: 100,
  });
  world.transform.position.set(0, 0, 8);
  scene.add(world);

  const ui = new ScreenCamera().setSurfaceSize(WIDTH, HEIGHT);
  ui.updateProjectionMatrix();
  scene.add(ui);

  return { recorder, renderer, scene, world, ui };
}

/** Warms every cache, then records one steady-state frame. */
function steadyFrame(test: Harness, views: Viewport[]): string[] {
  resolveWorldTransforms(test.scene);
  test.renderer.render(test.scene, views);
  test.renderer.render(test.scene, views);
  test.recorder.reset();
  resolveWorldTransforms(test.scene);
  test.renderer.render(test.scene, views);
  return test.recorder.transcript();
}

/** Projects a point through a camera's projection, returning NDC x and y. */
function project(camera: ScreenCamera, x: number, y: number): [number, number] {
  const e = camera.projectionMatrix.elements;
  return [e[0] * x + e[12], e[5] * y + e[13]];
}

beforeEach(() => {
  resetLayers();
});

afterEach(() => {
  resetLayers();
});

describe("R-37 — a screen-space pass beside a world pass (§47, §48)", () => {
  it("draws each item exactly once across two disjoint views", async () => {
    const test = await harness();
    defineLayer("world");
    defineLayer("ui");

    const worldQuad = new Renderable(
      planeGeometry({ width: 2, height: 2 }),
      new UnlitMaterial({ color: [0.2, 0.5, 0.9, 1] }),
    );
    worldQuad.layers = layerMask("world");
    test.scene.add(worldQuad);

    const uiPanel = panel(24, 24, 96, 32);
    uiPanel.layers = layerMask("ui");
    test.scene.add(uiPanel);

    const views: Viewport[] = [
      {
        ...createFullscreenViewport(test.world, "world"),
        clearColor: [0, 0, 0, 1],
        layerMask: layerMask("world"),
      },
      {
        ...createFullscreenViewport(test.ui, "ui"),
        layerMask: layerMask("ui"),
      },
    ];

    const transcript = steadyFrame(test, views);
    const draws = transcript.filter((line) => line.startsWith("draw"));
    // Two drawables, two views, two draws: no overdraw, which is the whole
    // point of the arrangement (R-38's claim 3, now with a real UI camera).
    expect(draws).toHaveLength(2);
    // …and they are two *different* items, not one item drawn twice: each draw
    // binds its own geometry's vertex array. This is the assertion that
    // separates "each view drew its own item" from "one view drew everything",
    // and it is made on the bindings rather than on the uniform payloads
    // because the recorder retains the caller's arrays by reference — a
    // uniform value read back after a later frame is that later frame's.
    const arrays = transcript.filter((line) =>
      line.startsWith("bindVertexArray({"),
    );
    expect(arrays).toHaveLength(2);
    expect(arrays[0]).not.toBe(arrays[1]);
    // The world view runs first: its colour clear precedes the UI pass, which
    // clears depth only so that the UI draws over the world rather than
    // through it.
    const clears = transcript.filter((line) => line.startsWith("clear("));
    expect(clears).toHaveLength(2);
    expect(transcript.indexOf("clearColor(0, 0, 0, 1)")).toBeLessThan(
      transcript.lastIndexOf(clears[1]),
    );
  });

  it("emits an unchanged frame for a scene that has no screen camera", async () => {
    // The byte-identity statement: a scene authored before this packet renders
    // exactly as it did. Both harnesses build the same frame; the second one
    // merely has a `ScreenCamera` sitting unused in the scene graph, which a
    // renderer must not notice (a camera is not a `Renderable`, §64).
    const plain = await harness();
    plain.scene.remove(plain.ui);
    plain.scene.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [1, 0, 0, 1] }),
      ),
    );
    const before = steadyFrame(plain, [
      { ...createFullscreenViewport(plain.world), clearColor: [0, 0, 0, 1] },
    ]);

    const withCamera = await harness();
    withCamera.scene.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [1, 0, 0, 1] }),
      ),
    );
    const after = steadyFrame(withCamera, [
      {
        ...createFullscreenViewport(withCamera.world),
        clearColor: [0, 0, 0, 1],
      },
    ]);

    expect(after).toEqual(before);
    expect(before.filter((line) => line.startsWith("draw"))).toHaveLength(1);
  });
});

describe("R-37 — the application feeds the camera its surface (§45)", () => {
  it("places a 96 × 32 panel at exactly the pixels the layout names", () => {
    const camera = new ScreenCamera();
    const app = new Application({ views: [createFullscreenViewport(camera)] });
    app.resize(WIDTH, HEIGHT);

    const [left, top] = project(camera, 24, 24);
    const [right, bottom] = project(camera, 24 + 96, 24 + 32);
    // 24 px from the left of 640 is 7.5% across; NDC spans [-1, 1].
    expect(left).toBeCloseTo(-1 + (2 * 24) / WIDTH, 12);
    expect(right).toBeCloseTo(-1 + (2 * 120) / WIDTH, 12);
    // Y is flipped for a top-left origin: 24 px *down* from the top.
    expect(top).toBeCloseTo(1 - (2 * 24) / HEIGHT, 12);
    expect(bottom).toBeCloseTo(1 - (2 * 56) / HEIGHT, 12);
  });

  it("keeps a pixel margin at the same pixel across a resize", () => {
    const camera = new ScreenCamera();
    const app = new Application({ views: [createFullscreenViewport(camera)] });

    app.resize(WIDTH, HEIGHT);
    const wide = project(camera, 24, 24);
    app.resize(320, 240);
    const narrow = project(camera, 24, 24);

    // The same 24 px inset is now a larger fraction of a smaller surface —
    // which is what "laid out in pixels" means, and the opposite of what a
    // world-space panel does.
    expect(narrow[0]).toBeGreaterThan(wide[0]);
    expect(narrow[0]).toBeCloseTo(-1 + (2 * 24) / 320, 12);
    expect(camera.width).toBe(320);
  });
});
