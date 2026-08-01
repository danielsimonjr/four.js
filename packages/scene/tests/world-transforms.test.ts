import {
  constructionCount,
  Matrix4,
  resetConstructionCount,
  Vector3,
} from "@four/math";
import { describe, expect, it } from "vitest";

import {
  Group,
  resolveWorldTransform,
  resolveWorldTransforms,
  type Node,
  type WorldTransformStats,
} from "../src/index.js";

const HALF_PI = Math.PI / 2;
const AXIS_Z = new Vector3(0, 0, 1);

function expectElementsCloseTo(
  actual: Matrix4,
  expected: Matrix4,
  digits = 12,
): void {
  for (let i = 0; i < 16; i += 1) {
    expect(actual.elements[i], `element ${i}`).toBeCloseTo(
      expected.elements[i],
      digits,
    );
  }
}

/**
 * Independent ground truth: the node's world matrix built from scratch as the
 * product of every ancestor's freshly composed local matrix, outermost first.
 * Uses only `Matrix4.compose` and `Matrix4.multiply` (both verified in WP-1.3),
 * never the resolver's own output — and never the cached `localMatrix` either,
 * except for the hand-authored matrices of `matrixAutoUpdate = false` nodes,
 * where the local matrix *is* the authored value.
 */
function expectedWorld(node: Node): Matrix4 {
  const chain: Node[] = [];
  for (let n: Node | null = node; n !== null; n = n.parent) {
    chain.unshift(n);
  }
  const world = new Matrix4();
  for (const n of chain) {
    const t = n.transform;
    const local = t.matrixAutoUpdate
      ? new Matrix4().compose(t.position, t.rotation, t.scale, t.pivot)
      : t.localMatrix.clone();
    world.multiply(local);
  }
  return world;
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

/** A named group, for readable failures. */
function group(name: string): Group {
  const g = new Group();
  g.name = name;
  return g;
}

/** `a → b → c → d`, each a child of the previous; returns them in that order. */
function chain(depth: number): Group[] {
  const nodes: Group[] = [];
  for (let i = 0; i < depth; i += 1) {
    const node = group(`n${String(i)}`);
    if (i > 0) {
      nodes[i - 1].add(node);
    }
    nodes.push(node);
  }
  return nodes;
}

describe("resolveWorldTransforms — composition (§7)", () => {
  it("copies the local matrix into the world matrix of a root", () => {
    const root = group("root");
    root.transform.position.set(1, 2, 3);
    root.transform.scale.set(2, 2, 2);

    resolveWorldTransforms(root);

    expectElementsCloseTo(
      root.transform.worldMatrix,
      root.transform.localMatrix,
    );
    expectElementsCloseTo(root.transform.worldMatrix, expectedWorld(root));
  });

  it("concatenates parent · local, verified as a point transform", () => {
    const [parent, child] = chain(2);
    parent.transform.position.set(10, 0, 0);
    parent.transform.scale.set(2, 2, 2);
    child.transform.position.set(1, 0, 0);

    resolveWorldTransforms(parent);

    // The child sits one unit along +X in a parent scaled ×2 and shifted to
    // x = 10, so its origin lands at x = 12 and a unit offset inside it spans 2.
    const [ox, oy, oz] = transformPoint(child.transform.worldMatrix, 0, 0, 0);
    expect(ox).toBeCloseTo(12, 12);
    expect(oy).toBeCloseTo(0, 12);
    expect(oz).toBeCloseTo(0, 12);
    const [px] = transformPoint(child.transform.worldMatrix, 1, 0, 0);
    expect(px).toBeCloseTo(14, 12);
  });

  it("applies ancestor rotation to descendant translation", () => {
    const [parent, child] = chain(2);
    parent.transform.rotation.setFromAxisAngle(AXIS_Z, HALF_PI);
    child.transform.position.set(1, 0, 0);

    resolveWorldTransforms(parent);

    const [x, y, z] = transformPoint(child.transform.worldMatrix, 0, 0, 0);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
    expect(z).toBeCloseTo(0, 12);
  });

  it("matches a hand-multiplied product down a deep chain", () => {
    const nodes = chain(5);
    for (let i = 0; i < nodes.length; i += 1) {
      const t = nodes[i].transform;
      t.position.set(i + 1, -i, i * 0.5);
      t.rotation.setFromAxisAngle(AXIS_Z, HALF_PI / (i + 2));
      t.scale.set(1 + i * 0.25, 1 - i * 0.1, 1);
      t.pivot.set(i * 0.2, 0, 0);
    }

    resolveWorldTransforms(nodes[0]);

    for (const node of nodes) {
      expectElementsCloseTo(node.transform.worldMatrix, expectedWorld(node));
    }
  });

  it("writes into the existing world matrix instance", () => {
    const [parent, child] = chain(2);
    const matrix = child.transform.worldMatrix;
    const elements = matrix.elements;

    parent.transform.position.set(1, 2, 3);
    resolveWorldTransforms(parent);

    expect(child.transform.worldMatrix).toBe(matrix);
    expect(child.transform.worldMatrix.elements).toBe(elements);
    expect(elements[12]).toBeCloseTo(1, 12);
  });

  it("visits children depth-first in insertion order", () => {
    const root = group("root");
    const a = group("a");
    const b = group("b");
    root.add(a, b);
    a.add(group("a0"));

    const stats = resolveWorldTransforms(root);

    expect(stats.visited).toBe(4);
    expect(stats.recomputed).toBe(4);
  });
});

describe("resolveWorldTransforms — propagation", () => {
  it("propagates an ancestor move to every descendant", () => {
    const nodes = chain(4);
    for (const node of nodes) {
      node.transform.position.set(1, 0, 0);
    }
    resolveWorldTransforms(nodes[0]);

    nodes[0].transform.position.set(10, 5, 0);
    const stats = resolveWorldTransforms(nodes[0]);

    expect(stats.recomputed).toBe(4);
    for (const node of nodes) {
      expectElementsCloseTo(node.transform.worldMatrix, expectedWorld(node));
    }
    const [x, y] = transformPoint(nodes[3].transform.worldMatrix, 0, 0, 0);
    expect(x).toBeCloseTo(13, 12);
    expect(y).toBeCloseTo(5, 12);
  });

  it("leaves untouched sibling subtrees uncomputed", () => {
    const root = group("root");
    const left = group("left");
    const right = group("right");
    root.add(left, right);
    const leftChild = group("left-child");
    const rightChild = group("right-child");
    left.add(leftChild);
    right.add(rightChild);
    right.add(group("right-child-2"));

    const stats: WorldTransformStats = resolveWorldTransforms(root);
    expect(stats.visited).toBe(6);
    expect(stats.recomputed).toBe(6);

    const rightWorldVersion = right.transform.worldVersion;
    const rightChildWorldVersion = rightChild.transform.worldVersion;

    leftChild.transform.position.set(0, 3, 0);
    const second = resolveWorldTransforms(root, stats);

    expect(second).toBe(stats);
    expect(second.visited).toBe(6);
    expect(second.recomputed).toBe(1);
    expect(right.transform.worldVersion).toBe(rightWorldVersion);
    expect(rightChild.transform.worldVersion).toBe(rightChildWorldVersion);
    expectElementsCloseTo(
      leftChild.transform.worldMatrix,
      expectedWorld(leftChild),
    );
  });

  it("recomputes nothing when nothing changed", () => {
    const nodes = chain(3);
    resolveWorldTransforms(nodes[0]);

    const stats = resolveWorldTransforms(nodes[0]);

    expect(stats.visited).toBe(3);
    expect(stats.recomputed).toBe(0);
  });

  it("recomputes for a mutation made by method call and by markDirty alike", () => {
    const [parent, child] = chain(2);
    resolveWorldTransforms(parent);

    child.transform.position.set(1, 1, 1);
    expect(resolveWorldTransforms(parent).recomputed).toBe(1);

    child.transform.position.x = 7;
    expect(resolveWorldTransforms(parent).recomputed).toBe(0);

    child.transform.markDirty();
    expect(resolveWorldTransforms(parent).recomputed).toBe(1);
    expectElementsCloseTo(child.transform.worldMatrix, expectedWorld(child));
  });

  it("recomputes a reparented node even though no version changed", () => {
    const root = group("root");
    const a = group("a");
    const b = group("b");
    const moved = group("moved");
    root.add(a, b);
    a.transform.position.set(5, 0, 0);
    b.transform.position.set(-5, 0, 0);
    a.add(moved);
    resolveWorldTransforms(root);

    expect(transformPoint(moved.transform.worldMatrix, 0, 0, 0)[0]).toBeCloseTo(
      5,
      12,
    );

    b.add(moved);
    const stats = resolveWorldTransforms(root);

    expect(stats.recomputed).toBe(1);
    expect(transformPoint(moved.transform.worldMatrix, 0, 0, 0)[0]).toBeCloseTo(
      -5,
      12,
    );
  });
});

describe("resolveWorldTransforms — worldVersion", () => {
  it("advances only on recompute", () => {
    const [parent, child] = chain(2);

    expect(child.transform.worldVersion).toBe(0);
    resolveWorldTransforms(parent);
    const first = child.transform.worldVersion;
    expect(first).toBe(1);

    resolveWorldTransforms(parent);
    resolveWorldTransforms(parent);
    expect(child.transform.worldVersion).toBe(first);

    parent.transform.position.set(1, 0, 0);
    resolveWorldTransforms(parent);
    expect(child.transform.worldVersion).toBe(first + 1);
    expect(parent.transform.worldVersion).toBe(2);
  });
});

describe("resolveWorldTransforms — manual matrices (§7)", () => {
  it("resolves nodes whose local matrix is user-owned", () => {
    const [parent, child] = chain(2);
    parent.transform.position.set(0, 10, 0);

    const authored = new Matrix4().fromArray([
      2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 3, 0, 0, 1,
    ]);
    child.transform.matrixAutoUpdate = false;
    child.transform.setLocalMatrix(authored);

    const stats = resolveWorldTransforms(parent);

    expect(stats.recomputed).toBe(2);
    expectElementsCloseTo(child.transform.localMatrix, authored);
    expectElementsCloseTo(child.transform.worldMatrix, expectedWorld(child));
    const [x, y] = transformPoint(child.transform.worldMatrix, 1, 0, 0);
    expect(x).toBeCloseTo(5, 12);
    expect(y).toBeCloseTo(10, 12);
  });

  it("sees a direct elements write announced with markDirty", () => {
    const [parent, child] = chain(2);
    child.transform.matrixAutoUpdate = false;
    resolveWorldTransforms(parent);

    child.transform.localMatrix.elements[13] = 4;
    expect(resolveWorldTransforms(parent).recomputed).toBe(0);

    child.transform.markDirty();
    expect(resolveWorldTransforms(parent).recomputed).toBe(1);
    expect(transformPoint(child.transform.worldMatrix, 0, 0, 0)[1]).toBeCloseTo(
      4,
      12,
    );
  });
});

describe("resolveWorldTransform — on-demand query (§7)", () => {
  it("is correct mid-frame after a mutation, with no full pass", () => {
    const nodes = chain(4);
    resolveWorldTransforms(nodes[0]);

    nodes[1].transform.position.set(0, 6, 0);
    const world = resolveWorldTransform(nodes[3]);

    expectElementsCloseTo(world, expectedWorld(nodes[3]));
    expect(transformPoint(world, 0, 0, 0)[1]).toBeCloseTo(6, 12);
  });

  it("returns the node's own world matrix when no out is given", () => {
    const child = chain(2)[1];

    const world = resolveWorldTransform(child);

    expect(world).toBe(child.transform.worldMatrix);
  });

  it("copies into out and returns it when one is given", () => {
    const [parent, child] = chain(2);
    parent.transform.position.set(2, 0, 0);
    const out = new Matrix4();

    const result = resolveWorldTransform(child, out);

    expect(result).toBe(out);
    expectElementsCloseTo(out, expectedWorld(child));
    expect(out).not.toBe(child.transform.worldMatrix);
  });

  it("shares its caches with the full pass", () => {
    const nodes = chain(3);
    nodes[0].transform.position.set(1, 0, 0);

    resolveWorldTransform(nodes[2]);
    const stats = resolveWorldTransforms(nodes[0]);

    expect(stats.recomputed).toBe(0);
  });

  it("does not resolve the queried node's descendants", () => {
    const nodes = chain(3);
    resolveWorldTransforms(nodes[0]);
    nodes[0].transform.position.set(9, 0, 0);

    resolveWorldTransform(nodes[1]);

    expectElementsCloseTo(
      nodes[1].transform.worldMatrix,
      expectedWorld(nodes[1]),
    );
    expect(
      transformPoint(nodes[2].transform.worldMatrix, 0, 0, 0)[0],
    ).toBeCloseTo(0, 12);
  });
});

describe("resolveWorldTransforms — subtree entry point", () => {
  it("resolves the entry node's ancestors before its subtree", () => {
    const nodes = chain(3);
    resolveWorldTransforms(nodes[0]);
    nodes[0].transform.position.set(4, 0, 0);

    const stats = resolveWorldTransforms(nodes[1]);

    // The root is an ancestor of the entry node: visited and recomputed with it.
    expect(stats.visited).toBe(3);
    expect(stats.recomputed).toBe(3);
    for (const node of nodes) {
      expectElementsCloseTo(node.transform.worldMatrix, expectedWorld(node));
    }
  });
});

describe("resolveWorldTransforms — allocation (§7b)", () => {
  /** A 100-node tree: a root with nine branches of eleven nodes each. */
  function buildTree(): Group {
    const root = group("root");
    for (let branch = 0; branch < 9; branch += 1) {
      const nodes = chain(11);
      nodes[0].transform.position.set(branch, 1, 0);
      root.add(nodes[0]);
    }
    return root;
  }

  it("allocates no math objects in the steady state", () => {
    const root = buildTree();
    const stats: WorldTransformStats = { visited: 0, recomputed: 0 };

    // Warm-up: first pass composes every local matrix and fills every cache.
    resolveWorldTransforms(root, stats);
    expect(stats.visited).toBe(100);
    resolveWorldTransforms(root, stats);
    expect(stats.recomputed).toBe(0);

    resetConstructionCount();
    for (let i = 0; i < 1000; i += 1) {
      resolveWorldTransforms(root, stats);
    }

    expect(constructionCount()).toBe(0);
    expect(stats.visited).toBe(100);
    expect(stats.recomputed).toBe(0);
  });

  it("allocates no math objects while recomputing either", () => {
    const root = buildTree();
    const stats: WorldTransformStats = { visited: 0, recomputed: 0 };
    resolveWorldTransforms(root, stats);

    resetConstructionCount();
    for (let i = 0; i < 100; i += 1) {
      root.transform.position.set(i, 0, 0);
      resolveWorldTransforms(root, stats);
      resolveWorldTransform(root.children[0].children[0]);
    }

    expect(constructionCount()).toBe(0);
    expect(stats.recomputed).toBe(100);
  });

  it("allocates no math objects when the stats object is omitted", () => {
    const root = buildTree();
    resolveWorldTransforms(root);

    resetConstructionCount();
    const stats = resolveWorldTransforms(root);

    // The convenience stats object is a plain record, not a math type: the
    // math-allocation budget of §7b is untouched either way.
    expect(constructionCount()).toBe(0);
    expect(stats.recomputed).toBe(0);
  });
});
