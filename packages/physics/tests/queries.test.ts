import { Vector2, Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import type {
  OverlapQuery,
  PointQuery,
  QueryCandidate,
  RaycastQuery,
  ShapeCastQuery,
} from "../src/queries.js";
import {
  ALL_COLLISION_GROUPS,
  passesQueryFilter,
  resolveQueryOptions,
  sortHitsByDistance,
} from "../src/queries.js";
import type { PhysicsBodyHandle, PhysicsColliderHandle } from "../src/types.js";

function makeBodyHandle(id: string): PhysicsBodyHandle {
  return { id } as unknown as PhysicsBodyHandle;
}

function makeColliderHandle(id: string): PhysicsColliderHandle {
  return { id } as unknown as PhysicsColliderHandle;
}

const body = makeBodyHandle("body");
const collider = makeColliderHandle("collider");

function makeCandidate(
  overrides: Partial<QueryCandidate> = {},
): QueryCandidate {
  return {
    collider,
    body,
    collisionGroups: ALL_COLLISION_GROUPS,
    collisionMask: ALL_COLLISION_GROUPS,
    sensor: false,
    ...overrides,
  };
}

describe("resolveQueryOptions (§30)", () => {
  it("fills in every documented default", () => {
    expect(resolveQueryOptions()).toEqual({
      collisionGroups: ALL_COLLISION_GROUPS,
      collisionMask: ALL_COLLISION_GROUPS,
      ignoredBodies: [],
      ignoredColliders: [],
      includeSensors: false,
      predicate: undefined,
      mode: "all",
      sorted: false,
      maxHits: Number.POSITIVE_INFINITY,
    });
  });

  it("keeps every value the caller supplies", () => {
    const predicate = (): boolean => true;
    const resolved = resolveQueryOptions({
      collisionGroups: 0b0010,
      collisionMask: 0b0100,
      ignoredBodies: [body],
      ignoredColliders: [collider],
      includeSensors: true,
      predicate,
      mode: "all",
      sorted: true,
      maxHits: 7,
    });
    expect(resolved).toEqual({
      collisionGroups: 0b0010,
      collisionMask: 0b0100,
      ignoredBodies: [body],
      ignoredColliders: [collider],
      includeSensors: true,
      predicate,
      mode: "all",
      sorted: true,
      maxHits: 7,
    });
  });

  it('forces maxHits to 1 for mode "first"', () => {
    expect(resolveQueryOptions({ mode: "first" }).maxHits).toBe(1);
    expect(resolveQueryOptions({ mode: "first", maxHits: 10 }).maxHits).toBe(1);
  });
});

describe("passesQueryFilter (§30)", () => {
  const defaults = resolveQueryOptions();

  it("accepts an ordinary candidate under default options", () => {
    expect(passesQueryFilter(makeCandidate(), defaults)).toBe(true);
  });

  it("excludes sensors unless they are asked for", () => {
    const sensor = makeCandidate({ sensor: true });
    expect(passesQueryFilter(sensor, defaults)).toBe(false);
    expect(
      passesQueryFilter(sensor, resolveQueryOptions({ includeSensors: true })),
    ).toBe(true);
  });

  it("skips ignored bodies", () => {
    expect(
      passesQueryFilter(
        makeCandidate(),
        resolveQueryOptions({ ignoredBodies: [body] }),
      ),
    ).toBe(false);
    expect(
      passesQueryFilter(
        makeCandidate(),
        resolveQueryOptions({ ignoredBodies: [makeBodyHandle("other")] }),
      ),
    ).toBe(true);
  });

  it("skips ignored colliders", () => {
    expect(
      passesQueryFilter(
        makeCandidate(),
        resolveQueryOptions({ ignoredColliders: [collider] }),
      ),
    ).toBe(false);
    expect(
      passesQueryFilter(
        makeCandidate(),
        resolveQueryOptions({
          ignoredColliders: [makeColliderHandle("other")],
        }),
      ),
    ).toBe(true);
  });

  it("requires the group/mask test to pass in both directions", () => {
    const candidate = makeCandidate({
      collisionGroups: 0b0010,
      collisionMask: 0b0001,
    });

    // Query groups are not in the candidate's mask.
    expect(
      passesQueryFilter(
        candidate,
        resolveQueryOptions({ collisionGroups: 0b0100, collisionMask: 0b0010 }),
      ),
    ).toBe(false);

    // Candidate groups are not in the query's mask.
    expect(
      passesQueryFilter(
        candidate,
        resolveQueryOptions({ collisionGroups: 0b0001, collisionMask: 0b0100 }),
      ),
    ).toBe(false);

    // Both directions agree.
    expect(
      passesQueryFilter(
        candidate,
        resolveQueryOptions({ collisionGroups: 0b0001, collisionMask: 0b0010 }),
      ),
    ).toBe(true);
  });

  it("gives the custom predicate the last word (§30)", () => {
    const seen: QueryCandidate[] = [];
    const reject = resolveQueryOptions({
      predicate: (candidate) => {
        seen.push(candidate);
        return false;
      },
    });
    expect(passesQueryFilter(makeCandidate(), reject)).toBe(false);
    expect(seen).toHaveLength(1);

    const accept = resolveQueryOptions({ predicate: () => true });
    expect(passesQueryFilter(makeCandidate(), accept)).toBe(true);
  });

  it("never calls the predicate for a candidate a cheaper test already rejected", () => {
    let calls = 0;
    const filter = resolveQueryOptions({
      ignoredBodies: [body],
      predicate: () => {
        calls += 1;
        return true;
      },
    });
    expect(passesQueryFilter(makeCandidate(), filter)).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("sortHitsByDistance (§30, §33)", () => {
  it("sorts ascending in place and returns the same array", () => {
    const hits = [{ distance: 3 }, { distance: 1 }, { distance: 2 }];
    const sorted = sortHitsByDistance(hits);
    expect(sorted).toBe(hits);
    expect(hits.map((hit) => hit.distance)).toEqual([1, 2, 3]);
  });

  it("is stable, so equal distances keep the adapter's order", () => {
    const first = { distance: 1, id: "a" };
    const second = { distance: 1, id: "b" };
    expect(sortHitsByDistance([first, second])).toEqual([first, second]);
    expect(sortHitsByDistance([second, first])).toEqual([second, first]);
  });
});

describe("query records (§30, §21)", () => {
  it("accepts 2D convenience inputs on every query", () => {
    const ray: RaycastQuery = {
      origin: new Vector2(0, 0),
      direction: new Vector2(1, 0),
      maxDistance: 10,
    };
    const sweep: ShapeCastQuery = {
      shape: { type: "circle", radius: 1 },
      position: new Vector2(0, 0),
      rotation: Math.PI / 4,
      direction: new Vector2(0, -1),
    };
    // §21: overlapSphere is a circle overlap in a "2d" world, overlapBox a
    // rectangle overlap — one API, two dimensions.
    const overlap: OverlapQuery = {
      shape: { type: "rectangle", halfExtents: new Vector2(1, 1) },
      position: new Vector2(2, 2),
    };
    const point: PointQuery = { point: new Vector3(1, 2, 0) };

    expect([
      ray.maxDistance,
      sweep.shape.type,
      overlap.shape.type,
      point.point.x,
    ]).toEqual([10, "circle", "rectangle", 1]);
  });
});
