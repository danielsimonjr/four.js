/**
 * The page `tests/browser/shape-paint.spec.ts` drives — §58's paint-object
 * tier against a **real** WebGL 2 context (2026-08-29; R-16's follow-up).
 *
 * Not an example and not served: the spec bundles this file with Vite's
 * JavaScript API and injects it — `node-material-page.ts`'s argument,
 * unchanged: no example calls `registerShapePaints()`, deliberately (the
 * tier is opt-in and a build that never authors a gradient carries none of
 * the lowering), so the registered path can only be proven on a page built
 * for it.
 *
 * It publishes exactly one function on `window`:
 *
 * ```ts
 * fourShapePaintProbe(): { pixels: number[]; drawCalls: number }
 * ```
 *
 * ## The scene is the whole tier in one draw
 *
 * One 4×4-world-unit `Rectangle` whose **fill** is a §58 radial gradient
 * *paint object* — not a hand-built node material: the paint is authored on
 * the shape, the shape derives the material — and whose **stroke** is a
 * solid green band, half a unit wide, centred on the outline. That exercises,
 * in a single `drawElements`:
 *
 * - the paint-to-graph lowering (radial arm + solid arm + the selector
 *   `mix` over the baked colour stream);
 * - per-fragment exactness — the centre is the inner colour while every
 *   fill vertex sits at or beyond the gradient's radius, the picture
 *   per-vertex interpolation cannot produce (RFC 0001's proof, restated
 *   through the paint tier);
 * - the pad rule past the last stop (the rectangle's corners lie beyond
 *   `radius`);
 * - stroke-over-fill inside one geometry (§61's LEQUAL + index order),
 *   through the node pipeline this time.
 */

import {
  Rectangle,
  createRenderStatistics,
  registerShapePaints,
  resetRenderStatistics,
} from "@four/render";
import {
  WebglRenderer,
  registerNodeMaterialPipeline,
} from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";

/** Canvas size the spec creates and this file reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** Half-extents of the camera's view, in world units (40 px per unit). */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

/** The gradient's two stops — restated in the spec's analytic model. */
const INNER: [number, number, number, number] = [1, 0.2, 0, 1];
const OUTER: [number, number, number, number] = [0, 0.2, 1, 1];

/** The stroke's solid paint — restated in the spec. */
const STROKE: [number, number, number, number] = [0, 1, 0, 1];

declare global {
  interface Window {
    fourShapePaintProbe?: () => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "shape-paint-canvas";
document.body.append(canvas);

// The two opt-ins this fixture exists to exercise: the authoring tier and
// the pipeline that draws it.
registerShapePaints();
registerNodeMaterialPipeline();

const scene = new Scene();

// The whole §58 authoring surface: a paint object on the shape, no material
// anywhere on this page.
scene.add(
  new Rectangle({
    width: 4,
    height: 4,
    fill: {
      kind: "radial-gradient",
      center: { x: 0, y: 0 },
      radius: 2,
      stops: [
        { offset: 0, color: INNER },
        { offset: 1, color: OUTER },
      ],
    },
    stroke: {
      width: 0.5,
      paint: { kind: "solid", color: STROKE },
    },
  }),
);

const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 10,
});
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();
resolveWorldTransforms(camera);
const views: Viewport[] = [
  { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
];

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");
  window.fourShapePaintProbe = () => {
    resolveWorldTransforms(scene);
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back inside the same task, before the compositor can see the
    // surface — the `preserveDrawingBuffer`-free idiom every fixture uses.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["shapePaintReady"] = "1";
});
