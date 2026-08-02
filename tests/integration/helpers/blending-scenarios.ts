/**
 * Shared builders and measurement for the §19 physics-animation blending
 * integration suite (WP-7.5): §19's four worked examples assembled from the
 * **public** API — `four/application` + `@four/animation` + `@four/physics` +
 * `@four/physics-rapier` — and driven through a real Rapier solver.
 *
 * This file is to Phase 7 what `joint-scenarios.ts` is to Phase 6, and it
 * builds on `physics-scenarios.ts` (WP-5.6) rather than restating it: the
 * {@link DimensionKit} pair, {@link createWorld}, {@link addGround},
 * {@link DT}, and the substepped free-fall closed forms all come from there.
 *
 * ## What this composition adds over the unit suites
 *
 * `packages/physics/tests/world-blend.test.ts` proves §19's pipeline against a
 * structural double, and `packages/animation/tests/{pose-target-binding,
 * root-motion}.test.ts` prove that a tween, a timeline, and a mixer can write a
 * `PoseTarget`. Neither half ever meets the other, and neither meets a solver.
 * What is only true of the composition — and therefore only testable here — is:
 *
 * 1. **Three systems in one §39 order.** {@link createBlendRig} registers
 *    `createPoseTargetCaptureSystem` (§39 step 3 − 1), `AnimationSystem` (step
 *    3), and `PhysicsSystem` (step 6) on one `Application`. The capture system
 *    is *not* registered by `Application` — §19's finite-difference history,
 *    and therefore `setBodyControlMode`'s velocity inheritance, exists only
 *    because an application wires it up.
 * 2. **A real solver on the other side of the blend.** The publish blends the
 *    target against a pose Rapier produced, not one a fake was told to hold.
 * 3. **§110's continuity criterion**, which is a statement about a *trajectory*
 *    across control-mode switches and has no meaning inside a single step.
 *
 * ## Conventions (plan §1)
 *
 * Y-up in both dimensions, radians, **seconds** everywhere, and no clock and no
 * `Math.random` in any scenario (§33): every run is `Application.step(DT)` with
 * a constant injected delta, and every animation is advanced by
 * `AnimationSystem` from that same delta.
 *
 * ## Why every hinge here is about +Z
 *
 * §19's second example is "a physically simulated door connected by a hinge",
 * and the packet asks it to *swing under gravity*. A front door's hinge is
 * parallel to gravity and therefore feels no gravitational torque at all — it
 * would sit still forever and measure nothing. Every hinged body below is
 * therefore hung about **+Z**, the one rotational freedom a `"2d"` world has
 * (§21) and the axis WP-6.4's pendulums already use, so the same mechanism runs
 * unchanged in both dimensions and gravity actually drives it. Physically these
 * are cat-flaps rather than front doors; §19's pipeline cannot tell the
 * difference, and the closed forms can.
 */

import { Quaternion, Vector3 } from "@four/math";
import {
  AnimationClip,
  AnimationMixer,
  AnimationSystem,
  AnimationTrack,
  Timeline,
  Tween,
  animate,
  tween,
  vector3Adapter,
  type AnimationTrackLike,
} from "@four/animation";
import {
  PRIORITY_ANIMATION_TARGETS,
  type SimulationSystem,
} from "@four/motion";
import {
  Collider,
  HingeJoint,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  createPoseTargetCaptureSystem,
  type BodyType,
  type CollisionShape,
} from "@four/physics";
import { Group, PoseTarget, type Node } from "@four/scene";
import { Application } from "four/application";

import {
  DT,
  GRAVITY_Y,
  addGround,
  createWorld,
  type DimensionKit,
  type PhysicsRig,
  type WorldOptions,
} from "./physics-scenarios.js";

/** Gravity's magnitude in m/s², the value every closed form below assumes. */
export const G = -GRAVITY_Y;

/** A quarter turn in radians (§7a: radians everywhere). */
export const HALF_PI = Math.PI / 2;

/** The one axis a `"2d"` world rotates about, and the axis every hinge uses. */
export const AXIS_Z = new Vector3(0, 0, 1);

/** A rotation of `angle` radians about +Z — planar in both dimensions (§21). */
export function spin(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(AXIS_Z, angle);
}

/**
 * The signed rotation about +Z carried by `rotation`, in radians.
 *
 * `q = (0, 0, sin(θ/2), cos(θ/2))` for a pure-Z rotation, so `θ = 2·atan2(z, w)`
 * — the same `atan2` form (rather than `2·asin`) `setBodyControlMode`'s velocity
 * inheritance uses, and for the same reason: it stays exact past a quarter turn.
 */
export function angleAboutZ(rotation: Quaternion): number {
  return 2 * Math.atan2(rotation.z, rotation.w);
}

/** The angle in radians between two unit quaternions, along the shortest arc. */
export function angleBetween(a: Quaternion, b: Quaternion): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, dot));
}

// --- the rig ----------------------------------------------------------------

/**
 * A {@link PhysicsRig} with §19's other two systems registered: the
 * `AnimationSystem` that writes pose targets (§39 step 3) and the
 * `createPoseTargetCaptureSystem` that shifts their history one step forward
 * just before it (§39 step 3 − 1).
 */
export interface BlendRig extends PhysicsRig {
  /** The §39 step-3 system every tween, timeline, and mixer here is tracked on. */
  readonly animation: AnimationSystem;
}

/** How {@link createBlendRig} wires §19's pipeline up. */
export interface BlendRigOptions {
  /**
   * Whether to register `createPoseTargetCaptureSystem`. Defaults to `true`.
   *
   * `false` builds the application `world.ts` warns about — the one that
   * registered `AnimationSystem` and `PhysicsSystem` but forgot the capture —
   * so the suite can measure what velocity inheritance actually reads when the
   * `PoseTarget` history is never shifted.
   */
  capturePoseTargets?: boolean;
}

/**
 * Builds and starts a headless application with §19's whole pipeline wired up.
 *
 * The registration order below is deliberately *not* the execution order — the
 * §39 registry sorts by priority regardless of when a system was registered —
 * and the capture system is handed `physics.worlds`, the system's own live
 * array, so a world created later is captured with nothing to keep in sync.
 */
export async function createBlendRig(
  options: BlendRigOptions = {},
): Promise<BlendRig> {
  const app = new Application({ fixedTimeStep: DT, poseInterpolation: true });
  const system = new PhysicsSystem();
  const animation = new AnimationSystem();

  app.systems.register(system);
  app.systems.register(animation);
  if (options.capturePoseTargets !== false) {
    app.systems.register(createPoseTargetCaptureSystem(system.worlds));
  }
  await app.initialize();
  app.start();

  const worlds: PhysicsWorld[] = [];
  return {
    app,
    system,
    animation,
    worlds,
    dispose(): void {
      for (let i = worlds.length - 1; i >= 0; i -= 1) {
        worlds[i].dispose();
      }
      worlds.length = 0;
      app.dispose();
    },
  };
}

/**
 * A world with §32 sleeping **off** by default, as WP-6.4's joint worlds are: a
 * body that falls asleep stops being blended in any way a measurement can see,
 * and a swinging door reaches Rapier's sleep threshold within a second.
 */
export async function createBlendWorld(
  rig: PhysicsRig,
  kit: DimensionKit,
  options: WorldOptions = {},
): Promise<PhysicsWorld> {
  return createWorld(rig, kit, { sleeping: { enabled: false }, ...options });
}

// --- blended bodies ---------------------------------------------------------

/** A node plus the three components §19's trio is made of (§19, §42, §6a). */
export interface BlendParts {
  /** The scene node, under `"blended"` authority unless overridden. */
  readonly node: Node;
  /** The §23 body carrying §19's two weights. */
  readonly body: RigidBody;
  /** The §24 collider, or `undefined` when the body carries none. */
  readonly collider: Collider | undefined;
  /** The §19 target pose animation writes, or `undefined` for a control body. */
  readonly target: PoseTarget | undefined;
}

/** How {@link addBlendedBody} authors one of §19's bodies. */
export interface BlendedBodyOptions {
  /** Node name, so an authority warning names something readable. */
  name?: string;
  /** §22 body type. Defaults to `"kinematic-position"` — §19's animated case. */
  type?: BodyType;
  /** World position of the node **origin**; Y is up in both dimensions (§7a). */
  position?: Vector3;
  /** Initial rotation of the node. Defaults to identity. */
  rotation?: Quaternion;
  /** Collider shape, or omitted for a body with no contact geometry (§24). */
  shape?: CollisionShape;
  /** Collider offset in the body's local frame (§24) — the door's hinge trick. */
  colliderOffset?: Vector3;
  /** §24 friction on the collider. */
  friction?: number;
  /** §24 restitution on the collider. */
  restitution?: number;
  /** Authored mass in kilograms (§23), or omitted to derive it from density. */
  mass?: number;
  /** §19's physics weight. Defaults to `0` — a fully animated body. */
  physicsWeight?: number;
  /** §19's animation weight. Defaults to `1`. */
  animationWeight?: number;
  /** §42 authority. Defaults to `"blended"`, which selects §19's pipeline. */
  authority?: Node["transformAuthority"];
  /**
   * Whether to attach a {@link PoseTarget} seeded from the node's transform.
   * Defaults to `true`; `false` builds the control bodies that run the same
   * mechanism under plain `"physics"` authority.
   */
  poseTarget?: boolean;
}

/**
 * Adds one of §19's bodies to `world` and returns its node and components.
 *
 * The `PoseTarget` is seeded with `copyFrom(node.transform)`, which is the
 * documented way in: it seeds the *history* as well, so the first fixed step
 * differences to zero instead of reading the seeding itself as motion.
 */
export function addBlendedBody(
  world: PhysicsWorld,
  options: BlendedBodyOptions = {},
): BlendParts {
  const node = new Group();
  if (options.name !== undefined) {
    node.name = options.name;
  }
  if (options.position !== undefined) {
    node.transform.position.copy(options.position);
  }
  if (options.rotation !== undefined) {
    node.transform.rotation.copy(options.rotation);
  }
  node.transformAuthority = options.authority ?? "blended";

  const body = new RigidBody({
    type: options.type ?? "kinematic-position",
    ...(options.mass === undefined ? {} : { mass: options.mass }),
  });
  body.physicsWeight = options.physicsWeight ?? 0;
  body.animationWeight = options.animationWeight ?? 1;
  node.addComponent(body);

  let collider: Collider | undefined;
  if (options.shape !== undefined) {
    collider = new Collider({
      shape: options.shape,
      ...(options.friction === undefined ? {} : { friction: options.friction }),
      ...(options.restitution === undefined
        ? {}
        : { restitution: options.restitution }),
    });
    if (options.colliderOffset !== undefined) {
      collider.offset.position.copy(options.colliderOffset);
    }
    node.addComponent(collider);
  }

  const target =
    options.poseTarget === false
      ? undefined
      : node.addComponent(new PoseTarget()).copyFrom(node.transform);

  world.addBody(node);
  return { node, body, collider, target };
}

/** {@link BlendParts} with the two members §19's pipeline requires present. */
export interface BlendedRig extends BlendParts {
  /** The §19 target pose; always present on a blended body. */
  readonly target: PoseTarget;
}

/** Narrows a {@link BlendParts} whose target the caller knows it asked for. */
export function requireTarget(parts: BlendParts): BlendedRig {
  if (parts.target === undefined) {
    throw new Error("this scenario body was built without a PoseTarget");
  }
  return { ...parts, target: parts.target };
}

// --- §19 example 1 / 2: the door --------------------------------------------

/** Half extents of every door below, in metres: a thin 1 m leaf. */
export const DOOR_HALF_WIDTH = 0.05;

/** Half height of the door leaf — the hinge-to-tip distance is `2 ×` this. */
export const DOOR_HALF_HEIGHT = 0.5;

/** Half depth of the 3D door leaf; ignored by the 2D rectangle (§21). */
export const DOOR_HALF_DEPTH = 0.4;

/** Where every door in this file hangs from, in world space. */
export const DOOR_PIVOT = new Vector3(0, 2, 0);

/** A door: a leaf hanging from a hinge, in whichever control mode §19 wants. */
export interface DoorRig extends BlendParts {
  /** World position of the hinge, which is also the node's **origin**. */
  readonly pivot: Vector3;
  /** The §28 hinge, when one was requested. */
  readonly joint: HingeJoint | undefined;
}

/** How {@link buildDoor} authors §19's door. */
export interface DoorOptions {
  /** §22 body type. Defaults to `"kinematic-position"` (§19's example 1). */
  type?: BodyType;
  /** Opening angle at build time, in radians about +Z. Defaults to `0`. */
  angle?: number;
  /** §19's physics weight. Defaults to `0`. */
  physicsWeight?: number;
  /** §19's animation weight. Defaults to `1`. */
  animationWeight?: number;
  /** §42 authority. Defaults to `"blended"`. */
  authority?: Node["transformAuthority"];
  /** Whether to attach a `PoseTarget`. Defaults to `true`. */
  poseTarget?: boolean;
  /** Whether to hinge the leaf to a static anchor with a §28 `HingeJoint`. */
  hinged?: boolean;
}

/**
 * Builds §19's door: a leaf whose **node origin is the hinge**, with the
 * collider pushed one half-height down by its §24 offset so the leaf hangs
 * below the pivot.
 *
 * That offset is the whole reason this rig is honest. A door animated by
 * rotating a node whose origin sits at the leaf's *centre* would have to
 * translate along an arc as well, and a `Tween` interpolates position along the
 * **chord** — at the 0.2 rad amplitude below that is a 2.5 mm constraint
 * violation the hinge would have to correct, which is exactly the kind of
 * solver-corrected jump §110's continuity criterion is trying to detect. With
 * the origin *at* the hinge, opening the door is a pure rotation: the animated
 * pose satisfies the constraint exactly, at every angle, with no tolerance
 * spent on the rig.
 *
 * The leaf's mass and inertia are derived by the solver from the collider's
 * density (§25); {@link doorPendulumPeriod} states the same geometry as a
 * closed form.
 */
export function buildDoor(
  world: PhysicsWorld,
  kit: DimensionKit,
  options: DoorOptions = {},
): DoorRig {
  const angle = options.angle ?? 0;
  const parts = addBlendedBody(world, {
    name: "door",
    type: options.type ?? "kinematic-position",
    position: DOOR_PIVOT,
    rotation: spin(angle),
    shape: kit.slab(DOOR_HALF_WIDTH, DOOR_HALF_HEIGHT, DOOR_HALF_DEPTH),
    colliderOffset: new Vector3(0, -DOOR_HALF_HEIGHT, 0),
    ...(options.physicsWeight === undefined
      ? {}
      : { physicsWeight: options.physicsWeight }),
    ...(options.animationWeight === undefined
      ? {}
      : { animationWeight: options.animationWeight }),
    ...(options.authority === undefined
      ? {}
      : { authority: options.authority }),
    ...(options.poseTarget === undefined
      ? {}
      : { poseTarget: options.poseTarget }),
  });

  let joint: HingeJoint | undefined;
  if (options.hinged === true) {
    const frame = new Group();
    frame.name = "door-frame";
    frame.transform.position.copy(DOOR_PIVOT);
    const anchorBody = new RigidBody({ type: "static" });
    frame.addComponent(anchorBody);
    world.addBody(frame);

    joint = new HingeJoint({
      bodyA: anchorBody,
      bodyB: parts.body,
      anchor: DOOR_PIVOT,
      axis: AXIS_Z,
    });
    world.addJoint(joint);
  }

  return { ...parts, pivot: DOOR_PIVOT, joint };
}

/**
 * Small-amplitude period of the hinged door {@link buildDoor} builds, in
 * seconds — a **compound** pendulum, not a point mass on a string.
 *
 * ```text
 * leaf half extents (hx, hy),  hinge at the top edge, pivot-to-centre d = hy
 * I_centre = m·((2hx)² + (2hy)²)/12 = m·(hx² + hy²)/3          (rectangle / box,
 *                                    about +Z; the depth does not enter Izz)
 * I_pivot  = I_centre + m·d²                                   (parallel axis)
 * ω₀²      = m·g·d / I_pivot = g·hy / ((hx² + hy²)/3 + hy²)
 * T₀       = 2π / ω₀
 * ```
 *
 * The mass cancels, so this holds for the 2D rectangle (mass = density × area)
 * and the 3D box (density × volume) alike — the two have different masses and
 * the same period, which the suite asserts.
 *
 * A pendulum released at `θ₀` swings slightly slower than `T₀`; the first-order
 * finite-amplitude correction is `T ≈ T₀·(1 + θ₀²/16)`, exactly as WP-6.4's
 * point pendulum needed it.
 */
export function doorPendulumPeriod(
  halfWidth = DOOR_HALF_WIDTH,
  halfHeight = DOOR_HALF_HEIGHT,
): number {
  const omegaSquared =
    (G * halfHeight) /
    ((halfWidth * halfWidth + halfHeight * halfHeight) / 3 +
      halfHeight * halfHeight);
  return (2 * Math.PI) / Math.sqrt(omegaSquared);
}

/** Duration of the door-opening timeline in seconds, and its swept angle. */
export const DOOR_OPEN_SECONDS = 1.5;

/** How far the animated door opens, in radians about +Z. */
export const DOOR_OPEN_ANGLE = HALF_PI;

/**
 * §19 example 1's driver: a `Timeline` holding one tween that rotates the
 * door's **`PoseTarget`** — never its transform, which under `"blended"`
 * authority belongs to §19's pipeline (§42).
 *
 * Returned unplayed-and-played: the timeline is already `play()`ed and tracked,
 * so the caller only steps the application.
 */
export function driveDoorOpen(rig: BlendRig, door: DoorRig): Timeline {
  const target = requireTarget(door).target;
  const timeline = new Timeline()
    .at(
      0,
      tween(target, { rotation: spin(DOOR_OPEN_ANGLE) }, DOOR_OPEN_SECONDS),
    )
    .play();
  rig.animation.track(timeline);
  return timeline;
}

/**
 * The closed form the animated door is compared against: the angle a linear
 * tween from identity to `spin(DOOR_OPEN_ANGLE)` holds after `steps` fixed
 * steps.
 *
 * `Tween` eases linearly by default and interpolates a quaternion by `slerp`,
 * and a slerp between two rotations about one axis is linear *in the angle* —
 * so the whole animation is `θ(t) = DOOR_OPEN_ANGLE · min(t / duration, 1)`
 * with no reference to the engine at all.
 */
export function doorAngleAt(steps: number): number {
  const progress = Math.min((steps * DT) / DOOR_OPEN_SECONDS, 1);
  return DOOR_OPEN_ANGLE * progress;
}

// --- §19 example 3: the commanded arm ---------------------------------------

/** Commanded speed of the arm along +X, in m/s (§23's authored velocity). */
export const ARM_COMMAND_SPEED = 0.6;

/** How far the arm's animated target lifts along +Y, in metres. */
export const ARM_LIFT = 0.9;

/** Duration of the arm's lift tween, in seconds. */
export const ARM_LIFT_SECONDS = 3;

/** §19's animation weight for the arm — "a small animation weight". */
export const ARM_ANIMATION_WEIGHT = 0.1;

/** A commanded arm plus the tween lifting its target. */
export interface ArmRig extends BlendedRig {
  /** The lift tween writing {@link BlendedRig.target}, already playing. */
  readonly lift: Tween;
}

/**
 * Builds §19 example 3: a `"kinematic-velocity"` body driven by §23's authored
 * velocities — the component fields `PhysicsWorld` feeds to
 * `setBodyVelocities` before every solve — with a small animation weight
 * blended over the top.
 *
 * `animationWeight` is `0` on a control body (`poseTarget: false`), which is
 * how the suite reads the pure solver pose the blend is combining against
 * without asking the world for it.
 */
export function buildCommandedArm(
  rig: BlendRig,
  world: PhysicsWorld,
  kit: DimensionKit,
  options: { blended?: boolean } = {},
): ArmRig {
  const blended = options.blended ?? true;
  const parts = addBlendedBody(world, {
    name: blended ? "arm" : "arm-control",
    type: "kinematic-velocity",
    position: new Vector3(0, 0, 0),
    shape: kit.ball(0.1),
    physicsWeight: blended ? 1 - ARM_ANIMATION_WEIGHT : 1,
    animationWeight: blended ? ARM_ANIMATION_WEIGHT : 0,
  });
  const arm = requireTarget(parts);
  arm.body.linearVelocity.set(ARM_COMMAND_SPEED, 0, 0);

  const lift = animate(arm.target)
    .to({ position: new Vector3(0, ARM_LIFT, 0) }, ARM_LIFT_SECONDS)
    .play();
  rig.animation.track(lift);
  return { ...arm, lift };
}

// --- §19 example 4: the ragdoll chain ---------------------------------------

/** Half extents of one chain link, in metres. */
export const LINK_HALF_EXTENTS = new Vector3(0.2, 0.08, 0.08);

/** Distance between neighbouring link centres, in metres (a 0.1 m gap). */
export const LINK_SPACING = 0.5;

/** How many links the chain has. */
export const LINK_COUNT = 3;

/** Height the chain is animated at, and therefore falls from, in metres. */
export const CHAIN_HEIGHT = 2;

/** A jointed chain of blended links. */
export interface ChainRig {
  /** The links, in registration order (§33). */
  readonly links: readonly BlendedRig[];
  /** The `LINK_COUNT − 1` hinges between them, about +Z. */
  readonly joints: readonly HingeJoint[];
}

/**
 * Builds §19 example 4's chain: `LINK_COUNT` boxes in a row, hinged to each
 * other about +Z, all `"kinematic-position"` and fully animated to start with.
 *
 * The chain is hinged **only to itself** — no static anchor — for a reason the
 * continuity criterion depends on: the animated phase below translates every
 * link by the *same* displacement, and a pure translation preserves every
 * relative distance and orientation, so every hinge stays exactly satisfied
 * throughout it. When the links are handed to the solver there is therefore no
 * accumulated constraint error for it to correct, and any jump the measurement
 * sees is a jump the blend produced rather than one the rig built in.
 */
export function buildChain(world: PhysicsWorld, kit: DimensionKit): ChainRig {
  const links: BlendedRig[] = [];
  for (let index = 0; index < LINK_COUNT; index += 1) {
    links.push(
      requireTarget(
        addBlendedBody(world, {
          name: `link-${String(index)}`,
          type: "kinematic-position",
          position: new Vector3(index * LINK_SPACING, CHAIN_HEIGHT, 0),
          shape: kit.slab(
            LINK_HALF_EXTENTS.x,
            LINK_HALF_EXTENTS.y,
            LINK_HALF_EXTENTS.z,
          ),
        }),
      ),
    );
  }

  const joints: HingeJoint[] = [];
  for (let index = 1; index < links.length; index += 1) {
    const joint = new HingeJoint({
      bodyA: links[index - 1].body,
      bodyB: links[index].body,
      anchor: new Vector3((index - 0.5) * LINK_SPACING, CHAIN_HEIGHT, 0),
      axis: AXIS_Z,
    });
    world.addJoint(joint);
    joints.push(joint);
  }
  return { links, joints };
}

/** Speed the animated chain is driven along +X at, in m/s. */
export const CHAIN_DRIVE_SPEED = 2;

/** Duration of the chain's drive tween in seconds — longer than the phase. */
export const CHAIN_DRIVE_SECONDS = 1;

/** How far the recovery tween lifts the fallen chain, in metres. */
export const CHAIN_LIFT = 0.6;

/** Duration of the recovery tween in seconds. */
export const CHAIN_RECOVER_SECONDS = 2;

/** Steps each phase of {@link runRagdollCycle} runs for. */
export interface RagdollPhases {
  /** Animated, `"kinematic-position"`, `animationWeight` 1. */
  readonly animated: number;
  /** Physical: `"dynamic"`, `physicsWeight` 1, after the first switch. */
  readonly physical: number;
  /** The weight sweep back to animation, one notch per step. */
  readonly sweep: number;
  /** Animated again, `"kinematic-position"`, after the second switch. */
  readonly kinematic: number;
}

/** The phase lengths every ragdoll run in this suite uses. */
export const RAGDOLL_PHASES: RagdollPhases = {
  animated: 30,
  physical: 150,
  sweep: 60,
  kinematic: 60,
};

/** Steps the +X travel comparison against the no-inheritance control spans. */
export const INHERITANCE_WINDOW = 30;

/**
 * The four variants of {@link runRagdollCycle} the suite compares.
 *
 * ## What a "no-inheritance control" can and cannot isolate (measured, WP-7.5)
 *
 * The packet asks for a control that shows velocity inheritance "visibly
 * seeding the collapse". Measured against Rapier 0.19.3, the plain
 * `inheritVelocity: false` run travels **exactly as far** as the inherited one
 * (1.000002 m either way, both dimensions), and the reason is a property of the
 * solver rather than of §19: a `"kinematic-position"` body that is being driven
 * to per-step targets *already carries the velocity Rapier derived from those
 * targets*, and `setBodyType` keeps it. On this path, §19's finite difference
 * and Rapier's own derivation agree — which is a cross-check worth having, but
 * not a difference.
 *
 * So the suite runs three controls instead of one, and states what each
 * isolates:
 *
 * | variant                     | what it shows                              |
 * | --------------------------- | ------------------------------------------ |
 * | `{}` (the §19 path)         | the collapse continues along +X             |
 * | `{ drive: false }`          | with no pre-switch motion there is none to continue — the chain drops straight down |
 * | `{ inheritVelocity: false }`| on a driven kinematic body the flag is redundant *on this solver* |
 * | `{ capturePoseTargets: false }` | the flag is nonetheless doing real work: with no history to difference it writes a velocity the solver would never have derived |
 */
export interface RagdollOptions {
  /** Pass `inheritVelocityFrom` at the activation. Defaults to `true`. */
  inheritVelocity?: boolean;
  /** Animate the chain along +X before the activation. Defaults to `true`. */
  drive?: boolean;
  /** Register the §19 history capture system. Defaults to `true`. */
  capturePoseTargets?: boolean;
  /** Phase lengths. Defaults to {@link RAGDOLL_PHASES}. */
  phases?: RagdollPhases;
}

/** Everything {@link runRagdollCycle} measured, as plain numbers. */
export interface RagdollRun {
  /** `world.checksum()` after every fixed step, in step order (§33). */
  readonly checksums: readonly number[];
  /**
   * Per-step displacement of the fastest link, in metres — index `i` is the
   * distance the worst link moved during step `i + 1`. §110's raw material.
   */
  readonly displacements: readonly number[];
  /** 1-based step at which the kinematic → dynamic switch first shows. */
  readonly activationStep: number;
  /** 1-based step at which the dynamic → kinematic switch first shows. */
  readonly retypeStep: number;
  /** 1-based step the weight sweep starts on. */
  readonly sweepStart: number;
  /** Target speed the activation inherited, in m/s (`|Δtarget| / DT`). */
  readonly inheritedSpeed: number;
  /** +X travel of link 0 over {@link INHERITANCE_WINDOW} steps after the switch. */
  readonly travelX: number;
  /** How far link 0 fell between the switch and the end of the physical phase. */
  readonly dropY: number;
  /** Link 0's Y at the end of the run, in metres. */
  readonly finalY: number;
  /** Link 0's Y at the moment of the second switch. */
  readonly retypeY: number;
}

/**
 * §19 example 4 and §110's exit criterion, end to end: an animated jointed
 * chain that is activated into a ragdoll, collapses physically, is blended back
 * onto its animation over a weight sweep, and is finally re-typed kinematic.
 *
 * The whole cycle runs on its own rig and disposes it, so it can be called
 * twice for §33's identical-runs check and once more with
 * `inheritVelocity: false` for the control the velocity-inheritance evidence is
 * measured against.
 *
 * ## The four phases, and the two control switches between them
 *
 * ```text
 * phase        steps  type                 weights (physics/animation)
 * animated     30     kinematic-position   0 / 1
 *   ── switch 1: setBodyControlMode("dynamic", { inheritVelocityFrom }) ──
 * physical     150    dynamic              1 / 0
 * sweep        60     dynamic              1−i/N / i/N        (i = 1 … N)
 *   ── switch 2: setBodyControlMode("kinematic-position") ──
 * kinematic    60     kinematic-position   0 / 1
 * ```
 *
 * Two details make the sweep continuous rather than a scripted teleport:
 *
 * 1. The two weights are set to `1 − w` and `w` rather than leaving
 *    `physicsWeight` at 1, because `normalizedWeights` divides by their sum —
 *    `(1, w)` would ramp the animation share as `w / (1 + w)`, which reaches
 *    only ½ at `w = 1`. Setting both makes the published share exactly `w`, so
 *    the sweep's per-step weight change is exactly `1/N`.
 * 2. Each target is re-seeded with `copyFrom(node.transform)` at the start of
 *    the sweep, so the animation the chain blends back onto **starts where the
 *    ragdoll actually landed**. Blending towards a target left over from before
 *    the collapse would be a metres-wide crossfade — bounded, but a rig
 *    decision rather than §19's, and it is not what a get-up animation does.
 *
 * Switch 2 is where the two poses genuinely differ: the solver body is still
 * lying where it fell while the target has lifted, so re-typing teleports the
 * *solver body* onto the target. It cannot teleport the *node*, because at that
 * point the published weight is already 1 and the node has been following the
 * target alone for one step — which is the whole reason the sweep comes first,
 * and precisely what the continuity measurement checks.
 */
export async function runRagdollCycle(
  kit: DimensionKit,
  options: RagdollOptions = {},
): Promise<RagdollRun> {
  const inheritVelocity = options.inheritVelocity ?? true;
  const drive = options.drive ?? true;
  const phases = options.phases ?? RAGDOLL_PHASES;
  const rig = await createBlendRig(
    options.capturePoseTargets === false ? { capturePoseTargets: false } : {},
  );
  try {
    const world = await createBlendWorld(rig, kit);
    addGround(world, kit);
    const chain = buildChain(world, kit);

    const trace = new PoseTrace(chain.links.map((link) => link.node));
    const checksums: number[] = [];
    trace.capture();
    const step = (): void => {
      rig.app.step(DT);
      trace.capture();
      checksums.push(world.checksum());
    };

    // Phase 1 — animated. One tween per link, all with the same displacement,
    // so the chain translates rigidly and every hinge stays satisfied.
    const driveTweens: Tween[] = [];
    if (drive) {
      for (const link of chain.links) {
        const end = link.target.position
          .clone()
          .add(new Vector3(CHAIN_DRIVE_SPEED * CHAIN_DRIVE_SECONDS, 0, 0));
        const moved = animate(link.target)
          .to({ position: end }, CHAIN_DRIVE_SECONDS)
          .play();
        rig.animation.track(moved);
        driveTweens.push(moved);
      }
    }
    for (let i = 0; i < phases.animated; i += 1) {
      step();
    }

    // Switch 1 — ragdoll activation (§19, §110).
    const first = chain.links[0].target;
    const inheritedSpeed =
      Math.hypot(
        first.position.x - first.previousPosition.x,
        first.position.y - first.previousPosition.y,
        first.position.z - first.previousPosition.z,
      ) / DT;
    for (const link of chain.links) {
      world.setBodyControlMode(
        link.node,
        "dynamic",
        inheritVelocity ? { inheritVelocityFrom: link.target } : {},
      );
      link.body.physicsWeight = 1;
      link.body.animationWeight = 0;
    }
    for (const moved of driveTweens) {
      moved.stop();
    }
    const activationStep = trace.sampleCount + 1;
    const xAtActivation = chain.links[0].node.transform.position.x;
    const yAtActivation = chain.links[0].node.transform.position.y;

    // Phase 2 — physical collapse.
    let travelX = Number.NaN;
    for (let i = 0; i < phases.physical; i += 1) {
      step();
      if (i + 1 === INHERITANCE_WINDOW) {
        travelX = chain.links[0].node.transform.position.x - xAtActivation;
      }
    }
    const dropY = yAtActivation - chain.links[0].node.transform.position.y;

    // Phase 3 — the sweep back onto the animation, from where the chain landed.
    for (const link of chain.links) {
      link.target.copyFrom(link.node.transform);
      const end = link.target.position
        .clone()
        .add(new Vector3(0, CHAIN_LIFT, 0));
      const recovery = animate(link.target)
        .to({ position: end }, CHAIN_RECOVER_SECONDS)
        .play();
      rig.animation.track(recovery);
    }
    const sweepStart = trace.sampleCount + 1;
    for (let i = 1; i <= phases.sweep; i += 1) {
      const weight = i / phases.sweep;
      for (const link of chain.links) {
        link.body.physicsWeight = 1 - weight;
        link.body.animationWeight = weight;
      }
      step();
    }

    // Switch 2 — back under kinematic control.
    const retypeY = chain.links[0].node.transform.position.y;
    for (const link of chain.links) {
      world.setBodyControlMode(link.node, "kinematic-position");
    }
    const retypeStep = trace.sampleCount + 1;
    for (let i = 0; i < phases.kinematic; i += 1) {
      step();
    }

    return {
      checksums,
      displacements: trace.stepDisplacements(),
      activationStep,
      retypeStep,
      sweepStart,
      inheritedSpeed,
      travelX,
      dropY,
      finalY: chain.links[0].node.transform.position.y,
      retypeY,
    };
  } finally {
    rig.dispose();
  }
}

// --- §19 root motion: the walker --------------------------------------------

/** Displacement one loop of the walk clip covers, in metres (§7a: Y-up). */
export const WALK_STRIDE = new Vector3(0.8, 0, 0);

/** Duration of one loop of the walk clip, in seconds. */
export const WALK_SECONDS = 1;

/** Half extents of the walker's body, in metres. */
export const WALKER_HALF_EXTENTS = new Vector3(0.2, 0.5, 0.2);

/** Half extents of the box the walker pushes, in metres. */
export const CRATE_HALF_EXTENTS = new Vector3(0.25, 0.25, 0.25);

/** Where the crate starts, in metres — squarely in the walker's path. */
export const CRATE_START_X = 1.8;

/**
 * Priority of {@link createTargetFollowSystem}: §39 step 3's animation
 * evaluation has to have run (the mixer accumulates root motion there) and the
 * solve at step 6 has to see the result, so anything strictly between the two
 * works. `PRIORITY_ANIMATION_TARGETS + 50` names that without pretending to be
 * one of §39's own steps.
 */
export const TARGET_FOLLOW_PRIORITY = PRIORITY_ANIMATION_TARGETS + 50;

/** One "copy this node's animated position onto that pose target" instruction. */
export interface TargetFollowLink {
  /** The node root motion moves — under §42 `"animation"` authority. */
  readonly source: Node;
  /** The §19 target the blended body is driven by. */
  readonly target: PoseTarget;
  /** Added to the source position; defaults to zero. Copied, not retained. */
  readonly offset?: Vector3;
}

/**
 * The application-side glue §19's root-motion example needs: a `SimulationSystem`
 * that copies each source node's animated position onto a `PoseTarget`, once per
 * fixed step, between animation and the solve.
 *
 * ## Why the engine cannot do this for you
 *
 * A mixer's root motion writes a node's **transform** under `"animation"`
 * authority (plan P7-5), and a blended body's transform belongs to §19's
 * pipeline (§42) — so the two cannot be the same node, and something has to
 * carry the locomotion across. That something is an application decision: how
 * much of the animated pose feeds the target, in what frame, with what offset,
 * is exactly the "kinematic controllers may modify the target" step §19 puts
 * between animation and the solve (step 2). This is the smallest possible such
 * controller, written the way plan D5 says features are added — a registered
 * system, not an edit to anyone's step.
 */
export function createTargetFollowSystem(
  links: readonly TargetFollowLink[],
  priority = TARGET_FOLLOW_PRIORITY,
): SimulationSystem {
  const resolved = links.map((link) => ({
    source: link.source,
    target: link.target,
    offset: link.offset?.clone() ?? new Vector3(0, 0, 0),
  }));
  return {
    priority,
    initialize(): void {
      // Nothing to set up: every node and target is supplied.
    },
    fixedUpdate(): void {
      for (const link of resolved) {
        link.target.position
          .copy(link.source.transform.position)
          .add(link.offset);
      }
    },
    dispose(): void {
      // Deliberately empty; the scene outlives the system.
    },
  };
}

/** The walker, its locomotion node, its mixer, and the crate it walks into. */
export interface WalkerRig {
  /** The blended, `"kinematic-position"` walker body. */
  readonly walker: BlendedRig;
  /** The node the mixer's root motion moves, under `"animation"` authority. */
  readonly locomotion: Node;
  /** The mixer playing the walk clip, already playing and tracked. */
  readonly mixer: AnimationMixer;
  /** The dynamic crate in the walker's path. */
  readonly crate: BlendParts;
}

/**
 * The walk clip: one `"rootMotion"` track ramping linearly from the origin to
 * {@link WALK_STRIDE} over {@link WALK_SECONDS}, so the sampled value at clip
 * time `t` is `WALK_STRIDE · t` and the closed form for the distance walked is
 * `WALK_STRIDE · elapsed / WALK_SECONDS` — with no reference to the mixer's
 * loop bookkeeping, which is the point of measuring it across several loops.
 */
export function walkClip(): AnimationClip {
  const track: AnimationTrackLike = new AnimationTrack({
    path: "rootMotion",
    adapter: vector3Adapter,
    times: [0, WALK_SECONDS],
    values: [new Vector3(0, 0, 0), WALK_STRIDE.clone()],
  });
  return new AnimationClip({
    name: "walk",
    tracks: [track],
    duration: WALK_SECONDS,
  });
}

/**
 * Builds the §19 root-motion scenario: a looping walk clip whose extracted
 * translation drives the `PoseTarget` of a `"kinematic-position"` blended body,
 * with a dynamic crate parked in its path.
 *
 * The walker's target is offset by the walker's own starting pose, so the
 * locomotion node's displacement — which starts at the origin — is *added* to
 * where the walker stands rather than replacing it.
 */
export function buildWalker(
  rig: BlendRig,
  world: PhysicsWorld,
  kit: DimensionKit,
): WalkerRig {
  const start = new Vector3(0, WALKER_HALF_EXTENTS.y, 0);
  const walker = requireTarget(
    addBlendedBody(world, {
      name: "walker",
      type: "kinematic-position",
      position: start,
      shape: kit.slab(
        WALKER_HALF_EXTENTS.x,
        WALKER_HALF_EXTENTS.y,
        WALKER_HALF_EXTENTS.z,
      ),
    }),
  );

  const crate = addBlendedBody(world, {
    name: "crate",
    type: "dynamic",
    position: new Vector3(CRATE_START_X, CRATE_HALF_EXTENTS.y, 0),
    shape: kit.slab(
      CRATE_HALF_EXTENTS.x,
      CRATE_HALF_EXTENTS.y,
      CRATE_HALF_EXTENTS.z,
    ),
    authority: "physics",
    poseTarget: false,
    physicsWeight: 1,
    animationWeight: 0,
  });

  const locomotion = new Group();
  locomotion.name = "locomotion";
  locomotion.transformAuthority = "animation";

  const mixer = new AnimationMixer(locomotion).play(walkClip(), {
    loop: Number.POSITIVE_INFINITY,
    rootMotion: { trackPath: "rootMotion", target: locomotion },
  });
  rig.animation.track(mixer);
  rig.app.systems.register(
    createTargetFollowSystem([
      { source: locomotion, target: walker.target, offset: start },
    ]),
  );

  return { walker, locomotion, mixer, crate };
}

/** Closed-form distance walked after `steps` fixed steps, in metres. */
export function walkedDistance(steps: number): number {
  return (WALK_STRIDE.x * (steps * DT)) / WALK_SECONDS;
}

// --- measurement ------------------------------------------------------------

/**
 * A per-fixed-step record of a set of nodes' poses, and the per-step
 * displacements §110's continuity criterion is stated over.
 *
 * Samples are taken by the caller — once before the first step and once after
 * every step — so sample `i` is the pose after step `i`, and the displacement
 * "during step `i`" is the distance between samples `i − 1` and `i`. Positions
 * and rotations are stored as flat numbers so nothing here aliases a live
 * transform.
 */
export class PoseTrace {
  readonly #nodes: readonly Node[];

  /** Sample `i`, flattened `[x, y, z, …]` per node. */
  readonly #positions: number[][] = [];

  /** Sample `i`, flattened `[x, y, z, w, …]` per node. */
  readonly #rotations: number[][] = [];

  constructor(nodes: readonly Node[]) {
    this.#nodes = [...nodes];
  }

  /** How many samples have been taken; sample 0 is the pre-run pose. */
  get sampleCount(): number {
    return this.#positions.length - 1;
  }

  /** Records every node's current pose. */
  capture(): void {
    const positions: number[] = [];
    const rotations: number[] = [];
    for (const node of this.#nodes) {
      const { position, rotation } = node.transform;
      positions.push(position.x, position.y, position.z);
      rotations.push(rotation.x, rotation.y, rotation.z, rotation.w);
    }
    this.#positions.push(positions);
    this.#rotations.push(rotations);
  }

  /**
   * The per-step displacement of the fastest node, in metres: entry `i` is the
   * largest distance any tracked node moved during step `i + 1`.
   */
  stepDisplacements(): number[] {
    const out: number[] = [];
    for (let sample = 1; sample < this.#positions.length; sample += 1) {
      const before = this.#positions[sample - 1];
      const after = this.#positions[sample];
      let worst = 0;
      for (let index = 0; index < this.#nodes.length; index += 1) {
        const base = index * 3;
        const distance = Math.hypot(
          after[base] - before[base],
          after[base + 1] - before[base + 1],
          after[base + 2] - before[base + 2],
        );
        worst = Math.max(worst, distance);
      }
      out.push(worst);
    }
    return out;
  }

  /**
   * The per-step rotation of the fastest-turning node, in radians: entry `i` is
   * the largest angle any tracked node turned through during step `i + 1`.
   */
  stepRotations(): number[] {
    const out: number[] = [];
    const before = new Quaternion();
    const after = new Quaternion();
    for (let sample = 1; sample < this.#rotations.length; sample += 1) {
      const from = this.#rotations[sample - 1];
      const to = this.#rotations[sample];
      let worst = 0;
      for (let index = 0; index < this.#nodes.length; index += 1) {
        const base = index * 4;
        before.set(from[base], from[base + 1], from[base + 2], from[base + 3]);
        after.set(to[base], to[base + 1], to[base + 2], to[base + 3]);
        worst = Math.max(worst, angleBetween(before, after));
      }
      out.push(worst);
    }
    return out;
  }

  /** Node `index`'s position at `sample`, as a fresh vector. */
  positionAt(sample: number, index = 0): Vector3 {
    const flat = this.#positions[sample];
    const base = index * 3;
    return new Vector3(flat[base], flat[base + 1], flat[base + 2]);
  }
}

/** The largest entry of `values`, or `0` for an empty range. */
export function maxOf(values: readonly number[]): number {
  let worst = 0;
  for (const value of values) {
    worst = Math.max(worst, value);
  }
  return worst;
}

/** The largest entry of `values` between the 0-based `from` and `to` (exclusive). */
export function maxBetween(
  values: readonly number[],
  from: number,
  to: number,
): number {
  return maxOf(values.slice(Math.max(0, from), Math.min(values.length, to)));
}

/**
 * Runs `steps` fixed steps of exactly `DT` each (§10), calling `after` with the
 * 1-based step index once each step has been simulated.
 */
export function runSteps(
  app: Application,
  steps: number,
  after?: (step: number) => void,
): void {
  for (let step = 1; step <= steps; step += 1) {
    app.step(DT);
    after?.(step);
  }
}
