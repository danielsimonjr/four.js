import { describe, expect, it } from "vitest";

import { Vector3 } from "@four/math";

import {
  ParticleEmitter,
  dragField,
  radialField,
  turbulenceField,
  uniformGravityField,
  volumeField,
  vortexField,
  windField,
  type ParticleForceField,
} from "../src/index.js";

/**
 * The same field with its batched entry point hidden, so an emitter built on it
 * takes the per-particle path §27 has always taken. This is the reference every
 * assertion below compares against.
 */
function scalarOnly(field: ParticleForceField): ParticleForceField {
  return {
    sample: (position, velocity, time, out) =>
      field.sample(position, velocity, time, out),
  };
}

/** Every built-in field, each paired with a name for the test title. */
function builtins(): { name: string; field: ParticleForceField }[] {
  return [
    { name: "uniformGravityField", field: uniformGravityField() },
    {
      name: "uniformGravityField(custom)",
      field: uniformGravityField(new Vector3(0.5, -3, 0.25)),
    },
    { name: "dragField", field: dragField(0.7) },
    { name: "windField", field: windField(new Vector3(4, 0, -1), 0.3) },
    {
      name: "radialField",
      field: radialField(new Vector3(0.25, 1, -0.5), 12),
    },
    {
      name: "vortexField",
      field: vortexField(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 9),
    },
    { name: "turbulenceField", field: turbulenceField(1234) },
    {
      name: "turbulenceField(scrolling)",
      field: turbulenceField(99, { scroll: new Vector3(1, 0.5, -2) }),
    },
    {
      name: "volumeField(sphere)",
      field: volumeField(radialField(new Vector3(0, 0, 0), -6), {
        shape: "sphere",
        center: new Vector3(0, 1, 0),
        radius: 3,
        falloff: 1,
      }),
    },
    {
      name: "volumeField(box)",
      field: volumeField(uniformGravityField(new Vector3(0, 5, 0)), {
        shape: "box",
        center: new Vector3(0, 1, 0),
        extents: new Vector3(2, 2, 2),
      }),
    },
  ];
}

/**
 * Runs a fountain with `fields` for `steps` fixed steps and returns the live
 * pool state, copied. Seeded, so two runs differ only in the code path taken.
 */
function run(
  fields: readonly ParticleForceField[],
  steps = 40,
): {
  aliveCount: number;
  positions: Float32Array;
  velocities: Float32Array;
} {
  const emitter = new ParticleEmitter({
    maxParticles: 400,
    emissionRate: 120,
    seed: 20260821,
    lifetime: { min: 0.2, max: 0.5 },
    initialSpeed: { min: 1, max: 4 },
    spreadAngle: 1,
    gravity: new Vector3(0.1, -9.81, -0.2),
    collisionPlaneY: -1,
    restitution: 0.4,
    fields,
  });
  for (let i = 0; i < steps; i += 1) {
    emitter.step(1 / 60);
  }
  const n = emitter.pool.aliveCount;
  return {
    aliveCount: n,
    positions: emitter.pool.positions.slice(0, n * 3),
    velocities: emitter.pool.velocities.slice(0, n * 3),
  };
}

describe("§27 batched field sampling is bit-identical (R-34)", () => {
  for (const { name, field } of builtins()) {
    it(`${name}: sampleAll matches sample, particle for particle`, () => {
      const batched = run([field]);
      const scalar = run([scalarOnly(field)]);
      expect(batched.aliveCount).toBe(scalar.aliveCount);
      expect(batched.aliveCount).toBeGreaterThan(0);
      expect(Array.from(batched.positions)).toEqual(
        Array.from(scalar.positions),
      );
      expect(Array.from(batched.velocities)).toEqual(
        Array.from(scalar.velocities),
      );
    });
  }

  it("every built-in field offers the fast path", () => {
    for (const { name, field } of builtins()) {
      expect(Object.hasOwn(field, "sampleAll"), name).toBe(true);
    }
  });

  it("three stacked fields sum in declaration order, batched or not", () => {
    const fields = [
      uniformGravityField(new Vector3(0.3, -1, 0)),
      windField(new Vector3(2, 0, 0), 0.4),
      vortexField(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 5),
    ];
    const batched = run(fields);
    const scalar = run(fields.map(scalarOnly));
    expect(Array.from(batched.positions)).toEqual(Array.from(scalar.positions));
  });

  it("a field without the fast path is mixed in without disabling it", () => {
    const wind = windField(new Vector3(2, 0, 0), 0.4);
    const custom: ParticleForceField = {
      sample: (position, _velocity, _time, out) =>
        (out ?? new Vector3()).set(0, 0, position.x * 0.5),
    };
    const mixed = run([dragField(0.2), custom, wind]);
    const allScalar = run([
      scalarOnly(dragField(0.2)),
      custom,
      scalarOnly(wind),
    ]);
    expect(mixed.aliveCount).toBe(allScalar.aliveCount);
    expect(Array.from(mixed.positions)).toEqual(
      Array.from(allScalar.positions),
    );
    expect(Array.from(mixed.velocities)).toEqual(
      Array.from(allScalar.velocities),
    );
  });

  it("survives the swap-remove that reorders slots mid-step", () => {
    // Short, spread lifetimes guarantee deaths inside the integration loop, so
    // the accumulator has to take the same swap the pool does.
    const fields = [radialField(new Vector3(0, 0, 0), -3), dragField(0.5)];
    const emitter = new ParticleEmitter({
      maxParticles: 200,
      emissionRate: 200,
      seed: 7,
      lifetime: { min: 0.05, max: 0.6 },
      initialSpeed: { min: 0.5, max: 3 },
      spreadAngle: 1.2,
      gravity: new Vector3(0, -9.81, 0),
      fields,
    });
    const reference = new ParticleEmitter({
      maxParticles: 200,
      emissionRate: 200,
      seed: 7,
      lifetime: { min: 0.05, max: 0.6 },
      initialSpeed: { min: 0.5, max: 3 },
      spreadAngle: 1.2,
      gravity: new Vector3(0, -9.81, 0),
      fields: fields.map(scalarOnly),
    });
    let deaths = 0;
    for (let i = 0; i < 60; i += 1) {
      const before = emitter.pool.aliveCount;
      emitter.step(1 / 60);
      reference.step(1 / 60);
      if (emitter.pool.aliveCount < before) {
        deaths += 1;
      }
      expect(emitter.pool.aliveCount).toBe(reference.pool.aliveCount);
      const n = emitter.pool.aliveCount;
      expect(Array.from(emitter.pool.positions.slice(0, n * 3))).toEqual(
        Array.from(reference.pool.positions.slice(0, n * 3)),
      );
    }
    expect(deaths).toBeGreaterThan(0);
  });

  it("degenerate positions take the same branch as the scalar path", () => {
    // A particle exactly at the centre of a radial field and exactly on a
    // vortex axis, plus one outside a volume and one inside its fade band:
    // every early-out `sampleAll` has, driven directly so the crafted
    // positions survive to the call.
    const positions = new Float32Array([
      0, 0, 0, 0, 5, 0, 100, 100, 100, 0, 0.5, 0,
    ]);
    const velocities = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0]);
    const count = 4;
    const fields = [
      radialField(new Vector3(0, 0, 0), 7),
      vortexField(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 4),
      volumeField(dragField(0.5), {
        shape: "sphere",
        center: new Vector3(0, 0, 0),
        radius: 1,
        falloff: 0.75,
      }),
      volumeField(uniformGravityField(new Vector3(1, 2, 3)), {
        shape: "box",
        center: new Vector3(0, 0, 0),
        extents: new Vector3(1, 1, 1),
      }),
    ];

    for (const field of fields) {
      const batched = new Float64Array(count * 3);
      field.sampleAll?.(positions, velocities, count, 0.25, batched);

      const scalar = new Float64Array(count * 3);
      const position = new Vector3();
      const velocity = new Vector3();
      const out = new Vector3();
      for (let i = 0; i < count; i += 1) {
        const base = i * 3;
        position.set(positions[base], positions[base + 1], positions[base + 2]);
        velocity.set(
          velocities[base],
          velocities[base + 1],
          velocities[base + 2],
        );
        const sampled = field.sample(position, velocity, 0.25, out);
        scalar[base] += sampled.x;
        scalar[base + 1] += sampled.y;
        scalar[base + 2] += sampled.z;
      }
      expect(Array.from(batched)).toEqual(Array.from(scalar));
    }
  });

  it("an emitter with no fields allocates no accumulator work", () => {
    const withoutFields = run([]);
    expect(withoutFields.aliveCount).toBeGreaterThan(0);
  });

  it("resetting and replaying reproduces a batched run bit for bit (§33)", () => {
    const fields = [
      turbulenceField(5),
      volumeField(dragField(0.9), {
        shape: "sphere",
        center: new Vector3(0, 0, 0),
        radius: 4,
        falloff: 2,
      }),
    ];
    const emitter = new ParticleEmitter({
      maxParticles: 300,
      emissionRate: 150,
      seed: 42,
      lifetime: { min: 0.2, max: 0.6 },
      initialSpeed: { min: 1, max: 3 },
      spreadAngle: 0.8,
      gravity: new Vector3(0, -9.81, 0),
      fields,
    });
    for (let i = 0; i < 30; i += 1) {
      emitter.step(1 / 60);
    }
    const first = emitter.pool.positions.slice(0, emitter.pool.aliveCount * 3);
    emitter.reset();
    for (let i = 0; i < 30; i += 1) {
      emitter.step(1 / 60);
    }
    const second = emitter.pool.positions.slice(0, emitter.pool.aliveCount * 3);
    expect(Array.from(second)).toEqual(Array.from(first));
  });
});
