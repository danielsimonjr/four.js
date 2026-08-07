/**
 * The §79 serializer for this package's component (PH-17, 2026-08-06).
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
 * Everything §11 declares: both velocities, both accelerations, both damping
 * rates, and the two optional limits — which are written only when set, so a
 * component at its defaults produces a small, diff-friendly payload (§79).
 * Nothing else exists to write: `MotionComponent` is state only, and `host` is
 * the registry's to assign (§6a).
 */

import type { JsonValue } from "@four/core";
import { Vector3 } from "@four/math";

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
