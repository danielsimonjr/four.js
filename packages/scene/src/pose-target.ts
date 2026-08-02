/**
 * The `PoseTarget` component (§6a, §19, §42) — the pose animation *asks* for,
 * as opposed to the pose a node *has*.
 *
 * §19's blending pipeline starts with "animation produces a target pose", which
 * kinematic controllers may modify and physics then solves against. Under
 * `"blended"` authority (§42) the node's own `Transform` is owned by that
 * pipeline, so an animation clip or tween cannot write it: writing it would make
 * animation a second transform writer, exactly what §42 forbids. It writes
 * *this* component instead, and `PhysicsWorld`'s publish pass (WP-7.3) combines
 * the target with the solver pose and performs the single authoritative
 * transform write.
 *
 * ## Why this lives in `@four/scene` (plan P7-1)
 *
 * Neither `@four/animation` nor `@four/physics` may import the other (plan
 * §3.1), and both need to name the target pose — animation to write it, physics
 * to read it. `@four/scene` is the package they both already depend on, and a
 * target pose is scene data (a pose on a node) rather than solver data, so it
 * is also where it belongs on the merits.
 *
 * ## Bindable by design (§16)
 *
 * {@link PoseTarget.position} and {@link PoseTarget.rotation} are plain mutable
 * math objects reachable by property path, so §16's binding resolution reaches
 * them with no special case:
 *
 * ```ts
 * const target = node.addComponent(new PoseTarget()).copyFrom(node.transform);
 * animate(target).to({ position: new Vector3(0, 2, 0) }, 1).play();
 * // or a clip track with path "position" / "rotation" through an AnimationMixer
 * // constructed over the PoseTarget.
 * ```
 *
 * Because a binding writes *into* the existing object (never replacing it), the
 * change hooks below survive animation, and so does {@link PoseTarget.version}.
 *
 * ## No scale (P7-1 MVP)
 *
 * Position and rotation only. §19's pipeline blends a pose that a rigid body
 * can also produce, and a solver body has no scale — blending an animated scale
 * against a physical one would mean inventing the physical side. §43's render
 * interpolation makes the same cut (`PoseBuffer` stores position and rotation).
 * A node's animated scale therefore stays on its `Transform` and is not part of
 * the blend; a scale channel here would need a decision about what it blends
 * *against* first.
 *
 * ## The dirty channel and the history (decision, WP-7.1)
 *
 * The blend system needs two different things from this component, and they are
 * deliberately two separate mechanisms:
 *
 * 1. **Cheap dirty detection.** {@link PoseTarget.version} works exactly like
 *    `Transform.version` (plan D3): the constructor installs an `onChanged`
 *    hook on `position` and `rotation`, so any math *method* call on them bumps
 *    the counter once, and a direct field write (`target.position.x = 1`) needs
 *    a following {@link PoseTarget.markDirty}. Both members are `readonly` for
 *    the same reason `Transform`'s are — replacing one would drop the hook and
 *    freeze the version while the target kept moving. See `transform.ts`.
 *
 * 2. **Finite-difference history.** {@link PoseTarget.previousPosition} and
 *    {@link PoseTarget.previousRotation} hold the target pose of the *previous*
 *    fixed step, so `(position - previousPosition) / fixedDelta` is the velocity
 *    the target is moving at — what a kinematic body is driven with, and what a
 *    body inherits when it switches from animated to dynamic control (P7-3's
 *    ragdoll activation). They carry **no** change hook: they are engine
 *    bookkeeping, not authored state, and a version bump on capture would make
 *    every step look dirty.
 *
 * A version stamp cannot serve as the history and the history cannot serve as
 * dirty detection, which is why both exist: the version says *that* the target
 * changed, the history says *by how much*.
 *
 * ### Who calls `capturePrevious`
 *
 * {@link PoseTarget.capturePrevious} is called **once per fixed step, at the
 * top of the step, before that step's animation writes** — by
 * `PhysicsWorld.capturePoseTargets` in `@four/physics` (WP-7.3), which the
 * system `createPoseTargetCaptureSystem` runs at §39 step 3's priority minus
 * one notch, the way `createSnapshotSystem` owns `PoseBuffer.capture`.
 * Animation writes targets at §39 step 3 and the solve reads them at step 6, so
 * the physics world's own step is far too late to capture: it would flatten the
 * history the moment animation had written it, and every difference would read
 * zero. That is why the capture is a separate system an application registers,
 * and not a line inside `PhysicsWorld.step`.
 *
 * The capture is what makes the difference mean "one step": right after it
 * `previous === current`, so the difference is zero until this step's animation
 * writes, and then it is exactly that step's motion. The one state to know
 * about is the window **before the first capture**, where `previous` still
 * holds the constructed or seeded pose: authoring a target there and
 * differencing it immediately reads the authoring itself as motion. That is why
 * {@link PoseTarget.copyFrom} seeds the history as well — starting a target
 * from the node's current pose is the normal way in, and it leaves nothing to
 * spike.
 *
 * Note the difference from `PoseBuffer` (§43), which is not a duplicate of this
 * store: `PoseBuffer` keeps the previous/current pose of a node's **transform**
 * for render interpolation, and never feeds back into simulation state. This
 * keeps the previous/current **target** pose, and feeds directly into it.
 */

import type { Component, ComponentHost } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";

import type { Transform } from "./transform.js";

/**
 * The pose §19's animation stage produces for a node, as a §6a component.
 *
 * ```ts
 * const node = new Group();
 * const target = node.addComponent(new PoseTarget()).copyFrom(node.transform);
 *
 * node.transformAuthority = "blended"; // §42: §19's pipeline owns the transform
 * target.position.set(0, 2, 0);        // version += 1
 * target.capturePrevious();            // per fixed step, from the capture system
 * ```
 *
 * One per node (§6a). Holds authored state only — no per-frame work, no solver
 * reference, no knowledge of who reads it.
 */
export class PoseTarget implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "pose-target";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * Target position, in the same space as the node's `transform.position` —
   * local to the node's parent (§7). The origin by default. Write *into* it;
   * see the class documentation for why it is `readonly`.
   */
  readonly position: Vector3;

  /** Target rotation as a unit quaternion (§7a: radians). Identity by default. */
  readonly rotation: Quaternion;

  /**
   * Target position at the previous {@link PoseTarget.capturePrevious} — the
   * finite-difference history, not a render-interpolation store. Engine-owned
   * and hookless; treat it as read-only outside the blend system.
   */
  readonly previousPosition: Vector3;

  /** Target rotation at the previous {@link PoseTarget.capturePrevious}. */
  readonly previousRotation: Quaternion;

  /** Backing store for {@link PoseTarget.version}; only `markDirty` writes it. */
  #version = 0;

  /**
   * Builds a target at the origin with identity rotation, with the history
   * seeded to that same pose (so an uncaptured target differences to zero) and
   * `version` 0.
   */
  constructor() {
    this.position = new Vector3(0, 0, 0);
    this.rotation = new Quaternion(0, 0, 0, 1);
    this.previousPosition = new Vector3(0, 0, 0);
    this.previousRotation = new Quaternion(0, 0, 0, 1);

    // Plan D3, as in `Transform`: one shared hook over the two authored
    // members, so one math method call is one version bump. The `previous*`
    // pair deliberately gets none.
    const markDirty = (): void => {
      this.markDirty();
    };
    this.position.onChanged = markDirty;
    this.rotation.onChanged = markDirty;
  }

  /**
   * Counter incremented on every mutation of {@link PoseTarget.position} or
   * {@link PoseTarget.rotation}, so the blend system can skip a node whose
   * target has not moved.
   *
   * Opaque and monotonic, exactly like `Transform.version`: compare two stamps
   * for inequality, never subtract them. A single call may bump it more than
   * once when it writes both members — {@link PoseTarget.copyFrom} bumps twice
   * — which is why only ordering is meaningful.
   */
  get version(): number {
    return this.#version;
  }

  /**
   * Announces a mutation the change hooks could not see — a direct field write
   * such as `target.position.x = 5` (§7b makes the same allowance for the math
   * types). Bumps {@link PoseTarget.version} by one.
   *
   * Never wrong to call, only wasteful: after a method-based mutation it simply
   * counts as a second mutation.
   */
  markDirty(): void {
    this.#version += 1;
  }

  /**
   * Shifts the history one fixed step forward: `previous ← current`. Allocates
   * nothing and does **not** bump {@link PoseTarget.version} — capturing is not
   * a mutation of the target.
   *
   * Call it **once per fixed step, before that step's animation writes** (see
   * the class documentation). Calling it twice in one step collapses the
   * finite difference to zero and would report a moving target as stationary;
   * never calling it leaves `previous === current`, which reports zero
   * velocity — wrong for a moving target, but never a spurious spike.
   */
  capturePrevious(): void {
    this.previousPosition.copy(this.position);
    this.previousRotation.copy(this.rotation);
  }

  /**
   * Seeds this target from `transform`'s position and rotation — the usual way
   * to start a blend from where the node already is — and returns `this`.
   *
   * The **history is seeded too**, because seeding is not a simulation step: a
   * target that adopted a node's pose without also adopting it as its history
   * would finite-difference the whole jump from the origin into a velocity on
   * the first step. Scale and pivot are ignored (see the class documentation).
   *
   * Copies values; the transform is not retained and nothing is aliased.
   * Allocates nothing, and bumps {@link PoseTarget.version} twice — once per
   * hooked member.
   */
  copyFrom(transform: Transform): this {
    this.position.copy(transform.position);
    this.rotation.copy(transform.rotation);
    this.previousPosition.copy(transform.position);
    this.previousRotation.copy(transform.rotation);
    return this;
  }
}
