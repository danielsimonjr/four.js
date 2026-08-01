import { isFourError } from "@four/core";
import { Quaternion, Vector2, Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import type { PhysicsSolverAdapter } from "../src/adapter.js";
import type {
  ColliderDescriptor,
  JointDescriptor,
  PhysicsWorldOptions,
  RigidBodyDescriptor,
} from "../src/descriptors.js";
import {
  DEFAULT_GRAVITY_Y,
  JOINT_TYPES,
  resolveAngularVelocity,
  resolveGravity,
  resolveRotation,
  resolveSleepingConfig,
  widenToVector3,
} from "../src/descriptors.js";
import type {
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsJointHandle,
} from "../src/types.js";
import { DEFAULT_SLEEPING_CONFIG } from "../src/types.js";

/** Mints a distinct opaque handle the way an adapter does (§37). */
function makeBodyHandle(id: string): PhysicsBodyHandle {
  return { id } as unknown as PhysicsBodyHandle;
}

function expectFourError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as Error & { code: string };
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

describe("opaque handles (§37)", () => {
  it("cannot be forged from an object literal, and do not interconvert", () => {
    // The brand is a module-private `unique symbol`, so nothing outside
    // `types.ts` can produce a value of these types except by casting.

    // @ts-expect-error - a plain object has no brand, so it is not a handle.
    const forged: PhysicsBodyHandle = { id: 1 };
    const body = makeBodyHandle("a");
    // @ts-expect-error - a body handle is not a collider handle.
    const asCollider: PhysicsColliderHandle = body;
    // @ts-expect-error - a body handle is not a joint handle.
    const asJoint: PhysicsJointHandle = body;

    expect([forged, asCollider, asJoint]).toHaveLength(3);
  });
});

describe("widenToVector3 (§21, plan P5-3)", () => {
  it("widens a Vector2 with z = 0", () => {
    expect(widenToVector3(new Vector2(3, 4))).toEqual(new Vector3(3, 4, 0));
  });

  it("passes a Vector3 through", () => {
    expect(widenToVector3(new Vector3(1, 2, 3))).toEqual(new Vector3(1, 2, 3));
  });

  it("writes into `out` and returns it (§7b/D7)", () => {
    const out = new Vector3(9, 9, 9);
    expect(widenToVector3(new Vector2(1, 2), out)).toBe(out);
    expect(out).toEqual(new Vector3(1, 2, 0));
  });
});

describe("resolveGravity (§21, Appendix A)", () => {
  it("defaults to Appendix A's -9.81 Y in both dimensions", () => {
    expect(resolveGravity("2d")).toEqual(new Vector3(0, DEFAULT_GRAVITY_Y, 0));
    expect(resolveGravity("3d")).toEqual(new Vector3(0, DEFAULT_GRAVITY_Y, 0));
  });

  it("widens a Vector2 gravity", () => {
    expect(resolveGravity("2d", new Vector2(0, -3))).toEqual(
      new Vector3(0, -3, 0),
    );
  });

  it("accepts a 3D gravity in a 3d world", () => {
    expect(resolveGravity("3d", new Vector3(1, -9.81, 2))).toEqual(
      new Vector3(1, -9.81, 2),
    );
  });

  it("accepts a Vector3 with z = 0 in a 2d world", () => {
    expect(resolveGravity("2d", new Vector3(0, -1, 0))).toEqual(
      new Vector3(0, -1, 0),
    );
  });

  it("rejects a z gravity in a 2d world (§85)", () => {
    expect(
      expectFourError(() => {
        resolveGravity("2d", new Vector3(0, 0, -9.81));
      }).message,
    ).toContain("gravity.z must be 0");
  });

  it("writes into `out` on both the default and the given path", () => {
    const out = new Vector3();
    expect(resolveGravity("3d", undefined, out)).toBe(out);
    expect(out.y).toBe(DEFAULT_GRAVITY_Y);
    expect(resolveGravity("3d", new Vector2(1, 2), out)).toBe(out);
    expect(out).toEqual(new Vector3(1, 2, 0));
  });
});

describe("resolveRotation (§21, §7a)", () => {
  it("turns radians about +Z into the equivalent quaternion", () => {
    const q = resolveRotation("2d", Math.PI / 2);
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(q.w).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it("maps a zero angle to the identity", () => {
    expect(resolveRotation("3d", 0)).toEqual(new Quaternion(0, 0, 0, 1));
  });

  it("rejects a non-finite angle (§85)", () => {
    expectFourError(() => {
      resolveRotation("2d", Number.NaN);
    });
  });

  it("copies a quaternion through in a 3d world", () => {
    const source = new Quaternion(0.5, 0.5, 0.5, 0.5);
    const resolved = resolveRotation("3d", source);
    expect(resolved).toEqual(source);
    expect(resolved).not.toBe(source);
  });

  it("accepts a pure Z quaternion in a 2d world", () => {
    const source = new Quaternion(0, 0, 1, 0);
    expect(resolveRotation("2d", source)).toEqual(source);
  });

  it.each([
    ["x", new Quaternion(0.5, 0, 0, 0.5)],
    ["y", new Quaternion(0, 0.5, 0, 0.5)],
  ])("rejects an out-of-plane %s rotation in a 2d world", (_axis, q) => {
    expect(
      expectFourError(() => {
        resolveRotation("2d", q);
      }).message,
    ).toContain("about +Z only");
  });

  it("writes into `out` on both paths (§7b/D7)", () => {
    const out = new Quaternion();
    expect(resolveRotation("2d", 0, out)).toBe(out);
    expect(resolveRotation("3d", new Quaternion(0, 0, 0, 1), out)).toBe(out);
  });
});

describe("resolveAngularVelocity (§21, §23)", () => {
  it("widens a scalar rate to (0, 0, w)", () => {
    expect(resolveAngularVelocity("2d", 2.5)).toEqual(new Vector3(0, 0, 2.5));
  });

  it("rejects a non-finite scalar rate (§85)", () => {
    expectFourError(() => {
      resolveAngularVelocity("2d", Number.POSITIVE_INFINITY);
    });
  });

  it("passes a Vector3 through in a 3d world", () => {
    expect(resolveAngularVelocity("3d", new Vector3(1, 2, 3))).toEqual(
      new Vector3(1, 2, 3),
    );
  });

  it("accepts a Z-only Vector3 in a 2d world", () => {
    expect(resolveAngularVelocity("2d", new Vector3(0, 0, 4))).toEqual(
      new Vector3(0, 0, 4),
    );
  });

  it.each([
    ["x", new Vector3(1, 0, 0)],
    ["y", new Vector3(0, 1, 0)],
  ])("rejects an out-of-plane %s spin in a 2d world", (_axis, v) => {
    expect(
      expectFourError(() => {
        resolveAngularVelocity("2d", v);
      }).message,
    ).toContain("about +Z only");
  });

  it("writes into `out` on both paths (§7b/D7)", () => {
    const out = new Vector3();
    expect(resolveAngularVelocity("3d", 1, out)).toBe(out);
    expect(resolveAngularVelocity("3d", new Vector3(1, 2, 3), out)).toBe(out);
  });
});

describe("resolveSleepingConfig (§32, Appendix A)", () => {
  it("returns Appendix A's defaults when nothing is given", () => {
    expect(resolveSleepingConfig()).toBe(DEFAULT_SLEEPING_CONFIG);
    expect(DEFAULT_SLEEPING_CONFIG).toEqual({
      enabled: true,
      linearThreshold: 0.01,
      angularThreshold: 0.01,
      timeThreshold: 0.5,
    });
  });

  it("merges a partial record over the defaults", () => {
    expect(resolveSleepingConfig({ timeThreshold: 2 })).toEqual({
      enabled: true,
      linearThreshold: 0.01,
      angularThreshold: 0.01,
      timeThreshold: 2,
    });
    expect(resolveSleepingConfig({ enabled: false })).toEqual({
      ...DEFAULT_SLEEPING_CONFIG,
      enabled: false,
    });
  });

  it("takes every field when a full record is given, and freezes the result", () => {
    const resolved = resolveSleepingConfig({
      enabled: false,
      linearThreshold: 1,
      angularThreshold: 2,
      timeThreshold: 3,
    });
    expect(resolved).toEqual({
      enabled: false,
      linearThreshold: 1,
      angularThreshold: 2,
      timeThreshold: 3,
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });
});

describe("descriptor shapes (§37)", () => {
  it("names §28's joint types", () => {
    expect(JOINT_TYPES).toEqual([
      "fixed",
      "distance",
      "spring",
      "revolute",
      "prismatic",
      "spherical",
      "rope",
      "gear",
      "motorized",
    ]);
  });

  it("accepts the minimal descriptors an adapter is driven with", () => {
    const world: PhysicsWorldOptions = { dimension: "2d" };
    const body: RigidBodyDescriptor = { type: "dynamic" };
    const collider: ColliderDescriptor = {
      body: makeBodyHandle("a"),
      shape: { type: "circle", radius: 1 },
    };
    const joint: JointDescriptor = {
      type: "revolute",
      bodyA: makeBodyHandle("a"),
      bodyB: makeBodyHandle("b"),
    };
    expect([
      world.dimension,
      body.type,
      collider.shape.type,
      joint.type,
    ]).toEqual(["2d", "dynamic", "circle", "revolute"]);
  });

  it("types the §37 adapter contract against these descriptors", () => {
    // A compile-time conformance check only: the structural test double that
    // exercises the contract at runtime is `FakeSolverAdapter` (WP-5.3).
    type CreateBody = PhysicsSolverAdapter["createBody"];
    type Initialize = PhysicsSolverAdapter["initialize"];
    const createBody: CreateBody = (desc) => makeBodyHandle(desc.type);
    const initialize: Initialize = (options) => {
      expect(options.dimension).toBe("3d");
    };
    // §37 allows `initialize` to be synchronous or to return a promise; this
    // one is synchronous.
    const initialized = initialize({ dimension: "3d" });
    expect(initialized).toBeUndefined();
    expect(createBody({ type: "static" })).toBeDefined();
  });
});
