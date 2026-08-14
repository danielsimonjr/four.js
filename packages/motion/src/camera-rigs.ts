/**
 * §44 camera rigs: {@link OrbitRig} (orbit) and {@link FollowRig} (follow target
 * and spring arm), the two placement components `ConstraintSystem` drives
 * (R-36 rig half, 2026-08-13).
 *
 * §44 lists seven rigs — orbit, fly, first-person, trackball, follow, spring
 * arm, shake. Two of them ship here, one of them is two of the seven, and the
 * rest are staged with reasons (see below). Both are **components** (§6a, plan
 * D2): a class with a `static readonly typeName`, one per node, attached with
 * `node.addComponent(...)`, holding no reference to the node it is on. All the
 * behaviour is one `apply` method that `ConstraintSystem` calls once per fixed
 * step under the §42 `"constraint"` authority.
 *
 * ```ts
 * const rig = camera.addComponent(new OrbitRig({ target: player, distance: 6 }));
 * camera.addComponent(new LookAtConstraint({ target: player }));
 * camera.transformAuthority = "constraint";       // §42 — required
 * constraints.track(camera);
 *
 * // …from wherever your input lives, in whatever units you sample it:
 * rig.orbit(dx * 0.005, -dy * 0.005);
 * rig.dolly(-wheel * 0.01);
 * ```
 *
 * ## A rig never reads input (decision, R-36 rig half)
 *
 * `orbit`, `dolly` and the `offset` vector are the whole input surface, and they
 * take **numbers the application feeds in**. The §3.1 dependency matrix is
 * frozen and gives `@four/motion` `core`, `math` and `scene` only — there is no
 * motion → input edge and adding one would invert the layering — so a rig
 * *cannot* read `@four/input` even if it wanted to. That constraint turns out to
 * be the right design: a rig whose only inputs are numbers is replayable
 * (§34) and testable without a device, and the mapping from a pointer delta to
 * radians is an application policy (sensitivity, inversion, acceleration) that
 * no engine default gets right for every game.
 *
 * ## What is deliberately still unshipped (§44)
 *
 * | rig | why it is not here |
 * |---|---|
 * | fly | two lines of application code over `orbit`/`dolly` once input is fed; a class would add API surface and no behaviour |
 * | first-person | writes a rotation, so it collides with `LookAtConstraint` for §42's single authority — it waits on §12's character controllers to settle aim-vs-free-look arbitration |
 * | trackball | defined in **screen space**, and `@four/motion` may not import `render` or `input` (§3.1); it belongs with the §47 `ScreenCamera` packet |
 * | shake | wants interpolated value noise, not per-step white noise, whose character would change with the fixed rate (§33); a packet of its own |
 * | stereo / XR | an extension point on the camera, not a rig that writes a transform |
 *
 * Two §44 rows are closed here **by composition** rather than by a class, which
 * §42 forces rather than merely permits:
 *
 * - **Path animation.** A camera flying a §13 trajectory while aiming at a
 *   subject is a path-driven parent under `"kinematic"` authority
 *   (`KinematicController.followPath`) carrying an aimed child under
 *   `"constraint"`. One node cannot be owned by two systems, so this is two
 *   nodes; `tests/integration/camera-rigs.test.ts` flies one.
 * - **Physics attachment.** A rig reads its target and writes only its own
 *   node, and `PRIORITY_CONSTRAINTS` (700) is after `PRIORITY_PHYSICS_SOLVE`
 *   (600), so a rig following a rigid body already sees the pose the solver
 *   wrote this step.
 *
 * ## Determinism (§33)
 *
 * No clock (every step takes its `deltaSeconds` from the injected `TimeState`),
 * no `Math.random`, no hash-ordered iteration, and no per-step allocation. The
 * transcendental calls on the path — `sin`, `cos`, `sqrt`, and `exp` inside
 * `SpringDamper` — put these rigs at §33's **same-runtime** tier, exactly like
 * every other floating-point feature in the engine; `Math.sqrt` is used rather
 * than `Math.hypot` because only `sqrt` is specified exactly rounded.
 */

import type { Component, ComponentHost } from "@four/core";
import { Vector3 } from "@four/math";
import { resolveWorldTransform, type Node } from "@four/scene";

import {
  placeAtWorldPosition,
  resolveTargetPosition,
  worldPositionOf,
  type RigTarget,
} from "./rig-target.js";
import type {
  SpringDamper,
  SpringDamperVector3Result,
} from "./spring-damper.js";

/**
 * Default bound on {@link OrbitRig.pitch}, in radians: `π/2 − 1e-3`, just short
 * of the pole.
 *
 * The pole itself is exactly the configuration `Node.lookAt` refuses with the
 * default `+Y` up (§85: an aim parallel to `up` leaves the roll undetermined),
 * so an orbit rig that could reach `±π/2` would produce a camera that throws the
 * moment it looked at its own pivot. One milliradian short is invisible — about
 * 0.06° of tilt, a few millimetres of framing at ordinary distances — and it
 * keeps the cross product that fixes the roll non-zero by a comfortable margin
 * rather than by one ULP.
 *
 * A rig that genuinely wants to pass over the pole passes its own `minPitch`
 * and `maxPitch` **and** gives its `LookAtConstraint` an `up` that is not
 * parallel to the aim there.
 */
export const DEFAULT_ORBIT_PITCH_LIMIT = Math.PI / 2 - 1e-3;

/**
 * Default {@link OrbitRig.minDistance}: one millimetre in §7a's metres.
 *
 * Exported for `ORBIT_RIG_SERIALIZER`, which must restore the same default a
 * document that omits the field was written under, but deliberately not
 * re-exported from the package barrel: it is the class's default, and the class
 * is where an application reads it.
 *
 * Zero is not available — a camera at its own pivot has no direction to look
 * along, which is the other half of `Node.lookAt`'s §85 refusal — and any
 * positive floor is arbitrary, so this one is chosen to sit below every
 * distance a camera rig means while still being a distance rather than an
 * epsilon.
 */
export const DEFAULT_ORBIT_MIN_DISTANCE = 1e-3;

/** Throws unless `value` is a finite number. */
function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${what} must be a finite number (§85); received ${String(value)}`,
    );
  }
}

/** Throws unless `value` is a finite number `> 0`. */
function assertPositive(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${what} must be a finite number > 0 (§85); received ${String(value)}`,
    );
  }
}

/** Options for {@link OrbitRig} (§44 orbit). */
export interface OrbitRigOptions {
  /** What the rig orbits. Defaults to nothing, which makes the rig idle. */
  target?: RigTarget;
  /** Initial {@link OrbitRig.yaw}, in radians. Default `0`. */
  yaw?: number;
  /** Initial {@link OrbitRig.pitch}, in radians; clamped. Default `0`. */
  pitch?: number;
  /** Initial {@link OrbitRig.distance}, in metres; clamped. Default `1`. */
  distance?: number;
  /** Lower pitch bound. Default `−`{@link DEFAULT_ORBIT_PITCH_LIMIT}. */
  minPitch?: number;
  /** Upper pitch bound. Default {@link DEFAULT_ORBIT_PITCH_LIMIT}. */
  maxPitch?: number;
  /** Closest approach to the target. Finite and `> 0`. Default `1e-3`. */
  minDistance?: number;
  /** Furthest retreat. `Infinity` (the default) means unbounded. */
  maxDistance?: number;
}

/**
 * §44's orbit rig: a node placed on a sphere around a target, by yaw, pitch and
 * distance.
 *
 * ```text
 * position = target + distance · (cos pitch · sin yaw, sin pitch, cos pitch · cos yaw)
 * ```
 *
 * so `yaw = 0, pitch = 0` puts the node on the target's `+Z` side, facing it
 * along `−Z` once a `LookAtConstraint` aims it — the §7a right-handed, `+Y`-up
 * world, with yaw measured about `+Y` from `+Z` towards `+X` and pitch the
 * elevation above the horizontal plane.
 *
 * **Placement only.** This rig writes a position and never a rotation, because
 * §42 allows one owner per transform and aiming is a separate, optional
 * component: pair it with a `LookAtConstraint` on the same node (the usual
 * orbit camera) or leave it unaimed (a node that circles while keeping its
 * orientation).
 *
 * ## Limits are readonly, values clamp on assignment
 *
 * `minPitch`/`maxPitch`/`minDistance`/`maxDistance` are fixed at construction —
 * `SpringDamper`'s rule, for the same reason: they are the rig's shape, a
 * retuned rig is a new one, and a limit that could change under a live value
 * would make "is this rig inside its limits?" a question with a time-dependent
 * answer. {@link OrbitRig.pitch} and {@link OrbitRig.distance} clamp **on
 * assignment**, so the rig is never in an illegal state and the per-step path
 * carries no clamping branch at all; {@link OrbitRig.pitchLimitHits} counts how
 * often a clamp actually bit, which is how a test proves the pole guard was
 * exercised rather than merely present.
 *
 * Non-finite assignments are refused (§85) rather than clamped: `NaN` is not a
 * value at the end of a range, and a rig that quietly swallowed one would place
 * its camera at `NaN` on some later step instead of at the mistake.
 */
export class OrbitRig implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "orbit-rig";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * What the rig orbits, or `null` for an idle rig — one that writes nothing,
   * and therefore raises no §42 conflict on a node it does not own.
   *
   * Assignable at any time: a `Node` target is held by reference (dropped by
   * §79, re-bound by the application), a `Vector3` target is held, not copied.
   */
  target: RigTarget | null;

  /** Times a pitch assignment was clamped by {@link OrbitRig.minPitch}/`maxPitch`. */
  pitchLimitHits = 0;

  /** Steps on which the rig declined to place its node — see {@link OrbitRig.apply}. */
  skippedSteps = 0;

  /** Lower bound on {@link OrbitRig.pitch}, in radians (§7a). */
  readonly minPitch: number;

  /** Upper bound on {@link OrbitRig.pitch}, in radians (§7a). */
  readonly maxPitch: number;

  /** Closest the rig may come to its target, in metres. Finite and `> 0`. */
  readonly minDistance: number;

  /** Furthest the rig may retreat, in metres. `Infinity` means unbounded. */
  readonly maxDistance: number;

  /** Backing store for {@link OrbitRig.yaw}. */
  #yaw: number;

  /** Backing store for {@link OrbitRig.pitch}; always inside the limits. */
  #pitch: number;

  /** Backing store for {@link OrbitRig.distance}; always inside the limits. */
  #distance: number;

  /** World-space placement scratch, so stepping allocates nothing (D7). */
  readonly #pivot = new Vector3();

  /**
   * @throws RangeError if any angle or distance is not finite, if a distance is
   * not positive, or if a lower bound exceeds its upper bound (§85).
   */
  constructor(options: OrbitRigOptions = {}) {
    const minPitch = options.minPitch ?? -DEFAULT_ORBIT_PITCH_LIMIT;
    const maxPitch = options.maxPitch ?? DEFAULT_ORBIT_PITCH_LIMIT;
    const minDistance = options.minDistance ?? DEFAULT_ORBIT_MIN_DISTANCE;
    const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
    assertFinite(minPitch, "OrbitRigOptions.minPitch");
    assertFinite(maxPitch, "OrbitRigOptions.maxPitch");
    assertPositive(minDistance, "OrbitRigOptions.minDistance");
    if (minPitch > maxPitch) {
      throw new RangeError(
        `OrbitRigOptions.minPitch must not exceed maxPitch (§85); received ${String(minPitch)} > ${String(maxPitch)}`,
      );
    }
    // `Infinity` is the one non-finite value a *maximum* distance may take: it
    // is the honest spelling of "unbounded", and no arithmetic ever multiplies
    // by it — the clamp only compares against it.
    if (Number.isNaN(maxDistance) || maxDistance < minDistance) {
      throw new RangeError(
        `OrbitRigOptions.maxDistance must be a number >= minDistance (§85); received ${String(maxDistance)} against a minDistance of ${String(minDistance)}`,
      );
    }
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;

    const yaw = options.yaw ?? 0;
    const pitch = options.pitch ?? 0;
    const distance = options.distance ?? 1;
    assertFinite(yaw, "OrbitRigOptions.yaw");
    assertFinite(pitch, "OrbitRigOptions.pitch");
    assertPositive(distance, "OrbitRigOptions.distance");
    this.#yaw = yaw;
    this.#pitch = 0;
    this.#distance = 0;
    this.pitch = pitch;
    this.distance = distance;
    // The construction clamps are the rig's initial state, not user error the
    // way a live clamp is: a rig authored outside its own limits starts on them
    // with a clean counter.
    this.pitchLimitHits = 0;
    this.target = options.target ?? null;
  }

  /**
   * Rotation about `+Y`, in radians (§7a), measured from `+Z` towards `+X`.
   * Unbounded — a camera may be spun any number of turns, and wrapping it would
   * make `orbit` discontinuous at the seam.
   *
   * @throws RangeError if the value is not finite (§85).
   */
  get yaw(): number {
    return this.#yaw;
  }

  set yaw(value: number) {
    assertFinite(value, "OrbitRig.yaw");
    this.#yaw = value;
  }

  /**
   * Elevation above the horizontal plane, in radians (§7a), clamped to
   * `[minPitch, maxPitch]` on assignment — a clamp bumps
   * {@link OrbitRig.pitchLimitHits}.
   *
   * @throws RangeError if the value is not finite (§85).
   */
  get pitch(): number {
    return this.#pitch;
  }

  set pitch(value: number) {
    assertFinite(value, "OrbitRig.pitch");
    const clamped = Math.min(this.maxPitch, Math.max(this.minPitch, value));
    if (clamped !== value) {
      this.pitchLimitHits += 1;
    }
    this.#pitch = clamped;
  }

  /**
   * Distance from the target, in metres (§7a), clamped to
   * `[minDistance, maxDistance]` on assignment.
   *
   * @throws RangeError if the value is not finite (§85).
   */
  get distance(): number {
    return this.#distance;
  }

  set distance(value: number) {
    assertFinite(value, "OrbitRig.distance");
    this.#distance = Math.min(
      this.maxDistance,
      Math.max(this.minDistance, value),
    );
  }

  /**
   * Adds `yawDelta` and `pitchDelta` radians to the rig's angles — the input
   * surface an application maps a pointer drag onto.
   *
   * Both go through the property setters, so the pitch clamp and its counter
   * apply and a non-finite delta is refused rather than stored.
   */
  orbit(yawDelta: number, pitchDelta: number): void {
    this.yaw = this.#yaw + yawDelta;
    this.pitch = this.#pitch + pitchDelta;
  }

  /**
   * Adds `delta` metres to {@link OrbitRig.distance}: **positive pulls back**,
   * negative moves in. Clamped like any other assignment, so a wheel spun to
   * the stop leaves the rig sitting exactly on its limit.
   */
  dolly(delta: number): void {
    this.distance = this.#distance + delta;
  }

  /**
   * Places `node` on its orbit around the target. Called by `ConstraintSystem`
   * once per fixed step, after the §42 authority check.
   *
   * @returns `true` when the node was placed. `false` — and a bumped
   * {@link OrbitRig.skippedSteps} — when the target's world position is not
   * finite or the node's parent has no invertible world matrix; a target of
   * `null` is idle, so it returns `false` without counting a skip.
   */
  apply(node: Node): boolean {
    const target = this.target;
    if (target === null) {
      return false;
    }
    const pivot = this.#pivot;
    if (!resolveTargetPosition(target, pivot)) {
      this.skippedSteps += 1;
      return false;
    }
    const radius = this.#distance * Math.cos(this.#pitch);
    if (
      !placeAtWorldPosition(
        node,
        pivot.x + radius * Math.sin(this.#yaw),
        pivot.y + this.#distance * Math.sin(this.#pitch),
        pivot.z + radius * Math.cos(this.#yaw),
      )
    ) {
      this.skippedSteps += 1;
      return false;
    }
    return true;
  }
}

/** Which frame {@link FollowRig.offset} is expressed in. */
export type FollowFrame = "world" | "target";

/** Options for {@link FollowRig} (§44 follow rig and spring arm). */
export interface FollowRigOptions {
  /** What the rig follows. Defaults to nothing, which makes the rig idle. */
  target?: RigTarget;
  /** Offset from the target; **copied**. Default `(0, 0, 0)`. */
  offset?: Vector3;
  /** Frame {@link FollowRig.offset} is read in. Default `"world"`. */
  frame?: FollowFrame;
  /** Smoother for the placement; omitted means the rig snaps. Held by reference. */
  spring?: SpringDamper;
}

/**
 * §44's follow rig **and** spring arm: a node held at an offset from a target,
 * optionally smoothed.
 *
 * ```ts
 * // A chase camera 4 m behind and 2 m above the player, critically damped:
 * camera.addComponent(
 *   new FollowRig({
 *     target: player,
 *     offset: new Vector3(0, 2, 4),
 *     frame: "target",
 *     spring: new SpringDamper({ frequencyHz: 2, dampingRatio: 1 }),
 *   }),
 * );
 * ```
 *
 * ## One class, two §44 rows (decision, R-36 rig half)
 *
 * §44 names "follow rigs" and "spring arms" separately, and they differ in
 * exactly two independent bits: which frame the offset is read in, and whether
 * the result is smoothed. Two classes would have shared every line and forced
 * an application that wanted a smoothed *world*-axis follow (an isometric
 * camera) or an unsmoothed *target*-frame arm (a rigid boom) to pick the wrong
 * one and fight it.
 *
 * - `frame: "world"` reads the offset along the world axes, so the camera keeps
 *   its bearing while the target turns — the isometric/side-on follow.
 * - `frame: "target"` reads it in the target's own frame, so it swings around
 *   behind the target as the target turns — the third-person boom. The basis is
 *   the target's world matrix columns **normalized**, so an ancestor's scale
 *   moves the arm's anchor without stretching the arm. A `Vector3` target has
 *   no orientation, so it falls back to the world axes.
 * - `spring` omitted snaps to the goal every step; supplied, the placement is
 *   the exact exponential step of `SpringDamper` towards it, integrated in
 *   **world space** so the smoothing does not change when the rig is reparented.
 *
 * The smoother's state is captured lazily, on the first step that writes: a rig
 * starts from wherever its node actually is rather than easing in from the
 * origin. It keeps advancing on a step whose *write* is refused by a degenerate
 * parent — the goal is a property of the target, not of the write — but not on
 * a step the §42 check refuses, because that step never reaches this component
 * at all (`ConstraintSystem` freezes a refused node, exactly as `KinematicSystem`
 * freezes a refused command).
 */
export class FollowRig implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "follow-rig";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /** What the rig follows, or `null` for an idle rig. See {@link OrbitRig.target}. */
  target: RigTarget | null;

  /**
   * Offset from the target, in the frame {@link FollowRig.frame} names. Written
   * in place — the instance is the rig's own copy of what the constructor was
   * given, so moving a camera's boom is `rig.offset.set(...)`.
   */
  readonly offset = new Vector3();

  /** Which frame {@link FollowRig.offset} is read in. Fixed at construction. */
  readonly frame: FollowFrame;

  /** The smoother, or `null` for a rig that snaps. Fixed at construction. */
  readonly spring: SpringDamper | null;

  /** Steps on which the rig declined to place its node — see {@link FollowRig.apply}. */
  skippedSteps = 0;

  /** World-space goal, recomputed every step. */
  readonly #goal = new Vector3();

  /** World-space smoothed position; meaningful once {@link #smoothing} is set. */
  readonly #smoothed = new Vector3();

  /** World-space velocity of the smoother, in metres per second. */
  readonly #velocity = new Vector3();

  /** Whether {@link #smoothed} holds a captured state. */
  #smoothing = false;

  /** `SpringDamper.updateVector3`'s out record, aliasing the state (D7). */
  readonly #result: SpringDamperVector3Result;

  constructor(options: FollowRigOptions = {}) {
    if (options.offset !== undefined) {
      this.offset.copy(options.offset);
    }
    this.frame = options.frame ?? "world";
    this.spring = options.spring ?? null;
    this.target = options.target ?? null;
    // Aliased on purpose: `updateVector3` reads every input before writing any
    // output, so stepping the spring in place is documented-safe and allocates
    // nothing.
    this.#result = { value: this.#smoothed, velocity: this.#velocity };
  }

  /** Whether the smoother holds state, i.e. at least one step has been written. */
  get smoothing(): boolean {
    return this.#smoothing;
  }

  /**
   * Drops the smoother's captured state, so the next step starts from the
   * node's position then instead of springing across the gap.
   *
   * What a teleport needs: moving a followed target by kilometres would
   * otherwise send the camera sailing after it for a second.
   */
  resetSmoothing(): void {
    this.#smoothing = false;
  }

  /**
   * Places `node` at its offset from the target, smoothing when the rig has a
   * spring. Called by `ConstraintSystem` once per fixed step, after the §42
   * authority check.
   *
   * @param node the node being placed
   * @param deltaSeconds the fixed step, in seconds (§7a)
   * @returns `true` when the node was placed. `false` — and a bumped
   * {@link FollowRig.skippedSteps} — when the target's world position is not
   * finite, when a `"target"` frame has a collapsed basis, or when the node's
   * parent has no invertible world matrix; an idle rig returns `false` without
   * counting a skip.
   */
  apply(node: Node, deltaSeconds: number): boolean {
    const target = this.target;
    if (target === null) {
      return false;
    }
    const goal = this.#goal;
    if (!resolveTargetPosition(target, goal)) {
      this.skippedSteps += 1;
      return false;
    }
    const offset = this.offset;
    if (this.frame === "target" && !(target instanceof Vector3)) {
      if (!this.#addTargetFrameOffset(target, goal)) {
        this.skippedSteps += 1;
        return false;
      }
    } else {
      goal.set(goal.x + offset.x, goal.y + offset.y, goal.z + offset.z);
    }

    const spring = this.spring;
    let placed: boolean;
    if (spring === null) {
      placed = placeAtWorldPosition(node, goal.x, goal.y, goal.z);
    } else {
      const smoothed = this.#smoothed;
      if (!this.#smoothing) {
        worldPositionOf(node, smoothed);
        this.#velocity.set(0, 0, 0);
        this.#smoothing = true;
      }
      spring.updateVector3(
        smoothed,
        goal,
        this.#velocity,
        deltaSeconds,
        this.#result,
      );
      placed = placeAtWorldPosition(node, smoothed.x, smoothed.y, smoothed.z);
    }
    if (!placed) {
      this.skippedSteps += 1;
    }
    return placed;
  }

  /**
   * Adds {@link FollowRig.offset}, rotated into `target`'s frame, to `goal`.
   *
   * The basis is the target's world matrix columns normalized — the same
   * reading `Node.getWorldDirection` takes of column 2, extended to all three,
   * so scale anywhere up the chain moves the anchor without stretching the arm.
   * `Math.sqrt`, never `Math.hypot`: only `sqrt` is specified exactly rounded
   * (§33).
   *
   * @returns `false` when a basis column has collapsed (a zero or `NaN` scale),
   * which leaves the offset's direction undefined.
   */
  #addTargetFrameOffset(target: Node, goal: Vector3): boolean {
    const e = resolveWorldTransform(target).elements;
    const length0 = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
    const length1 = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
    const length2 = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
    if (!(length0 > 0 && length1 > 0 && length2 > 0)) {
      return false;
    }
    const x = this.offset.x / length0;
    const y = this.offset.y / length1;
    const z = this.offset.z / length2;
    goal.set(
      goal.x + e[0] * x + e[4] * y + e[8] * z,
      goal.y + e[1] * x + e[5] * y + e[9] * z,
      goal.z + e[2] * x + e[6] * y + e[10] * z,
    );
    return true;
  }
}
