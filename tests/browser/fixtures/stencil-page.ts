/**
 * The page `tests/browser/stencil.spec.ts` drives — §67's stencil mask against
 * a **real** WebGL 2 context (R-7, 2026-08-11).
 *
 * This file is not an example and is not served: the spec bundles it with
 * Vite's JavaScript API and injects the result into a page, because a masking
 * demonstration is a gate fixture rather than a site anyone should visit. That
 * is `batching-page.ts`'s argument, and it applies here for one more reason —
 * the canvas has to be created with `stencil: true`, and no example asks for
 * that.
 *
 * It publishes exactly one function on `window`:
 *
 * ```ts
 * fourStencilProbe(masked: boolean): { pixels: number[]; drawCalls: number }
 * ```
 *
 * which renders the same two-pass scene with the fill's stencil test on or off
 * and reads the framebuffer back **inside the same call**, before the
 * compositor can see it — so no `preserveDrawingBuffer` is needed and both
 * reads are of the same surface under the same driver.
 *
 * ## The scene is the §67 composition, and nothing else
 *
 * Two draws over one camera:
 *
 * 1. a **mask** rectangle, 2 × 2 world units, with `colorWrite: false` and
 *    `new StencilState({ func: "always", ref: 1, passOp: "replace" })` — it paints no
 *    pixel and writes 1 into the stencil buffer wherever it covers;
 * 2. a **fill** rectangle, 6 × 4 world units, orange, with
 *    `new StencilState({ func: "equal", ref: 1, writeMask: 0 })` — it covers most of the
 *    screen and may only reach the pixels the mask claimed.
 *
 * With the test on, the orange is confined to the mask's 2 × 2; with it off,
 * the same draw covers the whole 6 × 4. The ratio between the two orange counts
 * is the measurement, and it is one a fake GL context cannot make: whether the
 * stencil buffer exists, is cleared, and is tested is entirely the driver's.
 */

import { StencilState, UnlitMaterial } from "@four/materials";
import {
  Rectangle,
  createRenderStatistics,
  resetRenderStatistics,
} from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  type Viewport,
  resolveWorldTransforms,
} from "@four/scene";

/** Canvas size the spec creates and this file reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** Half-extents of the camera's view, in world units. */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

/** The mask rectangle's size in world units. */
const MASK_WIDTH = 2;
const MASK_HEIGHT = 2;

/** The fill rectangle's size in world units. */
const FILL_WIDTH = 6;
const FILL_HEIGHT = 4;

/** The fill's colour, chosen so no channel is ambiguous against the clear. */
const ORANGE: [number, number, number, number] = [0.95, 0.45, 0.1, 1];

declare global {
  interface Window {
    fourStencilProbe?: (masked: boolean) => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "stencil-canvas";
document.body.append(canvas);

const scene = new Scene();

// Pass 1 — the mask. No colour, no depth write: a mask occluded by the very
// geometry it masks would punch a hole in itself.
const maskMaterial = new UnlitMaterial({
  color: [0, 0, 0, 0],
  colorWrite: false,
  depthWrite: false,
  stencil: new StencilState({ func: "always", ref: 1, passOp: "replace" }),
});
const mask = new Rectangle({
  material: maskMaterial,
  width: MASK_WIDTH,
  height: MASK_HEIGHT,
});
scene.add(mask);

// Pass 2 — the fill. Added second, and drawn second: §66 orders two opaque
// draws of one pipeline by material, and the mask's material was constructed
// first. The spec asserts the *result*, which is what would fail if that ever
// stopped being true.
const fillMaterial = new UnlitMaterial({ color: ORANGE });
const fill = new Rectangle({
  material: fillMaterial,
  width: FILL_WIDTH,
  height: FILL_HEIGHT,
});
// Slightly behind the mask, so neither depth-fights the other.
fill.transform.position.set(0, 0, -0.5);
scene.add(fill);

const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 10,
});
// A camera is a node: content at z = 0 is only in front of it once it is moved
// back past its own near plane (§47), exactly as `examples/first-2d-scene` does.
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();
resolveWorldTransforms(camera);
// Tests typecheck gate (2026-08-21): this read
// `createFullscreenViewport(camera, { clearColor: [0, 0, 0, 1] })`, whose
// second parameter is the view **id** (a string), not an options object — so
// the page asked for an opaque black clear and got a view with no
// `clearColor` at all, i.e. one that never cleared. Spreading the fullscreen
// viewport and setting the field is how `viewport.ts` documents it.
const views: Viewport[] = [
  { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
];

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;

// The one line this whole fixture exists for: the drawing buffer is asked for a
// stencil buffer. Without it every draw below still runs, and the mask simply
// does not mask — which is exactly what §61 requires of a backend that cannot
// honour a render-state request, and what the spec's control run measures.
void renderer.initialize({ canvas, stencil: true }).then(() => {
  const gl = canvas.getContext("webgl2");
  resolveWorldTransforms(scene);
  window.fourStencilProbe = (masked: boolean) => {
    fillMaterial.stencil = masked
      ? new StencilState({ func: "equal", ref: 1, writeMask: 0 })
      : undefined;
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back **now**: the drawing buffer is still intact inside the same
    // task, so no `preserveDrawingBuffer` is needed and both probes read the
    // same surface.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["stencilReady"] = "1";
});
