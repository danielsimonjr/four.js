/**
 * §47's `ScreenCamera` (R-37) — the projection is a pixel rectangle, so every
 * test here is "this pixel lands at this NDC coordinate".
 *
 * The claims are checked by projecting points through the matrix the camera
 * built, rather than by comparing the matrix against a second copy of the same
 * formula: a projection that maps `(0, 0)` to the top-left corner of clip space
 * is the whole feature, and it is the thing a re-derivation would get wrong in
 * the same way twice.
 */

import { FourError } from "@four/core";
import { Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  Camera,
  DEFAULT_SCREEN_FAR,
  DEFAULT_SCREEN_NEAR,
  DEFAULT_SCREEN_ORIGIN,
  DEFAULT_SCREEN_UNITS,
  SCREEN_ORIGINS,
  SCREEN_UNITS,
  ScreenCamera,
} from "../src/index.js";

/** Projects a point through `camera`'s projection matrix, into NDC. */
function project(camera: ScreenCamera, x: number, y: number, z = 0): Vector3 {
  const e = camera.projectionMatrix.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  return new Vector3(
    (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
    (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
    (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
  );
}

describe("ScreenCamera (§47)", () => {
  it("is a Camera and defaults to §7a's top-left origin in logical pixels", () => {
    const camera = new ScreenCamera();
    expect(camera).toBeInstanceOf(Camera);
    expect(camera.origin).toBe(DEFAULT_SCREEN_ORIGIN);
    expect(camera.origin).toBe("top-left");
    expect(camera.units).toBe(DEFAULT_SCREEN_UNITS);
    expect(camera.units).toBe("logical");
    expect(camera.width).toBe(1);
    expect(camera.height).toBe(1);
    expect(camera.resolution).toBe(1);
    expect(camera.near).toBe(DEFAULT_SCREEN_NEAR);
    expect(camera.far).toBe(DEFAULT_SCREEN_FAR);
    expect(SCREEN_ORIGINS).toEqual(["top-left", "bottom-left", "centered"]);
    expect(SCREEN_UNITS).toEqual(["logical", "physical"]);
  });

  it("projects a camera nobody moved so that z = 0 is inside the volume", () => {
    // The trap R-8 hit twice: a camera at the origin cannot see z = 0 with the
    // shared `near = 0.1`. A screen camera must.
    const camera = new ScreenCamera({ width: 100, height: 50 });
    const depth = project(camera, 50, 25, 0).z;
    expect(depth).toBeGreaterThan(-1);
    expect(depth).toBeLessThan(1);
  });

  it("maps the four corners with a top-left origin, Y flipped", () => {
    const camera = new ScreenCamera({ width: 800, height: 600 });
    expect(project(camera, 0, 0).x).toBeCloseTo(-1, 12);
    expect(project(camera, 0, 0).y).toBeCloseTo(1, 12); // top of clip space
    expect(project(camera, 800, 600).x).toBeCloseTo(1, 12);
    expect(project(camera, 800, 600).y).toBeCloseTo(-1, 12);
    // Growing screen Y moves *down* the screen.
    expect(project(camera, 400, 450).y).toBeCloseTo(-0.5, 12);
  });

  it("maps the corners with a bottom-left origin, Y up", () => {
    const camera = new ScreenCamera({
      origin: "bottom-left",
      width: 800,
      height: 600,
    });
    expect(project(camera, 0, 0).y).toBeCloseTo(-1, 12);
    expect(project(camera, 800, 600).y).toBeCloseTo(1, 12);
    expect(project(camera, 400, 450).y).toBeCloseTo(0.5, 12);
  });

  it("centres the rectangle with a centered origin", () => {
    const camera = new ScreenCamera({
      origin: "centered",
      width: 800,
      height: 600,
    });
    const centre = project(camera, 0, 0);
    expect(centre.x).toBeCloseTo(0, 12);
    expect(centre.y).toBeCloseTo(0, 12);
    expect(project(camera, -400, -300).x).toBeCloseTo(-1, 12);
    expect(project(camera, -400, -300).y).toBeCloseTo(-1, 12);
    expect(project(camera, 400, 300).x).toBeCloseTo(1, 12);
    expect(project(camera, 400, 300).y).toBeCloseTo(1, 12);
  });

  it("counts physical pixels when asked, and logical pixels otherwise", () => {
    const logical = new ScreenCamera({
      width: 400,
      height: 300,
      resolution: 2,
    });
    expect(logical.pixelWidth).toBe(400);
    expect(logical.pixelHeight).toBe(300);
    // The 2× buffer changes nothing about a logical layout.
    expect(project(logical, 400, 0).x).toBeCloseTo(1, 12);

    const physical = new ScreenCamera({
      units: "physical",
      width: 400,
      height: 300,
      resolution: 2,
    });
    expect(physical.pixelWidth).toBe(800);
    expect(physical.pixelHeight).toBe(600);
    expect(project(physical, 800, 0).x).toBeCloseTo(1, 12);
    expect(project(physical, 400, 0).x).toBeCloseTo(0, 12);
  });

  it("keeps the inverse projection in step with the projection", () => {
    const camera = new ScreenCamera({ width: 640, height: 480 });
    const product = camera.projectionMatrix
      .clone()
      .multiply(camera.inverseProjectionMatrix);
    for (let i = 0; i < 16; i += 1) {
      expect(product.elements[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 10);
    }
  });

  it("records a size without rebuilding the projection until asked (§47)", () => {
    const camera = new ScreenCamera({ width: 100, height: 100 });
    camera.setSurfaceSize(200, 50, 3);
    expect(camera.width).toBe(200);
    expect(camera.height).toBe(50);
    expect(camera.resolution).toBe(3);
    // Not yet: §47 keeps recomputation explicit.
    expect(project(camera, 100, 0).x).toBeCloseTo(1, 12);
    camera.updateProjectionMatrix();
    expect(project(camera, 200, 0).x).toBeCloseTo(1, 12);
  });

  it("keeps the resolution when setSurfaceSize is called without one", () => {
    const camera = new ScreenCamera({ resolution: 2, units: "physical" });
    camera.setSurfaceSize(10, 10);
    expect(camera.resolution).toBe(2);
    expect(camera.pixelWidth).toBe(20);
  });

  it("honours the zero-to-one depth range", () => {
    const camera = new ScreenCamera({ width: 100, height: 100 });
    camera.updateProjectionMatrix("zero-to-one");
    // The near plane is at z = -near = 1000 in camera space; z = 0 is halfway.
    expect(project(camera, 0, 0, 0).z).toBeCloseTo(0.5, 10);
  });

  it("refuses a degenerate size rather than clamping it (§85)", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new ScreenCamera({ width: bad })).toThrow(FourError);
      expect(() => new ScreenCamera({ height: bad })).toThrow(FourError);
      expect(() => new ScreenCamera({ resolution: bad })).toThrow(FourError);
    }
    const camera = new ScreenCamera();
    expect(() => camera.setSurfaceSize(0, 10)).toThrow(/width/);
    expect(() => camera.setSurfaceSize(10, 0)).toThrow(/height/);
    expect(() => camera.setSurfaceSize(10, 10, -2)).toThrow(/resolution/);
    // Nothing was written by any of the refused calls.
    expect(camera.width).toBe(1);
    expect(camera.height).toBe(1);
    expect(camera.resolution).toBe(1);
  });

  it("refuses a size written straight into the field, at the projection (§85)", () => {
    const camera = new ScreenCamera();
    camera.width = Number.NaN;
    expect(() => camera.updateProjectionMatrix()).toThrow(FourError);
    camera.width = 10;
    camera.height = -4;
    expect(() => camera.updateProjectionMatrix()).toThrow(FourError);
    camera.height = 10;
    camera.resolution = 0;
    expect(() => camera.updateProjectionMatrix()).toThrow(FourError);
    try {
      camera.updateProjectionMatrix();
    } catch (error) {
      expect((error as FourError).code).toBe("INVALID_APPLICATION_STATE");
    }
  });

  it("is bit-identical on repeated writes (§33)", () => {
    const camera = new ScreenCamera({
      origin: "centered",
      width: 33,
      height: 7,
    });
    const first = [...camera.projectionMatrix.elements];
    camera.updateProjectionMatrix();
    expect([...camera.projectionMatrix.elements]).toEqual(first);
  });
});
