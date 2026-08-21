/**
 * §12's **character controllers** — {@link CharacterController}, the one yaw
 * source for a character, and {@link FirstPersonLook}, the pitch-only look
 * channel that rides on top of it (PH-11's residue + `R-36`'s staged
 * first-person rig, 2026-08-21).
 *
 * §12 asks for exactly one thing here. Its required-feature list reads:
 *
 * > Required kinematic features:
 * > - velocity-based movement;
 * > - target following;
 * > - path following;
 * > - steering behaviors;
 * > - look-at constraints;
 * > - orbit motion;
 * > - spline motion;
 * > - camera rigs;
 * > - **character controllers**;
 * > - motion limits.
 *
 * — under the section's own opening sentence, *"Kinematic controllers directly
 * prescribe movement."* That sentence is the whole scope decision: a character
 * controller in §12 is a **kinematic** object. It prescribes where the
 * character will be as a function of its intent, its heading and time; it does
 * not derive motion from forces, and it is not the §19 ragdoll or the §26 rigid
 * body. What it owes the rest of the engine is a pose written under one §42
 * authority — `"kinematic"`, the same one {@link KinematicController} writes
 * under, through the same {@link KinematicSystem} at §39 step 4.
 *
 * ```ts
 * const player = new Group();
 * player.transformAuthority = "kinematic";              // §42 — required
 * const character = player.addComponent(
 *   new CharacterController({ moveSpeed: 4, jumpSpeed: 4.5 }),
 * );
 *
 * const eye = new PerspectiveCamera({ aspect });
 * eye.transform.position.set(0, 1.7, 0);
 * eye.transformAuthority = "kinematic";                 // §42 — its own node
 * const look = eye.addComponent(new FirstPersonLook());
 * player.add(eye);
 *
 * kinematics.track(player);
 * kinematics.track(eye);
 *
 * // …from wherever your input lives, in whatever units you sample it:
 * character.setMoveIntent(forward, strafe);   // −1…1 per axis, clamped to the disc
 * character.turn(-dx * 0.003);                // the character's heading
 * look.look(-dy * 0.003);                     // the eye's pitch only
 * ```
 *
 * ## The yaw arbitration (decision, PH-11 residue)
 *
 * `R-36` staged §44's first-person rig with a one-line reason: it *"writes a
 * rotation, so it collides with `LookAtConstraint` for §42's single authority —
 * it waits on §12's character controllers to settle aim-vs-free-look
 * arbitration"*. This module settles it, and the answer is that there was never
 * an arbitration to make — there was a **decomposition**:
 *
 * - The character controller **owns yaw**, because yaw *is* the character's
 *   heading: the direction it walks in and the direction it faces are the same
 *   number, and a second writer of that number would be a second definition of
 *   which way the character is going.
 * - A first-person camera adds **pitch and nothing else**. Pitch is not a
 *   property of the character at all — a walking body does not tilt — so it
 *   belongs to a different node: a child of the character, carrying
 *   {@link FirstPersonLook}, writing its **local** rotation about `+X`.
 *
 * The world rotation of the eye is then `yaw ∘ pitch` by ordinary parent-child
 * composition, which is exactly the first-person camera's classic
 * decomposition: yaw applied in the world frame, pitch applied in the yawed
 * frame, no roll, and no gimbal arithmetic anywhere. §42 is satisfied
 * **structurally** rather than by arbitration — an authority is per *node*, and
 * these are two nodes with one writer each, both `"kinematic"`, both advanced
 * by one system. Nothing had to be negotiated with `LookAtConstraint` either:
 * an aimed camera and a free-look camera are different components on different
 * nodes, and a node carrying both is the ordinary §42 conflict the engine
 * already reports.
 *
 * The composition is proved rather than asserted:
 * `tests/integration/first-person-camera.test.ts` walks a character in a
 * circle while pitching its eye, and checks that the eye's world forward
 * matches `yaw ∘ pitch` to floating-point tolerance with **zero** §42 warnings.
 *
 * ## A rate limit is deliberately absent (decision)
 *
 * {@link LookAtConstraint} has `maxAngularSpeed` because it computes its own
 * goal every step from a moving target and therefore needs to be told how fast
 * it may chase it. `turn` and `look` take **deltas the application already
 * chose**, so the rate is in the caller's hand by construction; adding a second
 * limit on top would silently discard input the caller believed was accepted.
 * Absent beats accepted-and-ignored — and if a future controller grows a
 * *desired heading* to chase, that is when the `maxAngularSpeed` spelling
 * arrives, with something to limit.
 *
 * ## Ground is a plane, and the rest is staged (decision)
 *
 * Gravity, a vertical velocity, jumping and a `grounded` flag are all
 * expressible with no collision query at all, against a horizontal plane at
 * {@link CharacterController.groundHeight}. That is the honest kinematic tier
 * and it is what ships here.
 *
 * What is **staged, with its seam named**: capsule sweeps, slide-along-wall,
 * step height, slope limits and moving platforms. Every one of them needs a
 * shape cast against the collision world. `@four/physics` already has one —
 * `PhysicsWorld.shapeCast` (§30) — but §3.1's frozen dependency matrix gives
 * `@four/motion` only `core`, `math` and `scene`, and the edge runs the other
 * way: **`physics` depends on `motion`.** So a solver-backed character
 * controller is a `@four/physics`-tier packet (a `SweptCharacterController`
 * over `world.shapeCast`, reusing this class's intent/heading/gravity state),
 * not a `@four/motion` one, and it is filed there rather than smuggled in
 * behind an injected query interface nobody implements. This module ships the
 * half that owes nothing to a solver, and says which half that is.
 *
 * ## Determinism (§33)
 *
 * `same-runtime`, the tier every other floating-point feature in the engine
 * claims. No clock (`deltaSeconds` is the injected fixed step), no
 * `Math.random`, no hash-ordered iteration, no per-step allocation. The
 * transcendentals on the path are `Math.sin`/`Math.cos` (the heading basis and
 * the two half-angle quaternions) and `Math.sqrt` — never `Math.hypot`, whose
 * accuracy ECMA-262 leaves implementation-defined, where `sqrt` is specified
 * exactly rounded.
 */

import type { Component, ComponentHost } from "@four/core";
import type { Transform } from "@four/scene";

/**
 * Default {@link CharacterController.gravity}, in m/s²: `−9.81`, Appendix A's
 * world gravity and `@four/physics`'s own default, so a kinematic character and
 * a dynamic body fall at the same rate in the same scene (§7a: `+Y` is up in
 * both 2D and 3D, so the sign is negative).
 */
export const DEFAULT_CHARACTER_GRAVITY = -9.81;

/**
 * Default bound on {@link FirstPersonLook.pitch}, in radians: `π/2 − 1e-3`,
 * just short of straight up.
 *
 * The same value and the same argument as `DEFAULT_ORBIT_PITCH_LIMIT`, reached
 * from the other side: at exactly `±π/2` the eye's forward axis is parallel to
 * world `+Y`, which is the configuration `Node.lookAt` refuses (§85 — the roll
 * is undetermined) and the one at which a yaw-then-pitch decomposition stops
 * having a unique answer. One milliradian short is invisible — about 0.06° —
 * and keeps the composition non-degenerate by a comfortable margin rather than
 * by one ULP.
 */
export const DEFAULT_FIRST_PERSON_PITCH_LIMIT = Math.PI / 2 - 1e-3;

/** Throws unless `value` is a finite number. */
function assertFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${what} must be a finite number (§85); received ${String(value)}`,
    );
  }
}

/** Throws unless `value` is a finite number `>= 0`. */
function assertNonNegative(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${what} must be a finite number >= 0 (§85); received ${String(value)}`,
    );
  }
}

/** Options for {@link CharacterController} (§12). */
export interface CharacterControllerOptions {
  /** Initial {@link CharacterController.yaw}, in radians (§7a). Default `0`. */
  yaw?: number;
  /**
   * Speed a full move intent produces, in metres per second (§7a). Finite and
   * `>= 0`. Default `1`.
   */
  moveSpeed?: number;
  /**
   * Vertical acceleration in m/s², applied while airborne. Default
   * {@link DEFAULT_CHARACTER_GRAVITY}. `0` is legal and means a character that
   * never falls.
   */
  gravity?: number;
  /** Height of the ground plane, in metres (§7a). Default `0`. */
  groundHeight?: number;
  /**
   * Upward speed {@link CharacterController.jump} imparts, in m/s. Finite and
   * `>= 0`; `0` means a character that cannot jump. Default `4`.
   */
  jumpSpeed?: number;
  /**
   * Largest downward speed gravity may accumulate, in m/s. Finite and `>= 0`,
   * or `Infinity` (the default) for no terminal velocity.
   */
  maxFallSpeed?: number;
  /**
   * Initial vertical velocity in m/s — what §79 restores for a character that
   * was saved mid-fall. Default `0`.
   */
  verticalVelocity?: number;
  /** Whether the character starts standing on the ground. Default `false`. */
  grounded?: boolean;
}

/**
 * §12's character controller: parameter-driven locomotion for a node, under
 * §42's `"kinematic"` authority, advanced by {@link KinematicSystem}.
 *
 * The controller owns three things and nothing else:
 *
 * | state | written by | read as |
 * |---|---|---|
 * | heading | {@link CharacterController.turn} / {@link CharacterController.yaw} | the node's rotation (yaw about `+Y`, no pitch, no roll) |
 * | planar intent | {@link CharacterController.setMoveIntent} | a velocity of `moveSpeed · intent`, in the heading's frame |
 * | vertical motion | gravity and {@link CharacterController.jump} | the node's `y`, against the ground plane |
 *
 * ## Intent is dimensionless and clamped to the unit disc
 *
 * `setMoveIntent(forward, right)` takes the two numbers a stick or a WASD pair
 * produces, each nominally in `[−1, 1]`, and clamps their **magnitude** to `1`
 * — so walking diagonally is not `√2` times faster than walking forwards, the
 * oldest bug in the genre. The mapping from a device to those two numbers is
 * application policy: like every rig in this package the controller reads no
 * `@four/input` (§3.1 gives `@four/motion` `core`, `math` and `scene` only),
 * which is also what makes it replayable from a seeded stream (§33/§34).
 *
 * ## Frames
 *
 * Everything is written in the node's **parent frame**: `yaw` turns about the
 * parent's `+Y`, `groundHeight` is a height in the parent's coordinates, and
 * the write is `transform.position`/`transform.rotation` directly. For the
 * usual character — a child of the scene root — that is the world frame. A
 * character parented under a moving platform therefore rides it for free, and a
 * character under a *rotated* parent walks in its parent's idea of north, which
 * is the meaning that composes.
 *
 * ## Writes are gated, never accrued
 *
 * A grounded character with no intent and no turn since its last write is
 * **idle**: {@link CharacterController.active} is `false`, the system skips it,
 * `Transform.version` does not move, and — following `KinematicController`'s
 * rule — a node that writes nothing raises no §42 conflict. A step whose
 * arithmetic would produce a non-finite pose (an already-`NaN` position, a
 * `NaN` fed in from elsewhere) writes **nothing** and bumps
 * {@link CharacterController.skippedSteps}: §85's refusals govern *authoring*,
 * and a value that only goes bad mid-step is a transient the simulation must
 * survive, exactly as `LookAtConstraint`'s degenerate aim is.
 */
export class CharacterController implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "character-controller";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /** Height of the ground plane, in the parent frame's metres (§7a). */
  groundHeight: number;

  /**
   * Steps on which the controller declined to write — see the class note. Not
   * bumped by an idle step and not by a §42 refusal, which the system reports
   * through `warnAuthorityConflict` instead.
   */
  skippedSteps = 0;

  /** Backing store for {@link CharacterController.yaw}. */
  #yaw: number;

  /** Backing store for {@link CharacterController.moveSpeed}. */
  #moveSpeed: number;

  /** Backing store for {@link CharacterController.gravity}. */
  #gravity: number;

  /** Backing store for {@link CharacterController.jumpSpeed}. */
  #jumpSpeed: number;

  /** Backing store for {@link CharacterController.maxFallSpeed}. */
  #maxFallSpeed: number;

  /** Forward component of the move intent, in `[−1, 1]`. */
  #intentForward = 0;

  /** Rightward component of the move intent, in `[−1, 1]`. */
  #intentRight = 0;

  /** Vertical velocity in m/s, positive up. */
  #verticalVelocity: number;

  /** Whether the character is standing on the ground plane. */
  #grounded: boolean;

  /** Whether the heading has changed since the last successful write. */
  #headingDirty = true;

  /**
   * @throws RangeError if any option is not a finite number, or if
   * `moveSpeed`, `jumpSpeed` or `maxFallSpeed` is negative (§85).
   */
  constructor(options: CharacterControllerOptions = {}) {
    const yaw = options.yaw ?? 0;
    const moveSpeed = options.moveSpeed ?? 1;
    const gravity = options.gravity ?? DEFAULT_CHARACTER_GRAVITY;
    const groundHeight = options.groundHeight ?? 0;
    const jumpSpeed = options.jumpSpeed ?? 4;
    const maxFallSpeed = options.maxFallSpeed ?? Number.POSITIVE_INFINITY;
    const verticalVelocity = options.verticalVelocity ?? 0;
    assertFinite(yaw, "CharacterControllerOptions.yaw");
    assertNonNegative(moveSpeed, "CharacterControllerOptions.moveSpeed");
    assertFinite(gravity, "CharacterControllerOptions.gravity");
    assertFinite(groundHeight, "CharacterControllerOptions.groundHeight");
    assertNonNegative(jumpSpeed, "CharacterControllerOptions.jumpSpeed");
    assertFinite(
      verticalVelocity,
      "CharacterControllerOptions.verticalVelocity",
    );
    // `Infinity` is the one non-finite value a *maximum* fall speed may take:
    // it is the honest spelling of "no terminal velocity", and nothing ever
    // multiplies by it — the clamp only compares against it.
    if (Number.isNaN(maxFallSpeed) || maxFallSpeed < 0) {
      throw new RangeError(
        `CharacterControllerOptions.maxFallSpeed must be a number >= 0 (§85); received ${String(maxFallSpeed)}`,
      );
    }
    this.#yaw = yaw;
    this.#moveSpeed = moveSpeed;
    this.#gravity = gravity;
    this.groundHeight = groundHeight;
    this.#jumpSpeed = jumpSpeed;
    this.#maxFallSpeed = maxFallSpeed;
    this.#verticalVelocity = verticalVelocity;
    this.#grounded = options.grounded ?? false;
  }

  /**
   * The character's heading: rotation about the parent frame's `+Y`, in
   * radians (§7a), measured from `+Z` towards `+X` — `OrbitRig.yaw`'s
   * convention, so a rig and a character agree on what an angle means.
   *
   * Unbounded: a character may be spun any number of turns, and wrapping would
   * make {@link CharacterController.turn} discontinuous at the seam.
   *
   * @throws RangeError if the value is not finite (§85).
   */
  get yaw(): number {
    return this.#yaw;
  }

  set yaw(value: number) {
    assertFinite(value, "CharacterController.yaw");
    this.#yaw = value;
    this.#headingDirty = true;
  }

  /**
   * Speed a full move intent produces, in m/s (§7a).
   *
   * @throws RangeError if the value is not a finite number `>= 0` (§85).
   */
  get moveSpeed(): number {
    return this.#moveSpeed;
  }

  set moveSpeed(value: number) {
    assertNonNegative(value, "CharacterController.moveSpeed");
    this.#moveSpeed = value;
  }

  /**
   * Vertical acceleration in m/s², applied on steps the character is airborne.
   *
   * @throws RangeError if the value is not finite (§85).
   */
  get gravity(): number {
    return this.#gravity;
  }

  set gravity(value: number) {
    assertFinite(value, "CharacterController.gravity");
    this.#gravity = value;
  }

  /**
   * Upward speed {@link CharacterController.jump} imparts, in m/s; `0` means a
   * character that cannot jump.
   *
   * @throws RangeError if the value is not a finite number `>= 0` (§85).
   */
  get jumpSpeed(): number {
    return this.#jumpSpeed;
  }

  set jumpSpeed(value: number) {
    assertNonNegative(value, "CharacterController.jumpSpeed");
    this.#jumpSpeed = value;
  }

  /** Terminal downward speed in m/s, or `Infinity` for none. Read-only. */
  get maxFallSpeed(): number {
    return this.#maxFallSpeed;
  }

  /** Forward component of the current move intent, in `[−1, 1]`. */
  get intentForward(): number {
    return this.#intentForward;
  }

  /** Rightward component of the current move intent, in `[−1, 1]`. */
  get intentRight(): number {
    return this.#intentRight;
  }

  /** Vertical velocity in m/s, positive up; `0` while grounded. */
  get verticalVelocity(): number {
    return this.#verticalVelocity;
  }

  /**
   * Whether the character is standing on the ground plane.
   *
   * `false` until the first step that lands it — a controller placed above
   * `groundHeight` is falling, which is what a character controller is for. A
   * controller with `gravity: 0` placed above the plane hovers and stays
   * ungrounded: it is falling at zero speed, and saying otherwise would make
   * {@link CharacterController.jump} succeed in mid-air.
   */
  get grounded(): boolean {
    return this.#grounded;
  }

  /**
   * Whether the next step would write anything — the gate
   * {@link KinematicSystem} applies before the §42 authority check, so an idle
   * character neither bumps `Transform.version` nor reports a conflict on a
   * node it does not own.
   *
   * `true` when the character is airborne, has a non-zero move intent, or has
   * turned since its last successful write.
   */
  get active(): boolean {
    return (
      !this.#grounded ||
      this.#headingDirty ||
      this.#intentForward !== 0 ||
      this.#intentRight !== 0
    );
  }

  /**
   * Adds `delta` radians to {@link CharacterController.yaw} — the input
   * surface an application maps a pointer's horizontal motion onto.
   *
   * Goes through the property setter, so a non-finite delta is refused rather
   * than stored.
   */
  turn(delta: number): void {
    this.yaw = this.#yaw + delta;
  }

  /**
   * Sets the planar move intent: `forward` along the heading, `right` across
   * it, each nominally in `[−1, 1]`. A magnitude above `1` is scaled back to
   * the unit disc, so diagonal movement is not faster than axial movement.
   *
   * The intent persists until it is set again — it is a state, not an impulse
   * — so a controller stops when the application says
   * `setMoveIntent(0, 0)` (or {@link CharacterController.stop}), not when it
   * stops calling.
   *
   * @throws RangeError if either component is not finite (§85).
   */
  setMoveIntent(forward: number, right: number): void {
    assertFinite(forward, "CharacterController.setMoveIntent(forward)");
    assertFinite(right, "CharacterController.setMoveIntent(right)");
    // `Math.sqrt`, never `Math.hypot`: only `sqrt` is specified exactly
    // rounded, and this scale multiplies straight into a transform (§33).
    const magnitude = Math.sqrt(forward * forward + right * right);
    if (magnitude > 1) {
      this.#intentForward = forward / magnitude;
      this.#intentRight = right / magnitude;
      return;
    }
    this.#intentForward = forward;
    this.#intentRight = right;
  }

  /** Clears the move intent. Vertical motion and heading are untouched. */
  stop(): void {
    this.#intentForward = 0;
    this.#intentRight = 0;
  }

  /**
   * Launches the character upwards at {@link CharacterController.jumpSpeed}.
   *
   * @returns whether the jump was taken. `false` — with nothing changed — for
   * a character that is airborne or whose `jumpSpeed` is `0`. A boolean rather
   * than a throw or a warning: "can I jump right now?" is a question the
   * application asks sixty times a second, and the answer is data.
   */
  jump(): boolean {
    if (!this.#grounded || this.#jumpSpeed === 0) {
      return false;
    }
    this.#verticalVelocity = this.#jumpSpeed;
    this.#grounded = false;
    return true;
  }

  /**
   * Puts the character on the ground plane immediately, clearing its vertical
   * velocity — what a teleport or a respawn needs, so the character does not
   * resume the fall it was in when it was moved.
   */
  ground(): void {
    this.#verticalVelocity = 0;
    this.#grounded = true;
  }

  /**
   * Advances the character by `deltaSeconds` and writes the result into
   * `transform`.
   *
   * Called by {@link KinematicSystem} once per fixed step. Calling it directly
   * is supported (a controller driven without a system, or a unit test) but
   * performs **no §42 authority check** — that belongs to the system, which
   * knows the node; this method only knows a transform.
   *
   * Both writes happen or neither does: the whole pose is computed into locals
   * first, and a non-finite result leaves the transform untouched and bumps
   * {@link CharacterController.skippedSteps}.
   *
   * @returns whether the pose was written.
   */
  step(transform: Transform, deltaSeconds: number): boolean {
    const yaw = this.#yaw;
    // Yaw about +Y maps +Z to (sin, 0, cos) and +X to (cos, 0, −sin), so the
    // node's forward (−Z, §44/R-36) is (−sin, 0, −cos) and its right is +X.
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const speed = this.#moveSpeed;
    const forward = this.#intentForward * speed;
    const right = this.#intentRight * speed;
    const velocityX = right * cos - forward * sin;
    const velocityZ = -right * sin - forward * cos;

    let verticalVelocity = this.#verticalVelocity;
    let grounded = this.#grounded;
    const position = transform.position;
    let y = position.y;
    if (!grounded) {
      verticalVelocity += this.#gravity * deltaSeconds;
      const terminal = this.#maxFallSpeed;
      if (verticalVelocity < -terminal) {
        verticalVelocity = -terminal;
      }
      y += verticalVelocity * deltaSeconds;
      if (y <= this.groundHeight) {
        y = this.groundHeight;
        verticalVelocity = 0;
        grounded = true;
      }
    }

    const x = position.x + velocityX * deltaSeconds;
    const z = position.z + velocityZ * deltaSeconds;
    if (!Number.isFinite(x + y + z)) {
      // A transient, not an authoring mistake: counted, never thrown inside a
      // fixed step (§61/§85), and the transform keeps the pose it had.
      this.skippedSteps += 1;
      return false;
    }

    this.#verticalVelocity = verticalVelocity;
    this.#grounded = grounded;
    position.set(x, y, z);
    // Yaw-only: half-angle quaternion about +Y. A character does not pitch and
    // does not roll — that is what makes `FirstPersonLook` a separate node.
    const half = yaw * 0.5;
    transform.rotation.set(0, Math.sin(half), 0, Math.cos(half));
    this.#headingDirty = false;
    return true;
  }
}

/** Options for {@link FirstPersonLook} (§44's first-person rig). */
export interface FirstPersonLookOptions {
  /** Initial {@link FirstPersonLook.pitch}, in radians; clamped. Default `0`. */
  pitch?: number;
  /** Lower pitch bound. Default `−`{@link DEFAULT_FIRST_PERSON_PITCH_LIMIT}. */
  minPitch?: number;
  /** Upper pitch bound. Default {@link DEFAULT_FIRST_PERSON_PITCH_LIMIT}. */
  maxPitch?: number;
}

/**
 * §44's first-person look: the pitch-only channel that rides on a
 * {@link CharacterController}'s yaw.
 *
 * Attach it to a **child** of the character — the eye — and give that child
 * `"kinematic"` authority of its own. The component writes exactly one thing:
 * the child's local rotation, a half-angle quaternion about `+X`. Positive
 * pitch looks up (`−Z` rotated about `+X` by `+p` is `(0, sin p, −cos p)`).
 *
 * See the module note for why this is a second node rather than a second
 * writer on the character's transform. In one line: yaw is the character's and
 * pitch is not the character's, and §42 counts writers per node.
 *
 * Limits are `readonly` and the value clamps **on assignment** —
 * `OrbitRig`'s rule, for the same reasons: a retuned rig is a new rig, the
 * component is never in an illegal state, and the per-step path carries no
 * clamping branch. {@link FirstPersonLook.pitchLimitHits} counts how often the
 * clamp bit, which is how a test proves the guard was exercised rather than
 * merely present.
 */
export class FirstPersonLook implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "first-person-look";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /** Lower bound on {@link FirstPersonLook.pitch}, in radians (§7a). */
  readonly minPitch: number;

  /** Upper bound on {@link FirstPersonLook.pitch}, in radians (§7a). */
  readonly maxPitch: number;

  /** Times a pitch assignment was clamped by the limits. */
  pitchLimitHits = 0;

  /** Backing store for {@link FirstPersonLook.pitch}; always inside the limits. */
  #pitch: number;

  /** Whether the pitch has changed since the last write. */
  #dirty = true;

  /**
   * @throws RangeError if any angle is not finite, or if `minPitch` exceeds
   * `maxPitch` (§85).
   */
  constructor(options: FirstPersonLookOptions = {}) {
    const minPitch = options.minPitch ?? -DEFAULT_FIRST_PERSON_PITCH_LIMIT;
    const maxPitch = options.maxPitch ?? DEFAULT_FIRST_PERSON_PITCH_LIMIT;
    assertFinite(minPitch, "FirstPersonLookOptions.minPitch");
    assertFinite(maxPitch, "FirstPersonLookOptions.maxPitch");
    if (minPitch > maxPitch) {
      throw new RangeError(
        `FirstPersonLookOptions.minPitch must not exceed maxPitch (§85); received ${String(minPitch)} > ${String(maxPitch)}`,
      );
    }
    this.minPitch = minPitch;
    this.maxPitch = maxPitch;
    this.#pitch = 0;
    const pitch = options.pitch ?? 0;
    assertFinite(pitch, "FirstPersonLookOptions.pitch");
    this.pitch = pitch;
    // The construction clamp is the component's initial state, not user error
    // the way a live clamp is — `OrbitRig`'s rule.
    this.pitchLimitHits = 0;
  }

  /**
   * Elevation of the eye, in radians (§7a), clamped to
   * `[minPitch, maxPitch]` on assignment — a clamp bumps
   * {@link FirstPersonLook.pitchLimitHits}.
   *
   * @throws RangeError if the value is not finite (§85).
   */
  get pitch(): number {
    return this.#pitch;
  }

  set pitch(value: number) {
    assertFinite(value, "FirstPersonLook.pitch");
    const clamped = Math.min(this.maxPitch, Math.max(this.minPitch, value));
    if (clamped !== value) {
      this.pitchLimitHits += 1;
    }
    this.#pitch = clamped;
    this.#dirty = true;
  }

  /**
   * Adds `delta` radians to {@link FirstPersonLook.pitch} — the input surface
   * an application maps a pointer's vertical motion onto. Clamped like any
   * other assignment, so a pointer dragged to the stop leaves the eye sitting
   * exactly on its limit.
   */
  look(delta: number): void {
    this.pitch = this.#pitch + delta;
  }

  /** Whether the next step would write anything. See `CharacterController.active`. */
  get active(): boolean {
    return this.#dirty;
  }

  /**
   * Writes the pitch into `transform`'s local rotation. Called by
   * {@link KinematicSystem} once per fixed step, after the §42 authority check.
   *
   * @returns `true` — a clamped pitch is always a finite rotation, so unlike
   * `CharacterController.step` there is no transient to survive here. The
   * boolean exists so both components read the same way at the call site.
   */
  step(transform: Transform): boolean {
    const half = this.#pitch * 0.5;
    transform.rotation.set(Math.sin(half), 0, 0, Math.cos(half));
    this.#dirty = false;
    return true;
  }
}
