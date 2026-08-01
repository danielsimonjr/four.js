import { isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DENSITY,
  DEFAULT_FRICTION,
  DEFAULT_FRICTION_COMBINE_MODE,
  DEFAULT_RESTITUTION,
  DEFAULT_RESTITUTION_COMBINE_MODE,
  PhysicsMaterial,
  combineFriction,
  combineRestitution,
  combineValues,
  resolveDensity,
} from "../src/material.js";
import type { CombineMode } from "../src/types.js";
import { COMBINE_MODES } from "../src/types.js";

function expectFourError(run: () => void): Error {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as Error & { code: string };
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

describe("PhysicsMaterial (§25)", () => {
  it("applies the documented defaults when constructed empty", () => {
    const material = new PhysicsMaterial();
    expect(material.friction).toBe(DEFAULT_FRICTION);
    expect(material.restitution).toBe(DEFAULT_RESTITUTION);
    expect(material.density).toBe(DEFAULT_DENSITY);
    expect(material.rollingFriction).toBeUndefined();
    expect(material.spinningFriction).toBeUndefined();
  });

  it("keeps every §25 field it is given", () => {
    const material = new PhysicsMaterial({
      friction: 0.9,
      restitution: 0.8,
      rollingFriction: 0.01,
      spinningFriction: 0.02,
      density: 1100,
    });
    expect(material.friction).toBe(0.9);
    expect(material.restitution).toBe(0.8);
    expect(material.rollingFriction).toBe(0.01);
    expect(material.spinningFriction).toBe(0.02);
    expect(material.density).toBe(1100);
  });

  it("accepts zero for the optional coefficients, which is not the same as absent", () => {
    const material = new PhysicsMaterial({
      rollingFriction: 0,
      spinningFriction: 0,
    });
    expect(material.rollingFriction).toBe(0);
    expect(material.spinningFriction).toBe(0);
  });

  it.each([
    "friction",
    "restitution",
    "density",
    "rollingFriction",
    "spinningFriction",
  ])("rejects a negative %s (§85)", (field) => {
    expect(
      expectFourError(() => {
        new PhysicsMaterial({ [field]: -1 });
      }).message,
    ).toContain(field);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-finite coefficient (%s, §85)",
    (value) => {
      expectFourError(() => {
        new PhysicsMaterial({ friction: value });
      });
    },
  );

  it("leaves fields writable after construction", () => {
    const material = new PhysicsMaterial();
    material.friction = 0.1;
    expect(material.friction).toBe(0.1);
  });
});

describe("combineValues (§25)", () => {
  it.each<[CombineMode, number]>([
    ["average", 0.5],
    ["minimum", 0.2],
    ["maximum", 0.8],
    ["multiply", 0.2 * 0.8],
  ])("applies %s", (mode, expected) => {
    expect(combineValues(0.2, 0.8, mode)).toBeCloseTo(expected, 12);
  });

  it("is commutative in every mode, so contact pair ordering cannot matter (§33)", () => {
    for (const mode of COMBINE_MODES) {
      expect(combineValues(0.3, 0.7, mode)).toBe(combineValues(0.7, 0.3, mode));
    }
  });

  it("throws on an unrecognized mode rather than substituting one", () => {
    expect(
      expectFourError(() => {
        combineValues(1, 2, "geometric-mean" as CombineMode);
      }).message,
    ).toContain("Unknown CombineMode");
  });
});

describe("Appendix A combine defaults (§25)", () => {
  const rubber = new PhysicsMaterial({ friction: 0.9, restitution: 0.8 });
  const ice = new PhysicsMaterial({ friction: 0.05, restitution: 0.1 });

  it("averages friction by default", () => {
    expect(DEFAULT_FRICTION_COMBINE_MODE).toBe("average");
    expect(combineFriction(rubber, ice)).toBeCloseTo(0.475, 12);
  });

  it("takes the maximum restitution by default", () => {
    expect(DEFAULT_RESTITUTION_COMBINE_MODE).toBe("maximum");
    expect(combineRestitution(rubber, ice)).toBe(0.8);
  });

  it("honours an explicit mode", () => {
    expect(combineFriction(rubber, ice, "minimum")).toBe(0.05);
    expect(combineRestitution(rubber, ice, "average")).toBeCloseTo(0.45, 12);
  });
});

describe("resolveDensity (§25, §23)", () => {
  const steel = new PhysicsMaterial({ density: 7800 });

  it("lets the collider's density win over the material's", () => {
    expect(resolveDensity(2700, steel)).toBe(2700);
  });

  it("treats a collider density of 0 as set, not absent", () => {
    expect(resolveDensity(0, steel)).toBe(0);
  });

  it("falls back to the material's density", () => {
    expect(resolveDensity(undefined, steel)).toBe(7800);
  });

  it("falls back to the default when neither is present", () => {
    expect(resolveDensity()).toBe(DEFAULT_DENSITY);
    expect(resolveDensity(undefined, undefined)).toBe(DEFAULT_DENSITY);
  });
});
