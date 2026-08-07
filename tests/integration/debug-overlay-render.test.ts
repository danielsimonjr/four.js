/**
 * R-35 — the §84/§113 debug overlay, assembled and drawn (2026-08-07).
 *
 * `@four/diagnostics` produces the overlay's geometry as *data* and can never
 * produce it as a `BufferGeometry`: the frozen §3.1 dependency matrix gives the
 * package exactly three edges — `core`, `math`, `scene` — and `geometry` is not
 * one of them. So `debugDrawStreams` emits two plain `Float32Array`s in the
 * shape `BufferGeometry` accepts verbatim, and the assembly happens *here*, in
 * an application that may see both packages. This file is the proof that the
 * shape is right, which is the one thing a unit test inside either package
 * structurally cannot check.
 *
 * Three claims, each of which failed before today:
 *
 * 1. **The arrays are accepted.** `BufferGeometry` validates §85 index
 *    alignment — four colour floats per position vertex — and rejects a slack
 *    tail, so "close enough" is not a thing. `{ ...streams, mode: "lines" }` has
 *    to construct.
 * 2. **The whole overlay is one draw.** A mixed-colour buffer becomes exactly
 *    **one** `"unlit"` render item, whatever its segment count. Until R-19
 *    landed `BufferGeometry.colors` and `UnlitMaterial.vertexColors`, the same
 *    overlay needed one draw per colour (`writePositionsForColor`), which is
 *    what `DEBUG_DRAW_STAGED`'s deleted `per-segment-colored-draw` entry named.
 * 3. **The per-frame path is a version bump.** With the segment count steady,
 *    `applyDebugDrawStreams` neither reallocates nor re-validates — it marks the
 *    geometry dirty, which is what makes a per-frame overlay affordable (§84).
 *
 * The GPU end of the same path is `packages/render-webgl/tests` ("draws a
 * lines-mode geometry with per-vertex colour in ONE call (R-35)"): that file
 * owns the GL call sequence, this one owns the package composition. Neither is
 * edited by the other.
 */

import { BufferGeometry } from "@four/geometry";
import {
  DEBUG_DRAW_DEFAULT_COLORS,
  DEBUG_DRAW_STAGED,
  DebugDrawBuffer,
  applyDebugDrawStreams,
  collectContactImpulses,
  collectContactPoints,
  debugDrawStreams,
  type DebugPhysicsEventLike,
} from "@four/diagnostics";
import { UnlitMaterial } from "@four/materials";
import { Scene } from "@four/scene";
import {
  Renderable,
  buildRenderList,
  isUnlitItem,
  type RenderItem,
} from "@four/render";
import { describe, expect, it } from "vitest";

/**
 * One §29-shaped collision event with a two-point manifold — the ordinary
 * overlay input. Declared structurally, exactly as the providers take it, so
 * this file needs no solver.
 */
const COLLISION: DebugPhysicsEventLike = {
  type: "collisionstart",
  contacts: [
    {
      pointOnA: { x: 1, y: 0.5, z: 0 },
      pointOnB: { x: 1, y: 0.5, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      separation: -0.01,
      impulse: 4,
    },
    {
      pointOnA: { x: -1, y: 0.5, z: 0 },
      pointOnB: { x: -1, y: 0.5, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      separation: -0.02,
      impulse: 6,
    },
  ],
};

/** Fills a buffer with a mixed-colour overlay: contact crosses, normals, impulses. */
function collectOverlay(buffer: DebugDrawBuffer): void {
  buffer.clear();
  collectContactPoints([COLLISION], buffer);
  collectContactImpulses([COLLISION], buffer, { scale: 0.05 });
}

describe("R-35 — the debug overlay assembles into a drawable geometry", () => {
  it("hands BufferGeometry the streams verbatim", () => {
    const buffer = new DebugDrawBuffer();
    collectOverlay(buffer);
    // Two contacts: three cross segments + one normal each, plus one impulse
    // segment each = 10 segments, 20 vertices.
    expect(buffer.lineCount).toBe(10);

    const streams = debugDrawStreams(buffer);
    // The spread is the whole bridge: the two field names are `positions` and
    // `colors` precisely so that this line works with no adapter in between.
    const geometry = new BufferGeometry({ ...streams, mode: "lines" });

    expect(geometry.mode).toBe("lines");
    expect(geometry.vertexCount).toBe(20);
    expect(geometry.vertexCount).toBe(streams.vertexCount);
    expect(geometry.drawCount).toBe(20);
    // Held by reference, not copied — the overlay writes into these arrays.
    expect(geometry.positions).toBe(streams.positions);
    expect(geometry.colors).toBe(streams.colors);

    // The colours really are per segment, not one flat value: the cross is
    // red, its normal green, the impulse magenta
    // (`DEBUG_DRAW_DEFAULT_COLORS`) — all three in the one attribute. Segment
    // `n` starts at colour float `8n`; the providers append cross (3), normal
    // (1) per contact, then one impulse segment per contact.
    const colors = geometry.colors ?? new Float32Array(0);
    expect(Array.from(colors.subarray(0, 4))).toEqual([
      ...DEBUG_DRAW_DEFAULT_COLORS.contact,
    ]);
    expect(Array.from(colors.subarray(24, 28))).toEqual([
      ...DEBUG_DRAW_DEFAULT_COLORS.contactNormal,
    ]);
    expect(Array.from(colors.subarray(64, 68))).toEqual([
      ...DEBUG_DRAW_DEFAULT_COLORS.contactImpulse,
    ]);

    geometry.dispose();
  });

  it("rejects a mis-sized stream, which is why the streams are exact", () => {
    // Not a hypothetical: the reason `debugDrawStreams` refuses to keep a
    // grown-and-never-shrunk backing array is that §85 index alignment makes a
    // slack tail illegal rather than merely wasteful.
    const buffer = new DebugDrawBuffer();
    collectOverlay(buffer);
    const streams = debugDrawStreams(buffer);

    expect(
      () =>
        new BufferGeometry({
          positions: streams.positions,
          colors: new Float32Array(streams.colors.length + 4),
          mode: "lines",
        }),
    ).toThrow(RangeError);
  });

  it("becomes exactly one unlit draw, whatever the colour mix", () => {
    const buffer = new DebugDrawBuffer();
    collectOverlay(buffer);
    const streams = debugDrawStreams(buffer);
    const geometry = new BufferGeometry({ ...streams, mode: "lines" });
    const material = new UnlitMaterial({ vertexColors: true });
    const scene = new Scene();
    scene.add(new Renderable(geometry, material));

    const list: RenderItem[] = [];
    buildRenderList(scene, list);

    expect(list).toHaveLength(1);
    const item = list[0];
    expect(isUnlitItem(item)).toBe(true);
    expect(item.kind).toBe("unlit");
    expect(item.geometry.mode).toBe("lines");
    expect(item.geometry.drawCount).toBe(20);
    expect(isUnlitItem(item) && item.material.vertexColors).toBe(true);
    // Three distinct colours in one item — this is the property the staged
    // entry said was unreachable.
    expect(new Set(colorKeys(item.geometry)).size).toBe(3);

    geometry.dispose();
  });

  it("costs one version bump per frame while the segment count holds (§84)", () => {
    const buffer = new DebugDrawBuffer();
    collectOverlay(buffer);
    const streams = debugDrawStreams(buffer);
    const geometry = new BufferGeometry({ ...streams, mode: "lines" });
    const positions = geometry.positions;
    const colors = geometry.colors;
    const version = geometry.version;

    for (let frame = 0; frame < 5; frame += 1) {
      collectOverlay(buffer);
      debugDrawStreams(buffer, streams);
      applyDebugDrawStreams(streams, geometry);
    }

    expect(geometry.version).toBe(version + 5);
    // Same arrays throughout: no reallocation, no §85 re-validation, and every
    // backend's buffer is invalidated purely by the version.
    expect(geometry.positions).toBe(positions);
    expect(geometry.colors).toBe(colors);
    expect(streams.resized).toBe(false);

    geometry.dispose();
  });

  it("re-points the geometry when the overlay grows or shrinks", () => {
    const buffer = new DebugDrawBuffer();
    collectOverlay(buffer);
    const streams = debugDrawStreams(buffer);
    const geometry = new BufferGeometry({ ...streams, mode: "lines" });

    // A quiet frame: the contacts are gone, so the overlay empties. This is the
    // shrink that the naive assignment order cannot survive — `positions` is
    // validated against the colours still attached.
    buffer.clear();
    debugDrawStreams(buffer, streams);
    expect(streams.resized).toBe(true);
    applyDebugDrawStreams(streams, geometry);
    expect(geometry.vertexCount).toBe(0);
    expect(geometry.drawCount).toBe(0);
    expect(geometry.colors?.length).toBe(0);

    // …and a louder one than before.
    buffer.clear();
    collectContactPoints([COLLISION, COLLISION], buffer, {
      includePointOnB: true,
    });
    debugDrawStreams(buffer, streams);
    applyDebugDrawStreams(streams, geometry);
    expect(geometry.vertexCount).toBe(streams.vertexCount);
    expect(geometry.colors?.length).toBe(geometry.vertexCount * 4);

    geometry.dispose();
  });

  it("no longer stages the per-segment-coloured draw", () => {
    // The record `DEBUG_DRAW_STAGED` keeps is the closure evidence: the entry
    // named this exact composition as unreachable, and it is gone because the
    // tests above pass, not because someone edited prose.
    expect(DEBUG_DRAW_STAGED.map((entry) => entry.id)).not.toContain(
      "per-segment-colored-draw",
    );
  });
});

/** One string per vertex colour, for counting distinct colours in a draw. */
function colorKeys(geometry: BufferGeometry): string[] {
  const colors = geometry.colors ?? new Float32Array(0);
  const keys: string[] = [];
  for (let at = 0; at < colors.length; at += 4) {
    keys.push(
      `${String(colors[at])},${String(colors[at + 1])},` +
        `${String(colors[at + 2])},${String(colors[at + 3])}`,
    );
  }
  return keys;
}
