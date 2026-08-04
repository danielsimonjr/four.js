import { Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import { DirectionalLight, Group, Scene } from "../src/index.js";

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const HALF_PI = Math.PI / 2;

describe("DirectionalLight (§68)", () => {
  it("defaults to white at intensity 1", () => {
    const light = new DirectionalLight();

    expect(light.color).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(1);
  });

  it("carries the structural brand @four/render recognises", () => {
    expect(new DirectionalLight().isDirectionalLight).toBe(true);
  });

  it("is an ordinary scene node", () => {
    const scene = new Scene();
    const light = new DirectionalLight();
    scene.add(light);

    expect(light.parent).toBe(scene);
    // §46 lookups see it like any node.
    expect(scene.findByType(DirectionalLight)).toBe(light);
  });

  it("copies the supplied color instead of holding the caller's array", () => {
    const source: [number, number, number] = [0.25, 0.5, 0.75];
    const light = new DirectionalLight({ color: source, intensity: 3 });

    expect(light.color).toEqual(source);
    expect(light.color).not.toBe(source);
    expect(light.intensity).toBe(3);

    source[0] = 1;
    expect(light.color[0]).toBe(0.25);
  });

  it("rejects non-finite parameters (§85)", () => {
    expect(() => new DirectionalLight({ color: [Number.NaN, 0, 0] })).toThrow(
      RangeError,
    );
    expect(
      () => new DirectionalLight({ color: [0, Number.POSITIVE_INFINITY, 0] }),
    ).toThrow(/must be finite/);
    expect(() => new DirectionalLight({ intensity: Number.NaN })).toThrow(
      RangeError,
    );
  });

  describe("getWorldDirection", () => {
    it("shines along -Z when unrotated", () => {
      const light = new DirectionalLight();
      const out = new Vector3();

      expect(light.getWorldDirection(out)).toBe(out);
      // Negated zeroes: the method negates the matrix's +Z column.
      expect([out.x, out.y, out.z]).toEqual([-0, -0, -1]);
    });

    it("follows the node's rotation — -π/2 about X shines down -Y", () => {
      const light = new DirectionalLight();
      light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);

      const out = light.getWorldDirection(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(-1, 12);
      expect(out.z).toBeCloseTo(0, 12);
    });

    it("composes through ancestors and resolves on demand", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new DirectionalLight();
      scene.add(rig);
      rig.add(light);

      // Two quarter-turns about Y compose to a half-turn: -Z becomes +Z.
      rig.transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);
      light.transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);

      // No resolveWorldTransforms pass has run — the method resolves its own
      // ancestor chain, the Camera.updateViewMatrix guarantee.
      const out = light.getWorldDirection(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(0, 12);
      expect(out.z).toBeCloseTo(1, 12);
    });

    it("stays unit length under ancestor scale", () => {
      const rig = new Group();
      const light = new DirectionalLight();
      rig.add(light);
      rig.transform.scale.set(10, 10, 10);

      const out = light.getWorldDirection(new Vector3());
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 12);
    });

    it("yields the zero vector for a degenerate (zero-scale) chain", () => {
      const rig = new Group();
      const light = new DirectionalLight();
      rig.add(light);
      rig.transform.scale.set(0, 0, 0);

      const out = light.getWorldDirection(new Vector3(9, 9, 9));
      expect([out.x, out.y, out.z]).toEqual([-0, -0, -0]);
    });
  });
});

describe("Scene.ambientLight (§68)", () => {
  it("defaults to black — an unconfigured scene adds no light", () => {
    expect(new Scene().ambientLight).toEqual([0, 0, 0]);
  });

  it("is written into, never replaced", () => {
    const scene = new Scene();
    const ambient = scene.ambientLight;

    scene.ambientLight[0] = 0.2;
    scene.ambientLight[1] = 0.3;
    scene.ambientLight[2] = 0.4;

    expect(scene.ambientLight).toBe(ambient);
    expect(scene.ambientLight).toEqual([0.2, 0.3, 0.4]);
  });
});
