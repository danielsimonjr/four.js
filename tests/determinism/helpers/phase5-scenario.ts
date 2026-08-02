/**
 * The Phase 5 exit scenario (§20–§34 physics, §33 determinism, plan WP-5.8) —
 * one headless run of **two** solver worlds, a `"2d"` Rapier world and a `"3d"`
 * Rapier world, tracked on **one** `PhysicsSystem` inside **one**
 * `Application`, stepped 600 times (10 s at 1/60) and reduced to per-step
 * checksums plus the exact fixed-step indices at which every §29 event fired.
 *
 * §108's exit criterion is a *"mixed 2D/3D demo in which gravity, collisions,
 * impulses and sensors all go through one common API"*. `examples/physics-
 * playground` is that demo and `tests/browser/playground.spec.ts` is its gate;
 * the `tests/` suites of the two physics packages, plus
 * `tests/integration/physics-rapier.test.ts`,
 * cover behaviour. This module is the **determinism** half, and it is written
 * to be exactly the same *kind* of evidence as `phase1-scenario.ts`,
 * `phase2-scenario.ts` and `phase4-scenario.ts`: it builds an
 * {@link Application} (scene + fixed-step scheduler + §39 system registry;
 * nothing renderer-shaped is constructed or consulted, and no canvas or DOM is
 * touched), registers a `PhysicsSystem` (§39 step 6), drives 600 clean frames,
 * and checksums both worlds after every one.
 *
 * ## What each half of the scene is for (plan WP-5.8)
 *
 * The two halves are built by the *same* function ({@link buildHalf}) over the
 * two {@link DimensionKit} records, so the only thing that differs between the
 * plane simulation and the volume simulation is the solver and the shape names
 * — which is the §20 promise restated as code.
 *
 * | piece                    | §  | what it puts in the digest |
 * | ------------------------ | -- | -------------------------- |
 * | static floor + a 3-box stack | §22, §24 | resting contact, stacking, and the density-derived mass path (§23, §25 — none of the stack boxes authors a mass) |
 * | a dynamic ball dropped from height | §23 | free fall under Appendix A gravity, a bounce, and a settle |
 * | a scripted impulse on the ball at {@link IMPULSE_STEP} | §26 | the component command buffer: `RigidBody.applyImpulse` queued by host script, drained by the world at the top of the next step |
 * | a static **sensor** slab the ball falls through | §24, §29 | `triggerenter` / `triggerexit` on the *sensor collider's* emitter, at fixed steps the golden pins |
 * | a `"kinematic-position"` slab swept along X | §22 | the scene-authored kinematic target path (`syncSceneToSolver`), and the collisions it makes when it ploughs into the stack |
 *
 * ## The digest is §33's own checksum, not a re-derivation
 *
 * `PhysicsWorld.checksum()` *is* §33's definition — FNV-1a over every body's
 * transform and velocities, quantized to 1e-6, in ascending body id. This file
 * does not re-hash body state; it takes that uint32 from each world after every
 * fixed step and combines the pair with the same D6 hasher
 * (`@four/diagnostics`'s `createChecksum`) that phase 1, 2 and 4 use, in the
 * fixed order **2D then 3D**. So a per-step digest here is a hash of two
 * hashes, and the two raw sequences are published alongside it
 * ({@link Phase5ScenarioResult.checksums2d},
 * {@link Phase5ScenarioResult.checksums3d}) so a divergence can be localised to
 * a dimension as well as to a step.
 *
 * ## Clean frames, on purpose (as in WP-2.7 and WP-4.8)
 *
 * Every injected frame is exactly {@link FIXED_TIME_STEP} seconds, so the §10
 * accumulator runs exactly one fixed step per frame, drops nothing, and leaves
 * `interpolationAlpha` at 0. WP-1.14 already proved the ragged-frame path
 * reproduces bit-for-bit; what Phase 5 has to prove is that the *solvers* are a
 * pure function of the step count. Both facts are published
 * ({@link Phase5ScenarioResult.droppedTime},
 * {@link Phase5ScenarioResult.maximumInterpolationAlpha}).
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * Identical to WP-1.14/WP-2.7/WP-4.8, and for the same reason: the determinism
 * gate (plan §8) demands the same scenario run twice in-process **and** once in
 * a fresh `node` child process, and those runs are only evidence if they
 * execute the same code. So one file is loaded by Vitest (through Vite) and by
 * plain `node` (through its default type-stripping, Node ≥ 22.18; this repo
 * pins Node ≥ 20 and runs 22.22). The constraint that imposes: **this file must
 * stay within Node's erasable-syntax subset** — type annotations, `interface`,
 * `type`, and `import type` are fine; `enum`, `namespace`, constructor
 * parameter properties, and decorators are not.
 *
 * The extra constraint Phase 5 adds is **wasm**: both Rapier builds load their
 * WebAssembly image asynchronously, so {@link runPhase5Scenario} is `async` and
 * every world is `await world.initialize()`-ed before a single step is taken.
 * The child runner in `../phase5-physics.test.ts` awaits the returned promise
 * for the same reason. (Rapier's own loader writes one "using deprecated
 * parameters" notice per dimension to **stderr**; the child's stdout stays a
 * single clean JSON object, which is what that runner parses.)
 *
 * ## Self-contained on purpose (decision, WP-5.8)
 *
 * `tests/integration/helpers/physics-scenarios.ts` (WP-5.6) has the same
 * builder *patterns* and this file mirrors them, but it does not import them.
 * A golden is only evidence if the code that produced it is pinned: importing a
 * sibling packet's helper would let an unrelated edit to the integration rig
 * silently change what the golden means. `phase4-scenario.ts` is self-contained
 * for the same reason.
 *
 * ## `four/application`, not `four` (as in WP-4.8)
 *
 * The subpath import keeps the claim "no renderer is loaded" a property of the
 * import graph: `four/application` reaches `@four/core`, `@four/motion`,
 * `@four/scene` and one `import type` from `@four/render`, and the root barrel's
 * namespace re-export of every backend package is never pulled in.
 *
 * ## Determinism tier reached (§33)
 *
 * **`same-runtime`**, §33's stated initial target — see the golden's `_tier`
 * field and this scenario's own note in `../phase5-physics.test.ts`. Rapier is
 * compiled WebAssembly, so its arithmetic is fixed by the wasm image and does
 * not vary with the host JS engine's `Math`; what is *not* claimed is
 * cross-platform determinism, because the values still cross the JS/wasm
 * boundary as f64 → f32 conversions in this build, the wasm image itself is
 * pinned per platform by the package manager, and §33's `cross-platform` tier
 * requires evidence this suite does not gather.
 */

import { createChecksum } from "@four/diagnostics";
import { Vector2, Vector3 } from "@four/math";
import {
  Collider,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type CollisionShape,
  type PhysicsDimension,
  type PhysicsWorldAdapter,
} from "@four/physics";
import { Rapier2dAdapter, Rapier3dAdapter } from "@four/physics-rapier";
import { Group, type Node } from "@four/scene";
import { Application } from "four/application";

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
export const FIXED_TIME_STEP = 1 / 60;

/** Host-injected frames, each exactly {@link FIXED_TIME_STEP} long — 10 s. */
export const STEP_COUNT = 600;

/** 1-based fixed step at t = 1 s — the mid-run probe. */
export const PROBE_STEP_ONE_SECOND = 60;

/** 1-based fixed step at the end of the run — the second probe. */
export const PROBE_STEP_END = STEP_COUNT;

// ---------------------------------------------------------------------------
// The scene, in world units (§7a: Y is up in *both* dimensions)
// ---------------------------------------------------------------------------

/**
 * The static floor: 12 units wide, half a unit thick, centred so its **top
 * surface sits at y = 0**, which is the datum every number below is measured
 * from.
 */
export const FLOOR = {
  halfWidth: 6,
  halfHeight: 0.5,
  halfDepth: 6,
  centerY: -0.5,
};

/**
 * The three-box stack (§22 resting contact, §23 density-derived mass).
 *
 * The boxes start 0.03 apart rather than exactly touching, so the first steps
 * are a real settle rather than an initial-penetration recovery — the two look
 * quite different in a checksum sequence and only one of them is what §22 is
 * about.
 */
export const STACK = {
  centerX: -1.2,
  halfExtent: 0.3,
  /** Centre heights, bottom box first. */
  centerY: [0.35, 0.98, 1.61],
};

/**
 * The dropped ball. Its mass is **authored** (unlike the stack, which takes the
 * §23 density-derived path) so the {@link IMPULSE} below reads as `Δv = J / m`
 * rather than as a number only the solver knows.
 */
export const BALL = {
  centerX: 1.6,
  startY: 3,
  radius: 0.4,
  /** Kilograms (§23). */
  mass: 1,
  restitution: 0.2,
  friction: 0.6,
};

/**
 * The §24 sensor slab the ball falls through: it exerts no force, and its
 * collider emits §29's `triggerenter` / `triggerexit`.
 *
 * Placed on the ball's fall line and well clear of the floor, so the only
 * intersections it can ever report come from the dynamic ball.
 */
export const ZONE = {
  centerX: 1.6,
  centerY: 1.5,
  halfWidth: 0.8,
  halfHeight: 0.35,
  halfDepth: 0.8,
};

/**
 * The `"kinematic-position"` slab (§22): driven purely by its **node's**
 * transform, which host script rewrites before every frame, and therefore a
 * test of `PhysicsWorld`'s `syncSceneToSolver` path rather than of any solver
 * integration.
 *
 * It starts well left of the stack and sweeps right at a constant speed chosen
 * so that it reaches the stack (contact at x = −1.9, i.e. t = 7.75 s, step 465)
 * *after* the ball's drop, sensor crossing, settle and {@link IMPULSE} are all
 * over — one event at a time, in a fixed order — and so that it has moved only
 * 4 units by the last step, which keeps everything it pushes well inside the
 * floor rather than over its edge and out of the world.
 */
export const SWEEP = {
  startX: -5,
  centerY: 0.45,
  halfExtent: 0.4,
  /** Metres per second (§7a). */
  speed: 0.4,
};

/**
 * The scripted §26 impulse: newton-seconds applied to the ball at
 * {@link IMPULSE_STEP}, through `RigidBody.applyImpulse` — i.e. through the
 * §26 command buffer the world drains at the top of the *next* step.
 *
 * With the ball's authored 1 kg mass this is `Δv = (0.3, 4.5, 0)` m/s: a ~1.03 m
 * rise under Appendix A gravity, which carries it back up into the sensor zone
 * and out of it again. The lateral component is small and non-zero on purpose —
 * large enough that a dropped or transposed X would change the trigger steps,
 * small enough that the ball (which rolls, having no rolling resistance) is
 * still on the floor 400 steps later.
 */
export const IMPULSE = { x: 0.3, y: 4.5, z: 0 };

/** 1-based fixed step whose frame queues {@link IMPULSE}. */
export const IMPULSE_STEP = 200;

/** Bodies each half registers: floor, 3 stack boxes, ball, sensor, sweeper. */
export const BODIES_PER_HALF = 7;

// ---------------------------------------------------------------------------
// The two dimension kits (§21) — the only place the halves differ
// ---------------------------------------------------------------------------

/** Everything a half needs to be built once and run in both §21 dimensions. */
export interface DimensionKit {
  /** The §21 dimension this kit builds a world for. */
  readonly dimension: PhysicsDimension;
  /** `PhysicsSolverAdapter.name` of {@link DimensionKit.createAdapter}'s result. */
  readonly adapterName: string;
  /** A fresh, uninitialized Rapier adapter, typed as `PhysicsWorld` demands it. */
  createAdapter(): PhysicsWorldAdapter;
  /** A ball: §24's `circle` in 2D, `sphere` in 3D. */
  ball(radius: number): CollisionShape;
  /** A slab: §24's `rectangle` in 2D, `box` in 3D; `halfDepth` is ignored in 2D. */
  slab(
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): CollisionShape;
}

/** The 2D kit: `Rapier2dAdapter`, circles and rectangles (§21). */
export const KIT_2D: DimensionKit = {
  dimension: "2d",
  adapterName: "rapier2d",
  createAdapter(): PhysicsWorldAdapter {
    return new Rapier2dAdapter();
  },
  ball(radius: number): CollisionShape {
    return { type: "circle", radius };
  },
  slab(halfWidth: number, halfHeight: number): CollisionShape {
    return {
      type: "rectangle",
      halfExtents: new Vector2(halfWidth, halfHeight),
    };
  },
};

/** The 3D kit: `Rapier3dAdapter`, spheres and boxes (§21). */
export const KIT_3D: DimensionKit = {
  dimension: "3d",
  adapterName: "rapier3d",
  createAdapter(): PhysicsWorldAdapter {
    return new Rapier3dAdapter();
  },
  ball(radius: number): CollisionShape {
    return { type: "sphere", radius };
  },
  slab(
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): CollisionShape {
    return {
      type: "box",
      halfExtents: new Vector3(halfWidth, halfHeight, halfDepth),
    };
  },
};

/** Both kits, 2D first — the order the digest combines them in. */
export const DIMENSION_KITS: readonly DimensionKit[] = [KIT_2D, KIT_3D];

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** A position as plain numbers, so results survive JSON. */
export type Triple = readonly [number, number, number];

/** Where the two movable probes of one half are at one fixed step. */
export interface HalfSample {
  /** The dropped ball's node position. */
  ball: Triple;
  /** The stack's bottom box's node position. */
  stackBottom: Triple;
}

/** Both halves at one fixed step, 2D first. */
export interface Phase5Sample {
  twoD: HalfSample;
  threeD: HalfSample;
}

/**
 * The §29 event tallies of one half.
 *
 * Collision events are counted, not indexed: a settling stack produces hundreds
 * of them and a list would be unreadable evidence. Trigger events *are* indexed
 * — there are a handful and each one is a statement about when a sensor noticed
 * a body, which is exactly the sort of thing a hash cannot diagnose.
 */
export interface HalfEvents {
  /**
   * Total `collisionstart` callbacks observed, over listeners on **every** body
   * in the half.
   *
   * §29 dispatches a collision on both participants, so a pair of registered
   * bodies contributes 2 here. That is deliberate and uniform: counting per
   * listener rather than per pair keeps the number a direct measurement of what
   * user code actually saw.
   */
  collisionStartCount: number;
  /** Total `collisionend` callbacks observed, on the same terms. */
  collisionEndCount: number;
  /** 1-based fixed step of the first `collisionstart`, or 0 if there was none. */
  firstCollisionStartStep: number;
  /** 1-based fixed step of the last `collisionend`, or 0 if there was none. */
  lastCollisionEndStep: number;
  /** 1-based fixed steps on which the sensor collider fired `triggerenter`. */
  triggerEnterSteps: number[];
  /** 1-based fixed steps on which it fired `triggerexit`. */
  triggerExitSteps: number[];
  /** Total §32 `sleep` callbacks observed, over every body in the half. */
  sleepCount: number;
  /** Total §32 `wake` callbacks observed, over every body in the half. */
  wakeCount: number;
}

/** The values the golden file pins. */
export interface Phase5Summary {
  /** Checksum of all {@link STEP_COUNT} per-step digests, in step order. */
  summaryDigest: number;
  /** Combined digest after step 1. */
  firstStepDigest: number;
  /** Combined digest after step {@link STEP_COUNT}. */
  lastStepDigest: number;
  /** `world2d.checksum()` after step 1 — §33's own uint32, unwrapped. */
  firstChecksum2d: number;
  /** `world2d.checksum()` after step {@link STEP_COUNT}. */
  lastChecksum2d: number;
  /** `world3d.checksum()` after step 1. */
  firstChecksum3d: number;
  /** `world3d.checksum()` after step {@link STEP_COUNT}. */
  lastChecksum3d: number;
  /** The 2D half's §29 tallies and trigger step indices. */
  events2d: HalfEvents;
  /** The 3D half's. */
  events3d: HalfEvents;
}

/** Everything one scenario run produces; `summary` is the part under golden lock. */
export interface Phase5ScenarioResult {
  summary: Phase5Summary;
  /** One uint32 per fixed step: the D6 hash of (2D checksum, 3D checksum). */
  digests: number[];
  /** `world2d.checksum()` after every fixed step, in step order (§33). */
  checksums2d: number[];
  /** `world3d.checksum()` after every fixed step, in step order (§33). */
  checksums3d: number[];
  /** Probe at step {@link PROBE_STEP_ONE_SECOND}. */
  atOneSecond: Phase5Sample;
  /** Probe at step {@link PROBE_STEP_END}. */
  atEnd: Phase5Sample;
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
  /** §42 conflict warnings emitted during the drive loop; must be 0. */
  authorityWarningCount: number;
  /** Bodies registered in each world; both must be {@link BODIES_PER_HALF}. */
  bodyCount2d: number;
  bodyCount3d: number;
  /** Adapter names, so "two *different* solvers ran" is measured (§37). */
  adapterName2d: string;
  adapterName3d: string;
  /** Worlds tracked on the one `PhysicsSystem` (§39 step 6). */
  trackedWorlds: number;
  /** `PhysicsSystem.priority` (§39 step 6). */
  physicsPriority: number;
  /** The ball's solver-reported mass in each half — 1 kg, authored (§23). */
  ballMass2d: number;
  ballMass3d: number;
  /**
   * The stack bottom box's solver-derived mass in each half (§23, §25): area ×
   * density in 2D, volume × density in 3D, so the two legitimately differ.
   */
  stackMass2d: number;
  stackMass3d: number;
}

// ---------------------------------------------------------------------------
// Builders (the WP-5.6 rig's patterns, restated — see the module header)
// ---------------------------------------------------------------------------

/** A node plus the two §6a components a physics body is made of. */
interface BodyParts {
  readonly node: Node;
  readonly body: RigidBody;
  readonly collider: Collider;
}

/** How {@link addBody} authors one body. */
interface BodyOptions {
  name: string;
  x: number;
  y: number;
  /** Kilograms (§23); omitted to take the density-derived path (§25). */
  mass?: number;
  restitution?: number;
  friction?: number;
  sensor?: boolean;
}

/**
 * Registers one body with `world` and returns its node and components.
 *
 * The node carries no descriptor pose: `PhysicsWorld.addBody` reads the node's
 * local transform when the descriptor has none, which is the path an
 * application actually takes. §42 authority is `"physics"` for a dynamic body
 * (the solver owns its transform), `"kinematic"` for a position-driven
 * kinematic one (host script owns it and the world *reads* it), and `"manual"`
 * for a static one.
 */
function addBody(
  world: PhysicsWorld,
  scene: Node,
  type: "dynamic" | "static" | "kinematic-position",
  shape: CollisionShape,
  options: BodyOptions,
): BodyParts {
  const node = new Group();
  node.name = options.name;
  node.transform.position.set(options.x, options.y, 0);
  node.transformAuthority =
    type === "dynamic"
      ? "physics"
      : type === "kinematic-position"
        ? "kinematic"
        : "manual";

  const body = new RigidBody({
    type,
    ...(options.mass === undefined ? {} : { mass: options.mass }),
  });
  node.addComponent(body);
  const collider = new Collider({
    shape,
    ...(options.restitution === undefined
      ? {}
      : { restitution: options.restitution }),
    ...(options.friction === undefined ? {} : { friction: options.friction }),
    ...(options.sensor === undefined ? {} : { sensor: options.sensor }),
  });
  node.addComponent(collider);

  scene.add(node);
  world.addBody(node);
  return { node, body, collider };
}

/** One built half: the pieces the drive loop and the samplers need. */
interface Half {
  readonly kit: DimensionKit;
  readonly world: PhysicsWorld;
  readonly ball: BodyParts;
  readonly stackBottom: BodyParts;
  readonly sweeper: BodyParts;
  readonly events: HalfEvents;
}

/** A fresh, zeroed §29 tally. */
function emptyEvents(): HalfEvents {
  return {
    collisionStartCount: 0,
    collisionEndCount: 0,
    firstCollisionStartStep: 0,
    lastCollisionEndStep: 0,
    triggerEnterSteps: [],
    triggerExitSteps: [],
    sleepCount: 0,
    wakeCount: 0,
  };
}

/**
 * Subscribes one body to the four §29 names that belong to a body, feeding the
 * half's tally.
 *
 * `stepOf` is read *when an event arrives*, so every recorded index is the
 * 1-based fixed step the event was dispatched on — see
 * {@link runPhase5Scenario}.
 */
function watchBody(
  parts: BodyParts,
  events: HalfEvents,
  stepOf: () => number,
): void {
  parts.body.on("collisionstart", () => {
    events.collisionStartCount += 1;
    if (events.firstCollisionStartStep === 0) {
      events.firstCollisionStartStep = stepOf();
    }
  });
  parts.body.on("collisionend", () => {
    events.collisionEndCount += 1;
    events.lastCollisionEndStep = stepOf();
  });
  parts.body.on("sleep", () => {
    events.sleepCount += 1;
  });
  parts.body.on("wake", () => {
    events.wakeCount += 1;
  });
}

/**
 * Builds one half — floor, stack, ball, sensor zone and kinematic sweeper — in
 * `world`, and wires every §29 listener.
 *
 * Registration order is fixed and is part of the golden: §33's checksum visits
 * bodies in ascending solver id, which is creation order, so reordering these
 * calls changes every digest. It is written out once here rather than derived
 * from a table for exactly that reason.
 */
function buildHalf(
  world: PhysicsWorld,
  scene: Node,
  kit: DimensionKit,
  stepOf: () => number,
): Half {
  const events = emptyEvents();
  const watch = (parts: BodyParts): BodyParts => {
    watchBody(parts, events, stepOf);
    return parts;
  };

  watch(
    addBody(
      world,
      scene,
      "static",
      kit.slab(FLOOR.halfWidth, FLOOR.halfHeight, FLOOR.halfDepth),
      { name: `${kit.dimension}-floor`, x: 0, y: FLOOR.centerY, friction: 0.8 },
    ),
  );

  const stack: BodyParts[] = [];
  for (let i = 0; i < STACK.centerY.length; i += 1) {
    stack.push(
      watch(
        addBody(
          world,
          scene,
          "dynamic",
          kit.slab(STACK.halfExtent, STACK.halfExtent, STACK.halfExtent),
          {
            name: `${kit.dimension}-stack-${String(i)}`,
            x: STACK.centerX,
            y: STACK.centerY[i],
            // No `mass`: §23's density-derived path (§25), which is the one an
            // application takes by default and the one WP-5.2-fix1 made
            // reachable through the component API.
            restitution: 0,
            friction: 0.7,
          },
        ),
      ),
    );
  }

  const ball = watch(
    addBody(world, scene, "dynamic", kit.ball(BALL.radius), {
      name: `${kit.dimension}-ball`,
      x: BALL.centerX,
      y: BALL.startY,
      mass: BALL.mass,
      restitution: BALL.restitution,
      friction: BALL.friction,
    }),
  );

  const zone = watch(
    addBody(
      world,
      scene,
      "static",
      kit.slab(ZONE.halfWidth, ZONE.halfHeight, ZONE.halfDepth),
      {
        name: `${kit.dimension}-zone`,
        x: ZONE.centerX,
        y: ZONE.centerY,
        sensor: true,
      },
    ),
  );
  // §29 puts trigger events on the *sensor collider's* emitter, not the body's.
  zone.collider.on("triggerenter", () => {
    events.triggerEnterSteps.push(stepOf());
  });
  zone.collider.on("triggerexit", () => {
    events.triggerExitSteps.push(stepOf());
  });

  const sweeper = watch(
    addBody(
      world,
      scene,
      "kinematic-position",
      kit.slab(SWEEP.halfExtent, SWEEP.halfExtent, SWEEP.halfExtent),
      {
        name: `${kit.dimension}-sweeper`,
        x: SWEEP.startX,
        y: SWEEP.centerY,
        friction: 0.5,
      },
    ),
  );

  return { kit, world, ball, stackBottom: stack[0], sweeper, events };
}

/** A node's local position as plain numbers. */
function positionOf(parts: BodyParts): Triple {
  return [
    parts.node.transform.position.x,
    parts.node.transform.position.y,
    parts.node.transform.position.z,
  ];
}

/** One half's two probes right now. */
function sampleHalf(half: Half): HalfSample {
  return {
    ball: positionOf(half.ball),
    stackBottom: positionOf(half.stackBottom),
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * Runs the Phase 5 exit scenario once, from scratch, and returns its per-step
 * checksums, probe samples, and §29 event records.
 *
 * Every call in any process is independent: it builds its own `Application`,
 * its own two worlds on their own fresh Rapier adapters, and disposes all of
 * them before returning. Nothing is cached at module scope (the *wasm image*
 * is, inside `@four/physics-rapier`, which is a decoded module and not solver
 * state), so calling it twice in one process is a genuine second run rather
 * than a replay.
 *
 * ## How an event learns its step index
 *
 * `PhysicsSystem` steps the worlds and dispatches their queued events inside
 * the fixed step (§39 steps 6 and 9), and the application's `fixedUpdate` event
 * fires *after* every system ran — so the counter incremented there is one
 * behind while a listener is executing. `currentStep()` adds that one back,
 * which makes every recorded index the 1-based number of the step during which
 * the event was dispatched: the same numbering the digest array is indexed by.
 *
 * ## What the host script does between frames
 *
 * Two things, both pure functions of the step index and neither one reading a
 * clock or an RNG (§33):
 *
 * 1. the kinematic sweeper's node X is set to `startX + speed · t`, which is
 *    the §22 scene-authored target the world pushes into the solver;
 * 2. on frame {@link IMPULSE_STEP} the ball's §26 command buffer is given
 *    {@link IMPULSE}, which the world drains at the top of that same step.
 *
 * @returns the run's summary, per-step digests, probe samples, and statistics
 */
export async function runPhase5Scenario(): Promise<Phase5ScenarioResult> {
  const application = new Application({
    fixedTimeStep: FIXED_TIME_STEP,
    // Explicitly off: §43 pose capture is a *render* concern and render
    // interpolation never feeds back into physics state (§10, §43), so leaving
    // it out keeps this golden a statement about the solvers alone.
    poseInterpolation: false,
  });
  const scene = application.scene;

  const system = new PhysicsSystem();
  application.systems.register(system);

  // --- probes and hashing (§33, plan D6) -----------------------------------
  // Declared before the halves so the §29 listeners close over an
  // already-initialised counter rather than over one in its temporal dead zone.
  const digests: number[] = [];
  const checksums2d: number[] = [];
  const checksums3d: number[] = [];
  let fixedStepCount = 0;
  let maximumInterpolationAlpha = 0;
  let atOneSecond: Phase5Sample | null = null;
  let atEnd: Phase5Sample | null = null;

  /** The 1-based fixed step currently executing; see this function's header. */
  const currentStep = (): number => fixedStepCount + 1;

  await application.initialize();

  // --- the two worlds (§21, §37) -------------------------------------------
  // One `PhysicsSystem`, two worlds, two different solver adapters: the §20
  // promise that application code is written once and the dimension is a
  // world-level choice.
  const world2d = new PhysicsWorld({
    dimension: KIT_2D.dimension,
    adapter: KIT_2D.createAdapter(),
  });
  const world3d = new PhysicsWorld({
    dimension: KIT_3D.dimension,
    adapter: KIT_3D.createAdapter(),
  });
  // wasm loads here (once per dimension per process), before a single step.
  await world2d.initialize();
  await world3d.initialize();
  system.track(world2d);
  system.track(world3d);

  const half2d = buildHalf(world2d, scene, KIT_2D, currentStep);
  const half3d = buildHalf(world3d, scene, KIT_3D, currentStep);

  /** Both halves' probes right now. */
  function sample(): Phase5Sample {
    return { twoD: sampleHalf(half2d), threeD: sampleHalf(half3d) };
  }

  // `fixedUpdate` fires after every registered system ran for that step (§10,
  // §39), so a checksum here is over the finished state of the step it names.
  application.on("fixedUpdate", () => {
    fixedStepCount += 1;
    const checksum2d = world2d.checksum();
    const checksum3d = world3d.checksum();
    checksums2d.push(checksum2d);
    checksums3d.push(checksum3d);
    const combined = createChecksum();
    combined.addFloat(checksum2d);
    combined.addFloat(checksum3d);
    digests.push(combined.digest());
    if (fixedStepCount === PROBE_STEP_ONE_SECOND) {
      atOneSecond = sample();
    }
    if (fixedStepCount === PROBE_STEP_END) {
      atEnd = sample();
    }
  });

  application.on("update", (time) => {
    if (time.interpolationAlpha > maximumInterpolationAlpha) {
      maximumInterpolationAlpha = time.interpolationAlpha;
    }
  });

  // --- drive (§10) ---------------------------------------------------------
  // §42 conflict warnings go to `console.warn` with a `[four]` prefix; counting
  // them here turns "every transform is written by its one owner" into a
  // measured zero. Anything else — Rapier's own loader notices, for instance —
  // is passed through untouched. Restored in `finally` so a failure cannot leak
  // a patched console into the rest of the suite.
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
    application.start();
    for (let step = 1; step <= STEP_COUNT; step += 1) {
      // (1) §22: the kinematic sweeper's scene-authored target. `step - 1`
      // because this runs *before* the frame that will consume it, so the
      // first frame starts the sweeper exactly at `SWEEP.startX`.
      const sweepX = SWEEP.startX + SWEEP.speed * (step - 1) * FIXED_TIME_STEP;
      half2d.sweeper.node.transform.position.x = sweepX;
      half3d.sweeper.node.transform.position.x = sweepX;

      // (2) §26: the scripted impulse, queued on the component and drained by
      // the world at the top of this step.
      if (step === IMPULSE_STEP) {
        half2d.ball.body.applyImpulse(
          new Vector3(IMPULSE.x, IMPULSE.y, IMPULSE.z),
        );
        half3d.ball.body.applyImpulse(
          new Vector3(IMPULSE.x, IMPULSE.y, IMPULSE.z),
        );
      }

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
  const result: Phase5ScenarioResult = {
    summary: {
      summaryDigest: summaryChecksum.digest(),
      firstStepDigest: digests[0],
      lastStepDigest: digests[digests.length - 1],
      firstChecksum2d: checksums2d[0],
      lastChecksum2d: checksums2d[checksums2d.length - 1],
      firstChecksum3d: checksums3d[0],
      lastChecksum3d: checksums3d[checksums3d.length - 1],
      events2d: half2d.events,
      events3d: half3d.events,
    },
    digests,
    checksums2d,
    checksums3d,
    atOneSecond: atOneSecond ?? sample(),
    atEnd: atEnd ?? sample(),
    frameCount: STEP_COUNT,
    fixedStepCount,
    droppedTime: time.droppedTime,
    simulationTime: time.simulationTime,
    maximumInterpolationAlpha,
    authorityWarningCount,
    bodyCount2d: world2d.size,
    bodyCount3d: world3d.size,
    adapterName2d: world2d.adapter.name,
    adapterName3d: world3d.adapter.name,
    trackedWorlds: system.size,
    physicsPriority: system.priority,
    ballMass2d: half2d.ball.body.mass ?? 0,
    ballMass3d: half3d.ball.body.mass ?? 0,
    stackMass2d: half2d.stackBottom.body.mass ?? 0,
    stackMass3d: half3d.stackBottom.body.mass ?? 0,
  };

  world3d.dispose();
  world2d.dispose();
  application.dispose();
  return result;
}
