/**
 * The §79 serializers for this package's components (PH-17, 2026-08-06;
 * `KinematicController` added 2026-08-07; the §44 rigs and §12's look-at
 * constraint added 2026-08-13).
 *
 * §6a says components "serialize under registered type names (§79)", and §79's
 * registry is `@four/serialization`'s — which may depend on `core`, `math`, and
 * `scene` only (plan §3.1) and so can never name `MotionComponent`. The
 * registry is therefore empty of everything except the components `scene` owns,
 * and every scene carrying a `MotionComponent` used to round-trip through §79
 * **losing it**, unless the application hand-wrote a serializer copied out of a
 * test helper. That is what this module ships instead.
 *
 * ## Why the type is declared here rather than imported
 *
 * Nothing below imports `@four/serialization`. The §3.1 matrix has no
 * motion → serialization edge, adding one would invert the layering (an
 * application-tier format depended on by a foundation-tier package), and it is
 * not needed: {@link ComponentSerializerShape} is the same **structural**
 * contract `ComponentSerializer` declares, so
 * `registry.register(MotionComponent, MOTION_COMPONENT_SERIALIZER)` type-checks
 * with no cast and no edge — the duck-typing pattern `@four/render`'s
 * `ParticleDrawable` and `@four/diagnostics`'s `ReplayTarget` already use, and
 * with the same honest cost: **nothing type-checks the two declarations against
 * each other.** A change to `ComponentSerializer` will not fail this package's
 * build; it will fail `tests/serializers.test.ts`, which asserts assignability
 * against a transcribed mirror of it.
 *
 * ## What is written, and what is not
 *
 * For {@link MotionComponent}, everything §11 declares: both velocities, both
 * accelerations, both damping rates, and the two optional limits — which are
 * written only when set, so a component at its defaults produces a small,
 * diff-friendly payload (§79). Nothing else exists to write: `MotionComponent`
 * is state only, and `host` is the registry's to assign (§6a).
 *
 * For {@link KinematicController}, nothing — see
 * {@link KINEMATIC_CONTROLLER_SERIALIZER} for why an empty payload is the
 * complete answer for that class rather than an omission.
 *
 * For {@link OrbitRig}, {@link FollowRig} and {@link LookAtConstraint}, the
 * authored configuration and **not** the live target, for two reasons that
 * apply to all three:
 *
 * - A `Node` target is a live object reference. A serializer is handed
 *   `(data, node)` and there is no id-resolution pass in §79's component
 *   protocol, so it has nowhere to write "the node with id `player`" that
 *   anything would read back — the same wall `KINEMATIC_CONTROLLER_SERIALIZER`
 *   meets with a §13 `Trajectory` held by reference. A `Vector3` target *is*
 *   document content and is written; a node target is dropped, and the
 *   application re-binds it after the load, which is one line at the same place
 *   it bound it the first time.
 * - A spring round-trips in **coefficient** form (`stiffness`, `damping`),
 *   never as `frequencyHz`/`dampingRatio`. Both describe the same spring, but
 *   the frequency form goes through `√stiffness` and a division by `2π` on the
 *   way out and multiplies them back on the way in, so a round trip would move
 *   the last bits of a smoother's tuning for no reason. The coefficients are
 *   what the class stores, so writing them is bit-exact.
 *
 * ## The corrupt-field policy (decision, R-36 rig half)
 *
 * Reading is **total for shape** and **refusing for range**, which are different
 * failures. A field that is missing or is not a number at all restores to its
 * documented default, exactly as `MOTION_COMPONENT_SERIALIZER` does: an older
 * build's payload or a hand-edited file is a shape disagreement, and §79's
 * extensibility goal is better served by tolerating it. A field that carries a
 * perfectly good number the class refuses — a negative `distance`, a `minPitch`
 * above its `maxPitch` — is not a shape disagreement but a rig that cannot
 * exist, and the constructor's §85 refusal is allowed to stand. Substituting a
 * default there would put a camera somewhere the document never asked for and
 * say nothing about it.
 */

import type { JsonValue } from "@four/core";
import { Vector3 } from "@four/math";

import {
  DEFAULT_ORBIT_MIN_DISTANCE,
  DEFAULT_ORBIT_PITCH_LIMIT,
  FollowRig,
  OrbitRig,
} from "./camera-rigs.js";
import {
  CharacterController,
  DEFAULT_CHARACTER_GRAVITY,
  DEFAULT_FIRST_PERSON_PITCH_LIMIT,
  FirstPersonLook,
} from "./character-controller.js";
import { LookAtConstraint } from "./constraints.js";
import { KinematicController } from "./kinematic-controller.js";
import { MotionComponent } from "./motion-component.js";
import type { RigTarget } from "./rig-target.js";
import { SpringDamper } from "./spring-damper.js";

/**
 * The structural shape of `@four/serialization`'s `ComponentSerializer<T>`.
 *
 * Declared with **method syntax**, exactly as the original is, because
 * TypeScript's methods are bivariant in their parameters — which is what lets a
 * serializer for one concrete component type be stored in a registry that hands
 * out serializers for `Component`. `node` is `unknown` rather than `Node`: this
 * serializer does not use it, and `unknown` accepts whatever the registry
 * passes.
 */
export interface ComponentSerializerShape<T> {
  /** Produces the component's payload; must be representable JSON. */
  serialize(component: T): JsonValue;
  /** Rebuilds the component from a payload. Attaching is the caller's job. */
  deserialize(data: JsonValue, node: unknown): T;
}

/** A `Vector3` as the three finite numbers §79's document carries. */
function vectorJson(v: Vector3): JsonValue {
  return { x: v.x, y: v.y, z: v.z };
}

/** Reads a vector payload into `out`, defaulting every absent component to 0. */
function readVector(value: JsonValue | undefined, out: Vector3): Vector3 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return out.set(0, 0, 0);
  }
  const record = value as { readonly [key: string]: JsonValue };
  return out.set(
    typeof record.x === "number" ? record.x : 0,
    typeof record.y === "number" ? record.y : 0,
    typeof record.z === "number" ? record.z : 0,
  );
}

/** Reads a finite number, or `fallback` for anything else. */
function readNumber(value: JsonValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The §79 serializer for {@link MotionComponent} (§11, PH-17).
 *
 * ```ts
 * import { MotionComponent, MOTION_COMPONENT_SERIALIZER } from "@four/motion";
 *
 * registry.register(MotionComponent, MOTION_COMPONENT_SERIALIZER);
 * ```
 *
 * Reading is deliberately **total**: a field the document does not carry (an
 * older build's payload, a hand-edited file) restores to the §11 default rather
 * than throwing, because a motion component with a missing damping rate is a
 * component at zero damping and not a corrupt document. A field carrying
 * something that is not a number is treated the same way — the document
 * validator has already refused everything JSON cannot represent, so what is
 * left is a shape disagreement, and §79's extensibility goal is better served
 * by tolerating it than by refusing the whole scene.
 *
 * `maxSpeed` and `maxAngularSpeed` are absent-means-unset on both sides: an
 * absent key restores a component with no limit, which is not the same as a
 * limit of zero (that would freeze the node).
 */
export const MOTION_COMPONENT_SERIALIZER: ComponentSerializerShape<MotionComponent> =
  {
    serialize(component: MotionComponent): JsonValue {
      const payload: Record<string, JsonValue> = {
        linearVelocity: vectorJson(component.linearVelocity),
        angularVelocity: vectorJson(component.angularVelocity),
        linearAcceleration: vectorJson(component.linearAcceleration),
        angularAcceleration: vectorJson(component.angularAcceleration),
        damping: component.damping,
        angularDamping: component.angularDamping,
      };
      if (component.maxSpeed !== undefined) {
        payload.maxSpeed = component.maxSpeed;
      }
      if (component.maxAngularSpeed !== undefined) {
        payload.maxAngularSpeed = component.maxAngularSpeed;
      }
      return payload;
    },

    deserialize(data: JsonValue): MotionComponent {
      const record =
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? (data as { readonly [key: string]: JsonValue })
          : {};
      const component = new MotionComponent({
        damping: readNumber(record.damping, 0),
        angularDamping: readNumber(record.angularDamping, 0),
      });
      readVector(record.linearVelocity, component.linearVelocity);
      readVector(record.angularVelocity, component.angularVelocity);
      readVector(record.linearAcceleration, component.linearAcceleration);
      readVector(record.angularAcceleration, component.angularAcceleration);
      if (typeof record.maxSpeed === "number") {
        component.maxSpeed = record.maxSpeed;
      }
      if (typeof record.maxAngularSpeed === "number") {
        component.maxAngularSpeed = record.maxAngularSpeed;
      }
      return component;
    },
  };

/**
 * The §79 serializer for {@link KinematicController} (§12, 2026-08-07).
 *
 * ```ts
 * import { KinematicController, KINEMATIC_CONTROLLER_SERIALIZER } from "@four/motion";
 *
 * registry.register(KinematicController, KINEMATIC_CONTROLLER_SERIALIZER);
 * ```
 *
 * or, from an application, one call: `registerSceneNodeTypes()` in the umbrella
 * `four` package registers it alongside every other component the engine ships.
 *
 * ## Why it exists at all
 *
 * `serializeComponents` **throws** for a component with no registered
 * serializer (A-15, 2026-08-06), which turned "this scene contains a
 * `KinematicController`" into a `serializeScene` that could not save the scene
 * at all. Four of the five shipped components had a serializer; this is the
 * fifth. `packages/four/tests/scene-serializers.test.ts` now enumerates every
 * exported class carrying a `static typeName` and asserts each one is
 * registered, so the sixth component cannot be forgotten the same way.
 *
 * ## Why the payload is empty, and why that is complete (decision)
 *
 * A `KinematicController` takes no constructor options: every field it owns is
 * written by `moveTo`, `rotateTo`, `followPath`, or a cancel. So its persistent
 * scene content is precisely the fact that it is attached — the payload `{}` is
 * a *complete* description of a freshly constructed controller, not a lossy
 * summary of a configured one.
 *
 * What is deliberately not carried is the **in-flight command**, and there are
 * two independent reasons:
 *
 * - §79 keeps simulation state out of a scene document ("physics state,
 *   animation state, and replay data must be separate optional sections"), and
 *   a half-finished move is exactly that: `@four/physics`'s serializers draw
 *   the same line with the same words ("a document is a scene, not a
 *   simulation"). The node's transform *is* saved, so a scene saved mid-move
 *   reloads with the node where the move had got to, standing still.
 * - `followPath` holds a §13 {@link Trajectory} **by reference** — a live
 *   object with a `samplePosition` function, which no JSON document can carry
 *   and which §79's resource rule (documents reference resources by logical
 *   key) has nowhere to name. A serializer that wrote the other two channels
 *   and dropped this one would restore *some* commands and not others, which is
 *   worse than restoring none: the round trip would depend on which of three
 *   methods the author happened to call last.
 *
 * Carrying commands would therefore need a trajectory resource table and a
 * document version that can express one; the seam for it is this function, not
 * the format.
 *
 * Reading is total, like `MOTION_COMPONENT_SERIALIZER`'s: whatever the document
 * carries — `{}`, a payload from a future build that does record commands,
 * `null` — restores an idle controller rather than refusing the scene.
 */
export const KINEMATIC_CONTROLLER_SERIALIZER: ComponentSerializerShape<KinematicController> =
  {
    serialize(): JsonValue {
      return {};
    },

    deserialize(): KinematicController {
      return new KinematicController();
    },
  };

/** The payload record of a §79 component document, or `{}` for anything else. */
function readRecord(data: JsonValue): { readonly [key: string]: JsonValue } {
  return typeof data === "object" && data !== null && !Array.isArray(data)
    ? (data as { readonly [key: string]: JsonValue })
    : {};
}

/**
 * Reads a rig target: a `Vector3` when the document carries a point, `null`
 * otherwise — including for the node target a writer dropped (see the module
 * note).
 */
function readTarget(value: JsonValue | undefined): Vector3 | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return readVector(value, new Vector3());
}

/**
 * Writes a rig target: the point, or nothing at all for a live node reference.
 *
 * `undefined` rather than `null` so the caller can omit the key entirely — an
 * absent target and a target that was dropped are the same thing to a reader,
 * and §79 prefers the smaller document.
 */
function targetJson(target: RigTarget | null): JsonValue | undefined {
  return target instanceof Vector3 ? vectorJson(target) : undefined;
}

/**
 * The §79 serializer for {@link OrbitRig} (§44, 2026-08-13).
 *
 * ```ts
 * import { OrbitRig, ORBIT_RIG_SERIALIZER } from "@four/motion";
 *
 * registry.register(OrbitRig, ORBIT_RIG_SERIALIZER);
 * ```
 *
 * or, from an application, one call: `registerSceneNodeTypes()` in the umbrella
 * `four` package registers it alongside every other component the engine ships.
 *
 * The **limits are written**, not only the live angles, because they are
 * constructor arguments: a reader that restored `yaw`/`pitch`/`distance` into a
 * rig built with the *default* limits would silently re-clamp a rig authored
 * with wider ones, moving the camera on load. `maxDistance` is omitted when it
 * is `Infinity` (JSON has no infinity, and absent already means unbounded), and
 * the two counters — `pitchLimitHits`, `skippedSteps` — are diagnostics of a run
 * rather than scene content, so they are not carried and restore to zero.
 */
export const ORBIT_RIG_SERIALIZER: ComponentSerializerShape<OrbitRig> = {
  serialize(component: OrbitRig): JsonValue {
    const payload: Record<string, JsonValue> = {
      yaw: component.yaw,
      pitch: component.pitch,
      distance: component.distance,
      minPitch: component.minPitch,
      maxPitch: component.maxPitch,
      minDistance: component.minDistance,
    };
    if (Number.isFinite(component.maxDistance)) {
      payload.maxDistance = component.maxDistance;
    }
    const target = targetJson(component.target);
    if (target !== undefined) {
      payload.target = target;
    }
    return payload;
  },

  deserialize(data: JsonValue): OrbitRig {
    const record = readRecord(data);
    const rig = new OrbitRig({
      yaw: readNumber(record.yaw, 0),
      pitch: readNumber(record.pitch, 0),
      distance: readNumber(record.distance, 1),
      minPitch: readNumber(record.minPitch, -DEFAULT_ORBIT_PITCH_LIMIT),
      maxPitch: readNumber(record.maxPitch, DEFAULT_ORBIT_PITCH_LIMIT),
      minDistance: readNumber(record.minDistance, DEFAULT_ORBIT_MIN_DISTANCE),
      maxDistance: readNumber(record.maxDistance, Number.POSITIVE_INFINITY),
    });
    rig.target = readTarget(record.target);
    return rig;
  },
};

/**
 * The §79 serializer for {@link FollowRig} (§44, 2026-08-13).
 *
 * ```ts
 * import { FollowRig, FOLLOW_RIG_SERIALIZER } from "@four/motion";
 *
 * registry.register(FollowRig, FOLLOW_RIG_SERIALIZER);
 * ```
 *
 * The spring is written as `{ stiffness, damping }` when there is one and
 * omitted when there is not — absent means "snaps", which is a different rig,
 * not a rig with a very stiff spring. The smoother's *state* (its captured
 * position and velocity) is not carried: §79 keeps simulation state out of a
 * scene document, and a reloaded rig captures its state again on its first step
 * from wherever the node was saved, which is the same thing a fresh rig does.
 */
export const FOLLOW_RIG_SERIALIZER: ComponentSerializerShape<FollowRig> = {
  serialize(component: FollowRig): JsonValue {
    const payload: Record<string, JsonValue> = {
      offset: vectorJson(component.offset),
      frame: component.frame,
    };
    const spring = component.spring;
    if (spring !== null) {
      payload.spring = { stiffness: spring.stiffness, damping: spring.damping };
    }
    const target = targetJson(component.target);
    if (target !== undefined) {
      payload.target = target;
    }
    return payload;
  },

  deserialize(data: JsonValue): FollowRig {
    const record = readRecord(data);
    const spring = readRecord(record.spring ?? null);
    const rig = new FollowRig({
      offset: readVector(record.offset, new Vector3()),
      frame: record.frame === "target" ? "target" : "world",
      spring:
        typeof spring.stiffness === "number"
          ? new SpringDamper({
              stiffness: spring.stiffness,
              damping: readNumber(spring.damping, 0),
            })
          : undefined,
    });
    rig.target = readTarget(record.target);
    return rig;
  },
};

/**
 * The §79 serializer for {@link LookAtConstraint} (§12, 2026-08-13).
 *
 * ```ts
 * import { LookAtConstraint, LOOK_AT_CONSTRAINT_SERIALIZER } from "@four/motion";
 *
 * registry.register(LookAtConstraint, LOOK_AT_CONSTRAINT_SERIALIZER);
 * ```
 *
 * `up` is always written — it is a direction the aim depends on, and a document
 * that omitted it would restore a differently-rolled camera under any non-default
 * convention — while `maxAngularSpeed` is absent-means-unlimited on both sides,
 * as `MotionComponent`'s limits are. `skippedSteps` is a diagnostic of a run and
 * is not carried.
 */
export const LOOK_AT_CONSTRAINT_SERIALIZER: ComponentSerializerShape<LookAtConstraint> =
  {
    serialize(component: LookAtConstraint): JsonValue {
      const payload: Record<string, JsonValue> = {
        up: vectorJson(component.up),
      };
      if (component.maxAngularSpeed !== undefined) {
        payload.maxAngularSpeed = component.maxAngularSpeed;
      }
      const target = targetJson(component.target);
      if (target !== undefined) {
        payload.target = target;
      }
      return payload;
    },

    deserialize(data: JsonValue): LookAtConstraint {
      const record = readRecord(data);
      const constraint = new LookAtConstraint({
        up: readVector(record.up, new Vector3(0, 1, 0)),
        maxAngularSpeed:
          typeof record.maxAngularSpeed === "number"
            ? record.maxAngularSpeed
            : undefined,
      });
      constraint.target = readTarget(record.target);
      return constraint;
    },
  };

/**
 * The §79 serializer for {@link CharacterController} (§12, PH-11 residue,
 * 2026-08-21).
 *
 * ```ts
 * import { CharacterController, CHARACTER_CONTROLLER_SERIALIZER } from "@four/motion";
 *
 * registry.register(CharacterController, CHARACTER_CONTROLLER_SERIALIZER);
 * ```
 *
 * The whole configuration is written, plus the **vertical motion state** —
 * `verticalVelocity` and `grounded` — and nothing else. The split is the
 * `KINEMATIC_CONTROLLER_SERIALIZER` rule applied to a class that has both kinds
 * of state:
 *
 * - Vertical motion is *scene* state. A character saved mid-jump is at a
 *   height the document already carries, moving at a speed nothing else can
 *   reconstruct, so a document that dropped it would restore the character
 *   hanging in the air and then let it fall from rest.
 * - The **move intent is not**. It is this frame's input — the same live,
 *   per-step quantity as an in-flight `moveTo` command, and §79 documents do
 *   not carry the player's thumb. It restores at `(0, 0)`, and the application
 *   writes the next one on the next step exactly where it wrote the last.
 *
 * `maxFallSpeed` is written only when finite: `Infinity` is not JSON, and its
 * absence is already the class's "no terminal velocity" default on both sides.
 * `skippedSteps` is a diagnostic of a run and is not carried.
 */
export const CHARACTER_CONTROLLER_SERIALIZER: ComponentSerializerShape<CharacterController> =
  {
    serialize(component: CharacterController): JsonValue {
      const payload: Record<string, JsonValue> = {
        yaw: component.yaw,
        moveSpeed: component.moveSpeed,
        gravity: component.gravity,
        groundHeight: component.groundHeight,
        jumpSpeed: component.jumpSpeed,
        verticalVelocity: component.verticalVelocity,
        grounded: component.grounded,
      };
      if (Number.isFinite(component.maxFallSpeed)) {
        payload.maxFallSpeed = component.maxFallSpeed;
      }
      return payload;
    },

    deserialize(data: JsonValue): CharacterController {
      const record = readRecord(data);
      return new CharacterController({
        yaw: readNumber(record.yaw, 0),
        moveSpeed: readNumber(record.moveSpeed, 1),
        gravity: readNumber(record.gravity, DEFAULT_CHARACTER_GRAVITY),
        groundHeight: readNumber(record.groundHeight, 0),
        jumpSpeed: readNumber(record.jumpSpeed, 4),
        maxFallSpeed: readNumber(record.maxFallSpeed, Number.POSITIVE_INFINITY),
        verticalVelocity: readNumber(record.verticalVelocity, 0),
        grounded: record.grounded === true,
      });
    },
  };

/**
 * The §79 serializer for {@link FirstPersonLook} (§44, PH-11 residue,
 * 2026-08-21).
 *
 * ```ts
 * import { FirstPersonLook, FIRST_PERSON_LOOK_SERIALIZER } from "@four/motion";
 *
 * registry.register(FirstPersonLook, FIRST_PERSON_LOOK_SERIALIZER);
 * ```
 *
 * The pitch and both limits, for `ORBIT_RIG_SERIALIZER`'s reason: the limits
 * are `readonly`, so the reader has to **construct** with them, and a document
 * that dropped them would restore a differently-bounded eye that clamps a
 * perfectly good saved pitch. `pitchLimitHits` is a diagnostic of a run and is
 * not carried.
 */
export const FIRST_PERSON_LOOK_SERIALIZER: ComponentSerializerShape<FirstPersonLook> =
  {
    serialize(component: FirstPersonLook): JsonValue {
      return {
        pitch: component.pitch,
        minPitch: component.minPitch,
        maxPitch: component.maxPitch,
      };
    },

    deserialize(data: JsonValue): FirstPersonLook {
      const record = readRecord(data);
      return new FirstPersonLook({
        pitch: readNumber(record.pitch, 0),
        minPitch: readNumber(
          record.minPitch,
          -DEFAULT_FIRST_PERSON_PITCH_LIMIT,
        ),
        maxPitch: readNumber(record.maxPitch, DEFAULT_FIRST_PERSON_PITCH_LIMIT),
      });
    },
  };
