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
  booleanAdapter,
  colorAdapter,
  detectAdapter,
  discreteAdapter,
  discreteAdapterFor,
  numberAdapter,
  quaternionAdapter,
  vector2Adapter,
  vector3Adapter,
  vector4Adapter,
  type ColorRGBA,
} from "../src/values.js";

describe("numberAdapter", () => {
  it("describes itself as a by-value scalar adapter", () => {
    expect(numberAdapter.kind).toBe("number");
    expect(numberAdapter.mutatesInPlace).toBe(false);
  });

  it("clones and copies by returning the value", () => {
    expect(numberAdapter.clone(3.5)).toBe(3.5);
    expect(numberAdapter.copy(3.5, 0)).toBe(3.5);
  });

  it("interpolates endpoints and the midpoint", () => {
    expect(numberAdapter.lerp(0, 10, 0, 0)).toBe(0);
    expect(numberAdapter.lerp(0, 10, 0.5, 0)).toBe(5);
    expect(numberAdapter.lerp(0, 10, 1, 0)).toBe(10);
  });

  it("extrapolates outside [0, 1] without clamping", () => {
    expect(numberAdapter.lerp(0, 10, -0.5, 0)).toBe(-5);
    expect(numberAdapter.lerp(0, 10, 1.5, 0)).toBe(15);
  });

  it("ignores `out` entirely — the result flows by return value", () => {
    // The documented primitive contract: passing a stale `out` cannot corrupt
    // the result, and the caller must use what comes back.
    expect(numberAdapter.lerp(2, 4, 0.5, 999)).toBe(3);
  });

  it("adds a weighted delta (PH-9 additive)", () => {
    expect(numberAdapter.add(2, 4, 0.5, 0)).toBe(4);
    expect(numberAdapter.add(10, -2, 2, 0)).toBe(6);
  });
});

describe("vector adapters", () => {
  it("vector2 interpolates in place and returns `out`", () => {
    const a = new Vector2(0, 0);
    const b = new Vector2(10, -4);
    const out = new Vector2();

    expect(vector2Adapter.kind).toBe("vector2");
    expect(vector2Adapter.mutatesInPlace).toBe(true);
    expect(vector2Adapter.lerp(a, b, 0, out)).toBe(out);
    expect(out.equalsApprox(a)).toBe(true);
    vector2Adapter.lerp(a, b, 0.5, out);
    expect(out.equalsApprox(new Vector2(5, -2))).toBe(true);
    vector2Adapter.lerp(a, b, 1, out);
    expect(out.equalsApprox(b)).toBe(true);
  });

  it("vector3 interpolates in place and returns `out`", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(3, 6, -1);
    const out = new Vector3();

    expect(vector3Adapter.kind).toBe("vector3");
    expect(vector3Adapter.lerp(a, b, 0, out).equalsApprox(a)).toBe(true);
    expect(
      vector3Adapter.lerp(a, b, 0.5, out).equalsApprox(new Vector3(2, 4, 1)),
    ).toBe(true);
    expect(vector3Adapter.lerp(a, b, 1, out).equalsApprox(b)).toBe(true);
  });

  it("vector4 interpolates in place and returns `out`", () => {
    const a = new Vector4(0, 0, 0, 0);
    const b = new Vector4(2, 4, 6, 8);
    const out = new Vector4();

    expect(vector4Adapter.kind).toBe("vector4");
    expect(
      vector4Adapter
        .lerp(a, b, 0.25, out)
        .equalsApprox(new Vector4(0.5, 1, 1.5, 2)),
    ).toBe(true);
  });

  it("tolerates `out` aliasing the start value", () => {
    // The documented aliasing rule: `out === a` is fine (this is how a binding
    // interpolates a live property away from its current value).
    const live = new Vector3(0, 0, 0);
    const end = new Vector3(4, 0, 0);
    vector3Adapter.lerp(live, end, 0.5, live);
    expect(live.equalsApprox(new Vector3(2, 0, 0))).toBe(true);
  });

  it("clones independently and copies without replacing the target", () => {
    const source = new Vector3(1, 2, 3);
    const copy = vector3Adapter.clone(source);
    copy.set(9, 9, 9);
    expect(source.equalsApprox(new Vector3(1, 2, 3))).toBe(true);

    const target = new Vector3();
    expect(vector3Adapter.copy(source, target)).toBe(target);
    expect(target.equalsApprox(source)).toBe(true);
  });

  it("adds a weighted vector without aliasing the start", () => {
    const a = new Vector3(1, 2, 3);
    const b = new Vector3(10, 0, -4);
    const out = new Vector3();
    expect(
      vector3Adapter.add(a, b, 0.5, out).equalsApprox(new Vector3(6, 2, 1)),
    ).toBe(true);
    vector3Adapter.add(a, b, 1, a);
    expect(a.equalsApprox(new Vector3(11, 2, -1))).toBe(true);
  });

  it("extrapolates without clamping, like @four/math", () => {
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 1, 1);
    const out = new Vector3();
    expect(
      vector3Adapter.lerp(a, b, 2, out).equalsApprox(new Vector3(2, 2, 2)),
    ).toBe(true);
  });
});

describe("quaternionAdapter", () => {
  const yAxis = new Vector3(0, 1, 0);

  it("slerps endpoints and the midpoint", () => {
    const a = new Quaternion();
    const b = new Quaternion().setFromAxisAngle(yAxis, Math.PI / 2);
    const out = new Quaternion();

    expect(quaternionAdapter.kind).toBe("quaternion");
    expect(quaternionAdapter.mutatesInPlace).toBe(true);
    expect(quaternionAdapter.lerp(a, b, 0, out)).toBe(out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.w).toBeCloseTo(1, 12);

    quaternionAdapter.lerp(a, b, 0.5, out);
    const half = new Quaternion().setFromAxisAngle(yAxis, Math.PI / 4);
    expect(out.x).toBeCloseTo(half.x, 12);
    expect(out.y).toBeCloseTo(half.y, 12);
    expect(out.z).toBeCloseTo(half.z, 12);
    expect(out.w).toBeCloseTo(half.w, 12);

    quaternionAdapter.lerp(a, b, 1, out);
    expect(out.y).toBeCloseTo(b.y, 12);
    expect(out.w).toBeCloseTo(b.w, 12);
  });

  it("takes the shortest arc across the antipodal sign case", () => {
    // `-q` is the same rotation as `q`. Handing the adapter the negated form of
    // the 90° target must still produce the 45° rotation at t = 0.5 — not the
    // 135° long way round.
    const a = new Quaternion();
    const b = new Quaternion().setFromAxisAngle(yAxis, Math.PI / 2);
    const negatedB = new Quaternion(-b.x, -b.y, -b.z, -b.w);

    const viaB = new Quaternion();
    const viaNegated = new Quaternion();
    quaternionAdapter.lerp(a, b, 0.5, viaB);
    quaternionAdapter.lerp(a, negatedB, 0.5, viaNegated);

    expect(viaNegated.x).toBeCloseTo(viaB.x, 12);
    expect(viaNegated.y).toBeCloseTo(viaB.y, 12);
    expect(viaNegated.z).toBeCloseTo(viaB.z, 12);
    expect(viaNegated.w).toBeCloseTo(viaB.w, 12);

    // The long way round would have landed on the 135° rotation; assert we did
    // not, so the test fails loudly if `slerp` ever stops negating.
    const long = new Quaternion().setFromAxisAngle(yAxis, (3 * Math.PI) / 4);
    expect(Math.abs(viaNegated.y - long.y)).toBeGreaterThan(0.1);
  });

  it("lands on the target rotation (with flipped components) at t = 1", () => {
    const a = new Quaternion();
    const b = new Quaternion().setFromAxisAngle(yAxis, Math.PI / 2);
    const negatedB = new Quaternion(-b.x, -b.y, -b.z, -b.w);
    const out = new Quaternion();

    quaternionAdapter.lerp(a, negatedB, 1, out);
    // Equal to `b`, i.e. `-negatedB`: the same rotation as the requested
    // target, expressed with the sign that kept the arc short.
    expect(out.y).toBeCloseTo(b.y, 12);
    expect(out.w).toBeCloseTo(b.w, 12);
  });

  it("adds by multiplying an identity-lerped delta (PH-9)", () => {
    const a = new Quaternion();
    const b = new Quaternion().setFromAxisAngle(yAxis, Math.PI / 2);
    const out = new Quaternion();
    quaternionAdapter.add(a, b, 0.5, out);
    const half = new Quaternion().setFromAxisAngle(yAxis, Math.PI / 4);
    expect(out.y).toBeCloseTo(half.y, 12);
    expect(out.w).toBeCloseTo(half.w, 12);

    quaternionAdapter.add(a, b, 0, out);
    expect(out.w).toBeCloseTo(1, 12);
    expect(out.y).toBeCloseTo(0, 12);
  });

  it("clones independently and copies into the target", () => {
    const source = new Quaternion().setFromAxisAngle(yAxis, 1);
    const copy = quaternionAdapter.clone(source);
    copy.identity();
    expect(source.w).toBeCloseTo(Math.cos(0.5), 12);

    const target = new Quaternion();
    expect(quaternionAdapter.copy(source, target)).toBe(target);
    expect(target.w).toBeCloseTo(source.w, 12);
  });
});

describe("colorAdapter", () => {
  it("interpolates component-wise, including alpha", () => {
    const a: ColorRGBA = [0, 0, 0, 1];
    const b: ColorRGBA = [1, 0.5, 0.25, 0];
    const out: ColorRGBA = [0, 0, 0, 0];

    expect(colorAdapter.kind).toBe("color");
    expect(colorAdapter.mutatesInPlace).toBe(true);
    expect(colorAdapter.lerp(a, b, 0, out)).toBe(out);
    expect(out).toEqual([0, 0, 0, 1]);
    colorAdapter.lerp(a, b, 0.5, out);
    expect(out).toEqual([0.5, 0.25, 0.125, 0.5]);
    colorAdapter.lerp(a, b, 1, out);
    expect(out).toEqual([1, 0.5, 0.25, 0]);
  });

  it("does not clamp out-of-range components (§60a extended range)", () => {
    const a: ColorRGBA = [-0.5, 2, 0, 1];
    const b: ColorRGBA = [1.5, -1, 4, 1];
    const out: ColorRGBA = [0, 0, 0, 0];

    colorAdapter.lerp(a, b, 0.5, out);
    expect(out).toEqual([0.5, 0.5, 2, 1]);

    colorAdapter.lerp(a, b, 2, out);
    expect(out).toEqual([3.5, -4, 8, 1]);
  });

  it("clones into a fresh array and copies into the existing one", () => {
    const source: ColorRGBA = [1, 2, 3, 4];
    const copy = colorAdapter.clone(source);
    expect(copy).not.toBe(source);
    expect(copy).toEqual(source);

    const target: ColorRGBA = [0, 0, 0, 0];
    expect(colorAdapter.copy(source, target)).toBe(target);
    expect(target).toEqual([1, 2, 3, 4]);
  });

  it("adds a weighted colour (PH-9 additive)", () => {
    const a: ColorRGBA = [1, 0, 0, 1];
    const b: ColorRGBA = [0, 2, 0, 0];
    const out: ColorRGBA = [0, 0, 0, 0];
    colorAdapter.add(a, b, 0.5, out);
    expect(out).toEqual([1, 1, 0, 1]);
  });

  it("is safe when `out` aliases either endpoint", () => {
    const a: ColorRGBA = [0, 0, 0, 0];
    const b: ColorRGBA = [1, 1, 1, 1];
    colorAdapter.lerp(a, b, 0.5, b);
    expect(b).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe("step adapters", () => {
  it("boolean holds `a` until exactly t = 1", () => {
    expect(booleanAdapter.kind).toBe("boolean");
    expect(booleanAdapter.mutatesInPlace).toBe(false);
    expect(booleanAdapter.lerp(false, true, 0, false)).toBe(false);
    expect(booleanAdapter.lerp(false, true, 0.999999, false)).toBe(false);
    expect(booleanAdapter.lerp(false, true, 1, false)).toBe(true);
    expect(booleanAdapter.lerp(false, true, 1.5, false)).toBe(true);
    expect(booleanAdapter.lerp(false, true, -1, false)).toBe(false);
  });

  it("boolean add ignores the overlay and returns the base", () => {
    expect(booleanAdapter.add(true, false, 1, false)).toBe(true);
    expect(discreteAdapter.add("idle", "run", 1, "idle")).toBe("idle");
  });

  it("boolean clones and copies by value", () => {
    expect(booleanAdapter.clone(true)).toBe(true);
    expect(booleanAdapter.copy(true, false)).toBe(true);
  });

  it("discrete steps arbitrary values and carries them by reference", () => {
    const idle = { name: "idle" };
    const run = { name: "run" };

    expect(discreteAdapter.kind).toBe("discrete");
    expect(discreteAdapter.mutatesInPlace).toBe(false);
    expect(discreteAdapter.lerp(idle, run, 0.5, undefined)).toBe(idle);
    expect(discreteAdapter.lerp(idle, run, 1, undefined)).toBe(run);
    // By reference, not by copy: `clone` hands back the very same object.
    expect(discreteAdapter.clone(idle)).toBe(idle);
    expect(discreteAdapter.copy(run, idle)).toBe(run);
  });

  it("discreteAdapterFor returns the shared instance, typed", () => {
    const typed = discreteAdapterFor<"idle" | "run">();
    expect(typed).toBe(discreteAdapter);
    expect(typed.lerp("idle", "run", 1, "idle")).toBe("run");
  });
});

describe("detectAdapter", () => {
  it("maps each supported value shape to its adapter", () => {
    const cases: readonly [unknown, unknown][] = [
      [1, numberAdapter],
      [Number.NaN, numberAdapter],
      [true, booleanAdapter],
      [new Vector2(), vector2Adapter],
      [new Vector3(), vector3Adapter],
      [new Vector4(), vector4Adapter],
      [new Quaternion(), quaternionAdapter],
      [[0, 0, 0, 1], colorAdapter],
    ];
    for (const [value, expected] of cases) {
      expect(detectAdapter(value)).toBe(expected);
    }
  });

  it("returns undefined for shapes it cannot name", () => {
    const cases: readonly unknown[] = [
      null,
      undefined,
      "red",
      [0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, "1"],
      {},
      new Date(0),
      () => 0,
    ];
    for (const value of cases) {
      expect(detectAdapter(value)).toBeUndefined();
    }
  });

  it("never guesses the discrete adapter — it is opt-in", () => {
    expect(detectAdapter({ name: "idle" })).toBeUndefined();
    expect(detectAdapter("idle")).toBeUndefined();
  });

  it("reports any four-number array as a color (documented ambiguity)", () => {
    // A generic numeric quadruple is indistinguishable from an RGBA tuple at
    // runtime. Detection resolves it as "color" because the interpolation is
    // identical either way — component-wise, unclamped — so only the reported
    // `kind` differs, and callers who care pass an explicit adapter.
    const uvRect = [0, 0, 1, 1];
    const adapter = detectAdapter(uvRect);
    expect(adapter).toBe(colorAdapter);

    const out = [0, 0, 0, 0];
    adapter?.lerp(uvRect, [2, 2, 3, 3], 0.5, out);
    expect(out).toEqual([1, 1, 2, 2]);
  });
});

describe("allocation discipline (§7b)", () => {
  it("allocates no math objects in steady-state lerp/copy loops", () => {
    // `constructionCount` counts @four/math constructions only, so this proves
    // the vector/quaternion paths; the number, boolean, discrete and color
    // adapters are covered structurally (no `new`, no array literal outside
    // `clone`) and the color case is asserted below.
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 2, 3);
    const out = new Vector3();
    const qa = new Quaternion();
    const qb = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1);
    const qOut = new Quaternion();
    const ca: ColorRGBA = [0, 0, 0, 1];
    const cb: ColorRGBA = [1, 1, 1, 0];
    const cOut: ColorRGBA = [0, 0, 0, 0];
    let accumulator = 0;

    resetConstructionCount();
    for (let index = 0; index < 1000; index += 1) {
      const t = index / 1000;
      vector3Adapter.lerp(a, b, t, out);
      vector3Adapter.copy(b, out);
      quaternionAdapter.lerp(qa, qb, t, qOut);
      quaternionAdapter.copy(qb, qOut);
      colorAdapter.lerp(ca, cb, t, cOut);
      vector3Adapter.add(a, b, t, out);
      quaternionAdapter.add(qa, qb, t, qOut);
      colorAdapter.add(ca, cb, t, cOut);
      accumulator +=
        numberAdapter.add(0, 1, t, 0) +
        numberAdapter.lerp(0, 1, t, 0) +
        out.x +
        qOut.w +
        cOut[0];
    }

    expect(constructionCount()).toBe(0);
    expect(Number.isFinite(accumulator)).toBe(true);
  });

  it("allocates exactly once per clone, and only there", () => {
    const source = new Vector3(1, 2, 3);
    resetConstructionCount();
    const copy = vector3Adapter.clone(source);
    expect(constructionCount()).toBe(1);
    expect(copy).not.toBe(source);

    const colorSource: ColorRGBA = [1, 1, 1, 1];
    expect(colorAdapter.clone(colorSource)).not.toBe(colorSource);
  });
});
