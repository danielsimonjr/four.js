import {
  Vector3,
  Vector4,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PARTICLE_LIFETIME_SECONDS,
  DEFAULT_PARTICLE_RESTITUTION,
  DEFAULT_PARTICLE_SEED,
  DEFAULT_PARTICLE_SIZE,
  PARTICLE_DRAWS_PER_SPAWN,
  ParticleEmitter,
} from "../src/emitter.js";
import { SeededRandom } from "../src/random.js";
import type { ParticleForceField } from "../src/types.js";

/** Scratch for the test fields below, so no `sample` implementation allocates. */
const fieldScratch = new Vector3();

/** A constant-acceleration field, the simplest §27-shaped thing there is. */
function constantField(x: number, y: number, z: number): ParticleForceField {
  return {
    sample(_position, _velocity, _time, out = fieldScratch): Vector3 {
      return out.set(x, y, z);
    },
  };
}

/**
 * The float32 recurrence the emitter actually runs: velocity is updated first
 * and the *unrounded* new velocity drives the position, then both are rounded on
 * their way into the `Float32Array`. Written out independently here so the
 * ballistic assertions are exact rather than approximate.
 */
function ballisticReference(
  steps: number,
  dt: number,
  acceleration: number,
  position0: number,
  velocity0: number,
): { position: number; velocity: number } {
  let position = Math.fround(position0);
  let velocity = Math.fround(velocity0);
  for (let i = 0; i < steps; i += 1) {
    const nextVelocity = velocity + acceleration * dt;
    const nextPosition = position + nextVelocity * dt;
    velocity = Math.fround(nextVelocity);
    position = Math.fround(nextPosition);
  }
  return { position, velocity };
}

/** Steps `emitter` `steps` times with a constant `dt`, advancing absolute time. */
function run(emitter: ParticleEmitter, steps: number, dt: number): void {
  for (let i = 0; i < steps; i += 1) {
    emitter.step(dt, i * dt);
  }
}

describe("ParticleEmitter — options", () => {
  it("applies the documented defaults", () => {
    const emitter = new ParticleEmitter({ maxParticles: 4 });
    expect(emitter.pool.capacity).toBe(4);
    expect(emitter.random.seed).toBe(DEFAULT_PARTICLE_SEED);
    expect(emitter.elapsedTime).toBe(0);
    expect(emitter.particleCount).toBe(0);
    expect(emitter.emittedCount).toBe(0);
    expect(emitter.droppedCount).toBe(0);
    expect(emitter.emissionAccumulator).toBe(0);
    expect(emitter.collisionPlaneY).toBeUndefined();

    // No emission rate and no bursts: stepping changes nothing.
    run(emitter, 10, 1 / 60);
    expect(emitter.particleCount).toBe(0);

    emitter.emit(1);
    const index = 0;
    expect(emitter.pool.getLifetime(index)).toBe(
      DEFAULT_PARTICLE_LIFETIME_SECONDS,
    );
    expect(emitter.pool.getStartSize(index)).toBe(DEFAULT_PARTICLE_SIZE);
    expect(emitter.pool.getEndSize(index)).toBe(DEFAULT_PARTICLE_SIZE);
    const color = new Vector4();
    emitter.pool.getStartColor(index, color);
    expect([color.x, color.y, color.z, color.w]).toEqual([1, 1, 1, 1]);
    emitter.pool.getEndColor(index, color);
    expect([color.x, color.y, color.z, color.w]).toEqual([1, 1, 1, 1]);
    // Default speed range is zero, so the default +Y direction is not visible in
    // the velocity — it is asserted in the cone suite instead.
    const velocity = new Vector3();
    emitter.pool.getVelocity(index, velocity);
    expect([velocity.x, velocity.y, velocity.z]).toEqual([0, 0, 0]);
    expect(DEFAULT_PARTICLE_RESTITUTION).toBe(0);
  });

  it("rejects every out-of-domain option", () => {
    expect(() => new ParticleEmitter({ maxParticles: -1 })).toThrow(RangeError);
    expect(() => new ParticleEmitter({ maxParticles: 2.5 })).toThrow(
      RangeError,
    );
    expect(
      () => new ParticleEmitter({ maxParticles: 1, seed: Number.NaN }),
    ).toThrow(/finite seed/);
    expect(
      () => new ParticleEmitter({ maxParticles: 1, emissionRate: -1 }),
    ).toThrow(/emissionRate/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          emissionRate: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(/emissionRate/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          bursts: [{ time: -1, count: 1 }],
        }),
    ).toThrow(/bursts\[0\]\.time/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          bursts: [
            { time: 0, count: 1 },
            { time: 1, count: 1.5 },
          ],
        }),
    ).toThrow(/bursts\[1\]\.count/);
    expect(
      () =>
        new ParticleEmitter({ maxParticles: 1, lifetime: { min: 0, max: 1 } }),
    ).toThrow(/lifetime\.min/);
    expect(
      () =>
        new ParticleEmitter({ maxParticles: 1, lifetime: { min: 2, max: 1 } }),
    ).toThrow(/lifetime\.max/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          initialSpeed: { min: Number.NaN, max: 1 },
        }),
    ).toThrow(/initialSpeed\.min/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          initialSpeed: { min: 3, max: 2 },
        }),
    ).toThrow(/initialSpeed\.max/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          size: { start: Number.NaN, end: 1 },
        }),
    ).toThrow(/size\.start/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          size: { start: 1, end: Number.POSITIVE_INFINITY },
        }),
    ).toThrow(/size\.end/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          color: {
            start: { r: Number.NaN, g: 0, b: 0, a: 1 },
            end: { r: 0, g: 0, b: 0, a: 0 },
          },
        }),
    ).toThrow(/color\.start\.r/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          color: {
            start: { r: 0, g: 0, b: 0, a: 1 },
            end: { r: 0, g: Number.NaN, b: 0, a: 0 },
          },
        }),
    ).toThrow(/color\.end\.g/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          position: new Vector3(Number.NaN, 0, 0),
        }),
    ).toThrow(/position\.x/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          direction: new Vector3(0, Number.NaN, 0),
        }),
    ).toThrow(/direction\.y/);
    expect(
      () => new ParticleEmitter({ maxParticles: 1, spreadAngle: -0.1 }),
    ).toThrow(/spreadAngle/);
    expect(
      () =>
        new ParticleEmitter({ maxParticles: 1, spreadAngle: Math.PI + 0.1 }),
    ).toThrow(/\[0, π\]/);
    expect(
      () =>
        new ParticleEmitter({
          maxParticles: 1,
          gravity: new Vector3(0, 0, Number.NaN),
        }),
    ).toThrow(/gravity\.z/);
    expect(
      () =>
        new ParticleEmitter({ maxParticles: 1, collisionPlaneY: Number.NaN }),
    ).toThrow(/collisionPlaneY/);
    expect(
      () => new ParticleEmitter({ maxParticles: 1, restitution: -0.5 }),
    ).toThrow(/restitution/);
  });

  it("copies the burst and field arrays, so later caller mutation is inert", () => {
    const bursts = [{ time: 0, count: 2 }];
    const fields = [constantField(1, 0, 0)];
    const emitter = new ParticleEmitter({
      maxParticles: 8,
      bursts,
      fields,
      lifetime: { min: 10, max: 10 },
    });
    bursts.push({ time: 0, count: 100 });
    fields.push(constantField(1000, 0, 0));

    emitter.step(0.5, 0); // spawns the two burst particles
    emitter.step(0.5, 0.5); // integrates them under the single copied field
    expect(emitter.particleCount).toBe(2);
    const velocity = new Vector3();
    emitter.pool.getVelocity(0, velocity);
    expect(velocity.x).toBe(0.5);
  });

  it("rejects an invalid emit count", () => {
    const emitter = new ParticleEmitter({ maxParticles: 2 });
    expect(() => emitter.emit(-1)).toThrow(RangeError);
    expect(() => emitter.emit(1.5)).toThrow(/non-negative safe integer/);
    expect(emitter.emit(0)).toBe(0);
  });

  it("rejects an invalid step", () => {
    const emitter = new ParticleEmitter({ maxParticles: 2 });
    expect(() => emitter.step(-1 / 60)).toThrow(/deltaSeconds/);
    expect(() => emitter.step(Number.NaN)).toThrow(RangeError);
    expect(() => emitter.step(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => emitter.step(1 / 60, Number.NaN)).toThrow(/time/);
  });
});

describe("ParticleEmitter — emission", () => {
  it("spawns ⌊rate · t⌋ cumulatively at a constant rate", () => {
    // 12 particles/s at 1/64 s per step is 0.1875 per step — a dyadic rational,
    // so the accumulator sums exactly and the closed form is exact, not
    // approximate.
    const rate = 12;
    const dt = 1 / 64;
    const emitter = new ParticleEmitter({
      maxParticles: 10000,
      emissionRate: rate,
      lifetime: { min: 1000, max: 1000 },
    });
    for (let n = 1; n <= 200; n += 1) {
      emitter.step(dt, (n - 1) * dt);
      const t = n * dt;
      expect(emitter.emittedCount, `after ${n} steps`).toBe(
        Math.floor(rate * t),
      );
      expect(emitter.particleCount).toBe(emitter.emittedCount);
    }
    expect(emitter.emittedCount).toBe(37);
  });

  it("carries the fractional remainder instead of truncating", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 100,
      emissionRate: 2.5,
      lifetime: { min: 1000, max: 1000 },
    });
    const perStep: number[] = [];
    let previous = 0;
    for (let n = 0; n < 6; n += 1) {
      emitter.step(0.5, n * 0.5);
      perStep.push(emitter.emittedCount - previous);
      previous = emitter.emittedCount;
    }
    // 1.25 per step accumulates 1.25, 1.5, 1.75, 2.0, … so the extra particle
    // lands on the fourth step; truncation would give a flat 1 every step.
    expect(perStep).toEqual([1, 1, 1, 2, 1, 1]);
    expect(emitter.emissionAccumulator).toBe(0.5);
  });

  it("emits nothing while the accumulator is below one", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 10,
      emissionRate: 0.1,
      lifetime: { min: 1000, max: 1000 },
    });
    run(emitter, 5, 1);
    expect(emitter.emittedCount).toBe(0);
    expect(emitter.emissionAccumulator).toBeCloseTo(0.5, 12);
  });

  it("fires each burst once, in declaration order, in the step that contains it", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 100,
      bursts: [
        { time: 0, count: 3 },
        { time: 0.5, count: 5 },
        { time: 100, count: 7 },
      ],
      lifetime: { min: 1000, max: 1000 },
      size: { start: 1, end: 1 },
    });
    emitter.step(0.25, 0);
    expect(emitter.emittedCount).toBe(3);
    emitter.step(0.25, 0.25); // window [0.25, 0.5): 0.5 is not in it
    expect(emitter.emittedCount).toBe(3);
    emitter.step(0.25, 0.5); // window [0.5, 0.75)
    expect(emitter.emittedCount).toBe(8);
    run(emitter, 20, 0.25);
    // The burst at t = 100 is still in the future; the first two never repeat.
    expect(emitter.emittedCount).toBe(8);
  });

  it("opens no burst window on a zero-length step", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 10,
      bursts: [{ time: 0, count: 4 }],
      emissionRate: 100,
      lifetime: { min: 10, max: 10 },
    });
    emitter.step(0, 0);
    expect(emitter.emittedCount).toBe(0);
    expect(emitter.elapsedTime).toBe(0);
    emitter.step(0.01, 0);
    expect(emitter.emittedCount).toBe(5);
  });

  it("drops spawns beyond capacity and counts them", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 3,
      bursts: [{ time: 0, count: 10 }],
      lifetime: { min: 1000, max: 1000 },
    });
    emitter.step(0.1, 0);
    expect(emitter.particleCount).toBe(3);
    expect(emitter.emittedCount).toBe(3);
    expect(emitter.droppedCount).toBe(7);
  });

  it("consumes no randomness for a dropped spawn", () => {
    const emitter = new ParticleEmitter({ maxParticles: 0, seed: 5 });
    expect(emitter.emit(1000)).toBe(0);
    expect(emitter.droppedCount).toBe(1000);
    // The stream has not moved: its next draw is still a fresh stream's first.
    expect(emitter.random.nextUint32()).toBe(new SeededRandom(5).nextUint32());
  });

  it("survives an emission accumulator that overflows binary64", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      emissionRate: 1e308,
      lifetime: { min: 1000, max: 1000 },
    });
    emitter.step(1e308, 0);
    expect(emitter.emittedCount).toBe(0);
    expect(emitter.emissionAccumulator).toBe(0);
    // And the emitter still works afterwards.
    emitter.step(1, 0);
    expect(emitter.particleCount).toBe(4);
  });

  it("consumes exactly PARTICLE_DRAWS_PER_SPAWN draws per particle", () => {
    expect(PARTICLE_DRAWS_PER_SPAWN).toBe(4);
    const seed = 909;
    const emitter = new ParticleEmitter({
      maxParticles: 50,
      seed,
      spreadAngle: Math.PI / 3,
      initialSpeed: { min: 1, max: 2 },
      lifetime: { min: 5, max: 6 },
    });
    emitter.emit(13);

    const reference = new SeededRandom(seed);
    for (let i = 0; i < 13 * PARTICLE_DRAWS_PER_SPAWN; i += 1) {
      reference.nextUint32();
    }
    expect(emitter.random.nextUint32()).toBe(reference.nextUint32());
  });

  it("consumes its draws even when every range is degenerate", () => {
    // A zero spread and constant ranges must still burn four draws, so that
    // widening a cone later does not re-phase the whole stream.
    const constant = new ParticleEmitter({ maxParticles: 10, seed: 3 });
    const varied = new ParticleEmitter({
      maxParticles: 10,
      seed: 3,
      spreadAngle: Math.PI / 4,
      lifetime: { min: 1, max: 2 },
      initialSpeed: { min: 0, max: 1 },
    });
    constant.emit(4);
    varied.emit(4);
    expect(constant.random.nextUint32()).toBe(varied.random.nextUint32());
  });
});

describe("ParticleEmitter — integration (§38 semi-implicit Euler)", () => {
  it("matches the discrete free-fall recurrence exactly, and its closed form closely", () => {
    const dt = 1 / 64;
    const gravity = -9.81;
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 1000, max: 1000 },
      gravity: new Vector3(0, gravity, 0),
    });

    // Step 1 spawns; the particle first integrates in step 2. After 65 steps it
    // has been integrated 64 times, so its age is exactly 1 s.
    run(emitter, 65, dt);
    const integrations = 64;
    expect(emitter.particleCount).toBe(1);
    expect(emitter.pool.getAge(0)).toBe(integrations * dt);

    const position = new Vector3();
    const velocity = new Vector3();
    emitter.pool.getPosition(0, position);
    emitter.pool.getVelocity(0, velocity);

    const reference = ballisticReference(integrations, dt, gravity, 0, 0);
    expect(position.y).toBe(reference.position);
    expect(velocity.y).toBe(reference.velocity);

    // The closed form of the recurrence: p = p₀ + v₀·t + ½·g·t·(t + dt). Note
    // the `+ dt`: that is the semi-implicit discretisation bias, and rounding it
    // away would be testing a simulation the engine does not run.
    const t = integrations * dt;
    const closedForm = 0.5 * gravity * t * (t + dt);
    expect(position.y).toBeCloseTo(closedForm, 4);
    expect(velocity.y).toBeCloseTo(gravity * t, 4);

    // The continuous solution is a *different* number — off by exactly ½·g·t·dt.
    expect(closedForm - 0.5 * gravity * t * t).toBeCloseTo(
      0.5 * gravity * t * dt,
      12,
    );
  });

  it("carries the initial velocity through the same recurrence", () => {
    const dt = 1 / 32;
    const gravity = -10;
    const speed = 6;
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 1000, max: 1000 },
      initialSpeed: { min: speed, max: speed },
      direction: new Vector3(0, 1, 0),
      gravity: new Vector3(0, gravity, 0),
      position: new Vector3(0, 2, 0),
    });
    run(emitter, 33, dt);

    const reference = ballisticReference(32, dt, gravity, 2, speed);
    const position = new Vector3();
    emitter.pool.getPosition(0, position);
    expect(position.y).toBe(reference.position);
    expect(position.x).toBe(0);
    expect(position.z).toBe(0);
  });

  it("ages a particle by exactly dt per integrated step and expires it on schedule", () => {
    const dt = 0.125;
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 0.5, max: 0.5 },
    });
    emitter.step(dt, 0); // spawn, age 0
    expect(emitter.particleCount).toBe(1);
    expect(emitter.pool.getAge(0)).toBe(0);

    const ages: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      emitter.step(dt, (i + 1) * dt);
      if (emitter.particleCount > 0) {
        ages.push(emitter.pool.getAge(0));
      }
    }
    // Ages 0.125, 0.25, 0.375 and then removal exactly when age reaches 0.5.
    expect(ages).toEqual([0.125, 0.25, 0.375]);
    expect(emitter.particleCount).toBe(0);
  });

  it("expires a whole cohort in one step, compacting deterministically", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 100,
      bursts: [{ time: 0, count: 50 }],
      lifetime: { min: 0.25, max: 0.25 },
    });
    emitter.step(0.25, 0);
    expect(emitter.particleCount).toBe(50);
    emitter.step(0.25, 0.25);
    expect(emitter.particleCount).toBe(0);
    expect(emitter.emittedCount).toBe(50);
  });

  it("keeps a steady state when rate × lifetime fits the pool", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 200,
      emissionRate: 64,
      lifetime: { min: 1, max: 1 },
    });
    run(emitter, 400, 1 / 64);
    // 64/s living 1 s each: one born and one dying per step once saturated.
    expect(emitter.particleCount).toBe(64);
    expect(emitter.droppedCount).toBe(0);
  });
});

describe("ParticleEmitter — spawn distribution", () => {
  it("emits exactly along the axis when the spread is zero", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 32,
      seed: 11,
      direction: new Vector3(0, 3, 0), // normalized at construction
      initialSpeed: { min: 4, max: 4 },
      lifetime: { min: 10, max: 10 },
    });
    emitter.emit(32);
    const velocity = new Vector3();
    for (let i = 0; i < 32; i += 1) {
      emitter.pool.getVelocity(i, velocity);
      expect(velocity.x).toBe(0);
      expect(velocity.y).toBe(4);
      expect(velocity.z).toBe(0);
    }
  });

  it("falls back to +Y for a zero-length direction (§7a)", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      direction: new Vector3(0, 0, 0),
      initialSpeed: { min: 2, max: 2 },
    });
    emitter.emit(1);
    const velocity = new Vector3();
    emitter.pool.getVelocity(0, velocity);
    expect([velocity.x, velocity.y, velocity.z]).toEqual([0, 2, 0]);
  });

  it("keeps every direction inside the cone, for axes on and off the basis axes", () => {
    const spreadAngle = Math.PI / 6;
    const axes = [
      new Vector3(0, 1, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, 1),
      new Vector3(0.5, 0.8, 0.1), // exercises the third basis-axis branch
      new Vector3(-1, -2, 3),
    ];
    const velocity = new Vector3();
    for (const axis of axes) {
      const emitter = new ParticleEmitter({
        maxParticles: 500,
        seed: 4242,
        direction: axis,
        spreadAngle,
        initialSpeed: { min: 1, max: 1 },
        lifetime: { min: 10, max: 10 },
      });
      emitter.emit(500);
      const unit = axis.clone().normalize();
      let minDot = 1;
      let maxDot = -1;
      for (let i = 0; i < 500; i += 1) {
        emitter.pool.getVelocity(i, velocity);
        // Speed 1, so the velocity is the direction.
        expect(velocity.length()).toBeCloseTo(1, 5);
        const dot = velocity.dot(unit);
        minDot = Math.min(minDot, dot);
        maxDot = Math.max(maxDot, dot);
      }
      expect(minDot).toBeGreaterThan(Math.cos(spreadAngle) - 1e-5);
      // The cap is actually filled, not collapsed onto the axis.
      expect(minDot).toBeLessThan(Math.cos(spreadAngle) + 0.01);
      expect(maxDot).toBeGreaterThan(0.999);
    }
  });

  it("covers the whole sphere at a spread of π", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2000,
      seed: 8,
      spreadAngle: Math.PI,
      initialSpeed: { min: 1, max: 1 },
      lifetime: { min: 10, max: 10 },
    });
    emitter.emit(2000);
    const velocity = new Vector3();
    let minY = 1;
    let maxY = -1;
    let sumX = 0;
    for (let i = 0; i < 2000; i += 1) {
      emitter.pool.getVelocity(i, velocity);
      minY = Math.min(minY, velocity.y);
      maxY = Math.max(maxY, velocity.y);
      sumX += velocity.x;
    }
    expect(minY).toBeLessThan(-0.99);
    expect(maxY).toBeGreaterThan(0.99);
    expect(Math.abs(sumX / 2000)).toBeLessThan(0.05);
  });

  it("draws lifetimes and speeds inside their ranges", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 400,
      seed: 77,
      lifetime: { min: 0.5, max: 2.5 },
      initialSpeed: { min: 3, max: 9 },
    });
    emitter.emit(400);
    const velocity = new Vector3();
    let minLifetime = Number.POSITIVE_INFINITY;
    let maxLifetime = Number.NEGATIVE_INFINITY;
    let minSpeed = Number.POSITIVE_INFINITY;
    let maxSpeed = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 400; i += 1) {
      const lifetime = emitter.pool.getLifetime(i);
      minLifetime = Math.min(minLifetime, lifetime);
      maxLifetime = Math.max(maxLifetime, lifetime);
      emitter.pool.getVelocity(i, velocity);
      const speed = velocity.length();
      minSpeed = Math.min(minSpeed, speed);
      maxSpeed = Math.max(maxSpeed, speed);
    }
    expect(minLifetime).toBeGreaterThanOrEqual(0.5);
    expect(maxLifetime).toBeLessThan(2.5);
    expect(minLifetime).toBeLessThan(0.6);
    expect(maxLifetime).toBeGreaterThan(2.4);
    expect(minSpeed).toBeGreaterThan(3 - 1e-4);
    expect(maxSpeed).toBeLessThan(9 + 1e-4);
  });

  it("spawns at the emitter position with the authored ramps", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      position: new Vector3(-2, 7, 0.5),
      size: { start: 4, end: 0 },
      color: {
        start: { r: 1, g: 0.5, b: 0.25, a: 1 },
        end: { r: 0, g: 0, b: 0, a: 0 },
      },
      lifetime: { min: 2, max: 2 },
    });
    emitter.emit(1);
    const position = new Vector3();
    emitter.pool.getPosition(0, position);
    expect([position.x, position.y, position.z]).toEqual([-2, 7, 0.5]);
    expect(emitter.pool.getSize(0)).toBe(4);

    // Half way through the lifetime the ramps are exactly half way.
    emitter.pool.setAge(0, 1);
    expect(emitter.pool.getSize(0)).toBe(2);
    const color = new Vector4();
    emitter.pool.getColor(0, color);
    expect([color.x, color.y, color.z, color.w]).toEqual([
      0.5, 0.25, 0.125, 0.5,
    ]);
  });
});

describe("ParticleEmitter — force fields (§27)", () => {
  it("adds gravity and every field, sampling each once per particle per step", () => {
    let calls = 0;
    const counting: ParticleForceField = {
      sample(_position, _velocity, _time, out = fieldScratch): Vector3 {
        calls += 1;
        return out.set(0, 0, 1);
      },
    };
    const emitter = new ParticleEmitter({
      maxParticles: 8,
      bursts: [{ time: 0, count: 4 }],
      lifetime: { min: 100, max: 100 },
      gravity: new Vector3(2, 0, 0),
      fields: [counting],
    });
    emitter.step(1, 0); // spawn only — nothing to integrate yet
    expect(calls).toBe(0);
    emitter.step(1, 1);
    expect(calls).toBe(4);

    const velocity = new Vector3();
    emitter.pool.getVelocity(0, velocity);
    expect([velocity.x, velocity.y, velocity.z]).toEqual([2, 0, 1]);
  });

  it("hands fields the particle's live state, the absolute time, and a reusable out", () => {
    const seen: {
      position: [number, number, number];
      velocity: [number, number, number];
      time: number;
    }[] = [];
    let outIdentity: Vector3 | undefined;
    const recording: ParticleForceField = {
      sample(position, velocity, time, out = fieldScratch): Vector3 {
        seen.push({
          position: [position.x, position.y, position.z],
          velocity: [velocity.x, velocity.y, velocity.z],
          time,
        });
        outIdentity ??= out;
        expect(out).toBe(outIdentity);
        return out.set(0, 0, 0);
      },
    };
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 100, max: 100 },
      position: new Vector3(1, 2, 3),
      initialSpeed: { min: 5, max: 5 },
      fields: [recording],
    });
    emitter.step(0.5, 40);
    emitter.step(0.5, 40.5);
    emitter.step(0.5, 41);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({
      position: [1, 2, 3],
      velocity: [0, 5, 0],
      time: 40.5,
    });
    // Second sample sees the state after one integration: y = 2 + 5·0.5.
    expect(seen[1].position).toEqual([1, 4.5, 3]);
    expect(seen[1].time).toBe(41);
  });

  it("defaults the sample time to the emitter's own elapsed time", () => {
    const times: number[] = [];
    const recording: ParticleForceField = {
      sample(_position, _velocity, time, out = fieldScratch): Vector3 {
        times.push(time);
        return out.set(0, 0, 0);
      },
    };
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 100, max: 100 },
      fields: [recording],
    });
    emitter.step(0.25);
    emitter.step(0.25);
    emitter.step(0.25);
    expect(times).toEqual([0.25, 0.5]);
  });

  it("sums gravity first, then fields in declaration order (§33)", () => {
    // Floating-point addition is not associative: (1e16 − 1e16) + 1 is 1, while
    // (1e16 + 1) − 1e16 is 0, because 1e16 + 1 rounds back to 1e16. The emitter
    // sums gravity, then the fields left to right, so these two orders must give
    // different — and individually pinned — results.
    const big = constantField(-1e16, 0, 0);
    const one = constantField(1, 0, 0);
    const build = (fields: ParticleForceField[]): ParticleEmitter =>
      new ParticleEmitter({
        maxParticles: 2,
        bursts: [{ time: 0, count: 1 }],
        lifetime: { min: 100, max: 100 },
        gravity: new Vector3(1e16, 0, 0),
        fields,
      });

    const declared = build([big, one]);
    const reversed = build([one, big]);
    declared.step(1, 0);
    declared.step(1, 1);
    reversed.step(1, 0);
    reversed.step(1, 1);

    const velocity = new Vector3();
    declared.pool.getVelocity(0, velocity);
    expect(velocity.x).toBe(1);
    reversed.pool.getVelocity(0, velocity);
    expect(velocity.x).toBe(0);
  });

  it("calls fields in declaration order for every particle", () => {
    const order: string[] = [];
    const tag = (name: string): ParticleForceField => ({
      sample(_position, _velocity, _time, out = fieldScratch): Vector3 {
        order.push(name);
        return out.set(0, 0, 0);
      },
    });
    const emitter = new ParticleEmitter({
      maxParticles: 4,
      bursts: [{ time: 0, count: 2 }],
      lifetime: { min: 100, max: 100 },
      fields: [tag("a"), tag("b"), tag("c")],
    });
    emitter.step(0.1, 0);
    emitter.step(0.1, 0.1);
    expect(order).toEqual(["a", "b", "c", "a", "b", "c"]);
  });
});

describe("ParticleEmitter — plane collision (§36 MVP tier)", () => {
  it("reflects the normal velocity scaled by restitution and clamps the position", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 100, max: 100 },
      position: new Vector3(0, 1, 0),
      gravity: new Vector3(0, -10, 0),
      collisionPlaneY: 0,
      restitution: 0.5,
    });
    expect(emitter.collisionPlaneY).toBe(0);
    emitter.step(0.5, 0); // spawn at y = 1

    const position = new Vector3();
    const velocity = new Vector3();

    emitter.step(0.5, 0.5);
    // v = −5, y would be −1.5 → clamped to 0, v reflected to +2.5.
    emitter.pool.getPosition(0, position);
    emitter.pool.getVelocity(0, velocity);
    expect(position.y).toBe(0);
    expect(velocity.y).toBe(2.5);

    emitter.step(0.5, 1);
    // v = 2.5 − 5 = −2.5, y = −1.25 → clamped, v reflected to +1.25.
    emitter.pool.getPosition(0, position);
    emitter.pool.getVelocity(0, velocity);
    expect(position.y).toBe(0);
    expect(velocity.y).toBe(1.25);
  });

  it("stops the descent entirely at the default restitution", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 100, max: 100 },
      position: new Vector3(0, 1, 0),
      gravity: new Vector3(0, -10, 0),
      collisionPlaneY: -1,
    });
    run(emitter, 6, 0.5);
    const position = new Vector3();
    const velocity = new Vector3();
    emitter.pool.getPosition(0, position);
    emitter.pool.getVelocity(0, velocity);
    expect(position.y).toBe(-1);
    expect(velocity.y).toBe(0);
  });

  it("leaves tangential velocity alone (the plane is frictionless)", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 100, max: 100 },
      position: new Vector3(0, 1, 0),
      direction: new Vector3(1, 0, 0),
      initialSpeed: { min: 3, max: 3 },
      gravity: new Vector3(0, -10, 0),
      collisionPlaneY: 0,
      restitution: 0.25,
    });
    run(emitter, 4, 0.5);
    const velocity = new Vector3();
    emitter.pool.getVelocity(0, velocity);
    expect(velocity.x).toBe(3);
    expect(velocity.z).toBe(0);
  });

  it("lifts a particle spawned below the plane without inverting a rising velocity", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 100, max: 100 },
      position: new Vector3(0, -5, 0),
      initialSpeed: { min: 2, max: 2 }, // +Y, i.e. rising
      collisionPlaneY: 0,
      restitution: 0.9,
    });
    emitter.step(0.5, 0);
    emitter.step(0.5, 0.5);
    const position = new Vector3();
    const velocity = new Vector3();
    emitter.pool.getPosition(0, position);
    emitter.pool.getVelocity(0, velocity);
    expect(position.y).toBe(0);
    expect(velocity.y).toBe(2);
  });

  it("lets particles fall through when no plane is configured", () => {
    const emitter = new ParticleEmitter({
      maxParticles: 2,
      bursts: [{ time: 0, count: 1 }],
      lifetime: { min: 100, max: 100 },
      gravity: new Vector3(0, -10, 0),
    });
    run(emitter, 6, 0.5);
    const position = new Vector3();
    emitter.pool.getPosition(0, position);
    expect(position.y).toBeLessThan(-20);
    expect(emitter.collisionPlaneY).toBeUndefined();
  });
});

/** A stateless swirl field, deterministic in position and time. */
const swirl: ParticleForceField = {
  sample(position, velocity, time, out = fieldScratch): Vector3 {
    return out.set(
      -position.z * 0.5 - velocity.x * 0.1,
      Math.sin(time) * 0.25,
      position.x * 0.5,
    );
  },
};

/** The determinism scenario: spawns, deaths, fields, bounces, and saturation. */
function buildScenario(seed: number): ParticleEmitter {
  return new ParticleEmitter({
    // Deliberately smaller than the peak demand (37/s at ~1 s lifetimes plus a
    // 40-particle burst), so the scenario exercises the saturated path too.
    maxParticles: 60,
    seed,
    position: new Vector3(0, 5, 0),
    emissionRate: 37,
    bursts: [
      { time: 0, count: 25 },
      { time: 1.5, count: 40 },
      { time: 4, count: 10 },
    ],
    lifetime: { min: 0.4, max: 1.6 },
    initialSpeed: { min: 1, max: 6 },
    direction: new Vector3(0.2, 1, -0.3),
    spreadAngle: Math.PI / 5,
    size: { start: 1, end: 0.25 },
    color: {
      start: { r: 1, g: 0.8, b: 0.2, a: 1 },
      end: { r: 0.2, g: 0, b: 0, a: 0 },
    },
    gravity: new Vector3(0, -9.81, 0),
    fields: [swirl],
    collisionPlaneY: 0,
    restitution: 0.4,
  });
}

/** 600 steps of the scenario with a deliberately irregular delta sequence. */
function runScenario(emitter: ParticleEmitter, steps = 600): void {
  let time = 0;
  for (let i = 0; i < steps; i += 1) {
    const dt = i % 3 === 0 ? 1 / 120 : 1 / 60;
    emitter.step(dt, time);
    time += dt;
  }
}

/** Every channel of a pool, flattened for comparison. */
function poolState(
  emitter: ParticleEmitter,
): Record<string, number[] | number> {
  const pool = emitter.pool;
  return {
    aliveCount: pool.aliveCount,
    emitted: emitter.emittedCount,
    dropped: emitter.droppedCount,
    positions: Array.from(pool.positions),
    velocities: Array.from(pool.velocities),
    ages: Array.from(pool.ages),
    lifetimes: Array.from(pool.lifetimes),
    sizes: Array.from(pool.sizes),
    colors: Array.from(pool.colors),
  };
}

describe("ParticleEmitter — determinism (§33)", () => {
  it("is bit-identical across two runs of 600 steps with spawns, deaths, and bounces", () => {
    const a = buildScenario(2024);
    const b = buildScenario(2024);
    runScenario(a);
    runScenario(b);

    expect(a.particleCount).toBeGreaterThan(0);
    expect(a.emittedCount).toBeGreaterThan(300);
    expect(a.droppedCount).toBeGreaterThan(0); // the pool really does saturate
    expect(poolState(a)).toEqual(poolState(b));
    expect(a.elapsedTime).toBe(b.elapsedTime);
    expect(a.emissionAccumulator).toBe(b.emissionAccumulator);
  });

  it("diverges for a different seed", () => {
    const a = buildScenario(1);
    const b = buildScenario(2);
    runScenario(a, 120);
    runScenario(b, 120);
    expect(Array.from(a.pool.positions)).not.toEqual(
      Array.from(b.pool.positions),
    );
  });

  it("reproduces a run exactly after reset()", () => {
    const emitter = buildScenario(31337);
    runScenario(emitter, 300);
    const first = poolState(emitter);

    expect(emitter.reset()).toBe(emitter);
    expect(emitter.particleCount).toBe(0);
    expect(emitter.elapsedTime).toBe(0);
    expect(emitter.emittedCount).toBe(0);
    expect(emitter.droppedCount).toBe(0);
    expect(emitter.emissionAccumulator).toBe(0);

    runScenario(emitter, 300);
    expect(poolState(emitter)).toEqual(first);
    // Including the bursts, which must be re-armed by reset().
    expect(emitter.emittedCount).toBe(first.emitted);
  });

  it("does not depend on the absolute time offset for spawning or ageing", () => {
    const withoutOffset = buildScenario(5);
    const withOffset = buildScenario(5);
    let time = 0;
    for (let i = 0; i < 200; i += 1) {
      const dt = 1 / 60;
      withoutOffset.step(dt, time);
      // The same emitter-local schedule, sampled at a wildly different absolute
      // time — bursts and emission must be unaffected (only the field is not).
      withOffset.step(dt, time + 900);
      time += dt;
    }
    expect(withOffset.emittedCount).toBe(withoutOffset.emittedCount);
    expect(withOffset.particleCount).toBe(withoutOffset.particleCount);
  });
});

describe("ParticleEmitter — allocation (§7b, plan D7)", () => {
  it("allocates no math objects while stepping", () => {
    const emitter = buildScenario(7);
    runScenario(emitter, 60); // warm up past the first spawns
    resetConstructionCount();
    runScenario(emitter, 240);
    expect(constructionCount()).toBe(0);
    expect(emitter.particleCount).toBeGreaterThan(0);
  });

  it("constructs no typed arrays while stepping", () => {
    const emitter = buildScenario(9);
    runScenario(emitter, 60);

    const realFloat32Array = globalThis.Float32Array;
    let constructed = 0;
    const counting = new Proxy(realFloat32Array, {
      construct(target, args, newTarget): object {
        constructed += 1;
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
    globalThis.Float32Array = counting;
    try {
      runScenario(emitter, 240);
    } finally {
      globalThis.Float32Array = realFloat32Array;
    }
    expect(constructed).toBe(0);

    // Sanity: the proxy would have counted a real allocation.
    globalThis.Float32Array = counting;
    try {
      void new Float32Array(1);
    } finally {
      globalThis.Float32Array = realFloat32Array;
    }
    expect(constructed).toBe(1);
  });
});
