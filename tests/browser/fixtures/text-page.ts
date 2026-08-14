/**
 * The page `tests/browser/text.spec.ts` drives — §49/§56's `Text` node against a
 * **real** WebGL 2 context (R-28, and R-30's sampler state, 2026-08-13).
 *
 * This file is not an example and is not served: the spec bundles it with
 * Vite's JavaScript API and injects the result into a page, the technique R-9's
 * batching gate established. A text demonstration is a gate fixture rather than
 * a site anyone should visit, and a tenth example site would cost the suite a
 * tenth preview server.
 *
 * It publishes one function on `window`:
 *
 * ```ts
 * fourTextProbe(filter: "nearest" | "linear" | "blank"): {
 *   pixels: number[]; drawCalls: number; glyphs: number; width: number;
 * }
 * ```
 *
 * which renders one label with the atlas sampled the given way — or the empty
 * string, for the background reference — and reads the framebuffer back
 * **inside the same call**, before the compositor can see it, so no
 * `preserveDrawingBuffer` is needed and every read is of the same surface under
 * the same driver.
 *
 * ## What only a browser can answer
 *
 * `tests/integration/text-rendering.test.ts` proves the GL *sequence* a label
 * issues — one `drawElements`, one texture, and the same transcript a plain
 * textured renderable issues. It rasterises nothing. Two claims are left over
 * and both are the driver's:
 *
 * 1. **The glyphs actually appear**, which is a statement about a fragment
 *    shader sampling per-vertex uv into an atlas cell — and the failure modes it
 *    catches are exactly the ones a fake context cannot see: uv off by a cell, a
 *    bleeding gutter, alpha blended the wrong way round, a Y flip.
 * 2. **§77's filter reaches the sampler.** `NEAREST` and `LINEAR` are the same
 *    call with a different enum, and only a rasteriser can say whether they
 *    produce different pixels.
 */

import { UnlitMaterial } from "@four/materials";
import {
  Texture,
  createRenderStatistics,
  resetRenderStatistics,
} from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@four/scene";
import { buildGlyphAtlas } from "@four/text";
import { Text } from "four";

/** Canvas size the spec restates and this file reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** The string drawn. Two lines of different widths, so alignment has work. */
const LABEL = "MOTOR 42\nOK";

const atlas = buildGlyphAtlas();

/** How the probe is asked to draw: two filters, plus the empty reference. */
type Mode = "nearest" | "linear" | "blank";

interface Probe {
  pixels: number[];
  drawCalls: number;
  glyphs: number;
  width: number;
}

declare global {
  interface Window {
    fourTextProbe?: (mode: Mode) => Probe;
    fourTextHold?: (mode: Mode) => void;
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "text-canvas";
document.body.append(canvas);

const renderer = new WebglRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;

const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
// A camera is a node: content at z = 0 is only in front of it once it is moved
// back past its own near plane (§47) — the gotcha recorded with R-9's gate.
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();
resolveWorldTransforms(camera);
const views = [createFullscreenViewport(camera, { clearColor: [0, 0, 0, 1] })];

/** One scene holding one centred, centre-aligned label over one atlas material. */
function build(mode: Mode): { scene: Scene; label: Text } {
  const scene = new Scene();
  const ink = new UnlitMaterial({
    map: new Texture({
      ...atlas,
      filter: mode === "nearest" ? "nearest" : "linear",
    }),
    transparent: true,
    color: [1, 0.85, 0.2, 1],
  });
  const label = new Text(atlas, ink, {
    text: mode === "blank" ? "" : LABEL,
    size: 1.4,
    align: "center",
  });
  // The layout's origin is the first baseline at its left edge, so centring the
  // block is one subtraction of numbers the node already reports (§56).
  label.transform.position.set(-label.layout.width / 2, 0.4, 0);
  scene.add(label);
  resolveWorldTransforms(scene);
  return { scene, label };
}

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");

  // The frame `tests/visual/text.spec.ts` photographs, redrawn every rAF.
  //
  // A *loop* rather than one render, and the reason is the compositor: a WebGL
  // drawing buffer is cleared when the frame is presented unless the context
  // was created with `preserveDrawingBuffer`, so a canvas drawn once and then
  // screenshotted photographs black. The content is static — nothing here
  // reads a clock — so every frame of the loop is the same frame, which is what
  // makes a golden legitimate at all (see that spec's header).
  let held: Scene | null = null;
  window.fourTextHold = (mode: Mode): void => {
    const first = held === null;
    held = build(mode).scene;
    if (!first) return;
    const tick = (): void => {
      if (held !== null) renderer.render(held, views);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  window.fourTextProbe = (mode: Mode): Probe => {
    const { scene, label } = build(mode);
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back **now**: the drawing buffer is still intact inside the same
    // task, so every probe reads the same surface.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      pixels: Array.from(pixels),
      drawCalls: statistics.drawCalls,
      glyphs: label.geometry.vertexCount / 4,
      width: label.layout.width,
    };
  };
  document.body.dataset["textReady"] = "1";
});
