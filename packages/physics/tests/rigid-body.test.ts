import { ComponentRegistry, isFourError } from "@four/core";
import {
  Matrix3,
  Quaternion,
  Vector2,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { Group } from "@four/scene";
import { describe, expect, it, vi } from "vitest";

import { MotionComponent } from "@four/motion";

import { Collider } from "../src/collider.js";
import type { RigidBodyDescriptor } from "../src/descriptors.js";
import type { RigidBodyCollisionEvent } from "../src/rigid-body.js";
import {
  RigidBody,
  clearRigidBodyCommands,
  setRigidBodySleeping,
} from "../src/rigid-body.js";
import { DEFAULT_ENABLED_CCD_MODE } from "../src/types.js";

/** Runs `run` and asserts it threw the §85 validation error. */
function expectValidationError(run: () => void): Error & { code: string } {
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

/** A dynamic body with an authored mass — the common case in these tests. */
function dynamicBody(overrides: Partial<RigidBodyDescriptor> = {}): RigidBody {
  return new RigidBody({ type: "dynamic", mass: 2, ...overrides });
}

describe("RigidBody construction (§23)", () => {
  it("applies the neutral defaults for every omitted §23 property", () => {
    const body = new RigidBody({ type: "dynamic" });

    expect(body.type).toBe("dynamic");
    expect(body.mass).toBeUndefined();
    expect(body.centerOfMass).toEqual(new Vector3(0, 0, 0));
    expect(body.linearVelocity).toEqual(new Vector3(0, 0, 0));
    expect(body.angularVelocity).toEqual(new Vector3(0, 0, 0));
    expect(body.inertiaTensor).toBeUndefined();
    expect(body.linearDamping).toBe(0);
    expect(body.angularDamping).toBe(0);
    expect(body.gravityScale).toBe(1);
    expect(body.sleeping).toBe(false);
    expect(body.ccdMode).toBe("disabled");
    expect(body.continuousCollisionDetection).toBe(false);
    expect(body.initialPosition).toBeUndefined();
    expect(body.initialRotation).toBeUndefined();
  });

  it("keeps every §23 property it is given", () => {
    const inertia = new Matrix3().fromArray([2, 0, 0, 0, 3, 0, 0, 0, 4]);
    const body = new RigidBody({
      type: "kinematic-velocity",
      mass: 5,
      centerOfMass: new Vector3(0, 1, 2),
      inertiaTensor: inertia,
      linearVelocity: new Vector3(1, 2, 3),
      angularVelocity: new Vector3(0.1, 0.2, 0.3),
      linearDamping: 0.25,
      angularDamping: 0.5,
      gravityScale: 0,
    });

    expect(body.type).toBe("kinematic-velocity");
    expect(body.mass).toBe(5);
    expect(body.centerOfMass).toEqual(new Vector3(0, 1, 2));
    expect(body.inertiaTensor?.elements[4]).toBe(3);
    expect(body.linearVelocity).toEqual(new Vector3(1, 2, 3));
    expect(body.angularVelocity).toEqual(new Vector3(0.1, 0.2, 0.3));
    expect(body.linearDamping).toBe(0.25);
    expect(body.angularDamping).toBe(0.5);
    expect(body.gravityScale).toBe(0);
  });

  it("copies the vectors and the tensor it is given", () => {
    const velocity = new Vector3(1, 0, 0);
    const inertia = new Matrix3();
    const body = new RigidBody({
      type: "dynamic",
      linearVelocity: velocity,
      inertiaTensor: inertia,
    });

    velocity.set(9, 9, 9);
    inertia.fromArray([7, 0, 0, 0, 7, 0, 0, 0, 7]);

    expect(body.linearVelocity).toEqual(new Vector3(1, 0, 0));
    expect(body.inertiaTensor?.elements[0]).toBe(1);
  });

  it("widens the 2D convenience forms (plan P5-3)", () => {
    const body = new RigidBody({
      type: "dynamic",
      position: new Vector2(3, 4),
      rotation: Math.PI / 2,
      centerOfMass: new Vector2(1, 2),
      linearVelocity: new Vector2(5, 6),
      angularVelocity: 1.5,
    });

    expect(body.initialPosition).toEqual(new Vector3(3, 4, 0));
    expect(body.initialRotation?.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(body.initialRotation?.w).toBeCloseTo(Math.SQRT1_2, 12);
    expect(body.centerOfMass).toEqual(new Vector3(1, 2, 0));
    expect(body.linearVelocity).toEqual(new Vector3(5, 6, 0));
    expect(body.angularVelocity).toEqual(new Vector3(0, 0, 1.5));
  });

  it("keeps a quaternion initial rotation as given", () => {
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      0.5,
    );
    const body = new RigidBody({ type: "dynamic", rotation });
    expect(body.initialRotation).toEqual(rotation);
    expect(body.initialRotation).not.toBe(rotation);
  });

  it("rejects a descriptor that fails §23/§85 validation", () => {
    expectValidationError(() => new RigidBody({ type: "dynamic", mass: 0 }));
    expectValidationError(() => new RigidBody({ type: "static", mass: -1 }));
    expectValidationError(
      () => new RigidBody({ type: "dynamic", linearDamping: -0.1 }),
    );
    expectValidationError(
      () => new RigidBody({ type: "dynamic", gravityScale: Number.NaN }),
    );
    expectValidationError(
      () =>
        new RigidBody({
          type: "dynamic",
          inertiaTensor: new Matrix3().fromArray([-1, 0, 0, 0, 1, 0, 0, 0, 1]),
        }),
    );
    expectValidationError(
      () => new RigidBody({ type: "bogus" as RigidBodyDescriptor["type"] }),
    );
  });

  it("rejects §31's contradiction: CCD off but a sweeping mode named", () => {
    const error = expectValidationError(
      () =>
        new RigidBody({
          type: "dynamic",
          continuousCollisionDetection: false,
          ccdMode: "swept",
        }),
    );
    expect(error.message).toContain("continuousCollisionDetection");
  });
});

describe("RigidBody mass rules (§23)", () => {
  it("derives inverseMass from the body type and the mass", () => {
    expect(dynamicBody({ mass: 4 }).inverseMass).toBe(0.25);
    expect(new RigidBody({ type: "static" }).inverseMass).toBe(0);
    expect(new RigidBody({ type: "kinematic-position" }).inverseMass).toBe(0);
    expect(
      new RigidBody({ type: "kinematic-velocity", mass: 3 }).inverseMass,
    ).toBe(0);
  });

  it("reports an underived dynamic mass as NaN, never as 0", () => {
    const body = new RigidBody({ type: "dynamic" });
    expect(body.inverseMass).toBeNaN();
    body.mass = 8;
    expect(body.inverseMass).toBe(0.125);
  });

  it("re-validates the §23 mass rule on assignment", () => {
    const body = dynamicBody();
    expectValidationError(() => {
      body.mass = 0;
    });
    expect(body.mass).toBe(2);

    body.mass = undefined;
    expect(body.mass).toBeUndefined();

    const stationary = new RigidBody({ type: "static", mass: 0 });
    expect(stationary.mass).toBe(0);
  });

  it("re-validates the mass rule when the body type changes", () => {
    const body = new RigidBody({ type: "static", mass: 0 });
    expectValidationError(() => {
      body.type = "dynamic";
    });
    expect(body.type).toBe("static");

    body.mass = 1;
    body.type = "dynamic";
    expect(body.type).toBe("dynamic");
    expect(body.inverseMass).toBe(1);
  });
});

describe("RigidBody continuous collision detection (§23, §31)", () => {
  it("reconciles the §23 switch with the §31 mode at construction", () => {
    expect(new RigidBody({ type: "dynamic" }).ccdMode).toBe("disabled");
    expect(
      new RigidBody({ type: "dynamic", continuousCollisionDetection: true })
        .ccdMode,
    ).toBe(DEFAULT_ENABLED_CCD_MODE);
    expect(
      new RigidBody({ type: "dynamic", ccdMode: "speculative" }).ccdMode,
    ).toBe("speculative");
    expect(
      new RigidBody({
        type: "dynamic",
        continuousCollisionDetection: true,
        ccdMode: "speculative",
      }).ccdMode,
    ).toBe("speculative");
    expect(
      new RigidBody({
        type: "dynamic",
        continuousCollisionDetection: true,
        ccdMode: "disabled",
      }).ccdMode,
    ).toBe(DEFAULT_ENABLED_CCD_MODE);
    expect(
      new RigidBody({
        type: "dynamic",
        continuousCollisionDetection: false,
        ccdMode: "disabled",
      }).ccdMode,
    ).toBe("disabled");
  });

  it("keeps the boolean and the mode in agreement afterwards", () => {
    const body = dynamicBody();

    body.continuousCollisionDetection = true;
    expect(body.ccdMode).toBe(DEFAULT_ENABLED_CCD_MODE);
    expect(body.continuousCollisionDetection).toBe(true);

    body.ccdMode = "speculative";
    expect(body.continuousCollisionDetection).toBe(true);

    // Turning it on again must not overwrite the method already chosen.
    body.continuousCollisionDetection = true;
    expect(body.ccdMode).toBe("speculative");

    body.continuousCollisionDetection = false;
    expect(body.ccdMode).toBe("disabled");
    expect(body.continuousCollisionDetection).toBe(false);
  });
});

describe("RigidBody force and impulse commands (§26)", () => {
  it("accumulates forces, torques, and impulses into their buffers", () => {
    const body = dynamicBody();

    body.applyForce(new Vector3(1, 2, 3));
    body.applyForce(new Vector2(1, 1));
    body.applyTorque(new Vector3(0, 0, 2));
    body.applyTorque(3);
    body.applyImpulse(new Vector3(0, 5, 0));
    body.applyAngularImpulse(1);
    body.applyAngularImpulse(new Vector3(0, 1, 0));

    const { commands } = body;
    expect(commands.force).toEqual(new Vector3(2, 3, 3));
    expect(commands.torque).toEqual(new Vector3(0, 0, 5));
    expect(commands.impulse).toEqual(new Vector3(0, 5, 0));
    expect(commands.angularImpulse).toEqual(new Vector3(0, 1, 1));
  });

  it("records point loads in insertion order, pooling their storage", () => {
    const body = dynamicBody();

    body.applyForceAtPoint(new Vector3(1, 0, 0), new Vector3(0, 1, 0));
    body.applyForceAtPoint(new Vector2(0, 2), new Vector2(3, 0));
    body.applyImpulseAtPoint(new Vector3(0, 0, 4), new Vector3(5, 0, 0));

    const { commands } = body;
    expect(commands.pointForceCount).toBe(2);
    expect(commands.pointForces[0].value).toEqual(new Vector3(1, 0, 0));
    expect(commands.pointForces[0].point).toEqual(new Vector3(0, 1, 0));
    expect(commands.pointForces[1].value).toEqual(new Vector3(0, 2, 0));
    expect(commands.pointForces[1].point).toEqual(new Vector3(3, 0, 0));
    expect(commands.pointImpulseCount).toBe(1);
    expect(commands.pointImpulses[0].value).toEqual(new Vector3(0, 0, 4));
    expect(commands.pointImpulses[0].point).toEqual(new Vector3(5, 0, 0));
  });

  it("clears every buffer but keeps the pooled slots", () => {
    const body = dynamicBody();
    body.applyForce(new Vector3(1, 1, 1));
    body.applyTorque(1);
    body.applyImpulse(new Vector3(1, 1, 1));
    body.applyAngularImpulse(1);
    body.applyForceAtPoint(new Vector3(1, 0, 0), new Vector3());
    body.applyImpulseAtPoint(new Vector3(1, 0, 0), new Vector3());
    body.sleep();

    const { commands } = body;
    const pooledForce = commands.pointForces[0];
    const pooledImpulse = commands.pointImpulses[0];

    clearRigidBodyCommands(body);

    expect(commands.force).toEqual(new Vector3(0, 0, 0));
    expect(commands.torque).toEqual(new Vector3(0, 0, 0));
    expect(commands.impulse).toEqual(new Vector3(0, 0, 0));
    expect(commands.angularImpulse).toEqual(new Vector3(0, 0, 0));
    expect(commands.pointForceCount).toBe(0);
    expect(commands.pointImpulseCount).toBe(0);
    expect(commands.sleepCommand).toBeNull();
    expect(commands.pointForces).toHaveLength(1);
    expect(commands.pointImpulses).toHaveLength(1);

    body.applyForceAtPoint(new Vector3(2, 0, 0), new Vector3());
    body.applyImpulseAtPoint(new Vector3(2, 0, 0), new Vector3());
    expect(commands.pointForces[0]).toBe(pooledForce);
    expect(commands.pointImpulses[0]).toBe(pooledImpulse);
    expect(pooledForce.value).toEqual(new Vector3(2, 0, 0));
  });

  it("allocates nothing once the pools have grown (§7b, plan D7)", () => {
    const body = dynamicBody();
    const force = new Vector3(1, 0, 0);
    const point = new Vector3(0, 1, 0);

    const accumulate = (): void => {
      body.applyForce(force);
      body.applyTorque(1);
      body.applyImpulse(force);
      body.applyAngularImpulse(force);
      body.applyForceAtPoint(force, point);
      body.applyForceAtPoint(force, point);
      body.applyImpulseAtPoint(force, point);
    };

    accumulate();
    clearRigidBodyCommands(body);

    resetConstructionCount();
    for (let step = 0; step < 4; step += 1) {
      accumulate();
      clearRigidBodyCommands(body);
    }
    expect(constructionCount()).toBe(0);
  });
});

describe("RigidBody sleeping (§23, §32)", () => {
  it("queues wake and sleep commands without changing the state", () => {
    const body = dynamicBody();

    body.wake();
    expect(body.commands.sleepCommand).toBe("wake");
    expect(body.sleeping).toBe(false);

    body.sleep();
    expect(body.commands.sleepCommand).toBe("sleep");
    expect(body.sleeping).toBe(false);
  });

  it("publishes solver-reported transitions through the internal setter", () => {
    const body = dynamicBody();

    expect(setRigidBodySleeping(body, false)).toBe(false);
    expect(setRigidBodySleeping(body, true)).toBe(true);
    expect(body.sleeping).toBe(true);
    expect(setRigidBodySleeping(body, true)).toBe(false);
    expect(setRigidBodySleeping(body, false)).toBe(true);
    expect(body.sleeping).toBe(false);
  });
});

describe("RigidBody events (§29, §32, §6b)", () => {
  it("delivers §29 collision payloads to subscribers in registration order", () => {
    const body = dynamicBody();
    const other = dynamicBody();
    const collider = new Collider({ shape: { type: "sphere", radius: 1 } });
    const otherCollider = new Collider({
      shape: { type: "sphere", radius: 1 },
    });
    const event: RigidBodyCollisionEvent = {
      type: "collisionstart",
      bodyA: body,
      bodyB: other,
      colliderA: collider,
      colliderB: otherCollider,
      contacts: [],
      relativeVelocity: new Vector3(0, -1, 0),
      totalImpulse: new Vector3(0, 2, 0),
    };

    const seen: string[] = [];
    const unsubscribe = body.on("collisionstart", (received) => {
      seen.push("first");
      expect(received).toBe(event);
      expect(received.bodyA).toBe(body);
      expect(received.colliderB).toBe(otherCollider);
    });
    body.on("collisionstart", () => seen.push("second"));

    body.emit("collisionstart", event);
    expect(seen).toEqual(["first", "second"]);

    unsubscribe();
    body.emit("collisionstart", event);
    expect(seen).toEqual(["first", "second", "second"]);
  });

  it("carries the §32 sleep payloads", () => {
    const body = dynamicBody();
    const seen: string[] = [];
    body.on("sleep", (event) => seen.push(event.type));
    body.on("wake", (event) => seen.push(event.type));

    body.emit("sleep", { type: "sleep", body });
    body.emit("wake", { type: "wake", body });
    expect(seen).toEqual(["sleep", "wake"]);
  });
});

describe("RigidBody world registration (§21, §37)", () => {
  it("produces the descriptor an adapter is handed", () => {
    const inertia = new Matrix3();
    const body = new RigidBody({
      type: "dynamic",
      mass: 3,
      inertiaTensor: inertia,
      position: new Vector2(1, 2),
      rotation: 0,
      linearDamping: 0.5,
      ccdMode: "swept",
    });

    const descriptor = body.toDescriptor();
    expect(descriptor.type).toBe("dynamic");
    expect(descriptor.mass).toBe(3);
    expect(descriptor.linearDamping).toBe(0.5);
    expect(descriptor.gravityScale).toBe(1);
    expect(descriptor.ccdMode).toBe("swept");
    expect(descriptor.continuousCollisionDetection).toBe(true);
    // Live references, not copies.
    expect(descriptor.centerOfMass).toBe(body.centerOfMass);
    expect(descriptor.linearVelocity).toBe(body.linearVelocity);
    expect(descriptor.angularVelocity).toBe(body.angularVelocity);
    expect(descriptor.inertiaTensor).toBe(body.inertiaTensor);
    expect(descriptor.position).toBe(body.initialPosition);
    expect(descriptor.rotation).toBe(body.initialRotation);
  });

  it("omits the fields that were never authored", () => {
    const descriptor = new RigidBody({ type: "static" }).toDescriptor();
    expect("mass" in descriptor).toBe(false);
    expect("inertiaTensor" in descriptor).toBe(false);
    expect("position" in descriptor).toBe(false);
    expect("rotation" in descriptor).toBe(false);
  });

  it('accepts a planar body in a "2d" world and rejects an out-of-plane one', () => {
    const planar = new RigidBody({
      type: "dynamic",
      mass: 1,
      position: new Vector2(1, 2),
      angularVelocity: 2,
    });
    expect(() => {
      planar.validateFor("2d");
    }).not.toThrow();
    expect(() => {
      planar.validateFor("3d");
    }).not.toThrow();

    const spatial = new RigidBody({
      type: "dynamic",
      mass: 1,
      centerOfMass: new Vector3(0, 0, 1),
    });
    expect(() => {
      spatial.validateFor("3d");
    }).not.toThrow();
    const error = expectValidationError(() => {
      spatial.validateFor("2d");
    });
    expect(error.message).toContain("centerOfMass.z");
  });

  it("catches a body type corrupted after construction at registration", () => {
    const body = dynamicBody();
    body.type = "bogus" as RigidBodyDescriptor["type"];
    expectValidationError(() => {
      body.validateFor("3d");
    });
  });
});

describe("RigidBody as a §6a component", () => {
  it("attaches to a node and is found by type", () => {
    const node = new Group();
    const body = node.addComponent(dynamicBody());

    expect(body.host).toBe(node);
    expect(node.getComponent(RigidBody)).toBe(body);

    expect(node.removeComponent(body)).toBe(true);
    expect(body.host).toBeNull();
    expect(node.getComponent(RigidBody)).toBeUndefined();
  });

  it("is one per node, and coexists with other component types", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    const first = node.addComponent(dynamicBody());
    const motion = node.addComponent(new MotionComponent());
    const second = node.addComponent(dynamicBody());

    expect(node.getComponent(RigidBody)).toBe(second);
    expect(node.getComponent(MotionComponent)).toBe(motion);
    expect(first.host).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("drops listeners and queued commands on dispose (§83)", () => {
    const registry = new ComponentRegistry();
    const body = registry.add(dynamicBody());
    const seen: string[] = [];
    body.on("wake", () => seen.push("wake"));
    body.applyForce(new Vector3(1, 0, 0));
    body.wake();

    registry.disposeAll();

    expect(body.host).toBeNull();
    expect(body.listenerCount("wake")).toBe(0);
    expect(body.commands.force).toEqual(new Vector3(0, 0, 0));
    expect(body.commands.sleepCommand).toBeNull();
    body.emit("wake", { type: "wake", body });
    expect(seen).toEqual([]);
  });
});
