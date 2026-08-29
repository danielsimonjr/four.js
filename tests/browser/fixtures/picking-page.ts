/**
 * The page `tests/browser/picking.spec.ts` drives — §71's id-buffer picking
 * against a **real** WebGL 2 context (RFC 0005, 2026-08-28).
 *
 * Not an example and not served: the spec bundles this file with Vite's
 * JavaScript API and injects it — `clipping-page.ts`'s argument, unchanged:
 * no example registers the picking pipeline, and the fixture's whole point is
 * a call sequence (`registerPickingPipeline()` → `createPickingService()` →
 * `update` → `pick`) no shipped page performs.
 *
 * It publishes one async function and one id table on `window`:
 *
 * ```ts
 * fourPickProbe(ndcX: number, ndcY: number): Promise<string | null>
 * fourPickIds: { back: string; front: string; aside: string }
 * ```
 *
 * ## The scene is §71's identity claim, and nothing else
 *
 * Three flat rectangles, arranged so that every wrong answer is a *different*
 * wrong answer:
 *
 * - **back**, 4 × 4 world units at the centre, `renderOrder 0`;
 * - **front**, 2 × 2 at the centre, `renderOrder 1` — co-planar with `back`
 *   and drawn later, so the §66 submission order *is* what puts it on top
 *   (exactly the property the id pass must reproduce, since ids have no
 *   blending to hide behind);
 * - **aside**, 2 × 2 at (+3, 0), clear of both.
 *
 * A pick at the centre must answer `front` (not `back` — that would mean the
 * id pass lost the draw order); half-way out, `back`; at (+3, 0), `aside`;
 * in the empty corner, nothing. The read-back travels WebGL 2's real fence
 * path (`PIXEL_PACK_BUFFER` + `fenceSync`), which only a browser can prove.
 */

import { UnlitMaterial } from "@four/materials";
import { Rectangle, type PickingService } from "@four/render";
import { WebglRenderer, registerPickingPipeline } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";

/** Canvas size the spec creates and this file reads back through picks. */
const WIDTH = 320;
const HEIGHT = 240;

/** Half-extents of the camera's view, in world units. */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

declare global {
  interface Window {
    fourPickProbe?: (ndcX: number, ndcY: number) => Promise<string | null>;
    fourPickIds?: { back: string; front: string; aside: string };
  }
}

const canvas = document.createElement("canvas");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.id = "picking-canvas";
document.body.append(canvas);

function rectangle(
  width: number,
  height: number,
  color: [number, number, number, number],
  renderOrder: number,
): Rectangle {
  const node = new Rectangle({
    material: new UnlitMaterial({ color }),
    width,
    height,
  });
  node.renderOrder = renderOrder;
  return node;
}

const scene = new Scene();
const back = rectangle(4, 4, [0.1, 0.6, 0.2, 1], 0);
const front = rectangle(2, 2, [0.95, 0.45, 0.1, 1], 1);
const aside = rectangle(2, 2, [0.2, 0.3, 0.9, 1], 0);
aside.transform.position.set(3, 0, 0);
scene.add(back);
scene.add(front);
scene.add(aside);

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
const view: Viewport = {
  ...createFullscreenViewport(camera),
  clearColor: [0, 0, 0, 1],
};

// The two lines this fixture exists for: opt in, then build the service.
registerPickingPipeline();
const renderer = new WebglRenderer();

void renderer.initialize({ canvas }).then(() => {
  renderer.resize(WIDTH, HEIGHT);
  resolveWorldTransforms(scene);
  // The on-screen frame first — picking must not disturb it — then the id
  // pass over the same resolved scene.
  renderer.render(scene, [view]);
  const picking: PickingService = renderer.createPickingService();
  picking.update(scene, view);

  window.fourPickIds = { back: back.id, front: front.id, aside: aside.id };
  window.fourPickProbe = async (ndcX: number, ndcY: number) => {
    const result = await picking.pick({ viewport: view, ndcX, ndcY });
    return result.nodeId ?? null;
  };
  document.body.dataset["pickingReady"] = "1";
});
