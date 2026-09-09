/**
 * Consumer-seat §43 interpolated skin palettes (dogfood cycle 6, 2026-09-09).
 *
 * Package units already cover `Skeleton.update(skinRoot, worldOf?)` and a
 * translating bone through `buildInterpolatedRenderList`. A translation
 * column lerps, so that case cannot tell composed poses from matrix-lerped
 * palettes. This file is the outside-the-engine check: a two-bone arm, a
 * 90° hip rotation, public `@fourjs/*` APIs only.
 *
 * Claims:
 *
 * 1. Palettes at alpha 0 and 1 differ.
 * 2. `buildInterpolatedRenderList` matches a consumer `worldOf` that
 *    composes interpolated local poses, then runs `Skeleton.update`.
 * 3. The mid-alpha palette is **not** the lerp of the endpoint palettes
 *    (the product the engine forbids).
 * 4. Scene transforms are unchanged (§42 / §43).
 */

import { planeGeometry } from "@fourjs/geometry";
import { Matrix4, Quaternion, Vector3 } from "@fourjs/math";
import { UnlitMaterial } from "@fourjs/materials";
import {
  Mesh,
  buildInterpolatedRenderList,
  isSkinnedUnlitItem,
  type RenderItem,
} from "@fourjs/render";
import {
  Bone,
  PoseBuffer,
  Scene,
  Skeleton,
  resolveWorldTransforms,
  type Node,
} from "@fourjs/scene";
import { describe, expect, it } from "vitest";

const AXIS_Z = new Vector3(0, 0, 1);
const HALF_PI = Math.PI / 2;
const HALF_TURN = Math.PI / 4;

function skinnedPlane(): ReturnType<typeof planeGeometry> {
  const geometry = planeGeometry({ width: 2, height: 2 });
  const vertexCount = geometry.vertexCount;
  geometry.joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    weights[i * 4] = 1;
  }
  geometry.weights = weights;
  return geometry;
}

/**
 * Consumer `worldOf`: compose interpolated locals the same way a world
 * matrix is composed. `Skeleton.update` copies the returned matrix
 * immediately, so one scratch is legal.
 */
function interpolatedWorldOf(
  poses: PoseBuffer,
  alpha: number,
): (node: Node) => Matrix4 {
  const ancestors: Node[] = [];
  const local = new Matrix4();
  const world = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  return (node: Node): Matrix4 => {
    ancestors.length = 0;
    for (
      let current: Node | null = node;
      current !== null;
      current = current.parent
    ) {
      ancestors.push(current);
    }
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const current = ancestors[i];
      const transform = current.transform;
      if (poses.computeRenderPose(current, alpha, position, rotation)) {
        local.compose(position, rotation, transform.scale, transform.pivot);
      } else {
        transform.updateLocalMatrix();
        local.copy(transform.localMatrix);
      }
      if (i === ancestors.length - 1) {
        world.copy(local);
      } else {
        world.multiply(local);
      }
    }
    return world;
  };
}

function paletteOf(item: RenderItem): number[] {
  if (!isSkinnedUnlitItem(item)) {
    throw new Error("expected skinned-unlit item");
  }
  return Array.from(item.jointMatrices);
}

function lerpPalette(
  a: readonly number[],
  b: readonly number[],
  t: number,
): number[] {
  return a.map((value, index) => value + (b[index] - value) * t);
}

function expectClose(
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual[i], `element ${String(i)}`).toBeCloseTo(expected[i], 10);
  }
}

describe("§43 interpolated skin palettes (consumer seat)", () => {
  it("composes interpolated local poses; it does not lerp jointMatrices", () => {
    const scene = new Scene();
    const mesh = new Mesh(skinnedPlane(), new UnlitMaterial());
    const hip = new Bone();
    const knee = new Bone();
    knee.transform.position.set(0, 1, 0);
    hip.add(knee);
    mesh.add(hip);
    const skeleton = new Skeleton([hip, knee]);
    mesh.skeleton = skeleton;
    scene.add(mesh);

    const poses = new PoseBuffer();
    poses.track(mesh);
    poses.track(hip);
    poses.track(knee);
    poses.capture();
    hip.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    poses.capture();

    resolveWorldTransforms(scene);
    const before = [scene, mesh, hip, knee].map((node) => ({
      node,
      version: node.transform.version,
      worldVersion: node.transform.worldVersion,
      world: node.transform.worldMatrix.clone(),
    }));

    const expected = [0, 0.5, 1].map((alpha) => {
      skeleton.update(mesh, interpolatedWorldOf(poses, alpha));
      return Array.from(skeleton.jointMatrices);
    });
    const [fromWorldOf0, fromWorldOfHalf, fromWorldOf1] = expected;

    expect(fromWorldOf0).not.toEqual(fromWorldOf1);

    const out: RenderItem[] = [];
    const list0 = buildInterpolatedRenderList(scene, poses, 0, out);
    expect(list0).toHaveLength(1);
    const palette0 = paletteOf(list0[0]);

    const listHalf = buildInterpolatedRenderList(scene, poses, 0.5, out);
    const paletteHalf = paletteOf(listHalf[0]);

    const list1 = buildInterpolatedRenderList(scene, poses, 1, out);
    const palette1 = paletteOf(list1[0]);

    expectClose(palette0, fromWorldOf0);
    expectClose(paletteHalf, fromWorldOfHalf);
    expectClose(palette1, fromWorldOf1);

    const lerped = lerpPalette(palette0, palette1, 0.5);
    expect(paletteHalf).not.toEqual(lerped);
    expect(paletteHalf[0]).toBeCloseTo(Math.cos(HALF_TURN), 6);
    expect(paletteHalf[1]).toBeCloseTo(Math.sin(HALF_TURN), 6);
    expect(lerped[0]).toBeCloseTo(0.5, 10);

    const kneeHalf = paletteHalf.slice(16, 32);
    expect(kneeHalf[12]).toBeCloseTo(-Math.sin(HALF_TURN), 6);
    expect(kneeHalf[13]).toBeCloseTo(Math.cos(HALF_TURN), 6);
    const kneeLerped = lerped.slice(16, 32);
    expect(kneeLerped[12]).toBeCloseTo(-0.5, 10);
    expect(kneeLerped[13]).toBeCloseTo(0.5, 10);

    for (const snapshot of before) {
      expect(snapshot.node.transform.version).toBe(snapshot.version);
      expect(snapshot.node.transform.worldVersion).toBe(snapshot.worldVersion);
      expect(Array.from(snapshot.node.transform.worldMatrix.elements)).toEqual(
        Array.from(snapshot.world.elements),
      );
    }
  });
});
