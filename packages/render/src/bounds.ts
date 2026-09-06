/**
 * World-space bounds of a drawable (§87) — the substrate a frustum test needs.
 *
 * §87 asks for spatial indexing and culling and lists the structures a renderer
 * *may* maintain; §53 gives every geometry a local axis-aligned box, computed
 * once and cached against the geometry's version. Neither of them crosses the
 * gap between the two, and that gap is the whole reason culling did not exist
 * before this module: a frustum lives in world space and a geometry's box does
 * not.
 *
 * This module is that one step — local box in, world sphere out — and nothing
 * else. It builds no tree, keeps no per-node cache, and is not a system. §87 is
 * explicit that "the public scene graph must not be forced to mirror a spatial
 * tree", and the honest reading of that for a first culling tier is a **linear
 * scan with an O(1) per-item test**: an index earns its keeping cost only once
 * the scan is the profile's answer, and `benchmarks/render-batching.mjs` says
 * the frame's cost today is list *construction*, not list traversal.
 *
 * ## Why a sphere and not a box
 *
 * The world bound of a rotated local box is not a box — it has to be re-derived
 * from the eight corners whenever the node turns, and then stored per node and
 * invalidated per transform change. A sphere is rotation-invariant: its centre
 * is one point transform and its radius is a scalar that depends only on the
 * matrix's scale part, so the derivation is a fixed handful of arithmetic with
 * nothing to cache and nothing to invalidate. See `@four/math`'s `Frustum` for
 * the same trade seen from the test's side.
 *
 * The radius is deliberately **the circumradius of the world-space AABB of the
 * transformed local box**, not the local circumradius times a scale factor. The
 * cheap version is wrong: the largest singular value of a matrix can exceed
 * every one of its column norms, so scaling by the longest column can produce a
 * sphere that is too *small* — and a bound that is too small culls something
 * the camera can see. The absolute-value transform used below is conservative
 * by construction (see {@link computeWorldBoundingSphere}).
 *
 * ## Determinism (§33)
 *
 * **`same-runtime`**: the radius needs one `Math.sqrt`. As with `Frustum`, the
 * value never reaches a solver, a checksum, or a snapshot — it decides whether
 * a draw is submitted, and §33's tiers are defined over the simulation.
 */

import type { BufferGeometry } from "@four/geometry";
import type { Matrix4, Vector3 } from "@four/math";

/**
 * A sphere in world space: everything a frustum test needs about an item.
 *
 * A record with a caller-owned `center` rather than a class, because the only
 * producer is {@link computeWorldBoundingSphere} and the only consumer is
 * `Frustum.intersectsSphere` — a class would add a constructor, a barrel entry,
 * and a second name for `Vector3` plus a number, and give nothing back. The
 * caller allocates one and reuses it, which is how the per-view cull allocates
 * nothing per item (§7b, plan D7).
 */
export interface BoundingSphere {
  /** Centre in world space; written in place by the producer. */
  readonly center: Vector3;
  /** Radius in world units; `0` for a point-sized geometry. */
  radius: number;
}

/**
 * Writes the world-space bounding sphere of `geometry` under `worldMatrix` into
 * `out`, and returns whether the result is usable.
 *
 * ```ts
 * if (computeWorldBoundingSphere(item.geometry, item.worldMatrix, sphere)) {
 *   if (!frustum.intersectsSphere(sphere.center, sphere.radius)) continue;
 * }
 * ```
 *
 * The derivation, in one line each:
 *
 * 1. §53's cached local box gives a centre `c` and half-extents `e`;
 * 2. the world centre is `worldMatrix · c` — an ordinary point transform;
 * 3. the world AABB's half-extents are `|M| · e`, the matrix with every element
 *    replaced by its absolute value applied to the half-extent vector. This is
 *    the standard conservative box transform: every corner of the local box
 *    lands inside that world box, whatever the rotation, shear, or non-uniform
 *    scale;
 * 4. the radius is the length of those half-extents — the circumradius of the
 *    world box, hence a sphere containing it, hence a sphere containing the
 *    geometry.
 *
 * Every step is conservative in the same direction, so the result is never too
 * small. It can be loose: a long thin rotated box gets the sphere around its
 * axis-aligned envelope rather than around itself. That costs draws, never
 * pixels — see `Frustum`'s note on which direction of error is a bug.
 *
 * ## When it returns `false`
 *
 * Three cases, and all three mean the same thing to a caller: **draw the item**.
 *
 * - **The geometry cannot state its bounds.** `computeBounds` is probed rather
 *   than called, because `RenderItem.geometry` is reached by a backend that may
 *   have been handed a structurally-typed geometry — a host's own minimal
 *   object, a test double written before §87 existed. That is the same defence
 *   `render-list.ts` makes for `layers`, `transparent`, and the shadow flags,
 *   with a sharper failure mode if it were omitted: a missing method is a
 *   `TypeError` inside a frame, which §61 forbids.
 * - **The geometry is empty.** §53 returns `min = +Infinity`, `max = -Infinity`
 *   for a geometry with no vertices — the identity element of bounds union —
 *   and the centre of that box is `NaN`. An empty geometry draws nothing
 *   anyway, so refusing to bound it costs a test and not a draw.
 * - **The matrix or the bounds carry non-finite numbers.** A `NaN` in a world
 *   matrix is an authoring bug somewhere upstream; hiding the object it belongs
 *   to would hide the bug behind a symptom that looks like a culling defect.
 *
 * `out` is left in an unspecified state when this returns `false` — the caller
 * has been told not to read it.
 *
 * @param geometry the item's vertex data (§53). Read, never written.
 * @param worldMatrix the item's resolved world transform (§7), or its §43
 * interpolated render pose — whichever the render item carries.
 * @param out rewritten in place; supply one per call site and reuse it.
 */
export function computeWorldBoundingSphere(
  geometry: BufferGeometry,
  worldMatrix: Matrix4,
  out: BoundingSphere,
): boolean {
  // Probed, not bound: see the doc comment. A `Partial` read rather than a cast
  // to `unknown`, so the probe still type-checks against the real class — and a
  // bare `typeof` rather than an optional call, because binding or optional-
  // chaining a method allocates a closure per item per view per frame, which is
  // exactly what the pooled render item exists to avoid (plan D7).
  if (
    typeof (geometry as Partial<BufferGeometry>).computeBounds !== "function"
  ) {
    return false;
  }
  const bounds = geometry.computeBounds();
  return computeWorldBoundingSphereFromBox(
    bounds.min,
    bounds.max,
    worldMatrix,
    out,
  );
}

/**
 * The box half of {@link computeWorldBoundingSphere}: local AABB + world
 * matrix → world sphere. Used by particle drawables that publish a box
 * without a {@link BufferGeometry}.
 */
export function computeWorldBoundingSphereFromBox(
  min: Vector3,
  max: Vector3,
  worldMatrix: Matrix4,
  out: BoundingSphere,
): boolean {
  const halfX = (max.x - min.x) * 0.5;
  const halfY = (max.y - min.y) * 0.5;
  const halfZ = (max.z - min.z) * 0.5;
  const localX = min.x + halfX;
  const localY = min.y + halfY;
  const localZ = min.z + halfZ;

  const e = worldMatrix.elements;
  const centerX = e[0] * localX + e[4] * localY + e[8] * localZ + e[12];
  const centerY = e[1] * localX + e[5] * localY + e[9] * localZ + e[13];
  const centerZ = e[2] * localX + e[6] * localY + e[10] * localZ + e[14];

  // |M| · e — the conservative world-space half-extents (step 3 above).
  const worldX =
    Math.abs(e[0]) * halfX + Math.abs(e[4]) * halfY + Math.abs(e[8]) * halfZ;
  const worldY =
    Math.abs(e[1]) * halfX + Math.abs(e[5]) * halfY + Math.abs(e[9]) * halfZ;
  const worldZ =
    Math.abs(e[2]) * halfX + Math.abs(e[6]) * halfY + Math.abs(e[10]) * halfZ;
  const radius = Math.sqrt(worldX * worldX + worldY * worldY + worldZ * worldZ);

  // One finiteness gate for all three failure modes: an empty box makes the
  // centre `NaN`, a `NaN` matrix propagates into both, and an infinite extent
  // makes the radius infinite. `Number.isFinite` is false for each.
  if (
    !Number.isFinite(centerX) ||
    !Number.isFinite(centerY) ||
    !Number.isFinite(centerZ) ||
    !Number.isFinite(radius)
  ) {
    return false;
  }

  out.center.set(centerX, centerY, centerZ);
  out.radius = radius;
  return true;
}
