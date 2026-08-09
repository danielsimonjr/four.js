import { Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  DirectionalLight,
  Group,
  PointLight,
  PunctualLight,
  Scene,
  SpotLight,
} from "../src/index.js";

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

describe("PointLight (§68, R-17)", () => {
  it("defaults to white, intensity 1, unbounded range", () => {
    const light = new PointLight();

    expect(light.color).toEqual([1, 1, 1]);
    expect(light.intensity).toBe(1);
    // `0` is "no cut-off", which is the honest default — see the class header.
    expect(light.range).toBe(0);
    expect(light.lightType).toBe("point");
  });

  it("carries the structural brand @four/render recognises", () => {
    expect(new PointLight().isPunctualLight).toBe(true);
  });

  it("is an ordinary scene node", () => {
    const scene = new Scene();
    const light = new PointLight();
    scene.add(light);

    expect(light.parent).toBe(scene);
    expect(scene.findByType(PointLight)).toBe(light);
    expect(light).toBeInstanceOf(PunctualLight);
  });

  it("copies the supplied color instead of holding the caller's array", () => {
    const source: [number, number, number] = [0.25, 0.5, 0.75];
    const light = new PointLight({ color: source, intensity: 4, range: 12 });

    expect(light.color).toEqual(source);
    expect(light.color).not.toBe(source);
    expect(light.intensity).toBe(4);
    expect(light.range).toBe(12);

    source[0] = 1;
    expect(light.color[0]).toBe(0.25);
  });

  it("rejects non-finite parameters (§85)", () => {
    expect(() => new PointLight({ color: [Number.NaN, 0, 0] })).toThrow(
      RangeError,
    );
    expect(
      () => new PointLight({ color: [0, Number.POSITIVE_INFINITY, 0] }),
    ).toThrow(/must be finite/);
    expect(() => new PointLight({ color: [0, 0, Number.NaN] })).toThrow(
      RangeError,
    );
    expect(() => new PointLight({ intensity: Number.NaN })).toThrow(RangeError);
    expect(() => new PointLight({ range: Number.POSITIVE_INFINITY })).toThrow(
      /must be finite/,
    );
  });

  it("rejects a negative range, and only the range (§85)", () => {
    expect(() => new PointLight({ range: -1 })).toThrow(/must not be negative/);
    // Negative intensity and colour components pass through un-clamped, the
    // no-silent-rewrites rule every authored colour in this engine follows.
    expect(new PointLight({ intensity: -2 }).intensity).toBe(-2);
    expect(new PointLight({ color: [-1, 0, 0] }).color[0]).toBe(-1);
  });

  describe("getWorldPosition", () => {
    it("reads the node's own translation", () => {
      const light = new PointLight();
      light.transform.position.set(1, 2, 3);
      const out = new Vector3();

      expect(light.getWorldPosition(out)).toBe(out);
      expect([out.x, out.y, out.z]).toEqual([1, 2, 3]);
    });

    it("composes through ancestors and resolves on demand", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new PointLight();
      scene.add(rig);
      rig.add(light);

      rig.transform.position.set(0, 5, 0);
      rig.transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);
      light.transform.position.set(2, 0, 0);

      // No frame-wide resolve pass has run; the light resolves its own chain.
      const out = light.getWorldPosition(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(5, 12);
      expect(out.z).toBeCloseTo(-2, 12);
    });

    it("still has a position under a zero-scale ancestor", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new PointLight();
      scene.add(rig);
      rig.add(light);
      rig.transform.position.set(3, 0, 0);
      rig.transform.scale.set(0, 0, 0);

      const out = light.getWorldPosition(new Vector3());
      expect([out.x, out.y, out.z]).toEqual([3, 0, 0]);
    });
  });
});

describe("SpotLight (§68, R-17)", () => {
  it("defaults to glTF's cone: inner 0, outer π/4", () => {
    const light = new SpotLight();

    expect(light.lightType).toBe("spot");
    expect(light.innerConeAngle).toBe(0);
    expect(light.outerConeAngle).toBe(Math.PI / 4);
    expect(light.range).toBe(0);
  });

  it("is a PunctualLight with the point light's whole surface", () => {
    const light = new SpotLight({
      color: [1, 0.5, 0],
      intensity: 8,
      range: 20,
      innerConeAngle: Math.PI / 8,
      outerConeAngle: Math.PI / 6,
    });

    expect(light).toBeInstanceOf(PunctualLight);
    expect(light.isPunctualLight).toBe(true);
    expect(light.color).toEqual([1, 0.5, 0]);
    expect(light.intensity).toBe(8);
    expect(light.range).toBe(20);
    expect(light.getWorldPosition(new Vector3()).x).toBe(0);
  });

  it("rejects non-finite cone angles (§85)", () => {
    expect(() => new SpotLight({ innerConeAngle: Number.NaN })).toThrow(
      /must be finite/,
    );
    expect(
      () => new SpotLight({ outerConeAngle: Number.POSITIVE_INFINITY }),
    ).toThrow(/must be finite/);
  });

  it("accepts an inverted cone rather than rewriting it", () => {
    // `inner >= outer` is a hard-edged cone, not an error — the renderer's
    // `max(cos inner − cos outer, 1e-6)` is what keeps it finite.
    const light = new SpotLight({
      innerConeAngle: Math.PI / 2,
      outerConeAngle: Math.PI / 8,
    });

    expect(light.innerConeAngle).toBe(Math.PI / 2);
    expect(light.outerConeAngle).toBe(Math.PI / 8);
  });

  describe("getWorldDirection", () => {
    it("aims along -Z when unrotated, exactly as a directional light does", () => {
      const out = new SpotLight().getWorldDirection(new Vector3());

      expect([out.x, out.y, out.z]).toEqual([-0, -0, -1]);
    });

    it("follows the node's rotation — -π/2 about X aims down -Y", () => {
      const light = new SpotLight();
      light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);

      const out = light.getWorldDirection(new Vector3());
      expect(out.x).toBeCloseTo(0, 12);
      expect(out.y).toBeCloseTo(-1, 12);
      expect(out.z).toBeCloseTo(0, 12);
    });

    it("yields the zero vector for a degenerate (zero-scale) chain", () => {
      const scene = new Scene();
      const rig = new Group();
      const light = new SpotLight();
      scene.add(rig);
      rig.add(light);
      rig.transform.scale.set(0, 0, 0);

      const out = light.getWorldDirection(new Vector3());
      expect([out.x, out.y, out.z]).toEqual([-0, -0, -0]);
    });
  });
});
