/**
 * §44 `CameraShake` — interpolated value-noise offset, trauma/impulse, and
 * the `ConstraintSystem` hook (R-36/R-37 residue).
 */

import { Quaternion, Vector3 } from "@four/math";
import { Group } from "@four/scene";
import { describe, expect, it, vi } from "vitest";

import { OrbitRig } from "../src/camera-rigs.js";
import { CameraShake } from "../src/camera-shake.js";
import { DEFAULT_FIXED_DELTA_TIME, createTimeState } from "../src/clock.js";
import { ConstraintSystem } from "../src/constraints.js";
import { SeededRandom } from "../src/random.js";
import type { FixedUpdateContext } from "../src/systems.js";

const DT = DEFAULT_FIXED_DELTA_TIME;

function makeContext(
  simulationTime = 0,
  fixedDeltaTime = DT,
): FixedUpdateContext {
  const time = createTimeState({ fixedDeltaTime });
  time.simulationTime = simulationTime;
  return { time };
}

describe("CameraShake (§44)", () => {
  it("is a component keyed CameraShake, one per node", () => {
    expect(CameraShake.typeName).toBe("CameraShake");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    const first = node.addComponent(new CameraShake({ seed: 1 }));
    const second = node.addComponent(new CameraShake({ seed: 2 }));
    warn.mockRestore();
    expect(node.getComponent(CameraShake)).toBe(second);
    expect(first.host).toBeNull();
    expect(second.host).toBe(node);
  });

  it("produces bit-identical offsets for the same seed and time (§33)", () => {
    const a = new Group();
    const b = new Group();
    a.position.set(3, 1, -2);
    b.position.set(3, 1, -2);
    const shakeA = new CameraShake({
      amplitude: new Vector3(0.4, 0.5, 0.6),
      frequency: 7,
      seed: 42,
    });
    const shakeB = new CameraShake({
      amplitude: new Vector3(0.4, 0.5, 0.6),
      frequency: 7,
      seed: 42,
    });

    expect(shakeA.apply(a, 0, 1.25)).toBe(true);
    expect(shakeB.apply(b, 0, 1.25)).toBe(true);
    expect(Object.is(a.position.x, b.position.x)).toBe(true);
    expect(Object.is(a.position.y, b.position.y)).toBe(true);
    expect(Object.is(a.position.z, b.position.z)).toBe(true);
  });

  it("accepts a SeededRandom as a salt source without drawing from it", () => {
    const random = new SeededRandom(99);
    const before = random.nextUint32();
    random.reset();
    const node = new Group();
    const shake = new CameraShake({
      amplitude: new Vector3(0.2, 0.2, 0.2),
      seed: random,
    });
    expect(shake.seed).toBe(99);
    shake.apply(node, 0, 0.5);
    expect(random.nextUint32()).toBe(before);
  });

  it("samples noise at simulationTime, not at the step rate", () => {
    const slow = new Group();
    const fast = new Group();
    const options = {
      amplitude: new Vector3(0.3, 0.3, 0.3),
      frequency: 5,
      seed: 8,
    };
    new CameraShake(options).apply(slow, 1 / 30, 0.2);
    new CameraShake(options).apply(fast, 1 / 120, 0.2);
    expect(Object.is(slow.position.x, fast.position.x)).toBe(true);
    expect(Object.is(slow.position.y, fast.position.y)).toBe(true);
    expect(Object.is(slow.position.z, fast.position.z)).toBe(true);
  });

  it("leaves the transform untouched when amplitude is zero", () => {
    const node = new Group();
    node.position.set(1, 2, 3);
    node.rotation.set(0.1, 0.2, 0.3, 0.9).normalize();
    const before = node.rotation.clone();
    const shake = new CameraShake({
      amplitude: new Vector3(0, 0, 0),
      rotationAmplitude: new Vector3(0, 0, 0),
      seed: 1,
      frequency: 20,
    });
    expect(shake.apply(node, DT, 4)).toBe(true);
    expect(node.position.equalsApprox(new Vector3(1, 2, 3), 0)).toBe(true);
    expect(node.rotation.x).toBe(before.x);
    expect(node.rotation.y).toBe(before.y);
    expect(node.rotation.z).toBe(before.z);
    expect(node.rotation.w).toBe(before.w);
  });

  it("decays trauma by traumaDecay per second", () => {
    const node = new Group();
    const shake = new CameraShake({
      amplitude: new Vector3(0.1, 0.1, 0.1),
      trauma: 1,
      traumaDecay: 2,
    });
    shake.apply(node, 0.25, 0);
    expect(shake.trauma).toBeCloseTo(0.5, 12);
    shake.apply(node, 0.4, 0.25);
    expect(shake.trauma).toBeCloseTo(0, 12);
  });

  it("impulse raises trauma and clamps to [0, 1]", () => {
    const shake = new CameraShake({ trauma: 0.2 });
    shake.impulse(0.5);
    expect(shake.trauma).toBeCloseTo(0.7, 12);
    shake.impulse(1);
    expect(shake.trauma).toBe(1);
    shake.impulse(-2);
    expect(shake.trauma).toBe(0);
  });

  it("zero trauma is an identity apply even with non-zero amplitude", () => {
    const node = new Group();
    node.position.set(4, 5, 6);
    const shake = new CameraShake({
      amplitude: new Vector3(2, 2, 2),
      trauma: 0,
      seed: 3,
    });
    expect(shake.apply(node, 0, 1)).toBe(true);
    expect(node.position.equalsApprox(new Vector3(4, 5, 6), 0)).toBe(true);
  });

  it("refuses non-finite construction values (§85)", () => {
    expect(() => new CameraShake({ frequency: -1 })).toThrow(RangeError);
    expect(() => new CameraShake({ traumaDecay: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => new CameraShake({ seed: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => new CameraShake({ trauma: Number.NaN })).toThrow(RangeError);
    const shake = new CameraShake();
    expect(() => {
      shake.trauma = Number.NaN;
    }).toThrow(RangeError);
    expect(() => shake.impulse(Number.NaN)).toThrow(RangeError);
  });

  it("accumulates time when apply is called without simulationTime", () => {
    const a = new Group();
    const b = new Group();
    const options = {
      amplitude: new Vector3(0.2, 0.2, 0.2),
      frequency: 3,
      seed: 5,
    };
    new CameraShake(options).apply(a, 0.5);
    new CameraShake(options).apply(b, 0, 0.5);
    expect(Object.is(a.position.x, b.position.x)).toBe(true);
    expect(Object.is(a.position.y, b.position.y)).toBe(true);
    expect(Object.is(a.position.z, b.position.z)).toBe(true);
  });

  it("counts a skipped step when the parent cannot be inverted", () => {
    const parent = new Group();
    parent.scale.set(0, 0, 0);
    const child = new Group();
    parent.add(child);
    const shake = new CameraShake({
      amplitude: new Vector3(1, 0, 0),
      seed: 1,
      frequency: 1,
    });
    expect(shake.apply(child, 0, 0.3)).toBe(false);
    expect(shake.skippedSteps).toBe(1);
  });

  it("adds an optional rotational offset", () => {
    const node = new Group();
    const identity = new Quaternion();
    const shake = new CameraShake({
      amplitude: new Vector3(0, 0, 0),
      rotationAmplitude: new Vector3(0.2, 0.1, 0.05),
      seed: 11,
      frequency: 3,
    });
    shake.apply(node, 0, 0.8);
    expect(
      node.rotation.x === identity.x && node.rotation.y === identity.y,
    ).toBe(false);
  });
});

describe("ConstraintSystem + CameraShake", () => {
  it("applies shake on a node that carries only CameraShake", () => {
    const camera = new Group();
    camera.transformAuthority = "constraint";
    camera.addComponent(
      new CameraShake({
        amplitude: new Vector3(0.5, 0, 0),
        seed: 4,
        frequency: 2,
      }),
    );
    const system = new ConstraintSystem();
    system.track(camera);
    system.fixedUpdate(makeContext(0.75));
    expect(camera.position.equalsApprox(new Vector3(0, 0, 0), 0)).toBe(false);
  });

  it("runs shake after a placement rig, so the offset is additive", () => {
    const probe = new Group();
    const shakeOptions = {
      amplitude: new Vector3(0.25, 0.15, 0.05),
      frequency: 4,
      seed: 15,
    };
    new CameraShake(shakeOptions).apply(probe, 0, 1.5);
    const offset = probe.position.clone();

    const camera = new Group();
    camera.transformAuthority = "constraint";
    camera.addComponent(
      new OrbitRig({ target: new Vector3(0, 0, 0), distance: 2 }),
    );
    camera.addComponent(new CameraShake(shakeOptions));
    const system = new ConstraintSystem();
    system.track(camera);
    system.fixedUpdate(makeContext(1.5));

    expect(
      camera.position.equalsApprox(
        new Vector3(offset.x, offset.y, 2 + offset.z),
        1e-12,
      ),
    ).toBe(true);
  });
});
