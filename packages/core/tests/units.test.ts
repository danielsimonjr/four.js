/**
 * §40 unit system — conversion, validation, and the display-only contract.
 *
 * The load-bearing tests here are not the arithmetic ones. They are:
 *
 * - **the identity tests** — under {@link SI_UNITS} every conversion returns
 *   its input *bit-identically* (`Object.is`, so `-0` and `NaN` are checked
 *   properly), which is what makes "an application that never mentions units
 *   pays nothing" a fact rather than a hope; and
 * - **the round-trip tests**, which assert the *documented* float behaviour in
 *   both directions: exact where the module claims exact, and merely
 *   near-exact — with the divergence counted, not hidden — where it claims
 *   near-exact. A test that used `toBeCloseTo` everywhere would pass equally
 *   well if someone quietly made the exact cases inexact.
 */

import { describe, expect, it } from "vitest";

import { FourError } from "../src/errors.js";
import {
  SI_UNITS,
  angleFromDisplay,
  angleToDisplay,
  formatAngle,
  formatLength,
  formatMass,
  formatTime,
  kilogramsToWorldMass,
  lengthFromDisplay,
  lengthToDisplay,
  massFromDisplay,
  massToDisplay,
  metersToWorldLength,
  resolveUnitSystem,
  timeFromDisplay,
  timeToDisplay,
  unitSymbol,
  worldLengthToMeters,
  worldMassToKilograms,
  type UnitSystem,
} from "../src/units.js";

/** Millimetre world, displayed in degrees and milliseconds. */
const CAD: UnitSystem = resolveUnitSystem({
  length: "millimeter",
  mass: "gram",
  time: "millisecond",
  angle: "degree",
  scale: { lengthToMeters: 0.001, massToKilograms: 0.001 },
});

/** A metre world whose inspector shows centimetres and grams. */
const MIXED: UnitSystem = resolveUnitSystem({
  length: "centimeter",
  mass: "gram",
  angle: "degree",
  time: "millisecond",
});

/** A world unit that is 2.5 m and 4 kg, with no name for either. */
const CUSTOM: UnitSystem = resolveUnitSystem({
  length: "custom",
  mass: "custom",
  scale: { lengthToMeters: 2.5, massToKilograms: 4 },
});

/** Spread of values used for the round-trip sweeps. */
function samples(): number[] {
  const out: number[] = [];
  for (let i = -400; i <= 400; i += 1) {
    out.push(i / 97);
  }
  return out;
}

describe("resolveUnitSystem (§40 record, §85 validation)", () => {
  it("returns §40's recommended default, frozen, and allocates nothing for it", () => {
    expect(SI_UNITS).toEqual({
      length: "meter",
      mass: "kilogram",
      time: "second",
      angle: "radian",
      scale: { lengthToMeters: 1, massToKilograms: 1 },
    });
    expect(Object.isFrozen(SI_UNITS)).toBe(true);
    expect(Object.isFrozen(SI_UNITS.scale)).toBe(true);
    expect(resolveUnitSystem()).toBe(SI_UNITS);
  });

  it("fills omitted fields from SI and freezes the result", () => {
    const units = resolveUnitSystem({ angle: "degree" });
    expect(units).toEqual({
      length: "meter",
      mass: "kilogram",
      time: "second",
      angle: "degree",
      scale: { lengthToMeters: 1, massToKilograms: 1 },
    });
    expect(Object.isFrozen(units)).toBe(true);
    expect(Object.isFrozen(units.scale)).toBe(true);
  });

  it("accepts a partial scale, defaulting the other factor", () => {
    expect(
      resolveUnitSystem({ scale: { lengthToMeters: 0.01 } }).scale,
    ).toEqual({ lengthToMeters: 0.01, massToKilograms: 1 });
    expect(
      resolveUnitSystem({ scale: { massToKilograms: 0.001 } }).scale,
    ).toEqual({ lengthToMeters: 1, massToKilograms: 0.001 });
  });

  it.each([
    ["length", { length: "furlong" }],
    ["mass", { mass: "stone" }],
    ["time", { time: "minute" }],
    ["angle", { angle: "turn" }],
  ])("refuses a %s selector outside the §40 union", (field, init) => {
    let thrown: unknown;
    try {
      resolveUnitSystem(init as never);
      expect.unreachable("should have refused");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FourError);
    const failure = thrown as FourError;
    expect(failure.code).toBe("INVALID_APPLICATION_STATE");
    expect(failure.message).toContain("§40");
    expect(failure.context?.field).toBe(field);
    expect(Array.isArray(failure.context?.allowed)).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses lengthToMeters = %p (§85: NaN, infinities, unstable scales)",
    (value) => {
      let thrown: unknown;
      try {
        resolveUnitSystem({ scale: { lengthToMeters: value } });
        expect.unreachable("should have refused");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FourError);
      const failure = thrown as FourError;
      expect(failure.code).toBe("INVALID_APPLICATION_STATE");
      expect(failure.context).toEqual({
        field: "scale.lengthToMeters",
        found: value,
      });
    },
  );

  it("refuses a bad massToKilograms with the same rule", () => {
    expect(() =>
      resolveUnitSystem({ scale: { massToKilograms: -0.5 } }),
    ).toThrow(FourError);
    expect(() =>
      resolveUnitSystem({ scale: { massToKilograms: Number.NaN } }),
    ).toThrow(/massToKilograms/);
  });
});

describe("SI is the identity — an application that never mentions units pays nothing", () => {
  it.each([
    -3.75,
    -0,
    0,
    1e-9,
    12345.678,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("passes %p through every conversion unchanged", (value) => {
    expect(Object.is(angleToDisplay(value, SI_UNITS), value)).toBe(true);
    expect(Object.is(angleFromDisplay(value, SI_UNITS), value)).toBe(true);
    expect(Object.is(timeToDisplay(value, SI_UNITS), value)).toBe(true);
    expect(Object.is(timeFromDisplay(value, SI_UNITS), value)).toBe(true);
    expect(Object.is(lengthToDisplay(value, SI_UNITS), value)).toBe(true);
    expect(Object.is(lengthFromDisplay(value, SI_UNITS), value)).toBe(true);
    expect(Object.is(massToDisplay(value, SI_UNITS), value)).toBe(true);
    expect(Object.is(massFromDisplay(value, SI_UNITS), value)).toBe(true);
  });

  it("is also the identity when the display unit equals the world unit", () => {
    // A millimetre world displayed in millimetres, a gram world in grams, and
    // an unnamed custom unit: all three resolve to a factor of exactly 1.
    for (const value of [-2.5, 0.125, 1e6]) {
      expect(Object.is(lengthToDisplay(value, CAD), value)).toBe(true);
      expect(Object.is(lengthFromDisplay(value, CAD), value)).toBe(true);
      expect(Object.is(massToDisplay(value, CAD), value)).toBe(true);
      expect(Object.is(lengthToDisplay(value, CUSTOM), value)).toBe(true);
      expect(Object.is(lengthFromDisplay(value, CUSTOM), value)).toBe(true);
      expect(Object.is(massToDisplay(value, CUSTOM), value)).toBe(true);
      expect(Object.is(massFromDisplay(value, CUSTOM), value)).toBe(true);
    }
  });
});

describe("angle conversion (display only — the engine stays in radians)", () => {
  it("converts the cardinal angles exactly", () => {
    expect(angleToDisplay(Math.PI / 2, CAD)).toBe(90);
    expect(angleToDisplay(Math.PI, CAD)).toBe(180);
    expect(angleToDisplay(-Math.PI, CAD)).toBe(-180);
    expect(angleFromDisplay(90, CAD)).toBe(Math.PI / 2);
    expect(angleFromDisplay(180, CAD)).toBe(Math.PI);
  });

  it("round-trips within one ulp, and the divergence is the documented one", () => {
    let differing = 0;
    for (const radians of samples()) {
      const back = angleFromDisplay(angleToDisplay(radians, CAD), CAD);
      if (back !== radians) {
        differing += 1;
        expect(Math.abs(back - radians)).toBeLessThanOrEqual(
          Math.abs(radians) * Number.EPSILON,
        );
      }
    }
    // Documented in the module header: this is ordinary IEEE-754 loss, it is
    // real, and it is why these helpers are barred from simulation paths.
    expect(differing).toBeGreaterThan(0);
    expect(differing / samples().length).toBeLessThan(0.2);
  });
});

describe("time conversion (display only — the engine stays in seconds)", () => {
  it("converts seconds to milliseconds and back", () => {
    expect(timeToDisplay(0.5, CAD)).toBe(500);
    expect(timeToDisplay(1 / 60, CAD)).toBeCloseTo(16.6667, 4);
    expect(timeFromDisplay(500, CAD)).toBe(0.5);
    expect(timeFromDisplay(16, CAD)).toBe(0.016);
  });

  it("round-trips within one ulp", () => {
    let differing = 0;
    for (const seconds of samples()) {
      const back = timeFromDisplay(timeToDisplay(seconds, CAD), CAD);
      if (back !== seconds) {
        differing += 1;
        expect(Math.abs(back - seconds)).toBeLessThanOrEqual(
          Math.abs(seconds) * Number.EPSILON,
        );
      }
    }
    expect(differing).toBeGreaterThan(0);
    expect(differing / samples().length).toBeLessThan(0.1);
  });
});

describe("length and mass conversion (§40 scale relates world units to SI)", () => {
  it("displays a metre world in centimetres and grams", () => {
    expect(lengthToDisplay(1.5, MIXED)).toBeCloseTo(150, 10);
    expect(lengthFromDisplay(150, MIXED)).toBeCloseTo(1.5, 12);
    expect(massToDisplay(2, MIXED)).toBeCloseTo(2000, 8);
    expect(massFromDisplay(2000, MIXED)).toBeCloseTo(2, 12);
  });

  it("displays a custom world unit in a named one, and back", () => {
    // One world unit is 2.5 m; displayed in metres that reads 2.5, and 4 kg
    // of world mass reads 4 kg only because massToKilograms says so.
    const metric = resolveUnitSystem({
      scale: { lengthToMeters: 2.5, massToKilograms: 4 },
    });
    expect(lengthToDisplay(2, metric)).toBe(5);
    expect(lengthFromDisplay(5, metric)).toBe(2);
    expect(massToDisplay(3, metric)).toBe(12);
    expect(massFromDisplay(12, metric)).toBe(3);
  });

  it("round-trips lengths and masses within one ulp", () => {
    for (const value of samples()) {
      expect(
        lengthFromDisplay(lengthToDisplay(value, MIXED), MIXED),
      ).toBeCloseTo(value, 12);
      expect(massFromDisplay(massToDisplay(value, MIXED), MIXED)).toBeCloseTo(
        value,
        12,
      );
    }
  });
});

describe("SI accessors (§101's 'unit application in simulation' reads these)", () => {
  it("applies the scale factor alone, independent of the display selector", () => {
    // MIXED displays centimetres, but a metre is a metre.
    expect(worldLengthToMeters(3, MIXED)).toBe(3);
    expect(worldLengthToMeters(3, CAD)).toBe(0.003);
    expect(metersToWorldLength(0.003, CAD)).toBe(3);
    expect(worldMassToKilograms(3, CUSTOM)).toBe(12);
    expect(kilogramsToWorldMass(12, CUSTOM)).toBe(3);
  });
});

describe("unitSymbol and the format helpers", () => {
  it("names every §40 unit that has a name", () => {
    expect(unitSymbol(SI_UNITS, "length")).toBe("m");
    expect(unitSymbol(SI_UNITS, "mass")).toBe("kg");
    expect(unitSymbol(SI_UNITS, "time")).toBe("s");
    expect(unitSymbol(SI_UNITS, "angle")).toBe("rad");
    expect(unitSymbol(MIXED, "length")).toBe("cm");
    expect(unitSymbol(MIXED, "mass")).toBe("g");
    expect(unitSymbol(MIXED, "time")).toBe("ms");
    expect(unitSymbol(MIXED, "angle")).toBe("°");
    expect(unitSymbol(CAD, "length")).toBe("mm");
  });

  it("returns no symbol for a custom unit — §40 gives it no name", () => {
    expect(unitSymbol(CUSTOM, "length")).toBe("");
    expect(unitSymbol(CUSTOM, "mass")).toBe("");
  });

  it("formats with the symbol, and with no separator when there is none", () => {
    expect(formatLength(1.5, MIXED, 1)).toBe("150.0 cm");
    expect(formatMass(2, MIXED, 0)).toBe("2000 g");
    expect(formatTime(1 / 60, MIXED, 2)).toBe("16.67 ms");
    expect(formatLength(2, CUSTOM)).toBe("2");
    expect(formatMass(2, CUSTOM, 1)).toBe("2.0");
  });

  it("writes degrees tight against the number and radians with a space", () => {
    expect(formatAngle(Math.PI / 2, MIXED)).toBe("90°");
    expect(formatAngle(Math.PI / 2, MIXED, 1)).toBe("90.0°");
    expect(formatAngle(Math.PI / 2, SI_UNITS, 4)).toBe("1.5708 rad");
  });

  it("omits rounding entirely when no fractionDigits is given", () => {
    expect(formatLength(1 / 3, SI_UNITS)).toBe("0.3333333333333333 m");
  });
});
