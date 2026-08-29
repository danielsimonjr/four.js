import { isFourError } from "@four/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { Group } from "@four/scene";
import { describe, expect, it } from "vitest";

import { createArrayElementBinding, createBinding } from "../src/binding.js";
import {
  colorAdapter,
  discreteAdapterFor,
  numberAdapter,
  quaternionAdapter,
  vector3Adapter,
  type ColorRGBA,
} from "../src/values.js";

/** Asserts that `run` throws a FourError carrying `code`, and returns it. */
function expectFourError(run: () => unknown, code: string): Error {
  let caught: unknown;
  try {
    run();
  } catch (error: unknown) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as { code: string } & Error;
  expect(error.code).toBe(code);
  return error;
}

describe("createBinding — resolution", () => {
  it("binds a single-segment path on the target itself", () => {
    const target = { opacity: 0.25 };
    const binding = createBinding(target, "opacity");

    expect(binding.target).toBe(target);
    expect(binding.owner).toBe(target);
    expect(binding.key).toBe("opacity");
    expect(binding.path).toBe("opacity");
    expect(binding.adapter).toBe(numberAdapter);
    expect(binding.get()).toBe(0.25);
  });

  it("walks a nested path to the owning object", () => {
    const node = new Group();
    const binding = createBinding(node, "transform.position");

    expect(binding.owner).toBe(node.transform);
    expect(binding.key).toBe("position");
    expect(binding.adapter).toBe(vector3Adapter);
    expect(binding.get()).toBe(node.transform.position);
  });

  it("binds a rotation quaternion on a real scene node", () => {
    const node = new Group();
    const binding = createBinding(node, "transform.rotation");
    expect(binding.adapter).toBe(quaternionAdapter);
  });

  it("binds through inherited accessors", () => {
    class Fader {
      #opacity = 1;
      get opacity(): number {
        return this.#opacity;
      }
      set opacity(value: number) {
        this.#opacity = value;
      }
    }
    const fader = new Fader();
    const binding = createBinding(fader, "opacity");

    binding.set(0.5);
    expect(fader.opacity).toBe(0.5);
  });

  it("resolves the path exactly once, at creation", () => {
    const original = { value: 1 };
    const target: { inner: { value: number } } = { inner: original };
    const binding = createBinding(target, "inner.value");

    // Swapping the intermediate object after creation must not redirect the
    // binding: §16 resolves string paths once, so it keeps writing the owner it
    // resolved.
    const replacement = { value: 100 };
    target.inner = replacement;
    binding.set(42);

    expect(original.value).toBe(42);
    expect(replacement.value).toBe(100);
    expect(binding.owner).toBe(original);
    expect(binding.get()).toBe(42);
  });
});

describe("createBinding — errors", () => {
  it("rejects an empty path", () => {
    expectFourError(() => createBinding({}, ""), "INVALID_APPLICATION_STATE");
  });

  it("rejects an empty segment", () => {
    expectFourError(
      () => createBinding({ a: { b: 1 } }, "a..b"),
      "INVALID_APPLICATION_STATE",
    );
    expectFourError(
      () => createBinding({ a: { b: 1 } }, "a."),
      "INVALID_APPLICATION_STATE",
    );
  });

  it("rejects a missing intermediate segment", () => {
    const error = expectFourError(
      () => createBinding(new Group(), "physics.body.position"),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("physics");
  });

  it("rejects an intermediate segment that is not an object", () => {
    expectFourError(
      () => createBinding({ count: 3 }, "count.x"),
      "INVALID_APPLICATION_STATE",
    );
    expectFourError(
      () => createBinding({ nothing: null }, "nothing.x"),
      "INVALID_APPLICATION_STATE",
    );
  });

  it("rejects a missing final property", () => {
    const error = expectFourError(
      () => createBinding(new Group(), "transform.opacity"),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("opacity");
  });

  it("rejects a value whose type has no adapter", () => {
    const error = expectFourError(
      () => createBinding({ label: "hello" }, "label"),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("Pass one explicitly");
  });

  it("accepts an undetectable value when an adapter is supplied", () => {
    const target: { state: string | null } = { state: null };
    const binding = createBinding(
      target,
      "state",
      discreteAdapterFor<string>(),
    );

    expect(binding.adapter.kind).toBe("discrete");
    binding.set("running");
    expect(target.state).toBe("running");
  });

  it("prefers the supplied adapter over detection", () => {
    const target = { uvRect: [0, 0, 1, 1] };
    const detected = createBinding(target, "uvRect");
    expect(detected.adapter).toBe(colorAdapter);

    const explicit = createBinding(
      target,
      "uvRect",
      discreteAdapterFor<number[]>(),
    );
    expect(explicit.adapter.kind).toBe("discrete");
  });
});

describe("createBinding — writes", () => {
  it("writes reference values in place, preserving identity", () => {
    const node = new Group();
    const binding = createBinding(node, "transform.position");
    const before = node.transform.position;

    binding.set(new Vector3(1, 2, 3));

    expect(node.transform.position).toBe(before);
    expect(before.equalsApprox(new Vector3(1, 2, 3))).toBe(true);
  });

  it("keeps the transform's change hook alive (the reason for in-place writes)", () => {
    const node = new Group();
    const binding = createBinding(node, "transform.position");
    const versionBefore = node.transform.version;

    binding.set(new Vector3(5, 0, 0));

    // Writing through `Vector3.copy` fires the hook Transform installed, so the
    // transform notices. Replacing the vector would have frozen `version`.
    expect(node.transform.version).toBeGreaterThan(versionBefore);
  });

  it("writes a quaternion in place", () => {
    const node = new Group();
    const binding = createBinding(node, "transform.rotation");
    const before = node.transform.rotation;

    binding.set(
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI),
    );

    expect(node.transform.rotation).toBe(before);
    expect(before.y).toBeCloseTo(1, 12);
  });

  it("writes a color tuple in place", () => {
    const material: { color: ColorRGBA } = { color: [1, 1, 1, 1] };
    const binding = createBinding(material, "color");
    const before = material.color;

    expect(binding.adapter).toBe(colorAdapter);
    binding.set([0.25, 0.5, 0.75, 0.5] satisfies ColorRGBA);

    expect(material.color).toBe(before);
    expect(before).toEqual([0.25, 0.5, 0.75, 0.5]);
  });

  it("assigns primitive values", () => {
    const target = { opacity: 1, visible: true };
    const opacity = createBinding(target, "opacity");
    const visible = createBinding(target, "visible");

    opacity.set(0.125);
    visible.set(false);

    expect(target.opacity).toBe(0.125);
    expect(target.visible).toBe(false);
  });
});

describe("createBinding — allocation discipline (§7b)", () => {
  it("allocates no math objects in a steady-state get/set/lerp loop", () => {
    const node = new Group();
    const binding = createBinding(node, "transform.position");
    const start = new Vector3(0, 0, 0);
    const end = new Vector3(10, 0, 0);
    const scratch = new Vector3();
    const adapter = binding.adapter;
    let accumulator = 0;

    resetConstructionCount();
    for (let index = 0; index < 1000; index += 1) {
      const t = index / 1000;
      adapter.lerp(start, end, t, scratch);
      binding.set(scratch);
      accumulator += (binding.get() as Vector3).x;
    }

    expect(constructionCount()).toBe(0);
    expect(accumulator).toBeGreaterThan(0);
    expect(node.transform.position.x).toBeCloseTo(9.99, 9);
  });
});

describe("indexed-array targets — §17's binding form (RFC 0003 §2)", () => {
  it("addresses an element of a typed array through a numeric segment", () => {
    const target = { weights: new Float32Array([0.1, 0.2, 0.3]) };
    const binding = createBinding(target, "weights.1");

    expect(binding.adapter.kind).toBe("number");
    expect(binding.get()).toBeCloseTo(0.2, 6);
    binding.set(0.9);
    expect(target.weights[1]).toBeCloseTo(0.9, 6);
    // The neighbours are untouched — the binding is one element, not the array.
    expect(target.weights[0]).toBeCloseTo(0.1, 6);
  });

  it("refuses an out-of-range index loudly, at creation (§16, §85)", () => {
    const target = { weights: new Float32Array(2) };
    expect(() => createBinding(target, "weights.5")).toThrowError(
      /does not exist/,
    );
  });

  it("reaches a skeletal-joint channel through an array of bones (§33)", () => {
    // The Skeleton shape, reduced: `bones` is an array, so `bones.0` resolves
    // by index and the rest of the path is ordinary property walking. The
    // joint index in the path is stable because insertion order is the ABI.
    const bone = { transform: { rotation: { value: 0 } } };
    const skeleton = { bones: [bone] };
    const binding = createBinding(skeleton, "bones.0.transform.rotation.value");
    binding.set(1.25);
    expect(bone.transform.rotation.value).toBe(1.25);
  });

  it("createArrayElementBinding is the explicit spelling of the same form", () => {
    const target = { weights: new Float32Array([0, 0]) };
    const binding = createArrayElementBinding(target, "weights", 0);
    expect(binding.path).toBe("weights.0");
    expect(binding.adapter.kind).toBe("number");
    binding.set(0.5);
    expect(target.weights[0]).toBe(0.5);

    // Plain numeric arrays bind the same way.
    const plain = { values: [1, 2, 3] };
    const second = createArrayElementBinding(plain, "values", 2);
    second.set(9);
    expect(plain.values[2]).toBe(9);
  });

  it("refuses a negative, fractional, or out-of-range explicit index", () => {
    const target = { weights: new Float32Array(2) };
    expect(() => createArrayElementBinding(target, "weights", -1)).toThrowError(
      /non-negative integer/,
    );
    expect(() =>
      createArrayElementBinding(target, "weights", 0.5),
    ).toThrowError(/non-negative integer/);
    expect(() => createArrayElementBinding(target, "weights", 2)).toThrowError(
      /does not exist/,
    );
  });
});
