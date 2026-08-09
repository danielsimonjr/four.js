import { Vector3 } from "@four/math";
import {
  DirectionalLight,
  Group,
  PointLight,
  Scene,
  SpotLight,
} from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_PUNCTUAL_LIGHTS,
  collectSceneLights,
  createSceneLights,
  isDirectionalLightSource,
  isPunctualLightSource,
  type AmbientLightSource,
  type DirectionalLightSource,
  type PointLightSource,
  type SceneLights,
  type SpotLightSource,
} from "../src/index.js";

const AXIS_X = new Vector3(1, 0, 0);
const HALF_PI = Math.PI / 2;

/**
 * The type-level pinning the module header promises: the real scene classes
 * satisfy the structural contracts by plain assignment, so a drifting member
 * fails *this package's build*, not just a test at runtime. (The particle
 * contract cannot have this — no dependency edge — which is exactly why the
 * lights module documents the difference.)
 */
function typePins(): [
  DirectionalLightSource,
  AmbientLightSource,
  PointLightSource,
  SpotLightSource,
] {
  const light: DirectionalLightSource = new DirectionalLight();
  const ambient: AmbientLightSource = new Scene();
  const point: PointLightSource = new PointLight();
  const spot: SpotLightSource = new SpotLight();
  return [light, ambient, point, spot];
}

/** The three live entries of `punctualPositions` and friends, as a tuple. */
function slice3(data: Float32Array, index: number): number[] {
  return [data[index * 3], data[index * 3 + 1], data[index * 3 + 2]];
}

/** The four packed params of one light. */
function slice4(data: Float32Array, index: number): number[] {
  return [
    data[index * 4],
    data[index * 4 + 1],
    data[index * 4 + 2],
    data[index * 4 + 3],
  ];
}

describe("isDirectionalLightSource", () => {
  it("accepts the real DirectionalLight", () => {
    const [light] = typePins();
    expect(isDirectionalLightSource(light)).toBe(true);
  });

  it("requires the brand and the direction method together", () => {
    expect(isDirectionalLightSource(null)).toBe(false);
    expect(isDirectionalLightSource(7)).toBe(false);
    expect(isDirectionalLightSource({})).toBe(false);
    // The brand alone is not enough — a node that claims it without the
    // shape must not reach the shader as a light.
    expect(isDirectionalLightSource({ isDirectionalLight: true })).toBe(false);
    expect(
      isDirectionalLightSource({
        isDirectionalLight: true,
        color: [1, 1, 1],
        intensity: 1,
        getWorldDirection: (out: Vector3) => out,
      }),
    ).toBe(true);
  });
});

describe("createSceneLights", () => {
  it("starts in the documented no-light state", () => {
    const lights = createSceneLights();

    expect(lights.ambientColor).toEqual([0, 0, 0]);
    expect(lights.hasDirectionalLight).toBe(false);
    expect([
      lights.direction.x,
      lights.direction.y,
      lights.direction.z,
    ]).toEqual([0, 0, -1]);
    expect(lights.directionalColor).toEqual([0, 0, 0]);
    expect(lights.punctualCount).toBe(0);
    expect(lights.punctualPositions).toHaveLength(MAX_PUNCTUAL_LIGHTS * 3);
    expect(lights.punctualColors).toHaveLength(MAX_PUNCTUAL_LIGHTS * 3);
    expect(lights.punctualDirections).toHaveLength(MAX_PUNCTUAL_LIGHTS * 3);
    expect(lights.punctualParams).toHaveLength(MAX_PUNCTUAL_LIGHTS * 4);
    expect([...lights.punctualParams]).toEqual(
      new Array<number>(MAX_PUNCTUAL_LIGHTS * 4).fill(0),
    );
  });
});

describe("collectSceneLights (§68)", () => {
  it("reads the scene ambient term off the root", () => {
    const scene = new Scene();
    scene.ambientLight[0] = 0.1;
    scene.ambientLight[1] = 0.2;
    scene.ambientLight[2] = 0.3;

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.ambientColor).toEqual([0.1, 0.2, 0.3]);
    expect(lights.hasDirectionalLight).toBe(false);
    expect(lights.directionalColor).toEqual([0, 0, 0]);
  });

  it("collects the light's world direction and intensity-scaled color", () => {
    const scene = new Scene();
    const light = new DirectionalLight({
      color: [1, 0.5, 0.25],
      intensity: 2,
    });
    // Shine down -Y: -π/2 about X (§7a).
    light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);
    scene.add(light);

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.hasDirectionalLight).toBe(true);
    expect(lights.direction.x).toBeCloseTo(0, 12);
    expect(lights.direction.y).toBeCloseTo(-1, 12);
    expect(lights.direction.z).toBeCloseTo(0, 12);
    expect(lights.directionalColor).toEqual([2, 1, 0.5]);
  });

  it("takes the first light in scene-graph order and ignores the rest (MVP tier)", () => {
    const scene = new Scene();
    const group = new Group();
    const first = new DirectionalLight({ color: [1, 0, 0] });
    const second = new DirectionalLight({ color: [0, 1, 0] });
    scene.add(group);
    group.add(first);
    scene.add(second);

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.directionalColor).toEqual([1, 0, 0]);
  });

  it("prunes invisible and disabled subtrees exactly as the render list does", () => {
    const scene = new Scene();
    const hidden = new Group();
    const shadowed = new DirectionalLight({ color: [1, 0, 0] });
    hidden.visible = false;
    hidden.add(shadowed);
    scene.add(hidden);

    const disabled = new DirectionalLight({ color: [0, 1, 0] });
    disabled.enabled = false;
    scene.add(disabled);

    const reachable = new DirectionalLight({ color: [0, 0, 1] });
    scene.add(reachable);

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.directionalColor).toEqual([0, 0, 1]);
  });

  it("yields the full no-light state for a hidden root", () => {
    const scene = new Scene();
    scene.ambientLight[0] = 0.5;
    scene.add(new DirectionalLight());
    scene.visible = false;

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.ambientColor).toEqual([0, 0, 0]);
    expect(lights.hasDirectionalLight).toBe(false);
  });

  it("has no ambient term for a root that is not a Scene", () => {
    const group = new Group();
    group.add(new DirectionalLight({ color: [1, 1, 1], intensity: 0.5 }));

    const lights = collectSceneLights(group, createSceneLights());
    expect(lights.ambientColor).toEqual([0, 0, 0]);
    expect(lights.hasDirectionalLight).toBe(true);
    expect(lights.directionalColor).toEqual([0.5, 0.5, 0.5]);
  });

  it("rewrites the record in place and resets stale state between frames", () => {
    const out: SceneLights = createSceneLights();

    const litScene = new Scene();
    litScene.ambientLight[1] = 0.4;
    const light = new DirectionalLight({ color: [1, 1, 0], intensity: 2 });
    light.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);
    litScene.add(light);
    expect(collectSceneLights(litScene, out)).toBe(out);
    expect(out.hasDirectionalLight).toBe(true);

    // The next frame draws an unlit scene into the same record: every field
    // returns to the documented no-light state, including the direction.
    collectSceneLights(new Scene(), out);
    expect(out.ambientColor).toEqual([0, 0, 0]);
    expect(out.hasDirectionalLight).toBe(false);
    expect([out.direction.x, out.direction.y, out.direction.z]).toEqual([
      0, 0, -1,
    ]);
    expect(out.directionalColor).toEqual([0, 0, 0]);
  });
});

describe("isPunctualLightSource (R-17)", () => {
  it("accepts the real PointLight and SpotLight", () => {
    const [, , point, spot] = typePins();
    expect(isPunctualLightSource(point)).toBe(true);
    expect(isPunctualLightSource(spot)).toBe(true);
  });

  it("requires the brand and the position method together", () => {
    expect(isPunctualLightSource(null)).toBe(false);
    expect(isPunctualLightSource(7)).toBe(false);
    expect(isPunctualLightSource({})).toBe(false);
    expect(isPunctualLightSource({ isPunctualLight: true })).toBe(false);
    expect(
      isPunctualLightSource({
        isPunctualLight: true,
        lightType: "point",
        color: [1, 1, 1],
        intensity: 1,
        range: 0,
        getWorldPosition: (out: Vector3) => out,
      }),
    ).toBe(true);
  });

  it("does not mistake a directional light for a punctual one, or vice versa", () => {
    expect(isPunctualLightSource(new DirectionalLight())).toBe(false);
    expect(isDirectionalLightSource(new PointLight())).toBe(false);
    // A spot light has `getWorldDirection`, which is exactly the shape that
    // could be confused — the brand is what keeps them apart.
    expect(isDirectionalLightSource(new SpotLight())).toBe(false);
  });
});

describe("collectSceneLights — the light set (§68, R-17)", () => {
  it("packs a point light: position, premultiplied colour, range, no cone", () => {
    const scene = new Scene();
    const lamp = new PointLight({
      color: [1, 0.5, 0.25],
      intensity: 4,
      range: 12,
    });
    lamp.transform.position.set(2, 3, -4);
    scene.add(lamp);

    const lights = collectSceneLights(scene, createSceneLights());

    expect(lights.punctualCount).toBe(1);
    expect(slice3(lights.punctualPositions, 0)).toEqual([2, 3, -4]);
    expect(slice3(lights.punctualColors, 0)).toEqual([4, 2, 1]);
    // A point light has no axis, and `w = 0` is what the shader reads as
    // "no cone" — both stay at the cleared zero.
    expect(slice3(lights.punctualDirections, 0)).toEqual([0, 0, 0]);
    expect(slice4(lights.punctualParams, 0)).toEqual([12, 0, 0, 0]);
  });

  it("packs a spot light: the axis, cos(outer), the ramp reciprocal, and w = 1", () => {
    const scene = new Scene();
    const spot = new SpotLight({
      intensity: 2,
      innerConeAngle: Math.PI / 8,
      outerConeAngle: Math.PI / 6,
    });
    spot.transform.rotation.setFromAxisAngle(AXIS_X, -HALF_PI);
    scene.add(spot);

    const lights = collectSceneLights(scene, createSceneLights());

    expect(lights.punctualCount).toBe(1);
    const axis = slice3(lights.punctualDirections, 0);
    expect(axis[0]).toBeCloseTo(0, 6);
    expect(axis[1]).toBeCloseTo(-1, 6);
    expect(axis[2]).toBeCloseTo(0, 6);

    const cosOuter = Math.cos(Math.PI / 6);
    const cosInner = Math.cos(Math.PI / 8);
    const params = slice4(lights.punctualParams, 0);
    expect(params[0]).toBe(0);
    expect(params[1]).toBeCloseTo(cosOuter, 6);
    expect(params[2]).toBeCloseTo(1 / (cosInner - cosOuter), 3);
    expect(params[3]).toBe(1);
  });

  it("turns an inverted cone into a hard edge, never a division by zero", () => {
    const scene = new Scene();
    scene.add(
      new SpotLight({ innerConeAngle: HALF_PI, outerConeAngle: Math.PI / 8 }),
    );

    const lights = collectSceneLights(scene, createSceneLights());
    const params = slice4(lights.punctualParams, 0);

    // `cos inner − cos outer` is negative here; the 1e-6 floor makes the ramp
    // a very steep positive slope, i.e. a step, and a finite number.
    expect(params[2]).toBe(1e6);
    expect(Number.isFinite(params[2])).toBe(true);
  });

  it("collects point and spot lights together, in scene-graph order", () => {
    const scene = new Scene();
    const group = new Group();
    scene.add(group);
    const first = new PointLight({ color: [1, 0, 0] });
    const second = new SpotLight({ color: [0, 1, 0] });
    const third = new PointLight({ color: [0, 0, 1] });
    group.add(first);
    group.add(second);
    scene.add(third);

    const lights = collectSceneLights(scene, createSceneLights());

    expect(lights.punctualCount).toBe(3);
    expect(slice3(lights.punctualColors, 0)).toEqual([1, 0, 0]);
    expect(slice3(lights.punctualColors, 1)).toEqual([0, 1, 0]);
    expect(slice3(lights.punctualColors, 2)).toEqual([0, 0, 1]);
    // Only the spot carries a cone.
    expect(slice4(lights.punctualParams, 1)[3]).toBe(1);
    expect(slice4(lights.punctualParams, 0)[3]).toBe(0);
    expect(slice4(lights.punctualParams, 2)[3]).toBe(0);
  });

  it("collects the sun and the set in one walk", () => {
    const scene = new Scene();
    scene.ambientLight[0] = 0.05;
    const sun = new DirectionalLight({ color: [1, 1, 1], intensity: 3 });
    scene.add(sun);
    scene.add(new PointLight({ color: [0, 1, 0], intensity: 2 }));

    const lights = collectSceneLights(scene, createSceneLights());

    expect(lights.ambientColor).toEqual([0.05, 0, 0]);
    expect(lights.hasDirectionalLight).toBe(true);
    expect(lights.directionalColor).toEqual([3, 3, 3]);
    expect(lights.punctualCount).toBe(1);
    expect(slice3(lights.punctualColors, 0)).toEqual([0, 2, 0]);
  });

  it("resolves world positions through ancestors, on demand", () => {
    const scene = new Scene();
    const rig = new Group();
    const lamp = new PointLight();
    scene.add(rig);
    rig.add(lamp);
    rig.transform.position.set(0, 10, 0);
    lamp.transform.position.set(1, 0, 0);

    const lights = collectSceneLights(scene, createSceneLights());
    expect(slice3(lights.punctualPositions, 0)).toEqual([1, 10, 0]);
  });

  it("prunes invisible and disabled subtrees, exactly as for the sun", () => {
    const scene = new Scene();
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(new PointLight({ color: [1, 0, 0] }));
    scene.add(hidden);

    const disabled = new PointLight({ color: [0, 1, 0] });
    disabled.enabled = false;
    scene.add(disabled);

    scene.add(new PointLight({ color: [0, 0, 1] }));

    const lights = collectSceneLights(scene, createSceneLights());
    expect(lights.punctualCount).toBe(1);
    expect(slice3(lights.punctualColors, 0)).toEqual([0, 0, 1]);
  });

  it("clears the dead tail and the count between frames", () => {
    const out: SceneLights = createSceneLights();
    const lit = new Scene();
    const lamp = new PointLight({ color: [1, 1, 1], intensity: 5 });
    lamp.transform.position.set(7, 7, 7);
    lit.add(lamp);
    collectSceneLights(lit, out);
    expect(out.punctualCount).toBe(1);

    collectSceneLights(new Scene(), out);
    expect(out.punctualCount).toBe(0);
    expect([...out.punctualPositions]).toEqual(
      new Array<number>(MAX_PUNCTUAL_LIGHTS * 3).fill(0),
    );
    expect([...out.punctualColors]).toEqual(
      new Array<number>(MAX_PUNCTUAL_LIGHTS * 3).fill(0),
    );
  });
});

describe("collectSceneLights — past the bound (§68, §33)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the first MAX_PUNCTUAL_LIGHTS in scene-graph order and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = new Scene();
    const total = MAX_PUNCTUAL_LIGHTS + 3;
    for (let i = 0; i < total; i += 1) {
      const lamp = new PointLight({ intensity: i });
      scene.add(lamp);
    }

    const out = createSceneLights();
    collectSceneLights(scene, out);

    expect(out.punctualCount).toBe(MAX_PUNCTUAL_LIGHTS);
    // The kept lights are the *first* ones, identified by their intensities.
    for (let i = 0; i < MAX_PUNCTUAL_LIGHTS; i += 1) {
      expect(out.punctualColors[i * 3]).toBe(i);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(String(total));
    expect(warn.mock.calls[0][0]).toContain(String(MAX_PUNCTUAL_LIGHTS));

    // The second frame of the same scene is silent…
    collectSceneLights(scene, out);
    expect(warn).toHaveBeenCalledTimes(1);

    // …and a *different* scene reports its own overflow.
    const other = new Scene();
    for (let i = 0; i < total; i += 1) {
      other.add(new PointLight());
    }
    collectSceneLights(other, out);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not warn at exactly the bound", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scene = new Scene();
    for (let i = 0; i < MAX_PUNCTUAL_LIGHTS; i += 1) {
      scene.add(new PointLight());
    }

    const out = collectSceneLights(scene, createSceneLights());
    expect(out.punctualCount).toBe(MAX_PUNCTUAL_LIGHTS);
    expect(warn).not.toHaveBeenCalled();
  });
});
