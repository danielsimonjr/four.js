/**
 * Blend trees for {@link ./controller.js#AnimationController} (PH-9, §18).
 *
 * A state is either one {@link ./clip.js#AnimationClip} or a tree whose pose
 * is a parameter-driven weighted mix of several clips. The controller reuses
 * its channel model unchanged: a tree is an N-way weighted sample where a
 * transition is a 2-way one.
 *
 * Evaluation is a pure function of the declared parameters and declaration
 * order (§33): 1D points are sorted by value (then authored index), 2D
 * neighbours are ranked by distance then authored index. No clock, no RNG.
 */

import type { AnimationClip } from "./clip.js";

/** One sample on a 1D blend axis. */
export interface BlendTree1DPoint {
  /** Parameter value this clip is authored at. Must be finite. */
  readonly value: number;
  /** Clip posed at this point. */
  readonly clip: AnimationClip;
}

/** One sample in a 2D blend field. */
export interface BlendTree2DPoint {
  /** Parameter-X value. Must be finite. */
  readonly x: number;
  /** Parameter-Y value. Must be finite. */
  readonly y: number;
  /** Clip posed at this point. */
  readonly clip: AnimationClip;
}

/** Linear blend along one numeric parameter. */
export interface BlendTree1D {
  readonly kind: "blend1d";
  /** Declared number parameter that drives the mix. */
  readonly parameter: string;
  /**
   * Clips on the parameter axis, in declaration order. The two surrounding
   * points (clamped to the ends) are lerped by the parameter.
   */
  readonly points: readonly BlendTree1DPoint[];
}

/** Inverse-distance blend of the nearest ≤3 points in a 2D field. */
export interface BlendTree2D {
  readonly kind: "blend2d";
  /** Declared number parameter for the X axis. */
  readonly parameterX: string;
  /** Declared number parameter for the Y axis. */
  readonly parameterY: string;
  /**
   * Clips in the parameter plane, in declaration order. Ties in distance
   * break by this order (§33).
   */
  readonly points: readonly BlendTree2DPoint[];
}

/** A state's pose source when it is not a single clip. */
export type BlendTree = BlendTree1D | BlendTree2D;

/** True when `input` is a {@link BlendTree} record (not a clip or options). */
export function isBlendTree(input: object): input is BlendTree {
  if (!("kind" in input)) {
    return false;
  }
  const kind = input.kind;
  return kind === "blend1d" || kind === "blend2d";
}

/**
 * Locates the 1D blend interval for `parameter`.
 *
 * `points` must already be sorted by `value` then declaration index.
 * Returns two indices and a lerp `t` in `[0, 1]`; `i0 === i1` at a clamp
 * or a zero-width span (duplicate values), with `t === 0`.
 */
export function locateBlend1D(
  values: readonly number[],
  parameter: number,
): { i0: number; i1: number; t: number } {
  const last = values.length - 1;
  if (last <= 0 || parameter <= values[0]) {
    return { i0: 0, i1: 0, t: 0 };
  }
  if (parameter >= values[last]) {
    return { i0: last, i1: last, t: 0 };
  }
  for (let index = 0; index < last; index += 1) {
    const hi = values[index + 1];
    if (parameter <= hi) {
      const lo = values[index];
      const span = hi - lo;
      return {
        i0: index,
        i1: index + 1,
        t: span === 0 ? 0 : (parameter - lo) / span,
      };
    }
  }
  return { i0: last, i1: last, t: 0 };
}

/** One ranked 2D neighbour, reused as a scratch so ranking allocates nothing. */
export interface Blend2DRank {
  index: number;
  distance: number;
}

/**
 * Ranks 2D points by distance to `(x, y)`, then declaration index, and writes
 * inverse-distance weights of the nearest `min(3, n)` into `indices`/`weights`.
 *
 * `rank` must have length `>= points`; it is sorted in place. A zero-distance
 * hit takes that single point at weight 1.
 *
 * @returns the number of contributing points (1–3).
 */
export function locateBlend2D(
  points: readonly { readonly x: number; readonly y: number }[],
  x: number,
  y: number,
  rank: Blend2DRank[],
  indices: number[],
  weights: number[],
): number {
  const count = points.length;
  for (let index = 0; index < count; index += 1) {
    const point = points[index];
    const dx = x - point.x;
    const dy = y - point.y;
    const entry = rank[index];
    entry.index = index;
    entry.distance = Math.hypot(dx, dy);
  }
  // Insertion sort of the live prefix — no allocation, and point counts are
  // small. Distance first, then authored index (§33).
  for (let index = 1; index < count; index += 1) {
    const current = rank[index];
    let walk = index - 1;
    while (
      walk >= 0 &&
      (rank[walk].distance > current.distance ||
        (rank[walk].distance === current.distance &&
          rank[walk].index > current.index))
    ) {
      rank[walk + 1] = rank[walk];
      walk -= 1;
    }
    rank[walk + 1] = current;
  }

  if (rank[0].distance === 0) {
    indices[0] = rank[0].index;
    weights[0] = 1;
    return 1;
  }

  const take = count < 3 ? count : 3;
  let sum = 0;
  for (let index = 0; index < take; index += 1) {
    const inverse = 1 / rank[index].distance;
    indices[index] = rank[index].index;
    weights[index] = inverse;
    sum += inverse;
  }
  for (let index = 0; index < take; index += 1) {
    weights[index] /= sum;
  }
  return take;
}
