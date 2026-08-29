/**
 * `Bone`, `Skeleton`, and `MorphWeights` (§54, §14, §17; RFC 0003 — gaps
 * PH-10 + R-22).
 *
 * The load-bearing claims: a bone is an ordinary node (no new mechanism
 * anywhere); the palette is `inverse(skinRootWorld) · boneWorld ·
 * inverseBind[i]` in insertion order (§33: the joint index is the ABI);
 * `update` writes only into `jointMatrices` (§42: the palette is never an
 * authority input); and every §85 refusal names its rule.
 */

import { isFourError } from "@four/core";
import { Matrix4, Vector3 } from "@four/math";
import { describe, expect, it } from "vitest";

import {
  Bone,
  Group,
  MORPH_WEIGHTS_SERIALIZER,
  MorphWeights,
  Node,
  Skeleton,
  resolveWorldTransforms,
} from "../src/index.js";

function codeOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return isFourError(error) ? error.code : error;
  }
  return undefined;
}

/** The identity, for palette comparisons. */
const IDENTITY = new Matrix4().elements;

/** One joint's 16 palette floats. */
function jointOf(skeleton: Skeleton, index: number): number[] {
  return Array.from(
    skeleton.jointMatrices.subarray(index * 16, index * 16 + 16),
  );
}

describe("Bone (§54)", () => {
  it("is an ordinary node: transform, hierarchy, authority — no new mechanism", () => {
    const bone = new Bone();
    expect(bone).toBeInstanceOf(Node);
    bone.transform.position.set(0, 1, 0);
    const child = new Bone();
    bone.add(child);
    expect(child.parent).toBe(bone);
    // §42 applies unchanged: a bone carries an authority like any node.
    bone.transformAuthority = "animation";
    expect(bone.transformAuthority).toBe("animation");
  });

  it("restores a saved id through the base constructor (§79)", () => {
    expect(new Bone({ id: "bone-restored" }).id).toBe("bone-restored");
  });
});

describe("Skeleton — construction (§85)", () => {
  it("refuses an empty rig", () => {
    expect(codeOf(() => new Skeleton([]))).toBe("INVALID_SCENE_GRAPH");
  });

  it("refuses a non-Bone entry", () => {
    const group = new Group();
    expect(codeOf(() => new Skeleton([group]))).toBe("INVALID_SCENE_GRAPH");
  });

  it("refuses a duplicate bone — two names for one joint index (§33)", () => {
    const bone = new Bone();
    expect(codeOf(() => new Skeleton([bone, bone]))).toBe(
      "INVALID_SCENE_GRAPH",
    );
  });

  it("refuses a mis-sized bind array and a non-finite element", () => {
    const bone = new Bone();
    expect(codeOf(() => new Skeleton([bone], new Float32Array(15)))).toBe(
      "INVALID_SCENE_GRAPH",
    );
    const binds = new Float32Array(16);
    binds[3] = Number.NaN;
    expect(codeOf(() => new Skeleton([bone], binds))).toBe(
      "INVALID_SCENE_GRAPH",
    );
  });

  it("defaults the binds to the identity per bone, and holds given binds by reference", () => {
    const a = new Bone();
    const b = new Bone();
    const defaulted = new Skeleton([a, b]);
    expect(Array.from(defaulted.inverseBindMatrices.subarray(0, 16))).toEqual(
      Array.from(IDENTITY),
    );
    expect(Array.from(defaulted.inverseBindMatrices.subarray(16))).toEqual(
      Array.from(IDENTITY),
    );

    const binds = new Float32Array(32);
    binds.set(IDENTITY, 0);
    binds.set(IDENTITY, 16);
    const explicit = new Skeleton([a, b], binds);
    expect(explicit.inverseBindMatrices).toBe(binds);
  });

  it("copies the bone array — later edits to the caller's array change nothing", () => {
    const a = new Bone();
    const bones = [a];
    const skeleton = new Skeleton(bones);
    bones.push(new Bone());
    expect(skeleton.bones).toHaveLength(1);
    expect(skeleton.jointCount).toBe(1);
  });

  it("starts its palette at the identity — a pre-update upload is the bind pose", () => {
    const skeleton = new Skeleton([new Bone(), new Bone()]);
    expect(jointOf(skeleton, 0)).toEqual(Array.from(IDENTITY));
    expect(jointOf(skeleton, 1)).toEqual(Array.from(IDENTITY));
  });
});

describe("Skeleton.update — the palette (§33, §42)", () => {
  it("is the identity for a rig at bind pose under identity binds", () => {
    const root = new Group();
    const bone = new Bone();
    root.add(bone);
    const skeleton = new Skeleton([bone]);
    resolveWorldTransforms(root);
    skeleton.update(root);
    expect(jointOf(skeleton, 0)).toEqual(Array.from(IDENTITY));
  });

  it("expresses each bone in the skin root's frame, in insertion order", () => {
    const root = new Group();
    root.transform.position.set(1, 0, 0);
    const hip = new Bone();
    hip.transform.position.set(0, 2, 0);
    const knee = new Bone();
    knee.transform.position.set(0, -1, 0);
    hip.add(knee);
    root.add(hip);
    const skeleton = new Skeleton([hip, knee]);
    resolveWorldTransforms(root);
    skeleton.update(root);

    // palette[0] = inv(T(1,0,0)) · T(1,2,0) = T(0,2,0)
    const first = jointOf(skeleton, 0);
    expect([first[12], first[13], first[14]]).toEqual([0, 2, 0]);
    // palette[1] = inv(T(1,0,0)) · T(1,1,0) = T(0,1,0)
    const second = jointOf(skeleton, 1);
    expect([second[12], second[13], second[14]]).toEqual([0, 1, 0]);
  });

  it("applies the inverse bind after the bone's world matrix", () => {
    const root = new Group();
    const bone = new Bone();
    bone.transform.position.set(0, 3, 0);
    root.add(bone);
    // Bind pose at y = 3: the bind matrix is inv(T(0,3,0)) = T(0,-3,0), so a
    // bone standing at its bind pose contributes the identity.
    const binds = new Float32Array(16);
    binds.set(new Matrix4().elements, 0);
    binds[13] = -3;
    const skeleton = new Skeleton([bone], binds);
    resolveWorldTransforms(root);
    skeleton.update(root);
    expect(jointOf(skeleton, 0)).toEqual(Array.from(IDENTITY));

    // Move the bone up one unit: the palette translates by exactly that.
    bone.transform.position.set(0, 4, 0);
    resolveWorldTransforms(root);
    skeleton.update(root);
    const moved = jointOf(skeleton, 0);
    expect([moved[12], moved[13], moved[14]]).toEqual([0, 1, 0]);
  });

  it("writes only into jointMatrices — no transform anywhere moves (§42)", () => {
    const root = new Group();
    const bone = new Bone();
    bone.transform.position.set(2, 0, 0);
    root.add(bone);
    const skeleton = new Skeleton([bone]);
    resolveWorldTransforms(root);
    const versionBefore = bone.transform.version;
    skeleton.update(root);
    expect(bone.transform.version).toBe(versionBefore);
    expect(bone.transform.position.equalsApprox(new Vector3(2, 0, 0), 0)).toBe(
      true,
    );
  });

  it("is deterministic: two updates over one pose are byte-identical (§33)", () => {
    const root = new Group();
    const a = new Bone();
    a.transform.position.set(0.1, 0.2, 0.3);
    a.transform.rotation.setFromAxisAngle(new Vector3(0, 0, 1), 0.5);
    const b = new Bone();
    b.transform.position.set(0, 1.5, 0);
    a.add(b);
    root.add(a);
    const skeleton = new Skeleton([a, b]);
    resolveWorldTransforms(root);
    skeleton.update(root);
    const first = Array.from(skeleton.jointMatrices);
    skeleton.update(root);
    expect(Array.from(skeleton.jointMatrices)).toEqual(first);
  });

  it("survives a singular skin root without throwing (§85, per-frame path)", () => {
    const root = new Group();
    root.transform.scale.set(0, 0, 0);
    const bone = new Bone();
    root.add(bone);
    const skeleton = new Skeleton([bone]);
    resolveWorldTransforms(root);
    expect(() => {
      skeleton.update(root);
    }).not.toThrow();
    // Finite arithmetic over a wrong matrix — never NaN from a throw path.
    for (const value of skeleton.jointMatrices) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe("MorphWeights (§54, §14; RFC 0003 §1c)", () => {
  it("builds zeroed weights from a count", () => {
    const weights = new MorphWeights(3);
    expect(Array.from(weights.weights)).toEqual([0, 0, 0]);
  });

  it("holds a Float32Array by reference and copies any other array", () => {
    const shared = new Float32Array([0.25, 0.75]);
    expect(new MorphWeights(shared).weights).toBe(shared);
    const copied = new MorphWeights([0.5, 0.5]);
    expect(Array.from(copied.weights)).toEqual([0.5, 0.5]);
  });

  it("attaches as a §6a component under its type name", () => {
    const node = new Group();
    const weights = node.addComponent(new MorphWeights(2));
    expect(MorphWeights.typeName).toBe("morph-weights");
    expect(node.getComponent(MorphWeights)).toBe(weights);
    expect(weights.host).toBe(node);
  });

  it("refuses a bad count, an empty array, and a non-finite weight (§85)", () => {
    expect(codeOf(() => new MorphWeights(0))).toBe("INVALID_SCENE_GRAPH");
    expect(codeOf(() => new MorphWeights(1.5))).toBe("INVALID_SCENE_GRAPH");
    expect(codeOf(() => new MorphWeights([]))).toBe("INVALID_SCENE_GRAPH");
    expect(codeOf(() => new MorphWeights([1, Number.NaN]))).toBe(
      "INVALID_SCENE_GRAPH",
    );
  });

  it("does not clamp — overshoot and negative targets are meaningful", () => {
    const weights = new MorphWeights([-0.5, 1.5]);
    expect(Array.from(weights.weights)).toEqual([-0.5, 1.5]);
  });
});

describe("MORPH_WEIGHTS_SERIALIZER (§79; the one-packet rule)", () => {
  it("round-trips the weights as plain numbers", () => {
    const source = new MorphWeights([0.25, 0.5, 0.75]);
    const payload = MORPH_WEIGHTS_SERIALIZER.serialize(source);
    expect(payload).toEqual({ weights: [0.25, 0.5, 0.75] });
    const restored = MORPH_WEIGHTS_SERIALIZER.deserialize(payload, null);
    expect(restored).toBeInstanceOf(MorphWeights);
    expect(Array.from(restored.weights)).toEqual([0.25, 0.5, 0.75]);
  });

  it("restores a usable single-weight component from a corrupt payload", () => {
    for (const payload of [
      null,
      42,
      [],
      { weights: [] },
      { weights: ["a"] },
      {},
    ]) {
      const restored = MORPH_WEIGHTS_SERIALIZER.deserialize(
        payload as never,
        null,
      );
      expect(Array.from(restored.weights)).toEqual([0]);
    }
  });

  it("lets the constructor's range refusal stand for a non-finite weight", () => {
    expect(
      codeOf(() =>
        MORPH_WEIGHTS_SERIALIZER.deserialize(
          { weights: [Number.POSITIVE_INFINITY] },
          null,
        ),
      ),
    ).toBe("INVALID_SCENE_GRAPH");
  });
});
