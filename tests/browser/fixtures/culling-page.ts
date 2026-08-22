/**
 * The page `tests/browser/culling.spec.ts` drives — §87's frustum cull against a
 * **real** WebGL 2 context (R-8, 2026-08-09).
 *
 * This file is not an example and is not served: the spec bundles it with
 * Vite's JavaScript API and injects the result into a page, the technique
 * `batching-page.ts` introduced and the spec's header restates.
 *
 * It publishes exactly one function on `window`:
 *
 * ```ts
 * fourCullingProbe(culled: boolean): { pixels: number[]; drawCalls: number }
 * ```
 *
 * which renders the same scene with every node's §49 `frustumCulled` set to
 * `culled`, and reads the framebuffer back **inside the same call**, before the
 * compositor can see it — so no `preserveDrawingBuffer` is needed and the two
 * reads are of the same surface under the same driver.
 *
 * The scene is deliberately half off screen: nine quads inside the camera's box
 * and nine well outside it, plus one that **straddles** the right plane, which
 * is the case a cull must keep. The claim the spec makes is that the two probes
 * produce **bit-identical** pixels while the draw count falls — a cull that
 * changed one pixel would be a cull that removed something visible.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  Renderable,
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

/** Half-width of the camera's box, in world units. */
const HALF_WIDTH = 4;

/** Half-height of the camera's box. */
const HALF_HEIGHT = 3;

/** A quad of `size` world units at `(x, y)`, in its own colour. */
function quad(x: number, y: number, size: number, hue: number): Renderable {
  const node = new Renderable(
    planeGeometry({ width: size, height: size }),
    new UnlitMaterial({
      color: [0.2 + hue * 0.08, 0.9 - hue * 0.07, 0.35 + hue * 0.05, 1],
    }),
  );
  node.transform.position.set(x, y, 0);
  return node;
}

/**
 * The scene: a 3 × 3 block of on-screen quads, a 3 × 3 block far off to the
 * right, and one quad centred exactly on the right plane so that its bounding
 * sphere straddles it.
 *
 * The nodes are added interleaved rather than in two blocks, so the cull has to
 * remove items from the *middle* of the frame list and the survivors' relative
 * order is really exercised.
 */
function buildScene(): Scene {
  const scene = new Scene();
  let hue = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      scene.add(quad(column * 2 - 2, row * 1.8 - 1.8, 1.4, hue));
      hue += 1;
      scene.add(quad(column * 2 + 40, row * 1.8 - 1.8, 1.4, hue));
      hue += 1;
    }
  }
  // Centred on the right plane: half of it is visible, so a correct cull keeps
  // it and a cull that tested the node origin alone would drop it.
  scene.add(quad(HALF_WIDTH, 0, 1.6, 17));
  resolveWorldTransforms(scene);
  return scene;
}

declare global {
  interface Window {
    fourCullingProbe?: (culled: boolean) => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "culling-canvas";
document.body.append(canvas);

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;
const scene = buildScene();
const camera = new OrthographicCamera({
  left: -HALF_WIDTH,
  right: HALF_WIDTH,
  bottom: -HALF_HEIGHT,
  top: HALF_HEIGHT,
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

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");
  window.fourCullingProbe = (culled: boolean) => {
    for (const node of scene.children) {
      if (node instanceof Renderable) {
        node.frustumCulled = culled;
      }
    }
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back **now**: the drawing buffer is still intact inside the same
    // task, so no `preserveDrawingBuffer` is needed and both probes read the
    // same surface.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["cullingReady"] = "1";
});
