/**
 * R-36 — §44/§47's `lookAt`, across the packages that have to agree on which
 * way a node faces (2026-08-09).
 *
 * Until this packet the tree had no `lookAt` anywhere: aiming a camera or a
 * light meant hand-composing quaternions, which is what the `first-3d-scene`
 * packet recorded as the roughest edge of writing a 3D scene. The helper is one
 * method on `Node` over one primitive in `@four/math`, and no unit test inside
 * either package can check the thing that actually matters — that the
 * orientation it writes is the *same* −Z convention every consumer already
 * assumes.
 *
 * Four claims, each spanning a package boundary:
 *
 * 1. **The aim survives the §7 → §47 chain.** A camera aimed at a point
 *    projects that point to the centre of clip space through
 *    `viewMatrix · projectionMatrix` — i.e. `lookAt` produces exactly the
 *    orientation `Camera.updateViewMatrix` inverts, and exactly the −Z
 *    `Matrix4.setPerspective` projects down (§7a, plan D8).
 * 2. **`@four/render` reads the same axis.** A directional light aimed with
 *    `lookAt` lands in `collectSceneLights`' `direction` unchanged, so one call
 *    aims a camera and a lamp (§68's "the direction a camera looks").
 * 3. **The umbrella exposes it** (§97a): `four.scene.Node` carries both
 *    helpers, which is what an application actually reaches for.
 * 4. **A lookAt-derived pose is ordinary transform state.** It is a `"manual"`
 *    write that a §42 owner then drives without either side warning — `lookAt`
 *    is the application writing, not a system claiming ownership.
 */

import { Vector3 } from "@four/math";
import {
  MotionComponent,
  MotionSystem,
  createTimeState,
  type FixedUpdateContext,
} from "@four/motion";
import { collectSceneLights, createSceneLights } from "@four/render";
import {
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  SpotLight,
  resolveWorldTransforms,
} from "@four/scene";
import * as four from "four";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = new Vector3(0, 0, 0);

/**
 * Projects `point` through a camera's view and projection matrices and returns
 * its normalized device coordinates — the test's own arithmetic, so nothing
 * here can agree with the engine by sharing a helper with it.
 */
function projectToNdc(camera: PerspectiveCamera, point: Vector3): Vector3 {
  const v = camera.viewMatrix.elements;
  const cx = v[0] * point.x + v[4] * point.y + v[8] * point.z + v[12];
  const cy = v[1] * point.x + v[5] * point.y + v[9] * point.z + v[13];
  const cz = v[2] * point.x + v[6] * point.y + v[10] * point.z + v[14];

  const p = camera.projectionMatrix.elements;
  const clipX = p[0] * cx + p[4] * cy + p[8] * cz + p[12];
  const clipY = p[1] * cx + p[5] * cy + p[9] * cz + p[13];
  const clipZ = p[2] * cx + p[6] * cy + p[10] * cz + p[14];
  const clipW = p[3] * cx + p[7] * cy + p[11] * cz + p[15];
  return new Vector3(clipX / clipW, clipY / clipW, clipZ / clipW);
}

describe("Node.lookAt through the §47 camera chain", () => {
  it("puts the target dead centre of the frame, from any eye position", () => {
    const eyes: readonly (readonly [number, number, number])[] = [
      [0, 0, 6],
      [5, 5, 5],
      [-3, 1, -8],
      [0.25, -4, 2],
    ];
    const target = new Vector3(1, 0.5, -2);

    for (const [x, y, z] of eyes) {
      const camera = new PerspectiveCamera({ aspect: 16 / 9 });
      camera.position.set(x, y, z);
      camera.lookAt(target);
      camera.updateViewMatrix();

      const ndc = projectToNdc(camera, target);
      expect(ndc.x).toBeCloseTo(0, 12);
      expect(ndc.y).toBeCloseTo(0, 12);
      // In front of the camera, inside the frustum: NDC depth in (-1, 1).
      expect(ndc.z).toBeGreaterThan(-1);
      expect(ndc.z).toBeLessThan(1);
    }
  });

  it("keeps the horizon level: world up stays on the +Y half of the frame", () => {
    const camera = new PerspectiveCamera({ aspect: 16 / 9 });
    camera.position.set(4, 2, 4);
    camera.lookAt(ORIGIN);
    camera.updateViewMatrix();

    const above = projectToNdc(camera, new Vector3(0, 1, 0));
    expect(above.x).toBeCloseTo(0, 12);
    expect(above.y).toBeGreaterThan(0);
  });

  it("aims a camera parented to a moving rig", () => {
    const scene = new Scene();
    const rig = new Group();
    rig.position.set(-2, 1, 3);
    rig.rotation.setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
    const camera = new PerspectiveCamera({ aspect: 1 });
    camera.position.set(0, 1.5, 4);
    scene.add(rig);
    rig.add(camera);

    const target = new Vector3(2, 0, -1);
    resolveWorldTransforms(scene);
    camera.lookAt(target);
    resolveWorldTransforms(scene);
    camera.updateViewMatrix();

    const ndc = projectToNdc(camera, target);
    expect(ndc.x).toBeCloseTo(0, 12);
    expect(ndc.y).toBeCloseTo(0, 12);

    // Turning the rig moves the target off centre — the aim was expressed in
    // the parent's frame, not baked into world space.
    rig.rotation.setFromAxisAngle(new Vector3(0, 1, 0), 1.4);
    resolveWorldTransforms(scene);
    camera.updateViewMatrix();
    expect(Math.abs(projectToNdc(camera, target).x)).toBeGreaterThan(0.01);
  });
});

describe("Node.lookAt and @four/render's light direction (§68)", () => {
  it("feeds collectSceneLights the direction the aim implies", () => {
    const scene = new Scene();
    const sun = new DirectionalLight();
    sun.position.set(6, 8, 0);
    sun.lookAt(ORIGIN);
    scene.add(sun);

    const lights = collectSceneLights(scene, createSceneLights());
    const expected = new Vector3(-6, -8, 0).normalize();
    expect(lights.hasDirectionalLight).toBe(true);
    expect(lights.direction.x).toBeCloseTo(expected.x, 12);
    expect(lights.direction.y).toBeCloseTo(expected.y, 12);
    expect(lights.direction.z).toBeCloseTo(expected.z, 12);
  });

  it("aims a spot light and a camera with the same call and the same axis", () => {
    const target = new Vector3(0, 0, 0);

    const camera = new PerspectiveCamera();
    camera.position.set(3, 4, 5);
    camera.lookAt(target);

    const spot = new SpotLight();
    spot.position.set(3, 4, 5);
    spot.lookAt(target);

    const cameraDirection = camera.getWorldDirection(new Vector3());
    const spotDirection = spot.getWorldDirection(new Vector3());
    expect(spotDirection.x).toBe(cameraDirection.x);
    expect(spotDirection.y).toBe(cameraDirection.y);
    expect(spotDirection.z).toBe(cameraDirection.z);
  });
});

describe("Node.lookAt through the umbrella barrel (§97a)", () => {
  it("is reachable as four.scene, aiming the same way", () => {
    const camera = new four.scene.PerspectiveCamera();
    camera.position.set(0, 0, 9);
    camera.lookAt(new four.math.Vector3(0, 0, 0));

    const direction = camera.getWorldDirection(new four.math.Vector3());
    expect(direction.x).toBeCloseTo(0, 12);
    expect(direction.y).toBeCloseTo(0, 12);
    expect(direction.z).toBeCloseTo(-1, 12);
  });
});

describe("A lookAt pose is an ordinary manual write (§42)", () => {
  it("aims a system-owned node at its starting pose without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const node = new Group();
      node.transformAuthority = "kinematic";
      node.position.set(0, 0, 5);
      // Authoring the starting pose of a node a system owns is exactly what a
      // direct `rotation.setFromAxisAngle` is, and warns exactly as much: §42's
      // enforcement is writer-side, and `lookAt` is the application writing.
      node.lookAt(ORIGIN);
      expect(warn).not.toHaveBeenCalled();

      const motion = node.addComponent(new MotionComponent());
      motion.linearVelocity.set(1, 0, 0);
      const system = new MotionSystem();
      system.track(node);
      const context: FixedUpdateContext = {
        time: createTimeState({ fixedDeltaTime: 1 / 60 }),
      };
      system.fixedUpdate(context);

      // The owner drives the node from the pose `lookAt` authored, and neither
      // the helper nor the system has anything to warn about.
      expect(node.position.x).toBeCloseTo(1 / 60, 12);
      expect(node.getWorldDirection(new Vector3()).z).toBeCloseTo(-1, 12);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns exactly once when a system — not lookAt — writes what it owns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const node = new Group();
      node.transformAuthority = "physics";
      node.position.set(0, 0, 5);
      node.lookAt(ORIGIN);
      expect(warn).not.toHaveBeenCalled();

      node.addComponent(new MotionComponent());
      const system = new MotionSystem();
      system.track(node);
      system.fixedUpdate({
        time: createTimeState({ fixedDeltaTime: 1 / 60 }),
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
