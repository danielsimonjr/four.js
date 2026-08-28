/**
 * §67 clipping through the render-list walk (R-23, 2026-08-28) — the half a
 * clip's *meaning* lives in.
 *
 * The allocator's own contract is `clip.test.ts`; this file pins what the
 * builders do with it: a clip node emits a mask draw ahead of everything, its
 * **subtree** (never the node itself — the mirror of §46's self-only layers)
 * carries one shared test record, nested clips intersect by accumulating bits,
 * siblings get distinct planes, the ninth clip spills with a warning, and a
 * scene that names no clip produces items whose `clip` is `null` everywhere —
 * the byte-identity anchor.
 */

import { resetDevWarnings } from "@four/core";
import { planeGeometry } from "@four/geometry";
import { SpriteMaterial, UnlitMaterial } from "@four/materials";
import {
  ALL_LAYERS,
  DEFAULT_LAYER_MASK,
  Group,
  OrthographicCamera,
  PoseBuffer,
  Scene,
  createFullscreenViewport,
  defineLayer,
  layerMask,
  resetLayers,
  resolveWorldTransforms,
} from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CLIP_PLANES,
  PARTICLE_INSTANCE_FLOATS,
  Renderable,
  Sprite,
  Texture,
  buildInterpolatedRenderList,
  buildRenderList,
  buildViewRenderList,
  groupRenderListByPipeline,
  sortRenderListByDepth,
  type RenderItem,
} from "../src/index.js";

function silenceWarnings() {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
  resetDevWarnings();
  resetLayers();
});

/** A named renderable over its own geometry, so items are identifiable. */
function renderable(name: string): Renderable {
  const node = new Renderable(planeGeometry(), new UnlitMaterial());
  node.name = name;
  return node;
}

/** §36's structural drawable contract, reduced to what a render list reads. */
class ParticlesDouble extends Group {
  readonly isParticleDrawable = true;

  particleCount = 1;

  readonly particleInstances = new Float32Array(PARTICLE_INSTANCE_FLOATS);

  updateParticleInstances(): void {
    // Nothing to repack: this double exists for the item's own fields.
  }
}

describe("§67 — a clip node emits a mask draw for its subtree", () => {
  it("emits the mask first, colourless, unshadowed, uncullable, on every layer", () => {
    const scene = new Scene();
    const panel = renderable("panel");
    panel.clip = true;
    const child = renderable("child");
    panel.add(child);
    scene.add(panel);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    // Panel content + child content + one mask draw.
    expect(list).toHaveLength(3);
    const mask = list[0];
    expect(mask.clip?.maskPass).toBe(true);
    expect(mask.geometry).toBe(panel.geometry);
    expect(mask.castShadow).toBe(false);
    expect(mask.receiveShadow).toBe(false);
    expect(mask.frustumCulled).toBe(false);
    expect(mask.transparent).toBe(false);
    expect(mask.layers).toBe(ALL_LAYERS);
    expect(mask.clip?.stencil).toMatchObject({
      func: "always",
      ref: 0b1,
      writeMask: 0b1,
      passOp: "replace",
    });
  });

  it("clips the subtree and not the node — §46's mirror, with opposite scope", () => {
    const scene = new Scene();
    const panel = renderable("panel");
    panel.clip = true;
    const child = renderable("child");
    const grandchild = renderable("grandchild");
    child.add(grandchild);
    panel.add(child);
    scene.add(panel);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const panelItem = list.find(
      (item) =>
        item.geometry === panel.geometry && item.clip?.maskPass !== true,
    );
    const childItem = list.find((item) => item.geometry === child.geometry);
    const grandItem = list.find(
      (item) => item.geometry === grandchild.geometry,
    );
    // The panel paints its own background unclipped by itself…
    expect(panelItem?.clip).toBeNull();
    // …and contains everything below it, through one *shared* record — the
    // identity is what lets the batcher compare with a single `!==`.
    expect(childItem?.clip?.maskPass).toBe(false);
    expect(childItem?.clip?.stencil).toMatchObject({
      func: "equal",
      ref: 0b1,
      readMask: 0b1,
      writeMask: 0,
    });
    expect(grandItem?.clip).toBe(childItem?.clip);
  });

  it("clips a §36 particle system inside the subtree like any other draw", () => {
    const scene = new Scene();
    const panel = renderable("panel");
    panel.clip = true;
    panel.add(new ParticlesDouble());
    scene.add(panel);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const particles = list.find((item) => item.kind === "particles");
    expect(particles?.clip?.maskPass).toBe(false);
    expect(particles?.clip?.stencil.ref).toBe(0b1);
  });

  it("emits a sprite clip's mask through the sprite pipeline, quad not alpha", () => {
    const scene = new Scene();
    const texture = new Texture({
      width: 1,
      height: 1,
      data: new Uint8Array([255, 255, 255, 255]),
    });
    const sprite = new Sprite(new SpriteMaterial({ texture }), { clip: true });
    sprite.add(renderable("inside"));
    scene.add(sprite);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const mask = list[0];
    expect(mask.clip?.maskPass).toBe(true);
    expect(mask.kind).toBe("sprite");
    // The whole quad writes the mask — §67's alpha masks are a staged tier.
    expect(mask.geometry).toBe(sprite.geometry);
  });
});

describe("§67 — nesting intersects, siblings do not share planes", () => {
  it("accumulates bits down a nested chain: deeper passes both tests", () => {
    const scene = new Scene();
    const outer = renderable("outer");
    outer.clip = true;
    const inner = renderable("inner");
    inner.clip = true;
    const content = renderable("content");
    inner.add(content);
    outer.add(inner);
    scene.add(outer);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const masks = list.filter((item) => item.clip?.maskPass === true);
    expect(masks).toHaveLength(2);
    // The inner node's *own* draw is tested by the outer clip only…
    const innerItem = list.find(
      (item) =>
        item.geometry === inner.geometry && item.clip?.maskPass !== true,
    );
    expect(innerItem?.clip?.stencil.ref).toBe(0b01);
    // …its content by both — the intersection, in one test.
    const contentItem = list.find((item) => item.geometry === content.geometry);
    expect(contentItem?.clip?.stencil.ref).toBe(0b11);
    expect(contentItem?.clip?.stencil.readMask).toBe(0b11);
    // The inner mask writes its own plane only. It is itself *not* stencil-
    // tested (`always`): writing its bit outside the outer region is harmless,
    // because the intersection test requires the outer bit too.
    const innerMask = masks.find((item) => item.clip?.stencil.ref === 0b10);
    expect(innerMask?.clip?.stencil.writeMask).toBe(0b10);
  });

  it("gives sibling clips distinct planes, so neither passes the other's test", () => {
    const scene = new Scene();
    const left = renderable("left");
    left.clip = true;
    const leftChild = renderable("leftChild");
    left.add(leftChild);
    const right = renderable("right");
    right.clip = true;
    const rightChild = renderable("rightChild");
    right.add(rightChild);
    scene.add(left);
    scene.add(right);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const leftItem = list.find((item) => item.geometry === leftChild.geometry);
    const rightItem = list.find(
      (item) => item.geometry === rightChild.geometry,
    );
    expect(leftItem?.clip?.stencil.ref).toBe(0b01);
    expect(rightItem?.clip?.stencil.ref).toBe(0b10);
    expect(leftItem?.clip).not.toBe(rightItem?.clip);
  });

  it("assigns planes in traversal order, identically on every build (§33)", () => {
    const scene = new Scene();
    const nodes = ["a", "b", "c"].map((name) => {
      const node = renderable(name);
      node.clip = true;
      node.add(renderable(`${name}-child`));
      scene.add(node);
      return node;
    });
    resolveWorldTransforms(scene);

    const first = buildRenderList(scene, []).map(
      (item) => item.clip?.stencil.ref ?? 0,
    );
    const second = buildRenderList(scene, []).map(
      (item) => item.clip?.stencil.ref ?? 0,
    );
    expect(second).toEqual(first);
    expect(nodes).toHaveLength(3);
  });
});

describe("§67 — the ninth clip spills, with the required diagnostic", () => {
  function overBudgetScene(): { scene: Scene; ninthChild: Renderable } {
    const scene = new Scene();
    for (let index = 0; index < MAX_CLIP_PLANES; index += 1) {
      const clip = renderable(`clip-${String(index)}`);
      clip.clip = true;
      clip.add(renderable(`content-${String(index)}`));
      scene.add(clip);
    }
    const ninth = renderable("ninth");
    ninth.clip = true;
    const ninthChild = renderable("ninth-child");
    ninth.add(ninthChild);
    scene.add(ninth);
    resolveWorldTransforms(scene);
    return { scene, ninthChild };
  }

  it("drops the ninth clip: its subtree keeps what it inherited and draws", () => {
    const warn = silenceWarnings();
    const { scene, ninthChild } = overBudgetScene();

    const list = buildRenderList(scene, []);
    const masks = list.filter((item) => item.clip?.maskPass === true);
    expect(masks).toHaveLength(MAX_CLIP_PLANES);
    // The ninth clip's subtree is *drawn* — failing toward drawing, the R-8
    // precedent — and inherits nothing here because the ninth clip is at the
    // root: it spills, it does not vanish.
    const spilled = list.find((item) => item.geometry === ninthChild.geometry);
    expect(spilled).toBeDefined();
    expect(spilled?.clip).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("§67");
  });

  it("keeps the inherited intersection when a *nested* clip is the one refused", () => {
    const warn = silenceWarnings();
    const scene = new Scene();
    let parent: Renderable | Scene = scene;
    // Nine nested clips: the innermost is the refused one.
    for (let index = 0; index <= MAX_CLIP_PLANES; index += 1) {
      const clip = renderable(`nested-${String(index)}`);
      clip.clip = true;
      parent.add(clip);
      parent = clip;
    }
    const content = renderable("content");
    parent.add(content);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const item = list.find((entry) => entry.geometry === content.geometry);
    // Clipped by the eight that fit — a superset of the asked-for region,
    // never an empty one.
    expect(item?.clip?.stencil.ref).toBe(0xff);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("§67 — the clip that cannot mean anything warns and stays inert", () => {
  it("warns once for a clip on a node that draws nothing, and does not narrow", () => {
    const warn = silenceWarnings();
    const scene = new Scene();
    const group = new Group();
    group.clip = true;
    const child = renderable("child");
    group.add(child);
    scene.add(group);
    resolveWorldTransforms(scene);

    const out: RenderItem[] = [];
    buildRenderList(scene, out);
    buildRenderList(scene, out);
    expect(out).toHaveLength(1);
    // Inert toward drawing: the child is not masked to nothing.
    expect(out[0].clip).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(group.id);
  });
});

describe("§67 — byte-identity anchors and interactions", () => {
  it("writes null on every item of a scene that names no clip", () => {
    const scene = new Scene();
    scene.add(renderable("a"));
    scene.add(renderable("b"));
    resolveWorldTransforms(scene);

    for (const item of buildRenderList(scene, [])) {
      expect(item.clip).toBeNull();
    }
  });

  it("rewrites a pooled slot's clip on the next build — no stale record", () => {
    const scene = new Scene();
    const panel = renderable("panel");
    panel.clip = true;
    panel.add(renderable("child"));
    scene.add(panel);
    resolveWorldTransforms(scene);

    const out: RenderItem[] = [];
    buildRenderList(scene, out);
    expect(out.some((item) => item.clip !== null)).toBe(true);

    panel.clip = false;
    buildRenderList(scene, out);
    for (const item of out) {
      expect(item.clip).toBeNull();
    }
  });

  it("emits the mask even when the clip node is off the build's layer mask", () => {
    // A mask is not content: filtering it with §46 would not draw *less* of
    // the subtree, it would draw none of it (the test would never pass).
    const scene = new Scene();
    defineLayer("overlay");
    const panel = renderable("panel");
    panel.clip = true;
    panel.layers = layerMask("overlay");
    const child = renderable("child");
    panel.add(child);
    scene.add(panel);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, [], DEFAULT_LAYER_MASK);
    // The panel's own content item is filtered out; the child still draws,
    // and it draws *clipped*, which needs the mask to have been emitted.
    expect(list.some((item) => item.clip?.maskPass === true)).toBe(true);
    const childItem = list.find((item) => item.geometry === child.geometry);
    expect(childItem?.clip?.stencil.ref).toBe(0b1);
  });

  it("prunes the mask with the subtree when the clip node is invisible", () => {
    const scene = new Scene();
    const panel = renderable("panel");
    panel.clip = true;
    panel.visible = false;
    panel.add(renderable("child"));
    scene.add(panel);
    resolveWorldTransforms(scene);

    expect(buildRenderList(scene, [])).toHaveLength(0);
  });

  it("builds the identical clip structure through the interpolated builder", () => {
    const scene = new Scene();
    const outer = renderable("outer");
    outer.clip = true;
    const inner = renderable("inner");
    inner.clip = true;
    inner.add(renderable("content"));
    outer.add(inner);
    scene.add(outer);
    resolveWorldTransforms(scene);

    const plain = buildRenderList(scene, []);
    const interpolated = buildInterpolatedRenderList(
      scene,
      new PoseBuffer(),
      0.5,
      [],
    );
    expect(
      interpolated.map((item) => [
        item.clip?.maskPass ?? null,
        item.clip?.stencil.ref ?? null,
      ]),
    ).toEqual(
      plain.map((item) => [
        item.clip?.maskPass ?? null,
        item.clip?.stencil.ref ?? null,
      ]),
    );
  });

  it("writes an empty materialId on a mask from a material double predating §57's id", () => {
    // The same defence `collect`'s content arm carries, reachable through the
    // mask arm too: a structurally-typed material without `id` must collapse
    // into the ungrouped group rather than hand `undefined` to a comparator.
    const scene = new Scene();
    const panel = new Renderable(planeGeometry(), {
      kind: "unlit",
      color: [1, 1, 1, 1],
    } as unknown as UnlitMaterial);
    panel.clip = true;
    panel.add(renderable("child"));
    scene.add(panel);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const mask = list[0];
    expect(mask.clip?.maskPass).toBe(true);
    expect(mask.materialId).toBe("");
  });

  it("sorts a mask ahead from either side of the comparison", () => {
    // Which direction a sort visits a pair in is the implementation's
    // business, so both orders of the two-item list are offered and both must
    // land mask-first — this is what pins the comparator's `bMask` arm.
    const scene = new Scene();
    const panel = renderable("panel");
    panel.clip = true;
    panel.add(renderable("child"));
    scene.add(panel);
    const camera = new OrthographicCamera({
      left: -3,
      right: 3,
      bottom: -3,
      top: 3,
    });
    scene.add(camera);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    const mask = list[0];
    const content = list[1];
    expect(mask.clip?.maskPass).toBe(true);

    for (const pair of [
      [mask, content],
      [content, mask],
    ]) {
      const grouped = groupRenderListByPipeline([...pair]);
      expect(grouped[0]).toBe(mask);
      camera.updateViewMatrix();
      const depthSorted = sortRenderListByDepth([...pair], camera.viewMatrix);
      expect(depthSorted[0]).toBe(mask);
    }
  });

  it("keeps mask draws ahead of every re-sort verb's own keys", () => {
    const scene = new Scene();
    const behind = renderable("behind");
    behind.renderLayer = -5;
    scene.add(behind);
    const panel = renderable("panel");
    panel.clip = true;
    panel.add(renderable("child"));
    scene.add(panel);
    const camera = new OrthographicCamera({
      left: -3,
      right: 3,
      bottom: -3,
      top: 3,
    });
    scene.add(camera);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    // Ahead of a *lower* render layer: the mask key outranks §66 key 1.
    expect(list[0].clip?.maskPass).toBe(true);

    groupRenderListByPipeline(list);
    expect(list[0].clip?.maskPass).toBe(true);

    const view = createFullscreenViewport(camera);
    const viewList = buildViewRenderList(list, view, []);
    camera.updateViewMatrix();
    sortRenderListByDepth(viewList, camera.viewMatrix);
    expect(viewList[0].clip?.maskPass).toBe(true);
  });
});
