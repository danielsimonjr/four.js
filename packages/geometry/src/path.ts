/**
 * The §51 path model — the vector-level source data every 2D shape, stroke,
 * and text-along-a-curve is built from, and the module that turns it into the
 * polylines §52's tessellator eats.
 *
 * §51 specifies a path as a *command list* built through a fluent API:
 *
 * ```ts
 * const path = new Path();
 * path.moveTo(0, 0);
 * path.lineTo(100, 0);
 * path.quadraticCurveTo(150, 50, 100, 100);
 * path.cubicCurveTo(75, 125, 25, 125, 0, 100);
 * path.arc(0, 50, 25, 0, Math.PI);
 * path.close();
 * ```
 *
 * That is exactly {@link Path}: the six segment kinds §51 lists (move, line,
 * quadratic Bézier, cubic Bézier, circular *and* elliptical arc, close) stored
 * as a readable {@link PathCommand} list, with the builder methods as the only
 * way to append to it. There is deliberately **no** `fromCommands` constructor:
 * every operation below assumes a well-formed list (no segment before a
 * `moveTo`, no `close` without an open subpath), and the builder is what makes
 * that an invariant rather than a hope. §79's serialization packet is the one
 * that will need a validating parse, and it can have one.
 *
 * Placement is §98's: *"`geometry`: 2D and 3D geometry, **path model**,
 * tessellation module (§52)"*. `@four/math` owns curves as math; `@four/scene`
 * owns nodes. A `Path` is neither — it is the 2D geometry source `R-23`'s shape
 * nodes, `R-16`'s paints, `R-26`'s SVG bridge and §56's text-on-a-path all read.
 *
 * ## What ships here, and what is staged (§51, 2026-08-09)
 *
 * §51 lists seventeen required operations. Thirteen are here:
 *
 * | §51 operation                     | this module                                                 |
 * | --------------------------------- | ----------------------------------------------------------- |
 * | move, line, quadratic, cubic      | {@link Path.moveTo}, {@link Path.lineTo}, {@link Path.quadraticCurveTo}, {@link Path.cubicCurveTo} |
 * | circular and elliptical arc       | {@link Path.arc}, {@link Path.ellipse}                       |
 * | close path                        | {@link Path.close}                                           |
 * | flatten                           | {@link Path.flatten} (adaptive) and {@link Path.fillRings}    |
 * | subdivide                         | {@link Path.subdivide} (exact, curve-preserving)              |
 * | simplify                          | {@link Path.simplify} (polyline runs; curve refitting staged) |
 * | reverse                           | {@link Path.reverse}                                          |
 * | transform                         | {@link Path.transform}                                        |
 * | compute length                    | {@link Path.length}                                           |
 * | evaluate point, tangent, normal   | {@link Path.pointAt}, {@link Path.tangentAt}, {@link Path.normalAt} |
 * | closest-point query               | {@link Path.closestPoint}                                     |
 * | fill rules (nonzero, even-odd)    | {@link Path.fillRule}, honoured by {@link Path.fillRings}     |
 *
 * The remaining four are **not** here, and each names its owner rather than
 * pretending to be almost done:
 *
 * - **offset path** needs §58's join and cap model — an offset curve is a
 *   stroke outline on one side, and its behaviour at a concave corner *is* the
 *   join rule. Building it before §58 would mean inventing that rule twice. It
 *   lands with the paint packet (gap `R-16`).
 * - **union, intersection, subtraction, xor** need a planar subdivision of the
 *   arrangement of the input segments, plus the fill rule applied to the faces
 *   of that arrangement. It is the same machinery §52 needs for
 *   *"self-intersections where well-defined"*, and the two should be built
 *   once, together — a Bentley–Ottmann sweep whose tie-breaking is exactly
 *   where a determinism claim is won or lost (the `R-25` lesson). Until then
 *   the boolean operations are absent rather than approximate.
 *
 * ## Flattening feeds §52 directly (the `R-25` handoff)
 *
 * {@link Path.flatten} returns one point array per subpath, and those arrays
 * are the exact input shape {@link triangulatePolygon} documents: a closed ring
 * whose last point is **not** repeated, in either winding. A filled shape is
 * therefore two calls:
 *
 * ```ts
 * for (const { outline, holes } of path.fillRings(0.05)) {
 *   const indices = triangulatePolygon(outline, holes);
 * }
 * ```
 *
 * {@link Path.fillRings} is the half that {@link Path.flatten} cannot do alone:
 * §52's tessellator takes *one* outline plus its holes, and a path with several
 * subpaths (the letter "O", a washer, an "i" with its dot) has to be sorted
 * into those groups first. Which ring is a hole is precisely what §51's **fill
 * rules** decide, so the two arrived together — and the grouping falls out of
 * the same containment pass, which is what lets an island (a filled ring inside
 * a hole) be handed over as its *own* group instead of tripping §52's
 * documented refusal of a hole inside a hole.
 *
 * §52's remaining §51-facing debt, *incremental rebuild of modified path
 * segments*, is unblocked but unbuilt: the {@link PathCommand} list is the
 * segment identity it needed, and the rebuild is a caching layer over
 * {@link Path.flatten} rather than a change to either module. It stays with the
 * tessellation packet.
 *
 * ## Determinism (§33) is **per segment kind**, and one kind is different
 *
 * `R-25` established the house rule: a claim of §33's `cross-platform` tier
 * means every step uses only `+`, `-`, `*`, `/`, `%` and comparisons on IEEE-754
 * doubles — the operations ECMA-262 defines as *exactly* rounded — and no
 * `Math.sin`, `Math.cos`, `Math.acos`, `Math.atan2` or `Math.sqrt`, all of
 * which ECMA-262 leaves implementation-approximated. Applied honestly to a path
 * model, that rule does not give one answer, it gives two:
 *
 * | segment kind        | flattening tier | why                                                                     |
 * | ------------------- | --------------- | ----------------------------------------------------------------------- |
 * | move, line, close   | cross-platform  | the points are the caller's                                             |
 * | quadratic, cubic    | cross-platform  | de Casteljau at `t = ½` is `(a + b) × 0.5` — one rounding, exact halving; the flatness test is a cross product compared against a squared tolerance |
 * | **arc, ellipse**    | **same-runtime** | a point on an arc *is* `centre + r·(cos θ, sin θ)`; there is no exact route to it |
 *
 * There is no way to flatten an arc given as a centre and two angles without
 * evaluating a transcendental, so this module does not pretend otherwise: an
 * arc's sample **values** come from `Math.cos`/`Math.sin` and its sample
 * **count** from `Math.acos`, which means two conforming engines may legally
 * disagree in the last bits *and* — at a tolerance that lands exactly on a
 * `Math.ceil` boundary — by one sample. Both are stated, and
 * `tests/determinism/path.test.ts` pins the two tiers **separately**, with two
 * digests and two tier labels in one golden, so a future edit that quietly
 * introduces a `Math.hypot` into the Bézier path breaks a golden whose stated
 * tier is `cross-platform` rather than hiding inside a same-runtime average.
 *
 * The measuring operations sort the same way: {@link Path.closestPoint} *picks*
 * its edge by comparing squared distances (cross-platform), then takes one
 * `Math.sqrt` to report the distance (same-runtime); {@link Path.length},
 * {@link Path.tangentAt} and {@link Path.normalAt} are same-runtime for the
 * same one-line reason. {@link Path.subdivide}, {@link Path.reverse} and
 * {@link Path.simplify} are exact operations on the command list — halving a
 * sweep, swapping two control points, dropping a vertex — and so are
 * cross-platform for every kind, arcs included, with one honest exception:
 * they need to know where each segment *starts*, and the start of a segment
 * that follows an arc is that arc's end point, which costs a `Math.cos` and a
 * `Math.sin`. A path of lines and Béziers is fully cross-platform under all
 * three; a Bézier drawn immediately after an arc inherits the arc's tier.
 * {@link Path.transform} is cross-platform on a path of points and lines and
 * curves, and same-runtime on a path containing an arc — mapping an arc needs
 * the matrix's scale and rotation, which needs `Math.sqrt` and `Math.atan2`.
 *
 * Order-dependence is closed the way `R-25` closed it: commands are processed
 * in list order, subpaths in command order, rings in subpath order, and every
 * tie — the closest edge in {@link Path.closestPoint}, the immediate container
 * in {@link Path.fillRings} — is broken by the lower index. There is no hash
 * iteration, no `Array.prototype.sort`, no clock and no RNG below.
 *
 * ## Refusals (§85)
 *
 * The house rule is refuse loudly rather than rewrite silently. `RangeError` is
 * thrown for: a non-finite coordinate, angle, radius or tolerance; a
 * non-positive radius or tolerance; a segment appended before any `moveTo`; a
 * `close` with no open subpath; a `t` outside `[0, 1]`; an evaluation on a path
 * of zero length; a projective (non-affine) matrix; and a non-similarity matrix
 * applied to a path containing an arc — the one case where the honest answer is
 * "this needs the staged ellipse decomposition", not a silently wrong ellipse.
 *
 * ## Cost
 *
 * Flattening is linear in the emitted point count. Bézier subdivision is
 * recursive with a hard depth cap of {@link MAX_SUBDIVISION_DEPTH} (2^16
 * segments per curve), which is what guarantees termination for a tolerance so
 * small that the flatness test can never pass. {@link Path.fillRings} is
 * O(rings² × points) — a containment probe of every ring against every other —
 * which is the same order as the tessellation that follows it and is dominated
 * by it for anything with a handful of subpaths. The measuring operations share
 * one cached flattening per tolerance, so a text layout sampling a hundred
 * glyph origins along a path flattens it once.
 *
 * Measured (2026-08-09, Node 22): flattening a four-cubic circle of radius 100
 * to a 0.05 tolerance — 256 points — takes 0.047 ms, and a 500-quadratic path
 * (1 137 points) 0.15 ms; `fillRings` on a two-ring frame is 0.006 ms;
 * `length()` on the circle is 0.038 ms. The §52 tessellation that follows is
 * **twenty times** the cost of the flattening that feeds it (0.99 ms for those
 * 256 points), which is where the attention goes when 2D gets slow — this
 * module is not the bottleneck it would be easy to assume it is.
 */

import type { Matrix3 } from "@four/math";

import { requirePositive } from "./primitive-support.js";
import type { Point2D } from "./tessellation.js";

/** A full turn in radians — the period every arc sweep is normalized into. */
const TAU = Math.PI * 2;

/**
 * Default flattening tolerance in world units (§7a/§40): the greatest distance
 * a flattened polyline is allowed to stray from the true curve.
 *
 * One hundredth of a world unit. A caller that knows its scale — a glyph
 * outline in em units, a chart in data units, a shape authored in pixels —
 * should pass its own; this default exists so `path.flatten()` means something
 * sensible for content authored at the tens-of-units scale §120's 2D tier
 * assumes, not so it can be left alone forever.
 */
export const DEFAULT_FLATTEN_TOLERANCE = 0.01;

/**
 * Hard ceiling on Bézier subdivision depth: 2^16 = 65 536 line segments per
 * curve.
 *
 * A termination guarantee, not a quality target. Subdivision error falls by
 * roughly 4× per level, so a curve spanning a thousand world units reaches a
 * 0.001-unit tolerance in about ten levels; the cap is only reached by a
 * tolerance small enough that no finite polyline could satisfy it, and reaching
 * it produces the finest polyline this module will ever emit rather than an
 * error or a hang.
 */
export const MAX_SUBDIVISION_DEPTH = 16;

/**
 * Highest {@link Path.subdivide} count: each curve becomes 2^16 curves of the
 * same kind. Past it the caller wants {@link Path.flatten}, not a command list
 * with sixty-five thousand entries per curve, and saying so is more useful than
 * running out of memory.
 */
const MAX_SUBDIVIDE_TIMES = 16;

/**
 * Relative slack when classifying a matrix as a similarity (uniform scale plus
 * rotation, optionally with a reflection).
 *
 * An exact test is the wrong tool here: a rotation matrix built from
 * `Math.cos`/`Math.sin` satisfies it exactly, but the *product* of a rotation
 * and a translation and a scale accumulates a few ulps, and refusing to
 * transform an arc by a matrix that is a similarity to within a part in 10^12
 * would be a bug rather than rigour. The slack applies to the classification
 * only — never to the transformed coordinates, which are whatever the matrix
 * says they are.
 */
const SIMILARITY_EPSILON = 1e-12;

/**
 * How a path's subpaths combine into a filled region (§51 "Fill rules").
 *
 * - `nonzero`: a point is inside when the signed number of times the path winds
 *   around it is not zero. Two nested rings drawn the same way therefore fill
 *   solid; the inner one only cuts a hole if it winds the other way.
 * - `even-odd`: a point is inside when a ray from it crosses the path an odd
 *   number of times. Nesting alternates filled and empty regardless of winding.
 *
 * `nonzero` is the default, matching SVG and Canvas.
 */
export type FillRule = "nonzero" | "even-odd";

/** Starts a new subpath at a point (§51 "move"). */
export interface PathMoveCommand {
  readonly kind: "move";
  /** Horizontal coordinate of the new current point. */
  readonly x: number;
  /** Vertical coordinate of the new current point. */
  readonly y: number;
}

/** A straight segment from the current point (§51 "line"). */
export interface PathLineCommand {
  readonly kind: "line";
  /** Horizontal coordinate of the segment's end. */
  readonly x: number;
  /** Vertical coordinate of the segment's end. */
  readonly y: number;
}

/** A quadratic Bézier from the current point (§51 "quadratic Bézier"). */
export interface PathQuadraticCommand {
  readonly kind: "quadratic";
  /** Horizontal coordinate of the single control point. */
  readonly controlX: number;
  /** Vertical coordinate of the single control point. */
  readonly controlY: number;
  /** Horizontal coordinate of the curve's end. */
  readonly x: number;
  /** Vertical coordinate of the curve's end. */
  readonly y: number;
}

/** A cubic Bézier from the current point (§51 "cubic Bézier"). */
export interface PathCubicCommand {
  readonly kind: "cubic";
  /** Horizontal coordinate of the control point leaving the current point. */
  readonly control1X: number;
  /** Vertical coordinate of the control point leaving the current point. */
  readonly control1Y: number;
  /** Horizontal coordinate of the control point entering the end point. */
  readonly control2X: number;
  /** Vertical coordinate of the control point entering the end point. */
  readonly control2Y: number;
  /** Horizontal coordinate of the curve's end. */
  readonly x: number;
  /** Vertical coordinate of the curve's end. */
  readonly y: number;
}

/**
 * A circular or elliptical arc (§51 "circular and elliptical arc"), in centre
 * parameterization: the point at angle `θ` is
 * `centre + R(rotation) · (radiusX·cos θ, radiusY·sin θ)`.
 *
 * The command stores a **signed sweep** rather than the end angle the builder
 * was given. Two different `(startAngle, endAngle, counterclockwise)` triples
 * can describe the same arc — `(0, π)` and `(0, −π, true)` differ, `(0, 3π)`
 * and `(0, π)` do not — and a model that kept the raw triple would have to
 * re-derive the sweep in every operation that touches an arc.
 * {@link Path.arc} and {@link Path.ellipse} normalize once, here, into
 * `|deltaAngle| ≤ 2π`; reversing an arc negates it, splitting one halves it.
 *
 * When the current point is not the arc's start point, the arc contributes an
 * implicit straight segment to it first — the Canvas rule, and the one that
 * makes a rounded rectangle expressible as alternating lines and arcs.
 */
export interface PathArcCommand {
  readonly kind: "arc";
  /** Horizontal coordinate of the ellipse's centre. */
  readonly centerX: number;
  /** Vertical coordinate of the ellipse's centre. */
  readonly centerY: number;
  /** Semi-axis along the ellipse's local X axis. Always positive. */
  readonly radiusX: number;
  /** Semi-axis along the ellipse's local Y axis. Always positive. */
  readonly radiusY: number;
  /** Rotation of the ellipse's local axes about its centre, in radians (§7b). */
  readonly rotation: number;
  /** Angle of the arc's first point, in the ellipse's local frame, in radians. */
  readonly startAngle: number;
  /**
   * Signed sweep in radians, `−2π … 2π`. Positive sweeps counter-clockwise in
   * the Y-up plane (§7a).
   */
  readonly deltaAngle: number;
}

/**
 * Closes the current subpath with a straight segment back to its first point
 * (§51 "close path").
 *
 * The closing segment is implicit: it is not a {@link PathLineCommand}, it
 * carries no coordinates, and it exists in the flattened output only as the
 * edge from the ring's last point back to its first.
 */
export interface PathCloseCommand {
  readonly kind: "close";
}

/**
 * A command that draws — everything except `move` and `close`, which position
 * the pen rather than mark the page.
 *
 * Having the narrower type is what lets the operations that walk *segments*
 * (reversing one, splitting one) be exhaustive over four kinds instead of
 * carrying two cases that cannot arise.
 */
export type PathSegmentCommand =
  PathLineCommand | PathQuadraticCommand | PathCubicCommand | PathArcCommand;

/** One entry of a {@link Path}'s command list — §51's six segment kinds. */
export type PathCommand =
  | PathMoveCommand
  | PathLineCommand
  | PathQuadraticCommand
  | PathCubicCommand
  | PathArcCommand
  | PathCloseCommand;

/** Options of the {@link Path} constructor. */
export interface PathOptions {
  /** How subpaths combine into a filled region. Defaults to `nonzero`. */
  fillRule?: FillRule;
}

/**
 * One filled region: an outer ring and the rings cut out of it — exactly the
 * two arguments {@link triangulatePolygon} takes.
 *
 * Produced by {@link Path.fillRings}. Both the outline and each hole are closed
 * rings whose last point is **not** repeated, in whatever winding the path was
 * authored with (§52's tessellator accepts either, per ring).
 */
export interface PathFillRings {
  /** The region's outer boundary. */
  readonly outline: readonly Point2D[];
  /** Rings cut out of {@link PathFillRings.outline}. */
  readonly holes: readonly (readonly Point2D[])[];
}

/** The answer to a {@link Path.closestPoint} query (§51 "closest-point query"). */
export interface PathClosestPoint {
  /** The closest point found on the flattened path. */
  readonly point: Point2D;
  /**
   * Distance from the queried point to {@link PathClosestPoint.point}.
   *
   * The only same-runtime number in this record: the *choice* of point compares
   * squared distances and is cross-platform, the square root that reports it is
   * not (see this module's determinism section).
   */
  readonly distance: number;
  /**
   * Normalized arc-length position of {@link PathClosestPoint.point} along the
   * path, `0 … 1` — the same parameter {@link Path.pointAt} takes.
   */
  readonly t: number;
}

/**
 * A 2D path: an ordered list of §51's segment commands, built through a fluent
 * API and read through the operations §51 requires.
 *
 * ```ts
 * const path = new Path()
 *   .moveTo(0, 0)
 *   .lineTo(100, 0)
 *   .quadraticCurveTo(150, 50, 100, 100)
 *   .cubicCurveTo(75, 125, 25, 125, 0, 100)
 *   .arc(0, 50, 25, 0, Math.PI)
 *   .close();
 *
 * path.length();                 // world units along the path
 * path.flatten(0.05);            // one polyline per subpath
 * path.fillRings(0.05);          // outline/hole groups, per the fill rule
 * ```
 *
 * ## Mutation, and what returns what
 *
 * The **builder** methods mutate the path and return `this`, so they chain.
 * Every **operation** that produces a different shape —
 * {@link Path.transform}, {@link Path.reverse}, {@link Path.subdivide},
 * {@link Path.simplify}, {@link Path.clone} — returns a **new** `Path` and
 * leaves the receiver untouched. That split is deliberate: a path is source
 * data that other objects hold references to, and an in-place `transform` would
 * be the kind of silent shared-state rewrite §85 exists to prevent.
 *
 * The command objects themselves are deeply readonly and are shared, not
 * copied, between a path and its clone.
 */
export class Path {
  /** The appended commands, in order. Never rewritten in place. */
  #commands: PathCommand[] = [];

  /** Whether a current point exists — true after any command at all. */
  #hasCurrent = false;

  /** Whether a subpath is open — true except at the start and after `close`. */
  #openSubpath = false;

  /**
   * Cached flattening behind the measuring operations, keyed by tolerance.
   *
   * {@link Path.flatten} and {@link Path.fillRings} deliberately do *not* use
   * it: they hand their arrays to the caller, and a cache whose contents a
   * caller can mutate is a bug waiting for a second caller. The measuring
   * operations only read, so they share.
   */
  #sampleCache:
    { readonly tolerance: number; readonly sample: SampledPath } | undefined;

  /**
   * How this path's subpaths combine into a filled region (§51 "Fill rules").
   * Read by {@link Path.fillRings}; carried by every operation that returns a
   * new path.
   */
  fillRule: FillRule;

  /** Constructs an empty path. */
  constructor(options: PathOptions = {}) {
    this.fillRule = options.fillRule ?? "nonzero";
  }

  /**
   * The command list, in append order (§51's model, readable).
   *
   * Live, not a copy: appending to the path is visible here immediately. The
   * commands are readonly objects, so reading them cannot corrupt the path.
   */
  get commands(): readonly PathCommand[] {
    return this.#commands;
  }

  /** Whether no command has been appended yet. */
  get isEmpty(): boolean {
    return this.#commands.length === 0;
  }

  /** Starts a new subpath at `(x, y)` (§51 "move"). */
  moveTo(x: number, y: number): this {
    requireFinite("x", x);
    requireFinite("y", y);
    return this.#append({ kind: "move", x, y });
  }

  /** Appends a straight segment from the current point to `(x, y)` (§51 "line"). */
  lineTo(x: number, y: number): this {
    this.#requireCurrent("lineTo");
    requireFinite("x", x);
    requireFinite("y", y);
    return this.#append({ kind: "line", x, y });
  }

  /**
   * Appends a quadratic Bézier from the current point through control point
   * `(controlX, controlY)` to `(x, y)` (§51 "quadratic Bézier").
   */
  quadraticCurveTo(
    controlX: number,
    controlY: number,
    x: number,
    y: number,
  ): this {
    this.#requireCurrent("quadraticCurveTo");
    requireFinite("controlX", controlX);
    requireFinite("controlY", controlY);
    requireFinite("x", x);
    requireFinite("y", y);
    return this.#append({ kind: "quadratic", controlX, controlY, x, y });
  }

  /**
   * Appends a cubic Bézier from the current point through control points
   * `(control1X, control1Y)` and `(control2X, control2Y)` to `(x, y)`
   * (§51 "cubic Bézier").
   *
   * Named as §51 names it — `cubicCurveTo`, not Canvas's `bezierCurveTo`.
   */
  cubicCurveTo(
    control1X: number,
    control1Y: number,
    control2X: number,
    control2Y: number,
    x: number,
    y: number,
  ): this {
    this.#requireCurrent("cubicCurveTo");
    requireFinite("control1X", control1X);
    requireFinite("control1Y", control1Y);
    requireFinite("control2X", control2X);
    requireFinite("control2Y", control2Y);
    requireFinite("x", x);
    requireFinite("y", y);
    return this.#append({
      kind: "cubic",
      control1X,
      control1Y,
      control2X,
      control2Y,
      x,
      y,
    });
  }

  /**
   * Appends a circular arc centred on `(centerX, centerY)` (§51 "circular …
   * arc").
   *
   * ```ts
   * path.arc(0, 50, 25, 0, Math.PI); // §51's own example
   * ```
   *
   * Angles are radians (§7b) measured from the +X axis, and a positive sweep
   * turns counter-clockwise in the Y-up plane (§7a). `counterclockwise` selects
   * the other way round the circle.
   *
   * The sweep is measured **in the requested direction** and wrapped into one
   * turn, the Canvas rule: `arc(…, 0, 4π)` is a whole circle, `arc(…, 0, 2π)`
   * is a whole circle, and `arc(…, 0, 2π, true)` is *nothing at all* — going
   * clockwise from `0` to `2π` arrives immediately. A clockwise whole circle is
   * `arc(…, 0, −2π, true)`.
   *
   * If the path has a current point that is not the arc's first point, the arc
   * contributes an implicit straight segment to it. If the path has **no**
   * current point, an explicit `moveTo` the arc's first point is appended
   * first, so the command list stays well formed on its own terms.
   */
  arc(
    centerX: number,
    centerY: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): this {
    return this.ellipse(
      centerX,
      centerY,
      radius,
      radius,
      0,
      startAngle,
      endAngle,
      counterclockwise,
    );
  }

  /**
   * Appends an elliptical arc (§51 "… and elliptical arc") — {@link Path.arc}
   * with two semi-axes and a rotation of the ellipse's local frame.
   *
   * ```ts
   * path.ellipse(0, 0, 40, 20, Math.PI / 4, 0, Math.PI);
   * ```
   */
  ellipse(
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ): this {
    requireFinite("centerX", centerX);
    requireFinite("centerY", centerY);
    requirePositive("radiusX", radiusX);
    requirePositive("radiusY", radiusY);
    requireFinite("rotation", rotation);
    requireFinite("startAngle", startAngle);
    requireFinite("endAngle", endAngle);
    const deltaAngle = arcSweep(startAngle, endAngle, counterclockwise);
    const command: PathArcCommand = {
      kind: "arc",
      centerX,
      centerY,
      radiusX,
      radiusY,
      rotation,
      startAngle,
      deltaAngle,
    };
    if (!this.#hasCurrent) {
      const start = arcPoint(command, startAngle);
      this.#append({ kind: "move", x: start.x, y: start.y });
    }
    return this.#append(command);
  }

  /**
   * Closes the current subpath with an implicit straight segment back to its
   * first point (§51 "close path"), leaving the current point there.
   *
   * Refuses (§85) when no subpath is open — a `close` that closes nothing is a
   * mistake in the caller, and Canvas's silent no-op is exactly the kind of
   * swallowed error this repository does not do.
   */
  close(): this {
    if (!this.#openSubpath) {
      throw new RangeError(
        "Path.close: no subpath is open — call moveTo first (§85).",
      );
    }
    return this.#append({ kind: "close" });
  }

  /** A copy of this path, sharing its (readonly) command objects. */
  clone(): Path {
    return this.#derive(this.#commands.slice());
  }

  /**
   * Flattens every subpath into a polyline no further than `tolerance` world
   * units from the true curve (§51 "flatten"), one point array per subpath, in
   * command order.
   *
   * ```ts
   * const [ring] = new Path()
   *   .moveTo(0, 0).lineTo(2, 0).lineTo(2, 2).lineTo(0, 2).close()
   *   .flatten();
   * ring.length; // 4 — the closing edge is implicit, the first point is not repeated
   * ```
   *
   * ## What the arrays are
   *
   * Fresh arrays of fresh points on every call; the caller owns them. A
   * **closed** subpath comes back as a ring whose last point is not the first —
   * the shape {@link triangulatePolygon} documents, so the output feeds §52
   * directly. An **open** subpath comes back as its polyline; nothing is
   * appended to close it, because whether an open subpath is filled as if
   * closed is a *fill* question ({@link Path.fillRings} answers it) and not a
   * flattening one.
   *
   * Two consecutive points are never exactly equal: a duplicate would be a
   * zero-length edge, which §52's tessellator refuses and which no stroke can
   * find a direction for. Points that are merely *close* are left alone —
   * moving them is {@link Path.simplify}'s job and its caller's decision (§85).
   * One consequence is worth knowing: a hand-written `lineTo` aimed at the
   * coordinates of an arc's first point will usually miss it by an ulp, since
   * that point is `centre + r·(cos θ, sin θ)`, and the pair survives as a
   * hairline spike that §52 then refuses by name. Let the arc's *implicit*
   * connecting segment draw that edge instead — which is how a rounded
   * rectangle is written anyway, as a `moveTo` and four arcs.
   *
   * A subpath that received no segment (a lone `moveTo`) comes back as a single
   * point rather than being dropped: for a fill it is nothing, but for a round
   * cap it is a dot, and this method does not get to decide which one the
   * caller meant.
   *
   * ## Adaptive subdivision
   *
   * Béziers are split at their midpoint until a flatness test passes: the
   * distance of the control points from the chord, compared against `tolerance`
   * — for a cubic, `(d₁ + d₂)² ≤ tolerance² · |chord|²`, which bounds the true
   * deviation by `¾ · tolerance` since a cubic stays within `¾ max(d₁, d₂)` of
   * its chord. Straight stretches of a curve therefore cost two points and
   * tight corners cost many, which is what "adaptive" buys over a fixed segment
   * count (§52's "adaptive curve subdivision", delegated here by that module).
   * Arcs are sampled at a uniform angular step chosen so the sagitta of each
   * chord is within `tolerance`.
   *
   * @param tolerance Greatest allowed distance from the true curve, in world
   *   units. Must be finite and positive.
   */
  flatten(tolerance = DEFAULT_FLATTEN_TOLERANCE): Point2D[][] {
    requirePositive("tolerance", tolerance);
    return flattenSubpaths(this.#commands, tolerance).map(
      (subpath) => subpath.points,
    );
  }

  /**
   * Flattens this path and sorts the resulting rings into filled regions and
   * the holes cut out of them, according to {@link Path.fillRule} (§51 "Fill
   * rules") — the input {@link triangulatePolygon} takes.
   *
   * ```ts
   * const letterO = new Path()
   *   .moveTo(-2, -3).lineTo(2, -3).lineTo(2, 3).lineTo(-2, 3).close()
   *   .moveTo(-1, -2).lineTo(-1, 2).lineTo(1, 2).lineTo(1, -2).close();
   * const [region] = letterO.fillRings();
   * region.holes.length; // 1 — the counter, under either fill rule
   * ```
   *
   * ## How the grouping is decided
   *
   * Every ring is probed against every other by winding number, which gives
   * both rules at once: under `even-odd` a ring is filled when an even number
   * of rings contain it, under `nonzero` when the winding just inside it — the
   * winding of the containing rings plus its own — is not zero. Each unfilled
   * ring is then attached to the innermost ring containing it, which is always
   * a filled one (if a container were unfilled, everything it contains would
   * see winding zero from outside and be filled by its own turn alone).
   *
   * That grouping is what makes an **island** — a filled ring inside a hole,
   * the middle of a letter "e" drawn as three rings — expressible: it comes
   * back as its own region rather than as a hole inside a hole, which is a
   * configuration §52's tessellator documents that it refuses.
   *
   * ## What is dropped, and why that is not a rewrite
   *
   * Rings of fewer than three points, and rings enclosing exactly zero signed
   * area, contribute nothing to any fill and are left out of the result. The
   * path is untouched: this method answers "what does filling this path
   * produce", and a degenerate ring's honest answer is "nothing". Open subpaths
   * are filled as if closed, the SVG and Canvas rule — so an open subpath that
   * happened to end where it began loses that final point, which under the
   * closing rule is the implicit edge drawn a second time.
   *
   * ## The one overlap this can produce
   *
   * Under `nonzero`, a ring nested inside another with the *same* winding is
   * filled in its own right, so the inner region is covered by two groups. For
   * an opaque fill that is invisible; for a translucent one it double-blends.
   * The exact answer is a boolean union, which is staged with §51's boolean
   * operations (see this module's header) — reporting the overlap honestly beats
   * dropping a ring the caller drew.
   *
   * @param tolerance Flattening tolerance, as {@link Path.flatten}.
   */
  fillRings(tolerance = DEFAULT_FLATTEN_TOLERANCE): PathFillRings[] {
    requirePositive("tolerance", tolerance);
    const rings: Point2D[][] = [];
    const areas: number[] = [];
    for (const subpath of flattenSubpaths(this.#commands, tolerance)) {
      const points = subpath.points;
      // An *open* subpath keeps a final point that returns to its first — for
      // a stroke that is a real segment. Filled as if closed, it is the
      // implicit closing edge drawn twice, so it goes.
      if (
        points.length > 1 &&
        points[0].x === points[points.length - 1].x &&
        points[0].y === points[points.length - 1].y
      ) {
        points.pop();
      }
      if (points.length < 3) {
        continue;
      }
      const area = doubleSignedArea(points);
      if (area === 0) {
        continue;
      }
      rings.push(points);
      areas.push(area);
    }

    // Containment, once: every ring probed against every other by winding
    // number, which answers both fill rules at the same time.
    const count = rings.length;
    const containers: number[][] = [];
    const surrounding: number[] = [];
    for (let j = 0; j < count; j += 1) {
      const probe = rings[j][0];
      const mine: number[] = [];
      let winding = 0;
      for (let i = 0; i < count; i += 1) {
        if (i === j) {
          continue;
        }
        const turns = windingNumber(probe.x, probe.y, rings[i]);
        winding += turns;
        if (turns !== 0) {
          mine.push(i);
        }
      }
      containers.push(mine);
      surrounding.push(winding);
    }

    // The innermost container is the one with the most containers of its own.
    // Ties cannot happen between two rings that both contain `j` — one would
    // have to contain the other and so be deeper — and the strict comparison
    // keeps the lower index anyway, which is this module's tie rule.
    const parent: number[] = [];
    for (let j = 0; j < count; j += 1) {
      let innermost = -1;
      let innermostDepth = -1;
      for (const i of containers[j]) {
        if (containers[i].length > innermostDepth) {
          innermostDepth = containers[i].length;
          innermost = i;
        }
      }
      parent.push(innermost);
    }

    const evenOdd = this.fillRule === "even-odd";
    const filled: boolean[] = [];
    for (let j = 0; j < count; j += 1) {
      filled.push(
        evenOdd
          ? containers[j].length % 2 === 0
          : surrounding[j] + (areas[j] > 0 ? 1 : -1) !== 0,
      );
    }

    // Slot 0 is the bin for a ring with no container, which cannot be a hole
    // (see the doc comment's proof) — indexing by `parent + 1` keeps that
    // impossible case a discarded array rather than a branch nobody can test.
    const holeLists: Point2D[][][] = [];
    for (let j = 0; j <= count; j += 1) {
      holeLists.push([]);
    }
    for (let j = 0; j < count; j += 1) {
      if (!filled[j]) {
        holeLists[parent[j] + 1].push(rings[j]);
      }
    }

    const groups: PathFillRings[] = [];
    for (let j = 0; j < count; j += 1) {
      if (filled[j]) {
        groups.push({ outline: rings[j], holes: holeLists[j + 1] });
      }
    }
    return groups;
  }

  /**
   * Splits every curve segment at its midpoint, `times` times, returning a new
   * path of the **same shape** (§51 "subdivide").
   *
   * ```ts
   * const finer = path.subdivide(); // every curve becomes two of the same kind
   * ```
   *
   * Not to be confused with {@link Path.flatten}, which throws the curves away.
   * This is the exact operation: a cubic becomes two cubics through de
   * Casteljau at `t = ½`, a quadratic two quadratics, an arc two arcs of half
   * the sweep; lines, moves and closes pass through untouched. It is what an
   * editor's "add a point" does, what a subdivision-based intersection search
   * needs, and — because halving a double is exact and `(a + b) × 0.5` rounds
   * once — it is cross-platform for every segment kind, arcs included (a curve
   * that *follows* an arc needs that arc's end point, which is the one
   * same-runtime number in the operation; see this module's header).
   *
   * @param times How many halvings, `0 … 16`. Each curve becomes `2^times`
   *   curves, so the ceiling is where a command list stops being the right
   *   representation.
   */
  subdivide(times = 1): Path {
    if (!Number.isInteger(times) || times < 0 || times > MAX_SUBDIVIDE_TIMES) {
      throw new RangeError(
        `Path.subdivide: times must be an integer in 0…${String(MAX_SUBDIVIDE_TIMES)}; ` +
          `got ${String(times)} — beyond that, flatten() is the operation you want (§85).`,
      );
    }
    let commands: PathCommand[] = this.#commands.slice();
    for (let pass = 0; pass < times; pass += 1) {
      const next: PathCommand[] = [];
      const cursor = newCursor();
      for (const command of commands) {
        splitCommand(command, cursor.x, cursor.y, next);
        advance(command, cursor);
      }
      commands = next;
    }
    return this.#derive(commands);
  }

  /**
   * Removes vertices that a straight run does not need (§51 "simplify"),
   * returning a new path in which no removed vertex lies further than
   * `tolerance` from the segment that replaced it.
   *
   * Two things are removed: a `lineTo` that lands within `tolerance` of the
   * current point (a zero-length segment), and a vertex between two `lineTo`s
   * that is within `tolerance` of the chord joining its neighbours. Every
   * vertex removed from a run is re-checked against the growing chord, so the
   * guarantee holds for the run and not just for one step.
   *
   * **Curves are never touched.** Refitting a Bézier to a tolerance is curve
   * fitting, a different algorithm with a different failure mode, and a
   * `simplify` that quietly replaced a designer's cubic with a different cubic
   * would be the silent rewrite §85 forbids. Vertex removal on the polyline
   * runs is what ships; curve refitting, and the globally optimal
   * Douglas–Peucker pass that removes fewer vertices than this greedy one
   * misses, are the staged upgrades.
   *
   * Cross-platform (§33): squared distances and a cross product, no square
   * roots.
   *
   * @param tolerance Greatest distance a removed vertex may be from its
   *   replacement segment. Must be finite and positive.
   */
  simplify(tolerance = DEFAULT_FLATTEN_TOLERANCE): Path {
    requirePositive("tolerance", tolerance);
    const toleranceSquared = tolerance * tolerance;
    const next: PathCommand[] = [];
    const cursor = newCursor();
    // The run being merged: the point the pending line started from, the line
    // itself, and every vertex dropped from the run so far.
    let anchorX = 0;
    let anchorY = 0;
    let pending: PathLineCommand | undefined;
    let dropped: Point2D[] = [];

    const flush = (): void => {
      if (pending !== undefined) {
        next.push(pending);
        pending = undefined;
        dropped = [];
      }
    };

    for (const command of this.#commands) {
      if (command.kind !== "line") {
        flush();
        next.push(command);
        advance(command, cursor);
        continue;
      }
      if (pending === undefined) {
        if (
          squaredDistance(cursor.x, cursor.y, command.x, command.y) <=
          toleranceSquared
        ) {
          // A segment shorter than the tolerance: nothing to draw, and the
          // endpoint it would have moved to is within tolerance of where the
          // path already is.
          continue;
        }
        anchorX = cursor.x;
        anchorY = cursor.y;
        pending = command;
        advance(command, cursor);
        continue;
      }
      const candidate = [...dropped, { x: pending.x, y: pending.y }];
      const mergeable = candidate.every((point) =>
        withinChord(
          anchorX,
          anchorY,
          point.x,
          point.y,
          command.x,
          command.y,
          toleranceSquared,
        ),
      );
      if (mergeable) {
        dropped = candidate;
      } else {
        flush();
        anchorX = cursor.x;
        anchorY = cursor.y;
      }
      pending = command;
      advance(command, cursor);
    }
    flush();
    return this.#derive(next);
  }

  /**
   * Reverses the direction the path is traversed in (§51 "reverse"), returning
   * a new path: subpaths come back in reverse order, each walked from its last
   * point to its first.
   *
   * The visible consequence is winding: every ring's signed area flips sign,
   * which under the `nonzero` fill rule is how a subpath is turned from a solid
   * into a hole. Closed subpaths stay closed; the implicit closing segment is
   * traversed in its new direction like any other.
   *
   * Exact for every segment kind (a cubic's two control points swap, an arc's
   * sweep negates), so cross-platform (§33).
   */
  reverse(): Path {
    const next: PathCommand[] = [];
    for (const subpath of splitSubpaths(this.#commands).reverse()) {
      const entry: Point2D[] = [];
      const cursor = newCursor();
      cursor.x = subpath.startX;
      cursor.y = subpath.startY;
      for (const segment of subpath.segments) {
        entry.push({ x: cursor.x, y: cursor.y });
        advance(segment, cursor);
      }
      next.push({ kind: "move", x: cursor.x, y: cursor.y });
      for (let i = subpath.segments.length - 1; i >= 0; i -= 1) {
        const from = entry[i];
        pushReversed(subpath.segments[i], from, next);
      }
      if (subpath.closed) {
        next.push({ kind: "close" });
      }
    }
    return this.#derive(next);
  }

  /**
   * Applies a 2D affine transform to every command (§51 "transform"),
   * returning a new path.
   *
   * `matrix` is read as `@four/math`'s column-major 3×3 with the translation in
   * its third column: a point maps to `(e0·x + e3·y + e6, e1·x + e4·y + e7)`.
   *
   * ## Points are exact; arcs are the interesting case
   *
   * Move, line and Bézier commands are matrix-vector products — `+`, `-`, `*`
   * only, so cross-platform (§33) and exact for any affine matrix.
   *
   * An **arc** is stored as a centre, two radii, a rotation and a sweep, and a
   * general affine map takes that ellipse to a *different* ellipse whose axes
   * and rotation require an eigen decomposition to recover. This method
   * therefore handles the case that is both common and exactly expressible — a
   * **similarity**: uniform scale, rotation, translation, optionally with a
   * reflection, which maps radii by the scale, adds (or mirrors) the rotation,
   * and leaves the sweep alone (negating it under a reflection). Recovering
   * that scale and angle costs one `Math.sqrt` and one `Math.atan2`, so
   * transforming a path **containing an arc** is same-runtime tier while
   * transforming one without is cross-platform.
   *
   * A non-similarity matrix applied to a path containing an arc is **refused**
   * (§85), naming the operation that would fix it. Silently squashing the
   * circle into another circle, or converting it to Béziers behind the
   * caller's back, are both worse answers than saying so.
   *
   * A projective matrix — a third row that is not `(0, 0, 1)` — is refused for
   * any path: a path model has no perspective divide.
   */
  transform(matrix: Matrix3): Path {
    const e = matrix.elements;
    const a = e[0];
    const b = e[1];
    const c = e[3];
    const d = e[4];
    const tx = e[6];
    const ty = e[7];
    if (e[2] !== 0 || e[5] !== 0 || e[8] !== 1) {
      throw new RangeError(
        "Path.transform: the matrix is projective (its third row is not " +
          "(0, 0, 1)); a path model has no perspective divide (§85).",
      );
    }
    const mapX = (x: number, y: number): number => a * x + c * y + tx;
    const mapY = (x: number, y: number): number => b * x + d * y + ty;

    const next: PathCommand[] = [];
    for (const command of this.#commands) {
      switch (command.kind) {
        case "move":
        case "line":
          next.push({
            kind: command.kind,
            x: mapX(command.x, command.y),
            y: mapY(command.x, command.y),
          });
          break;
        case "quadratic":
          next.push({
            kind: "quadratic",
            controlX: mapX(command.controlX, command.controlY),
            controlY: mapY(command.controlX, command.controlY),
            x: mapX(command.x, command.y),
            y: mapY(command.x, command.y),
          });
          break;
        case "cubic":
          next.push({
            kind: "cubic",
            control1X: mapX(command.control1X, command.control1Y),
            control1Y: mapY(command.control1X, command.control1Y),
            control2X: mapX(command.control2X, command.control2Y),
            control2Y: mapY(command.control2X, command.control2Y),
            x: mapX(command.x, command.y),
            y: mapY(command.x, command.y),
          });
          break;
        case "arc":
          next.push(transformArc(command, a, b, c, d, tx, ty));
          break;
        case "close":
          next.push(command);
          break;
      }
    }
    return this.#derive(next);
  }

  /**
   * Total length of the path in world units (§51 "compute length"), measured on
   * the flattening at `tolerance` — closing segments of closed subpaths
   * included, the gaps between subpaths excluded.
   *
   * A flattened measurement, and therefore an **under**-estimate of a curve's
   * true length (a chord is shorter than its arc) bounded by the same tolerance
   * that bounds the flattening. Same-runtime tier (§33): one `Math.sqrt` per
   * edge.
   */
  length(tolerance = DEFAULT_FLATTEN_TOLERANCE): number {
    return this.#sample(tolerance).total;
  }

  /**
   * The point at normalized arc-length position `t` along the path (§51
   * "evaluate point").
   *
   * `t = 0` is the first point of the first subpath and `t = 1` the last point
   * of the last, with the parameter advancing in proportion to *length*, which
   * is what makes it the right parameter to lay text or ticks along. Where one
   * subpath ends and the next begins the position jumps: the gap between them
   * has no length and is not part of the path.
   *
   * Refuses (§85) a `t` outside `[0, 1]` and a path of zero length — neither
   * has a defensible answer, and clamping would hide a caller's bug.
   */
  pointAt(t: number, tolerance = DEFAULT_FLATTEN_TOLERANCE): Point2D {
    const { edge, local } = this.#locate(t, tolerance);
    return {
      x: edge.ax + (edge.bx - edge.ax) * local,
      y: edge.ay + (edge.by - edge.ay) * local,
    };
  }

  /**
   * The unit tangent at normalized arc-length position `t` (§51 "evaluate …
   * tangent"), pointing in the direction of travel.
   *
   * On the flattening, so it is the direction of the polyline edge containing
   * `t` and is piecewise constant: at a vertex shared by two edges the edge
   * *starting* there wins, which is a rule rather than a coin toss (§33).
   * Same-runtime tier: one `Math.sqrt`.
   */
  tangentAt(t: number, tolerance = DEFAULT_FLATTEN_TOLERANCE): Point2D {
    const { edge } = this.#locate(t, tolerance);
    return {
      x: (edge.bx - edge.ax) / edge.length,
      y: (edge.by - edge.ay) / edge.length,
    };
  }

  /**
   * The unit normal at normalized arc-length position `t` (§51 "evaluate …
   * normal") — the tangent turned a quarter turn **counter-clockwise**, so it
   * points to the left of the direction of travel in the Y-up plane (§7a).
   *
   * For a counter-clockwise ring that is the inward normal; reverse the path
   * (or negate the result) for the other side. Stating the convention is the
   * point: a stroke offsets along it, and a sign flip is a stroke drawn on the
   * wrong side.
   */
  normalAt(t: number, tolerance = DEFAULT_FLATTEN_TOLERANCE): Point2D {
    const tangent = this.tangentAt(t, tolerance);
    return { x: -tangent.y, y: tangent.x };
  }

  /**
   * The closest point on the path to `point` (§51 "closest-point query"),
   * with its distance and its normalized arc-length position.
   *
   * Measured on the flattening: every edge is tested, the point is projected
   * onto it and clamped to its ends, and the winner is chosen by **squared**
   * distance — exact arithmetic, ties broken by the earlier edge, so the answer
   * is cross-platform even though the reported distance takes a square root.
   *
   * Linear in the number of edges. A path sampled by many queries wants a
   * spatial index; that is a caching layer over this method, not a different
   * answer.
   */
  closestPoint(
    point: Point2D,
    tolerance = DEFAULT_FLATTEN_TOLERANCE,
  ): PathClosestPoint {
    requireFinite("point.x", point.x);
    requireFinite("point.y", point.y);
    const sample = this.#sample(tolerance);
    if (sample.total === 0) {
      throw new RangeError(
        "Path.closestPoint: the path has zero length, so it has no closest " +
          "point (§85).",
      );
    }
    let bestSquared = Number.POSITIVE_INFINITY;
    let bestX = 0;
    let bestY = 0;
    let bestDistanceAlong = 0;
    for (const edge of sample.edges) {
      const dx = edge.bx - edge.ax;
      const dy = edge.by - edge.ay;
      const raw =
        ((point.x - edge.ax) * dx + (point.y - edge.ay) * dy) /
        (dx * dx + dy * dy);
      const u = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const x = edge.ax + dx * u;
      const y = edge.ay + dy * u;
      const squared = squaredDistance(point.x, point.y, x, y);
      if (squared < bestSquared) {
        bestSquared = squared;
        bestX = x;
        bestY = y;
        bestDistanceAlong = edge.start + edge.length * u;
      }
    }
    return {
      point: { x: bestX, y: bestY },
      distance: Math.sqrt(bestSquared),
      t: bestDistanceAlong / sample.total,
    };
  }

  /** Appends one command, invalidating the measuring cache. */
  #append(command: PathCommand): this {
    this.#commands.push(command);
    this.#hasCurrent = true;
    this.#openSubpath = command.kind !== "close";
    this.#sampleCache = undefined;
    return this;
  }

  /** Refuses a segment appended before any `moveTo` (§85). */
  #requireCurrent(method: string): void {
    if (!this.#hasCurrent) {
      throw new RangeError(
        `Path.${method}: the path has no current point — call moveTo first (§85).`,
      );
    }
  }

  /**
   * Builds a new path from a finished command list, carrying the fill rule.
   *
   * The builder state is restored from the list's **last** command alone: a
   * current point exists once anything has been appended, and a subpath is open
   * unless the last command closed one. That is the whole invariant, which is
   * why no walk is needed.
   */
  #derive(commands: PathCommand[]): Path {
    const path = new Path({ fillRule: this.fillRule });
    path.#commands = commands;
    const last = commands[commands.length - 1];
    path.#hasCurrent = last !== undefined;
    path.#openSubpath = last !== undefined && last.kind !== "close";
    return path;
  }

  /** The flattening behind the measuring operations, cached per tolerance. */
  #sample(tolerance: number): SampledPath {
    requirePositive("tolerance", tolerance);
    const cache = this.#sampleCache;
    if (cache !== undefined && cache.tolerance === tolerance) {
      return cache.sample;
    }
    const sample = samplePath(this.#commands, tolerance);
    this.#sampleCache = { tolerance, sample };
    return sample;
  }

  /** Finds the edge containing normalized position `t`, and where on it. */
  #locate(
    t: number,
    tolerance: number,
  ): { readonly edge: PathEdge; readonly local: number } {
    requireFinite("t", t);
    if (t < 0 || t > 1) {
      throw new RangeError(
        `Path: t must lie in [0, 1]; got ${String(t)} (§85).`,
      );
    }
    const sample = this.#sample(tolerance);
    if (sample.total === 0) {
      throw new RangeError(
        "Path: the path has zero length, so it has no point at t (§85).",
      );
    }
    const target = t * sample.total;
    const edges = sample.edges;
    // Binary search for the last edge starting at or before `target`.
    let low = 0;
    let high = edges.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (edges[middle].start <= target) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    const edge = edges[low];
    return { edge, local: (target - edge.start) / edge.length };
  }
}

// ---------------------------------------------------------------------------
// Validation (§85)
// ---------------------------------------------------------------------------

/** Refuses a non-finite coordinate, angle or parameter. */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${name} must be a finite number; got ${String(value)} (§85).`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Exact helpers
//
// Every predicate below is a comparison on a value built from +, -, * and / —
// the exactly-rounded IEEE-754 operations — so its answer is identical on every
// conforming engine. See the module header on determinism.
// ---------------------------------------------------------------------------

/** Squared distance between two points. */
function squaredDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/**
 * Whether `(mx, my)` lies within `√toleranceSquared` of the segment
 * `(ax, ay) → (bx, by)`.
 *
 * The perpendicular distance is `|cross| / |chord|`, so the test is
 * `cross² ≤ tolerance² · |chord|²` — no division, no square root. When the
 * chord itself is shorter than the tolerance the ratio means nothing, and the
 * question becomes whether the point is within tolerance of the chord's
 * *start*, which is the same test a degenerate chord deserves.
 */
function withinChord(
  ax: number,
  ay: number,
  mx: number,
  my: number,
  bx: number,
  by: number,
  toleranceSquared: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const chordSquared = dx * dx + dy * dy;
  if (chordSquared <= toleranceSquared) {
    return squaredDistance(ax, ay, mx, my) <= toleranceSquared;
  }
  const cross = (mx - ax) * dy - (my - ay) * dx;
  return cross * cross <= toleranceSquared * chordSquared;
}

/** Twice the signed area of a closed ring; positive when counter-clockwise. */
function doubleSignedArea(points: readonly Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Winding number of a closed ring about a point: how many net counter-clockwise
 * turns the ring makes around it, `0` when the point is outside.
 *
 * The standard crossing count with the half-open edge rule (an edge counts when
 * its lower endpoint is at or below the probe and its upper endpoint strictly
 * above), so a vertex exactly at the probe's height is counted once, not twice.
 * Only comparisons and one cross product — exact.
 *
 * A probe lying *on* the ring has no well-defined answer; the callers avoid it
 * by probing with a vertex of a different ring, and rings that touch are
 * refused downstream by §52's tessellator.
 */
function windingNumber(
  px: number,
  py: number,
  ring: readonly Point2D[],
): number {
  let winding = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    // Positive when the probe lies to the left of the directed edge `a → b`.
    const side = (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y);
    if (a.y <= py) {
      if (b.y > py && side > 0) {
        winding += 1;
      }
    } else if (b.y <= py && side < 0) {
      winding -= 1;
    }
  }
  return winding;
}

// ---------------------------------------------------------------------------
// Arcs (§33: same-runtime — a point on an arc needs cos/sin)
// ---------------------------------------------------------------------------

/**
 * Normalizes a builder's `(startAngle, endAngle, counterclockwise)` into the
 * signed sweep {@link PathArcCommand} stores: `[0, 2π]` clockwise-positive
 * turns for a counter-clockwise arc, `[-2π, 0]` for the other direction.
 *
 * A sweep of a full turn or more draws the whole ellipse, as in Canvas —
 * `arc(cx, cy, r, 0, 4π)` is a circle, not two.
 *
 * Exact: subtraction and `%`, both exactly rounded.
 */
function arcSweep(
  startAngle: number,
  endAngle: number,
  counterclockwise: boolean,
): number {
  const raw = endAngle - startAngle;
  if (counterclockwise) {
    if (raw <= -TAU) {
      return -TAU;
    }
    const wrapped = raw % TAU;
    return wrapped > 0 ? wrapped - TAU : wrapped;
  }
  if (raw >= TAU) {
    return TAU;
  }
  const wrapped = raw % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * The point on an arc's ellipse at local angle `theta` (same-runtime).
 *
 * Package-internal, not part of the barrel: `svg-path.ts` needs an arc's start
 * and end points to write §50's endpoint-parameterized `A` command, and a
 * second copy of `centre + R(rotation)·(rx cos θ, ry sin θ)` living there would
 * be a second place for the rotation's sign to be wrong.
 */
export function arcPoint(command: PathArcCommand, theta: number): Point2D {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const localX = command.radiusX * cos;
  const localY = command.radiusY * sin;
  const cosRotation = Math.cos(command.rotation);
  const sinRotation = Math.sin(command.rotation);
  return {
    x: command.centerX + localX * cosRotation - localY * sinRotation,
    y: command.centerY + localX * sinRotation + localY * cosRotation,
  };
}

/**
 * Maps an arc through a 2D affine transform, or refuses (§85).
 *
 * See {@link Path.transform} for why only a similarity is expressible. The
 * algebra: for `L = s·Q` with `Q` orthogonal, `L·R(φ)·(rx cos θ, ry sin θ)` is
 * `s·R(α + φ)·(rx cos θ, ry sin θ)` when `Q = R(α)` is a rotation, and
 * `s·R(α − φ)·(rx cos(−θ), ry sin(−θ))` when `Q = R(α)·diag(1, −1)` is a
 * reflection — which is why a reflection negates both the start angle and the
 * sweep and subtracts the ellipse's rotation instead of adding it.
 */
function transformArc(
  command: PathArcCommand,
  a: number,
  b: number,
  c: number,
  d: number,
  tx: number,
  ty: number,
): PathArcCommand {
  const columnX = a * a + b * b;
  const columnY = c * c + d * d;
  const dot = a * c + b * d;
  const magnitude = columnX + columnY;
  const similar =
    magnitude > 0 &&
    Math.abs(columnX - columnY) <= SIMILARITY_EPSILON * magnitude &&
    Math.abs(dot) <= SIMILARITY_EPSILON * magnitude;
  if (!similar) {
    throw new RangeError(
      "Path.transform: this path contains an arc and the matrix is not a " +
        "similarity (uniform scale, rotation, translation, optionally " +
        "reflected). A general affine map takes the arc's ellipse to an " +
        "ellipse whose axes need an eigen decomposition this release does not " +
        "ship — flatten the path and rebuild it from line segments, or keep " +
        "the transform a similarity (§85).",
    );
  }
  const scale = Math.sqrt(columnX);
  const angle = Math.atan2(b, a);
  const reflected = a * d - b * c < 0;
  return {
    kind: "arc",
    centerX: a * command.centerX + c * command.centerY + tx,
    centerY: b * command.centerX + d * command.centerY + ty,
    radiusX: command.radiusX * scale,
    radiusY: command.radiusY * scale,
    rotation: reflected ? angle - command.rotation : angle + command.rotation,
    startAngle: reflected ? -command.startAngle : command.startAngle,
    deltaAngle: reflected ? -command.deltaAngle : command.deltaAngle,
  };
}

// ---------------------------------------------------------------------------
// Command algebra — exact operations on the command list
// ---------------------------------------------------------------------------

/**
 * Where a command list currently is: the current point and the first point of
 * the open subpath, which a `close` returns to.
 *
 * Both are needed, and keeping them together is what stops the second from
 * being forgotten — a curve appended after a `close` starts at the subpath's
 * first point, not at the last point drawn, and a reader that tracked only the
 * current point would silently start it in the wrong place.
 */
export interface PathCursor {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

/** A cursor at the origin — where every command list starts. */
export function newCursor(): PathCursor {
  return { x: 0, y: 0, startX: 0, startY: 0 };
}

/**
 * Moves `cursor` over one command.
 *
 * Exact for every kind except the arc, whose end point is
 * `centre + r·(cos θ, sin θ)` and therefore same-runtime (§33) — which is why
 * an operation on a *Bézier that follows an arc* inherits that tier while the
 * same operation on a path of lines and Béziers does not.
 *
 * Package-internal like `arcPoint`, and exported for the same reason: §50's
 * SVG writer has to know where each command starts, and "a `close` leaves you
 * at the subpath's first point" is a rule that must have exactly one
 * implementation.
 */
export function advance(command: PathCommand, cursor: PathCursor): void {
  switch (command.kind) {
    case "move":
      cursor.x = command.x;
      cursor.y = command.y;
      cursor.startX = command.x;
      cursor.startY = command.y;
      return;
    case "line":
    case "quadratic":
    case "cubic":
      cursor.x = command.x;
      cursor.y = command.y;
      return;
    case "arc": {
      const end = arcPoint(command, command.startAngle + command.deltaAngle);
      cursor.x = end.x;
      cursor.y = end.y;
      return;
    }
    case "close":
      cursor.x = cursor.startX;
      cursor.y = cursor.startY;
      return;
  }
}

/**
 * Appends `command` to `out`, split at its midpoint when it is a curve.
 *
 * De Casteljau at `t = ½`: every new control point is `(a + b) × 0.5`, one
 * rounding followed by an exact halving, so the split is cross-platform (§33)
 * and — unlike flattening — loses nothing.
 */
function splitCommand(
  command: PathCommand,
  currentX: number,
  currentY: number,
  out: PathCommand[],
): void {
  switch (command.kind) {
    case "move":
    case "line":
    case "close":
      out.push(command);
      return;
    case "quadratic": {
      const ax = (currentX + command.controlX) * 0.5;
      const ay = (currentY + command.controlY) * 0.5;
      const bx = (command.controlX + command.x) * 0.5;
      const by = (command.controlY + command.y) * 0.5;
      const mx = (ax + bx) * 0.5;
      const my = (ay + by) * 0.5;
      out.push({ kind: "quadratic", controlX: ax, controlY: ay, x: mx, y: my });
      out.push({
        kind: "quadratic",
        controlX: bx,
        controlY: by,
        x: command.x,
        y: command.y,
      });
      return;
    }
    case "cubic": {
      const ax = (currentX + command.control1X) * 0.5;
      const ay = (currentY + command.control1Y) * 0.5;
      const bx = (command.control1X + command.control2X) * 0.5;
      const by = (command.control1Y + command.control2Y) * 0.5;
      const cx = (command.control2X + command.x) * 0.5;
      const cy = (command.control2Y + command.y) * 0.5;
      const dx = (ax + bx) * 0.5;
      const dy = (ay + by) * 0.5;
      const ex = (bx + cx) * 0.5;
      const ey = (by + cy) * 0.5;
      const mx = (dx + ex) * 0.5;
      const my = (dy + ey) * 0.5;
      out.push({
        kind: "cubic",
        control1X: ax,
        control1Y: ay,
        control2X: dx,
        control2Y: dy,
        x: mx,
        y: my,
      });
      out.push({
        kind: "cubic",
        control1X: ex,
        control1Y: ey,
        control2X: cx,
        control2Y: cy,
        x: command.x,
        y: command.y,
      });
      return;
    }
    case "arc": {
      const half = command.deltaAngle * 0.5;
      out.push({ ...command, deltaAngle: half });
      out.push({
        ...command,
        startAngle: command.startAngle + half,
        deltaAngle: half,
      });
      return;
    }
  }
}

/** Appends the reversal of `segment`, which ran from `from`, to `out`. */
function pushReversed(
  segment: PathSegmentCommand,
  from: Point2D,
  out: PathCommand[],
): void {
  switch (segment.kind) {
    case "line":
      out.push({ kind: "line", x: from.x, y: from.y });
      return;
    case "quadratic":
      out.push({
        kind: "quadratic",
        controlX: segment.controlX,
        controlY: segment.controlY,
        x: from.x,
        y: from.y,
      });
      return;
    case "cubic":
      out.push({
        kind: "cubic",
        control1X: segment.control2X,
        control1Y: segment.control2Y,
        control2X: segment.control1X,
        control2Y: segment.control1Y,
        x: from.x,
        y: from.y,
      });
      return;
    case "arc": {
      out.push({
        ...segment,
        startAngle: segment.startAngle + segment.deltaAngle,
        deltaAngle: -segment.deltaAngle,
      });
      // The forward arc reached its first point by an implicit straight
      // segment from wherever the path was; reversed, that segment has to be
      // travelled back explicitly, because the arc no longer leads to it.
      const start = arcPoint(segment, segment.startAngle);
      if (start.x !== from.x || start.y !== from.y) {
        out.push({ kind: "line", x: from.x, y: from.y });
      }
      return;
    }
  }
}

/** One subpath of a command list: where it starts, its segments, its closure. */
interface CommandSubpath {
  readonly startX: number;
  readonly startY: number;
  readonly segments: PathSegmentCommand[];
  closed: boolean;
}

/**
 * Splits a command list into subpaths.
 *
 * A `close` ends a subpath and leaves the current point at its start, so a
 * segment appended afterwards begins a new subpath there — the Canvas rule the
 * builder allows and every reader here has to honour.
 */
function splitSubpaths(commands: readonly PathCommand[]): CommandSubpath[] {
  const subpaths: CommandSubpath[] = [];
  const cursor = newCursor();
  let current: CommandSubpath | undefined;
  for (const command of commands) {
    if (command.kind === "move") {
      current = {
        startX: command.x,
        startY: command.y,
        segments: [],
        closed: false,
      };
      subpaths.push(current);
      advance(command, cursor);
      continue;
    }
    if (command.kind === "close") {
      // A `close` with no open subpath cannot reach here: the builder refuses
      // it, and every command list in this module comes from the builder.
      (current as CommandSubpath).closed = true;
      current = undefined;
      advance(command, cursor);
      continue;
    }
    if (current === undefined) {
      current = {
        startX: cursor.x,
        startY: cursor.y,
        segments: [],
        closed: false,
      };
      subpaths.push(current);
      cursor.startX = cursor.x;
      cursor.startY = cursor.y;
    }
    current.segments.push(command);
    advance(command, cursor);
  }
  return subpaths;
}

// ---------------------------------------------------------------------------
// Flattening (§52's "adaptive curve subdivision", delegated to §51)
// ---------------------------------------------------------------------------

/** One flattened subpath. */
interface FlatSubpath {
  readonly points: Point2D[];
  readonly closed: boolean;
}

/** Flattens every subpath of a command list. */
function flattenSubpaths(
  commands: readonly PathCommand[],
  tolerance: number,
): FlatSubpath[] {
  const toleranceSquared = tolerance * tolerance;
  const subpaths: FlatSubpath[] = [];
  let points: Point2D[] = [];
  let open = false;
  let currentX = 0;
  let currentY = 0;
  let startX = 0;
  let startY = 0;

  const emit = (x: number, y: number): void => {
    const last = points[points.length - 1];
    if (last !== undefined && last.x === x && last.y === y) {
      return;
    }
    points.push({ x, y });
  };

  const finish = (closed: boolean): void => {
    if (!open) {
      return;
    }
    if (closed && points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      if (first.x === last.x && first.y === last.y) {
        points.pop();
      }
    }
    subpaths.push({ points, closed });
    points = [];
    open = false;
  };

  const ensureOpen = (): void => {
    if (!open) {
      points = [{ x: currentX, y: currentY }];
      startX = currentX;
      startY = currentY;
      open = true;
    }
  };

  for (const command of commands) {
    switch (command.kind) {
      case "move":
        finish(false);
        points = [{ x: command.x, y: command.y }];
        open = true;
        currentX = command.x;
        currentY = command.y;
        startX = command.x;
        startY = command.y;
        break;
      case "line":
        ensureOpen();
        emit(command.x, command.y);
        currentX = command.x;
        currentY = command.y;
        break;
      case "quadratic":
        ensureOpen();
        flattenQuadratic(
          currentX,
          currentY,
          command.controlX,
          command.controlY,
          command.x,
          command.y,
          toleranceSquared,
          0,
          emit,
        );
        currentX = command.x;
        currentY = command.y;
        break;
      case "cubic":
        ensureOpen();
        flattenCubic(
          currentX,
          currentY,
          command.control1X,
          command.control1Y,
          command.control2X,
          command.control2Y,
          command.x,
          command.y,
          toleranceSquared,
          0,
          emit,
        );
        currentX = command.x;
        currentY = command.y;
        break;
      case "arc": {
        ensureOpen();
        const end = flattenArc(command, tolerance, emit);
        currentX = end.x;
        currentY = end.y;
        break;
      }
      case "close":
        finish(true);
        currentX = startX;
        currentY = startY;
        break;
    }
  }
  finish(false);
  return subpaths;
}

/**
 * Emits a quadratic Bézier as line segment endpoints, splitting at `t = ½`
 * until flat.
 *
 * A quadratic's greatest distance from its chord is half the control point's:
 * `|cross| / (2 · |chord|)`, so the flatness test is
 * `cross² ≤ 4 · tolerance² · |chord|²` — exact, no square roots. A chord
 * shorter than the tolerance (a curve that returns to where it started) makes
 * the ratio meaningless, so the arm is compared directly instead.
 */
function flattenQuadratic(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  toleranceSquared: number,
  depth: number,
  emit: (x: number, y: number) => void,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chordSquared = dx * dx + dy * dy;
  let flat: boolean;
  if (chordSquared <= toleranceSquared) {
    flat = squaredDistance(x0, y0, cx, cy) <= 4 * toleranceSquared;
  } else {
    const cross = (cx - x0) * dy - (cy - y0) * dx;
    flat = cross * cross <= 4 * toleranceSquared * chordSquared;
  }
  if (flat || depth >= MAX_SUBDIVISION_DEPTH) {
    emit(x1, y1);
    return;
  }
  const ax = (x0 + cx) * 0.5;
  const ay = (y0 + cy) * 0.5;
  const bx = (cx + x1) * 0.5;
  const by = (cy + y1) * 0.5;
  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  flattenQuadratic(x0, y0, ax, ay, mx, my, toleranceSquared, depth + 1, emit);
  flattenQuadratic(mx, my, bx, by, x1, y1, toleranceSquared, depth + 1, emit);
}

/**
 * Emits a cubic Bézier as line segment endpoints, splitting at `t = ½` until
 * flat.
 *
 * The flatness test is the classic one: with `d₁` and `d₂` the perpendicular
 * distances of the two control points from the chord, the curve stays within
 * `¾ · max(d₁, d₂)` of that chord, so `(d₁ + d₂)² ≤ tolerance² · |chord|²`
 * bounds the deviation by `¾ · tolerance` — conservative on purpose, and built
 * from cross products so nothing is approximated.
 */
function flattenCubic(
  x0: number,
  y0: number,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x1: number,
  y1: number,
  toleranceSquared: number,
  depth: number,
  emit: (x: number, y: number) => void,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const chordSquared = dx * dx + dy * dy;
  let flat: boolean;
  if (chordSquared <= toleranceSquared) {
    flat =
      squaredDistance(x0, y0, c1x, c1y) <= toleranceSquared &&
      squaredDistance(x0, y0, c2x, c2y) <= toleranceSquared;
  } else {
    const cross1 = (c1x - x1) * dy - (c1y - y1) * dx;
    const cross2 = (c2x - x1) * dy - (c2y - y1) * dx;
    const sum = Math.abs(cross1) + Math.abs(cross2);
    flat = sum * sum <= toleranceSquared * chordSquared;
  }
  if (flat || depth >= MAX_SUBDIVISION_DEPTH) {
    emit(x1, y1);
    return;
  }
  const ax = (x0 + c1x) * 0.5;
  const ay = (y0 + c1y) * 0.5;
  const bx = (c1x + c2x) * 0.5;
  const by = (c1y + c2y) * 0.5;
  const cx = (c2x + x1) * 0.5;
  const cy = (c2y + y1) * 0.5;
  const dx1 = (ax + bx) * 0.5;
  const dy1 = (ay + by) * 0.5;
  const ex = (bx + cx) * 0.5;
  const ey = (by + cy) * 0.5;
  const mx = (dx1 + ex) * 0.5;
  const my = (dy1 + ey) * 0.5;
  flattenCubic(
    x0,
    y0,
    ax,
    ay,
    dx1,
    dy1,
    mx,
    my,
    toleranceSquared,
    depth + 1,
    emit,
  );
  flattenCubic(
    mx,
    my,
    ex,
    ey,
    cx,
    cy,
    x1,
    y1,
    toleranceSquared,
    depth + 1,
    emit,
  );
}

/**
 * Emits an arc as line segment endpoints at a uniform angular step, and returns
 * its end point.
 *
 * The step comes from the sagitta: a chord subtending `φ` on a circle of radius
 * `r` bulges `r(1 − cos(φ/2))` from the curve, so `φ = 2·acos(1 − tolerance/r)`
 * is the largest step within tolerance, with the larger semi-axis standing in
 * for `r` on an ellipse (conservative). The step is additionally capped at a
 * third of a turn so a full circle never degenerates into a line or a triangle,
 * and a tolerance larger than the arc itself still yields one chord.
 *
 * **Same-runtime tier (§33)**, unavoidably: `Math.acos` decides the sample
 * *count* and `Math.cos`/`Math.sin` produce the sample *values*, and ECMA-262
 * leaves all three implementation-approximated. This is the one place in the
 * module where two conforming engines are allowed to disagree.
 *
 * The arc's first point is emitted like any other, which is what materializes
 * the implicit straight segment from the current point when they differ — and
 * which the emitter's duplicate check removes when they do not.
 */
function flattenArc(
  command: PathArcCommand,
  tolerance: number,
  emit: (x: number, y: number) => void,
): Point2D {
  const radius = Math.max(command.radiusX, command.radiusY);
  const ratio = 1 - tolerance / radius;
  const step =
    ratio <= -1
      ? TAU / 3
      : Math.min(TAU / 3, 2 * Math.acos(Math.min(ratio, 1)));
  const count = Math.max(1, Math.ceil(Math.abs(command.deltaAngle) / step));
  const first = arcPoint(command, command.startAngle);
  const fullTurn = Math.abs(command.deltaAngle) === TAU;
  emit(first.x, first.y);
  let last = first;
  for (let i = 1; i <= count; i += 1) {
    // A full turn ends where it started — analytically, not numerically:
    // `cos(θ + 2π)` is not `cos θ` in floating point, and a circle whose last
    // sample missed its first by an ulp is a ring with a spike in it. Reusing
    // the first point is the exact answer, not an epsilon.
    last =
      fullTurn && i === count
        ? first
        : arcPoint(
            command,
            command.startAngle + command.deltaAngle * (i / count),
          );
    emit(last.x, last.y);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** One edge of a flattened path, with its position along the whole path. */
interface PathEdge {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  /** Length of this edge in world units; always greater than zero. */
  readonly length: number;
  /** Arc length from the start of the path to this edge's first point. */
  readonly start: number;
}

/** A flattened path reduced to what the measuring operations need. */
interface SampledPath {
  readonly edges: readonly PathEdge[];
  readonly total: number;
}

/**
 * Flattens a command list into measurable edges.
 *
 * Closing segments of closed subpaths are materialized (they are part of the
 * path's length); the jump from one subpath to the next is not (it is not).
 * Zero-length edges cannot occur — the flattener never emits two equal points
 * in a row, and a closed ring's duplicate final point is dropped — which is
 * what lets every consumer divide by an edge length without a guard.
 */
function samplePath(
  commands: readonly PathCommand[],
  tolerance: number,
): SampledPath {
  const edges: PathEdge[] = [];
  let total = 0;
  for (const subpath of flattenSubpaths(commands, tolerance)) {
    const points = subpath.points;
    const last = subpath.closed ? points.length : points.length - 1;
    for (let i = 0; i < last; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const length = Math.sqrt(squaredDistance(a.x, a.y, b.x, b.y));
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, length, start: total });
      total += length;
    }
  }
  return { edges, total };
}
