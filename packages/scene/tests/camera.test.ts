import {
  constructionCount,
  Matrix4,
  resetConstructionCount,
  Vector3,
} from "@four/math";
import { describe, expect, it } from "vitest";

import {
  Camera,
  createFullscreenViewport,
  Group,
  Node,
  OrthographicCamera,
  PerspectiveCamera,
  resolveWorldTransforms,
  type Viewport,
} from "../src/index.js";

const HALF_PI = Math.PI / 2;
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/** Element-wise comparison of two matrices, naming the element that differs. */
function expectElementsCloseTo(
  actual: Matrix4,
  expected: readonly number[],
  digits = 12,
): void {
  for (let i = 0; i < 16; i += 1) {
    expect(actual.elements[i], `element ${i}`).toBeCloseTo(expected[i], digits);
  }
}

/** Applies an affine `Matrix4` to the point `(x, y, z)`, reading `elements` only. */
function transformPoint(
  m: Matrix4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const e = m.elements;
  return [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
  ];
}

/**
 * Projects a camera-space point to normalized device coordinates: the full
 * 4×4 product followed by the perspective divide. This is what a GPU does with
 * `gl_Position`, so it tests the projection the way the renderer will use it —
 * independently of how the matrix was built.
 */
function projectPoint(
  m: Matrix4,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const e = m.elements;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  return [
    (e[0] * x + e[4] * y + e[8] * z + e[12]) / w,
    (e[1] * x + e[5] * y + e[9] * z + e[13]) / w,
    (e[2] * x + e[6] * y + e[10] * z + e[14]) / w,
  ];
}

/** The 4×4 identity in column-major order. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Asserts `P · P⁻¹ = I` for a camera's projection pair (§47). */
function expectProjectionRoundTrip(camera: Camera): void {
  const product = camera.projectionMatrix
    .clone()
    .multiply(camera.inverseProjectionMatrix);
  expectElementsCloseTo(product, IDENTITY, 10);
  const reverse = camera.inverseProjectionMatrix
    .clone()
    .multiply(camera.projectionMatrix);
  expectElementsCloseTo(reverse, IDENTITY, 10);
}

/**
 * Independent ground truth: the node's world matrix built from scratch as the
 * product of every ancestor's freshly composed local matrix, outermost first —
 * never the resolver's cached output.
 */
function expectedWorld(node: Node): Matrix4 {
  const chain: Node[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) {
    chain.unshift(n);
  }
  const world = new Matrix4();
  for (const n of chain) {
    const t = n.transform;
    world.multiply(
      new Matrix4().compose(t.position, t.rotation, t.scale, t.pivot),
    );
  }
  return world;
}

describe("Camera (§47)", () => {
  it("is a Node, so it lives in the scene graph like anything else", () => {
    const camera = new PerspectiveCamera();
    expect(camera).toBeInstanceOf(Camera);
    expect(camera).toBeInstanceOf(Node);

    const rig = new Group();
    rig.add(camera);
    expect(camera.parent).toBe(rig);
    expect(rig.children).toEqual([camera]);
  });

  it("keeps one instance per matrix and writes in place", () => {
    const camera = new PerspectiveCamera();
    const projection = camera.projectionMatrix;
    const inverse = camera.inverseProjectionMatrix;
    const view = camera.viewMatrix;
    const elements = projection.elements;

    camera.aspect = 2;
    camera.updateProjectionMatrix();
    camera.updateViewMatrix();

    expect(camera.projectionMatrix).toBe(projection);
    expect(camera.inverseProjectionMatrix).toBe(inverse);
    expect(camera.viewMatrix).toBe(view);
    expect(camera.projectionMatrix.elements).toBe(elements);
  });
});

describe("PerspectiveCamera (§47, D8)", () => {
  it("applies the documented defaults and projects straight after construction", () => {
    const camera = new PerspectiveCamera();
    expect(camera.fieldOfView).toBeCloseTo(Math.PI / 3, 15);
    expect(camera.aspect).toBe(1);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);

    // Not left as the identity: the constructor computes the projection once.
    expect(camera.projectionMatrix.elements[11]).toBe(-1);
    expectProjectionRoundTrip(camera);
  });

  it("takes every option", () => {
    const camera = new PerspectiveCamera({
      fieldOfView: 1.2,
      aspect: 16 / 9,
      near: 0.25,
      far: 500,
    });
    expect(camera.fieldOfView).toBe(1.2);
    expect(camera.aspect).toBeCloseTo(16 / 9, 15);
    expect(camera.near).toBe(0.25);
    expect(camera.far).toBe(500);
  });

  it("matches the closed-form matrix for depthRange negative-one-to-one", () => {
    const fov = 1.1;
    const aspect = 16 / 9;
    const near = 0.25;
    const far = 500;
    const camera = new PerspectiveCamera({
      fieldOfView: fov,
      aspect,
      near,
      far,
    });
    camera.updateProjectionMatrix("negative-one-to-one");

    const f = 1 / Math.tan(fov / 2);
    expectElementsCloseTo(camera.projectionMatrix, [
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      (far + near) / (near - far),
      -1,
      0,
      0,
      (2 * far * near) / (near - far),
      0,
    ]);
    expectElementsCloseTo(
      camera.projectionMatrix,
      Array.from(new Matrix4().setPerspective(fov, aspect, near, far).elements),
    );
  });

  it("matches the closed-form matrix for depthRange zero-to-one", () => {
    const fov = 1.1;
    const aspect = 16 / 9;
    const near = 0.25;
    const far = 500;
    const camera = new PerspectiveCamera({
      fieldOfView: fov,
      aspect,
      near,
      far,
    });
    camera.updateProjectionMatrix("zero-to-one");

    const f = 1 / Math.tan(fov / 2);
    expectElementsCloseTo(camera.projectionMatrix, [
      f / aspect,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      0,
      far / (near - far),
      -1,
      0,
      0,
      (far * near) / (near - far),
      0,
    ]);
    expectElementsCloseTo(
      camera.projectionMatrix,
      Array.from(
        new Matrix4().setPerspective(fov, aspect, near, far, "zero-to-one")
          .elements,
      ),
    );
  });

  it("maps the frustum to the clip volume for both depth ranges", () => {
    const fov = Math.PI / 3;
    const aspect = 2;
    const near = 0.5;
    const far = 100;
    const camera = new PerspectiveCamera({
      fieldOfView: fov,
      aspect,
      near,
      far,
    });

    // Camera space is right-handed with +Y up and the view direction along −Z
    // (§7a, D8), so the near plane sits at z = −near.
    const halfHeight = near * Math.tan(fov / 2);
    const halfWidth = halfHeight * aspect;

    const nearTopRight = projectPoint(
      camera.projectionMatrix,
      halfWidth,
      halfHeight,
      -near,
    );
    expect(nearTopRight[0]).toBeCloseTo(1, 12);
    expect(nearTopRight[1]).toBeCloseTo(1, 12);
    expect(nearTopRight[2]).toBeCloseTo(-1, 12);

    const centre = projectPoint(camera.projectionMatrix, 0, 0, -far);
    expect(centre[0]).toBeCloseTo(0, 12);
    expect(centre[1]).toBeCloseTo(0, 12);
    expect(centre[2]).toBeCloseTo(1, 12);

    camera.updateProjectionMatrix("zero-to-one");
    expect(projectPoint(camera.projectionMatrix, 0, 0, -near)[2]).toBeCloseTo(
      0,
      12,
    );
    expect(projectPoint(camera.projectionMatrix, 0, 0, -far)[2]).toBeCloseTo(
      1,
      12,
    );
    // Only depth differs between the ranges.
    const topRight = projectPoint(
      camera.projectionMatrix,
      halfWidth,
      halfHeight,
      -near,
    );
    expect(topRight[0]).toBeCloseTo(1, 12);
    expect(topRight[1]).toBeCloseTo(1, 12);
  });

  it("keeps the inverse projection in step with the projection", () => {
    const camera = new PerspectiveCamera({ aspect: 4 / 3 });
    expectProjectionRoundTrip(camera);

    camera.fieldOfView = 0.7;
    camera.aspect = 21 / 9;
    camera.near = 0.01;
    camera.far = 250;
    camera.updateProjectionMatrix("zero-to-one");
    expectProjectionRoundTrip(camera);
  });

  it("does not recompute the projection when a parameter is written", () => {
    const camera = new PerspectiveCamera({ aspect: 1 });
    const before = Array.from(camera.projectionMatrix.elements);

    camera.aspect = 3;
    expectElementsCloseTo(camera.projectionMatrix, before);

    camera.updateProjectionMatrix();
    expect(camera.projectionMatrix.elements[0]).toBeCloseTo(before[0] / 3, 12);
  });
});

describe("OrthographicCamera (§47, D8)", () => {
  it("applies the documented defaults", () => {
    const camera = new OrthographicCamera();
    expect(camera.left).toBe(-1);
    expect(camera.right).toBe(1);
    expect(camera.bottom).toBe(-1);
    expect(camera.top).toBe(1);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);
    expectProjectionRoundTrip(camera);
  });

  it("matches the closed-form matrix for both depth ranges", () => {
    const left = -8;
    const right = 8;
    const bottom = -4.5;
    const top = 4.5;
    const near = 0.5;
    const far = 200;
    const camera = new OrthographicCamera({
      left,
      right,
      bottom,
      top,
      near,
      far,
    });

    expectElementsCloseTo(camera.projectionMatrix, [
      2 / (right - left),
      0,
      0,
      0,
      0,
      2 / (top - bottom),
      0,
      0,
      0,
      0,
      -2 / (far - near),
      0,
      -(right + left) / (right - left),
      -(top + bottom) / (top - bottom),
      -(far + near) / (far - near),
      1,
    ]);

    camera.updateProjectionMatrix("zero-to-one");
    expectElementsCloseTo(camera.projectionMatrix, [
      2 / (right - left),
      0,
      0,
      0,
      0,
      2 / (top - bottom),
      0,
      0,
      0,
      0,
      -1 / (far - near),
      0,
      -(right + left) / (right - left),
      -(top + bottom) / (top - bottom),
      -near / (far - near),
      1,
    ]);
    expectElementsCloseTo(
      camera.projectionMatrix,
      Array.from(
        new Matrix4().setOrthographic(
          left,
          right,
          bottom,
          top,
          near,
          far,
          "zero-to-one",
        ).elements,
      ),
    );
  });

  it("maps the view box to the clip volume for both depth ranges", () => {
    const camera = new OrthographicCamera({
      left: -4,
      right: 12,
      bottom: -3,
      top: 5,
      near: 1,
      far: 50,
    });

    const nearBottomLeft = projectPoint(
      camera.projectionMatrix,
      -4,
      -3,
      -1, // z = −near
    );
    expect(nearBottomLeft[0]).toBeCloseTo(-1, 12);
    expect(nearBottomLeft[1]).toBeCloseTo(-1, 12);
    expect(nearBottomLeft[2]).toBeCloseTo(-1, 12);

    const farTopRight = projectPoint(camera.projectionMatrix, 12, 5, -50);
    expect(farTopRight[0]).toBeCloseTo(1, 12);
    expect(farTopRight[1]).toBeCloseTo(1, 12);
    expect(farTopRight[2]).toBeCloseTo(1, 12);

    camera.updateProjectionMatrix("zero-to-one");
    expect(projectPoint(camera.projectionMatrix, 0, 0, -1)[2]).toBeCloseTo(
      0,
      12,
    );
    expect(projectPoint(camera.projectionMatrix, 0, 0, -50)[2]).toBeCloseTo(
      1,
      12,
    );
  });

  it("keeps the inverse projection in step and does not auto-recompute", () => {
    const camera = new OrthographicCamera({ left: -2, right: 2 });
    const before = Array.from(camera.projectionMatrix.elements);

    camera.left = -20;
    camera.right = 20;
    expectElementsCloseTo(camera.projectionMatrix, before);

    camera.updateProjectionMatrix();
    expect(camera.projectionMatrix.elements[0]).toBeCloseTo(2 / 40, 12);
    expectProjectionRoundTrip(camera);
  });
});

describe("Camera.updateViewMatrix (§47, §7)", () => {
  it("is the inverse of the world matrix for an unparented camera", () => {
    const camera = new PerspectiveCamera();
    camera.transform.position.set(0, 0, 5);
    camera.updateViewMatrix();

    // The camera looks down −Z, so the origin is 5 units in front of it.
    const seen = transformPoint(camera.viewMatrix, 0, 0, 0);
    expect(seen[0]).toBeCloseTo(0, 12);
    expect(seen[1]).toBeCloseTo(0, 12);
    expect(seen[2]).toBeCloseTo(-5, 12);
  });

  it("accounts for rotation", () => {
    const camera = new PerspectiveCamera();
    // A quarter turn about +Y points the −Z view direction along −X.
    camera.transform.rotation.setFromAxisAngle(AXIS_Y, HALF_PI);
    camera.updateViewMatrix();

    const seen = transformPoint(camera.viewMatrix, -3, 0, 0);
    expect(seen[0]).toBeCloseTo(0, 12);
    expect(seen[1]).toBeCloseTo(0, 12);
    expect(seen[2]).toBeCloseTo(-3, 12);
  });

  it("inverts the composed world matrix under a hierarchy", () => {
    // rig (translate (1,2,3), rotate 90° about Z) → arm → camera (local +4 z)
    const rig = new Group();
    rig.transform.position.set(1, 2, 3);
    rig.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    const arm = new Group();
    const camera = new PerspectiveCamera();
    camera.transform.position.set(0, 0, 4);
    rig.add(arm);
    arm.add(camera);

    resolveWorldTransforms(rig);
    camera.updateViewMatrix();

    // view · world = identity, by definition (§47).
    const product = camera.viewMatrix.clone().multiply(expectedWorld(camera));
    expectElementsCloseTo(product, IDENTITY, 10);

    // Analytic ground truth. The camera's world position is
    // (1,2,3) + Rz(90°)·(0,0,4) = (1,2,7) and its world rotation is Rz(90°),
    // so a world point p maps to Rz(90°)ᵀ·(p − (1,2,7)).
    const inFront = transformPoint(camera.viewMatrix, 1, 2, 0);
    expect(inFront[0]).toBeCloseTo(0, 12);
    expect(inFront[1]).toBeCloseTo(0, 12);
    expect(inFront[2]).toBeCloseTo(-7, 12);

    // Rz(90°) maps (1,0,0) to (0,1,0), so its transpose maps it to (0,−1,0).
    const offAxis = transformPoint(camera.viewMatrix, 2, 2, 7);
    expect(offAxis[0]).toBeCloseTo(0, 12);
    expect(offAxis[1]).toBeCloseTo(-1, 12);
    expect(offAxis[2]).toBeCloseTo(0, 12);
  });

  it("uses the current world transform after an ancestor moves", () => {
    const rig = new Group();
    rig.transform.position.set(1, 2, 3);
    rig.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    const camera = new OrthographicCamera();
    camera.transform.position.set(0, 0, 4);
    rig.add(camera);

    resolveWorldTransforms(rig);
    camera.updateViewMatrix();
    expect(transformPoint(camera.viewMatrix, 1, 2, 0)[2]).toBeCloseTo(-7, 12);

    // Move the parent and resolve again: the view matrix follows.
    rig.transform.position.set(1, 2, 4);
    resolveWorldTransforms(rig);
    camera.updateViewMatrix();
    expect(transformPoint(camera.viewMatrix, 1, 2, 0)[2]).toBeCloseTo(-8, 12);
    expectElementsCloseTo(
      camera.viewMatrix.clone().multiply(expectedWorld(camera)),
      IDENTITY,
      10,
    );
  });

  it("resolves world transforms on demand, without a preceding pass", () => {
    const rig = new Group();
    const camera = new PerspectiveCamera();
    rig.add(camera);
    rig.transform.position.set(0, 3, 0);
    camera.transform.position.set(0, 0, 6);

    // No resolveWorldTransforms call at all.
    camera.updateViewMatrix();
    const seen = transformPoint(camera.viewMatrix, 0, 3, 0);
    expect(seen[2]).toBeCloseTo(-6, 12);

    // And after a mutation that no pass has seen.
    rig.transform.position.set(0, 3, 1);
    camera.updateViewMatrix();
    expect(transformPoint(camera.viewMatrix, 0, 3, 0)[2]).toBeCloseTo(-7, 12);
  });

  it("allocates no math objects on the steady-state path (§7b)", () => {
    const rig = new Group();
    const camera = new PerspectiveCamera();
    rig.add(camera);
    camera.transform.position.set(0, 0, 2);
    resolveWorldTransforms(rig);
    camera.updateViewMatrix();

    resetConstructionCount();
    for (let i = 0; i < 8; i += 1) {
      camera.updateViewMatrix();
      camera.updateProjectionMatrix();
    }
    expect(constructionCount()).toBe(0);
  });

  it("produces no infinities when the world matrix is singular", () => {
    const camera = new PerspectiveCamera();
    camera.transform.position.set(1, 2, 3);
    camera.transform.scale.set(0, 0, 0);
    camera.updateViewMatrix();

    // `Matrix4.invert` refuses singular input and leaves the elements alone, so
    // the view matrix holds the un-inverted world matrix — meaningless, but
    // finite: nothing downstream is poisoned with NaN or Infinity.
    for (let i = 0; i < 16; i += 1) {
      expect(
        Number.isFinite(camera.viewMatrix.elements[i]),
        `element ${i}`,
      ).toBe(true);
    }
    expectElementsCloseTo(
      camera.viewMatrix,
      Array.from(expectedWorld(camera).elements),
    );
  });
});

describe("Viewport (§48)", () => {
  it("createFullscreenViewport covers the surface in normalized units", () => {
    const camera = new PerspectiveCamera();
    const viewport = createFullscreenViewport(camera);

    expect(viewport).toEqual({
      id: "main",
      camera,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      normalized: true,
    });
    expect(viewport.clearColor).toBeUndefined();
  });

  it("takes an explicit id", () => {
    expect(
      createFullscreenViewport(new OrthographicCamera(), "minimap").id,
    ).toBe("minimap");
  });

  it("describes a pixel rectangle with a clear colour", () => {
    const camera = new OrthographicCamera();
    const minimap: Viewport = {
      id: "minimap",
      camera,
      x: 16,
      y: 16,
      width: 256,
      height: 256,
      clearColor: [0, 0, 0, 0.5],
    };

    expect(minimap.normalized).toBeUndefined();
    expect(minimap.camera).toBe(camera);
    expect(minimap.clearColor).toEqual([0, 0, 0, 0.5]);
  });
});
