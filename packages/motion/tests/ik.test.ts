import { Vector3, constructionCount, resetConstructionCount } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  type TwoBoneIKSolution,
  createTwoBoneIKSolution,
  solveTwoBoneIK,
} from "../src/ik.js";

/** Distance between two points. */
function distance(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Asserts the two invariants that hold for every solve: the bones keep their
 * lengths, and nothing is NaN.
 */
function expectChainIntact(
  solution: TwoBoneIKSolution,
  root: Vector3,
  upperLength: number,
  lowerLength: number,
): void {
  for (const value of [
    solution.joint.x,
    solution.joint.y,
    solution.joint.z,
    solution.end.x,
    solution.end.y,
    solution.end.z,
  ]) {
    expect(Number.isFinite(value)).toBe(true);
  }
  expect(distance(root, solution.joint)).toBeCloseTo(upperLength, 12);
  expect(distance(solution.joint, solution.end)).toBeCloseTo(lowerLength, 12);
}

const ORIGIN = new Vector3(0, 0, 0);

describe("solveTwoBoneIK — reachable targets", () => {
  it("reaches the target and bends towards the pole", () => {
    const target = new Vector3(3, 0, 0);
    const pole = new Vector3(0, 1, 0);
    const solution = solveTwoBoneIK(ORIGIN, target, 2, 2, pole);

    expect(solution.reachable).toBe(true);
    expect(distance(solution.end, target)).toBeLessThan(1e-12);
    expectChainIntact(solution, ORIGIN, 2, 2);
    // Law of cosines: cos θ = (4 + 9 − 4) / (2·2·3) = 0.75.
    expect(solution.joint.x).toBeCloseTo(1.5, 12);
    expect(solution.joint.y).toBeCloseTo(2 * Math.sqrt(0.4375), 12);
    expect(solution.joint.z).toBeCloseTo(0, 12);
    // Elbow on the pole side.
    expect(solution.joint.y).toBeGreaterThan(0);
  });

  it("solves an unequal 3-4-5 chain", () => {
    const target = new Vector3(5, 0, 0);
    const solution = solveTwoBoneIK(ORIGIN, target, 3, 4, new Vector3(0, 1, 0));
    expect(solution.reachable).toBe(true);
    expectChainIntact(solution, ORIGIN, 3, 4);
    // cos θ = (9 + 25 − 16) / (2·3·5) = 0.6 → joint = (1.8, 2.4, 0).
    expect(solution.joint.x).toBeCloseTo(1.8, 12);
    expect(solution.joint.y).toBeCloseTo(2.4, 12);
    expect(distance(solution.end, target)).toBeLessThan(1e-12);
  });

  it("puts the joint on whichever side the pole hint names", () => {
    const target = new Vector3(3, 0, 0);
    const behind = solveTwoBoneIK(ORIGIN, target, 2, 2, new Vector3(0, 0, -1));
    expect(behind.joint.z).toBeLessThan(0);
    expect(behind.joint.y).toBeCloseTo(0, 12);
    expectChainIntact(behind, ORIGIN, 2, 2);

    const ahead = solveTwoBoneIK(ORIGIN, target, 2, 2, new Vector3(0, 0, 4));
    expect(ahead.joint.z).toBeGreaterThan(0);
    expect(ahead.joint.z).toBeCloseTo(-behind.joint.z, 12);
  });

  it("uses only the pole hint's perpendicular component", () => {
    // Chain along +Y; the hint's +Y part is dropped, leaving (1, 0, 1)/√2.
    const target = new Vector3(0, 4, 0);
    const solution = solveTwoBoneIK(
      ORIGIN,
      target,
      3,
      3,
      new Vector3(5, 900, 5),
    );
    expectChainIntact(solution, ORIGIN, 3, 3);
    // cos θ = (9 + 16 − 9) / (2·3·4) = 2/3 → along = 2, aside = 3·√5/3 = √5.
    const aside = Math.sqrt(5);
    expect(solution.joint.y).toBeCloseTo(2, 12);
    expect(solution.joint.x).toBeCloseTo(aside / Math.SQRT2, 12);
    expect(solution.joint.z).toBeCloseTo(aside / Math.SQRT2, 12);
    expect(distance(solution.end, target)).toBeLessThan(1e-12);
  });

  it("stays reachable exactly at full extension", () => {
    const target = new Vector3(0, 0, 5);
    const solution = solveTwoBoneIK(ORIGIN, target, 2, 3, new Vector3(1, 0, 0));
    expect(solution.reachable).toBe(true);
    expect(distance(solution.end, target)).toBeLessThan(1e-12);
    // Straight chain: the joint sits on the root→target line.
    expect(solution.joint.x).toBeCloseTo(0, 12);
    expect(solution.joint.y).toBeCloseTo(0, 12);
    expect(solution.joint.z).toBeCloseTo(2, 12);
  });

  it("solves away from the world origin", () => {
    const root = new Vector3(-4, 7, 2);
    const target = new Vector3(-4 + 3, 7, 2);
    const solution = solveTwoBoneIK(root, target, 2, 2, new Vector3(-4, 8, 2));
    expect(solution.reachable).toBe(true);
    expect(distance(solution.end, target)).toBeLessThan(1e-12);
    expectChainIntact(solution, root, 2, 2);
    expect(solution.joint.y).toBeGreaterThan(root.y);
  });
});

describe("solveTwoBoneIK — unreachable targets", () => {
  it("straightens towards a target that is too far", () => {
    const target = new Vector3(100, 0, 0);
    const solution = solveTwoBoneIK(ORIGIN, target, 2, 2, new Vector3(0, 1, 0));
    expect(solution.reachable).toBe(false);
    expectChainIntact(solution, ORIGIN, 2, 2);
    expect(solution.joint.x).toBeCloseTo(2, 12);
    expect(solution.joint.y).toBeCloseTo(0, 12);
    expect(solution.end.x).toBeCloseTo(4, 12);
    expect(solution.end.y).toBeCloseTo(0, 12);
    expect(solution.end.z).toBeCloseTo(0, 12);
  });

  it("folds towards a target that is too close", () => {
    // |a − b| = 4, so a target 1 unit away cannot be reached either.
    const target = new Vector3(1, 0, 0);
    const solution = solveTwoBoneIK(ORIGIN, target, 1, 5, new Vector3(0, 1, 0));
    expect(solution.reachable).toBe(false);
    expectChainIntact(solution, ORIGIN, 1, 5);
    expect(solution.joint.x).toBeCloseTo(-1, 12);
    expect(solution.end.x).toBeCloseTo(4, 12);
  });

  it("keeps the clamped cosine in range despite rounding", () => {
    // (a² + (a+b)² − b²) / (2·a·(a+b)) rounds to just over 1 for these lengths,
    // and the folded case to just under −1; both must still produce a real pose.
    const far = solveTwoBoneIK(
      ORIGIN,
      new Vector3(50, 0, 0),
      0.1,
      1.3,
      new Vector3(0, 1, 0),
    );
    expect(far.reachable).toBe(false);
    expectChainIntact(far, ORIGIN, 0.1, 1.3);
    expect(far.joint.y).toBeCloseTo(0, 12);

    const near = solveTwoBoneIK(
      ORIGIN,
      new Vector3(0.05, 0, 0),
      0.1,
      1.3,
      new Vector3(0, 1, 0),
    );
    expect(near.reachable).toBe(false);
    expectChainIntact(near, ORIGIN, 0.1, 1.3);
    expect(near.joint.x).toBeCloseTo(-0.1, 12);
    expect(near.joint.y).toBeCloseTo(0, 12);
  });
});

describe("solveTwoBoneIK — degenerate inputs", () => {
  it("picks a deterministic bend plane when the pole hint is on the chain line", () => {
    const cases: readonly (readonly [Vector3, Vector3])[] = [
      // Forward +Y (least-aligned world axis is X), pole hint further along it.
      [new Vector3(0, 4, 0), new Vector3(0, 9, 0)],
      // Forward +X (least-aligned axis is Y or Z).
      [new Vector3(4, 0, 0), new Vector3(-3, 0, 0)],
      // Forward (0.6, 0.8, 0): neither X nor Y is the least-aligned axis.
      [new Vector3(3, 4, 0), new Vector3(6, 8, 0)],
    ];
    for (const [target, pole] of cases) {
      const first = solveTwoBoneIK(ORIGIN, target, 3, 3, pole);
      expectChainIntact(first, ORIGIN, 3, 3);
      expect(distance(first.end, target)).toBeLessThan(1e-12);
      // The fallback bend plane is perpendicular to the chain, not arbitrary
      // noise: the joint is genuinely off the root→target line.
      expect(distance(first.joint, ORIGIN)).toBeCloseTo(3, 12);
      const joint = first.joint.clone();
      const second = solveTwoBoneIK(ORIGIN, target, 3, 3, pole);
      expect(Object.is(second.joint.x, joint.x)).toBe(true);
      expect(Object.is(second.joint.y, joint.y)).toBe(true);
      expect(Object.is(second.joint.z, joint.z)).toBe(true);
    }
  });

  it("treats a pole hint at the root as no hint at all", () => {
    const target = new Vector3(0, 3, 0);
    const solution = solveTwoBoneIK(ORIGIN, target, 2, 2, ORIGIN);
    expectChainIntact(solution, ORIGIN, 2, 2);
    expect(distance(solution.end, target)).toBeLessThan(1e-12);
  });

  it("folds flat when the target sits on the root and the bones match", () => {
    const solution = solveTwoBoneIK(
      ORIGIN,
      ORIGIN,
      2,
      2,
      new Vector3(0, 10, 0),
    );
    // Reachable: root and tip coincide, which equal bones can do.
    expect(solution.reachable).toBe(true);
    expectChainIntact(solution, ORIGIN, 2, 2);
    expect(solution.joint.x).toBeCloseTo(0, 12);
    expect(solution.joint.y).toBeCloseTo(2, 12);
    expect(solution.end.x).toBeCloseTo(0, 12);
    expect(solution.end.y).toBeCloseTo(0, 12);
  });

  it("uses +X when the target sits on the root and the bones differ", () => {
    const solution = solveTwoBoneIK(ORIGIN, ORIGIN, 1, 3, new Vector3(0, 1, 0));
    expect(solution.reachable).toBe(false);
    expectChainIntact(solution, ORIGIN, 1, 3);
    // Documented fallback direction: +X, clamped to the folded reach |a − b| = 2.
    expect(solution.end.x).toBeCloseTo(2, 12);
    expect(solution.joint.x).toBeCloseTo(-1, 12);
  });

  it("accepts a zero-length upper bone", () => {
    const solution = solveTwoBoneIK(
      ORIGIN,
      new Vector3(2, 0, 0),
      0,
      3,
      new Vector3(0, 1, 0),
    );
    // The reachable set is the sphere of radius 3, so a target 2 away is not on it.
    expect(solution.reachable).toBe(false);
    expectChainIntact(solution, ORIGIN, 0, 3);
    expect(solution.joint.x).toBeCloseTo(0, 12);
    expect(solution.end.x).toBeCloseTo(3, 12);

    const onSphere = solveTwoBoneIK(
      ORIGIN,
      new Vector3(0, 0, 3),
      0,
      3,
      new Vector3(0, 1, 0),
    );
    expect(onSphere.reachable).toBe(true);
    expect(onSphere.end.z).toBeCloseTo(3, 12);
  });

  it("accepts a zero-length lower bone", () => {
    const solution = solveTwoBoneIK(
      ORIGIN,
      new Vector3(2, 0, 0),
      3,
      0,
      new Vector3(0, 1, 0),
    );
    expect(solution.reachable).toBe(false);
    expectChainIntact(solution, ORIGIN, 3, 0);
    expect(solution.joint.x).toBeCloseTo(3, 12);
    expect(solution.end.x).toBeCloseTo(3, 12);
  });

  it("rejects a chain with no bones at all", () => {
    expect(() =>
      solveTwoBoneIK(ORIGIN, new Vector3(1, 0, 0), 0, 0, new Vector3(0, 1, 0)),
    ).toThrow(RangeError);
  });

  it("rejects negative and non-finite bone lengths", () => {
    const target = new Vector3(1, 0, 0);
    const pole = new Vector3(0, 1, 0);
    expect(() => solveTwoBoneIK(ORIGIN, target, -1, 2, pole)).toThrow(
      RangeError,
    );
    expect(() => solveTwoBoneIK(ORIGIN, target, 2, -1, pole)).toThrow(
      RangeError,
    );
    expect(() => solveTwoBoneIK(ORIGIN, target, Number.NaN, 2, pole)).toThrow(
      RangeError,
    );
    expect(() =>
      solveTwoBoneIK(ORIGIN, target, 2, Number.POSITIVE_INFINITY, pole),
    ).toThrow(RangeError);
  });
});

describe("solveTwoBoneIK — allocation and determinism", () => {
  it("does not modify its inputs", () => {
    const root = new Vector3(1, 2, 3);
    const target = new Vector3(4, 2, 3);
    const pole = new Vector3(1, 5, 3);
    solveTwoBoneIK(root, target, 2, 2, pole);
    expect(root.equalsApprox(new Vector3(1, 2, 3))).toBe(true);
    expect(target.equalsApprox(new Vector3(4, 2, 3))).toBe(true);
    expect(pole.equalsApprox(new Vector3(1, 5, 3))).toBe(true);
  });

  it("reuses an `out` solution without allocating", () => {
    const out = createTwoBoneIKSolution();
    const target = new Vector3(3, 0, 0);
    const pole = new Vector3(0, 1, 0);
    const closer = new Vector3(1, 1, 1);
    resetConstructionCount();
    const returned = solveTwoBoneIK(ORIGIN, target, 2, 2, pole, out);
    solveTwoBoneIK(ORIGIN, closer, 2, 2, pole, out);
    expect(constructionCount()).toBe(0);
    expect(returned).toBe(out);
  });

  it("resets `reachable` on reuse", () => {
    const out = createTwoBoneIKSolution();
    const pole = new Vector3(0, 1, 0);
    solveTwoBoneIK(ORIGIN, new Vector3(99, 0, 0), 2, 2, pole, out);
    expect(out.reachable).toBe(false);
    solveTwoBoneIK(ORIGIN, new Vector3(3, 0, 0), 2, 2, pole, out);
    expect(out.reachable).toBe(true);
  });

  it("allocates a fresh solution when `out` is omitted", () => {
    const target = new Vector3(3, 0, 0);
    const pole = new Vector3(0, 1, 0);
    const first = solveTwoBoneIK(ORIGIN, target, 2, 2, pole);
    const second = solveTwoBoneIK(ORIGIN, target, 2, 2, pole);
    expect(first).not.toBe(second);
    expect(first.joint).not.toBe(second.joint);
    expect(first.joint.equalsApprox(second.joint)).toBe(true);
    expect(first.end.equalsApprox(second.end)).toBe(true);
  });

  it("is a pure function: identical inputs give bit-identical poses (§33)", () => {
    const root = new Vector3(0.25, -1.5, 3.75);
    const target = new Vector3(2.125, 0.5, 1.25);
    const pole = new Vector3(-1, 4, 0.5);
    const first = solveTwoBoneIK(root, target, 1.75, 2.25, pole);
    // An unrelated solve in between must not leave state behind.
    solveTwoBoneIK(ORIGIN, new Vector3(7, 7, 7), 3, 1, ORIGIN);
    const second = solveTwoBoneIK(root, target, 1.75, 2.25, pole);
    for (const key of ["joint", "end"] as const) {
      expect(Object.is(first[key].x, second[key].x)).toBe(true);
      expect(Object.is(first[key].y, second[key].y)).toBe(true);
      expect(Object.is(first[key].z, second[key].z)).toBe(true);
    }
    expect(first.reachable).toBe(second.reachable);
  });
});
