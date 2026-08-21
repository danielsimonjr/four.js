/**
 * §53's `Geometry` base and its `BoundingVolume` — the two declarations the
 * geometry package had transcribed into prose but never into types (R-21).
 *
 * §53 spells the family's root exactly once:
 *
 * ```ts
 * abstract class Geometry implements Disposable {
 *   readonly id: string;
 *   version: number;
 *   bounds: BoundingVolume;
 *   computeBounds(): void;
 *   clone(): Geometry;
 *   dispose(): void;
 * }
 * ```
 *
 * Everything in that declaration ships here, at the one tier this repository can
 * defend today, and nothing else does. The three judgements worth stating up
 * front, because each of them could reasonably have gone the other way:
 *
 * ## 1. A base with one concrete member is still worth having
 *
 * {@link BufferGeometry} is currently §53's only concrete member — the rest of
 * the tree (`Geometry2D`, `PathGeometry2D`, `FillGeometry2D`,
 * `StrokeGeometry2D`, `Geometry3D`, `IndexedGeometry`, `ProceduralGeometry`)
 * is **deliberately staged**, with the same reason the 2026-08-02 header of
 * `buffer-geometry.ts` gave: each of those names pins a public attribute layout
 * that the WebGL backend and the §79 scene format both have to agree with, and
 * none of them is needed to draw a textured box. Shipping seven empty subclasses
 * to make a diagram true would be the lie that header refused.
 *
 * What the base *does* pay for immediately is **identity**. §33 forbids random
 * or clock-derived ids, so every geometry has to draw from one monotonic
 * process-wide counter; with the counter in the base, a second concrete
 * geometry cannot start its own numbering by accident, and `clone()` — the one
 * operation that must produce a *new* id rather than copy one — has exactly one
 * place to get it from. The base is where the id rule lives, not a shape for
 * its own sake.
 *
 * ## 2. `bounds` is a property *and* `computeBounds()` returns it
 *
 * §53 declares both a `bounds` field and a `computeBounds(): void` that fills
 * it. What shipped in 2026-08-02 was neither: a `computeBounds()` that
 * *returned* the box, with the field omitted because "the volume hierarchy
 * belongs to the culling packet (§87)". §87 has since landed
 * (`@four/render`'s `computeWorldBoundingSphere`, 2026-08-09) and answered that
 * question in the other direction — it derives the world sphere culling wants
 * from the local **box**, and therefore needs the box to stay exactly what it
 * is. So this packet does not replace the box; it *names* it.
 *
 * {@link Geometry.bounds} is a getter that computes on demand and returns the
 * same object `computeBounds()` returns. Both spellings are live, neither is
 * deprecated, and `computeBounds()` keeps its return value — a method whose
 * declared type is `void` may return something, and every existing caller
 * (`render/bounds.ts`, `render/batch.ts`, `input/pick.ts`,
 * `render-webgl/webgl-renderer.ts`) reads that return value. Narrowing it to
 * `void` to match the letter of §53 would break four packages to gain nothing.
 *
 * ## 3. What a `BoundingVolume` is
 *
 * §53 names the type and never defines it. The definition here is the smallest
 * one that is *true of every geometry* and that no consumer has to re-derive:
 * **the local axis-aligned box, plus the sphere circumscribing that box**
 * ({@link BoundingVolume}). Not a tagged union of shapes, not a hierarchy:
 *
 * - a union would make every consumer branch, and there is exactly one producer
 *   (a vertex scan) which can only produce a box;
 * - the sphere is not a second, competing volume — it is one square root away
 *   from the box, it is what a frustum test consumes, and computing it here
 *   means the six-plane test never has to know how the box was found;
 * - `BoundingVolume` is a **superset of the old `GeometryBounds`** (which
 *   remains exported, as an alias), so every existing reader of `.min`/`.max`
 *   keeps working unchanged and byte-for-byte — including
 *   `computeWorldBoundingSphere`, which deliberately keeps deriving its
 *   *world* sphere from the box rather than transforming this *local* sphere:
 *   transforming a sphere by a non-uniform scale gives a looser bound than
 *   transforming the box does, and that module's own header explains why the
 *   loose direction costs draws.
 *
 * Hierarchical volumes (§53's tree, §87's spatial index) stay out. A per-node
 * BVH is a structure with build, refit, and invalidation policies; it is not a
 * field on a geometry, and §87 is explicit that "the public scene graph must not
 * be forced to mirror a spatial tree".
 *
 * ## Determinism (§33)
 *
 * `same-runtime` for {@link BoundingVolume.radius} — one `Math.sqrt`, whose
 * result is exactly specified by IEEE-754 but which this repository's tiering
 * discipline keeps at `same-runtime` because nothing forces a platform to use
 * the correctly-rounded operation. The box itself (`min`, `max`) is
 * `cross-platform`: comparisons and stores only. Neither value reaches a
 * solver, a checksum, or a snapshot.
 */

import type { Disposable } from "@four/core";
import type { Vector3 } from "@four/math";

/**
 * §53's `BoundingVolume`: a geometry's extent in its own local space, as both
 * an axis-aligned box and the sphere that circumscribes it.
 *
 * ```ts
 * const volume = geometry.bounds;
 * volume.min;     // lowest corner
 * volume.max;     // highest corner
 * volume.center;  // (min + max) / 2
 * volume.radius;  // |max − min| / 2 — circumradius of the box
 * ```
 *
 * **Everything here is live.** The vectors belong to the geometry, are
 * rewritten in place by the next recompute, and must not be mutated by callers;
 * copy them if you need to keep them. (The same rule `resolveWorldTransform`
 * states for a returned world matrix.)
 *
 * **An empty geometry has no volume**, and says so rather than pretending: the
 * box is the identity element of bounds union (`min = +Infinity`,
 * `max = -Infinity`, so folding an empty geometry into a scene bound
 * contributes nothing), and `center`/`radius` are `NaN` — the volume of no
 * points is not a point at the origin. Consumers gate on
 * `Number.isFinite(volume.radius)`, which is the same finiteness gate
 * `computeWorldBoundingSphere` already applies for the same reason.
 */
export interface BoundingVolume {
  /** Lowest corner. `+Infinity` on every axis when the geometry has no vertices. */
  readonly min: Vector3;
  /** Highest corner. `-Infinity` on every axis when the geometry has no vertices. */
  readonly max: Vector3;
  /** Box centre, `(min + max) / 2`. `NaN` when the geometry has no vertices. */
  readonly center: Vector3;
  /** Circumradius of the box, `|max − min| / 2`. `NaN` when the geometry has no vertices. */
  readonly radius: number;
}

/**
 * The writable view of a {@link BoundingVolume}, used by the geometry that owns
 * one. Not exported from the package: a consumer that could widen a bound could
 * hide a culling defect from the object that computed it.
 */
export interface MutableBoundingVolume {
  readonly min: Vector3;
  readonly max: Vector3;
  readonly center: Vector3;
  radius: number;
}

/**
 * Source of geometry ids. Monotonic and process-wide, exactly like `Node`'s:
 * §33 forbids random or clock-derived identity, and a counter makes two
 * identical construction sequences produce identical ids.
 */
let nextGeometryId = 1;

/**
 * Draws the next `geometry-<n>`. Exported to the package (not to consumers) so
 * that every §53 family member — and every `clone()` — shares one sequence.
 */
export function nextGeometryIdentifier(): string {
  const id = `geometry-${String(nextGeometryId)}`;
  nextGeometryId += 1;
  return id;
}

/**
 * §53's abstract root of the geometry family: stable identity, a mutation
 * counter, a bounding volume, cloning, and disposal.
 *
 * ```ts
 * function upload(geometry: Geometry): void {
 *   if (cache.get(geometry.id)?.version === geometry.version) return;
 *   // …
 * }
 * ```
 *
 * A backend that only needs *identity and freshness* — a cache, a diagnostic, a
 * §83 accounting pass — should take a `Geometry`. A backend that needs vertex
 * data still takes the concrete {@link BufferGeometry}, because the attribute
 * layout is what it reads and §53's other family members do not exist yet to
 * abstract over.
 *
 * See the module header for why the family below this base is deliberately
 * one class deep today.
 */
export abstract class Geometry implements Disposable {
  /**
   * Stable identity (§53), assigned at construction from a monotonic counter
   * and formatted `geometry-<n>`. Unique within a process, ascending in
   * construction order, never reused — and, crucially, **never copied**: a
   * clone is a different geometry and gets the next id (see
   * {@link Geometry.clone}).
   */
  readonly id: string = nextGeometryIdentifier();

  /**
   * Counter incremented on every mutation (§53). Backends cache GPU buffers
   * against it; treat it as opaque and compare for inequality, exactly like
   * `Transform.version`. Monotonic, never wraps in a realistic session.
   */
  abstract get version(): number;

  /**
   * This geometry's {@link BoundingVolume} in its own local space, recomputed
   * only when {@link Geometry.version} has advanced since the last computation.
   *
   * The property spelling §53 declares; identical in every respect to calling
   * {@link Geometry.computeBounds}, including the returned object's identity.
   */
  abstract get bounds(): BoundingVolume;

  /** Whether {@link Geometry.dispose} has run. */
  abstract get disposed(): boolean;

  /**
   * Recomputes the bounding volume if the version has advanced, and returns it
   * (§53). Allocates nothing: the returned object and its vectors are owned by
   * the geometry and rewritten in place by the next recompute.
   */
  abstract computeBounds(): BoundingVolume;

  /**
   * An independent copy of this geometry, with **a new {@link Geometry.id}**
   * and a version of `0`.
   *
   * Deep in the data, shallow in nothing: see {@link BufferGeometry.clone} for
   * the contract and the argument behind it.
   */
  abstract clone(): Geometry;

  /** Releases this geometry's CPU-side data (§83). Idempotent. */
  abstract dispose(): void;
}
