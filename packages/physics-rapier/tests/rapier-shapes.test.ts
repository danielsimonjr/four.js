/**
 * The §24 shapes PH-22a added, against the **real** Rapier wasm in both
 * dimensions (2026-08-08).
 *
 * `conversions2d.test.ts` / `conversions3d.test.ts` prove the shapes *build*.
 * This file proves they **solve**, which is the bar `shapes.ts` sets for a
 * shape to leave the staged list: every case below drops or launches a body
 * and reads a resting pose back out of the solver. A shape that built but did
 * not collide would pass the conversion suites and fail here.
 *
 * ## Why the resting heights are what they are
 *
 * Rapier lets contacts penetrate by a small allowed margin, so a body at rest
 * settles a little *below* the exact analytic height. Every assertion below is
 * therefore a two-sided band around the analytic value rather than an equality,
 * with the same tolerance the adapter suites use for resting contacts.
 */

import { Quaternion, Vector2, Vector3 } from "@four/math";
import type {
  CollisionShape,
  PhysicsBodyHandle,
  Vector3Input,
} from "@four/physics";
import { beforeAll, describe, expect, it } from "vitest";

import { initializeRapier2d, initializeRapier3d } from "../src/init.js";
import { Rapier2dAdapter } from "../src/rapier2d-adapter.js";
import { Rapier3dAdapter } from "../src/rapier3d-adapter.js";

/** One fixed step (§10), in seconds (§7a). */
const DT = 1 / 60;

/** Steps enough times for a body dropped from ~1 m to settle. */
const SETTLE_STEPS = 240;

/**
 * How far below its analytic resting height a settled body is allowed to sit.
 * Rapier's allowed contact penetration, measured across the cases below.
 */
const PENETRATION = 0.06;

beforeAll(async () => {
  await Promise.all([initializeRapier2d(), initializeRapier3d()]);
});

function step3d(adapter: Rapier3dAdapter, count: number): void {
  for (let i = 0; i < count; i += 1) {
    adapter.syncSceneToSolver();
    adapter.step(DT);
    adapter.syncSolverToScene();
    adapter.drainEvents();
  }
}

function step2d(adapter: Rapier2dAdapter, count: number): void {
  for (let i = 0; i < count; i += 1) {
    adapter.syncSceneToSolver();
    adapter.step(DT);
    adapter.syncSolverToScene();
    adapter.drainEvents();
  }
}

function heightOf3d(
  adapter: Rapier3dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const position = new Vector3();
  adapter.getBodyTransform(body, position, new Quaternion());
  return position;
}

function heightOf2d(
  adapter: Rapier2dAdapter,
  body: PhysicsBodyHandle,
): Vector3 {
  const position = new Vector3();
  adapter.getBodyTransform(body, position, new Quaternion());
  return position;
}

/** Asserts a settled body is at `expected`, allowing Rapier's penetration. */
function expectResting(actual: number, expected: number): void {
  expect(actual).toBeLessThanOrEqual(expected + PENETRATION);
  expect(actual).toBeGreaterThanOrEqual(expected - PENETRATION);
}

// ---------------------------------------------------------------------------
// 3D — cylinder, cone, convex hull, triangle mesh, height field
// ---------------------------------------------------------------------------

describe("§24 3D shapes solve (PH-22a)", () => {
  /** A static box whose top surface is the plane `y = 0`. */
  function addFloor(adapter: Rapier3dAdapter): void {
    const body = adapter.createBody({
      type: "static",
      position: new Vector3(0, -0.5, 0),
    });
    adapter.createCollider({
      body,
      shape: { type: "box", halfExtents: new Vector3(20, 0.5, 20) },
    });
  }

  /** Drops `shape` from `y = 3` onto a floor and returns where it settles. */
  async function restingHeight(shape: CollisionShape): Promise<number> {
    const adapter = new Rapier3dAdapter();
    await adapter.initialize({ dimension: "3d" });
    try {
      addFloor(adapter);
      const body = adapter.createBody({
        type: "dynamic",
        position: new Vector3(0, 3, 0),
      });
      adapter.createCollider({ body, shape });
      step3d(adapter, SETTLE_STEPS);
      return heightOf3d(adapter, body).y;
    } finally {
      adapter.dispose();
    }
  }

  it("rests a cylinder on its flat cap, at halfHeight", async () => {
    expectResting(
      await restingHeight({ type: "cylinder", radius: 0.5, halfHeight: 0.75 }),
      0.75,
    );
  });

  it("rests a cone on its base, at halfHeight (apex up)", async () => {
    // The apex is at +halfHeight, so a cone that fell onto its base has its
    // centre one half-height above the floor — the same number a cylinder
    // gives, which is exactly what makes the *orientation* worth pinning.
    expectResting(
      await restingHeight({ type: "cone", radius: 0.5, halfHeight: 0.75 }),
      0.75,
    );
  });

  it("rests a convex hull at the half-extent of its point cloud", async () => {
    // A unit cube's eight corners: the hull is a 1 m box, so it rests at 0.5.
    const points: Vector3[] = [];
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) {
          points.push(new Vector3(x, y, z));
        }
      }
    }
    expectResting(await restingHeight({ type: "convex-hull", points }), 0.5);
  });

  it("collides against a static triangle mesh", async () => {
    const adapter = new Rapier3dAdapter();
    await adapter.initialize({ dimension: "3d" });
    try {
      // Two triangles making a 20×20 quad in the plane y = 0.
      const ground = adapter.createBody({ type: "static" });
      adapter.createCollider({
        body: ground,
        shape: {
          type: "triangle-mesh",
          vertices: [
            new Vector3(-10, 0, -10),
            new Vector3(10, 0, -10),
            new Vector3(10, 0, 10),
            new Vector3(-10, 0, 10),
          ],
          indices: [0, 1, 2, 0, 2, 3],
        },
      });
      const ball = adapter.createBody({
        type: "dynamic",
        position: new Vector3(0, 3, 0),
      });
      adapter.createCollider({
        body: ball,
        shape: { type: "sphere", radius: 0.5 },
      });
      step3d(adapter, SETTLE_STEPS);
      expectResting(heightOf3d(adapter, ball).y, 0.5);
    } finally {
      adapter.dispose();
    }
  });

  it("collides against a height field, and reads its column-major layout", async () => {
    // A 2×2-sample field with heights [0, 1, 2, 3] and scale (4, 1, 4). The
    // module header's measured table says `heights[row + column * rows]` sits
    // at (x from `column`, z from `row`), so the corner heights are:
    //
    //   (x = -2, z = -2) -> 0     (x = +2, z = -2) -> 2
    //   (x = -2, z = +2) -> 1     (x = +2, z = +2) -> 3
    //
    // The surface is a ramp, so a dropped ball would slide; the height is read
    // with a §30 downward raycast at each corner instead, which is also how the
    // layout was measured in the first place.
    const adapter = new Rapier3dAdapter();
    await adapter.initialize({ dimension: "3d" });
    try {
      const ground = adapter.createBody({ type: "static" });
      adapter.createCollider({
        body: ground,
        shape: {
          type: "height-field",
          rows: 2,
          columns: 2,
          heights: [0, 1, 2, 3],
          scale: new Vector3(4, 1, 4),
        },
      });
      // A static-only world still needs one step before the query pipeline
      // sees the collider.
      step3d(adapter, 1);

      const surfaceAt = (x: number, z: number): number => {
        const hits = adapter.raycast({
          origin: new Vector3(x, 10, z),
          direction: new Vector3(0, -1, 0),
          maxDistance: 100,
          mode: "first",
        });
        expect(hits).toHaveLength(1);
        return hits[0].point.y;
      };

      expect(surfaceAt(-1.98, -1.98)).toBeCloseTo(0, 1);
      expect(surfaceAt(-1.98, 1.98)).toBeCloseTo(1, 1);
      expect(surfaceAt(1.98, -1.98)).toBeCloseTo(2, 1);
      expect(surfaceAt(1.98, 1.98)).toBeCloseTo(3, 1);
    } finally {
      adapter.dispose();
    }
  });

  it("refuses a composite shape as a §30 query shape", async () => {
    const adapter = new Rapier3dAdapter();
    await adapter.initialize({ dimension: "3d" });
    try {
      const position: Vector3Input = new Vector3();
      const mesh: CollisionShape = {
        type: "triangle-mesh",
        vertices: [
          new Vector3(0, 0, 0),
          new Vector3(1, 0, 0),
          new Vector3(0, 0, 1),
        ],
        indices: [0, 1, 2],
      };
      expect(() => adapter.overlap({ shape: mesh, position })).toThrowError(
        /boundary but no interior/u,
      );
      expect(() =>
        adapter.shapeCast({
          shape: mesh,
          position,
          direction: new Vector3(1, 0, 0),
          maxDistance: 1,
        }),
      ).toThrowError(/boundary but no interior/u);
      // A convex newcomer is accepted by the same entry points.
      expect(() =>
        adapter.overlap({
          shape: { type: "cylinder", radius: 0.5, halfHeight: 0.5 },
          position,
        }),
      ).not.toThrow();
    } finally {
      adapter.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// 2D — polyline and chain
// ---------------------------------------------------------------------------

describe("§24 2D shapes solve (PH-22a)", () => {
  it("rests a circle on an open polyline", async () => {
    const adapter = new Rapier2dAdapter();
    await adapter.initialize({ dimension: "2d" });
    try {
      const ground = adapter.createBody({ type: "static" });
      adapter.createCollider({
        body: ground,
        shape: {
          type: "polyline",
          vertices: [new Vector2(-10, 0), new Vector2(10, 0)],
        },
      });
      const ball = adapter.createBody({
        type: "dynamic",
        position: new Vector2(0, 3),
      });
      adapter.createCollider({
        body: ball,
        shape: { type: "circle", radius: 0.5 },
      });
      step2d(adapter, SETTLE_STEPS);
      expectResting(heightOf2d(adapter, ball).y, 0.5);
    } finally {
      adapter.dispose();
    }
  });

  it("keeps a circle inside a closed chain that no polygon could express", async () => {
    const adapter = new Rapier2dAdapter();
    await adapter.initialize({ dimension: "2d" });
    try {
      // A concave "bowl with a lip": a chain closes it, and `PolygonShape`
      // would refuse the outline outright.
      const ground = adapter.createBody({ type: "static" });
      adapter.createCollider({
        body: ground,
        shape: {
          type: "chain",
          vertices: [
            new Vector2(-4, 6),
            new Vector2(-4, 0),
            new Vector2(0, -2),
            new Vector2(4, 0),
            new Vector2(4, 6),
            new Vector2(2, 6),
            new Vector2(2, 1),
            new Vector2(-2, 1),
            new Vector2(-2, 6),
          ],
        },
      });
      const ball = adapter.createBody({
        type: "dynamic",
        position: new Vector2(0, 4),
      });
      adapter.createCollider({
        body: ball,
        shape: { type: "circle", radius: 0.4 },
      });
      step2d(adapter, SETTLE_STEPS);
      const resting = heightOf2d(adapter, ball);
      // It fell into the pocket between the two inner walls and stayed there:
      // above the floor of the pocket, below where it started, inside the
      // walls. Without the closing segment the loop would leak at the top.
      expect(resting.y).toBeGreaterThan(0.9);
      expect(resting.y).toBeLessThan(2);
      expect(Math.abs(resting.x)).toBeLessThan(2);
    } finally {
      adapter.dispose();
    }
  });

  it("refuses a composite shape as a §30 query shape", async () => {
    const adapter = new Rapier2dAdapter();
    await adapter.initialize({ dimension: "2d" });
    try {
      const position: Vector3Input = new Vector2();
      const run: CollisionShape = {
        type: "chain",
        vertices: [new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1)],
      };
      expect(() => adapter.overlap({ shape: run, position })).toThrowError(
        /boundary but no interior/u,
      );
      expect(() =>
        adapter.shapeCast({
          shape: run,
          position,
          direction: new Vector2(1, 0),
          maxDistance: 1,
        }),
      ).toThrowError(/boundary but no interior/u);
    } finally {
      adapter.dispose();
    }
  });
});
