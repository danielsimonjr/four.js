/**
 * The page `tests/browser/clipping.spec.ts` drives — §67's *nested* node-level
 * clips against a **real** WebGL 2 context (R-23, 2026-08-28).
 *
 * Not an example and not served: the spec bundles this file with Vite's
 * JavaScript API and injects it — `stencil-page.ts`'s argument, unchanged,
 * including its last clause: the canvas must be created with `stencil: true`,
 * and no example asks for that.
 *
 * It publishes exactly one function on `window`:
 *
 * ```ts
 * fourClippingProbe(clipped: boolean): { pixels: number[]; drawCalls: number }
 * ```
 *
 * which renders the same scene with the two `node.clip` flags on or off and
 * reads the framebuffer back inside the same call.
 *
 * ## The scene is §67's *nesting* claim, and nothing else
 *
 * R-7's `stencil.spec.ts` already proves one hand-composed mask clips one
 * draw. What only this packet adds — and what therefore is measured here — is
 * the part no material can compose by hand in one pass: **two nested clips
 * intersect**. Three nodes:
 *
 * 1. an **outer clip panel**, 4 × 4 world units centred at (−1, 0), covering
 *    x ∈ [−3, 1] — its own surface paints nothing (`colorWrite: false`), so
 *    the picture is the clipped content alone;
 * 2. an **inner clip panel**, its child, 4 × 4 centred at world (+1, 0),
 *    covering x ∈ [−1, 3];
 * 3. the **content**, the inner panel's child: one orange 8 × 6 rectangle
 *    filling the whole 8 × 6 view.
 *
 * With both clips on, the orange must survive exactly on the intersection —
 * x ∈ [−1, 1], y ∈ [−2, 2], one sixth of the view — and nowhere else. Neither
 * clip alone has that footprint: the outer's region alone would leave 1/3 of
 * the view, the inner's likewise, and their *union* 5/9. The measured sixth is
 * reachable only if both bit planes were written and the content tested their
 * conjunction.
 */

import { UnlitMaterial } from "@four/materials";
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
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";

/** Canvas size the spec creates and this file reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** Half-extents of the camera's view, in world units. */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

/** Each clip panel's size in world units. */
const CLIP_SIZE = 4;

/** How far each panel's centre sits from the view's centre, in world units. */
const CLIP_OFFSET = 1;

/** The content rectangle fills the whole view. */
const CONTENT_WIDTH = 8;
const CONTENT_HEIGHT = 6;

/** The content's colour, chosen so no channel is ambiguous against the clear. */
const ORANGE: [number, number, number, number] = [0.95, 0.45, 0.1, 1];

declare global {
  interface Window {
    fourClippingProbe?: (clipped: boolean) => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "clipping-canvas";
document.body.append(canvas);

const scene = new Scene();

/** A clip panel whose own surface deliberately paints nothing. */
function clipPanel(): Rectangle {
  return new Rectangle({
    material: new UnlitMaterial({ color: [0, 0, 0, 0], colorWrite: false }),
    width: CLIP_SIZE,
    height: CLIP_SIZE,
  });
}

// The outer clip, left of centre.
const outer = clipPanel();
outer.transform.position.set(-CLIP_OFFSET, 0, 0);
scene.add(outer);

// The inner clip, its child, right of centre in *world* terms — the local
// offset is doubled because the parent already moved one unit left.
const inner = clipPanel();
inner.transform.position.set(2 * CLIP_OFFSET, 0, 0);
outer.add(inner);

// The content: one orange rectangle covering the whole view, parented under
// both clips and re-centred on the view by undoing the inner panel's offset.
const content = new Rectangle({
  material: new UnlitMaterial({ color: ORANGE }),
  width: CONTENT_WIDTH,
  height: CONTENT_HEIGHT,
});
content.transform.position.set(-CLIP_OFFSET, 0, 0);
inner.add(content);

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

// The line this fixture exists for (R-7): the drawing buffer gets its stencil
// bits, so the masks the render list emits have somewhere to land.
void renderer.initialize({ canvas, stencil: true }).then(() => {
  const gl = canvas.getContext("webgl2");
  resolveWorldTransforms(scene);
  window.fourClippingProbe = (clipped: boolean) => {
    outer.clip = clipped;
    inner.clip = clipped;
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back inside the same task, before the compositor can see the
    // surface — `stencil-page.ts`'s argument for skipping
    // `preserveDrawingBuffer`.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["clippingReady"] = "1";
});
