/**
 * The §79 serializers for this package's two components (PH-17, 2026-08-06;
 * `KinematicController` added 2026-08-07).
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
 */

import type { JsonValue } from "@four/core";
import { Vector3 } from "@four/math";

import { KinematicController } from "./kinematic-controller.js";
import { MotionComponent } from "./motion-component.js";

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
