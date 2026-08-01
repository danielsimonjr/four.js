/**
 * Easing functions (§15).
 *
 * §15 requires twelve easing families — linear, quadratic, cubic, quartic,
 * quintic, sine, exponential, circular, back, bounce, elastic, spring — and
 * spells easing selection as a string (`"cubic-out"`). This module provides
 * both: every family as a plain function, and {@link resolveEasing} to turn a
 * {@link EasingName} into one.
 *
 * ## Contract
 *
 * An {@link EasingFunction} maps normalized *progress* to normalized *value*:
 *
 * ```text
 * ease : [0, 1] → ℝ,  ease(0) === 0,  ease(1) === 1
 * ```
 *
 * The endpoints are exact in floating point, not approximate — a tween that
 * ends at `t = 1` lands exactly on its target value for every easing here. A
 * few closed forms drift by one or two ulp at an endpoint (sine-in, all
 * exponentials, back-in/out, all elastics); those functions test for `t === 0` /
 * `t === 1` explicitly and return the exact value. Where a formula is already
 * exact no guard is added, and the tests assert exactness for all of them, so a
 * later change of constants cannot silently reintroduce drift.
 *
 * Values **between** the endpoints may leave `[0, 1]`: back, elastic and spring
 * undershoot before they start and overshoot before they settle. That is the
 * point of those curves and nothing here clamps them. Callers that cannot
 * tolerate out-of-range values (a normalized colour channel, an opacity) clamp
 * at the point of use or pick a monotone family.
 *
 * Input outside `[0, 1]` is not part of the contract: the functions are total
 * (they return a number for any finite input) but only the unit interval is
 * specified, and callers are expected to clamp progress before easing it.
 *
 * ## Purity and determinism (§33)
 *
 * Every function here is pure: no state between calls, no clock, no RNG,
 * allocation-free. The same `t` always produces the same number, which is what
 * makes timeline scrubbing (§16) and replay (§34) reproducible.
 *
 * ## Naming
 *
 * Keys are the §15 family names verbatim, suffixed with the variant:
 * `"quadratic-in"`, `"quadratic-out"`, `"quadratic-in-out"`, and so on.
 * `"linear"` is bare — it has no variants, since all three would be the
 * identity. The exported functions follow the same shape in camelCase
 * (`quadraticIn`, `exponentialInOut`, …).
 *
 * ## References
 *
 * The polynomial, sine, exponential, circular, back, bounce and elastic forms
 * are the canonical Penner easing equations (Robert Penner, *Programming
 * Macromedia Flash MX*, 2002), in the normalized `t ∈ [0, 1]` form. The spring
 * curve is a damped-oscillator step response; see {@link springOut}.
 */

import { FourError } from "@four/core";

/**
 * Maps progress in `[0, 1]` to an eased value, `ease(0) === 0` and
 * `ease(1) === 1`.
 *
 * Pure: no state, no allocation, no clock.
 */
export type EasingFunction = (t: number) => number;

// ---------------------------------------------------------------------------
// Pinned constants
// ---------------------------------------------------------------------------

/**
 * Penner's back overshoot `s = 1.70158`, the magnitude of the anticipation
 * dip in {@link backIn} / the settle overshoot in {@link backOut}.
 *
 * The number is not arbitrary: `1.70158` is the value for which the classic
 * back curve overshoots by exactly 10 % of the range. It is pinned as a
 * constant rather than inlined so the three back variants cannot drift apart.
 */
export const BACK_OVERSHOOT = 1.70158;

/**
 * Overshoot used by {@link backInOut}: `BACK_OVERSHOOT · 1.525`.
 *
 * The in-out variant compresses each half into half the interval, which halves
 * the visible overshoot; Penner's `1.525` factor restores it. Written as a
 * derived constant so changing {@link BACK_OVERSHOOT} keeps the family
 * consistent.
 */
export const BACK_OVERSHOOT_IN_OUT = BACK_OVERSHOOT * 1.525;

/** `BACK_OVERSHOOT + 1`, the cubic coefficient of the back curves. */
const BACK_C3 = BACK_OVERSHOOT + 1;

/**
 * Curvature of every bounce segment (Penner's `7.5625`).
 *
 * Each of the four segments of {@link bounceOut} is the same parabola scaled by
 * this factor; together with {@link BOUNCE_SEGMENT_DIVISOR} it makes the
 * segment boundaries meet at value 1 (a bounce touching the floor).
 */
export const BOUNCE_AMPLITUDE = 7.5625;

/**
 * Bounce segment divisor (Penner's `2.75`). The four segments occupy
 * `[0, 1/2.75)`, `[1/2.75, 2/2.75)`, `[2/2.75, 2.5/2.75)` and `[2.5/2.75, 1]`.
 */
export const BOUNCE_SEGMENT_DIVISOR = 2.75;

/** Peak displacement of the elastic curves, in units of the range. */
export const ELASTIC_AMPLITUDE = 1;

/**
 * Period of the elastic oscillation as a fraction of the duration (Penner's
 * `p = 0.3`): the in and out variants complete `1 / 0.3 ≈ 3.33` oscillations
 * over the unit interval.
 */
export const ELASTIC_PERIOD = 0.3;

/**
 * Period used by {@link elasticInOut} (Penner's `p = 0.45`). Larger than
 * {@link ELASTIC_PERIOD} because the in-out variant packs both halves of the
 * motion into the same interval.
 */
export const ELASTIC_PERIOD_IN_OUT = 0.45;

/** Angular frequency `2π / p` of the elastic in/out curves, in radians. */
const ELASTIC_OMEGA = (2 * Math.PI) / ELASTIC_PERIOD;

/** Phase shift `p / 4` that puts the elastic endpoints on 0 and 1. */
const ELASTIC_PHASE = ELASTIC_PERIOD / 4;

/** Angular frequency `2π / p` of {@link elasticInOut}, in radians. */
const ELASTIC_OMEGA_IN_OUT = (2 * Math.PI) / ELASTIC_PERIOD_IN_OUT;

/** Phase shift `p / 4` for {@link elasticInOut}. */
const ELASTIC_PHASE_IN_OUT = ELASTIC_PERIOD_IN_OUT / 4;

/**
 * Damping ratio `ζ` of the spring curves (underdamped, `0 < ζ < 1`).
 *
 * `0.35` gives a first overshoot of `e^(−πζ/√(1−ζ²)) ≈ 32 %` — springy enough
 * to read as a spring, tame enough that the second overshoot is under 4 %.
 */
export const SPRING_DAMPING_RATIO = 0.35;

/**
 * Number of complete damped oscillations {@link springOut} performs across
 * `t ∈ [0, 1]`, i.e. `ω_d = 2π · SPRING_OSCILLATIONS`.
 */
export const SPRING_OSCILLATIONS = 2;

/** Damped angular frequency `ω_d = 2π · N`, in radians per unit progress. */
const SPRING_DAMPED_OMEGA = 2 * Math.PI * SPRING_OSCILLATIONS;

/**
 * Decay rate `σ = ζ·ωₙ = ζ·ω_d/√(1−ζ²)`, in inverse units of progress.
 * (`ωₙ` is the undamped natural frequency; `ω_d = ωₙ√(1−ζ²)`.)
 */
const SPRING_DECAY =
  (SPRING_DAMPING_RATIO * SPRING_DAMPED_OMEGA) /
  Math.sqrt(1 - SPRING_DAMPING_RATIO * SPRING_DAMPING_RATIO);

/**
 * `1 / (1 − e^(−σ))`, the factor that stretches the spring step response so it
 * reaches exactly 1 at `t = 1` instead of `1 − e^(−σ) ≈ 0.991`. See
 * {@link springOut}.
 */
const SPRING_NORMALIZATION = 1 / (1 - Math.exp(-SPRING_DECAY));

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

/**
 * No easing: `ease(t) = t`.
 *
 * The only family without in/out/in-out variants — all three would be this
 * function — hence its bare registry key `"linear"`.
 */
export const linear: EasingFunction = (t) => t;

// ---------------------------------------------------------------------------
// Polynomials
// ---------------------------------------------------------------------------

/** Quadratic ease-in, `t²`. */
export const quadraticIn: EasingFunction = (t) => t * t;

/** Quadratic ease-out, `1 − (1 − t)²`. */
export const quadraticOut: EasingFunction = (t) => 1 - (1 - t) * (1 - t);

/** Quadratic ease-in-out: {@link quadraticIn} then {@link quadraticOut}. */
export const quadraticInOut: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : 1 - ((2 - 2 * t) * (2 - 2 * t)) / 2;

/** Cubic ease-in, `t³`. */
export const cubicIn: EasingFunction = (t) => t * t * t;

/** Cubic ease-out, `1 − (1 − t)³`. */
export const cubicOut: EasingFunction = (t) => {
  const u = 1 - t;
  return 1 - u * u * u;
};

/** Cubic ease-in-out: {@link cubicIn} then {@link cubicOut}. */
export const cubicInOut: EasingFunction = (t) => {
  if (t < 0.5) {
    return 4 * t * t * t;
  }
  const u = 2 - 2 * t;
  return 1 - (u * u * u) / 2;
};

/** Quartic ease-in, `t⁴`. */
export const quarticIn: EasingFunction = (t) => t * t * t * t;

/** Quartic ease-out, `1 − (1 − t)⁴`. */
export const quarticOut: EasingFunction = (t) => {
  const u = 1 - t;
  return 1 - u * u * u * u;
};

/** Quartic ease-in-out: {@link quarticIn} then {@link quarticOut}. */
export const quarticInOut: EasingFunction = (t) => {
  if (t < 0.5) {
    return 8 * t * t * t * t;
  }
  const u = 2 - 2 * t;
  return 1 - (u * u * u * u) / 2;
};

/** Quintic ease-in, `t⁵`. */
export const quinticIn: EasingFunction = (t) => t * t * t * t * t;

/** Quintic ease-out, `1 − (1 − t)⁵`. */
export const quinticOut: EasingFunction = (t) => {
  const u = 1 - t;
  return 1 - u * u * u * u * u;
};

/** Quintic ease-in-out: {@link quinticIn} then {@link quinticOut}. */
export const quinticInOut: EasingFunction = (t) => {
  if (t < 0.5) {
    return 16 * t * t * t * t * t;
  }
  const u = 2 - 2 * t;
  return 1 - (u * u * u * u * u) / 2;
};

// ---------------------------------------------------------------------------
// Sine
// ---------------------------------------------------------------------------

/**
 * Sine ease-in, `1 − cos(πt/2)`.
 *
 * The `t === 1` guard is required: `Math.cos(Math.PI / 2)` is `6.12e-17` rather
 * than 0, so the raw form returns `0.9999999999999999`.
 */
export const sineIn: EasingFunction = (t) =>
  t === 1 ? 1 : 1 - Math.cos((t * Math.PI) / 2);

/** Sine ease-out, `sin(πt/2)`. Exact at both endpoints. */
export const sineOut: EasingFunction = (t) => Math.sin((t * Math.PI) / 2);

/** Sine ease-in-out, `(1 − cos(πt))/2`. Exact at both endpoints. */
export const sineInOut: EasingFunction = (t) => (1 - Math.cos(Math.PI * t)) / 2;

// ---------------------------------------------------------------------------
// Exponential
// ---------------------------------------------------------------------------

/**
 * Exponential ease-in, `2^(10t − 10)`.
 *
 * The curve never actually reaches 0 (`2^-10 = 1/1024` at `t = 0`), so the
 * `t === 0` case is defined to be 0 — the standard Penner treatment.
 */
export const exponentialIn: EasingFunction = (t) =>
  t === 0 ? 0 : Math.pow(2, 10 * t - 10);

/** Exponential ease-out, `1 − 2^(−10t)`, with the mirrored `t === 1` case. */
export const exponentialOut: EasingFunction = (t) =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

/** Exponential ease-in-out: {@link exponentialIn} then {@link exponentialOut}. */
export const exponentialInOut: EasingFunction = (t) => {
  if (t === 0) {
    return 0;
  }
  if (t === 1) {
    return 1;
  }
  return t < 0.5
    ? Math.pow(2, 20 * t - 10) / 2
    : (2 - Math.pow(2, 10 - 20 * t)) / 2;
};

// ---------------------------------------------------------------------------
// Circular
// ---------------------------------------------------------------------------

/** Circular ease-in, `1 − √(1 − t²)` — the lower-left quarter circle. */
export const circularIn: EasingFunction = (t) => 1 - Math.sqrt(1 - t * t);

/** Circular ease-out, `√(1 − (t − 1)²)` — the upper-right quarter circle. */
export const circularOut: EasingFunction = (t) =>
  Math.sqrt(1 - (t - 1) * (t - 1));

/** Circular ease-in-out: {@link circularIn} then {@link circularOut}. */
export const circularInOut: EasingFunction = (t) => {
  if (t < 0.5) {
    const u = 2 * t;
    return (1 - Math.sqrt(1 - u * u)) / 2;
  }
  const u = 2 - 2 * t;
  return (Math.sqrt(1 - u * u) + 1) / 2;
};

// ---------------------------------------------------------------------------
// Back
// ---------------------------------------------------------------------------

/**
 * Back ease-in, `(s + 1)t³ − s·t²` with `s = ` {@link BACK_OVERSHOOT}.
 *
 * Dips below 0 early (anticipation) before accelerating to 1. The `t === 1`
 * guard is required: `(s + 1) − s` rounds to `0.9999999999999998` for the
 * pinned `s`.
 */
export const backIn: EasingFunction = (t) =>
  t === 1 ? 1 : BACK_C3 * t * t * t - BACK_OVERSHOOT * t * t;

/**
 * Back ease-out, `1 + (s + 1)(t − 1)³ + s(t − 1)²`.
 *
 * Overshoots past 1 before settling. The `t === 0` guard is required:
 * `1 − (s + 1) + s` rounds to `2.22e-16` for the pinned `s`.
 */
export const backOut: EasingFunction = (t) => {
  if (t === 0) {
    return 0;
  }
  const u = t - 1;
  return 1 + BACK_C3 * u * u * u + BACK_OVERSHOOT * u * u;
};

/**
 * Back ease-in-out: anticipation at the start, overshoot at the end, using
 * {@link BACK_OVERSHOOT_IN_OUT}. Exact at both endpoints.
 */
export const backInOut: EasingFunction = (t) => {
  if (t === 0) {
    // The low branch would return -0 here (`0 * -s`). Signed zero is `=== 0`
    // and would animate correctly, but it survives arithmetic (`-0 * x`,
    // `1 / -0`) and shows up in snapshots and checksums (§33), so the exact
    // `+0` is returned instead.
    return 0;
  }
  const s = BACK_OVERSHOOT_IN_OUT;
  if (t < 0.5) {
    const u = 2 * t;
    return (u * u * ((s + 1) * u - s)) / 2;
  }
  const u = 2 * t - 2;
  return (u * u * ((s + 1) * u + s) + 2) / 2;
};

// ---------------------------------------------------------------------------
// Bounce
// ---------------------------------------------------------------------------

/**
 * Bounce ease-out: four parabolic arcs of decreasing height, as if the value
 * were dropped onto 1 and bounced.
 *
 * Not monotone — the value falls back after each touch. The segment
 * boundaries and offsets come from {@link BOUNCE_AMPLITUDE} /
 * {@link BOUNCE_SEGMENT_DIVISOR}; the offsets `0.75`, `0.9375`, `0.984375` are
 * `1 − 1/4`, `1 − 1/16`, `1 − 1/64`, the successive bounce heights.
 */
export const bounceOut: EasingFunction = (t) => {
  const n = BOUNCE_AMPLITUDE;
  const d = BOUNCE_SEGMENT_DIVISOR;
  if (t < 1 / d) {
    return n * t * t;
  }
  if (t < 2 / d) {
    const u = t - 1.5 / d;
    return n * u * u + 0.75;
  }
  if (t < 2.5 / d) {
    const u = t - 2.25 / d;
    return n * u * u + 0.9375;
  }
  const u = t - 2.625 / d;
  return n * u * u + 0.984375;
};

/** Bounce ease-in: {@link bounceOut} mirrored, `1 − bounceOut(1 − t)`. */
export const bounceIn: EasingFunction = (t) => 1 - bounceOut(1 - t);

/** Bounce ease-in-out: {@link bounceIn} for the first half, {@link bounceOut} for the second. */
export const bounceInOut: EasingFunction = (t) =>
  t < 0.5 ? (1 - bounceOut(1 - 2 * t)) / 2 : (1 + bounceOut(2 * t - 1)) / 2;

// ---------------------------------------------------------------------------
// Elastic
// ---------------------------------------------------------------------------

/**
 * Elastic ease-in: an exponentially *growing* sine, so the value wobbles around
 * 0 before snapping to 1.
 *
 * ```text
 * ease(t) = −a · 2^(10t − 10) · sin((t − 1 − p/4) · 2π/p)
 * ```
 *
 * with `a = ` {@link ELASTIC_AMPLITUDE} and `p = ` {@link ELASTIC_PERIOD}. Both
 * endpoint guards are required: the raw form gives `−4.88e-4` at `t = 0`.
 */
export const elasticIn: EasingFunction = (t) => {
  if (t === 0) {
    return 0;
  }
  if (t === 1) {
    return 1;
  }
  return (
    -ELASTIC_AMPLITUDE *
    Math.pow(2, 10 * t - 10) *
    Math.sin((t - 1 - ELASTIC_PHASE) * ELASTIC_OMEGA)
  );
};

/**
 * Elastic ease-out: an exponentially decaying sine settling onto 1.
 *
 * ```text
 * ease(t) = a · 2^(−10t) · sin((t − p/4) · 2π/p) + 1
 * ```
 *
 * Both endpoint guards are required: the raw form gives `1.00048828125` at
 * `t = 1`.
 */
export const elasticOut: EasingFunction = (t) => {
  if (t === 0) {
    return 0;
  }
  if (t === 1) {
    return 1;
  }
  return (
    ELASTIC_AMPLITUDE *
      Math.pow(2, -10 * t) *
      Math.sin((t - ELASTIC_PHASE) * ELASTIC_OMEGA) +
    1
  );
};

/**
 * Elastic ease-in-out: {@link elasticIn}'s wobble into {@link elasticOut}'s
 * settle, both compressed into half the interval and using
 * {@link ELASTIC_PERIOD_IN_OUT}.
 */
export const elasticInOut: EasingFunction = (t) => {
  if (t === 0) {
    return 0;
  }
  if (t === 1) {
    return 1;
  }
  const phase = (2 * t - 1 - ELASTIC_PHASE_IN_OUT) * ELASTIC_OMEGA_IN_OUT;
  return t < 0.5
    ? (-ELASTIC_AMPLITUDE * Math.pow(2, 20 * t - 10) * Math.sin(phase)) / 2
    : (ELASTIC_AMPLITUDE * Math.pow(2, 10 - 20 * t) * Math.sin(phase)) / 2 + 1;
};

// ---------------------------------------------------------------------------
// Spring
// ---------------------------------------------------------------------------

/**
 * Spring ease-out: the step response of an underdamped mass-spring-damper,
 * normalized to start at 0 and end at exactly 1.
 *
 * The closed form of `x'' + 2ζωₙx' + ωₙ²(x − 1) = 0` with `x(0) = 0`,
 * `x'(0) = 0` is `x(t) = 1 − E(t)` with the decay envelope
 *
 * ```text
 * E(t) = e^(−σt) · (cos(ω_d·t) + (σ/ω_d)·sin(ω_d·t))
 * σ    = ζ·ωₙ                    (decay rate)
 * ω_d  = ωₙ·√(1 − ζ²)            (damped angular frequency)
 * ```
 *
 * — the same envelope `@four/motion`'s `DampedSpringTrajectory` uses, here in
 * normalized progress rather than seconds. The parameters are pinned as
 * {@link SPRING_DAMPING_RATIO} (`ζ`) and {@link SPRING_OSCILLATIONS} (`N`, with
 * `ω_d = 2πN`) instead of a stiffness/mass pair, because an easing curve has no
 * duration of its own to make a frequency in hertz meaningful.
 *
 * A real spring only reaches its rest position asymptotically: at `t = 1` the
 * raw response still has `E(1) = e^(−σ) ≈ 0.9 %` of the range left to travel.
 * Dividing the whole curve by `1 − e^(−σ)` ({@link SPRING_NORMALIZATION})
 * removes that residue exactly, so the eased value lands on its target instead
 * of stopping 0.9 % short — the difference between a tween that arrives and one
 * that does not. The shape is otherwise unchanged (a 0.9 % uniform stretch).
 *
 * Overshoots to about 1.32 on the first swing; not monotone.
 */
export const springOut: EasingFunction = (t) => {
  if (t === 0) {
    return 0;
  }
  if (t === 1) {
    return 1;
  }
  const envelope =
    Math.exp(-SPRING_DECAY * t) *
    (Math.cos(SPRING_DAMPED_OMEGA * t) +
      (SPRING_DECAY / SPRING_DAMPED_OMEGA) * Math.sin(SPRING_DAMPED_OMEGA * t));
  return (1 - envelope) * SPRING_NORMALIZATION;
};

/**
 * Spring ease-in: {@link springOut} mirrored, `1 − springOut(1 − t)` — the
 * oscillation happens at the start instead of the end.
 */
export const springIn: EasingFunction = (t) => 1 - springOut(1 - t);

/** Spring ease-in-out: {@link springIn} for the first half, {@link springOut} for the second. */
export const springInOut: EasingFunction = (t) =>
  t < 0.5 ? (1 - springOut(1 - 2 * t)) / 2 : (1 + springOut(2 * t - 1)) / 2;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Every easing name accepted by {@link resolveEasing}, and by the §15 `.ease()`
 * builder step.
 *
 * The §15 family names verbatim, each with an `-in` / `-out` / `-in-out`
 * variant; `"linear"` is bare because its three variants would be identical.
 */
export type EasingName =
  | "linear"
  | "quadratic-in"
  | "quadratic-out"
  | "quadratic-in-out"
  | "cubic-in"
  | "cubic-out"
  | "cubic-in-out"
  | "quartic-in"
  | "quartic-out"
  | "quartic-in-out"
  | "quintic-in"
  | "quintic-out"
  | "quintic-in-out"
  | "sine-in"
  | "sine-out"
  | "sine-in-out"
  | "exponential-in"
  | "exponential-out"
  | "exponential-in-out"
  | "circular-in"
  | "circular-out"
  | "circular-in-out"
  | "back-in"
  | "back-out"
  | "back-in-out"
  | "bounce-in"
  | "bounce-out"
  | "bounce-in-out"
  | "elastic-in"
  | "elastic-out"
  | "elastic-in-out"
  | "spring-in"
  | "spring-out"
  | "spring-in-out";

/**
 * The §15 easing set keyed by {@link EasingName}, in §15's family order.
 *
 * Frozen: a caller cannot swap an easing out from under everyone else, which
 * would break replay (§34) of anything recorded against the old curve. Prefer
 * {@link resolveEasing} for names that came from data — it rejects unknown ones
 * instead of returning `undefined`.
 */
export const EASINGS: Readonly<Record<EasingName, EasingFunction>> =
  Object.freeze({
    linear,
    "quadratic-in": quadraticIn,
    "quadratic-out": quadraticOut,
    "quadratic-in-out": quadraticInOut,
    "cubic-in": cubicIn,
    "cubic-out": cubicOut,
    "cubic-in-out": cubicInOut,
    "quartic-in": quarticIn,
    "quartic-out": quarticOut,
    "quartic-in-out": quarticInOut,
    "quintic-in": quinticIn,
    "quintic-out": quinticOut,
    "quintic-in-out": quinticInOut,
    "sine-in": sineIn,
    "sine-out": sineOut,
    "sine-in-out": sineInOut,
    "exponential-in": exponentialIn,
    "exponential-out": exponentialOut,
    "exponential-in-out": exponentialInOut,
    "circular-in": circularIn,
    "circular-out": circularOut,
    "circular-in-out": circularInOut,
    "back-in": backIn,
    "back-out": backOut,
    "back-in-out": backInOut,
    "bounce-in": bounceIn,
    "bounce-out": bounceOut,
    "bounce-in-out": bounceInOut,
    "elastic-in": elasticIn,
    "elastic-out": elasticOut,
    "elastic-in-out": elasticInOut,
    "spring-in": springIn,
    "spring-out": springOut,
    "spring-in-out": springInOut,
  });

/**
 * Every {@link EasingName}, in registry (§15 family) order — for editors,
 * documentation and table-driven tests. Insertion order only (§33).
 */
export const EASING_NAMES: readonly EasingName[] = Object.freeze(
  Object.keys(EASINGS) as EasingName[],
);

/**
 * Resolves an easing name to its function.
 *
 * Names reaching this function often come from data the type system never saw —
 * a scene file (§79), an editor field, a string built at runtime — so an
 * unknown name throws `FourError("INVALID_APPLICATION_STATE")` rather than
 * returning `undefined` and animating with `undefined` later, far from the
 * mistake. Inherited properties (`"toString"`, `"constructor"`) are rejected
 * the same way: only own keys of {@link EASINGS} resolve.
 */
export function resolveEasing(name: EasingName): EasingFunction {
  const easing = Object.hasOwn(EASINGS, name) ? EASINGS[name] : undefined;
  if (easing === undefined) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Unknown easing "${String(name)}" (§15). Expected one of: ${EASING_NAMES.join(", ")}.`,
      { context: { name } },
    );
  }
  return easing;
}
