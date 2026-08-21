/**
 * The page `tests/browser/mipmaps.spec.ts` drives — §77's mip chain, its
 * min-filter split, and its anisotropy request against a **real** WebGL 2
 * context (R-30b, 2026-08-21).
 *
 * This file is not an example and is not served: the spec bundles it with
 * Vite's JavaScript API and injects the result into a page, the technique R-9's
 * batching gate established and R-28's text gate reused. A minification
 * demonstration is a gate fixture, not a site anyone should visit.
 *
 * It publishes one function on `window`:
 *
 * ```ts
 * fourMipmapProbe(mode: "none" | "trilinear" | "anisotropic", nudge?: number): {
 *   pixels: number[]; drawCalls: number; glError: number; anisotropy: boolean;
 * }
 * ```
 *
 * which draws one heavily **minified** checkerboard the given way and reads the
 * framebuffer back inside the same call, before the compositor can see it — so
 * no `preserveDrawingBuffer` is needed and every read is of the same surface
 * under the same driver.
 *
 * ## What only a browser can answer
 *
 * `tests/integration/texture-mipmaps.test.ts` proves the GL *sequence*: one
 * `generateMipmap`, one changed min-filter enum, one clamped anisotropy
 * parameter. It rasterises nothing, and a mip chain is worth having for exactly
 * one reason a call sequence cannot show — **what a minified texture looks
 * like**.
 *
 * So the fixture draws a 256 × 256 checkerboard of eight-texel cells onto a quad about
 * thirty device pixels across, which is an 8× minification:
 *
 * - with **no chain**, each pixel takes a bilinear tap inside a single
 *   checker cell, so the quad is a field of near-black and near-white pixels
 *   whose pattern depends on the sub-pixel position of the quad — that is the
 *   shimmer, and nudging the quad by a fraction of a pixel moves it;
 * - with a **trilinear** chain the hardware samples a level whose texels are
 *   about pixel-sized, so every pixel is close to the average of the
 *   checkerboard — mid-grey — and the same nudge barely changes anything.
 *
 * Both claims are counted rather than photographed (§92: no goldens in the
 * `chromium` project, since SwiftShader rasterises differently from a GPU), and
 * both are counted against a reference drawn by the same driver in the same
 * call sequence: the other mode.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  Renderable,
  Texture,
  createRenderStatistics,
  resetRenderStatistics,
  type TextureSource,
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

/** Checkerboard size in texels. A power of two only so the chain is exact. */
const TEXELS = 256;

/**
 * Checker cell in texels.
 *
 * **Not 1**, and the reason is worth recording: a one-texel checkerboard is
 * averaged away by plain `LINEAR` *magnification-style* filtering — four
 * neighbouring texels of a one-texel checker are two black and two white — so
 * the un-mipmapped reference would already look grey and the comparison would
 * prove nothing. At eight texels a cell is about one screen pixel at this
 * minification, so a bilinear tap lands *inside* one cell and takes its black
 * or its white. That is the aliasing a mip chain removes.
 */
const CELL = 8;

/**
 * Half-extent of the quad in world units, against a camera 32 units wide: the
 * quad lands about 30 device pixels across, i.e. the 256-texel checkerboard is
 * minified roughly 8×.
 */
const HALF = 1.5;

/** How the probe is asked to draw. */
type Mode = "none" | "trilinear" | "anisotropic";

interface Probe {
  pixels: number[];
  drawCalls: number;
  glError: number;
  anisotropy: boolean;
}

declare global {
  interface Window {
    fourMipmapProbe?: (mode: Mode, nudge?: number) => Probe;
  }
}

/** A checkerboard of {@link CELL}-texel cells: the pattern minification destroys. */
function checkerboard(): Pick<TextureSource, "width" | "height" | "data"> {
  const data = new Uint8Array(TEXELS * TEXELS * 4);
  for (let y = 0; y < TEXELS; y += 1) {
    for (let x = 0; x < TEXELS; x += 1) {
      const value =
        (Math.floor(x / CELL) + Math.floor(y / CELL)) % 2 === 0 ? 255 : 0;
      const index = (y * TEXELS + x) * 4;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { width: TEXELS, height: TEXELS, data };
}

const texels = checkerboard();

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "mipmap-canvas";
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
// A camera is a node: content at z = 0 is in front of it only once it is moved
// back past its own near plane (§47) — the gotcha recorded with R-9's gate.
camera.transform.position.set(0, 0, 20);
camera.updateProjectionMatrix();
resolveWorldTransforms(camera);

const views: Viewport[] = [
  { ...createFullscreenViewport(camera), clearColor: [0, 0, 0, 1] },
];

/** One scene holding one minified checkerboard quad, sampled the given way. */
function build(mode: Mode, nudge: number): Scene {
  const scene = new Scene();
  const texture = new Texture(
    mode === "none"
      ? texels
      : {
          ...texels,
          mipmaps: true,
          minFilter: "linear-mipmap-linear",
          ...(mode === "anisotropic" ? { anisotropy: 8 } : {}),
        },
  );
  const quad = new Renderable(
    planeGeometry({ width: HALF * 2, height: HALF * 2 }),
    new UnlitMaterial({ map: texture, color: [1, 1, 1, 1] }),
  );
  // A sub-pixel shift: with no mip chain it re-samples a different set of
  // texels and the quad's ink changes; with one it lands on the same averaged
  // level and barely moves.
  quad.transform.position.set(nudge, 0, 0);
  scene.add(quad);
  resolveWorldTransforms(scene);
  return scene;
}

void renderer.initialize({ canvas }).then(() => {
  const gl = canvas.getContext("webgl2");
  const anisotropy = gl?.getExtension("EXT_texture_filter_anisotropic") != null;

  window.fourMipmapProbe = (mode: Mode, nudge = 0): Probe => {
    const scene = build(mode, nudge);
    resetRenderStatistics(statistics);
    renderer.render(scene, views);
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    // Read back **now**: the drawing buffer is still intact inside the same
    // task, so every probe reads the same surface.
    gl?.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      pixels: Array.from(pixels),
      drawCalls: statistics.drawCalls,
      // Anisotropy is written through an extension enum; a driver that
      // disliked the call would say so here, and the spec asserts it did not.
      glError: gl?.getError() ?? -1,
      anisotropy,
    };
  };
  document.body.dataset["mipmapReady"] = "1";
});
