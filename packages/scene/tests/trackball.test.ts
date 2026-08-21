/**
 * §44/§47's trackball rig (R-37).
 *
 * The properties worth pinning are the ones that distinguish a trackball from
 * an orbit rig: the virtual sphere is continuous across its own silhouette, the
 * composition is world-space (so a second drag turns about screen axes), a drag
 * and its reverse cancel exactly, and there is no pole.
 */

import { Quaternion, Vector3 } from "@four/math";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TRACKBALL_RADIUS, Group, TrackballRig } from "../src/index.js";

/** A 400 × 400 rig, so the sphere radius is exactly 200 px. */
function rig(options = {}): TrackballRig {
  return new TrackballRig({ width: 400, height: 400, ...options });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TrackballRig (§44, §47)", () => {
  it("defaults to a unit sphere over a 1 × 1 viewport with §7a's origin", () => {
    const trackball = new TrackballRig();
    expect(trackball.width).toBe(1);
    expect(trackball.height).toBe(1);
    expect(trackball.origin).toBe("top-left");
    expect(trackball.radius).toBe(DEFAULT_TRACKBALL_RADIUS);
    expect(trackball.distance).toBe(1);
    expect(trackball.rotation.w).toBe(1);
    expect(trackball.target.lengthSq()).toBe(0);
  });

  it("copies its target and normalizes an authored rotation", () => {
    const target = new Vector3(1, 2, 3);
    const trackball = rig({ target, rotation: new Quaternion(0, 0, 0, 4) });
    target.set(9, 9, 9);
    expect(trackball.target.x).toBe(1);
    expect(trackball.rotation.w).toBeCloseTo(1, 12);
  });

  it("maps the viewport centre to the near pole", () => {
    const out = new Vector3();
    rig().projectToSphere(200, 200, out);
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(0, 12);
    expect(out.z).toBeCloseTo(1, 12);
  });

  it("maps the silhouette to the equator and stays continuous outside it", () => {
    const trackball = rig();
    const out = new Vector3();
    // The crossover is at d = 1/√2 of the 200 px radius. Approach it from the
    // sphere side and from the sheet side: the two must agree.
    const crossover = 200 + 200 / Math.SQRT2;
    trackball.projectToSphere(crossover - 0.001, 200, out);
    const inside = out.clone();
    trackball.projectToSphere(crossover + 0.001, 200, out);
    expect(out.z).toBeCloseTo(inside.z, 4);
    expect(out.x).toBeCloseTo(inside.x, 4);
    // Both sides are unit length, and the sheet keeps falling rather than
    // stopping at the rim.
    expect(inside.length()).toBeCloseTo(1, 12);
    trackball.projectToSphere(600, 200, out);
    expect(out.length()).toBeCloseTo(1, 12);
    expect(out.z).toBeLessThan(0.3);
    expect(out.x).toBeGreaterThan(0.9);
  });

  it("points screen Y downwards for a top-left origin and upwards otherwise", () => {
    const out = new Vector3();
    // Dragging down the screen from the centre must tilt towards −Y.
    rig().projectToSphere(200, 300, out);
    expect(out.y).toBeLessThan(0);
    rig({ origin: "bottom-left" }).projectToSphere(200, 300, out);
    expect(out.y).toBeGreaterThan(0);
    // A centered origin takes the coordinate as it stands.
    rig({ origin: "centered" }).projectToSphere(0, 100, out);
    expect(out.y).toBeGreaterThan(0);
    expect(out.x).toBeCloseTo(0, 12);
  });

  it("turns a horizontal drag across the centre into a rotation about +Y", () => {
    const trackball = rig();
    expect(trackball.drag(200, 200, 300, 200)).toBe(true);
    expect(trackball.dragCount).toBe(1);
    // Half of the 200 px radius is 30°, and the axis is +Y.
    const half = Math.PI / 12;
    expect(trackball.rotation.y).toBeCloseTo(Math.sin(half), 6);
    expect(trackball.rotation.w).toBeCloseTo(Math.cos(half), 6);
    expect(trackball.rotation.x).toBeCloseTo(0, 12);
    expect(trackball.rotation.z).toBeCloseTo(0, 12);
  });

  it("cancels exactly when a drag is reversed", () => {
    const trackball = rig();
    trackball.drag(120, 90, 260, 310);
    trackball.drag(260, 310, 120, 90);
    expect(trackball.rotation.w).toBeCloseTo(1, 10);
    expect(trackball.rotation.x).toBeCloseTo(0, 10);
    expect(trackball.rotation.y).toBeCloseTo(0, 10);
    expect(trackball.rotation.z).toBeCloseTo(0, 10);
    expect(trackball.dragCount).toBe(2);
  });

  it("composes in world space, so a second drag is about a screen axis", () => {
    const trackball = rig();
    trackball.drag(200, 200, 300, 200); // yaw about +Y
    trackball.drag(200, 200, 200, 300); // then pitch about the *screen* X
    const world = new Quaternion().copy(trackball.rotation);

    // The same two drags in the other order. For a yaw about +Y and a pitch
    // about +X the two products agree in x, y and w and differ in **z** by
    // exactly twice their product — the roll a trackball accumulates and an
    // azimuth/elevation rig cannot. A local-space composition
    // (`rotation · delta`) would have produced the *other* sign here, which is
    // what this assertion is really pinning.
    const swapped = rig();
    swapped.drag(200, 200, 200, 300);
    swapped.drag(200, 200, 300, 200);
    expect(world.x).toBeCloseTo(swapped.rotation.x, 12);
    expect(world.y).toBeCloseTo(swapped.rotation.y, 12);
    expect(world.z).toBeCloseTo(-swapped.rotation.z, 12);
    expect(Math.abs(world.z)).toBeGreaterThan(1e-2);
    // …and the result is still a unit quaternion.
    const lengthSq =
      world.x * world.x +
      world.y * world.y +
      world.z * world.z +
      world.w * world.w;
    expect(lengthSq).toBeCloseTo(1, 12);
  });

  it("has no pole: dragging a full turn keeps rotating", () => {
    const trackball = rig();
    for (let i = 0; i < 40; i += 1) {
      expect(trackball.drag(200, 200, 210, 200)).toBe(true);
    }
    expect(trackball.dragCount).toBe(40);
    const lengthSq =
      trackball.rotation.x ** 2 +
      trackball.rotation.y ** 2 +
      trackball.rotation.z ** 2 +
      trackball.rotation.w ** 2;
    expect(lengthSq).toBeCloseTo(1, 12);
  });

  it("counts a zero-length drag instead of writing an undefined axis (§85)", () => {
    const trackball = rig();
    expect(trackball.drag(200, 200, 200, 200)).toBe(false);
    expect(trackball.degenerateDrags).toBe(1);
    expect(trackball.dragCount).toBe(0);
    expect(trackball.rotation.w).toBe(1);
  });

  it("refuses non-finite input and a degenerate viewport (§85)", () => {
    const trackball = rig();
    expect(() => trackball.drag(Number.NaN, 0, 1, 1)).toThrow(RangeError);
    expect(() => trackball.drag(0, 0, Number.POSITIVE_INFINITY, 1)).toThrow(
      RangeError,
    );
    expect(() => trackball.setViewportSize(0, 10)).toThrow(/width/);
    expect(() => trackball.setViewportSize(10, Number.NaN)).toThrow(/height/);
    expect(trackball.width).toBe(400);
    trackball.height = 0;
    expect(() => trackball.projectToSphere(1, 1, new Vector3())).toThrow(
      /height/,
    );
    expect(() => new TrackballRig({ width: -1 })).toThrow(RangeError);
    expect(() => new TrackballRig({ height: 0 })).toThrow(RangeError);
    expect(() => new TrackballRig({ radius: Number.NaN })).toThrow(RangeError);
    expect(() => new TrackballRig({ distance: 0 })).toThrow(RangeError);
  });

  it("resizes and resets", () => {
    const trackball = rig();
    expect(trackball.setViewportSize(800, 200)).toBe(trackball);
    expect(trackball.width).toBe(800);
    expect(trackball.height).toBe(200);
    trackball.drag(400, 100, 500, 100);
    trackball.reset();
    expect(trackball.rotation.w).toBe(1);
    expect(trackball.dragCount).toBe(1);
  });

  it("places a node at target + rotated offset, looking down its own −Z", () => {
    const node = new Group();
    const trackball = rig({ target: new Vector3(1, 2, 3), distance: 5 });
    expect(trackball.applyTo(node)).toBe(true);
    expect(node.position.x).toBeCloseTo(1, 12);
    expect(node.position.y).toBeCloseTo(2, 12);
    expect(node.position.z).toBeCloseTo(8, 12);

    // A quarter turn about +Y swings the camera onto +X.
    trackball.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    trackball.applyTo(node);
    expect(node.position.x).toBeCloseTo(6, 10);
    expect(node.position.y).toBeCloseTo(2, 10);
    expect(node.position.z).toBeCloseTo(3, 10);
    // …and the node's −Z now points back at the target.
    const forward = node.getWorldDirection(new Vector3());
    expect(forward.x).toBeCloseTo(-1, 10);
  });

  it("refuses a node owned by another §42 authority, and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    node.transformAuthority = "physics";
    const trackball = rig({ distance: 4 });
    expect(trackball.applyTo(node)).toBe(false);
    expect(trackball.applyTo(node)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(node.position.lengthSq()).toBe(0);
  });
});
