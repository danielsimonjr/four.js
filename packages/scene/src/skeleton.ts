/**
 * Bones, skeletons, and morph weights (§54, §14, §17; RFC 0003 — gaps PH-10 +
 * R-22, 2026-08-28).
 *
 * ## A bone is a scene-graph node, not a parallel hierarchy (RFC 0003 §1b)
 *
 * {@link Bone} is a {@link Node}. That single decision is what makes the whole
 * skeletal tier arrive with **no new mechanism**: a bone already has a
 * `Transform`, already resolves through `resolveWorldTransform`, already
 * carries `transformAuthority` (§42), already participates in §19's
 * `"blended"` physics-animation pipeline, is already a legal target for
 * `@four/motion`'s two-bone IK, already serializes as a node type (§79), and is
 * already animatable by everything `@four/animation` ships. The recorded cost —
 * a 60-bone rig is 60 more nodes resolved per frame — is stated in RFC 0003's
 * Consequences, with the measurement that keeps the alternative (a private
 * transform array) honest filed beside it.
 *
 * ## The engine imposes NO bone-axis convention (RFC 0003 open question 1,
 * adopted)
 *
 * A bone's local frame is arbitrary: the inverse bind matrix absorbs whatever
 * convention the authoring tool used, so the *data model* needs no axis. **+Y
 * as the bone's length axis is a helper convention only** — for future
 * procedural-rig, look-down-a-bone, and angle-producing IK helpers, matching
 * §7a's Y-up world — and never a format requirement. `@four/motion`'s
 * `solveTwoBoneIK` returns positions rather than angles for exactly this
 * reason, and stays correct as written.
 *
 * ## Determinism (§33, RFC 0003 §6)
 *
 * {@link Skeleton.update} is CPU arithmetic over the bones in **insertion
 * order** — the joint index *is* the order, and the `bones` array is the ABI —
 * with matrix products in one fixed association order and no `Map`/`Set`
 * enumeration anywhere. Skeletal animation therefore sits inside the existing
 * §33 envelope. The **vertex deformation** happens in a GPU vertex stage and
 * sits outside it by construction: the palette goes to the GPU and nothing
 * comes back — no engine API returns skinned vertex positions, and §33's
 * checksum (bodies, not vertices) is untouched.
 *
 * ## Morph weights are a component, not a `Mesh` field (RFC 0003 §1c)
 *
 * §54 declares `morphTargetWeights` on `Mesh`, which lives in `@four/render` —
 * a package `@four/animation` may never see under the frozen §3.1 matrix, so
 * §14's required morph-target animation had no legal way to bind the field.
 * {@link MorphWeights} is the resolution the specification records in §54
 * (revision 1.8): the storage is a §6a component here in `@four/scene`, the
 * animation system reaches it through `node.getComponent(MorphWeights)` (or a
 * `Mesh`'s `morphTargetWeights` accessor over it, which keeps §54's spelling),
 * and the renderer snapshots the same array onto the render item.
 */

import {
  FourError,
  type Component,
  type ComponentHost,
  type JsonValue,
} from "@four/core";
import { Matrix4 } from "@four/math";

import { Node } from "./node.js";
import { resolveWorldTransform } from "./world-transforms.js";

/**
 * One joint of a skeleton (§54; RFC 0003).
 *
 * A concrete {@link Node} with no behavior of its own, exactly as `Group` is —
 * the class exists so that a rig's joints are *identifiable* (a §79 document
 * names them `scene:bone`, a debug-draw overlay can find them, and a
 * {@link Skeleton} can refuse a node that is not one) while everything a bone
 * *does* comes from being a node.
 *
 * Deliberately carries **no `static typeName`**, deviating from RFC 0003's
 * sketch: that key is §6a's *component* key (plan D2), the umbrella package's
 * registry-completeness test enumerates every exported class carrying one and
 * requires a component serializer for it, and a bone is a node, not a
 * component. Its §79 identity is the registered node type `"scene:bone"`,
 * matched by constructor identity like every other node class (see
 * `packages/four/src/scene-serializers.ts`).
 *
 * No bone-axis convention is imposed — see the module header.
 */
export class Bone extends Node {}

/** 16 floats — one column-major `Matrix4` — per bone (§7b). */
const FLOATS_PER_JOINT = 16;

/** Scratch for {@link Skeleton.update}; module-level per §7b, plan D7. */
const rootInverseScratch = /* @__PURE__ */ new Matrix4();
const jointScratch = /* @__PURE__ */ new Matrix4();
const bindScratch = /* @__PURE__ */ new Matrix4();

/** Throws the §85 refusal every malformed skeleton shares. */
function invalidSkeleton(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_SCENE_GRAPH", message, { context });
}

/**
 * A rig: an ordered set of {@link Bone}s, their inverse bind matrices, and the
 * joint-matrix palette derived from them every frame (§54; RFC 0003 §1b).
 *
 * ```ts
 * const root = new Bone();
 * const tip = new Bone();
 * tip.transform.position.set(0, 1, 0);
 * root.add(tip);
 *
 * const skeleton = new Skeleton([root, tip], inverseBindMatrices);
 * mesh.skeleton = skeleton;              // @four/render's Mesh (§54)
 * // per frame, after transform resolution (the render list does this):
 * skeleton.update(mesh);
 * upload(skeleton.jointMatrices);
 * ```
 *
 * ## Joint index = position in {@link Skeleton.bones} — the ABI (§33)
 *
 * A geometry's `joints` attribute indexes this array, a §17 skeletal-joint
 * track addresses a bone as `bones.<i>.transform.<channel>`, and
 * {@link Skeleton.update} walks it in insertion order. Reordering the array is
 * therefore re-skinning the mesh; the array is `readonly` so it cannot happen
 * by accident.
 *
 * ## The palette is derived state, never an authority input (§42; RFC 0003 §4)
 *
 * `update` reads bone world matrices *after* transform resolution and writes
 * only into {@link Skeleton.jointMatrices}; nothing reads the palette back
 * into a transform. This is §43's "render interpolation never feeds back into
 * physics state" applied one level down, and it is what keeps a ragdoll's §19
 * `"blended"` bones ordinary nodes with ordinary authorities.
 *
 * ## Not a `Node`, not a component
 *
 * A skeleton is shared state *about* nodes — several meshes may skin against
 * one rig — so it is a plain object referenced by `Mesh.skeleton` (§54),
 * exactly as a `BufferGeometry` is referenced by `Renderable.geometry`. In a
 * §79 document it is written inline on the mesh as bone **ids** plus the
 * inverse bind matrices (intra-file references are by id, §79), and resolved
 * against the reloaded bones on first read — see `@four/render`'s `Mesh`.
 */
export class Skeleton {
  /**
   * The joints, in joint-index order. Insertion order is the ABI (§33): entry
   * `i` is what `joints[4 * v + k] === i` refers to, for every vertex `v`.
   */
  readonly bones: readonly Bone[];

  /**
   * One column-major inverse bind matrix per bone — 16 floats each,
   * index-parallel with {@link Skeleton.bones}. Bind-pose data authored with
   * the rig; the engine never writes into it. Defaults to the identity per
   * bone, which is correct for a rig whose bind pose *is* the rest pose of its
   * nodes expressed in the skin root's frame.
   */
  readonly inverseBindMatrices: Float32Array;

  /**
   * The palette: 16 floats per bone, rewritten in place by every
   * {@link Skeleton.update}. `palette[i] = inverse(skinRootWorld) ·
   * bones[i].worldMatrix · inverseBind[i]` — exactly what a skinned vertex
   * stage consumes, in the layout `uniformMatrix4fv` uploads.
   *
   * Identity per bone until the first `update`, so a palette uploaded before
   * one draws the bind pose rather than garbage.
   */
  readonly jointMatrices: Float32Array;

  /**
   * Builds a skeleton over `bones` (§85-validated: non-empty, no duplicate
   * bone, every entry a {@link Bone}) with `inverseBindMatrices` (16 finite
   * floats per bone; identity per bone when omitted).
   *
   * The bone array is copied (so later edits to the caller's array cannot
   * silently re-skin a mesh); the matrices are held **by reference**, like
   * geometry attributes — they are bind-pose data a loader hands over whole.
   *
   * @throws FourError `INVALID_SCENE_GRAPH` (§85) for an empty rig, a
   * duplicate bone, a non-`Bone` entry, a mis-sized matrix array, or a
   * non-finite matrix element.
   */
  constructor(bones: readonly Bone[], inverseBindMatrices?: Float32Array) {
    if (bones.length === 0) {
      invalidSkeleton("A Skeleton needs at least one bone (§54, §85).", {
        bones: 0,
      });
    }
    for (let i = 0; i < bones.length; i += 1) {
      if (!(bones[i] instanceof Bone)) {
        invalidSkeleton(
          `Skeleton bone ${String(i)} is not a Bone node; joints index bones ` +
            "and only bones (§54, §85).",
          { index: i },
        );
      }
      if (bones.indexOf(bones[i]) !== i) {
        invalidSkeleton(
          `Skeleton bone ${String(i)} appears twice; the joint index is the ` +
            "position in the bones array, so a duplicate is two names for " +
            "one joint (§33, §85).",
          { index: i, bone: bones[i].id },
        );
      }
    }

    const expected = bones.length * FLOATS_PER_JOINT;
    let binds: Float32Array;
    if (inverseBindMatrices === undefined) {
      binds = new Float32Array(expected);
      for (let i = 0; i < bones.length; i += 1) {
        const base = i * FLOATS_PER_JOINT;
        binds[base] = 1;
        binds[base + 5] = 1;
        binds[base + 10] = 1;
        binds[base + 15] = 1;
      }
    } else {
      if (inverseBindMatrices.length !== expected) {
        invalidSkeleton(
          `Skeleton inverseBindMatrices must carry 16 floats per bone — ` +
            `${String(expected)} for ${String(bones.length)} bones; got ` +
            `${String(inverseBindMatrices.length)} (§54, §85).`,
          { bones: bones.length, length: inverseBindMatrices.length },
        );
      }
      for (let i = 0; i < inverseBindMatrices.length; i += 1) {
        if (!Number.isFinite(inverseBindMatrices[i])) {
          invalidSkeleton(
            `Skeleton inverseBindMatrices[${String(i)}] is ` +
              `${String(inverseBindMatrices[i])}; bind matrices must be ` +
              "finite (§85: NaN and infinite values).",
            { index: i },
          );
        }
      }
      binds = inverseBindMatrices;
    }

    this.bones = [...bones];
    this.inverseBindMatrices = binds;
    const palette = new Float32Array(expected);
    for (let i = 0; i < bones.length; i += 1) {
      const base = i * FLOATS_PER_JOINT;
      palette[base] = 1;
      palette[base + 5] = 1;
      palette[base + 10] = 1;
      palette[base + 15] = 1;
    }
    this.jointMatrices = palette;
  }

  /** Number of joints — `bones.length`, named for the palette's consumers. */
  get jointCount(): number {
    return this.bones.length;
  }

  /**
   * Rewrites {@link Skeleton.jointMatrices} from the bones' current world
   * matrices, relative to `skinRoot` — the mesh node whose `worldMatrix` the
   * vertex stage applies *after* the palette, so the palette must be expressed
   * in its frame:
   *
   * ```text
   * palette[i] = inverse(skinRootWorld) · bones[i].worldMatrix · inverseBind[i]
   * ```
   *
   * Deterministic (§33): bones are visited in insertion order, the two
   * products associate left-to-right, and world matrices come from the same
   * `resolveWorldTransform` every other node uses — version-cached, so after
   * the frame's resolve pass each read is a few comparisons. Allocates
   * nothing (§7b: module scratch).
   *
   * Degenerate input follows the engine's transform policy rather than
   * throwing on a per-frame path (§85, `Matrix4.invert`): a `skinRoot` whose
   * world matrix is exactly singular (a zero scale somewhere up its chain) has
   * no inverse, `invert()` leaves its input unchanged, and the palette that
   * frame is well-defined arithmetic over a wrong matrix — finite, visible,
   * and gone the moment the scale is. Nothing is written anywhere else.
   */
  update(skinRoot: Node): void {
    const bones = this.bones;
    const binds = this.inverseBindMatrices;
    const palette = this.jointMatrices;
    rootInverseScratch.copy(resolveWorldTransform(skinRoot)).invert();
    for (let i = 0; i < bones.length; i += 1) {
      const base = i * FLOATS_PER_JOINT;
      jointScratch
        .copy(rootInverseScratch)
        .multiply(resolveWorldTransform(bones[i]))
        .multiply(bindScratch.fromArray(binds, base));
      const elements = jointScratch.elements;
      for (let k = 0; k < FLOATS_PER_JOINT; k += 1) {
        palette[base + k] = elements[k];
      }
    }
  }
}

/**
 * Per-node morph-target weights (§54, §14, §17; RFC 0003 §1c) — the storage
 * behind `Mesh.morphTargetWeights`, placed where the frozen §3.1 matrix lets
 * `@four/animation` bind it.
 *
 * ```ts
 * const weights = mesh.addComponent(new MorphWeights(2)); // two targets, at 0
 * weights.weights[0] = 0.5;                               // authored write
 *
 * // §17's morph-weight track is a number track over one element (see
 * // @four/animation's binding.ts — "weights.0" addresses weights[0]):
 * new AnimationTrack({ path: "weights.0", adapter: numberAdapter, ... });
 * ```
 *
 * One per node (§6a). Holds authored state only: which morph target the
 * weights *mean* is the geometry's business (the GPU morph path — additional
 * vertex streams — is deferred by RFC 0003 §7 and staged in `@four/render`'s
 * `Mesh`; this component, the binding form, and the render-item snapshot are
 * the plumbing that ships now, so §14's morph-target animation is expressible
 * and a document can carry the weights).
 *
 * Weights are **not clamped**: §17's tracks legitimately overshoot (cubic
 * anticipation), and morph weights outside 0…1 are meaningful (overdrive,
 * negative targets). §85 checks finiteness at construction; in-place writes
 * are the fast path and are not re-validated, exactly as geometry attributes
 * are not.
 */
export class MorphWeights implements Component {
  /** Component key (plan D2) and §79 serialization name. */
  static readonly typeName = "morph-weights";

  /**
   * The node this component is attached to, or `null`. Written by the
   * `ComponentRegistry` alone (§6a); never assign it.
   */
  host: ComponentHost | null = null;

  /**
   * One weight per morph target, index-parallel with the geometry's (future)
   * target streams. Held by reference and written in place — by the
   * application, or by a §17 morph-weight track bound to one element — so the
   * render list can snapshot the array itself onto the render item with no
   * copy.
   */
  readonly weights: Float32Array;

  /**
   * Builds the component with `count` zero weights, or over `weights` —
   * a `Float32Array` is held **by reference** (the caller may already share it
   * with a loader), any other array-like is copied.
   *
   * @throws FourError `INVALID_SCENE_GRAPH` (§85) for a count that is not a
   * positive integer, an empty array, or a non-finite weight.
   */
  constructor(weights: number | Float32Array | readonly number[]) {
    if (typeof weights === "number") {
      if (!Number.isInteger(weights) || weights < 1) {
        throw new FourError(
          "INVALID_SCENE_GRAPH",
          `MorphWeights needs a positive integer target count; got ` +
            `${String(weights)} (§54, §85).`,
          { context: { count: weights } },
        );
      }
      this.weights = new Float32Array(weights);
      return;
    }
    if (weights.length === 0) {
      throw new FourError(
        "INVALID_SCENE_GRAPH",
        "MorphWeights needs at least one weight; a mesh with no morph " +
          "targets carries no component (§54, §85).",
        { context: { length: 0 } },
      );
    }
    for (let i = 0; i < weights.length; i += 1) {
      if (!Number.isFinite(weights[i])) {
        throw new FourError(
          "INVALID_SCENE_GRAPH",
          `MorphWeights weight ${String(i)} is ${String(weights[i])}; ` +
            "weights must be finite (§85: NaN and infinite values).",
          { context: { index: i } },
        );
      }
    }
    this.weights =
      weights instanceof Float32Array ? weights : new Float32Array(weights);
  }
}

/**
 * The structural shape of `@four/serialization`'s `ComponentSerializer<T>` —
 * declared here rather than imported because the frozen §3.1 matrix has no
 * scene → serialization edge (that package sits *above* this one). The same
 * documented duck-typing move `@four/motion`'s serializers make, with the same
 * honest cost: nothing type-checks the two declarations against each other
 * beyond the umbrella's registration call.
 */
export interface MorphWeightsSerializerShape<T> {
  /** Produces the component's payload; must be representable JSON. */
  serialize(component: T): JsonValue;
  /** Rebuilds the component from a payload. Attaching is the caller's job. */
  deserialize(data: JsonValue, node: unknown): T;
}

/**
 * The §79 serializer for {@link MorphWeights} (RFC 0003; the one-packet rule:
 * component and serializer land together).
 *
 * The payload is the weights array as plain numbers — the whole of the
 * component's state. Reading is total for shape (a missing or malformed
 * payload restores a single zero weight — a usable component — rather than
 * failing the scene) and refusing for range: a well-formed array carrying a
 * non-finite weight is refused by the constructor's §85 check, which is
 * allowed to stand, exactly as the motion rigs' serializers document.
 */
export const MORPH_WEIGHTS_SERIALIZER: MorphWeightsSerializerShape<MorphWeights> =
  {
    serialize(component: MorphWeights): JsonValue {
      return { weights: Array.from(component.weights) };
    },
    deserialize(data: JsonValue): MorphWeights {
      const record =
        typeof data === "object" && data !== null && !Array.isArray(data)
          ? (data as { readonly weights?: JsonValue })
          : {};
      const weights = record.weights;
      if (
        Array.isArray(weights) &&
        weights.length > 0 &&
        weights.every((value) => typeof value === "number")
      ) {
        return new MorphWeights(weights);
      }
      return new MorphWeights(1);
    },
  };
