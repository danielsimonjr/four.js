/**
 * `buildViewRenderList` and `sortRenderListByDepth` — §64 stages 2–3 and §66's
 * sort key 4 (R-8).
 *
 * The suite is organised around the three properties the design rests on:
 *
 * 1. a derived list is a **subsequence** of the frame list — the same objects,
 *    in the same order, with some removed;
 * 2. a derivation that removes nothing is the frame list, which is what makes
 *    the backend's switch to it byte-identical;
 * 3. the cull's every failure mode keeps the item.
 */

import { BufferGeometry, boxGeometry, planeGeometry } from "@four/geometry";
import { SpriteMaterial, UnlitMaterial } from "@four/materials";
import {
  Frustum,
  Matrix4,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import {
  ALL_LAYERS,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  createFullscreenViewport,
  layerMask,
  resetLayers,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { afterEach, describe, expect, it } from "vitest";

import {
  Renderable,
  Sprite,
  Texture,
  buildRenderList,
  buildViewRenderList,
  sortRenderListByDepth,
  type RenderItem,
} from "../src/index.js";

afterEach(() => {
  resetLayers();
});

/** A quad-carrying renderable at `(x, y, z)`. */
function quad(x = 0, y = 0, z = 0, size = 1): Renderable {
  const node = new Renderable(
    planeGeometry({ width: size, height: size }),
    new UnlitMaterial(),
  );
  node.transform.position.set(x, y, z);
  return node;
}

/** A camera that sees `[-4, 4]²` from `z = 10`, plus its fullscreen viewport. */
function orthoView(id = "main"): {
  camera: OrthographicCamera;
  view: Viewport;
  frustum: Frustum;
} {
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 10);
  camera.updateProjectionMatrix();
  camera.updateViewMatrix();
  const frustum = new Frustum().setFromViewProjection(
    new Matrix4().copy(camera.projectionMatrix).multiply(camera.viewMatrix),
  );
  return { camera, view: createFullscreenViewport(camera, id), frustum };
}

/** A 1x1 sprite material over a one-texel texture. */
function spriteMaterial(): SpriteMaterial {
  return new SpriteMaterial({
    texture: new Texture({
      width: 1,
      height: 1,
      data: new Uint8Array([255, 255, 255, 255]),
    }),
  });
}

/** Builds the frame list for `scene`, world transforms resolved. */
function frameList(scene: Scene): RenderItem[] {
  resolveWorldTransforms(scene);
  return buildRenderList(scene, []);
}

describe("buildViewRenderList — the derivation is a subsequence (§64, §33)", () => {
  it("keeps every item, in order, for a view that filters nothing", () => {
    const scene = new Scene();
    scene.add(quad(0), quad(1), quad(-1));
    const items = frameList(scene);
    const { view } = orthoView();

    const derived = buildViewRenderList(items, view, []);

    // The same objects, not copies: the derived list shares the frame list's
    // pooled items, which is what makes it allocation-free.
    expect(derived).toEqual(items);
    expect(derived[0]).toBe(items[0]);
    expect(derived[1]).toBe(items[1]);
    expect(derived[2]).toBe(items[2]);
  });

  it("returns the caller's array, truncated to what survived", () => {
    const scene = new Scene();
    const hidden = quad(0);
    hidden.layers = layerMask("ui");
    scene.add(quad(0), hidden, quad(0));
    const items = frameList(scene);
    const { view } = orthoView();
    view.layerMask = layerMask("default");
    const out: RenderItem[] = [];

    const derived = buildViewRenderList(items, view, out);

    expect(derived).toBe(out);
    expect(derived).toHaveLength(2);
  });

  it("shrinks and regrows one array across views without allocating a list", () => {
    const scene = new Scene();
    const wide = quad(0);
    wide.layers = layerMask("ui") | layerMask("default");
    scene.add(quad(0), wide, quad(0));
    const items = frameList(scene);
    const { view: left } = orthoView("left");
    const { view: right } = orthoView("right");
    right.layerMask = layerMask("ui");
    const out: RenderItem[] = [];

    buildViewRenderList(items, left, out);
    expect(out).toHaveLength(3);
    buildViewRenderList(items, right, out);
    expect(out).toHaveLength(1);
    buildViewRenderList(items, left, out);
    expect(out).toHaveLength(3);
  });

  it("resolves §48's mask fallback: viewport first, then the camera", () => {
    const scene = new Scene();
    const ui = quad(0);
    ui.layers = layerMask("ui");
    scene.add(quad(0), ui);
    const items = frameList(scene);
    const { camera, view } = orthoView();

    camera.layers = layerMask("ui");
    expect(buildViewRenderList(items, view, [])).toHaveLength(1);
    // A viewport mask overrides the camera's, which is §48's rule.
    view.layerMask = ALL_LAYERS;
    expect(buildViewRenderList(items, view, [])).toHaveLength(2);
  });
});

describe("buildViewRenderList — §87 frustum culling", () => {
  it("drops an item wholly outside the view and keeps the rest", () => {
    const scene = new Scene();
    const inside = quad(0);
    const outside = quad(40);
    scene.add(inside, outside);
    const items = frameList(scene);
    const { view, frustum } = orthoView();

    const derived = buildViewRenderList(items, view, [], { frustum });

    expect(derived).toHaveLength(1);
    expect(derived[0]).toBe(items[0]);
  });

  it("keeps an item that only partly overlaps the view", () => {
    const scene = new Scene();
    // Centre just outside the right plane; a 4-unit quad still reaches in.
    scene.add(quad(5, 0, 0, 4));
    const items = frameList(scene);
    const { view, frustum } = orthoView();

    expect(buildViewRenderList(items, view, [], { frustum })).toHaveLength(1);
  });

  it("culls nothing when no frustum is supplied", () => {
    const scene = new Scene();
    scene.add(quad(0), quad(400));
    const items = frameList(scene);
    const { view } = orthoView();

    expect(buildViewRenderList(items, view, [])).toHaveLength(2);
    expect(
      buildViewRenderList(items, view, [], { frustum: null }),
    ).toHaveLength(2);
  });

  it("honours §49's frustumCulled = false", () => {
    const scene = new Scene();
    const pinned = quad(40);
    pinned.frustumCulled = false;
    scene.add(pinned);
    const items = frameList(scene);
    const { view, frustum } = orthoView();

    expect(items[0].frustumCulled).toBe(false);
    expect(buildViewRenderList(items, view, [], { frustum })).toHaveLength(1);
  });

  it("culls a sprite by its derived quad, like any other geometry (§55)", () => {
    const scene = new Scene();
    const near = new Sprite(spriteMaterial(), { width: 1, height: 1 });
    const far = new Sprite(spriteMaterial(), { width: 1, height: 1 });
    far.transform.position.set(40, 0, 0);
    scene.add(near, far);
    const items = frameList(scene);
    const { view, frustum } = orthoView();

    expect(buildViewRenderList(items, view, [], { frustum })).toHaveLength(1);
  });

  it("keeps an item whose geometry cannot be bounded", () => {
    const scene = new Scene();
    const empty = new Renderable(
      new BufferGeometry({ positions: new Float32Array(0) }),
      new UnlitMaterial(),
    );
    empty.transform.position.set(40, 0, 0);
    scene.add(empty);
    const items = frameList(scene);
    const { view, frustum } = orthoView();

    expect(buildViewRenderList(items, view, [], { frustum })).toHaveLength(1);
  });

  it("culls under a parent's transform, because it reads the world matrix", () => {
    const scene = new Scene();
    const group = new Group();
    const child = quad(0);
    group.add(child);
    group.transform.position.set(40, 0, 0);
    scene.add(group);
    const items = frameList(scene);
    const { view, frustum } = orthoView();

    expect(buildViewRenderList(items, view, [], { frustum })).toHaveLength(0);
  });

  it("applies the layer filter before the cull, so a masked item is never bounded", () => {
    // Observable through the outcome rather than through a spy: an item that is
    // both masked out and inside the frustum must not appear.
    const scene = new Scene();
    const ui = quad(0);
    ui.layers = layerMask("ui");
    scene.add(ui);
    const items = frameList(scene);
    const { view, frustum } = orthoView();
    view.layerMask = layerMask("default");

    expect(buildViewRenderList(items, view, [], { frustum })).toHaveLength(0);
  });

  it("culls per view: one frame list, two cameras, two answers", () => {
    // The property R-8 exists for. One list, two views that disagree about
    // which half of the scene is visible.
    const scene = new Scene();
    scene.add(quad(-20), quad(20));
    const items = frameList(scene);

    const left = orthoView("left");
    left.camera.transform.position.set(-20, 0, 10);
    left.camera.updateViewMatrix();
    left.frustum.setFromViewProjection(
      new Matrix4()
        .copy(left.camera.projectionMatrix)
        .multiply(left.camera.viewMatrix),
    );
    const right = orthoView("right");
    right.camera.transform.position.set(20, 0, 10);
    right.camera.updateViewMatrix();
    right.frustum.setFromViewProjection(
      new Matrix4()
        .copy(right.camera.projectionMatrix)
        .multiply(right.camera.viewMatrix),
    );

    const leftItems = buildViewRenderList(items, left.view, [], {
      frustum: left.frustum,
    });
    expect(leftItems).toEqual([items[0]]);
    const rightItems = buildViewRenderList(items, right.view, [], {
      frustum: right.frustum,
    });
    expect(rightItems).toEqual([items[1]]);
  });
});

describe("sortRenderListByDepth — §66 sort key 4", () => {
  /** A view matrix for a camera at `(0, 0, z)` looking down −Z. */
  function eyeAt(z: number): Matrix4 {
    const camera = new PerspectiveCamera();
    camera.transform.position.set(0, 0, z);
    camera.updateViewMatrix();
    return camera.viewMatrix;
  }

  it("orders opaque draws near to far", () => {
    const scene = new Scene();
    const far = quad(0, 0, -5);
    const near = quad(0, 0, 5);
    const middle = quad(0, 0, 0);
    scene.add(far, near, middle);
    const items = frameList(scene);

    sortRenderListByDepth(items, eyeAt(10));

    expect(items.map((item) => item.worldMatrix.elements[14])).toEqual([
      5, 0, -5,
    ]);
  });

  it("orders transparent draws far to near, under the opaque ones", () => {
    const scene = new Scene();
    const nearBlend = new Renderable(
      planeGeometry(),
      new UnlitMaterial({ transparent: true }),
    );
    nearBlend.transform.position.set(0, 0, 5);
    const farBlend = new Renderable(
      planeGeometry(),
      new UnlitMaterial({ transparent: true }),
    );
    farBlend.transform.position.set(0, 0, -5);
    scene.add(nearBlend, farBlend, quad(0, 0, 0));
    const items = frameList(scene);

    sortRenderListByDepth(items, eyeAt(10));

    // Opaque first (key 2 outranks key 4), then the blended pair back to front.
    expect(items.map((item) => item.transparent)).toEqual([false, true, true]);
    expect(items.map((item) => item.worldMatrix.elements[14])).toEqual([
      0, -5, 5,
    ]);
  });

  it("writes the measurement onto the item, larger meaning farther", () => {
    const scene = new Scene();
    scene.add(quad(0, 0, 4));
    const items = frameList(scene);

    sortRenderListByDepth(items, eyeAt(10));

    expect(items[0].viewDepth).toBeCloseTo(6, 12);
  });

  it("leaves renderLayer outranking depth (key 1)", () => {
    const scene = new Scene();
    const nearButBehind = quad(0, 0, 5);
    nearButBehind.renderLayer = 1;
    scene.add(nearButBehind, quad(0, 0, -5));
    const items = frameList(scene);

    sortRenderListByDepth(items, eyeAt(10));

    expect(items.map((item) => item.renderLayer)).toEqual([0, 1]);
  });

  it("breaks a depth tie with renderOrder (key 5)", () => {
    const scene = new Scene();
    const second = quad(0, 0, 0);
    second.renderOrder = 5;
    const first = quad(0, 0, 0);
    first.renderOrder = -5;
    scene.add(second, first);
    const items = frameList(scene);

    sortRenderListByDepth(items, eyeAt(10));

    expect(items.map((item) => item.renderOrder)).toEqual([-5, 5]);
  });

  it("orders a transparent item before an opaque one back to front, whichever way round they arrive", () => {
    // `buildRenderList` always hands key 2 over already applied, so the
    // comparator only ever sees `a` opaque and `b` transparent through the
    // ordinary path. A caller may sort any list, so the other arm is exercised
    // here by handing the comparator a list in the opposite order.
    const scene = new Scene();
    const blended = new Renderable(
      planeGeometry(),
      new UnlitMaterial({ transparent: true }),
    );
    blended.transform.position.set(0, 0, -4);
    scene.add(blended, quad(0, 0, 4));
    const items = frameList(scene);
    items.reverse();

    sortRenderListByDepth(items, eyeAt(10));

    expect(items.map((item) => item.transparent)).toEqual([false, true]);
  });

  it("measures 0 rather than NaN for a broken world matrix", () => {
    const scene = new Scene();
    const broken = quad(0);
    scene.add(broken, quad(0, 0, 3));
    const items = frameList(scene);
    items[0].worldMatrix.elements[14] = NaN;

    sortRenderListByDepth(items, eyeAt(10));

    // A `NaN` key would make the comparator non-total and the whole order
    // implementation-defined; clamping it to 0 keeps the rest of the list sane.
    expect(items.every((item) => Number.isFinite(item.viewDepth))).toBe(true);
  });

  it("returns the list it sorted, so the two verbs compose", () => {
    const scene = new Scene();
    scene.add(quad(0), quad(0, 0, 3));
    const items = frameList(scene);
    const { view, frustum } = orthoView();

    const sorted = sortRenderListByDepth(
      buildViewRenderList(items, view, [], { frustum }),
      eyeAt(10),
    );

    expect(sorted).toHaveLength(2);
    expect(sorted[0].viewDepth).toBeLessThan(sorted[1].viewDepth);
  });

  it("leaves the frame list's own order untouched when it sorts a derived one", () => {
    // The point of a derived list: the frame's list is the model and a view's
    // reordering must not write back into it.
    const scene = new Scene();
    scene.add(quad(0, 0, -5), quad(0, 0, 5));
    const items = frameList(scene);
    const before = [...items];
    const { view } = orthoView();

    sortRenderListByDepth(buildViewRenderList(items, view, []), eyeAt(10));

    expect(items).toEqual(before);
  });
});

describe("buildViewRenderList — particles are never culled (§36, §87)", () => {
  it("gives a boxed renderable frustumCulled true and a particle system false", () => {
    // The exemption is data on the item, so this is where it is pinned; the
    // particle half is covered by `render-list.test.ts`'s drawable double.
    const scene = new Scene();
    scene.add(new Renderable(boxGeometry(), new UnlitMaterial()));
    const items = frameList(scene);

    expect(items[0].frustumCulled).toBe(true);
  });

  it("starts every item's viewDepth at 0 before a view measures it", () => {
    const scene = new Scene();
    scene.add(quad(0, 0, 7));
    const items = frameList(scene);

    expect(items[0].viewDepth).toBe(0);
  });
});

describe("buildViewRenderList — allocation (§7b, plan D7)", () => {
  it("constructs no math object while culling and sorting a hundred items", () => {
    const scene = new Scene();
    for (let index = 0; index < 100; index += 1) {
      scene.add(quad(index - 50, 0, 0));
    }
    const items = frameList(scene);
    const { camera, view, frustum } = orthoView();
    const out: RenderItem[] = [];
    // Warm the output array up first: a derivation that grows an array is
    // allocating pointers, not math objects, and only the first one does it.
    buildViewRenderList(items, view, out, { frustum });

    resetConstructionCount();
    buildViewRenderList(items, view, out, { frustum });
    sortRenderListByDepth(out, camera.viewMatrix);

    expect(constructionCount()).toBe(0);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(100);
  });
});
