/**
 * §21 local-plane basis and mapping, independent of a solver.
 */

import { Quaternion, Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_PLANE,
  isDefaultLocalPlane,
  planeToWorld,
  resolveLocalPlane,
  worldToPlane,
} from "../src/local-plane.js";

describe("resolveLocalPlane (§21)", () => {
  it("returns the shared XY default when omitted", () => {
    expect(resolveLocalPlane()).toBe(DEFAULT_LOCAL_PLANE);
    expect(isDefaultLocalPlane(DEFAULT_LOCAL_PLANE)).toBe(true);
  });

  it("builds a right-handed basis for a tilted plane", () => {
    const plane = resolveLocalPlane({
      origin: new Vector3(1, 2, 3),
      normal: new Vector3(0, 1, 1),
      xAxis: new Vector3(1, 0, 0),
    });
    expect(plane.normal.length()).toBeCloseTo(1, 12);
    expect(plane.xAxis.dot(plane.normal)).toBeCloseTo(0, 12);
    expect(plane.yAxis.dot(plane.normal)).toBeCloseTo(0, 12);
    const crossed = plane.xAxis.clone().cross(plane.yAxis);
    expect(crossed.x).toBeCloseTo(plane.normal.x, 12);
    expect(crossed.y).toBeCloseTo(plane.normal.y, 12);
    expect(crossed.z).toBeCloseTo(plane.normal.z, 12);
  });

  it("round-trips a plane-frame pose through world", () => {
    const plane = resolveLocalPlane({
      origin: new Vector3(0, 1, 0),
      normal: new Vector3(0, 1, 1),
      xAxis: new Vector3(1, 0, 0),
    });
    const localPos = new Vector3(2, -1, 0);
    const localRot = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 4,
    );
    const worldPos = new Vector3();
    const worldRot = new Quaternion();
    planeToWorld(plane, localPos, localRot, worldPos, worldRot);
    const backPos = new Vector3();
    const backRot = new Quaternion();
    worldToPlane(plane, worldPos, worldRot, backPos, backRot);
    expect(backPos.x).toBeCloseTo(2, 10);
    expect(backPos.y).toBeCloseTo(-1, 10);
    expect(backPos.z).toBeCloseTo(0, 10);
    expect(backRot.z).toBeCloseTo(localRot.z, 10);
    expect(backRot.w).toBeCloseTo(localRot.w, 10);
  });

  it("refuses a zero normal", () => {
    expect(() =>
      resolveLocalPlane({
        origin: new Vector3(),
        normal: new Vector3(0, 0, 0),
      }),
    ).toThrow(/non-zero/);
  });

  it("falls back to +Y when the normal is along +X", () => {
    const plane = resolveLocalPlane({
      origin: new Vector3(),
      normal: new Vector3(1, 0, 0),
    });
    expect(plane.xAxis.y).toBeCloseTo(1, 12);
    expect(plane.xAxis.dot(plane.normal)).toBeCloseTo(0, 12);
    expect(isDefaultLocalPlane(plane)).toBe(false);
  });

  it("refuses an xAxis parallel to the normal", () => {
    expect(() =>
      resolveLocalPlane({
        origin: new Vector3(),
        normal: new Vector3(0, 0, 1),
        xAxis: new Vector3(0, 0, 2),
      }),
    ).toThrow(/parallel/);
  });

  it("recognises an authored XY plane as the default by value", () => {
    const plane = resolveLocalPlane({
      origin: new Vector3(0, 0, 0),
      normal: new Vector3(0, 0, 1),
      xAxis: new Vector3(1, 0, 0),
    });
    expect(plane).not.toBe(DEFAULT_LOCAL_PLANE);
    expect(isDefaultLocalPlane(plane)).toBe(true);
  });

  it("builds a basis when the rotation is a 180° flip about +Z", () => {
    const plane = resolveLocalPlane({
      origin: new Vector3(),
      normal: new Vector3(0, 0, 1),
      xAxis: new Vector3(-1, 0, 0),
    });
    const local = new Vector3(1, 0, 0);
    const world = new Vector3();
    const rot = new Quaternion();
    planeToWorld(plane, local, new Quaternion(), world, rot);
    expect(world.x).toBeCloseTo(-1, 12);
    expect(plane.normal.z).toBeCloseTo(1, 12);
  });
});
