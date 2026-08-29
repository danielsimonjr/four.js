/**
 * The page `tests/browser/raster.spec.ts` drives — §77a's raster painting
 * stack against a **real** browser 2D canvas and a **real** WebGL 2 driver
 * (RFC 0004, 2026-08-29).
 *
 * This file is not an example and is not served: the spec bundles it with
 * Vite's JavaScript API and injects the result into a page — the technique
 * R-9's batching gate established and the mipmap gate reused.
 *
 * It publishes one function on `window`:
 *
 * ```ts
 * fourRasterProbe(top: Color, bottom: Color, mode: Mode): {
 *   pixels: number[]; drawCalls: number; glError: number; updated: boolean | null;
 * }
 * ```
 *
 * which repaints a host `<canvas>` 2D context two-toned (top half / bottom
 * half), drives the `CanvasTexture` the given way, renders one textured quad,
 * and reads the framebuffer back inside the same call.
 *
 * ## What only a browser can answer
 *
 * `packages/render/tests/raster.test.ts` proves the buffer, the flip, and the
 * dirty tracking against scripted sources; nothing in it touches a real
 * `CanvasRenderingContext2D` or rasterises a pixel. The three claims only a
 * browser can make:
 *
 * - **the adapter in §77a's own documentation works verbatim** — a real
 *   `getImageData` feeds `readPixels`, through a `RasterSource` with
 *   `origin: "top-left"`;
 * - **orientation survives the whole path**: the half painted at the *top* of
 *   the host canvas renders at the *top* of the quad (the one flip rule,
 *   proven end to end — a vertically mirrored minimap is the bug the rule
 *   exists to prevent);
 * - **dirty tracking is honest on a real driver**: a repaint of the host
 *   canvas alone changes nothing on screen, `invalidate()` alone changes
 *   nothing on screen, and only `update()` re-reads and re-uploads.
 *
 * Per §92 there are no golden images in the `chromium` project; the spec
 * asserts counted thresholds, using pure primaries so the assertions hold
 * whether or not the sRGB decode (§60a — `CanvasTexture` defaults to
 * `"srgb"`) is followed by an output transform: 0 and 255 are fixed points of
 * the transfer curve.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  CanvasTexture,
  Renderable,
  createRenderStatistics,
  resetRenderStatistics,
  type RasterSource,
} from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";

/** Canvas size the spec restates and this file reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** Painted surface size in texels. */
const TEXELS_W = 128;
const TEXELS_H = 96;

/** Quad extent in world units against a 32 × 24-unit camera: half the canvas. */
const QUAD_W = 16;
const QUAD_H = 12;

type Color = readonly [number, number, number];

/** How the probe drives the texture after repainting the host canvas. */
type Mode = "update" | "invalidate-only" | "paint-only";

interface Probe {
  pixels: number[];
  drawCalls: number;
  glError: number;
  /** What `update()` returned, or `null` when the mode never called it. */
  updated: boolean | null;
}

declare global {
  interface Window {
    fourRasterProbe?: (top: Color, bottom: Color, mode: Mode) => Probe;
  }
}

// --- the host surface: a real 2D canvas the APPLICATION paints ---------------

const painted = document.createElement("canvas");
painted.width = TEXELS_W;
painted.height = TEXELS_H;
const maybeContext = painted.getContext("2d", { willReadFrequently: true });
if (maybeContext === null) {
  throw new Error("no 2d context");
}
const ctx = maybeContext;

let topColor: Color = [255, 0, 0];
let bottomColor: Color = [0, 0, 255];

/** Repaints the host canvas: `topColor` above, `bottomColor` below. */
function paintNow(): void {
  ctx.fillStyle = `rgb(${String(topColor[0])}, ${String(topColor[1])}, ${String(topColor[2])})`;
  ctx.fillRect(0, 0, TEXELS_W, TEXELS_H / 2);
  ctx.fillStyle = `rgb(${String(bottomColor[0])}, ${String(bottomColor[1])}, ${String(bottomColor[2])})`;
  ctx.fillRect(0, TEXELS_H / 2, TEXELS_W, TEXELS_H / 2);
}

// §77a's browser adapter, verbatim in shape: the engine names `RasterSource`,
// the application closes over its own 2D context. `getImageData` returns the
// top row first, which is exactly what `origin: "top-left"` declares.
const source: RasterSource = {
  width: TEXELS_W,
  height: TEXELS_H,
  origin: "top-left",
  paint: paintNow,
  readPixels: (out) => {
    out.set(ctx.getImageData(0, 0, TEXELS_W, TEXELS_H).data);
  },
};

const texture = new CanvasTexture(source);

// --- the scene: one textured quad ahead of an orthographic camera ------------

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "raster-canvas";
document.body.append(canvas);

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;

const camera = new OrthographicCamera({
  left: -16,
  right: 16,
  bottom: -12,
  top: 12,
  near: 0.1,
  far: 100,
});
camera.transform.position.set(0, 0, 20);
camera.updateProjectionMatrix();
resolveWorldTransforms(camera);

const views: Viewport[] = [
  { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
];

const scene = new Scene();
const quad = new Renderable(
  planeGeometry({ width: QUAD_W, height: QUAD_H }),
  new UnlitMaterial({ map: texture, color: [1, 1, 1, 1] }),
);
scene.add(quad);
resolveWorldTransforms(scene);

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");

  window.fourRasterProbe = (top: Color, bottom: Color, mode: Mode): Probe => {
    topColor = top;
    bottomColor = bottom;
    let updated: boolean | null = null;
    if (mode === "paint-only") {
      // The application repainted its canvas and told the engine nothing:
      // §77a's tier polls nothing, so the frame must show the old picture.
      paintNow();
    } else if (mode === "invalidate-only") {
      // Stale, but never read: `update()` is application-driven by decision
      // (RFC 0004 Q6 — no hook, no warning), so this too shows the old frame.
      texture.invalidate();
    } else {
      texture.invalidate();
      updated = texture.update(); // paint → read → flip → version bump
    }

    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back now, inside the same task, before the compositor sees it.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      pixels: Array.from(pixels),
      drawCalls: statistics.drawCalls,
      glError: gl?.getError() ?? -1,
      updated,
    };
  };
  document.body.dataset["rasterReady"] = "1";
});
