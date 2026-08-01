import { isFourError } from "@four/core";
import {
  Quaternion,
  Vector2,
  Vector3,
  Vector4,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { describe, expect, it } from "vitest";

import {
  AnimationTrack,
  type AnimationTrackLike,
  type InterpolationMode,
} from "../src/track.js";
import {
  booleanAdapter,
  colorAdapter,
  discreteAdapterFor,
  numberAdapter,
  quaternionAdapter,
  vector2Adapter,
  vector3Adapter,
  vector4Adapter,
  type ColorRGBA,
} from "../src/values.js";

/** Asserts that `run` throws the §89 error every malformed track reports. */
function expectInvalid(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(isFourError(thrown)).toBe(true);
  if (!isFourError(thrown)) {
    throw new Error("unreachable");
  }
  expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
  return thrown;
}

/** A scalar track, the shape most of the closed-form checks use. */
function scalarTrack(
  times: readonly number[],
  values: readonly number[],
  interpolation: InterpolationMode,
): AnimationTrack<number> {
  return new AnimationTrack({
    path: "value",
    adapter: numberAdapter,
    times,
    values,
    interpolation,
  });
}

describe("AnimationTrack construction", () => {
  it("keeps the authored path, adapter, times, and values", () => {
    const track = scalarTrack([0, 0.5, 1], [0, 10, 20], "linear");

    expect(track.path).toBe("value");
    expect(track.adapter).toBe(numberAdapter);
    expect(track.interpolation).toBe("linear");
    expect(track.times).toEqual([0, 0.5, 1]);
    expect(track.values).toEqual([0, 10, 20]);
    expect(track.keyframeCount).toBe(3);
    expect(track.startTime).toBe(0);
    expect(track.endTime).toBe(1);
  });

  it("defaults to linear interpolation", () => {
    const track = new AnimationTrack({
      path: "value",
      adapter: numberAdapter,
      times: [0, 1],
      values: [0, 1],
    });

    expect(track.interpolation).toBe("linear");
  });

  it("copies its input arrays so later mutation cannot corrupt the track", () => {
    const times = [0, 1];
    const values = [0, 10];
    const track = scalarTrack(times, values, "linear");

    times.push(2);
    values.push(20);

    expect(track.times).toEqual([0, 1]);
    expect(track.values).toEqual([0, 10]);
  });

  it("leaves inTangents/outTangents empty for the non-Hermite modes", () => {
    const track = scalarTrack([0, 1], [0, 1], "cubic");

    expect(track.inTangents).toEqual([]);
    expect(track.outTangents).toEqual([]);
  });

  it("rejects an empty property path", () => {
    const error = expectInvalid(
      () =>
        new AnimationTrack({
          path: "",
          adapter: numberAdapter,
          times: [0],
          values: [0],
        }),
    );

    expect(error.message).toContain("non-empty property path");
  });

  it("rejects a track with no keyframes", () => {
    const error = expectInvalid(() => scalarTrack([], [], "linear"));

    expect(error.message).toContain("at least one keyframe");
  });

  it("rejects mismatched times and values", () => {
    const error = expectInvalid(() => scalarTrack([0, 1], [0], "linear"));

    expect(error.message).toContain("2 keyframe times but 1 values");
  });

  it("rejects a non-finite keyframe time", () => {
    const error = expectInvalid(() =>
      scalarTrack([0, Number.NaN], [0, 1], "linear"),
    );

    expect(error.message).toContain("non-finite keyframe time");
  });

  it("rejects duplicate keyframe times", () => {
    const error = expectInvalid(() =>
      scalarTrack([0, 1, 1], [0, 1, 2], "linear"),
    );

    expect(error.message).toContain("strictly increasing");
  });

  it("rejects decreasing keyframe times", () => {
    expectInvalid(() => scalarTrack([0, 2, 1], [0, 1, 2], "linear"));
  });

  it("rejects cubic interpolation of quaternions (§17 gives them slerp)", () => {
    const error = expectInvalid(
      () =>
        new AnimationTrack({
          path: "transform.rotation",
          adapter: quaternionAdapter,
          times: [0, 1],
          values: [new Quaternion(), new Quaternion()],
          interpolation: "cubic",
        }),
    );

    expect(error.message).toContain("quaternion");
    expect(error.message).toContain('Use "step" or "linear"');
  });

  it("rejects cubic interpolation of booleans and discrete values", () => {
    expectInvalid(
      () =>
        new AnimationTrack({
          path: "visible",
          adapter: booleanAdapter,
          times: [0, 1],
          values: [false, true],
          interpolation: "cubic",
        }),
    );
    expectInvalid(
      () =>
        new AnimationTrack({
          path: "state",
          adapter: discreteAdapterFor<string>(),
          times: [0, 1],
          values: ["idle", "run"],
          interpolation: "hermite",
          inTangents: ["idle", "run"],
          outTangents: ["idle", "run"],
        }),
    );
  });

  it("rejects hermite interpolation without tangents", () => {
    const error = expectInvalid(() => scalarTrack([0, 1], [0, 1], "hermite"));

    expect(error.message).toContain("requires both inTangents and outTangents");
  });

  it("rejects hermite tangent arrays of the wrong length", () => {
    const error = expectInvalid(
      () =>
        new AnimationTrack({
          path: "value",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 1],
          interpolation: "hermite",
          inTangents: [0, 0],
          outTangents: [0],
        }),
    );

    expect(error.message).toContain("one in and one out tangent per keyframe");
  });
});

describe("AnimationTrack sampling outside the key range", () => {
  it("clamps below the first key and at or above the last", () => {
    const track = scalarTrack([1, 2], [10, 20], "linear");

    expect(track.sample(-100, 0)).toBe(10);
    expect(track.sample(1, 0)).toBe(10);
    expect(track.sample(2, 0)).toBe(20);
    expect(track.sample(100, 0)).toBe(20);
  });

  it("returns the only value of a single-key track at every time", () => {
    const track = scalarTrack([3], [7], "cubic");

    expect(track.sample(-1, 0)).toBe(7);
    expect(track.sample(3, 0)).toBe(7);
    expect(track.sample(1e6, 0)).toBe(7);
  });

  it("clamps into the caller's `out` for an in-place value kind", () => {
    const track = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1],
      values: [new Vector3(1, 2, 3), new Vector3(4, 5, 6)],
    });
    const out = new Vector3();

    expect(track.sample(-1, out)).toBe(out);
    expect(out).toEqual(new Vector3(1, 2, 3));
    expect(track.sample(9, out)).toBe(out);
    expect(out).toEqual(new Vector3(4, 5, 6));
  });
});

describe("AnimationTrack step interpolation", () => {
  it("holds each key's value until the next key is reached", () => {
    const track = scalarTrack([0, 1, 2], [10, 20, 30], "step");

    expect(track.sample(0, 0)).toBe(10);
    expect(track.sample(0.999, 0)).toBe(10);
    expect(track.sample(1, 0)).toBe(20);
    expect(track.sample(1.999, 0)).toBe(20);
    expect(track.sample(2, 0)).toBe(30);
  });

  it("steps Boolean tracks", () => {
    const track = new AnimationTrack({
      path: "visible",
      adapter: booleanAdapter,
      times: [0, 1, 2],
      values: [false, true, false],
      interpolation: "step",
    });

    expect(track.sample(0.5, false)).toBe(false);
    expect(track.sample(1, false)).toBe(true);
    expect(track.sample(1.5, false)).toBe(true);
    expect(track.sample(2, false)).toBe(false);
  });

  it("steps discrete tracks, carrying values by reference", () => {
    const idle = { name: "idle" };
    const run = { name: "run" };
    const track = new AnimationTrack({
      path: "state",
      adapter: discreteAdapterFor<{ name: string }>(),
      times: [0, 1],
      values: [idle, run],
      interpolation: "step",
    });

    expect(track.sample(0.5, idle)).toBe(idle);
    expect(track.sample(1, idle)).toBe(run);
  });

  it("degenerates to step for Boolean tracks asked to interpolate linearly", () => {
    // booleanAdapter.lerp is step-shaped, so "linear" cannot invent a half-true.
    const track = new AnimationTrack({
      path: "visible",
      adapter: booleanAdapter,
      times: [0, 1],
      values: [false, true],
      interpolation: "linear",
    });

    expect(track.sample(0.5, false)).toBe(false);
    expect(track.sample(1, false)).toBe(true);
  });
});

describe("AnimationTrack linear interpolation", () => {
  it("interpolates scalars over non-uniform spans", () => {
    const track = scalarTrack([0, 1, 3], [0, 10, 30], "linear");

    expect(track.sample(0.5, 0)).toBeCloseTo(5, 12);
    expect(track.sample(2, 0)).toBeCloseTo(20, 12);
  });

  it("interpolates vectors into `out` and returns it", () => {
    const track = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 2],
      values: [new Vector3(0, 0, 0), new Vector3(4, -8, 2)],
    });
    const out = new Vector3();

    expect(track.sample(0.5, out)).toBe(out);
    expect(out.x).toBeCloseTo(1, 12);
    expect(out.y).toBeCloseTo(-2, 12);
    expect(out.z).toBeCloseTo(0.5, 12);
  });

  it("slerps quaternion tracks — §17's fifth interpolation mode", () => {
    const halfRoot2 = Math.SQRT1_2;
    const track = new AnimationTrack({
      path: "transform.rotation",
      adapter: quaternionAdapter,
      times: [0, 1],
      // Identity → 90° about +Z.
      values: [
        new Quaternion(0, 0, 0, 1),
        new Quaternion(0, 0, halfRoot2, halfRoot2),
      ],
    });
    const out = new Quaternion();

    track.sample(0.5, out);

    // Constant angular speed puts the midpoint at 45°, not at the normalized
    // component average a lerp would give.
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(Math.sin(Math.PI / 8), 12);
    expect(out.w).toBeCloseTo(Math.cos(Math.PI / 8), 12);
  });

  it("takes the shortest arc when the keyed quaternions have opposite signs", () => {
    const halfRoot2 = Math.SQRT1_2;
    const track = new AnimationTrack({
      path: "transform.rotation",
      adapter: quaternionAdapter,
      times: [0, 1],
      // -q is the same rotation as q; the dot product is negative, so slerp
      // negates the target and travels 90° instead of 270°.
      values: [
        new Quaternion(0, 0, 0, 1),
        new Quaternion(0, 0, -halfRoot2, -halfRoot2),
      ],
    });
    const out = new Quaternion();

    track.sample(0.5, out);

    expect(out.z).toBeCloseTo(Math.sin(Math.PI / 8), 12);
    expect(out.w).toBeCloseTo(Math.cos(Math.PI / 8), 12);
  });

  it("interpolates colors component-wise without clamping (§60a)", () => {
    const track = new AnimationTrack<ColorRGBA>({
      path: "material.color",
      adapter: colorAdapter,
      times: [0, 1],
      values: [
        [-1, 0, 0, 1],
        [3, 1, 1, 1],
      ],
    });
    const out: ColorRGBA = [0, 0, 0, 0];

    expect(track.sample(0.5, out)).toBe(out);
    expect(out[0]).toBeCloseTo(1, 12);
    expect(out[1]).toBeCloseTo(0.5, 12);
    expect(out[2]).toBeCloseTo(0.5, 12);
    expect(out[3]).toBe(1);
  });
});

describe("AnimationTrack cubic interpolation", () => {
  // Uniform keys [0,1,2,3] over values [0,1,0,1]. The Catmull-Rom tangents are
  // d0 = 1 (one-sided secant), d1 = 1 - 0 - 1 = 0, d2 = -1 - 0 + 1 = 0,
  // d3 = 1 (one-sided secant); every span is 1 s, so m = d.
  //   span [0,1]: p(u) = h10·1 + h01·1 = -u³ + u² + u
  //   span [1,2]: p(u) = h00·1        = 2u³ - 3u² + 1
  const wave = () => scalarTrack([0, 1, 2, 3], [0, 1, 0, 1], "cubic");

  it("matches the hand-derived first span (clamped end tangent)", () => {
    const track = wave();

    expect(track.sample(0.25, 0)).toBeCloseTo(0.296875, 12);
    expect(track.sample(0.5, 0)).toBeCloseTo(0.625, 12);
  });

  it("matches the hand-derived interior span", () => {
    const track = wave();

    expect(track.sample(1.25, 0)).toBeCloseTo(0.84375, 12);
    expect(track.sample(1.5, 0)).toBeCloseTo(0.5, 12);
  });

  it("passes exactly through every keyframe", () => {
    const track = wave();

    expect(track.sample(0, 0)).toBe(0);
    expect(track.sample(1, 0)).toBeCloseTo(1, 12);
    expect(track.sample(2, 0)).toBeCloseTo(0, 12);
    expect(track.sample(3, 0)).toBe(1);
  });

  it("matches the hand-derived non-uniform case", () => {
    // times [0,1,3], values [0,2,3]:
    //   d0 = 2, d1 = 2/1 - 3/3 + 1/2 = 1.5, d2 = 1/2 = 0.5
    //   span [0,1] (1 s): m = (2, 1.5)  → p(0.5) = 1.0625
    //   span [1,3] (2 s): m = (3, 1)    → p(0.5) = 2.75
    const track = scalarTrack([0, 1, 3], [0, 2, 3], "cubic");

    expect(track.sample(0.5, 0)).toBeCloseTo(1.0625, 12);
    expect(track.sample(2, 0)).toBeCloseTo(2.75, 12);
  });

  it("degenerates to a straight line with only two keys", () => {
    // Both tangents are the same one-sided secant, so the Hermite basis
    // collapses to p(u) = start + (end - start)·u — matching the two-waypoint
    // case of @four/motion's Catmull-Rom trajectory.
    const cubic = scalarTrack([0, 2], [0, 4], "cubic");
    const linear = scalarTrack([0, 2], [0, 4], "linear");

    for (const time of [0.25, 0.5, 1, 1.5, 1.75]) {
      expect(cubic.sample(time, 0)).toBeCloseTo(linear.sample(time, 0), 12);
    }
  });

  it("overshoots rather than clamping", () => {
    const track = scalarTrack([0, 1, 2, 3], [0, 0, 1, 1], "cubic");
    let maximum = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= 300; step += 1) {
      maximum = Math.max(maximum, track.sample(step / 100, 0));
    }

    expect(maximum).toBeGreaterThan(1);
  });

  it("evaluates Vector2 tracks component-wise", () => {
    const track = new AnimationTrack({
      path: "position2d",
      adapter: vector2Adapter,
      times: [0, 1, 2, 3],
      values: [
        new Vector2(0, 0),
        new Vector2(1, -1),
        new Vector2(0, 0),
        new Vector2(1, -1),
      ],
      interpolation: "cubic",
    });
    const out = new Vector2();

    expect(track.sample(1.25, out)).toBe(out);
    expect(out.x).toBeCloseTo(0.84375, 12);
    expect(out.y).toBeCloseTo(-0.84375, 12);
  });

  it("evaluates Vector3 tracks component-wise", () => {
    const track = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1, 2, 3],
      values: [
        new Vector3(0, 0, 0),
        new Vector3(1, 2, -1),
        new Vector3(0, 0, 0),
        new Vector3(1, 2, -1),
      ],
      interpolation: "cubic",
    });
    const out = new Vector3();

    track.sample(1.25, out);

    expect(out.x).toBeCloseTo(0.84375, 12);
    expect(out.y).toBeCloseTo(1.6875, 12);
    expect(out.z).toBeCloseTo(-0.84375, 12);
  });

  it("evaluates Vector4 tracks component-wise", () => {
    const track = new AnimationTrack({
      path: "tint",
      adapter: vector4Adapter,
      times: [0, 1, 2, 3],
      values: [
        new Vector4(0, 0, 0, 0),
        new Vector4(1, 2, -1, 4),
        new Vector4(0, 0, 0, 0),
        new Vector4(1, 2, -1, 4),
      ],
      interpolation: "cubic",
    });
    const out = new Vector4();

    track.sample(1.25, out);

    expect(out.x).toBeCloseTo(0.84375, 12);
    expect(out.y).toBeCloseTo(1.6875, 12);
    expect(out.z).toBeCloseTo(-0.84375, 12);
    expect(out.w).toBeCloseTo(3.375, 12);
  });

  it("evaluates color tracks component-wise, unclamped", () => {
    const track = new AnimationTrack<ColorRGBA>({
      path: "material.color",
      adapter: colorAdapter,
      times: [0, 1, 2, 3],
      values: [
        [0, 0, 0, 0],
        [1, 2, -1, 4],
        [0, 0, 0, 0],
        [1, 2, -1, 4],
      ],
      interpolation: "cubic",
    });
    const out: ColorRGBA = [0, 0, 0, 0];

    expect(track.sample(1.25, out)).toBe(out);
    expect(out[0]).toBeCloseTo(0.84375, 12);
    expect(out[1]).toBeCloseTo(1.6875, 12);
    expect(out[2]).toBeCloseTo(-0.84375, 12);
    expect(out[3]).toBeCloseTo(3.375, 12);
  });
});

describe("AnimationTrack hermite interpolation", () => {
  it("matches the hand-derived flat-tangent case", () => {
    // Zero tangents on a 1 s span: p(u) = h01 = -2u³ + 3u² (smoothstep).
    const track = new AnimationTrack({
      path: "value",
      adapter: numberAdapter,
      times: [0, 1],
      values: [0, 1],
      interpolation: "hermite",
      inTangents: [0, 0],
      outTangents: [0, 0],
    });

    expect(track.sample(0.25, 0)).toBeCloseTo(0.15625, 12);
    expect(track.sample(0.5, 0)).toBeCloseTo(0.5, 12);
  });

  it("reads tangents as value units per second", () => {
    // 2 s span with unit per-second tangents: m = 1 · 2 = 2, so
    // p(u) = 2·h10 + h01 + 2·h11 = 2u³ - 3u² + 2u.
    const track = new AnimationTrack({
      path: "value",
      adapter: numberAdapter,
      times: [0, 2],
      values: [0, 1],
      interpolation: "hermite",
      inTangents: [1, 1],
      outTangents: [1, 1],
    });

    expect(track.sample(0.5, 0)).toBeCloseTo(0.34375, 12);
    expect(track.sample(1, 0)).toBeCloseTo(0.5, 12);
  });

  it("uses the left key's out tangent and the right key's in tangent", () => {
    const asymmetric = new AnimationTrack({
      path: "value",
      adapter: numberAdapter,
      times: [0, 1],
      values: [0, 1],
      interpolation: "hermite",
      // Only inTangents[1] and outTangents[0] can matter on the single span.
      inTangents: [999, 0],
      outTangents: [0, 999],
    });
    const flat = new AnimationTrack({
      path: "value",
      adapter: numberAdapter,
      times: [0, 1],
      values: [0, 1],
      interpolation: "hermite",
      inTangents: [0, 0],
      outTangents: [0, 0],
    });

    expect(asymmetric.sample(0.5, 0)).toBeCloseTo(flat.sample(0.5, 0), 12);
  });

  it("reproduces the cubic track when handed the Catmull-Rom tangents", () => {
    // The derived tangents for times [0,1,3] / values [0,2,3] are 2, 1.5, 0.5.
    const cubic = scalarTrack([0, 1, 3], [0, 2, 3], "cubic");
    const hermite = new AnimationTrack({
      path: "value",
      adapter: numberAdapter,
      times: [0, 1, 3],
      values: [0, 2, 3],
      interpolation: "hermite",
      inTangents: [2, 1.5, 0.5],
      outTangents: [2, 1.5, 0.5],
    });

    for (const time of [0.25, 0.5, 1, 1.5, 2, 2.75]) {
      expect(hermite.sample(time, 0)).toBeCloseTo(cubic.sample(time, 0), 12);
    }
  });

  it("evaluates vector tracks component-wise", () => {
    const track = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1],
      values: [new Vector3(0, 0, 0), new Vector3(1, 2, -4)],
      interpolation: "hermite",
      inTangents: [new Vector3(), new Vector3()],
      outTangents: [new Vector3(), new Vector3()],
    });
    const out = new Vector3();

    track.sample(0.25, out);

    expect(out.x).toBeCloseTo(0.15625, 12);
    expect(out.y).toBeCloseTo(0.3125, 12);
    expect(out.z).toBeCloseTo(-0.625, 12);
  });
});

describe("AnimationTrack span search", () => {
  it("agrees with a linear scan across a long track", () => {
    const times: number[] = [];
    const values: number[] = [];
    for (let index = 0; index < 257; index += 1) {
      // Non-uniform spacing so the search cannot get away with arithmetic.
      times.push(index * 0.1 + (index % 3) * 0.01);
      values.push(index);
    }
    const track = scalarTrack(times, values, "step");

    /** The span index a linear scan would pick, with the same clamping. */
    const oracle = (time: number): number => {
      if (time <= times[0]) {
        return 0;
      }
      if (time >= times[times.length - 1]) {
        return times.length - 1;
      }
      let index = 0;
      while (index < times.length - 2 && times[index + 1] <= time) {
        index += 1;
      }
      return index;
    };

    // Deterministic sweep (§33: no Math.random anywhere near a test oracle),
    // deliberately including exact key times and both ends.
    for (let step = -20; step <= 2800; step += 1) {
      const time = step * 0.01;
      expect(track.sample(time, -1)).toBe(oracle(time));
    }
    for (const time of times) {
      expect(track.sample(time, -1)).toBe(oracle(time));
    }
  });
});

describe("AnimationTrack purity and allocation", () => {
  it("returns the same value for the same time (§16)", () => {
    const track = scalarTrack([0, 1, 2, 3], [0, 1, 0, 1], "cubic");
    const first = track.sample(1.234, 0);

    track.sample(0.1, 0);
    track.sample(2.9, 0);

    expect(track.sample(1.234, 0)).toBe(first);
  });

  it("preserves `out` identity and never touches the keyframe values", () => {
    const keys = [new Vector3(0, 0, 0), new Vector3(1, 1, 1)];
    const track = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1],
      values: keys,
      interpolation: "cubic",
    });
    const out = new Vector3();

    expect(track.sample(0.5, out)).toBe(out);
    expect(keys[0]).toEqual(new Vector3(0, 0, 0));
    expect(keys[1]).toEqual(new Vector3(1, 1, 1));
  });

  it("allocates no math objects while sampling repeatedly (§7b)", () => {
    const vectors = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1, 2, 3],
      values: [
        new Vector3(0, 0, 0),
        new Vector3(1, 2, 3),
        new Vector3(-1, 0, 1),
        new Vector3(2, 2, 2),
      ],
      interpolation: "cubic",
    });
    const rotations = new AnimationTrack({
      path: "transform.rotation",
      adapter: quaternionAdapter,
      times: [0, 1],
      values: [
        new Quaternion(0, 0, 0, 1),
        new Quaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2),
      ],
    });
    const scalars = scalarTrack([0, 1, 2], [0, 5, 10], "linear");
    const vectorOut = new Vector3();
    const quaternionOut = new Quaternion();

    resetConstructionCount();
    for (let step = 0; step < 1000; step += 1) {
      const time = step * 0.003;
      vectors.sample(time, vectorOut);
      rotations.sample(time, quaternionOut);
      scalars.sample(time, 0);
    }

    expect(constructionCount()).toBe(0);
  });
});

describe("AnimationTrackLike", () => {
  it("erases the value type without losing the sampling contract", () => {
    const track = new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1],
      values: [new Vector3(0, 0, 0), new Vector3(2, 4, 6)],
    });
    const erased: AnimationTrackLike = track;
    const out: unknown = new Vector3();

    expect(erased.path).toBe("transform.position");
    expect(erased.adapter.kind).toBe("vector3");
    expect(erased.interpolation).toBe("linear");
    expect(erased.keyframeCount).toBe(2);
    expect(erased.startTime).toBe(0);
    expect(erased.endTime).toBe(1);
    expect(erased.times).toEqual([0, 1]);
    expect(erased.values).toHaveLength(2);
    expect(erased.sample(0.5, out)).toBe(out);
    expect(out).toEqual(new Vector3(1, 2, 3));
  });
});
