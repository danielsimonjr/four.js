/**
 * `ParticleEmitter` — the CPU particle simulation (§36, plan P9-1, WP-9.1).
 *
 * ```ts
 * const emitter = new ParticleEmitter({
 *   maxParticles: 10000,
 *   seed: 1337,
 *   emissionRate: 500,                     // particles per second
 *   bursts: [{ time: 0, count: 100 }],
 *   lifetime: { min: 1, max: 3 },          // seconds (§7a)
 *   initialSpeed: { min: 2, max: 5 },
 *   direction: new Vector3(0, 1, 0),       // Y-up (§7a)
 *   spreadAngle: Math.PI / 8,              // radians, cone half-angle
 *   size: { start: 1, end: 0 },
 *   color: { start: { r: 1, g: 1, b: 1, a: 1 }, end: { r: 1, g: 0, b: 0, a: 0 } },
 *   gravity: new Vector3(0, -9.81, 0),
 *   fields: [wind],                        // §27, applied in this order
 *   collisionPlaneY: 0,
 *   restitution: 0.5,
 * });
 *
 * emitter.step(1 / 60, simulationTime);    // one fixed step (§10)
 * ```
 *
 * ## Scope — what §36 this is, and what it is not
 *
 * §36's option sketch is `{ maxParticles, simulation: "gpu", forces, collisions:
 * "depth-buffer" }` and its feature list runs to eleven items. Plan P9-1 pins
 * the MVP tier and this packet ships that tier:
 *
 * | §36 feature                 | WP-9.1                                        |
 * | --------------------------- | --------------------------------------------- |
 * | CPU simulation              | **ships** (this module)                       |
 * | emitters, lifetimes         | **ships**                                     |
 * | velocity distributions      | **ships** — seeded cone, speed range           |
 * | forces                      | **ships** — gravity + §27 fields (WP-9.2 implements the fields) |
 * | colour and size over lifetime | **ships** — two-stop linear ramp            |
 * | collision                   | **MVP tier** — `collisionPlaneY` only         |
 * | GPU compute simulation      | staged (2026-08-02, P9-1: needs the WebGPU backend, itself a §62 stub) |
 * | trails, attractors, custom data channels | staged (2026-08-02, P9-1): trails need a per-particle position-history channel (a ring buffer per slot) plus a ribbon render path — neither the SoA pool nor the "particles" render item carries history, and shipping a one-sample "trail" would be a lie; attractors are expressible today as a negative-strength {@link ../fields.js radialField}; custom data channels want a pool-layout extension API |
 *
 * `simulation: "gpu"` and `collisions: "depth-buffer"` are **not accepted
 * options** — their ABSENCE from `ParticleEmitterOptions` is the intended
 * "loud" rejection tier (a TS caller gets an excess-property error;
 * JSON-driven configuration arrives with Phase 11 serialization, which owns
 * runtime validation). Recorded 2026-08-02 (WP-9.1-fix3): type-level absence
 * is deliberate, not an oversight — an option that silently does nothing is
 * worse than one that does not exist yet. Rendering is WP-9.3; nothing in
 * this module draws, owns a node, or reads a clock.
 *
 * ## The step, in order (pinned, WP-9.1)
 *
 * `step(deltaSeconds, time)` does exactly this, in exactly this order:
 *
 * 1. **Simulate every live particle**, ascending index:
 *    1. acceleration = `gravity` + each field's `sample(...)`, **in declaration
 *       order**;
 *    2. **semi-implicit (symplectic) Euler**: `v += a·dt` then `p += v·dt`;
 *    3. plane collision, if `collisionPlaneY` is set;
 *    4. `age += dt`;
 *    5. if `age >= lifetime`, swap-remove it and re-process the slot (the swap
 *       moved an unprocessed particle in).
 * 2. **Spawn**: bursts whose time falls in `[elapsed, elapsed + dt)`, in
 *    declaration order, then the rate-driven emission for this step.
 * 3. `elapsed += dt`.
 *
 * Simulating before spawning is what gives the age invariant: **a particle's age
 * is exactly `dt` × the number of steps in which it was integrated**, so a
 * particle spawned during step *n* sits at its spawn position with age 0 at the
 * end of step *n*, and first moves in step *n + 1*. That is what makes the
 * closed forms below exact rather than off-by-one-step.
 *
 * ### The integrator, in closed form
 *
 * Semi-implicit Euler under a constant acceleration `g` from `(p₀, v₀)` gives,
 * after *n* steps of `dt`:
 *
 * ```text
 * vₙ = v₀ + n·g·dt
 * pₙ = p₀ + n·v₀·dt + g·dt²·(1 + 2 + … + n)
 *    = p₀ + v₀·t + ½·g·t·(t + dt)          with t = n·dt
 * ```
 *
 * — the continuous `p₀ + v₀t + ½gt²` plus a `½·g·t·dt` discretisation bias that
 * vanishes with `dt`. `tests/emitter.test.ts` pins this exactly; it is the
 * discrete truth, and rounding it to the continuous formula in a test would be
 * pretending the simulation is something it is not.
 *
 * Semi-implicit rather than explicit Euler because it is the engine's default
 * (`@four/motion`'s `DEFAULT_INTEGRATOR`) and does not pump energy into orbiting
 * particles under a radial field. It is **inlined here** rather than delegated to
 * `@four/motion`'s `semiImplicitEuler`: §3.1 gives particles no motion
 * dependency, and the inline form works on `Float32Array` lanes without boxing
 * each particle into an `IntegratorState`.
 *
 * ## Randomness and the per-particle draw order (pinned, WP-9.1)
 *
 * §33 forbids `Math.random`; every spawn draw comes from this emitter's own
 * {@link SeededRandom} (see `random.ts` for why the generator is a copy).
 *
 * **Each successfully spawned particle consumes exactly
 * {@link PARTICLE_DRAWS_PER_SPAWN} = 4 draws, always, in this order:**
 *
 * 1. `lifetime` — `nextRange(lifetime.min, lifetime.max)`
 * 2. `speed` — `nextRange(initialSpeed.min, initialSpeed.max)`
 * 3. cone azimuth `φ` — `nextRange(0, 2π)`
 * 4. cone polar `u` — `nextFloat01()`, mapped to `cos θ = 1 − u·(1 − cos spread)`
 *
 * The count and the order are **fixed, not conditional**: a zero `spreadAngle`
 * or a degenerate range still consumes its draws. That is deliberate — it means
 * widening a cone or changing a lifetime range shifts *those particles'* values
 * and nothing else's, instead of re-phasing the whole stream. Adding a fifth
 * draw later is a breaking change to every §33 golden, by design.
 *
 * Two consequences worth stating plainly:
 *
 * - **Draws are consumed only by *successful* spawns.** A spawn that finds the
 *   pool full is dropped before it draws (it is counted in
 *   {@link ParticleEmitter.droppedCount}). This keeps a saturated
 *   100 000-particle emitter from burning four RNG draws per dropped spawn every
 *   step — but it does mean **`maxParticles` is part of the determinism
 *   contract**: the same seed with a different capacity is a different stream
 *   once the pool saturates.
 * - **The stream is per emitter.** Nothing is module-level, so two emitters with
 *   the same seed reproduce each other regardless of what else the scene does.
 *
 * ## Determinism (§33)
 *
 * Same seed + same `(deltaSeconds, time)` sequence ⇒ **bit-identical pools**,
 * tested over 600 steps with spawns, deaths, fields, and bounces active. The
 * ingredients: a seeded stream, a fixed draw order, ascending-index iteration,
 * a fixed acceleration summation order (gravity, then fields in declaration
 * order — floating-point addition is not associative, so this is a contract and
 * not an implementation detail), and the pool's deterministic swap-remove
 * compaction (see `pool.ts`).
 *
 * ## Allocation (§7b, plan D7)
 *
 * **`step()` allocates nothing.** Three scratch `Vector3`s are built in the
 * constructor and reused: two carry the particle's position and velocity into
 * `ParticleForceField.sample`, one is the `out` it writes. Options are copied
 * into plain number fields and own arrays at construction, so no option object
 * is read on the hot path and later mutation of the caller's arrays cannot
 * change the simulation. Loops are indexed (`for (let i = …)`) rather than
 * `for…of`, which would allocate an iterator per loop.
 *
 * Consequence of the shared scratch: a `ParticleForceField.sample`
 * implementation must not re-enter the *same* emitter's `step()`. Nothing in the
 * engine does.
 */

import { Vector3 } from "@four/math";

import { ParticlePool } from "./pool.js";
import { SeededRandom } from "./random.js";
import type {
  ParticleBurst,
  ParticleColor,
  ParticleForceField,
  ParticleLifetimeRamp,
  ParticleRange,
} from "./types.js";

/** `2π`. */
const TAU = Math.PI * 2;

/**
 * Seeded draws consumed per successfully spawned particle — see the module note
 * on draw order. Exported so a test or a §33 golden can assert the stream
 * position instead of hard-coding `4`.
 */
export const PARTICLE_DRAWS_PER_SPAWN = 4;

/** Seed used when {@link ParticleEmitterOptions.seed} is omitted. */
export const DEFAULT_PARTICLE_SEED = 0;

/** Lifetime in seconds used when {@link ParticleEmitterOptions.lifetime} is omitted. */
export const DEFAULT_PARTICLE_LIFETIME_SECONDS = 1;

/** Size used at both ramp ends when {@link ParticleEmitterOptions.size} is omitted. */
export const DEFAULT_PARTICLE_SIZE = 1;

/** Restitution used when {@link ParticleEmitterOptions.restitution} is omitted. */
export const DEFAULT_PARTICLE_RESTITUTION = 0;

/**
 * §36 emitter options, MVP tier. Every field except `maxParticles` is optional;
 * the defaults are listed per field and are all constants, never clocks or
 * `Math.random` (§33).
 *
 * Options are read **once, in the constructor**. Runtime re-authoring
 * (`emitter.emissionRate = 20`) is **staged** (2026-08-02, WP-9.1): the derived
 * cone basis, the burst schedule, and the emission accumulator would all need
 * invalidation rules, and §36 gives none. Build a new emitter, or call
 * {@link ParticleEmitter.emit} for one-off bursts.
 */
export interface ParticleEmitterOptions {
  /**
   * Pool capacity — the most particles that can be live at once. A non-negative
   * safe integer. Spawns beyond it are dropped and counted
   * ({@link ParticleEmitter.droppedCount}); see the draw-order note for why this
   * value is part of the determinism contract.
   */
  readonly maxParticles: number;

  /**
   * Seed for this emitter's stream (§33). Default
   * {@link DEFAULT_PARTICLE_SEED} — a *constant*, so the default is still
   * reproducible; there is deliberately no clock- or entropy-derived default.
   */
  readonly seed?: number;

  /**
   * World position particles spawn at. Copied at construction; default the
   * origin. Not spec text — WP-9.1 addition, because an emitter that can only
   * spawn at the origin cannot be tested against a moving frame and scene
   * attachment does not arrive until WP-9.4.
   */
  readonly position?: Vector3;

  /**
   * Continuous emission in **particles per second**. Default `0`. Fractional
   * rates are honoured through an accumulator, so `2.5` emits 2, 3, 2, 3, …
   * across steps rather than truncating to 2.
   */
  readonly emissionRate?: number;

  /**
   * One-shot bursts, each fired the first time emitter-local elapsed time
   * reaches its `time`. Default none. Copied at construction; declaration order
   * is the firing order within a step.
   */
  readonly bursts?: readonly ParticleBurst[];

  /**
   * Lifetime range in seconds, drawn per particle. Default
   * `{ min: 1, max: 1 }`. Both bounds must be finite and `> 0`.
   */
  readonly lifetime?: ParticleRange;

  /**
   * Initial speed range in units/s along the spawn direction, drawn per
   * particle. Default `{ min: 0, max: 0 }`. Negative bounds are legal and mean
   * "backwards along the cone axis".
   */
  readonly initialSpeed?: ParticleRange;

  /**
   * Cone axis. Copied and normalized at construction; default `(0, 1, 0)` —
   * **+Y, because the world is Y-up in both 2D and 3D (§7a)**. A zero-length
   * direction falls back to `(0, 1, 0)` rather than throwing, so
   * `new Vector3()` is a usable default in authoring code.
   */
  readonly direction?: Vector3;

  /**
   * Cone **half-angle** in radians (§7a), in `[0, π]`. Default `0` — every
   * particle exactly along `direction`. `π/2` is a hemisphere, `π` the whole
   * sphere. Directions are uniform over the spherical cap, not over the angle.
   */
  readonly spreadAngle?: number;

  /**
   * Size at age 0 and at age = lifetime, linearly interpolated (§36 "size over
   * lifetime"). Default `{ start: 1, end: 1 }`.
   */
  readonly size?: ParticleLifetimeRamp<number>;

  /**
   * Straight RGBA at age 0 and at age = lifetime, linearly interpolated per
   * component (§36 "color over lifetime"). Default opaque white at both ends.
   */
  readonly color?: ParticleLifetimeRamp<ParticleColor>;

  /**
   * Constant acceleration in units/s² applied to every particle, e.g.
   * `(0, −9.81, 0)`. Copied at construction; default none (zero). Summed
   * **before** the fields.
   */
  readonly gravity?: Vector3;

  /**
   * §27 force fields, sampled once per particle per step and summed **in this
   * order**, after gravity. The array is copied at construction. WP-9.1 applies
   * fields; **WP-9.2 implements them** (see `types.ts`).
   */
  readonly fields?: readonly ParticleForceField[];

  /**
   * World `y` of an infinite horizontal collision plane, or omitted for no
   * collision (§36 collision, MVP tier — see
   * {@link ParticleEmitter.collisionPlaneY}).
   */
  readonly collisionPlaneY?: number;

  /**
   * Normal restitution of the collision plane: the fraction of downward speed
   * returned by a bounce. Default {@link DEFAULT_PARTICLE_RESTITUTION} (`0`,
   * i.e. the particle stops descending and slides). Values above `1` add energy
   * and are not rejected.
   */
  readonly restitution?: number;
}

/**
 * A seeded, fixed-capacity CPU particle emitter. See the module documentation
 * for the step order, the closed forms, the draw-order contract, and the
 * determinism and allocation guarantees.
 */
export class ParticleEmitter {
  /** The storage this emitter drives. Read it to render, inspect, or checksum. */
  readonly pool: ParticlePool;

  /** This emitter's seeded stream (§33). Exposed for §34-style snapshotting via `clone()`. */
  readonly random: SeededRandom;

  readonly #emissionRate: number;
  readonly #bursts: readonly ParticleBurst[];
  readonly #burstFired: Uint8Array;
  readonly #lifetimeMin: number;
  readonly #lifetimeMax: number;
  readonly #speedMin: number;
  readonly #speedMax: number;
  readonly #startSize: number;
  readonly #endSize: number;
  readonly #startColor: ParticleColor;
  readonly #endColor: ParticleColor;

  readonly #originX: number;
  readonly #originY: number;
  readonly #originZ: number;

  /** Normalized cone axis. */
  readonly #dirX: number;
  readonly #dirY: number;
  readonly #dirZ: number;

  /** First cone tangent — unit, perpendicular to the axis. */
  readonly #tanAX: number;
  readonly #tanAY: number;
  readonly #tanAZ: number;

  /** Second cone tangent — unit, `axis × tangentA`, completing a right-handed basis. */
  readonly #tanBX: number;
  readonly #tanBY: number;
  readonly #tanBZ: number;

  /** `cos(spreadAngle)`, precomputed for the cap mapping. */
  readonly #cosSpread: number;

  readonly #gravityX: number;
  readonly #gravityY: number;
  readonly #gravityZ: number;

  readonly #fields: readonly ParticleForceField[];

  readonly #hasPlane: boolean;
  readonly #planeY: number;
  readonly #restitution: number;

  /** Scratch handed to `ParticleForceField.sample` — never allocated per step. */
  readonly #samplePosition = new Vector3();
  readonly #sampleVelocity = new Vector3();
  readonly #sampleForce = new Vector3();

  #elapsedTime = 0;
  #emissionAccumulator = 0;
  #emittedCount = 0;
  #droppedCount = 0;

  /**
   * Validates and freezes the options into scalar fields, allocates the pool and
   * the scratch vectors, and seeds the stream. This is the only allocating
   * operation on the type.
   *
   * @throws RangeError on any out-of-domain option — see
   * {@link ParticleEmitterOptions} for each field's domain. Options are checked
   * eagerly because an emitter is authored once and stepped thousands of times:
   * a `NaN` lifetime should fail where it was written, not as an invisible
   * never-expiring particle ten seconds later.
   */
  constructor(options: ParticleEmitterOptions) {
    this.pool = new ParticlePool(options.maxParticles);
    this.random = new SeededRandom(options.seed ?? DEFAULT_PARTICLE_SEED);

    this.#emissionRate = assertFiniteAtLeast(
      options.emissionRate ?? 0,
      0,
      "emissionRate",
    );

    const bursts = options.bursts ?? [];
    const copiedBursts: ParticleBurst[] = [];
    for (let i = 0; i < bursts.length; i += 1) {
      const burst = bursts[i];
      assertFiniteAtLeast(burst.time, 0, `bursts[${String(i)}].time`);
      if (!Number.isSafeInteger(burst.count) || burst.count < 0) {
        throw new RangeError(
          `ParticleEmitter: bursts[${String(i)}].count must be a non-negative safe integer; received ${String(burst.count)}`,
        );
      }
      copiedBursts.push({ time: burst.time, count: burst.count });
    }
    this.#bursts = copiedBursts;
    this.#burstFired = new Uint8Array(copiedBursts.length);

    const lifetime = options.lifetime ?? {
      min: DEFAULT_PARTICLE_LIFETIME_SECONDS,
      max: DEFAULT_PARTICLE_LIFETIME_SECONDS,
    };
    this.#lifetimeMin = assertFiniteAbove(lifetime.min, 0, "lifetime.min");
    this.#lifetimeMax = assertFiniteAtLeast(
      lifetime.max,
      this.#lifetimeMin,
      "lifetime.max",
    );

    const speed = options.initialSpeed ?? { min: 0, max: 0 };
    this.#speedMin = assertFinite(speed.min, "initialSpeed.min");
    this.#speedMax = assertFiniteAtLeast(
      speed.max,
      this.#speedMin,
      "initialSpeed.max",
    );

    const size = options.size ?? {
      start: DEFAULT_PARTICLE_SIZE,
      end: DEFAULT_PARTICLE_SIZE,
    };
    this.#startSize = assertFinite(size.start, "size.start");
    this.#endSize = assertFinite(size.end, "size.end");

    const color = options.color;
    this.#startColor = copyColor(color?.start, "color.start");
    this.#endColor = copyColor(color?.end, "color.end");

    const origin = options.position;
    this.#originX = assertFinite(origin?.x ?? 0, "position.x");
    this.#originY = assertFinite(origin?.y ?? 0, "position.y");
    this.#originZ = assertFinite(origin?.z ?? 0, "position.z");

    // Cone basis, derived once. A zero-length direction falls back to +Y (§7a).
    const dx = assertFinite(options.direction?.x ?? 0, "direction.x");
    const dy = assertFinite(options.direction?.y ?? 1, "direction.y");
    const dz = assertFinite(options.direction?.z ?? 0, "direction.z");
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const axisX = length > 0 ? dx / length : 0;
    const axisY = length > 0 ? dy / length : 1;
    const axisZ = length > 0 ? dz / length : 0;
    this.#dirX = axisX;
    this.#dirY = axisY;
    this.#dirZ = axisZ;

    // tangentA = normalize(axis × e), where e is the world axis least aligned
    // with `axis` — that choice keeps the cross product well away from zero, and
    // being a pure function of `axis` keeps the basis reproducible (§33).
    const absX = Math.abs(axisX);
    const absY = Math.abs(axisY);
    const absZ = Math.abs(axisZ);
    let ex = 0;
    let ey = 0;
    let ez = 0;
    if (absX <= absY && absX <= absZ) {
      ex = 1;
    } else if (absY <= absZ) {
      ey = 1;
    } else {
      ez = 1;
    }
    const crossX = axisY * ez - axisZ * ey;
    const crossY = axisZ * ex - axisX * ez;
    const crossZ = axisX * ey - axisY * ex;
    const crossLength = Math.sqrt(
      crossX * crossX + crossY * crossY + crossZ * crossZ,
    );
    this.#tanAX = crossX / crossLength;
    this.#tanAY = crossY / crossLength;
    this.#tanAZ = crossZ / crossLength;
    // tangentB = axis × tangentA — already unit, since both are unit and
    // perpendicular.
    this.#tanBX = axisY * this.#tanAZ - axisZ * this.#tanAY;
    this.#tanBY = axisZ * this.#tanAX - axisX * this.#tanAZ;
    this.#tanBZ = axisX * this.#tanAY - axisY * this.#tanAX;

    const spreadAngle = assertFinite(options.spreadAngle ?? 0, "spreadAngle");
    if (spreadAngle < 0 || spreadAngle > Math.PI) {
      throw new RangeError(
        `ParticleEmitter: spreadAngle must be a cone half-angle in [0, π] radians (§7a); received ${String(spreadAngle)}`,
      );
    }
    this.#cosSpread = Math.cos(spreadAngle);

    this.#gravityX = assertFinite(options.gravity?.x ?? 0, "gravity.x");
    this.#gravityY = assertFinite(options.gravity?.y ?? 0, "gravity.y");
    this.#gravityZ = assertFinite(options.gravity?.z ?? 0, "gravity.z");

    this.#fields = options.fields === undefined ? [] : [...options.fields];

    const planeY = options.collisionPlaneY;
    this.#hasPlane = planeY !== undefined;
    this.#planeY =
      planeY === undefined ? 0 : assertFinite(planeY, "collisionPlaneY");
    this.#restitution = assertFiniteAtLeast(
      options.restitution ?? DEFAULT_PARTICLE_RESTITUTION,
      0,
      "restitution",
    );
  }

  /** Live particle count — `pool.aliveCount`. */
  get particleCount(): number {
    return this.pool.aliveCount;
  }

  /** Emitter-local time in seconds: the sum of every `deltaSeconds` stepped so far. */
  get elapsedTime(): number {
    return this.#elapsedTime;
  }

  /** Particles successfully spawned since construction or {@link ParticleEmitter.reset}. */
  get emittedCount(): number {
    return this.#emittedCount;
  }

  /**
   * Spawns that found the pool full and were discarded. A non-zero value means
   * `maxParticles` is smaller than `emissionRate × lifetime` — the honest signal
   * that the budget, not the authoring, is shaping the effect.
   */
  get droppedCount(): number {
    return this.#droppedCount;
  }

  /** Fractional remainder of the emission accumulator, in `[0, 1)`. */
  get emissionAccumulator(): number {
    return this.#emissionAccumulator;
  }

  /** Plane height for §36 MVP collision, or `undefined` when collision is off. */
  get collisionPlaneY(): number | undefined {
    return this.#hasPlane ? this.#planeY : undefined;
  }

  /**
   * Advances the simulation by `deltaSeconds` (§7a: seconds), sampling force
   * fields at absolute simulation time `time`.
   *
   * `time` defaults to {@link ParticleEmitter.elapsedTime}, which makes a
   * standalone emitter self-consistent; the §39 loop passes the simulation
   * clock instead. It is used **only** for field sampling — bursts and emission
   * are scheduled on emitter-local elapsed time, so an emitter behaves the same
   * whether it was created at simulation time 0 or 900.
   *
   * `deltaSeconds === 0` is a legal no-op step: nothing moves, nothing ages, no
   * burst window opens (the window `[elapsed, elapsed)` is empty) and the
   * accumulator gains nothing.
   *
   * @throws RangeError if `deltaSeconds` is not a finite number `>= 0`, or if
   * `time` is not finite. A negative step is rejected rather than run backwards:
   * ageing backwards would resurrect nothing (the particle is already gone) and
   * silently break the age invariant.
   */
  step(deltaSeconds: number, time: number = this.#elapsedTime): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError(
        `ParticleEmitter.step: deltaSeconds must be a finite number >= 0 (§7a: seconds); received ${String(deltaSeconds)}`,
      );
    }
    if (!Number.isFinite(time)) {
      throw new RangeError(
        `ParticleEmitter.step: time must be a finite number of seconds (§7a); received ${String(time)}`,
      );
    }

    this.#simulate(deltaSeconds, time);
    this.#emitBursts(deltaSeconds);
    this.#emitFromRate(deltaSeconds);
    this.#elapsedTime += deltaSeconds;
  }

  /**
   * Spawns up to `count` particles immediately, using the same draw order as
   * automatic emission, and returns how many were actually created (the rest are
   * counted as dropped).
   *
   * This is the §36 "burst" primitive exposed directly, for effects driven by
   * game events rather than by the burst schedule.
   *
   * @throws RangeError if `count` is not a non-negative safe integer.
   */
  emit(count: number): number {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(
        `ParticleEmitter.emit: count must be a non-negative safe integer; received ${String(count)}`,
      );
    }
    return this.#spawnMany(count);
  }

  /**
   * Returns the emitter to its just-constructed state: pool emptied, stream
   * rewound to its seed, elapsed time, accumulator, burst schedule, and counters
   * zeroed. Stepping a reset emitter with the same deltas reproduces the
   * original run bit for bit (§33, §34).
   */
  reset(): this {
    this.pool.clear();
    this.random.reset();
    this.#burstFired.fill(0);
    this.#elapsedTime = 0;
    this.#emissionAccumulator = 0;
    this.#emittedCount = 0;
    this.#droppedCount = 0;
    return this;
  }

  /** Step phase 1 — integrate, collide, age, expire. See the module step order. */
  #simulate(deltaSeconds: number, time: number): void {
    const pool = this.pool;
    const positions = pool.positions;
    const velocities = pool.velocities;
    const ages = pool.ages;
    const lifetimes = pool.lifetimes;
    const fields = this.#fields;
    const fieldCount = fields.length;

    let index = 0;
    while (index < pool.aliveCount) {
      const base = index * 3;

      let ax = this.#gravityX;
      let ay = this.#gravityY;
      let az = this.#gravityZ;

      if (fieldCount > 0) {
        const position = this.#samplePosition.set(
          positions[base],
          positions[base + 1],
          positions[base + 2],
        );
        const velocity = this.#sampleVelocity.set(
          velocities[base],
          velocities[base + 1],
          velocities[base + 2],
        );
        for (let f = 0; f < fieldCount; f += 1) {
          const sampled = fields[f].sample(
            position,
            velocity,
            time,
            this.#sampleForce,
          );
          ax += sampled.x;
          ay += sampled.y;
          az += sampled.z;
        }
      }

      // Semi-implicit Euler: velocity first, then position from the *new*
      // velocity.
      const vx = velocities[base] + ax * deltaSeconds;
      let vy = velocities[base + 1] + ay * deltaSeconds;
      const vz = velocities[base + 2] + az * deltaSeconds;
      const px = positions[base] + vx * deltaSeconds;
      let py = positions[base + 1] + vy * deltaSeconds;
      const pz = positions[base + 2] + vz * deltaSeconds;

      if (this.#hasPlane && py < this.#planeY) {
        // §36 collision, MVP tier: a position projection plus a normal-velocity
        // reflection, evaluated after the step. There is no time-of-impact
        // split, so the particle loses the sub-step distance it would have
        // travelled after the bounce, and no friction, so tangential velocity is
        // untouched. Both are documented approximations, not oversights: a
        // proper TOI split needs the collision solver coupling that P9-1 stages.
        py = this.#planeY;
        if (vy < 0) {
          vy = -vy * this.#restitution;
        }
      }

      velocities[base] = vx;
      velocities[base + 1] = vy;
      velocities[base + 2] = vz;
      positions[base] = px;
      positions[base + 1] = py;
      positions[base + 2] = pz;

      // Store first, then re-read: the expiry test must use the same float32
      // value `getAge` reports, not the unrounded binary64 sum.
      ages[index] = ages[index] + deltaSeconds;

      if (ages[index] >= lifetimes[index]) {
        // Swap-remove moves an as-yet-unprocessed particle into this slot, so
        // the index is deliberately not advanced (see `pool.ts` on ordering).
        pool.kill(index);
      } else {
        index += 1;
      }
    }
  }

  /** Step phase 2a — bursts whose time lies in `[elapsed, elapsed + dt)`. */
  #emitBursts(deltaSeconds: number): void {
    const bursts = this.#bursts;
    const from = this.#elapsedTime;
    const to = from + deltaSeconds;
    for (let i = 0; i < bursts.length; i += 1) {
      if (this.#burstFired[i] === 1) {
        continue;
      }
      const burst = bursts[i];
      if (burst.time >= from && burst.time < to) {
        this.#burstFired[i] = 1;
        this.#spawnMany(burst.count);
      }
    }
  }

  /** Step phase 2b — rate-driven emission through the fractional accumulator. */
  #emitFromRate(deltaSeconds: number): void {
    if (this.#emissionRate <= 0) {
      return;
    }
    this.#emissionAccumulator += this.#emissionRate * deltaSeconds;
    if (!Number.isFinite(this.#emissionAccumulator)) {
      // Only reachable when rate × dt overflows binary64 (both astronomically
      // large). Resetting keeps the accumulator from becoming a permanent NaN
      // that silently stops all emission; this step emits nothing.
      this.#emissionAccumulator = 0;
      return;
    }
    const whole = Math.floor(this.#emissionAccumulator);
    if (whole <= 0) {
      return;
    }
    this.#emissionAccumulator -= whole;
    this.#spawnMany(whole);
  }

  /**
   * Spawns `min(count, free capacity)` particles and counts the remainder as
   * dropped. The clamp is computed up front so a saturated emitter costs O(1)
   * rather than O(count).
   */
  #spawnMany(count: number): number {
    const free = this.pool.capacity - this.pool.aliveCount;
    const spawnable = count < free ? count : free;
    for (let i = 0; i < spawnable; i += 1) {
      this.#spawnOne();
    }
    this.#emittedCount += spawnable;
    this.#droppedCount += count - spawnable;
    return spawnable;
  }

  /**
   * Spawns exactly one particle, consuming exactly
   * {@link PARTICLE_DRAWS_PER_SPAWN} draws in the pinned order. The caller has
   * already guaranteed there is a free slot.
   */
  #spawnOne(): void {
    const random = this.random;
    // Draw order is a contract — see the module note. Do not reorder, do not
    // make a draw conditional.
    const lifetime = random.nextRange(this.#lifetimeMin, this.#lifetimeMax);
    const speed = random.nextRange(this.#speedMin, this.#speedMax);
    const azimuth = random.nextRange(0, TAU);
    const polar = random.nextFloat01();

    // Uniform over the spherical cap of half-angle `spreadAngle`: cos θ is
    // uniform in [cos spread, 1], which is Archimedes' theorem — sampling θ
    // uniformly instead would crowd the cone's axis.
    const cosTheta = 1 - polar * (1 - this.#cosSpread);
    const sinThetaSq = 1 - cosTheta * cosTheta;
    const sinTheta = sinThetaSq > 0 ? Math.sqrt(sinThetaSq) : 0;
    const cosAzimuth = Math.cos(azimuth);
    const sinAzimuth = Math.sin(azimuth);

    const dirX =
      this.#dirX * cosTheta +
      (this.#tanAX * cosAzimuth + this.#tanBX * sinAzimuth) * sinTheta;
    const dirY =
      this.#dirY * cosTheta +
      (this.#tanAY * cosAzimuth + this.#tanBY * sinAzimuth) * sinTheta;
    const dirZ =
      this.#dirZ * cosTheta +
      (this.#tanAZ * cosAzimuth + this.#tanBZ * sinAzimuth) * sinTheta;

    const index = this.pool.spawn();
    this.pool.setPosition(index, this.#originX, this.#originY, this.#originZ);
    this.pool.setVelocity(index, dirX * speed, dirY * speed, dirZ * speed);
    this.pool.setLifetime(index, lifetime);
    this.pool.setSize(index, this.#startSize, this.#endSize);
    this.pool.setColor(
      index,
      this.#startColor.r,
      this.#startColor.g,
      this.#startColor.b,
      this.#startColor.a,
      this.#endColor.r,
      this.#endColor.g,
      this.#endColor.b,
      this.#endColor.a,
    );
  }
}

/** Rejects a non-finite option. */
function assertFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `ParticleEmitter: ${name} must be a finite number; received ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a non-finite option or one below `bound`. */
function assertFiniteAtLeast(
  value: number,
  bound: number,
  name: string,
): number {
  if (!Number.isFinite(value) || value < bound) {
    throw new RangeError(
      `ParticleEmitter: ${name} must be a finite number >= ${String(bound)}; received ${String(value)}`,
    );
  }
  return value;
}

/** Rejects a non-finite option or one not strictly above `bound`. */
function assertFiniteAbove(value: number, bound: number, name: string): number {
  if (!Number.isFinite(value) || value <= bound) {
    throw new RangeError(
      `ParticleEmitter: ${name} must be a finite number > ${String(bound)}; received ${String(value)}`,
    );
  }
  return value;
}

/** Validates and copies a colour endpoint; `undefined` becomes opaque white. */
function copyColor(
  color: ParticleColor | undefined,
  name: string,
): ParticleColor {
  if (color === undefined) {
    return { r: 1, g: 1, b: 1, a: 1 };
  }
  return {
    r: assertFinite(color.r, `${name}.r`),
    g: assertFinite(color.g, `${name}.g`),
    b: assertFinite(color.b, `${name}.b`),
    a: assertFinite(color.a, `${name}.a`),
  };
}
