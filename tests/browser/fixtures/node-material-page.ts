/**
 * The page `tests/browser/node-material.spec.ts` drives — §60's node
 * materials against a **real** WebGL 2 context (RFC 0001, 2026-08-28).
 *
 * Not an example and not served: the spec bundles this file with Vite's
 * JavaScript API and injects it — `skinning-page.ts`'s argument, unchanged,
 * plus this packet's own: no example calls `registerNodeMaterialPipeline()`,
 * and that is deliberate (the pipeline-cost law — a build that never writes a
 * shader graph carries none of the emitter), so the registered path can only
 * be proven on a page built for it.
 *
 * It publishes exactly one function on `window`:
 *
 * ```ts
 * fourNodeMaterialProbe(): { pixels: number[]; drawCalls: number }
 * ```
 *
 * which renders once and reads the framebuffer back inside the same call.
 *
 * ## The scene is the per-fragment claim, and nothing else
 *
 * One 4×4-world-unit quad painted by a **radial** gradient node graph —
 * `mix(inner, outer, saturate(2 · |uv − ½|))` — the §58 gradient family's
 * exactness proof. Radial on purpose (R-16's recorded boundary): a two-stop
 * *linear* gradient is exact under per-vertex colour too, so it separates
 * nothing; a radial gradient over a two-triangle quad is the picture
 * per-vertex interpolation **cannot** produce — all four corners are the
 * outer colour, so any per-vertex path paints the centre the outer colour,
 * while the graph's fragment stage computes the inner colour there. The spec
 * measures both: analytic per-pixel agreement along a scanline, and the
 * centre/corner separation.
 */

import { planeGeometry } from "@four/geometry";
import { NodeMaterialBuilder } from "@four/materials";
import {
  Renderable,
  createRenderStatistics,
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

declare global {
  interface Window {
    fourNodeMaterialProbe?: () => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "node-material-canvas";
document.body.append(canvas);

// The opt-in this fixture exists to exercise (RFC 0001 §4): without this call
// the node draw below would be skipped with a warning.
registerNodeMaterialPipeline();

const scene = new Scene();

// The radial gradient, authored through §60's builder: no shader source
// exists anywhere on this page — the graph is the only description.
const builder = new NodeMaterialBuilder();
const centered = builder.uv().subtract([0.5, 0.5]);
const t = centered.length().multiply(2).saturate();
builder.output.color = builder.mix(INNER, OUTER, t);
const material = builder.build();

scene.add(new Renderable(planeGeometry({ width: 4, height: 4 }), material));

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
  window.fourNodeMaterialProbe = () => {
    resolveWorldTransforms(scene);
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back inside the same task, before the compositor can see the
    // surface — the `preserveDrawingBuffer`-free idiom every fixture uses.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["nodeMaterialReady"] = "1";
});
