import { describe, expect, it } from "vitest";

import {
  isBlendTree,
  locateBlend1D,
  locateBlend2D,
  type Blend2DRank,
} from "../src/blend-tree.js";
import { AnimationClip } from "../src/clip.js";
import { AnimationTrack } from "../src/track.js";
import { numberAdapter } from "../src/values.js";

function dummyClip(): AnimationClip {
  return new AnimationClip({
    name: "d",
    tracks: [
      new AnimationTrack({
        path: "opacity",
        adapter: numberAdapter,
        times: [0],
        values: [1],
      }),
    ],
  });
}

describe("isBlendTree", () => {
  it("accepts both shipped kinds and rejects clips", () => {
    const clip = dummyClip();
    expect(isBlendTree({ kind: "blend1d", parameter: "speed", points: [] })).toBe(
      true,
    );
    expect(
      isBlendTree({
        kind: "blend2d",
        parameterX: "x",
        parameterY: "y",
        points: [],
      }),
    ).toBe(true);
    expect(isBlendTree(clip)).toBe(false);
    expect(isBlendTree({ clip })).toBe(false);
    expect(isBlendTree({ kind: "other" })).toBe(false);
  });
});

describe("locateBlend1D", () => {
  const values = [-1, 0, 0, 2];

  it("clamps to the ends", () => {
    expect(locateBlend1D(values, -4)).toEqual({ i0: 0, i1: 0, t: 0 });
    expect(locateBlend1D(values, 9)).toEqual({ i0: 3, i1: 3, t: 0 });
  });

  it("lerps between surrounding points", () => {
    expect(locateBlend1D(values, 1)).toEqual({ i0: 2, i1: 3, t: 0.5 });
  });

  it("uses t = 0 on a zero-width span (duplicate values)", () => {
    expect(locateBlend1D(values, 0)).toEqual({ i0: 1, i1: 2, t: 0 });
  });

  it("returns the only point when the axis is a singleton", () => {
    expect(locateBlend1D([5], 0)).toEqual({ i0: 0, i1: 0, t: 0 });
    expect(locateBlend1D([5], 99)).toEqual({ i0: 0, i1: 0, t: 0 });
  });
});

describe("locateBlend2D", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 4, y: 4 },
  ];

  function rank(): Blend2DRank[] {
    return points.map(() => ({ index: 0, distance: 0 }));
  }

  it("returns the exact point at distance 0", () => {
    const indices = [0, 0, 0];
    const weights = [0, 0, 0];
    const count = locateBlend2D(points, 1, 0, rank(), indices, weights);
    expect(count).toBe(1);
    expect(indices[0]).toBe(1);
    expect(weights[0]).toBe(1);
  });

  it("weights the nearest three by inverse distance", () => {
    const indices = [0, 0, 0];
    const weights = [0, 0, 0];
    const count = locateBlend2D(points, 0.25, 0.25, rank(), indices, weights);
    expect(count).toBe(3);
    expect(new Set(indices.slice(0, 3))).toEqual(new Set([0, 1, 2]));
    const sum = weights[0] + weights[1] + weights[2];
    expect(sum).toBeCloseTo(1, 12);
    const origin = indices.indexOf(0);
    const far = indices.indexOf(3);
    expect(origin).toBeGreaterThanOrEqual(0);
    expect(far).toBe(-1);
    expect(weights[origin]).toBeGreaterThan(weights[0] === weights[origin] ? 0 : 0);
  });

  it("breaks distance ties by declaration order", () => {
    const tied = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const indices = [0, 0, 0];
    const weights = [0, 0, 0];
    const count = locateBlend2D(
      tied,
      0,
      0,
      [
        { index: 0, distance: 0 },
        { index: 0, distance: 0 },
      ],
      indices,
      weights,
    );
    expect(count).toBe(2);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(1);
    expect(weights[0]).toBeCloseTo(0.5, 12);
    expect(weights[1]).toBeCloseTo(0.5, 12);
  });

  it("uses every point when there are fewer than three", () => {
    const two = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
    const indices = [0, 0, 0];
    const weights = [0, 0, 0];
    const count = locateBlend2D(
      two,
      1,
      0,
      [
        { index: 0, distance: 0 },
        { index: 0, distance: 0 },
      ],
      indices,
      weights,
    );
    expect(count).toBe(2);
    expect(weights[0]).toBeCloseTo(0.5, 12);
    expect(weights[1]).toBeCloseTo(0.5, 12);
  });
});
