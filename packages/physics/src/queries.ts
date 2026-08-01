/**
 * Spatial queries (§30) — options, filter semantics, and result shapes.
 *
 * §30 requires five queries:
 *
 * ```ts
 * world.raycast(ray, options);
 * world.shapeCast(shape, transform, direction, options);
 * world.overlapSphere(center, radius, options);
 * world.overlapBox(center, halfExtents, rotation, options);
 * world.pointQuery(point, options);
 * ```
 *
 * and §37 gives the adapter four entry points for them — `raycast`,
 * `shapeCast`, `overlap`, `pointQuery` — because the two overlap forms differ
 * only in the shape they sweep with. This module defines the query records
 * those adapter methods take and the hits they return, so both the world-level
 * convenience API (WP-5.3) and every adapter speak one vocabulary.
 *
 * ## The eight §30 capabilities, and where each lives
 *
 * | §30 requirement   | Here                                       |
 * | ----------------- | ------------------------------------------ |
 * | collision groups  | {@link QueryFilter.collisionGroups}        |
 * | masks             | {@link QueryFilter.collisionMask}          |
 * | ignored bodies    | {@link QueryFilter.ignoredBodies}          |
 * | first hit         | `mode: "first"`                            |
 * | all hits          | `mode: "all"` (the default)                |
 * | sorted hits       | {@link QueryOptions.sorted}                |
 * | sensor inclusion  | {@link QueryFilter.includeSensors}         |
 * | custom filters    | {@link QueryFilter.predicate}              |
 *
 * {@link passesQueryFilter} implements the first three, the sixth, and the
 * eighth as one pure function so that every adapter filters *identically* — a
 * query that returns different colliders on Rapier and on Box2D would be a
 * portability bug the §37 contract is meant to prevent, and filtering is the
 * easiest place for that to happen silently.
 *
 * ## Dimensions (§21)
 *
 * One API serves both. In a `"2d"` world queries run in the world XY plane:
 * §30's `overlapSphere` is a circle overlap and `overlapBox` a rectangle
 * overlap, expressed here as an {@link OverlapQuery} carrying a `"circle"` or
 * `"rectangle"` shape. Ray origins and directions accept `Vector2` and widen to
 * `z = 0` like every other positional input (plan P5-3).
 *
 * ## No `Ray` type
 *
 * §30 writes `world.raycast(ray, options)`, but neither `@four/math` nor
 * `@four/scene` defines a ray, and inventing one in the physics package would
 * plant a type that picking (§72) and scene queries (§46) would each want to
 * own. {@link RaycastQuery} therefore carries the origin and direction inline,
 * alongside the options — one record instead of two arguments (decision,
 * WP-5.1). A `Ray` in `@four/math` can be adopted later without changing this
 * shape.
 */

import type { Vector3 } from "@four/math";

import type { CollisionShape } from "./shapes.js";
import type {
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  RotationInput,
  Vector3Input,
} from "./types.js";

/**
 * Every bit set — the default for both {@link QueryFilter.collisionGroups} and
 * {@link QueryFilter.collisionMask}, meaning "interacts with everything".
 *
 * Stored as an unsigned 32-bit value; §24's `collisionGroups` and
 * `collisionMask` are plain numbers used as bit sets, and 32 bits is what the
 * solvers underneath provide.
 */
export const ALL_COLLISION_GROUPS = 0xffffffff;

/** How many hits a query collects (§30: "first hit", "all hits"). */
export type QueryHitMode = "first" | "all";

/**
 * Which colliders a query is allowed to see (§30).
 *
 * ## The group/mask rule
 *
 * Interaction is **mutual**, the convention every solver this API sits above
 * uses: a query and a collider interact when each one's groups appear in the
 * other's mask.
 *
 * ```text
 * (query.collisionGroups & candidate.collisionMask) !== 0
 *   && (candidate.collisionGroups & query.collisionMask) !== 0
 * ```
 *
 * Requiring both directions means a collider can opt out of a query it does not
 * want to answer, which one-directional masking cannot express. Both values
 * default to {@link ALL_COLLISION_GROUPS}, so a filter that mentions neither
 * sees everything.
 */
export interface QueryFilter {
  /** Bit set of groups the query belongs to. Defaults to every bit. */
  collisionGroups?: number;

  /** Bit set of groups the query may hit. Defaults to every bit. */
  collisionMask?: number;

  /**
   * Bodies to skip entirely — §30's "ignored bodies", whose canonical use is
   * excluding the character that cast the ray. Compared by handle identity.
   */
  ignoredBodies?: readonly PhysicsBodyHandle[];

  /**
   * Individual colliders to skip, for when a body has several and only some
   * should be invisible to the query.
   */
  ignoredColliders?: readonly PhysicsColliderHandle[];

  /**
   * Whether sensors take part (§30 "sensor inclusion"). Defaults to `false`:
   * a sensor exerts no forces (§24) and is usually a trigger volume rather
   * than geometry, so line-of-sight and ground checks should not stop at one.
   */
  includeSensors?: boolean;

  /**
   * §30's "custom filters" — the last word on whether a candidate counts.
   *
   * Called **after** the cheap tests above have passed, once per candidate, and
   * must be a pure function of its argument: it runs inside the query, its call
   * order is the solver's traversal order, and a predicate with side effects
   * would make query results depend on that order (§33).
   */
  predicate?: (candidate: QueryCandidate) => boolean;
}

/** Everything a query takes beyond its geometry (§30). */
export interface QueryOptions extends QueryFilter {
  /**
   * Stop at the first hit or collect them all (§30). Defaults to `"all"`.
   * `"first"` means the *nearest* hit for the ray and shape casts, which sweep
   * in order; for overlap and point queries, where there is no natural order,
   * it means an arbitrary one.
   */
  mode?: QueryHitMode;

  /**
   * Sort hits by ascending distance before returning them (§30 "sorted hits").
   * Defaults to `false`, because sorting costs and many callers only count or
   * scan. Ignored for {@link OverlapQuery}, whose hits carry no distance.
   */
  sorted?: boolean;

  /**
   * Upper bound on the number of hits returned. Defaults to unbounded, and is
   * forced to `1` when `mode` is `"first"`.
   */
  maxHits?: number;
}

/**
 * {@link QueryOptions} with every default filled in — what
 * {@link passesQueryFilter} consumes and what an adapter should resolve once
 * per query instead of re-defaulting per candidate.
 */
export interface ResolvedQueryOptions {
  /** @see QueryFilter.collisionGroups */
  readonly collisionGroups: number;
  /** @see QueryFilter.collisionMask */
  readonly collisionMask: number;
  /** @see QueryFilter.ignoredBodies */
  readonly ignoredBodies: readonly PhysicsBodyHandle[];
  /** @see QueryFilter.ignoredColliders */
  readonly ignoredColliders: readonly PhysicsColliderHandle[];
  /** @see QueryFilter.includeSensors */
  readonly includeSensors: boolean;
  /** @see QueryFilter.predicate */
  readonly predicate: ((candidate: QueryCandidate) => boolean) | undefined;
  /** @see QueryOptions.mode */
  readonly mode: QueryHitMode;
  /** @see QueryOptions.sorted */
  readonly sorted: boolean;
  /** Resolved hit cap; `1` for `"first"`, `Infinity` when unbounded. */
  readonly maxHits: number;
}

/**
 * A collider a query is considering, as {@link passesQueryFilter} and a
 * {@link QueryFilter.predicate} see it.
 *
 * Not part of §30's text — §30 lists the filter *capabilities* and leaves the
 * candidate implicit — so this is the engine's definition (decision, WP-5.1):
 * the four properties the documented filter rules read, and nothing else. An
 * adapter fills it from its own broad-phase result; the fields are exactly
 * §24's `Collider` filtering fields plus the two handles.
 */
export interface QueryCandidate {
  /** The collider under consideration. */
  readonly collider: PhysicsColliderHandle;
  /** The body that owns it (§37: every collider has a parent body). */
  readonly body: PhysicsBodyHandle;
  /** The collider's §24 `collisionGroups`. */
  readonly collisionGroups: number;
  /** The collider's §24 `collisionMask`. */
  readonly collisionMask: number;
  /** The collider's §24 `sensor` flag. */
  readonly sensor: boolean;
}

/** Fills in every §30 default (see {@link QueryOptions}). */
export function resolveQueryOptions(
  options?: QueryOptions,
): ResolvedQueryOptions {
  const mode = options?.mode ?? "all";
  const requestedMaxHits = options?.maxHits ?? Number.POSITIVE_INFINITY;
  return {
    collisionGroups: options?.collisionGroups ?? ALL_COLLISION_GROUPS,
    collisionMask: options?.collisionMask ?? ALL_COLLISION_GROUPS,
    ignoredBodies: options?.ignoredBodies ?? [],
    ignoredColliders: options?.ignoredColliders ?? [],
    includeSensors: options?.includeSensors ?? false,
    predicate: options?.predicate,
    mode,
    sorted: options?.sorted ?? false,
    maxHits: mode === "first" ? 1 : requestedMaxHits,
  };
}

/**
 * Whether a candidate survives a query's filter (§30).
 *
 * Tests run cheapest-first and short-circuit: sensor inclusion, then the
 * ignore lists, then the mutual group/mask test documented on
 * {@link QueryFilter}, then the caller's predicate. Pure and allocation-free —
 * it is called once per broad-phase candidate.
 *
 * The ignore lists are scanned linearly. They are expected to hold a handful of
 * entries (§30's use case is "ignore the caster"); an adapter with genuinely
 * large ignore sets should pre-build its own index and use the predicate.
 */
export function passesQueryFilter(
  candidate: QueryCandidate,
  filter: ResolvedQueryOptions,
): boolean {
  if (candidate.sensor && !filter.includeSensors) {
    return false;
  }
  if (filter.ignoredBodies.includes(candidate.body)) {
    return false;
  }
  if (filter.ignoredColliders.includes(candidate.collider)) {
    return false;
  }
  if ((filter.collisionGroups & candidate.collisionMask) === 0) {
    return false;
  }
  if ((candidate.collisionGroups & filter.collisionMask) === 0) {
    return false;
  }
  if (filter.predicate !== undefined && !filter.predicate(candidate)) {
    return false;
  }
  return true;
}

/**
 * Sorts hits by ascending distance in place and returns the same array (§30
 * "sorted hits").
 *
 * `Array.prototype.sort` is stable per the language specification, so hits at
 * an identical distance keep the adapter's traversal order rather than being
 * permuted — which is what makes a sorted query result reproducible from step
 * to step (§33). Mutates and returns the argument instead of allocating,
 * matching the engine's allocation policy (§7b/D7) for a call that happens per
 * query.
 */
export function sortHitsByDistance<T extends { readonly distance: number }>(
  hits: T[],
): T[] {
  return hits.sort((a, b) => a.distance - b.distance);
}

/**
 * A ray cast through the world (§30, §37 `raycast`).
 *
 * The ray is carried inline rather than as a separate `Ray` object — see the
 * module header.
 */
export interface RaycastQuery extends QueryOptions {
  /** Start of the ray in world space. A `Vector2` widens to `z = 0`. */
  origin: Vector3Input;

  /**
   * Direction of the ray in world space. Need not be unit length; hit
   * distances are reported in world units along the normalized direction, so
   * the magnitude does not scale them.
   */
  direction: Vector3Input;

  /** How far along the ray to search, in world units. Defaults to unbounded. */
  maxDistance?: number;
}

/**
 * A shape swept through the world (§30, §37 `shapeCast`).
 *
 * §30 spells the world-level call `shapeCast(shape, transform, direction,
 * options)`; the transform is decomposed here into `position` and `rotation`
 * so a caller does not have to build a `Transform` for a query, and so the 2D
 * convenience forms (a `Vector2` position, a radian angle) apply as they do
 * everywhere else.
 */
export interface ShapeCastQuery extends QueryOptions {
  /** The shape to sweep. Must suit the world's dimension (§21, §24). */
  shape: CollisionShape;

  /** Where the sweep starts, in world space. */
  position: Vector3Input;

  /** The shape's orientation during the sweep. Defaults to identity. */
  rotation?: RotationInput;

  /** Sweep direction in world space; need not be unit length. */
  direction: Vector3Input;

  /** How far to sweep, in world units. Defaults to unbounded. */
  maxDistance?: number;
}

/**
 * Everything overlapping a static shape (§30, §37 `overlap`).
 *
 * This one record covers both §30 world-level forms: `overlapSphere` is an
 * overlap with a `"sphere"` shape (a `"circle"` in a `"2d"` world) and
 * `overlapBox` one with a `"box"` (a `"rectangle"` in 2D), exactly as §21
 * requires — parallel naming, one API surface.
 */
export interface OverlapQuery extends QueryOptions {
  /** The volume to test. Must suit the world's dimension (§21, §24). */
  shape: CollisionShape;

  /** Centre of the shape in world space. */
  position: Vector3Input;

  /** Orientation of the shape. Defaults to identity. */
  rotation?: RotationInput;
}

/** Everything containing a single point (§30, §37 `pointQuery`). */
export interface PointQuery extends QueryOptions {
  /** The point to test, in world space. */
  point: Vector3Input;
}

/** What every query hit identifies: one collider and the body that owns it. */
export interface QueryHit {
  /** The collider that was hit. */
  readonly collider: PhysicsColliderHandle;
  /** The body owning {@link QueryHit.collider}. */
  readonly body: PhysicsBodyHandle;
}

/** One intersection along a ray (§30, §37 `raycast`). */
export interface RaycastHit extends QueryHit {
  /** Intersection point in world space. */
  readonly point: Vector3;

  /**
   * Unit surface normal at the intersection, in world space, pointing out of
   * the hit collider.
   */
  readonly normal: Vector3;

  /**
   * Distance from the ray origin to {@link RaycastHit.point}, in world units
   * along the normalized ray direction.
   */
  readonly distance: number;
}

/** One impact of a swept shape (§30, §37 `shapeCast`). */
export interface ShapeCastHit extends QueryHit {
  /** The witness point on the hit collider, in world space. */
  readonly point: Vector3;

  /** Unit contact normal at the impact, in world space. */
  readonly normal: Vector3;

  /**
   * Distance the shape travelled before touching, in world units. `0` means
   * the shape was already overlapping when the sweep started.
   */
  readonly distance: number;
}

/**
 * One collider overlapping the query volume (§30, §37 `overlap`).
 *
 * There is no distance or witness point: an overlap test answers *whether*,
 * not *where*. Use a shape cast when the contact geometry matters.
 */
export type OverlapHit = QueryHit;

/** One collider containing the queried point (§30, §37 `pointQuery`). */
export interface PointHit extends QueryHit {
  /**
   * The closest point on the collider's surface to the query point, in world
   * space. Equal to the query point when it lies inside the collider.
   */
  readonly point: Vector3;

  /**
   * Distance from the query point to the collider's surface, in world units.
   * `0` when the point is inside.
   */
  readonly distance: number;
}
