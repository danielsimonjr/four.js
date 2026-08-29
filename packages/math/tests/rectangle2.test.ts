/**
 * `Rectangle2` (§7b; RFC 0005's recorded prerequisite for §61's
 * `readPixels(target, region)`).
 *
 * The family contract under test is `vectors.test.ts`'s: mutate-in-place
 * methods returning `this`, `clone` as the only allocating method, the plan D3
 * changed hook firing once per mutator and never for queries, and the
 * allocation counter seeing every construction. What is specific to a
 * rectangle — the half-open `containsPoint`, `isEmpty` on non-positive
 * extents, and the no-validation §85 posture — is pinned here too.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  Rectangle2,
  constructionCount,
  resetConstructionCount,
} from "../src/index.js";

describe("Rectangle2", () => {
  it("defaults to the zero rectangle and stores what it is given", () => {
    const zero = new Rectangle2();
    expect([zero.x, zero.y, zero.width, zero.height]).toEqual([0, 0, 0, 0]);

    const r = new Rectangle2(1, 2, 3, 4);
    expect([r.x, r.y, r.width, r.height]).toEqual([1, 2, 3, 4]);
  });

  it("does not validate (§85, per the family): negative and fractional extents are stored", () => {
    const r = new Rectangle2(-1.5, 2.25, -3, 0.5);
    expect([r.x, r.y, r.width, r.height]).toEqual([-1.5, 2.25, -3, 0.5]);
  });

  it("set and copy mutate in place and return this", () => {
    const r = new Rectangle2();
    expect(r.set(1, 2, 3, 4)).toBe(r);
    expect([r.x, r.y, r.width, r.height]).toEqual([1, 2, 3, 4]);

    const target = new Rectangle2();
    expect(target.copy(r)).toBe(target);
    expect([target.x, target.y, target.width, target.height]).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("clone allocates an equal, independent rectangle with no hook", () => {
    const r = new Rectangle2(1, 2, 3, 4);
    r.onChanged = () => undefined;
    const clone = r.clone();
    expect(clone).not.toBe(r);
    expect(clone.equalsApprox(r)).toBe(true);
    expect(clone.onChanged).toBeUndefined();
    clone.set(9, 9, 9, 9);
    expect([r.x, r.y, r.width, r.height]).toEqual([1, 2, 3, 4]);
  });

  it("isEmpty is true exactly for a non-positive width or height", () => {
    expect(new Rectangle2(0, 0, 4, 4).isEmpty()).toBe(false);
    expect(new Rectangle2(0, 0, 0, 4).isEmpty()).toBe(true);
    expect(new Rectangle2(0, 0, 4, 0).isEmpty()).toBe(true);
    expect(new Rectangle2(0, 0, -1, 4).isEmpty()).toBe(true);
    expect(new Rectangle2(0, 0, 4, -1).isEmpty()).toBe(true);
  });

  it("containsPoint is half-open on both axes: min edge in, max edge out", () => {
    const r = new Rectangle2(1, 2, 3, 4);
    // Corners: only the min corner is inside.
    expect(r.containsPoint(1, 2)).toBe(true);
    expect(r.containsPoint(4, 2)).toBe(false);
    expect(r.containsPoint(1, 6)).toBe(false);
    expect(r.containsPoint(4, 6)).toBe(false);
    // Interior and each outside half-plane.
    expect(r.containsPoint(2.5, 4)).toBe(true);
    expect(r.containsPoint(0.999, 4)).toBe(false);
    expect(r.containsPoint(2.5, 1.999)).toBe(false);
    // Adjacent rectangles partition: a shared edge belongs to exactly one.
    const neighbour = new Rectangle2(4, 2, 3, 4);
    expect(neighbour.containsPoint(4, 2)).toBe(true);
  });

  it("containsPoint on an empty rectangle contains nothing", () => {
    expect(new Rectangle2(1, 1, 0, 5).containsPoint(1, 1)).toBe(false);
    expect(new Rectangle2(1, 1, 5, 0).containsPoint(1, 1)).toBe(false);
  });

  it("equalsApprox compares all four components within the tolerance", () => {
    const r = new Rectangle2(1, 2, 3, 4);
    expect(r.equalsApprox(new Rectangle2(1, 2, 3, 4))).toBe(true);
    expect(r.equalsApprox(new Rectangle2(1 + 1e-7, 2, 3, 4 - 1e-7))).toBe(true);
    expect(r.equalsApprox(new Rectangle2(1.1, 2, 3, 4))).toBe(false);
    expect(r.equalsApprox(new Rectangle2(1, 2.1, 3, 4))).toBe(false);
    expect(r.equalsApprox(new Rectangle2(1, 2, 3.1, 4))).toBe(false);
    expect(r.equalsApprox(new Rectangle2(1, 2, 3, 4.1))).toBe(false);
    // An explicit tolerance widens the match.
    expect(r.equalsApprox(new Rectangle2(1.05, 2.05, 3.05, 4.05), 0.1)).toBe(
      true,
    );
  });
});

describe("Rectangle2 changed hook (plan D3)", () => {
  it("fires once per mutator and never for queries", () => {
    let calls = 0;
    const r = new Rectangle2(1, 2, 3, 4);
    r.onChanged = () => {
      calls += 1;
    };
    const other = new Rectangle2(5, 6, 7, 8);

    const mutators: Array<[string, () => void]> = [
      ["set", () => void r.set(1, 2, 3, 4)],
      ["copy", () => void r.copy(other)],
    ];
    for (const [name, run] of mutators) {
      const before = calls;
      run();
      expect(calls, `${name} must invoke the changed hook exactly once`).toBe(
        before + 1,
      );
    }

    const after = calls;
    r.clone();
    r.isEmpty();
    r.containsPoint(0, 0);
    r.equalsApprox(other);
    expect(calls).toBe(after);
  });

  it("copy does not carry the source's hook to the destination", () => {
    const source = new Rectangle2(1, 2, 3, 4);
    source.onChanged = () => undefined;
    const destination = new Rectangle2();
    destination.copy(source);
    expect(destination.onChanged).toBeUndefined();
  });
});

describe("Rectangle2 allocation counter (§7b, §83)", () => {
  beforeEach(() => {
    resetConstructionCount();
  });

  it("counts construction and clone; mutators and queries allocate nothing", () => {
    expect(constructionCount()).toBe(0);
    const r = new Rectangle2(1, 2, 3, 4);
    expect(constructionCount()).toBe(1);
    r.clone();
    expect(constructionCount()).toBe(2);

    const other = new Rectangle2(5, 6, 7, 8);
    resetConstructionCount();
    for (let i = 0; i < 1000; i += 1) {
      r.set(1, 2, 3, 4).copy(other);
      r.isEmpty();
      r.containsPoint(5.5, 6.5);
      r.equalsApprox(other);
    }
    expect(constructionCount()).toBe(0);
  });
});
