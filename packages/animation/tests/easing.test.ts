import { FourError, isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  BACK_OVERSHOOT,
  BACK_OVERSHOOT_IN_OUT,
  BOUNCE_AMPLITUDE,
  BOUNCE_SEGMENT_DIVISOR,
  EASINGS,
  EASING_NAMES,
  ELASTIC_AMPLITUDE,
  ELASTIC_PERIOD,
  ELASTIC_PERIOD_IN_OUT,
  SPRING_DAMPING_RATIO,
  SPRING_OSCILLATIONS,
  backIn,
  backInOut,
  backOut,
  bounceIn,
  bounceInOut,
  bounceOut,
  circularIn,
  circularInOut,
  circularOut,
  cubicIn,
  cubicInOut,
  cubicOut,
  elasticIn,
  elasticInOut,
  elasticOut,
  exponentialIn,
  exponentialInOut,
  exponentialOut,
  linear,
  quadraticIn,
  quadraticInOut,
  quadraticOut,
  quarticIn,
  quarticInOut,
  quarticOut,
  quinticIn,
  quinticInOut,
  quinticOut,
  resolveEasing,
  sineIn,
  sineInOut,
  sineOut,
  springIn,
  springInOut,
  springOut,
  type EasingFunction,
  type EasingName,
} from "../src/easing.js";

/** Default tolerance for values that go through a transcendental. */
const EPSILON = 1e-15;

function expectClose(actual: number, expected: number, tolerance = EPSILON) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/** Samples of `[0, 1]` used by the sweeping tests; endpoints included. */
const SAMPLES: readonly number[] = Array.from(
  { length: 201 },
  (_, i) => i / 200,
);

/** The §15 family names that have in/out/in-out variants. */
const FAMILIES = [
  "quadratic",
  "cubic",
  "quartic",
  "quintic",
  "sine",
  "exponential",
  "circular",
  "back",
  "bounce",
  "elastic",
  "spring",
] as const;

/** Families whose every variant is non-decreasing on `[0, 1]`. */
const MONOTONE_FAMILIES = [
  "quadratic",
  "cubic",
  "quartic",
  "quintic",
  "sine",
  "exponential",
  "circular",
] as const;

/** Families that deliberately leave `[0, 1]` mid-curve. */
const OVERSHOOTING_FAMILIES = ["back", "elastic", "spring"] as const;

/** Names of every variant of `family`. */
function variantsOf(family: (typeof FAMILIES)[number]): EasingName[] {
  return [`${family}-in`, `${family}-out`, `${family}-in-out`];
}

describe("§15 easing registry", () => {
  it("covers the twelve §15 families, in §15 order, with variants", () => {
    expect(EASING_NAMES).toEqual([
      "linear",
      "quadratic-in",
      "quadratic-out",
      "quadratic-in-out",
      "cubic-in",
      "cubic-out",
      "cubic-in-out",
      "quartic-in",
      "quartic-out",
      "quartic-in-out",
      "quintic-in",
      "quintic-out",
      "quintic-in-out",
      "sine-in",
      "sine-out",
      "sine-in-out",
      "exponential-in",
      "exponential-out",
      "exponential-in-out",
      "circular-in",
      "circular-out",
      "circular-in-out",
      "back-in",
      "back-out",
      "back-in-out",
      "bounce-in",
      "bounce-out",
      "bounce-in-out",
      "elastic-in",
      "elastic-out",
      "elastic-in-out",
      "spring-in",
      "spring-out",
      "spring-in-out",
    ]);
    // 1 (linear) + 11 families x 3 variants.
    expect(EASING_NAMES).toHaveLength(34);
  });

  it("maps every name to its exported function", () => {
    const expected: Record<EasingName, EasingFunction> = {
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
    };
    for (const name of EASING_NAMES) {
      expect(EASINGS[name]).toBe(expected[name]);
    }
  });

  it("is frozen", () => {
    expect(Object.isFrozen(EASINGS)).toBe(true);
    expect(Object.isFrozen(EASING_NAMES)).toBe(true);
  });

  it("resolves every registry key to the registry's function", () => {
    for (const name of EASING_NAMES) {
      expect(resolveEasing(name)).toBe(EASINGS[name]);
    }
  });

  it("throws FourError on an unknown name", () => {
    const call = () => resolveEasing("cubic-outt" as EasingName);
    expect(call).toThrow(FourError);
    try {
      call();
      expect.unreachable();
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      const fourError = error as FourError;
      expect(fourError.code).toBe("INVALID_APPLICATION_STATE");
      expect(fourError.message).toContain("cubic-outt");
      expect(fourError.context).toEqual({ name: "cubic-outt" });
    }
  });

  it("rejects inherited object properties as names", () => {
    for (const name of ["toString", "constructor", "__proto__", ""]) {
      expect(() => resolveEasing(name as EasingName)).toThrow(FourError);
    }
  });
});

describe("§15 easing endpoints", () => {
  it("is exactly 0 at t = 0 and exactly 1 at t = 1, for every variant", () => {
    for (const name of EASING_NAMES) {
      const ease = EASINGS[name];
      expect(ease(0), `${name}(0)`).toBe(0);
      expect(ease(1), `${name}(1)`).toBe(1);
    }
  });

  it("keeps the endpoints exact for the variants whose closed form drifts", () => {
    // Documented drift the explicit t === 0 / t === 1 cases exist to remove.
    expect(1 - Math.cos(Math.PI / 2)).not.toBe(1); // sine-in at t = 1
    expect(Math.pow(2, -10)).not.toBe(0); // exponential-in at t = 0
    expect(BACK_OVERSHOOT + 1 - BACK_OVERSHOOT).not.toBe(1); // back-in at t = 1
    for (const name of [
      "sine-in",
      "exponential-in",
      "exponential-out",
      "exponential-in-out",
      "back-in",
      "back-out",
      "elastic-in",
      "elastic-out",
      "elastic-in-out",
      "spring-in",
      "spring-out",
      "spring-in-out",
    ] as const) {
      expect(EASINGS[name](0), `${name}(0)`).toBe(0);
      expect(EASINGS[name](1), `${name}(1)`).toBe(1);
    }
  });
});

describe("§15 easing closed-form values", () => {
  // Dyadic values: pure +-*/ on exactly representable numbers, so these are
  // bit-exact and asserted with toBe.
  it("matches the polynomial families exactly at t = 1/4, 1/2, 3/4", () => {
    expect([linear(0.25), linear(0.5), linear(0.75)]).toEqual([
      0.25, 0.5, 0.75,
    ]);

    // t^2 and 1 - (1 - t)^2.
    expect([quadraticIn(0.25), quadraticIn(0.5), quadraticIn(0.75)]).toEqual([
      0.0625, 0.25, 0.5625,
    ]);
    expect([quadraticOut(0.25), quadraticOut(0.5), quadraticOut(0.75)]).toEqual(
      [0.4375, 0.75, 0.9375],
    );
    // 2t^2 below the midpoint; 1 - (2 - 2t)^2/2 above it.
    expect([
      quadraticInOut(0.25),
      quadraticInOut(0.5),
      quadraticInOut(0.75),
    ]).toEqual([0.125, 0.5, 0.875]);

    // t^3 = 1/64, 1/8, 27/64.
    expect([cubicIn(0.25), cubicIn(0.5), cubicIn(0.75)]).toEqual([
      0.015625, 0.125, 0.421875,
    ]);
    expect([cubicOut(0.25), cubicOut(0.5), cubicOut(0.75)]).toEqual([
      0.578125, 0.875, 0.984375,
    ]);
    expect([cubicInOut(0.25), cubicInOut(0.5), cubicInOut(0.75)]).toEqual([
      0.0625, 0.5, 0.9375,
    ]);

    // t^4 = 1/256, 1/16, 81/256.
    expect([quarticIn(0.25), quarticIn(0.5), quarticIn(0.75)]).toEqual([
      0.00390625, 0.0625, 0.31640625,
    ]);
    expect([quarticOut(0.25), quarticOut(0.5), quarticOut(0.75)]).toEqual([
      0.68359375, 0.9375, 0.99609375,
    ]);
    expect([quarticInOut(0.25), quarticInOut(0.5), quarticInOut(0.75)]).toEqual(
      [0.03125, 0.5, 0.96875],
    );

    // t^5 = 1/1024, 1/32, 243/1024.
    expect([quinticIn(0.25), quinticIn(0.5), quinticIn(0.75)]).toEqual([
      0.0009765625, 0.03125, 0.2373046875,
    ]);
    expect([quinticOut(0.25), quinticOut(0.5), quinticOut(0.75)]).toEqual([
      0.7626953125, 0.96875, 0.9990234375,
    ]);
    expect([quinticInOut(0.25), quinticInOut(0.5), quinticInOut(0.75)]).toEqual(
      [0.015625, 0.5, 0.984375],
    );
  });

  it("matches the sine family (cos pi/8 = sqrt(2 + sqrt2)/2)", () => {
    const cos8 = Math.sqrt(2 + Math.SQRT2) / 2; // cos(pi/8) = sin(3pi/8)
    const sin8 = Math.sqrt(2 - Math.SQRT2) / 2; // sin(pi/8) = cos(3pi/8)

    expectClose(sineIn(0.25), 1 - cos8);
    expectClose(sineIn(0.5), 1 - Math.SQRT1_2);
    expectClose(sineIn(0.75), 1 - sin8);

    expectClose(sineOut(0.25), sin8);
    expectClose(sineOut(0.5), Math.SQRT1_2);
    expectClose(sineOut(0.75), cos8);

    // (1 - cos(pi t))/2 with cos(pi/4) = sqrt2/2 and cos(3pi/4) = -sqrt2/2.
    expectClose(sineInOut(0.25), (1 - Math.SQRT1_2) / 2);
    expectClose(sineInOut(0.5), 0.5);
    expectClose(sineInOut(0.75), (1 + Math.SQRT1_2) / 2);
  });

  it("matches the exponential family (2^-7.5, 2^-5, 2^-2.5)", () => {
    const p75 = Math.SQRT1_2 / 128; // 2^-7.5
    const p25 = Math.SQRT1_2 / 4; // 2^-2.5

    expectClose(exponentialIn(0.25), p75);
    expectClose(exponentialIn(0.5), 0.03125); // 2^-5
    expectClose(exponentialIn(0.75), p25);

    expectClose(exponentialOut(0.25), 1 - p25);
    expectClose(exponentialOut(0.5), 0.96875);
    expectClose(exponentialOut(0.75), 1 - p75);

    // 2^(20t - 10)/2 below the midpoint; (2 - 2^(10 - 20t))/2 above it.
    expectClose(exponentialInOut(0.25), 0.015625); // 2^-5/2
    expectClose(exponentialInOut(0.5), 0.5);
    expectClose(exponentialInOut(0.75), 0.984375); // 1 - 2^-6
  });

  it("matches the circular family (unit-circle ordinates)", () => {
    const s15 = Math.sqrt(15) / 4; // sqrt(1 - 1/16)
    const s3 = Math.sqrt(3) / 2; // sqrt(1 - 1/4)
    const s7 = Math.sqrt(7) / 4; // sqrt(1 - 9/16)

    expectClose(circularIn(0.25), 1 - s15);
    expectClose(circularIn(0.5), 1 - s3);
    expectClose(circularIn(0.75), 1 - s7);

    expectClose(circularOut(0.25), s7);
    expectClose(circularOut(0.5), s3);
    expectClose(circularOut(0.75), s15);

    expectClose(circularInOut(0.25), (1 - s3) / 2);
    expectClose(circularInOut(0.5), 0.5);
    expectClose(circularInOut(0.75), (1 + s3) / 2);
  });

  it("matches the back family for the pinned overshoot", () => {
    // (s + 1)t^3 - s t^2 with s = 1.70158:
    //   t = 1/4 -> (2.70158 - 4 x 1.70158)/64  = -4.10474/64
    //   t = 1/2 -> (2.70158 - 2 x 1.70158)/8   = -0.70158/8
    //   t = 3/4 -> (27 x 2.70158 - 36 x 1.70158)/64 = 11.68578/64
    expectClose(backIn(0.25), -0.0641365625);
    expectClose(backIn(0.5), -0.0876975);
    expectClose(backIn(0.75), 0.1825903125);

    // backOut(t) = 1 - backIn(1 - t).
    expectClose(backOut(0.25), 1 - 0.1825903125);
    expectClose(backOut(0.5), 1 + 0.0876975);
    expectClose(backOut(0.75), 1 + 0.0641365625);

    // In-out at t = 1/4: u = 1/2, (u^2 ((s2 + 1) u - s2))/2 with
    // s2 = 2.5949095 -> (0.25 x (1.79745475 - 2.5949095))/2.
    expectClose(backInOut(0.25), -0.09968184375);
    expectClose(backInOut(0.5), 0.5);
    expectClose(backInOut(0.75), 1.09968184375);
  });

  it("matches the bounce family segment arithmetic", () => {
    // First segment: 7.5625 t^2 = 7.5625/16.
    expectClose(bounceOut(0.25), 0.47265625);
    // Second segment: 7.5625 (1/2 - 6/11)^2 + 0.75.
    expectClose(bounceOut(0.5), 0.765625);
    // Third segment: 7.5625 (3/4 - 9/11)^2 + 0.9375.
    expectClose(bounceOut(0.75), 0.97265625);

    // bounceIn is the exact mirror, bounceInOut the exact halves.
    expect(bounceIn(0.25)).toBe(1 - bounceOut(0.75));
    expect(bounceInOut(0.25)).toBe((1 - bounceOut(0.5)) / 2);
    expect(bounceInOut(0.75)).toBe((1 + bounceOut(0.5)) / 2);
  });
});

describe("§15 easing symmetry", () => {
  it("mirrors in against out: easeIn(t) = 1 - easeOut(1 - t)", () => {
    for (const family of FAMILIES) {
      const easeIn = EASINGS[`${family}-in`];
      const easeOut = EASINGS[`${family}-out`];
      for (const t of SAMPLES) {
        expectClose(easeIn(t), 1 - easeOut(1 - t), 1e-15);
      }
    }
  });

  it("mirrors bounce and spring exactly (they are defined by mirroring)", () => {
    for (const t of SAMPLES) {
      expect(bounceIn(t)).toBe(1 - bounceOut(1 - t));
      expect(springIn(t)).toBe(1 - springOut(1 - t));
    }
  });

  it("passes through 0.5 at the midpoint for every in-out variant", () => {
    for (const family of FAMILIES) {
      const easeInOut = EASINGS[`${family}-in-out`];
      // sine-in-out is the only one built from a single closed form rather
      // than two mirrored halves, and its cos(pi/2) term costs it one ulp.
      if (family === "sine") {
        expectClose(easeInOut(0.5), 0.5);
      } else {
        expect(easeInOut(0.5), `${family}-in-out(0.5)`).toBe(0.5);
      }
    }
    expect(linear(0.5)).toBe(0.5);
  });

  it("makes each in-out variant point-symmetric about (0.5, 0.5)", () => {
    for (const family of FAMILIES) {
      const easeInOut = EASINGS[`${family}-in-out`];
      for (const t of SAMPLES) {
        expectClose(easeInOut(t), 1 - easeInOut(1 - t), 1e-15);
      }
    }
  });
});

describe("§15 easing shape", () => {
  it("is non-decreasing across the monotone families", () => {
    for (const family of MONOTONE_FAMILIES) {
      for (const name of variantsOf(family)) {
        const ease = EASINGS[name];
        let previous = ease(0);
        for (const t of SAMPLES) {
          const value = ease(t);
          expect(value, `${name} at t=${String(t)}`).toBeGreaterThanOrEqual(
            previous,
          );
          previous = value;
        }
      }
    }
    let previous = -Infinity;
    for (const t of SAMPLES) {
      expect(linear(t)).toBeGreaterThanOrEqual(previous);
      previous = linear(t);
    }
  });

  it("keeps the monotone families inside [0, 1]", () => {
    for (const family of MONOTONE_FAMILIES) {
      for (const name of variantsOf(family)) {
        for (const t of SAMPLES) {
          const value = EASINGS[name](t);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("lets back, elastic and spring leave [0, 1] mid-curve (never clamped)", () => {
    for (const family of OVERSHOOTING_FAMILIES) {
      const values = (name: EasingName) => SAMPLES.map((t) => EASINGS[name](t));
      // The -in variants anticipate below 0 and approach 1 from below; the
      // -out variants overshoot past 1 and stay above 0; -in-out does both.
      const inValues = values(`${family}-in`);
      expect(Math.min(...inValues), `${family}-in undershoot`).toBeLessThan(0);
      expect(Math.max(...inValues)).toBe(1);

      const outValues = values(`${family}-out`);
      expect(Math.max(...outValues), `${family}-out overshoot`).toBeGreaterThan(
        1,
      );
      expect(Math.min(...outValues)).toBe(0);

      const inOutValues = values(`${family}-in-out`);
      expect(Math.min(...inOutValues)).toBeLessThan(0);
      expect(Math.max(...inOutValues)).toBeGreaterThan(1);
    }
  });

  it("bounces without ever exceeding 1", () => {
    for (const name of variantsOf("bounce")) {
      for (const t of SAMPLES) {
        const value = EASINGS[name](t);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    // A bounce touches 1 and falls back: not monotone. The second segment
    // spans [1/2.75, 2/2.75) with its minimum at 1.5/2.75 = 0.5454...
    expect(bounceOut(0.4)).toBeGreaterThan(bounceOut(0.5));
    expectClose(bounceOut(1 / BOUNCE_SEGMENT_DIVISOR), 1, 1e-15);
  });

  it("settles the spring curve after its overshoots", () => {
    // Peak of the first swing, then successively smaller excursions.
    const peak = Math.max(...SAMPLES.map((t) => springOut(t)));
    expectClose(peak, 1.3212646335405362, 1e-12);
    expect(Math.abs(springOut(0.9) - 1)).toBeLessThan(0.05);
    expect(Math.abs(springOut(0.99) - 1)).toBeLessThan(0.01);
  });
});

describe("§15 easing constants", () => {
  it("pins the documented parameters", () => {
    expect(BACK_OVERSHOOT).toBe(1.70158);
    expect(BACK_OVERSHOOT_IN_OUT).toBe(1.70158 * 1.525);
    expect(BOUNCE_AMPLITUDE).toBe(7.5625);
    expect(BOUNCE_SEGMENT_DIVISOR).toBe(2.75);
    expect(ELASTIC_AMPLITUDE).toBe(1);
    expect(ELASTIC_PERIOD).toBe(0.3);
    expect(ELASTIC_PERIOD_IN_OUT).toBe(0.45);
    expect(SPRING_DAMPING_RATIO).toBe(0.35);
    expect(SPRING_OSCILLATIONS).toBe(2);
  });

  it("keeps the elastic period observable in the curve", () => {
    // elasticOut oscillates with period ELASTIC_PERIOD, so it crosses 1
    // wherever (t - p/4) is a multiple of p/2.
    const phase = ELASTIC_PERIOD / 4;
    for (const k of [1, 2, 3]) {
      const t = phase + (k * ELASTIC_PERIOD) / 2;
      expectClose(elasticOut(t), 1, 1e-12);
    }
  });

  it("keeps the spring oscillation count observable in the curve", () => {
    // N damped oscillations cross the target 2N - 1 times on (0, 1) and land
    // on it exactly at t = 1 (that landing is what the normalization buys).
    let crossings = 0;
    let previous = springOut(0) - 1;
    const steps = 20000;
    for (let i = 1; i < steps; i += 1) {
      const value = springOut(i / steps) - 1;
      if (previous < 0 !== value < 0) {
        crossings += 1;
      }
      previous = value;
    }
    expect(crossings).toBe(2 * SPRING_OSCILLATIONS - 1);

    // omega_d = 2 pi N puts the envelope's sine term at zero at every t = k/N,
    // leaving only the decaying cosine: the curve is below its target there.
    for (let k = 1; k < SPRING_OSCILLATIONS; k += 1) {
      expect(springOut(k / SPRING_OSCILLATIONS)).toBeLessThan(1);
    }
  });
});

describe("§15 easing purity (§33)", () => {
  it("returns the same value for the same input, every time", () => {
    for (const name of EASING_NAMES) {
      const ease = EASINGS[name];
      for (const t of [0, 0.1, 0.25, 1 / 3, 0.5, 0.75, 0.9, 1]) {
        const first = ease(t);
        expect(ease(t), `${name} repeat`).toBe(first);
        expect(ease(t), `${name} repeat`).toBe(first);
      }
    }
  });

  it("is unaffected by interleaved calls to other easings", () => {
    const baseline = EASING_NAMES.map((name) => EASINGS[name](0.42));
    for (const name of EASING_NAMES) {
      for (const other of EASING_NAMES) {
        EASINGS[other](Math.SQRT1_2);
      }
      const index = EASING_NAMES.indexOf(name);
      expect(EASINGS[name](0.42)).toBe(baseline[index]);
    }
  });

  it("is a plain function of t with no arity beyond it", () => {
    for (const name of EASING_NAMES) {
      expect(EASINGS[name]).toHaveLength(1);
    }
  });
});
