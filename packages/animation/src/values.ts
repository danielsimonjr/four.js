/**
 * Value adapters (§16 property bindings, §17 track value types).
 *
 * An animation track knows *when* a value changes; an adapter knows *how* a
 * value of one particular type is copied, cloned, and interpolated. Everything
 * downstream — bindings ({@link ./binding.js}), tweens, clip tracks, the mixer —
 * is written once against {@link ValueAdapter} instead of once per value type.
 *
 * ## The `out` parameter, honestly (§7b, plan D7)
 *
 * §7b's out-parameter convention exists so that steady-state per-frame code
 * allocates nothing. It works for *reference* types: `lerp` writes its result
 * into the caller's object and returns it. It cannot work for *primitives* —
 * a `number` or a `boolean` has no storage the callee can write through, and a
 * discrete value of arbitrary type can only be handed back by reference.
 *
 * Rather than pretend, this module states the split in the contract:
 *
 * - every result-producing method **returns the effective value**, and callers
 *   must use the return value: `current = adapter.lerp(a, b, t, current)`;
 * - {@link ValueAdapter.mutatesInPlace} says which mechanism actually happened.
 *   `true` (Vector2/3/4, Quaternion, color): `out` was written in place and is
 *   the returned object. `false` (number, boolean, discrete): `out` was ignored
 *   and the return value is the whole result.
 *
 * Consumers that hold live references — {@link ./binding.js} above all — branch
 * on `mutatesInPlace` once, at setup, and never again per frame.
 *
 * Neither branch allocates: the reference types write into caller storage, the
 * primitives have nothing to allocate. Only {@link ValueAdapter.clone} does.
 *
 * ## Aliasing
 *
 * For the in-place adapters `out` **may** alias `a` (the common case: the live
 * property is also the interpolation start). `out` must **not** alias `b`: the
 * vector and quaternion adapters delegate to `@four/math`, which copies `a`
 * into `out` before mixing in `b`, so an `out === b` call would have destroyed
 * `b` first. The color adapter reads each component before writing it and is
 * safe either way, but the contract is stated once for all adapters.
 */

import { Quaternion, Vector2, Vector3, Vector4 } from "@four/math";

/**
 * Discriminator of {@link ValueAdapter}. Mirrors §17's track value types
 * (scalar, vector, quaternion, color, Boolean, discrete); the vector entry is
 * split by arity because the three vector types are distinct classes.
 *
 * Morph-weight and skeletal-joint tracks (§17) are staged for a later phase
 * (plan P4-3) and add their kinds here when they land.
 */
export type ValueKind =
  | "number"
  | "vector2"
  | "vector3"
  | "vector4"
  | "quaternion"
  | "color"
  | "boolean"
  | "discrete";

/**
 * Straight (non-premultiplied) RGBA as a mutable 4-tuple — the materials-side
 * color convention (plan P4-2).
 *
 * Declared here rather than imported: `@four/animation` may not depend on
 * `@four/materials` (plan §3.1), so the type is described structurally. It is
 * identical to `ColorRGBA` in `@four/materials`, and values pass between the
 * two without conversion.
 *
 * Components are **not clamped** anywhere in this module: §60a's pipeline is
 * linear-light with extended range, and clamping would silently rewrite
 * authored data mid-tween.
 */
export type ColorRGBA = [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];

/**
 * How one value type is duplicated, assigned, and interpolated.
 *
 * Implementations are stateless singletons, so an adapter can be shared by
 * every binding and track in an application.
 */
export interface ValueAdapter<T> {
  /** Discriminator; also what a diagnostic prints when a binding is dumped. */
  readonly kind: ValueKind;

  /**
   * `true` when {@link ValueAdapter.copy} and {@link ValueAdapter.lerp} write
   * through their target/`out` argument (reference types), `false` when they
   * ignore it and the result flows purely by return value (primitives and
   * discrete values). See this module's header.
   */
  readonly mutatesInPlace: boolean;

  /**
   * Returns an independent copy of `value` — the **only** allocating method in
   * this module, used at setup (capturing a tween's start value) and never per
   * frame. For `mutatesInPlace: false` adapters there is nothing to allocate
   * and the value itself is returned.
   */
  clone(value: T): T;

  /**
   * Assigns `source` to `target` and returns the effective value: the mutated
   * `target` for in-place adapters, `source` itself otherwise. Callers must use
   * the return value.
   */
  copy(source: T, target: T): T;

  /**
   * Interpolates from `a` to `b` by `t` and returns the effective value: the
   * mutated `out` for in-place adapters, the computed value otherwise. Callers
   * must use the return value.
   *
   * `t` is not clamped — values outside `[0, 1]` extrapolate for the continuous
   * kinds, exactly as `@four/math` does — and the step kinds hold `a` for every
   * `t < 1`. Endpoint exactness at `t = 1` is not guaranteed in floating point
   * for the continuous kinds (they compute `a + (b - a) * t`, matching
   * `@four/math`); a tween that must land precisely assigns the end value at
   * completion instead of lerping to it.
   */
  lerp(a: T, b: T, t: number, out: T): T;
}

/**
 * Scalar adapter (§17 "scalar").
 *
 * `out` is ignored — a number cannot be written through. Uses the same
 * `a + (b - a) * t` form as `@four/math`'s vector lerp so a scalar track and a
 * vector track interpolate identically component for component.
 */
export const numberAdapter: ValueAdapter<number> = {
  kind: "number",
  mutatesInPlace: false,
  clone(value: number): number {
    return value;
  },
  copy(source: number): number {
    return source;
  },
  lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  },
};

/** Vector2 adapter (§17 "vector"), delegating to `Vector2.copy`/`Vector2.lerp`. */
export const vector2Adapter: ValueAdapter<Vector2> = {
  kind: "vector2",
  mutatesInPlace: true,
  clone(value: Vector2): Vector2 {
    return value.clone();
  },
  copy(source: Vector2, target: Vector2): Vector2 {
    return target.copy(source);
  },
  lerp(a: Vector2, b: Vector2, t: number, out: Vector2): Vector2 {
    return out.copy(a).lerp(b, t);
  },
};

/** Vector3 adapter (§17 "vector"), delegating to `Vector3.copy`/`Vector3.lerp`. */
export const vector3Adapter: ValueAdapter<Vector3> = {
  kind: "vector3",
  mutatesInPlace: true,
  clone(value: Vector3): Vector3 {
    return value.clone();
  },
  copy(source: Vector3, target: Vector3): Vector3 {
    return target.copy(source);
  },
  lerp(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
    return out.copy(a).lerp(b, t);
  },
};

/** Vector4 adapter (§17 "vector"), delegating to `Vector4.copy`/`Vector4.lerp`. */
export const vector4Adapter: ValueAdapter<Vector4> = {
  kind: "vector4",
  mutatesInPlace: true,
  clone(value: Vector4): Vector4 {
    return value.clone();
  },
  copy(source: Vector4, target: Vector4): Vector4 {
    return target.copy(source);
  },
  lerp(a: Vector4, b: Vector4, t: number, out: Vector4): Vector4 {
    return out.copy(a).lerp(b, t);
  },
};

/**
 * Quaternion adapter (§17 "quaternion", interpolation mode "spherical linear").
 *
 * Delegates to `Quaternion.slerp`, which is shortest-arc: it negates the
 * target's components when the dot product is negative, so an antipodal pair
 * travels the short way round and the result at `t = 1` is `-b` — the same
 * rotation as `b`, with opposite components. Verified against
 * `packages/math/src/quaternion.ts` (plan D8) rather than assumed.
 */
export const quaternionAdapter: ValueAdapter<Quaternion> = {
  kind: "quaternion",
  mutatesInPlace: true,
  clone(value: Quaternion): Quaternion {
    return value.clone();
  },
  copy(source: Quaternion, target: Quaternion): Quaternion {
    return target.copy(source);
  },
  lerp(a: Quaternion, b: Quaternion, t: number, out: Quaternion): Quaternion {
    return out.copy(a).slerp(b, t);
  },
};

/**
 * Color adapter (§17 "color") over the RGBA 4-tuple (plan P4-2).
 *
 * Component-wise linear interpolation of straight (non-premultiplied) RGBA with
 * **no clamping** (§60a extended range) and no color-space conversion: the
 * tuple carries no space, so mixing happens in whatever space the author wrote,
 * and §60a's transfer functions stay a rendering concern.
 *
 * Alpha is interpolated like any other component. Each component is read before
 * it is written, so this adapter tolerates `out` aliasing either endpoint.
 */
export const colorAdapter: ValueAdapter<ColorRGBA> = {
  kind: "color",
  mutatesInPlace: true,
  clone(value: ColorRGBA): ColorRGBA {
    return [value[0], value[1], value[2], value[3]];
  },
  copy(source: ColorRGBA, target: ColorRGBA): ColorRGBA {
    target[0] = source[0];
    target[1] = source[1];
    target[2] = source[2];
    target[3] = source[3];
    return target;
  },
  lerp(a: ColorRGBA, b: ColorRGBA, t: number, out: ColorRGBA): ColorRGBA {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    out[3] = a[3] + (b[3] - a[3]) * t;
    return out;
  },
};

/**
 * Step interpolation shared by the two discontinuous kinds (§17 interpolation
 * mode "step"): hold `a` for every `t < 1` — including negative `t` from
 * extrapolation — and switch to `b` at exactly `t = 1` and beyond.
 *
 * The switch sits at the *end* of the interval rather than the midpoint so that
 * a step track holds each keyframe's value until the next keyframe is reached,
 * which is what "step" means for a clip.
 */
function stepLerp<T>(a: T, b: T, t: number): T {
  return t >= 1 ? b : a;
}

/**
 * Boolean adapter (§17 "Boolean"). Step semantics; `out` is ignored, as for
 * every primitive.
 */
export const booleanAdapter: ValueAdapter<boolean> = {
  kind: "boolean",
  mutatesInPlace: false,
  clone(value: boolean): boolean {
    return value;
  },
  copy(source: boolean): boolean {
    return source;
  },
  lerp(a: boolean, b: boolean, t: number): boolean {
    return stepLerp(a, b, t);
  },
};

/**
 * Discrete adapter (§17 "discrete"): arbitrary values — strings, enums, asset
 * handles, objects — carried **by reference** and switched with step semantics.
 *
 * Consequences of "by reference", stated rather than hidden:
 *
 * - `clone` returns the same reference. There is no generic deep copy, and a
 *   shallow one would be a lie for most payloads; a discrete keyframe value is
 *   therefore shared, not owned, by whatever it is assigned to.
 * - `copy` and `lerp` ignore their target/`out` and return `source`/`a`/`b`, so
 *   `mutatesInPlace` is `false` and a binding **assigns** the property rather
 *   than writing through the previous value.
 *
 * Never returned by {@link detectAdapter} — see there.
 */
export const discreteAdapter: ValueAdapter<unknown> = {
  kind: "discrete",
  mutatesInPlace: false,
  clone(value: unknown): unknown {
    return value;
  },
  copy(source: unknown): unknown {
    return source;
  },
  lerp(a: unknown, b: unknown, t: number): unknown {
    return stepLerp(a, b, t);
  },
};

/**
 * Typed view of {@link discreteAdapter} for a known value type — the single
 * stateless instance is returned, nothing is constructed. Use it when the
 * discrete payload has a real type (`ValueAdapter<"idle" | "run">`) and the
 * `unknown` of the shared instance would infect the call site.
 */
export function discreteAdapterFor<T>(): ValueAdapter<T> {
  return discreteAdapter as ValueAdapter<T>;
}

/** True when `value` is a 4-element array of numbers — the color shape. */
function isColorTuple(value: unknown): value is ColorRGBA {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    typeof value[2] === "number" &&
    typeof value[3] === "number"
  );
}

/**
 * Picks the adapter for a value by inspecting its structure. Returns
 * `undefined` when no adapter fits, so callers decide whether that is an error
 * ({@link ./binding.js} throws) or a reason to fall back.
 *
 * Detection is by `instanceof` for the math classes and by `typeof` for the
 * primitives. Two deliberate exclusions:
 *
 * - **Discrete is never detected.** Every value that reaches here is "some
 *   object", so a discrete fallback would swallow typos — a binding to a
 *   misspelled property that happens to hold a `Transform` would silently
 *   step-animate it. Discrete is opt-in: pass {@link discreteAdapterFor} to
 *   `createBinding`.
 * - **`null` and `undefined` are not detected.** There is nothing to inspect,
 *   and a track whose value type only becomes known later is a bug at binding
 *   time, not a case to guess at.
 *
 * ### The `number[4]` ambiguity
 *
 * A four-number array is reported as `"color"` even when the author meant a
 * plain numeric quadruple (a generic parameter block, a UV rect). The ambiguity
 * is unresolvable from structure alone — the two are the same runtime shape —
 * so it is resolved by consequence: {@link colorAdapter} is a plain
 * component-wise lerp with no clamping and no color-space handling, which is
 * *exactly* what a generic `number[4]` wants too. The two interpretations
 * therefore differ only in the reported {@link ValueKind}, and a caller who
 * needs that distinction (a diagnostic, a serializer) passes an explicit
 * adapter instead of relying on detection. Arrays of any other length, and
 * 4-arrays with a non-number element, are not detected at all.
 */
export function detectAdapter(
  value: unknown,
): ValueAdapter<unknown> | undefined {
  switch (typeof value) {
    case "number":
      return numberAdapter;
    case "boolean":
      return booleanAdapter;
    default:
      break;
  }
  if (value instanceof Vector3) {
    return vector3Adapter;
  }
  if (value instanceof Quaternion) {
    return quaternionAdapter;
  }
  if (value instanceof Vector2) {
    return vector2Adapter;
  }
  if (value instanceof Vector4) {
    return vector4Adapter;
  }
  if (isColorTuple(value)) {
    return colorAdapter;
  }
  return undefined;
}
