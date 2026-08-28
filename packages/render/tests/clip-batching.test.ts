/**
 * §67 clipping × §65 batching (R-23, 2026-08-28).
 *
 * The claim `batch.ts` makes: the same material under two different clips is
 * two different draws, so a clip boundary ends a run — by **record identity**,
 * which the pooled clip records make a single `!==` — while an unclipped
 * scene's runs are exactly the runs it had before clipping existed. And a mask
 * draw never merges: every clip owns its plane, so no two mask items share a
 * record.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import { Scene, resolveWorldTransforms } from "@four/scene";
import { describe, expect, it } from "vitest";

import { RenderBatcher, Renderable, buildRenderList } from "../src/index.js";

/** `count` renderables over one shared material, appended to `parent`. */
function run(
  parent: { add(node: Renderable): unknown },
  material: UnlitMaterial,
  count: number,
): Renderable[] {
  const nodes: Renderable[] = [];
  for (let index = 0; index < count; index += 1) {
    const node = new Renderable(planeGeometry(), material);
    parent.add(node);
    nodes.push(node);
  }
  return nodes;
}

describe("§67 × §65 — a clip boundary ends a run", () => {
  it("does not merge same-material draws across a clip boundary", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    run(scene, material, 2);
    const panel = new Renderable(planeGeometry(), material);
    panel.clip = true;
    run(panel, material, 2);
    scene.add(panel);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    // Masks sort first, so the content half of the list is: two unclipped
    // draws, the panel's own (unclipped) draw, then two clipped children.
    const batcher = new RenderBatcher();
    const firstContent = list.findIndex((item) => item.clip?.maskPass !== true);
    const batch = batcher.next(list, firstContent);
    // The unclipped run merges — panel included, since the panel itself is
    // not clipped by its own clip — and stops at the first clipped child.
    expect(batch?.items).toBe(3);
    expect(batch?.clip).toBeNull();

    const clipped = batcher.next(list, firstContent + (batch?.items ?? 0));
    expect(clipped?.items).toBe(2);
    // The batch carries the run's shared record, for the backend to apply
    // exactly as it applies a single item's.
    expect(clipped?.clip).toBe(
      list.find((item) => item.clip != null && !item.clip.maskPass)?.clip,
    );
  });

  it("never merges a mask draw into a run", () => {
    const scene = new Scene();
    const material = new UnlitMaterial();
    const left = new Renderable(planeGeometry(), material);
    left.clip = true;
    left.add(new Renderable(planeGeometry(), material));
    const right = new Renderable(planeGeometry(), material);
    right.clip = true;
    right.add(new Renderable(planeGeometry(), material));
    scene.add(left);
    scene.add(right);
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    // Two mask draws lead the list, same material, adjacent — and still no
    // batch: each carries its own plane's write record.
    expect(list[0].clip?.maskPass).toBe(true);
    expect(list[1].clip?.maskPass).toBe(true);
    const batcher = new RenderBatcher();
    expect(batcher.next(list, 0)).toBeNull();
    expect(batcher.next(list, 1)).toBeNull();
  });

  it("merges items whose clip is structurally absent with null-clip items", () => {
    // A hand-built item predating §67 reports `undefined`; the batcher's
    // `?? null` normalization keeps it in the same run as the builders' own
    // unclipped items instead of ending every run at it.
    const scene = new Scene();
    const material = new UnlitMaterial();
    run(scene, material, 2);
    resolveWorldTransforms(scene);
    const list = buildRenderList(scene, []);
    const legacy = list.map((item) => {
      const copy = { ...item };
      delete copy.clip;
      return copy;
    });

    const batcher = new RenderBatcher();
    const batch = batcher.next([legacy[0], list[1]], 0);
    expect(batch?.items).toBe(2);
    expect(batch?.clip).toBeNull();
  });
});
