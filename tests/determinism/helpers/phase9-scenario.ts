/**
 * The Phase 9 determinism scenario (§112 exit, §36, §27, §33; plan §6h,
 * WP-9.4) — one headless run of a 100-particle emitter under §27 force fields
 * and §36's collision plane, stepped 600 times through the §39 registry,
 * reduced to per-step checksums plus two probe samples.
 *
 * §112's exit is about scale and rendering; plan P9-4 adds the determinism
 * requirement that makes the scale meaningful: *"§36 emitters use SeededRandom;
 * particle iteration insertion order; a determinism golden pins a 100-particle
 * scenario"*. This module is that sentence, executable. It builds an
 * {@link Application} (scene + fixed-step scheduler + §39 system registry —
 * nothing renderer-shaped is constructed, and no canvas or DOM is touched),
 * registers a `ParticleSystem`, tracks one emitter, drives 600 clean frames, and
 * checksums the whole live pool after every one.
 *
 * ## Why a `ParticleSystem` and not a bare `emitter.step` loop
 *
 * Because the wiring is part of what has to be deterministic, and because this
 * file is the **only** place in the repository that can check it at all. The
 * §3.1 dependency matrix keeps `@four/particles` from importing `@four/motion`,
 * so `ParticleSystem` implements §39's `SimulationSystem` *structurally* and
 * restates `PRIORITY_FORCES` as `PRIORITY_PARTICLES` (see
 * `packages/particles/src/particle-system.ts`). Nothing type-checks those two
 * declarations against each other — except here, where both packages are
 * importable: registering the system on a real `SystemRegistry` is the
 * assignability check, and {@link Phase9ScenarioResult.particlePriority} against
 * `@four/motion`'s own constant is the value check.
 *
 * ## What the scenario deliberately exercises
 *
 * | Phase 9 surface | how it is reached |
 * |---|---|
 * | seeded spawning (§33, §36) | `seed: 1337`, 4 draws per particle, a burst plus a rate |
 * | velocity distributions (§36) | a 0.55 rad cone with a speed range |
 * | over-lifetime ramps (§36) | size and RGBA both ramp, and both are hashed |
 * | §27 force fields | gravity, drag, vortex and turbulence, in declaration order |
 * | seeded procedural fields (§33) | `turbulenceField` driven by its own `SeededRandom` |
 * | §36 collision, MVP tier | `collisionPlaneY` with restitution — bounces happen |
 * | pool churn | lifetimes shorter than the run, so particles die and slots recycle |
 * | capacity saturation | `maxParticles: 100` with a rate that saturates it, so drops occur |
 * | §39 wiring | `ParticleSystem` registered on `app.systems`, stepped by the scheduler |
 * | fixed-step loop (§10) | 600 injected frames through `Application.step` |
 *
 * Saturation is deliberate. `emitter.ts` pins that a spawn which finds the pool
 * full is dropped *before* it draws, so `maxParticles` is part of the
 * determinism contract; a scenario that never filled its pool would not pin that
 * clause at all.
 *
 * ## Clean frames, on purpose
 *
 * Every injected frame is exactly {@link FIXED_TIME_STEP} seconds, so the §10
 * accumulator runs exactly one fixed step per frame, drops nothing, and leaves
 * `interpolationAlpha` at 0 — the arrangement WP-2.7 established and its
 * reasoning holds unchanged (WP-1.14 already proved the ragged-frame path
 * reproduces bit for bit; repeating it here would only re-test the scheduler).
 * Both facts are published so the test can assert them rather than trust them.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14's arrangement: the determinism gate demands the same
 * scenario run twice in-process **and** once in a fresh `node` child process,
 * and those runs are only evidence if they execute the same code. So one file is
 * loaded by Vitest (through Vite) and by plain `node` (through its default
 * type-stripping, Node ≥ 22.18; this repo pins Node ≥ 20 and runs 22.22). The
 * constraint that imposes: **this file must stay within Node's erasable-syntax
 * subset** — type annotations, `interface`, `type` and `import type` are fine;
 * `enum`, `namespace`, constructor parameter properties and decorators are not.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target. The RNG is exact (a uint32
 * LCG, `random.ts`), the iteration order is exact (ascending index, swap-remove
 * compaction), the field summation order is fixed, and the checksum (plan D6) is
 * exact and cross-platform. The *inputs* are runtime-bound: the spawn cone calls
 * `Math.cos`/`Math.sin`, the vortex and turbulence fields call `Math.sqrt` and
 * `Math.floor` over multiplied coordinates, and every channel is `Float32Array`
 * — so the last bits may legally differ between JS engines.
 */

import { createChecksum } from "@four/diagnostics";
import { PRIORITY_FORCES } from "@four/motion";
import {
  ParticleEmitter,
  ParticleRenderable,
  ParticleSystem,
  dragField,
  turbulenceField,
  uniformGravityField,
  vortexField,
} from "@four/particles";
import { Vector3, Vector4 } from "@four/math";
import { Application } from "four/application";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long. */
export const STEP_COUNT = 600;

/** Simulated seconds the run covers: `STEP_COUNT * FIXED_TIME_STEP`. */
export const SIMULATED_SECONDS = 10;

/** Plan P9-4's "100-particle scenario": the emitter's `maxParticles`. */
export const PARTICLE_CAPACITY = 100;

/** Seeded draws each successful spawn consumes (`PARTICLE_DRAWS_PER_SPAWN`). */
export const DRAWS_PER_SPAWN = 4;

/** 1-based fixed step at t = 1 s — the early probe. */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step at t = 10 s — the end-of-run probe. */
export const PROBE_STEP_END = 600;

/**
 * Every option of the emitter under golden lock, in one record so the test can
 * assert the scenario it thinks it is asserting.
 *
 * The rate saturates the pool: 90 particles/s against a mean lifetime of 1.4 s
 * is a steady state of ~126 against a capacity of 100, so the emitter runs full
 * and drops spawns for most of the run — which is exactly the clause of the
 * determinism contract a non-saturating scenario would leave untested.
 */
export const EMITTER = {
  maxParticles: PARTICLE_CAPACITY,
  seed: 1337,
  position: [0, 2.5, 0] as const,
  emissionRate: 90,
  burstCount: 40,
  lifetime: { min: 0.8, max: 2 },
  initialSpeed: { min: 2, max: 5 },
  spreadAngle: 0.55,
  size: { start: 0.5, end: 0.05 },
  collisionPlaneY: -1.5,
  restitution: 0.45,
  turbulenceSeed: 4242,
};

/** A position or colour as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/** One particle's full state at a probe step, as plain numbers. */
export interface ParticleSample {
  position: Triple;
  velocity: Triple;
  age: number;
  lifetime: number;
  /** The §36 ramp evaluated at this particle's normalized age. */
  size: number;
  /** The §36 colour ramp evaluated at this particle's normalized age. */
  color: readonly [number, number, number, number];
}

/** The pool at a probe step: the live count and its first three particles. */
export interface PoolProbe {
  aliveCount: number;
  emittedCount: number;
  droppedCount: number;
  particles: ParticleSample[];
}

/** The three numbers the golden file pins. */
export interface Phase9Summary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Digest after step 1. */
  firstStepDigest: number;
  /** Digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
  /** Particles spawned over the whole run. */
  emittedCount: number;
  /** Spawns refused because the pool was full (§36 `maxParticles`). */
  droppedCount: number;
  /** Live particles when the run ended. */
  finalAliveCount: number;
  /** Plane collisions detected over the run — see `countBounces`. */
  bounceCount: number;
  /** Largest live count seen at the end of any fixed step. */
  peakAliveCount: number;
}

/** Everything one scenario run produces; `summary` is the part under golden lock. */
export interface Phase9ScenarioResult {
  summary: Phase9Summary;
  /** One uint32 per fixed step, in step order: the whole live pool. */
  digests: number[];
  /**
   * One uint32 per fixed step over the renderable's repacked instance array.
   * Not under golden lock, but compared between runs — the presentation repack
   * must be as deterministic as the simulation it reads.
   */
  instanceDigests: number[];
  /** Pool at step {@link PROBE_STEP_ONE_SECOND} (t = 1 s). */
  atOneSecond: PoolProbe;
  /** Pool at step {@link PROBE_STEP_END} (t = 10 s). */
  atEnd: PoolProbe;
  /** Host frames driven (always {@link STEP_COUNT}). */
  frameCount: number;
  /** Fixed steps the scheduler actually ran (§10); must equal `frameCount`. */
  fixedStepCount: number;
  /** Simulation time discarded by the §10 sub-step clamp; must be 0 here. */
  droppedTime: number;
  /** Simulation time reached, in seconds. */
  simulationTime: number;
  /** Largest `interpolationAlpha` seen at frame end; 0 on clean frames (§10). */
  maximumInterpolationAlpha: number;
  /** §42 conflict warnings emitted during the run; must be 0. */
  authorityWarningCount: number;
  /** `ParticleSystem.priority` — §39 step 5. */
  particlePriority: number;
  /** `@four/motion`'s `PRIORITY_FORCES`, for the cross-package equality check. */
  forcesPriority: number;
  /** Systems registered on the application's §39 registry. */
  registeredSystemCount: number;
  /** Position in this emitter's seeded stream after the run (draws consumed). */
  randomStreamPosition: number;
}

/** `Vector3` from a {@link Triple}. */
function vec(t: Triple | readonly [number, number, number]): Vector3 {
  return new Vector3(t[0], t[1], t[2]);
}

/**
 * One particle's state, read through the pool's own accessors so the probe
 * reports exactly what a caller would see — including the ramp evaluations,
 * which are the pool's arithmetic and not a re-derivation.
 */
function sampleParticle(
  emitter: ParticleEmitter,
  index: number,
): ParticleSample {
  const pool = emitter.pool;
  const position = new Vector3();
  const velocity = new Vector3();
  pool.getPosition(index, position);
  pool.getVelocity(index, velocity);
  const color = pool.getColor(index, new Vector4());
  return {
    position: [position.x, position.y, position.z],
    velocity: [velocity.x, velocity.y, velocity.z],
    age: pool.getAge(index),
    lifetime: pool.getLifetime(index),
    size: pool.getSize(index),
    color: [color.x, color.y, color.z, color.w],
  };
}

/** The pool's live count plus its first three particles, in slot order. */
function probe(emitter: ParticleEmitter): PoolProbe {
  const pool = emitter.pool;
  const particles: ParticleSample[] = [];
  const limit = Math.min(3, pool.aliveCount);
  for (let i = 0; i < limit; i += 1) {
    particles.push(sampleParticle(emitter, i));
  }
  return {
    aliveCount: pool.aliveCount,
    emittedCount: emitter.emittedCount,
    droppedCount: emitter.droppedCount,
    particles,
  };
}

/**
 * Runs the Phase 9 determinism scenario once, from scratch, and returns its
 * checksums and probe samples.
 *
 * Every call in any process is independent: it builds its own `Application`,
 * its own emitter (and therefore its own RNG stream), its own fields, and
 * disposes the application before returning. Nothing is cached at module scope,
 * so calling it twice in one process is a genuine second run.
 */
export async function runPhase9Scenario(): Promise<Phase9ScenarioResult> {
  const application = new Application({ fixedTimeStep: FIXED_TIME_STEP });

  // --- the emitter (§36) ---------------------------------------------------
  // Four §27 fields, summed after `gravity` in exactly this declaration order.
  // Floating-point addition is not associative, so the order is a contract:
  // reordering these four lines changes every digest below, by design.
  const emitter = new ParticleEmitter({
    maxParticles: EMITTER.maxParticles,
    seed: EMITTER.seed,
    position: vec(EMITTER.position),
    emissionRate: EMITTER.emissionRate,
    bursts: [{ time: 0, count: EMITTER.burstCount }],
    lifetime: EMITTER.lifetime,
    initialSpeed: EMITTER.initialSpeed,
    // §7a: Y-up in both 2D and 3D, so a fountain points at +Y.
    direction: new Vector3(0, 1, 0),
    spreadAngle: EMITTER.spreadAngle,
    size: EMITTER.size,
    color: {
      start: { r: 1, g: 0.75, b: 0.25, a: 1 },
      end: { r: 0.2, g: 0.1, b: 0.8, a: 0 },
    },
    fields: [
      uniformGravityField(new Vector3(0, -9.81, 0)),
      dragField(0.4),
      vortexField(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 3, {
        minDistance: 0.25,
      }),
      // The one *procedural* field: it draws from its own SeededRandom, so it
      // pins §33's "no Math.random anywhere" for the generated case too.
      turbulenceField(EMITTER.turbulenceSeed, {
        amplitude: 2.5,
        frequency: 0.8,
      }),
    ],
    collisionPlaneY: EMITTER.collisionPlaneY,
    restitution: EMITTER.restitution,
  });

  // The renderable is in the scene for one reason: its repack is the
  // presentation half of the particle path, and it has to be as deterministic
  // as the simulation. Nothing renders — there is no renderer on this
  // application — so `updateParticleInstances()` is called explicitly below,
  // exactly as `buildRenderList` would.
  const renderable = new ParticleRenderable(emitter);
  renderable.name = "particles";
  application.scene.add(renderable);

  // --- systems (§39, plan D5) ----------------------------------------------
  const particles = new ParticleSystem();
  particles.track(emitter);
  application.systems.register(particles);

  // --- probes and hashing (§33, plan D6) -----------------------------------
  const digests: number[] = [];
  const instanceDigests: number[] = [];
  let fixedStepCount = 0;
  let maximumInterpolationAlpha = 0;
  let peakAliveCount = 0;
  let bounceCount = 0;
  let atOneSecond: PoolProbe | null = null;
  let atEnd: PoolProbe | null = null;

  // `fixedUpdate` fires after every registered system ran for that step (§10,
  // §39), so everything read here is the finished state of the step it names.
  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    const pool = emitter.pool;
    const count = pool.aliveCount;
    if (count > peakAliveCount) {
      peakAliveCount = count;
    }
    // A bounce is observable from outside the emitter: a particle sitting
    // exactly on the plane with non-negative vertical velocity was projected
    // there by the collision branch this step. Counted rather than digested, so
    // the golden carries a readable statement that collisions really happened.
    for (let i = 0; i < count; i += 1) {
      if (
        pool.positions[i * 3 + 1] === EMITTER.collisionPlaneY &&
        pool.velocities[i * 3 + 1] >= 0
      ) {
        bounceCount += 1;
      }
    }

    const checksum = createChecksum();
    // The whole live pool, channel by channel, in slot order — the §33 subject.
    checksum.addFloat(count);
    for (let i = 0; i < count; i += 1) {
      const base = i * 3;
      checksum.addFloat(pool.positions[base]);
      checksum.addFloat(pool.positions[base + 1]);
      checksum.addFloat(pool.positions[base + 2]);
      checksum.addFloat(pool.velocities[base]);
      checksum.addFloat(pool.velocities[base + 1]);
      checksum.addFloat(pool.velocities[base + 2]);
      checksum.addFloat(pool.ages[i]);
      checksum.addFloat(pool.lifetimes[i]);
      checksum.addFloat(pool.sizes[i * 2]);
      checksum.addFloat(pool.sizes[i * 2 + 1]);
      for (let c = 0; c < 8; c += 1) {
        checksum.addFloat(pool.colors[i * 8 + c]);
      }
    }
    digests.push(checksum.digest());

    // The presentation repack, over exactly the floats a backend would upload.
    renderable.updateParticleInstances();
    const instanceChecksum = createChecksum();
    const instances = renderable.particleInstances;
    const floats = renderable.particleCount * 8;
    for (let i = 0; i < floats; i += 1) {
      instanceChecksum.addFloat(instances[i]);
    }
    instanceDigests.push(instanceChecksum.digest());

    if (fixedStepCount === PROBE_STEP_ONE_SECOND) {
      atOneSecond = probe(emitter);
    }
    if (fixedStepCount === PROBE_STEP_END) {
      atEnd = probe(emitter);
    }
  });

  application.on("update", (time) => {
    if (time.interpolationAlpha > maximumInterpolationAlpha) {
      maximumInterpolationAlpha = time.interpolationAlpha;
    }
  });

  // --- drive (§10) ---------------------------------------------------------
  // §42 conflict warnings go to `console.warn`; counting them turns "nothing
  // fought over a transform" into a measured zero. Restored in `finally` so a
  // failure cannot leak a patched console into the rest of the suite.
  const originalWarn = console.warn;
  let authorityWarningCount = 0;
  console.warn = (...args: unknown[]): void => {
    if (typeof args[0] === "string" && args[0].startsWith("[four]")) {
      authorityWarningCount += 1;
      return;
    }
    originalWarn(...args);
  };

  try {
    await application.initialize();
    application.start();
    for (let step = 0; step < STEP_COUNT; step += 1) {
      application.step(FIXED_TIME_STEP);
    }
  } finally {
    console.warn = originalWarn;
  }

  const summaryChecksum = createChecksum();
  for (let i = 0; i < digests.length; i += 1) {
    // Digests are uint32s; `addFloat` quantizes by 1e6, so the largest possible
    // value maps to 4.29e15 — inside the 53-bit-safe range the hasher requires.
    summaryChecksum.addFloat(digests[i]);
  }

  const time = application.time;
  const emptyProbe: PoolProbe = {
    aliveCount: 0,
    emittedCount: 0,
    droppedCount: 0,
    particles: [],
  };
  const result: Phase9ScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      lastStepDigest: digests[digests.length - 1],
      emittedCount: emitter.emittedCount,
      droppedCount: emitter.droppedCount,
      finalAliveCount: emitter.particleCount,
      bounceCount,
      peakAliveCount,
    },
    digests,
    instanceDigests,
    atOneSecond: atOneSecond ?? emptyProbe,
    atEnd: atEnd ?? emptyProbe,
    frameCount: STEP_COUNT,
    fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    maximumInterpolationAlpha,
    authorityWarningCount,
    particlePriority: particles.priority,
    forcesPriority: PRIORITY_FORCES,
    registeredSystemCount: application.systems.size,
    // Every successful spawn consumes exactly four draws, so the stream
    // position is a second, independent statement about how many particles were
    // really created (`emitter.ts` pins the count and the order).
    randomStreamPosition: emitter.emittedCount * DRAWS_PER_SPAWN,
  };

  application.dispose();
  return result;
}
