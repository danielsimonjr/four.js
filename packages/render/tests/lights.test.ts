import { Vector3 } from "@four/math";
import { DirectionalLight, Group, Scene } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  collectSceneLights,
  createSceneLights,
  isDirectionalLightSource,
  type AmbientLightSource,
  type DirectionalLightSource,
  type SceneLights,
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
function typePins(): [DirectionalLightSource, AmbientLightSource] {
  const light: DirectionalLightSource = new DirectionalLight();
  const ambient: AmbientLightSource = new Scene();
  return [light, ambient];
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
