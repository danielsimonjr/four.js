import { describe, expect, it } from "vitest";

import { Quaternion, Vector2, Vector3, Vector4 } from "@four/math";

import { createBinding } from "../src/binding.js";
import {
  colorAdapter,
  quaternionAdapter,
  vector2Adapter,
  vector3Adapter,
  vector4Adapter,
  type ColorRGBA,
  type ValueAdapter,
} from "../src/values.js";

/**
 * WP-4.2-fix1: uniform clone/copy/lerp exercise of every in-place adapter.
 * The per-type tests cover lerp semantics; this table closes the coverage
 * gap on the clone/copy members the tooling-enforced gate flagged.
 */
interface SurfaceCase<T> {
  readonly name: string;
  readonly adapter: ValueAdapter<T>;
  readonly a: () => T;
  readonly b: () => T;
  readonly blank: () => T;
  readonly equals: (actual: T, expected: T) => void;
}

/** Erases the per-case value type so heterogeneous cases share one array. */
function erased<T>(surfaceCase: SurfaceCase<T>): SurfaceCase<unknown> {
  return surfaceCase as unknown as SurfaceCase<unknown>;
}

const surfaceCases: ReadonlyArray<SurfaceCase<unknown>> = [
  erased({
    name: "vector2",
    adapter: vector2Adapter,
    a: () => new Vector2(1, 2),
    b: () => new Vector2(3, 6),
    blank: () => new Vector2(0, 0),
    equals: (actual: Vector2, expected: Vector2) => {
      expect(actual.x).toBe(expected.x);
      expect(actual.y).toBe(expected.y);
    },
  }),
  erased({
    name: "vector3",
    adapter: vector3Adapter,
    a: () => new Vector3(1, 2, 3),
    b: () => new Vector3(3, 6, 9),
    blank: () => new Vector3(0, 0, 0),
    equals: (actual: Vector3, expected: Vector3) => {
      expect(actual.x).toBe(expected.x);
      expect(actual.y).toBe(expected.y);
      expect(actual.z).toBe(expected.z);
    },
  }),
  erased({
    name: "vector4",
    adapter: vector4Adapter,
    a: () => new Vector4(1, 2, 3, 4),
    b: () => new Vector4(3, 6, 9, 12),
    blank: () => new Vector4(0, 0, 0, 0),
    equals: (actual: Vector4, expected: Vector4) => {
      expect(actual.x).toBe(expected.x);
      expect(actual.y).toBe(expected.y);
      expect(actual.z).toBe(expected.z);
      expect(actual.w).toBe(expected.w);
    },
  }),
  erased({
    name: "quaternion",
    adapter: quaternionAdapter,
    a: () => new Quaternion(0, 0, 0, 1),
    b: () => new Quaternion(0, 0, 1, 0),
    blank: () => new Quaternion(0, 0, 0, 1),
    equals: (actual: Quaternion, expected: Quaternion) => {
      expect(actual.x).toBeCloseTo(expected.x, 12);
      expect(actual.y).toBeCloseTo(expected.y, 12);
      expect(actual.z).toBeCloseTo(expected.z, 12);
      expect(actual.w).toBeCloseTo(expected.w, 12);
    },
  }),
  erased({
    name: "color",
    adapter: colorAdapter,
    a: () => [0, 0.25, 0.5, 1] as ColorRGBA,
    b: () => [1, 0.75, 0.5, 0] as ColorRGBA,
    blank: () => [0, 0, 0, 0] as ColorRGBA,
    equals: (actual: ColorRGBA, expected: ColorRGBA) => {
      expect(actual).toEqual(expected);
    },
  }),
];

describe("adapter surface (clone/copy/lerp on every in-place kind)", () => {
  for (const surface of surfaceCases) {
    it(`${surface.name}: clone is a distinct equal value`, () => {
      const original = surface.a();
      const cloned = surface.adapter.clone(original);
      expect(cloned).not.toBe(original);
      surface.equals(cloned, original);
    });

    it(`${surface.name}: copy writes source into target in place`, () => {
      const source = surface.b();
      const target = surface.blank();
      const returned = surface.adapter.copy(source, target);
      expect(returned).toBe(target);
      surface.equals(target, source);
    });

    it(`${surface.name}: lerp at endpoints reproduces a and b`, () => {
      const out = surface.blank();
      surface.adapter.lerp(surface.a(), surface.b(), 0, out);
      surface.equals(out, surface.a());
      surface.adapter.lerp(surface.a(), surface.b(), 1, out);
      surface.equals(out, surface.b());
    });
  }
});

describe("binding error descriptions", () => {
  it("describes a prototype-less object without a constructor name", () => {
    const bare: object = Object.create(null) as object;
    const target = { holder: bare };
    expect(() => createBinding(target, "holder")).toThrowError(/an object/);
  });

  it("describes a non-detectable class instance by its constructor name", () => {
    const target = { holder: new Map<string, number>() };
    expect(() => createBinding(target, "holder")).toThrowError(
      /an instance of Map/,
    );
  });

  it("describes a non-detectable primitive by its typeof", () => {
    const target = { flag: Symbol("nope") };
    expect(() => createBinding(target, "flag")).toThrowError(/a symbol/);
  });
});
