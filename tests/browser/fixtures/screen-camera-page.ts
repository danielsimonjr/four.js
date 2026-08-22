/**
 * The page `tests/browser/screen-camera.spec.ts` drives — §47's `ScreenCamera`
 * against a **real** WebGL 2 context (R-37, 2026-08-21).
 *
 * Not an example and not served: the spec bundles it with Vite's JavaScript API
 * and injects the result, the technique `batching-page.ts` introduced.
 *
 * It publishes one function on `window`:
 *
 * ```ts
 * fourScreenCameraProbe(origin: "top-left" | "bottom-left" | "centered"):
 *   { pixels: number[]; drawCalls: number }
 * ```
 *
 * which draws **one** 100 × 40 pixel panel through a `ScreenCamera` with the
 * requested origin and reads the framebuffer back inside the same call. The
 * panel's placement is chosen so that each origin puts it in a different corner
 * of the canvas, which is the whole claim: a pixel rectangle authored once
 * lands exactly where the origin convention says it does.
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
  Scene,
  ScreenCamera,
  createFullscreenViewport,
  resolveWorldTransforms,
  type ScreenOrigin,
} from "@four/scene";

/** Canvas size the spec restates. */
const WIDTH = 320;
const HEIGHT = 240;

/** Panel size in logical pixels. */
const PANEL_WIDTH = 100;
const PANEL_HEIGHT = 40;

/** Panel inset from the origin corner, in logical pixels. */
const INSET_X = 20;
const INSET_Y = 30;

declare global {
  interface Window {
    fourScreenCameraProbe?: (origin: ScreenOrigin) => {
      pixels: number[];
      drawCalls: number;
    };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "screen-camera-canvas";
document.body.append(canvas);

const scene = new Scene();
const panel = new Renderable(
  planeGeometry({ width: PANEL_WIDTH, height: PANEL_HEIGHT }),
  new UnlitMaterial({ color: [1, 0.5, 0, 1] }),
);
scene.add(panel);

const camera = new ScreenCamera();
scene.add(camera);

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");
  window.fourScreenCameraProbe = (origin: ScreenOrigin) => {
    camera.origin = origin;
    camera.setSurfaceSize(WIDTH, HEIGHT);
    camera.updateProjectionMatrix();
    // `planeGeometry` is centred on its origin, so the node sits at the middle
    // of the rectangle a layout describes by its corner. With a centered
    // origin the same inset is measured from the middle of the surface, which
    // is what makes the three probes land in three different places.
    panel.transform.position.set(
      INSET_X + PANEL_WIDTH / 2,
      INSET_Y + PANEL_HEIGHT / 2,
      0,
    );
    resetRenderStatistics(statistics);
    resolveWorldTransforms(scene);
    renderer.render(scene, [
      { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
    ]);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back **now**: the drawing buffer is still intact inside the same
    // task, so no `preserveDrawingBuffer` is needed.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { pixels: Array.from(pixels), drawCalls: statistics.drawCalls };
  };
  document.body.dataset["screenCameraReady"] = "1";
});
