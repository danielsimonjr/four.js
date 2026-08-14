/**
 * What a rig aims at, and how a rig writes a world-space placement back onto a
 * node (§44, §12 — R-36's rig half, 2026-08-13).
 *
 * The three components this package's rigs are built from — `OrbitRig`,
 * `FollowRig`, `LookAtConstraint` — share exactly two mechanisms, and both live
 * here rather than being written three times:
 *
 * 1. **A target is a point or a node** ({@link RigTarget}). §44's rigs orbit a
 *    pivot, follow a character, and aim at a subject; sometimes that thing is a
 *    fixed place in the world and sometimes it is another node that moves. A
 *    `Vector3` is read as it stands, a `Node` is read through its resolved
 *    world matrix — so a rig tracks its target wherever the target's own owner
 *    (§42) has put it this step.
 * 2. **A rig computes a world position and a node stores a local one**
 *    ({@link placeAtWorldPosition}). Every rig here decides where its node
 *    belongs in *world* terms, because that is the frame a pivot, an offset and
 *    a spring are meaningful in; `Transform.position` is in the **parent's**
 *    frame. The conversion is the parent's inverse.
 *
 * ## Why the placement is written as a delta (decision, R-36 rig half)
 *
 * The obvious implementation — `position.set(parentInverse · P)` — is wrong for
 * any node with a non-zero `Transform.pivot`. `Matrix4.compose` folds the pivot
 * into the local matrix's translation column
 *
 * ```text
 * column = position + pivot − R·S·pivot
 * ```
 *
 * so a node's origin is at `position` only when its pivot is zero, while the
 * point every consumer means by "where the node is" — `Node.lookAt`'s eye,
 * `Camera.updateViewMatrix`'s eye, `getWorldDirection`'s origin — is the
 * translation column of the **world** matrix. Writing `position` directly would
 * place a pivoted node somewhere else by exactly `(I − R·S)·pivot`, silently.
 *
 * So the write is a delta instead: the desired local translation column is
 * compared with the current one and the difference is added to `position`. The
 * pivot term cancels because it does not depend on `position`, which makes the
 * placement exact for every pivot, every rotation and every scale, with no
 * pivot arithmetic anywhere in this file.
 *
 * A node whose `Transform.matrixAutoUpdate` is `false` owns its own local
 * matrix (§7) and is deliberately not supported: writing `position` there
 * changes nothing, so a rig cannot move it. That is the documented contract of
 * that flag, not a special case worth a branch on a per-step path.
 *
 * ## Singular parents (§85)
 *
 * A parent whose world matrix has zero determinant — a collapsed scale
 * somewhere up the chain — has no inverse, and `Matrix4.invert` documents that
 * it leaves such a matrix **unchanged** rather than throwing. Multiplying by
 * that would produce a plausible-looking wrong answer, so the determinant is
 * tested first and the placement is refused. A parent carrying `NaN` survives
 * that test (a `NaN` determinant is not `0`) and is caught by the finiteness
 * check on the result: a rig never writes a `NaN` transform, it declines and
 * says so through its own `skippedSteps` counter.
 *
 * ## Allocation (plan D7)
 *
 * One module-scope `Matrix4` holds the parent inverse, allocated at module load
 * and overwritten forever after; nothing here allocates per step. Safe as module
 * state for the same reason `Node.lookAt`'s scratch is: these functions are
 * synchronous, non-re-entrant, and fully write the scratch before reading it.
 */

import { Matrix4, Vector3 } from "@four/math";
import { resolveWorldTransform, type Node } from "@four/scene";

/**
 * What a rig tracks: a fixed world-space point, or a node whose world position
 * is read every step.
 *
 * A `Node` target is a **live reference**, so it is not scene document content —
 * §79 has no way to name it and the rig serializers drop it (see
 * `ORBIT_RIG_SERIALIZER`). A `Vector3` target is copied by no one: the rig holds
 * the instance you pass, so mutating it moves the rig, which is the cheap way to
 * drive a rig from application state without a node.
 */
export type RigTarget = Node | Vector3;

/** Parent world matrix, inverted in place. Module scratch — see the module note. */
const parentInverse = /* @__PURE__ */ new Matrix4();

/**
 * Reads `target`'s world position into `out`.
 *
 * @returns `false` when the position is not finite — a `Vector3` holding `NaN`,
 * or a node under a degenerate ancestor — in which case `out` holds whatever was
 * read and the caller must decline to write.
 */
export function resolveTargetPosition(
  target: RigTarget,
  out: Vector3,
): boolean {
  if (target instanceof Vector3) {
    out.copy(target);
  } else {
    // Column-major (§7b): elements 12–14 are the world translation column, the
    // same point `Node.lookAt` treats as the node's world position.
    const elements = resolveWorldTransform(target).elements;
    out.set(elements[12], elements[13], elements[14]);
  }
  return Number.isFinite(out.x + out.y + out.z);
}

/**
 * Reads `node`'s own world position into `out` and returns it.
 *
 * The same point {@link resolveTargetPosition} reads for a node target, so a rig
 * that smooths its way towards a goal compares like with like.
 */
export function worldPositionOf(node: Node, out: Vector3): Vector3 {
  const elements = resolveWorldTransform(node).elements;
  return out.set(elements[12], elements[13], elements[14]);
}

/**
 * Moves `node` so that its **world** origin lands on `(x, y, z)`, by writing its
 * local `Transform.position`.
 *
 * Ancestors are resolved on demand, so the placement is correct in the same step
 * a parent moved in; only `position` is written, so `Transform.version` bumps
 * exactly once (plan D3) and the rotation, scale and pivot are left alone.
 *
 * @returns `true` when the node was placed, `false` when the placement was
 * refused because the parent's world matrix is singular or the resulting local
 * position would not be finite (see the module note). Nothing is written on a
 * refusal.
 */
export function placeAtWorldPosition(
  node: Node,
  x: number,
  y: number,
  z: number,
): boolean {
  const transform = node.transform;
  const parent = node.parent;
  let localX = x;
  let localY = y;
  let localZ = z;
  if (parent !== null) {
    parentInverse.copy(resolveWorldTransform(parent));
    if (parentInverse.determinant() === 0) {
      return false;
    }
    parentInverse.invert();
    const e = parentInverse.elements;
    localX = e[0] * x + e[4] * y + e[8] * z + e[12];
    localY = e[1] * x + e[5] * y + e[9] * z + e[13];
    localZ = e[2] * x + e[6] * y + e[10] * z + e[14];
  }

  // The current local translation column, against which the delta is taken.
  // `updateLocalMatrix` recomposes only when the transform changed since the
  // last composition, so this is a version comparison on a settled node.
  transform.updateLocalMatrix();
  const column = transform.localMatrix.elements;
  const position = transform.position;
  const nextX = position.x + (localX - column[12]);
  const nextY = position.y + (localY - column[13]);
  const nextZ = position.z + (localZ - column[14]);
  if (!Number.isFinite(nextX + nextY + nextZ)) {
    return false;
  }
  position.set(nextX, nextY, nextZ);
  return true;
}
