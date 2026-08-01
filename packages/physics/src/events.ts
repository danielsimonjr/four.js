/**
 * Collision, trigger, and sleep event payloads (§29, §32, §37).
 *
 * ## When these are delivered (§6b, §29, §37, §39)
 *
 * Never during the solver step. §37's `drainEvents` returns the events that
 * accumulated during the preceding `step`, the physics package normalizes them
 * (§101), and dispatch happens **after** the fixed step, at §39's step 9
 * ("collision event dispatch"). Adapters never invoke user callbacks
 * themselves. Registration-order dispatch and the unsubscriber returned by `on`
 * are §6b's, unchanged — physics adds no eventing mechanism of its own.
 *
 * ## One payload shape, two reference types
 *
 * §29 declares the collision payload in terms of the user-facing objects:
 *
 * ```ts
 * interface CollisionEvent {
 *   bodyA: RigidBody;
 *   bodyB: RigidBody;
 *   colliderA: Collider;
 *   colliderB: Collider;
 *   contacts: ContactPoint[];
 *   relativeVelocity: Vector3;
 *   totalImpulse: Vector3;
 * }
 * ```
 *
 * but the same payload exists one layer down, where an adapter has only the
 * opaque handles it minted (§37) — the `RigidBody` and `Collider` *components*
 * (§6a, WP-5.2) are `@four/physics`'s, not the solver's. Rather than declare
 * two near-identical families, each payload here is **parameterized** over how
 * bodies and colliders are referenced, and defaults to the handle form:
 *
 * ```ts
 * drainEvents(): PhysicsEvent[];                    // handles — the §37 layer
 * type UserCollision = CollisionEvent<RigidBody, Collider>; // §29 verbatim
 * ```
 *
 * Normalization (WP-5.3) is then exactly "swap the reference type", with the
 * field names, the contact list, and the vectors all identical on both sides —
 * which is what makes §101's "event normalization" a mapping rather than a
 * translation (decision, WP-5.1).
 *
 * ## The `type` tag
 *
 * §29 lists five event *names* (`collisionstart`, `collisionstay`,
 * `collisionend`, `triggerenter`, `triggerexit`) that share their payloads.
 * `drainEvents` returns them in one array, so each payload carries the name in
 * a `type` field and {@link PhysicsEvent} is a discriminated union on it. On a
 * node's emitter the name is the event key and `type` is redundant but
 * harmless — and it keeps a payload self-describing once it has been logged,
 * recorded into a replay (§34), or forwarded.
 *
 * ## Ordering (§33)
 *
 * The array from `drainEvents` is ordered by the adapter and must be
 * deterministic for a given step; dispatch preserves that order. Nothing here
 * sorts, because a sort would need a key the adapter has not promised.
 *
 * This module is types only — it ships no runtime code.
 */

import type { Vector3 } from "@four/math";

import type { PhysicsBodyHandle, PhysicsColliderHandle } from "./types.js";

/**
 * One point of contact inside a {@link CollisionEvent} (§29).
 *
 * §29 names `ContactPoint[]` without defining the element, so this is the
 * engine's definition (decision, WP-5.1): the minimum a contact response, a
 * debug overlay (§101 "debug data"), and an impact sound all need, and nothing
 * an adapter would have to invent.
 *
 * All vectors are in **world space**. The vectors are live `Vector3` instances
 * owned by the event; treat them as read-only for the duration of the dispatch
 * and copy anything you intend to keep — an adapter may pool contact records
 * between steps.
 */
export interface ContactPoint {
  /** The contact point on collider A's surface, in world space. */
  readonly pointOnA: Vector3;

  /** The contact point on collider B's surface, in world space. */
  readonly pointOnB: Vector3;

  /**
   * Unit contact normal in world space, pointing **from A towards B**. Fixing
   * the direction to the event's own A/B ordering is what makes it usable
   * without knowing which collider the solver listed first.
   */
  readonly normal: Vector3;

  /**
   * Signed distance along {@link ContactPoint.normal} between the two surfaces:
   * negative while they interpenetrate, zero on touch, positive for a
   * speculative contact that has not closed yet (§31).
   */
  readonly separation: number;

  /**
   * Magnitude of the normal impulse the solver applied at this point during the
   * step, in newton-seconds. Zero for a speculative or sensor contact that
   * carried no impulse.
   */
  readonly impulse: number;
}

/** The three §29 collision event names. */
export type CollisionPhase =
  "collisionstart" | "collisionstay" | "collisionend";

/** The two §29 trigger (sensor) event names. */
export type TriggerPhase = "triggerenter" | "triggerexit";

/**
 * The two sleep-state transitions §37 requires an adapter to report
 * ("contact, trigger, and sleep events"), matching §32's sleeping model.
 */
export type SleepPhase = "sleep" | "wake";

/** Every physics event name (§29, §32, §37). */
export type PhysicsEventType = CollisionPhase | TriggerPhase | SleepPhase;

/**
 * Two colliders began touching, kept touching, or stopped touching (§29).
 *
 * `TBody`/`TCollider` are the reference types — opaque handles at the §37
 * layer, `RigidBody`/`Collider` components at the user-facing layer. See the
 * module header.
 *
 * A/B ordering is the adapter's and carries no meaning beyond being consistent
 * within one event: `bodyA` is the body owning `colliderA`, the normal points
 * from A to B, and `relativeVelocity` is measured A relative to B.
 */
export interface CollisionEvent<
  TBody = PhysicsBodyHandle,
  TCollider = PhysicsColliderHandle,
> {
  /** Which of §29's three collision names this is. */
  readonly type: CollisionPhase;

  /** The body owning {@link CollisionEvent.colliderA}. */
  readonly bodyA: TBody;

  /** The body owning {@link CollisionEvent.colliderB}. */
  readonly bodyB: TBody;

  /** The first collider of the pair. */
  readonly colliderA: TCollider;

  /** The second collider of the pair. */
  readonly colliderB: TCollider;

  /**
   * The contact manifold for this step. **Empty for `"collisionend"`**, which
   * reports that the pair stopped touching and therefore has no contacts left
   * to describe.
   */
  readonly contacts: readonly ContactPoint[];

  /**
   * Velocity of A relative to B at the contact, in metres per second — the
   * quantity an impact sound or a damage model scales with.
   */
  readonly relativeVelocity: Vector3;

  /**
   * Sum of the impulses the solver applied across
   * {@link CollisionEvent.contacts} during the step, in newton-seconds, as a
   * world-space vector.
   */
  readonly totalImpulse: Vector3;
}

/**
 * Something entered or left a sensor (§29, §24).
 *
 * A sensor reports overlaps but exerts no forces (Appendix B), so there is no
 * manifold, no impulse, and no relative velocity to report — which is why this
 * is a separate payload rather than a collision event with empty fields.
 *
 * The pair is asymmetric by construction: {@link TriggerEvent.sensor} is the
 * collider whose `sensor` flag is set. When two sensors overlap, an adapter
 * reports the pair twice, once from each side, so a listener on either sensor
 * sees its own event.
 */
export interface TriggerEvent<
  TBody = PhysicsBodyHandle,
  TCollider = PhysicsColliderHandle,
> {
  /** Which of §29's two trigger names this is. */
  readonly type: TriggerPhase;

  /** The sensor collider that fired. */
  readonly sensor: TCollider;

  /** The body owning {@link TriggerEvent.sensor}. */
  readonly sensorBody: TBody;

  /** The collider that entered or left the sensor. */
  readonly other: TCollider;

  /** The body owning {@link TriggerEvent.other}. */
  readonly otherBody: TBody;
}

/**
 * A body fell asleep or woke up (§32, §37).
 *
 * §32 makes sleeping observable state with `wake()`/`sleep()` as the commands;
 * this is the notification that the state actually changed, whether the change
 * came from the thresholds, from an explicit command, or from a contact.
 */
export interface SleepEvent<TBody = PhysicsBodyHandle> {
  /** `"sleep"` when the body stopped simulating, `"wake"` when it resumed. */
  readonly type: SleepPhase;

  /** The body whose sleep state changed. */
  readonly body: TBody;
}

/**
 * Everything `PhysicsSolverAdapter.drainEvents` can return (§37), discriminated
 * by `type`.
 *
 * ```ts
 * for (const event of adapter.drainEvents()) {
 *   switch (event.type) {
 *     case "collisionstart":
 *       // event is narrowed to CollisionEvent
 *       break;
 *     case "triggerenter":
 *       // event is narrowed to TriggerEvent
 *       break;
 *     // …
 *   }
 * }
 * ```
 */
export type PhysicsEvent<
  TBody = PhysicsBodyHandle,
  TCollider = PhysicsColliderHandle,
> =
  | CollisionEvent<TBody, TCollider>
  | TriggerEvent<TBody, TCollider>
  | SleepEvent<TBody>;
