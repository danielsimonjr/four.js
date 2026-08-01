/**
 * Collision shapes (§24) and their §85 parameter validation.
 *
 * ## What ships, and what is staged (plan P5-6)
 *
 * §24 requires seven 2D shapes (circle, rectangle, capsule, polygon, polyline,
 * chain, compound) and nine 3D shapes (sphere, box, capsule, cylinder, cone,
 * convex hull, triangle mesh, height field, compound). Phase 5 ships the
 * **primitive tier**:
 *
 * | Dimension | Shipped                                  |
 * | --------- | ---------------------------------------- |
 * | `"2d"`    | circle, rectangle, capsule, polygon      |
 * | `"3d"`    | sphere, box, capsule                     |
 *
 * The remaining §24 shapes — polyline, chain, cylinder, cone, convex hull,
 * triangle mesh, height field, compound — are **staged, not dropped**. They are
 * deliberately *absent from the unions below* rather than present-and-rejected:
 * a type that can express a shape the engine refuses to build is a promise the
 * compiler cannot keep, and it moves a failure that belongs at compile time
 * into a runtime error path (plan P5-6). Adding a variant to a union is a
 * backward-compatible change; each staged shape arrives with the packet that
 * can build *and* solve it. Until then `{ type: "cylinder", … }` is a type
 * error, which is the intended experience.
 *
 * ## Conventions (§7a, §7b)
 *
 * - The world is right-handed and **Y-up in both dimensions**; a `"2d"` shape
 *   lives in the world XY plane.
 * - Capsule and every other extent is expressed in **half** measures
 *   (`halfExtents`, `halfHeight`), matching the solvers this API sits above and
 *   removing the halving that a full-extent API repeats at every call site.
 * - A capsule's axis is **+Y**, so the same declaration means the same upright
 *   capsule in a 2D and a 3D world.
 * - Shapes carry `Vector2`/`Vector3` instances, which are mutable (§7b). The
 *   descriptor holds a reference, not a copy: mutating a vector after the
 *   collider is created does not retroactively change the collider, and
 *   re-validating a shape you have mutated is the caller's job.
 *
 * Shapes are plain data. They have no identity, no lifecycle, and no solver
 * state — {@link CollisionShape} values may be shared between any number of
 * colliders.
 */

import { FourError } from "@four/core";
import type { Vector2, Vector3 } from "@four/math";

import type { PhysicsDimension } from "./types.js";

/**
 * Every shape validation failure is a caller error in the §85 sense ("invalid
 * geometry", "impossible mass/inertia values"), reported with the engine's
 * general invalid-input code (§89) — the same code the animation package uses
 * for malformed descriptors. There is no physics-specific code in §89's list,
 * and `PHYSICS_SOLVER_FAILED` means the *solver* failed, which is a different
 * event entirely.
 */
const SHAPE_ERROR_CODE = "INVALID_APPLICATION_STATE";

/** A disc in the XY plane, `"2d"` only (§24). */
export interface CircleShape {
  readonly type: "circle";
  /** Distance from the centre to the rim, in world units. Must be > 0. */
  readonly radius: number;
}

/** An axis-aligned rectangle in the XY plane, `"2d"` only (§24). */
export interface RectangleShape {
  readonly type: "rectangle";
  /**
   * Half the width and half the height, measured from the centre along the
   * local X and Y axes. Both components must be > 0.
   */
  readonly halfExtents: Vector2;
}

/**
 * A capsule — a cylinder capped by hemispheres — with its axis along **+Y**
 * (§24). Valid in **both** dimensions: in a `"2d"` world it is the 2D
 * stadium/pill shape, in a `"3d"` world the 3D capsule. The parameters are the
 * same in both, which is exactly §21's parallel-naming rule.
 */
export interface CapsuleShape {
  readonly type: "capsule";
  /** Radius of the caps and of the cylindrical section. Must be > 0. */
  readonly radius: number;
  /**
   * Half the length of the **cylindrical section only**, along local Y —
   * excluding the caps. The total height of the shape is therefore
   * `2 * (halfHeight + radius)`. Must be > 0; a capsule with no cylindrical
   * section is a circle or a sphere and should be declared as one.
   */
  readonly halfHeight: number;
}

/**
 * A convex polygon in the XY plane, `"2d"` only (§24).
 *
 * **Convexity is required and validated.** §24 lists `polyline` and `chain`
 * separately for open and concave outlines (both staged, see the module
 * header), which leaves `polygon` as the closed convex primitive that solvers
 * accept directly. Passing a concave outline to a solver that assumes convexity
 * silently substitutes its convex hull — a wrong simulation that looks almost
 * right — so {@link validateCollisionShape} rejects it instead (decision,
 * WP-5.1).
 *
 * Either winding is accepted. Vertices are in the collider's local frame; the
 * polygon is implicitly closed from the last vertex back to the first.
 */
export interface PolygonShape {
  readonly type: "polygon";
  /**
   * At least three vertices, in order around the outline, with no two
   * consecutive vertices equal and no reflex corner.
   */
  readonly vertices: readonly Vector2[];
}

/** A ball, `"3d"` only (§24). */
export interface SphereShape {
  readonly type: "sphere";
  /** Distance from the centre to the surface. Must be > 0. */
  readonly radius: number;
}

/** An axis-aligned box, `"3d"` only (§24). */
export interface BoxShape {
  readonly type: "box";
  /**
   * Half the size along each local axis, measured from the centre. All three
   * components must be > 0.
   */
  readonly halfExtents: Vector3;
}

/** The shapes a `"2d"` world accepts (plan P5-6). */
export type CollisionShape2D =
  CircleShape | RectangleShape | CapsuleShape | PolygonShape;

/** The shapes a `"3d"` world accepts (plan P5-6). */
export type CollisionShape3D = SphereShape | BoxShape | CapsuleShape;

/**
 * Every shape this phase ships, discriminated by `type` (§24, plan P5-6).
 *
 * A value of this type is not necessarily legal in a given world:
 * {@link shapeSupportsDimension} and {@link validateCollisionShape} decide
 * that, because `"circle"` in a `"3d"` world is a dimension mismatch rather
 * than a malformed shape.
 */
export type CollisionShape = CollisionShape2D | CollisionShape3D;

/** The `type` tag of any shipped {@link CollisionShape}. */
export type CollisionShapeType = CollisionShape["type"];

/** The shipped `"2d"` shape tags, in §24's order. */
export const COLLISION_SHAPE_TYPES_2D = [
  "circle",
  "rectangle",
  "capsule",
  "polygon",
] as const satisfies readonly CollisionShape2D["type"][];

/** The shipped `"3d"` shape tags, in §24's order. */
export const COLLISION_SHAPE_TYPES_3D = [
  "sphere",
  "box",
  "capsule",
] as const satisfies readonly CollisionShape3D["type"][];

/**
 * Whether `shape` may be used in a world of `dimension` (§21, §24).
 *
 * A capsule answers `true` for both dimensions; every other shipped shape
 * belongs to exactly one.
 */
export function shapeSupportsDimension(
  shape: CollisionShape,
  dimension: PhysicsDimension,
): boolean {
  const tags: readonly CollisionShapeType[] =
    dimension === "2d" ? COLLISION_SHAPE_TYPES_2D : COLLISION_SHAPE_TYPES_3D;
  return tags.includes(shape.type);
}

/**
 * Validates one shape parameter that must be a finite positive number (§85:
 * "NaN and infinite values", "unstable scales and extreme ratios").
 */
function requirePositive(
  shapeType: CollisionShapeType,
  field: string,
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `${shapeType} shape: ${field} must be a finite positive number; got ${String(value)} (§24, §85).`,
      { context: { shape: shapeType, field, value } },
    );
  }
}

/** Validates the components of a 2D half-extent vector. */
function requirePositiveExtents2(
  shapeType: CollisionShapeType,
  field: string,
  value: Vector2,
): void {
  requirePositive(shapeType, `${field}.x`, value.x);
  requirePositive(shapeType, `${field}.y`, value.y);
}

/** Validates the components of a 3D half-extent vector. */
function requirePositiveExtents3(
  shapeType: CollisionShapeType,
  field: string,
  value: Vector3,
): void {
  requirePositive(shapeType, `${field}.x`, value.x);
  requirePositive(shapeType, `${field}.y`, value.y);
  requirePositive(shapeType, `${field}.z`, value.z);
}

/**
 * Validates a {@link PolygonShape}'s outline: enough vertices, all finite, no
 * repeated consecutive vertex, no reflex corner (§24, §85).
 *
 * Convexity is decided from the sign of the 2D cross product at every corner.
 * A zero cross product is a collinear corner — a redundant vertex, harmless and
 * accepted — so only the non-zero signs have to agree. A polygon whose corners
 * are *all* collinear encloses no area and is rejected by the same test, since
 * no sign is ever seen and the outline is degenerate.
 */
function validatePolygon(shape: PolygonShape): void {
  const { vertices } = shape;
  if (vertices.length < 3) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `polygon shape: needs at least 3 vertices; got ${String(vertices.length)} (§24, §85).`,
      { context: { shape: "polygon", vertexCount: vertices.length } },
    );
  }

  for (let i = 0; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `polygon shape: vertex ${String(i)} must be finite; got (${String(vertex.x)}, ${String(vertex.y)}) (§85).`,
        { context: { shape: "polygon", index: i } },
      );
    }
  }

  let sign = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];

    const abx = b.x - a.x;
    const aby = b.y - a.y;
    if (abx === 0 && aby === 0) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `polygon shape: vertices ${String(i)} and ${String((i + 1) % vertices.length)} are identical, which makes a zero-length edge (§24, §85).`,
        { context: { shape: "polygon", index: i } },
      );
    }

    const cross = abx * (c.y - b.y) - aby * (c.x - b.x);
    if (cross === 0) {
      continue;
    }
    const crossSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = crossSign;
    } else if (crossSign !== sign) {
      throw new FourError(
        SHAPE_ERROR_CODE,
        `polygon shape: outline is not convex — corner ${String((i + 1) % vertices.length)} turns the other way. §24 lists polyline and chain for concave outlines; both are staged (plan P5-6).`,
        { context: { shape: "polygon", index: (i + 1) % vertices.length } },
      );
    }
  }

  if (sign === 0) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      "polygon shape: every vertex is collinear, so the outline encloses no area (§24, §85).",
      { context: { shape: "polygon", vertexCount: vertices.length } },
    );
  }
}

/**
 * Validates a shape's parameters, and — when `dimension` is given — that the
 * shape belongs to that dimension (§24, §21, §85).
 *
 * Throws a `FourError` with `INVALID_APPLICATION_STATE`; returns nothing on
 * success. Call it once, when the collider is created: this walks a polygon's
 * whole outline and is not meant for a per-step path.
 *
 * `dimension` is optional so a shape can be checked on its own — in a
 * serializer, an editor, or a unit test — before any world exists.
 */
export function validateCollisionShape(
  shape: CollisionShape,
  dimension?: PhysicsDimension,
): void {
  if (dimension !== undefined && !shapeSupportsDimension(shape, dimension)) {
    throw new FourError(
      SHAPE_ERROR_CODE,
      `${shape.type} shape is not valid in a "${dimension}" world (§21, §24).`,
      { context: { shape: shape.type, dimension } },
    );
  }

  switch (shape.type) {
    case "circle":
    case "sphere":
      requirePositive(shape.type, "radius", shape.radius);
      return;
    case "rectangle":
      requirePositiveExtents2(shape.type, "halfExtents", shape.halfExtents);
      return;
    case "box":
      requirePositiveExtents3(shape.type, "halfExtents", shape.halfExtents);
      return;
    case "capsule":
      requirePositive(shape.type, "radius", shape.radius);
      requirePositive(shape.type, "halfHeight", shape.halfHeight);
      return;
    case "polygon":
      validatePolygon(shape);
      return;
    default: {
      /*
       * Unreachable for well-typed callers — the switch is exhaustive over
       * `CollisionShape`. It is here for JavaScript callers and for the staged
       * shapes of plan P5-6: `{ type: "cylinder" }` is a compile error, and if
       * one reaches this function anyway it must fail loudly rather than be
       * silently accepted as valid.
       */
      const unknownShape: never = shape;
      throw new FourError(
        SHAPE_ERROR_CODE,
        `Unknown collision shape ${JSON.stringify(unknownShape)}. Phase 5 ships ${COLLISION_SHAPE_TYPES_2D.join(", ")} (2d) and ${COLLISION_SHAPE_TYPES_3D.join(", ")} (3d); the remaining §24 shapes are staged (plan P5-6).`,
        { context: { shape: unknownShape } },
      );
    }
  }
}
