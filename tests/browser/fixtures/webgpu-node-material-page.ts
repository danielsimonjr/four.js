/**
 * The page `tests/browser/webgpu/webgpu-node-materials.spec.ts` drives — §60's
 * node materials against a **real** WebGPU adapter (WP-R1.9), the twin of
 * `node-material-page.ts`.
 *
 * Not an example and not served: the spec bundles this file with Vite's
 * JavaScript API and injects it, `node-material-page.ts`'s recorded reasons
 * unchanged — no example calls `registerWebgpuNodeMaterialPipeline()`, so the
 * registered path can only be proven on a page built for it.
 *
 * It publishes two async functions on `window`:
 *
 * ```ts
 * fourWebgpuNodeProbe():        // the radial-gradient pixel proof
 *   Promise<{ adapter, error, pixels, drawCalls }>
 * fourWebgpuGraphEffectProbe(): // §70's "graph" kind through renderEffect
 *   Promise<{ adapter, error, source, graded }>
 * ```
 *
 * Both render into a `RenderTarget` and read back through `readPixels` —
 * rows bottom-to-top (§7a), which is what lets the spec reuse the GL twin's
 * pixel arithmetic verbatim.
 *
 * The scene is the GL fixture's, verbatim: one 4×4-world-unit quad painted by
 * the radial gradient `mix(inner, outer, saturate(2 · |uv − ½|))` — all four
 * corners the outer colour, so any per-vertex path paints the centre wrong,
 * while the graph's fragment stage computes the inner colour there.
 */

import { planeGeometry } from "@four/geometry";
import { NodeMaterialBuilder, ShaderGraphBuilder } from "@four/materials";
import {
  RenderTarget,
  Renderable,
  createRenderStatistics,
  resetRenderStatistics,
} from "@four/render";
import {
  WebgpuRenderer,
  registerWebgpuNodeMaterialPipeline,
} from "@four/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";

/** Target size the spec reads back. */
const WIDTH = 320;
const HEIGHT = 240;

/** Half-extents of the camera's view, in world units (40 px per unit). */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

/** The gradient's two stops — restated in the spec's analytic model. */
const INNER: [number, number, number, number] = [1, 0.2, 0, 1];
const OUTER: [number, number, number, number] = [0, 0.2, 1, 1];

/** The §70 probe's source clear and gain — restated in the spec. */
const SOURCE_COLOR: [number, number, number, number] = [0.5, 0.25, 0.125, 1];
const GAIN = 0.5;
const EFFECT_SIZE = 64;

interface NodeProbeResult {
  adapter: boolean;
  error: string | null;
  pixels: number[];
  drawCalls: number;
}

interface GraphEffectProbeResult {
  adapter: boolean;
  error: string | null;
  /** Target A's centre texel. */
  source: number[];
  /** Target B's centre texel after the gain-graph pass. */
  graded: number[];
}

declare global {
  interface Window {
    fourWebgpuNodeProbe?: () => Promise<NodeProbeResult>;
    fourWebgpuGraphEffectProbe?: () => Promise<GraphEffectProbeResult>;
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
document.body.append(canvas);

// The opt-in this fixture exists to exercise (RFC 0001 §4; WP-R1.9).
registerWebgpuNodeMaterialPipeline();

const scene = new Scene();
const builder = new NodeMaterialBuilder();
const centered = builder.uv().subtract([0.5, 0.5]);
const t = centered.length().multiply(2).saturate();
builder.output.color = builder.mix(INNER, OUTER, t);
scene.add(
  new Renderable(planeGeometry({ width: 4, height: 4 }), builder.build()),
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

const renderer = new WebgpuRenderer();
const statistics = createRenderStatistics();
renderer.statistics = statistics;
let adapterReady = false;
let initializeError: string | null = null;

const centreTexel = (bytes: Uint8Array, size: number): number[] => {
  const index = ((size / 2) * size + size / 2) * 4;
  return Array.from(bytes.slice(index, index + 4));
};

const install = (): void => {
  window.fourWebgpuNodeProbe = async (): Promise<NodeProbeResult> => {
    if (!adapterReady) {
      return {
        adapter: false,
        error: initializeError,
        pixels: [],
        drawCalls: 0,
      };
    }
    try {
      const target = new RenderTarget({ width: WIDTH, height: HEIGHT });
      resolveWorldTransforms(scene);
      resetRenderStatistics(statistics);
      renderer.render(scene, views, undefined, target);
      const pixels = new Uint8Array(await renderer.readPixels(target));
      return {
        adapter: true,
        error: null,
        pixels: Array.from(pixels),
        drawCalls: statistics.drawCalls,
      };
    } catch (error: unknown) {
      return {
        adapter: true,
        error: String(error),
        pixels: [],
        drawCalls: -1,
      };
    }
  };

  window.fourWebgpuGraphEffectProbe =
    async (): Promise<GraphEffectProbeResult> => {
      if (!adapterReady) {
        return {
          adapter: false,
          error: initializeError,
          source: [],
          graded: [],
        };
      }
      try {
        const sourceTarget = new RenderTarget({
          width: EFFECT_SIZE,
          height: EFFECT_SIZE,
        });
        const destination = new RenderTarget({
          width: EFFECT_SIZE,
          height: EFFECT_SIZE,
        });
        // An empty scene: the pass is the view's clear, so target A holds an
        // exact, specification-fixed colour.
        const empty = new Scene();
        resolveWorldTransforms(empty);
        renderer.render(
          empty,
          [{ ...createFullscreenViewport(camera), clearColor: SOURCE_COLOR }],
          undefined,
          sourceTarget,
        );
        const screen = new ShaderGraphBuilder("screen");
        screen.output.color = screen
          .sampler("source")
          .multiply(screen.uniform("gain", "float"));
        renderer.renderEffect({
          kind: "effect",
          source: sourceTarget.colorTexture,
          target: destination,
          effect: {
            kind: "graph",
            graph: screen.graph(),
            uniforms: { gain: GAIN },
          },
        });
        const source = new Uint8Array(await renderer.readPixels(sourceTarget));
        const graded = new Uint8Array(await renderer.readPixels(destination));
        return {
          adapter: true,
          error: null,
          source: centreTexel(source, EFFECT_SIZE),
          graded: centreTexel(graded, EFFECT_SIZE),
        };
      } catch (error: unknown) {
        return { adapter: true, error: String(error), source: [], graded: [] };
      }
    };

  document.body.dataset["webgpuNodeReady"] = "1";
};

void renderer
  .initialize({ canvas })
  .then(() => {
    adapterReady = true;
    install();
  })
  .catch((error: unknown) => {
    initializeError = String(error);
    install();
  });
