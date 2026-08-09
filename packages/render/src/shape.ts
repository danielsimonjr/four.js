/**
 * §50's native 2D shape system — the node tier (R-23, 2026-08-09).
 *
 * §49 puts a `Shape2D` family under `Renderable`; §50 lists the fourteen shape
 * primitives that family has to express. This module is that family, built
 * entirely on the substrate the two preceding packets landed: §51's `Path`
 * (`R-24`) describes every shape, `Path.fillRings` sorts its subpaths into
 * filled regions and the holes cut out of them, and §52's `triangulatePolygon`
 * (`R-25`) turns each region into indices. Nothing here re-implements geometry:
 * a shape node is a set of validated parameters, a `toPath()` that spells them
 * as §51 commands, and a lazily rebuilt `BufferGeometry`.
 *
 * ```ts
 * const ring = new Ring({
 *   innerRadius: 0.6,
 *   outerRadius: 1,
 *   material: new UnlitMaterial({ color: [0.27, 0.4, 1, 1] }),
 * });
 * scene.add(ring);
 * ring.innerRadius = 0.8;   // validated, and rebuilt on the next read
 * ```
 *
 * ## The tier this ships, and the tier it does not (2026-08-09, R-16)
 *
 * **Fill and stroke, both, in solid colours.** `R-23` shipped this family at
 * the fill-only tier and named §58 as the owner of everything it was missing;
 * `R-16` is that owner, and what it brought is:
 *
 * - {@link Paint} and {@link SolidPaint} — §58's paint model at its solid
 *   tier, as a **closed one-member union** so the six staged kinds are a
 *   compile error rather than a silently ignored object. See {@link Paint} for
 *   why per-vertex colour is exact for a solid and for nothing else §58 lists,
 *   and what the exact tier costs;
 * - {@link StrokeStyle} — §58's interface, over §52's `expandStroke`: width,
 *   `inside`/`center`/`outside` alignment, butt/round/square caps,
 *   miter/round/bevel joins with a miter limit that falls back to a bevel, and
 *   dashes with a phase offset. Every row of §50's "dashes and dash offset",
 *   "miter, bevel, and round joins" and "butt, square and round caps";
 * - {@link Shape2D.fill} and {@link Shape2D.stroke}, and the `fill:`/`stroke:`
 *   constructor options §50's own example writes;
 * - **{@link Line}, {@link Polyline} and {@link Arc}** — the three §50
 *   primitives that had no class at all, because they are only a stroke. With
 *   them the family covers **all fourteen** of §50's rows.
 *
 * The stroke's geometry is not here. §52 puts stroke expansion in
 * `@four/geometry`'s tessellation module by name, beside the fill
 * tessellator, and that is where it went (`expandStroke`); this module
 * decides what a stroke *is* and lets §52 decide where its triangles are.
 *
 * What §58 still asks for and this does not answer, each with a named owner:
 * the six non-solid paints ({@link Paint} states the argument and the measured
 * price), and §52's anti-alias fringe, which needs a coverage attribute no
 * §57 pipeline reads. Both land with the `ShapeMaterial` packet below.
 *
 * The fourteen §50 rows and the classes that answer them:
 *
 * ```text
 * circle             Circle
 * ellipse            Ellipse
 * rectangle          Rectangle
 * rounded rectangle  Rectangle, with radius > 0   (§50's own example)
 * regular polygon    RegularPolygon
 * arbitrary polygon  Polygon
 * star               Star
 * line               Line
 * polyline           Polyline
 * arc                Arc
 * sector             Sector
 * ring               Ring
 * path               PathShape
 * Bézier path        PathShape, over a path carrying Bézier segments
 * ```
 *
 * Two of those mappings are decisions rather than transcriptions:
 *
 * - **§49's `RoundedRectangle` is `Rectangle` with a corner radius.** §49's
 *   tree names them as two classes; §50's *example* — the more specific
 *   normative statement, because it is the constructor call the spec itself
 *   writes — is `new Four.Rectangle({ width: 200, height: 100, radius: 12 })`.
 *   Two classes with one shape between them would mean two node types in §79
 *   and a document whose class depends on whether an author happened to type
 *   the rounded name.
 * - **§50's "path" and "Bézier path" are one class.** §51's `Path` already
 *   carries quadratic and cubic segments; a second node differing only in which
 *   command kinds its path happens to hold would be distinguishing data, not
 *   shape.
 *
 * `RegularPolygon`, `Star`, `Sector` and `Ring` have no row in §49's tree and
 * are required primitives in §50's list; they join the family because the
 * family is how this engine expresses a §50 primitive.
 *
 * ## Why these are `Renderable` subclasses and not one data-driven node
 *
 * §49 draws the alternative and rejects it: it puts eight *named classes* under
 * `Shape2D`, and §50 writes `new Four.Rectangle({ width, height })`. A single
 * `Shape2D` node carrying `{ kind: "rectangle", … }` would make that
 * constructor unwritable, would hand every shape every other shape's
 * parameters, and would move validation from a constructor signature into a
 * run-time switch. The shared behaviour that a data-driven design would buy —
 * flattening, tessellation, caching, dirtying, disposal — is in the abstract
 * base instead, which is where inheritance puts it.
 *
 * ## Material: `UnlitMaterial`, honestly, and **still no `ShapeMaterial`**
 *
 * §57's family lists `ShapeMaterial`, and `R-23` did not ship it because
 * without §58 it would be `UnlitMaterial` renamed. §58 has now landed and the
 * answer is **unchanged**, which is worth stating rather than leaving to
 * inference: at the solid-paint tier the paints are baked into the geometry's
 * per-vertex colours, so a `ShapeMaterial` would still carry nothing a
 * backend reads that `UnlitMaterial` does not. §58's fill and stroke live on
 * the **node**, where §50's own example puts them
 * (`new Four.Rectangle({ …, fill, stroke })` is a shape constructor, not a
 * material one), and a stroke's width and joins are geometry rather than
 * shading in any case.
 *
 * What would give the class content is the paint tier it cannot express —
 * gradients, patterns, a coverage-aware anti-alias fringe — and that is a
 * *pipeline*, which costs:
 *
 * - a new `RenderItemKind` arm, whose union is closed on purpose (`R-12`'s
 *   staging mechanism), *and* which `RFC 0001` and `RFC 0003` are both queued
 *   to widen — the first to land owns the shape of `pipelineId`; or
 * - a `kind: "unlit"` discriminant on a class called `ShapeMaterial`, i.e. a
 *   discriminant that lies about what it discriminates.
 *
 * The first also buys a backend pipeline compiled at renderer initialisation,
 * measured at **0.75–1.9 kB gzip in every bundle carrying `WebglRenderer`**
 * whether or not the application draws a shape (`R-6`, `R-13`, `R-18` all
 * measured it). So a shape carries a `SurfaceMaterial` and draws through the
 * existing flat-colour pipeline — with `vertexColors` doing the work, which is
 * a uniform switch the pipeline already has. The consequence worth stating
 * plainly, and now true of a *stroked* shape too: **this module changes no
 * backend, adds no render-item kind, and touches no frame path.** A scene that
 * draws no shape issues exactly the GL calls it issued before, by construction
 * rather than by measurement.
 *
 * Like `Renderable`, every class here is generic in its material and defaults
 * to `SurfaceMaterial`, for that class's reason: the render list picks a
 * pipeline from the material's own `kind` (§57, §64), so a consumer's material
 * — and a §79 document naming one this build has never heard of — draws exactly
 * as authored instead of being refused by a whitelist.
 *
 * ## Geometry: owned, derived, and rebuilt lazily
 *
 * A shape **owns** its `BufferGeometry` (§83) the way §55's `Sprite` owns its
 * quad, and for the same reason: it is a function of the node's parameters, not
 * something handed in. Writing any parameter marks it stale; the rebuild
 * happens on the next read of {@link Shape2D.geometry}, so a burst of edits in
 * one frame costs one tessellation rather than one per edit, and a shape nobody
 * draws is never tessellated at all.
 *
 * The geometry **object** is created once and its buffers are replaced in
 * place, so its `id` is stable across rebuilds and a backend's `GeometryCache`
 * re-uploads the entry (an `id` hit with a stale `version`) instead of leaking
 * the old one behind a new id — the property `Sprite` documents and the reason
 * the class holds a private reference rather than reassigning the inherited
 * slot. Unlike a sprite's quad, a shape's vertex *count* changes with its
 * parameters, so the arrays are reallocated rather than rewritten; the
 * assignment order below (`indices` and `uvs` dropped first) is required by
 * §53's validate-against-current-attributes rule, exactly as
 * `applyDebugDrawStreams` documents.
 *
 * ## Validation: refuse, never clamp (§85)
 *
 * Every parameter is a validated accessor (the F14 policy): a non-finite
 * radius, a negative width, a corner radius that does not fit the rectangle, an
 * inner radius that is not inside its outer one, or a polygon of two points
 * throws a `RangeError` naming the class and the parameter. Nothing is clamped,
 * nothing is silently reinterpreted, and a refused write leaves the shape
 * exactly as it was.
 *
 * A shape whose parameters are legal but enclose no area — a sector of zero
 * sweep, a polygon whose points are collinear — is **not** an error: it
 * tessellates to nothing and draws nothing, which is `fillRings`' own answer
 * for a ring that bounds nothing, and is a state an author animating a
 * parameter through zero passes through legitimately.
 *
 * ## What §50 still asks for, named rather than sketched
 *
 * Clipping and masks: they need §57's `stencil`, which no backend reads.
 * Boolean geometry operations: §51's four booleans, staged by `R-24` for the
 * one planar-subdivision packet §52's self-intersection rule also waits on.
 * Local and world bounds: `geometry.computeBounds()` gives the local box today;
 * the world box is §87's traversal. Analytic hit testing: `A-11`, which names
 * this packet as its blocker and wants an RFC. SVG import/export: `R-26`, and
 * {@link Shape2D.toPath} is the seam it needs — every shape here answers with a
 * §51 path, so an exporter never learns what kind of shape it is holding.
 */

import type { Disposable } from "@four/core";
import {
  BufferGeometry,
  DEFAULT_FLATTEN_TOLERANCE,
  expandStroke,
  Path,
  triangulatePolygon,
  type GeometryIndexArray,
  type PathFillRings,
  type Point2D,
  type StrokeAlignment,
  type StrokeLineCap,
  type StrokeLineJoin,
  type StrokeMesh,
} from "@four/geometry";
import type { Material } from "@four/materials";
import type { ColorRGBA } from "@four/math";

import {
  Renderable,
  type RenderableOptions,
  type SurfaceMaterial,
} from "./renderable.js";

/** One whole turn in radians (§7b) — the sweep of a closed circular shape. */
const TURN = Math.PI * 2;

/** The largest vertex index a `Uint16Array` index buffer can hold. */
const MAX_UINT16_INDEX = 0xffff;

/**
 * The vertex-free and index-free states a rebuild passes through, shared by
 * every shape in the process: they are handed to a geometry and replaced in the
 * same call, and nothing ever writes into them.
 */
const EMPTY_POSITIONS = new Float32Array(0);

/** See {@link EMPTY_POSITIONS}. */
const EMPTY_INDICES = new Uint16Array(0);

/** Rejects a non-finite parameter (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/** Rejects a parameter that is not a finite positive number (§85). */
function requirePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${name} must be a finite positive number; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Rejects a count that is not an integer of at least `minimum` (§85). */
function requireCount(name: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `${name} must be an integer of at least ${String(minimum)}; got ` +
        `${String(value)} (§85).`,
    );
  }
  return value;
}

/**
 * A flat colour (§58 "solid color") — the paint tier this release ships.
 *
 * ```ts
 * const blue: SolidPaint = { kind: "solid", color: [0.27, 0.4, 1, 1] };
 * ```
 *
 * The colour is linear-light straight RGBA, §60a's working space and the same
 * tuple every material carries; `@four/math`'s `srgbToLinearRGBA(parseColor(…))`
 * is the one-line path from §50's `"#4466ff"` (§101 pins tuples as the shipped
 * spelling — see `R-15`).
 */
export interface SolidPaint {
  /** Discriminant. See {@link Paint} for why a one-member union has one. */
  readonly kind: "solid";
  /** Straight, linear-light RGBA (§60a). Copied on assignment. */
  readonly color: ColorRGBA;
  /**
   * A second, independent multiplier on the colour's alpha (§50 "fill opacity
   * and stroke opacity"); finite, in 0…1, defaults to 1.
   *
   * §50 lists opacity as a requirement *beside* fill and stroke rather than
   * inside them, and SVG and Canvas both carry the pair for the same reason:
   * `fill-opacity` is the knob an author animates without touching the colour
   * they authored. The drawn alpha is `color[3] × opacity`.
   */
  readonly opacity?: number;
}

/**
 * What a shape's fill or stroke is painted with (§58).
 *
 * §58 lists seven kinds of paint — solid colour, linear, radial and conic
 * gradients, image patterns, procedural shaders, and render-target textures.
 * **This union has one member**, and the single member carries a discriminant
 * precisely so widening it is additive and typechecked: `{ kind: "linear-
 * gradient", … }` is a *compile error* today rather than an object silently
 * ignored at rebuild time. That is `R-6`'s `ScreenEffect` staging mechanism,
 * applied a second time.
 *
 * ## Why the other six are not here (decision, 2026-08-09)
 *
 * A shape's paints are baked into the geometry's per-vertex colours (see
 * {@link Shape2D}), and per-vertex colour is *exact* for exactly one of §58's
 * kinds beyond a solid: a **two-stop linear** gradient, which is an affine
 * function of position and is therefore reproduced exactly by the barycentric
 * interpolation a rasterizer already performs. Every other kind is not:
 *
 * - a linear gradient of **three or more stops** is piecewise affine, and the
 *   pieces are only right if the triangulation has vertices exactly on the
 *   stop lines — an ear-clipped fill does not, and cannot be made to without
 *   re-tessellating per gradient;
 * - a **radial** or **conic** gradient is not affine at all, so it comes out
 *   as a faceted approximation whose error depends on how finely the shape
 *   happened to be flattened;
 * - **patterns**, **procedural** paints and **render-target** paints are
 *   texture reads, which need §77's texture-unit allocator and a uv the shape
 *   does not have.
 *
 * Shipping the first case alone would be a `Paint` union whose members work
 * for some of their own arguments, which is worse than one that is honestly
 * narrow. The exact tier for all six is a paint **pipeline** — a
 * `ShapeMaterial` with a gradient-aware shader, or a generated gradient
 * texture behind §77's allocator — and a new compiled-at-initialisation
 * pipeline is measured at **~1.9 kB gzip in every bundle carrying
 * `WebglRenderer`** whether or not the application draws a gradient (`R-6`
 * 0.75 kB, `R-13`, `R-18` 1.9 kB — the standing bundle-cost law). It also
 * needs a `RenderItemKind` arm, whose shape `RFC 0001` and `RFC 0003` are both
 * queued to decide (first to land owns `pipelineId`). **Named owner: the
 * `ShapeMaterial` packet that lands with that pipeline**, which is also where
 * §52's anti-alias fringe goes.
 */
export type Paint = SolidPaint;

/**
 * A {@link SolidPaint} with every optional field resolved — what a shape
 * **stores** and hands back, as opposed to what it accepts.
 *
 * Two types for one paint, and deliberately: `shape.fill = { kind: "solid",
 * color }` should be writable without naming an opacity, and
 * `shape.fill.opacity` should read `1` rather than `undefined`. Splitting the
 * accessor's two halves says that in the type system instead of in a sentence
 * nobody reads.
 */
export interface ResolvedPaint {
  /** See {@link SolidPaint.kind}. */
  readonly kind: "solid";
  /** See {@link SolidPaint.color}; a copy of the authored tuple. */
  readonly color: ColorRGBA;
  /** See {@link SolidPaint.opacity}; `1` when none was authored. */
  readonly opacity: number;
}

/**
 * What fills a shape's interior (§50 "fill and stroke", §58).
 *
 * Three states, because there are three answers and two of them are not
 * paints:
 *
 * - **`"inherit"`** — filled in the material's own colour, with no per-vertex
 *   colour at all. The default for every closed §50 primitive, and *exactly*
 *   what `R-23` shipped: a shape that names no paint produces the geometry it
 *   produced before §58 existed, byte for byte.
 * - **a {@link Paint}** — filled in that paint, which the geometry carries as
 *   per-vertex colour (see {@link Shape2D}).
 * - **`"none"`** — not filled. The default for the three stroke-only
 *   primitives ({@link Line}, {@link Polyline}, {@link Arc}), and what an
 *   outlined rectangle needs.
 *
 * The two words are SVG's, which §50's "SVG import/export compatibility" row
 * makes the right vocabulary to borrow: `fill="none"` means the same thing
 * here that it means there.
 */
export type ShapeFill = Paint | "inherit" | "none";

/** {@link ShapeFill} as a shape stores it — see {@link ResolvedPaint}. */
export type ResolvedShapeFill = ResolvedPaint | "inherit" | "none";

/**
 * §58's `StrokeStyle` — how a shape's outline is drawn.
 *
 * ```ts
 * const outline: StrokeStyle = {
 *   width: 0.04,
 *   paint: { kind: "solid", color: [1, 1, 1, 1] },
 *   lineJoin: "round",
 *   dash: [0.2, 0.1],
 * };
 * ```
 *
 * §58 declares every field as required; this one defaults all but `width`,
 * following the family's standing rule that a parameter is required exactly
 * when it *is* the thing — a stroke is its width, and there is no width an
 * engine can invent, while `miter`/`butt`/`center` are the answers SVG,
 * Canvas and §58's own ordering already agree on. The defaults are named on
 * each field and restated in Appendix A terms by `expandStroke`.
 *
 * The geometric half is `@four/geometry`'s `StrokeGeometryOptions`, which this
 * interface re-declares minus its `tolerance` — a shape has its own
 * {@link Shape2D.tolerance} and stroking at a different one than the
 * flattening would put facets on a curve that has none — and plus §58's
 * `paint`, which the geometry package cannot see because a colour is not
 * geometry.
 *
 * Validated and **copied** on assignment (§85): reading gives a fresh record
 * with every optional field resolved, so an in-place edit of the object you
 * passed cannot desynchronise the geometry from the style that produced it —
 * the hazard {@link Polygon.points} has to document instead.
 */
export interface StrokeStyle {
  /**
   * Total width of the band in world units; finite and positive (§85).
   * **Required** — see the interface documentation.
   */
  readonly width: number;
  /**
   * What the band is painted with (§58). Omitted, the band is drawn in the
   * material's own colour with no per-vertex colour — which is what a
   * stroke-only shape like {@link Line} wants, and why it is optional.
   */
  readonly paint?: Paint;
  /** Which side of the outline the band sits on; defaults to `"center"`. */
  readonly alignment?: StrokeAlignment;
  /** How open ends are finished; defaults to `"butt"`. */
  readonly lineCap?: StrokeLineCap;
  /** How corners are filled; defaults to `"miter"`. */
  readonly lineJoin?: StrokeLineJoin;
  /**
   * Ratio of miter length to width past which a `"miter"` join is drawn as a
   * `"bevel"`; at least 1, defaults to 4 (SVG's and Canvas's).
   */
  readonly miterLimit?: number;
  /**
   * Alternating on/off lengths in world units (§50 "dashes and dash offset").
   * Omit for a solid stroke; an odd count is repeated, SVG's rule.
   */
  readonly dash?: readonly number[];
  /** How far into the dash pattern the outline starts; defaults to 0. */
  readonly dashOffset?: number;
}

/**
 * A {@link StrokeStyle} with every optional field except `paint` and `dash`
 * resolved — what a shape stores and hands back (see {@link ResolvedPaint} for
 * why the accessor has two types).
 *
 * `paint` and `dash` stay optional because their absence *means* something —
 * no paint of its own, and a solid rather than a dashed band — rather than
 * standing in for a default value.
 */
export interface ResolvedStrokeStyle {
  /** See {@link StrokeStyle.width}. */
  readonly width: number;
  /** See {@link StrokeStyle.paint}. */
  readonly paint?: ResolvedPaint;
  /** See {@link StrokeStyle.alignment}. */
  readonly alignment: StrokeAlignment;
  /** See {@link StrokeStyle.lineCap}. */
  readonly lineCap: StrokeLineCap;
  /** See {@link StrokeStyle.lineJoin}. */
  readonly lineJoin: StrokeLineJoin;
  /** See {@link StrokeStyle.miterLimit}. */
  readonly miterLimit: number;
  /** See {@link StrokeStyle.dash}; a copy of the authored pattern. */
  readonly dash?: readonly number[];
  /** See {@link StrokeStyle.dashOffset}. */
  readonly dashOffset: number;
}

/** The colour a vertex carries when its half of the shape names no paint. */
const UNPAINTED: ColorRGBA = [1, 1, 1, 1];

/** Validates a §58 paint and copies its colour (§85). */
function requirePaint(name: string, paint: Paint): ResolvedPaint {
  if (paint.kind !== "solid") {
    throw new RangeError(
      `${name} must be a §58 paint; got kind ` +
        `${JSON.stringify((paint as { kind: unknown }).kind)}. Only "solid" ` +
        "ships today — see the Paint union for the six staged kinds (§58).",
    );
  }
  const color = paint.color;
  for (let i = 0; i < 4; i += 1) {
    requireFinite(`${name}.color[${String(i)}]`, color[i]);
  }
  const opacity = paint.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError(
      `${name}.opacity must be a finite number between 0 and 1; got ` +
        `${String(opacity)} (§85).`,
    );
  }
  return {
    kind: "solid",
    color: [color[0], color[1], color[2], color[3]],
    opacity,
  };
}

/** Validates a {@link ShapeFill} (§85), copying any paint it carries. */
function requireFill(value: ShapeFill): ResolvedShapeFill {
  if (value === "inherit" || value === "none") {
    return value;
  }
  return requirePaint("Shape2D fill", value);
}

/**
 * Validates a {@link StrokeStyle} and returns a resolved copy (§85).
 *
 * Every check `expandStroke` would make is made here instead, at the write
 * that caused it: a stroke whose miter limit is 0 is a mistake in the caller's
 * code, and finding out about it on the next read of `geometry` — inside a
 * frame, which §61 forbids throwing from — would name the wrong line.
 */
function requireStroke(value: StrokeStyle): ResolvedStrokeStyle {
  const width = requirePositive("StrokeStyle width", value.width);
  const miterLimit = value.miterLimit ?? 4;
  if (!Number.isFinite(miterLimit) || miterLimit < 1) {
    throw new RangeError(
      `StrokeStyle miterLimit must be a finite number of at least 1; got ` +
        `${String(miterLimit)} (§85).`,
    );
  }
  const dashOffset = requireFinite(
    "StrokeStyle dashOffset",
    value.dashOffset ?? 0,
  );
  let dash: number[] | undefined;
  if (value.dash !== undefined) {
    dash = [];
    let total = 0;
    for (let i = 0; i < value.dash.length; i += 1) {
      const length = value.dash[i];
      if (!Number.isFinite(length) || length < 0) {
        throw new RangeError(
          `StrokeStyle dash[${String(i)}] must be a finite non-negative ` +
            `number; got ${String(length)} (§85).`,
        );
      }
      dash.push(length);
      total += length;
    }
    if (total <= 0) {
      throw new RangeError(
        "StrokeStyle dash lengths must not all be zero — a pattern of length " +
          "zero never advances (§85).",
      );
    }
  }
  return {
    width,
    ...(value.paint === undefined
      ? {}
      : { paint: requirePaint("StrokeStyle paint", value.paint) }),
    alignment: value.alignment ?? "center",
    lineCap: value.lineCap ?? "butt",
    lineJoin: value.lineJoin ?? "miter",
    miterLimit,
    ...(dash === undefined ? {} : { dash }),
    dashOffset,
  };
}

/**
 * A material that multiplies the geometry's per-vertex colours into its own —
 * the one thing a shape needs to know about a material it does not own.
 *
 * Structural rather than `instanceof UnlitMaterial`, and read exactly where
 * `buildRenderList` reads it (`item.material.vertexColors === true`): a
 * consumer's own material kind that multiplies vertex colours satisfies §58's
 * paints just as well, and a whitelist would refuse it.
 */
interface VertexColorMaterial {
  readonly vertexColors?: boolean;
}

/**
 * Refuses a paint the material cannot draw (§85).
 *
 * A shape expresses its paints as per-vertex colours, and a material that does
 * not multiply them draws *both* the fill and the stroke in its own single
 * colour — the fill would look right and the stroke would vanish into it,
 * which is "accepted and ignored" wearing a disguise. The material is checked
 * where the paint is authored, against the material the shape holds at that
 * moment; a material assigned afterwards is the author's business, exactly as
 * it is for every other geometry carrying a `colors` attribute.
 */
function requirePaintableMaterial(material: Material, paints: boolean): void {
  if (!paints || (material as VertexColorMaterial).vertexColors === true) {
    return;
  }
  throw new RangeError(
    "A shape carrying a §58 paint needs a material that multiplies the " +
      "geometry's per-vertex colours — pass `vertexColors: true` (§57, §58). " +
      `Its material (kind ${JSON.stringify(material.kind)}) does not, so the ` +
      "fill and the stroke would both draw the material's own colour.",
  );
}

/**
 * Copies and validates a point list (§85), so a shape holds its own points and
 * a caller mutating the array it passed cannot desynchronise the geometry from
 * the parameters that produced it.
 */
function copyPoints(name: string, points: readonly Point2D[]): Point2D[] {
  const copy: Point2D[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    copy.push({
      x: requireFinite(`${name}[${String(i)}].x`, point.x),
      y: requireFinite(`${name}[${String(i)}].y`, point.y),
    });
  }
  return copy;
}

/**
 * Rewrites `target` with the triangulated fill of `regions` (§52) followed by
 * the triangles of `stroke`, in place.
 *
 * Vertex `i` is region 0's outline point `i`, then that region's holes, then
 * region 1's — the same concatenation `triangulatePolygon` indexes, extended
 * across regions because a §51 path fills as *several* regions (an island in a
 * hole is its own region, which is exactly how the middle of a letter "e"
 * survives) — and then, after the last fill vertex, the whole stroke band.
 * `polygonGeometry2D` is the single-region form of this and is deliberately
 * not called: it builds a whole geometry per region, and a shape owns one.
 *
 * **The stroke's triangles come last, and that is load-bearing.** They occupy
 * the same plane as the fill, so what decides which one is visible where they
 * overlap is the depth comparison — and §61's backend contract fixes it at
 * `LEQUAL`, so equal depths let the *later* draw through. Index order inside
 * one geometry is draw order, so a stroke written after the fill paints over
 * it, which is the way round every 2D system draws them.
 *
 * Uv is the bounding box of everything emitted, normalized to `[0, 1]²`,
 * matching `polygonGeometry2D` and `extrudeGeometry`'s caps so a texture lines
 * up on a filled shape and on the front of its extrusion. With no stroke that
 * is exactly the box over the regions' outlines — holes are inside their
 * outline by construction — which is why adding the stroke's vertices to it
 * leaves an unstroked shape's uv stream byte for byte unchanged. Both spans
 * stay strictly positive whenever there is a vertex at all: `fillRings` drops
 * every ring enclosing zero area, and a stroke band is two-dimensional in both
 * axes for any polyline it does not drop.
 *
 * `colors` is emitted **only** when a §58 paint was authored, and then for
 * every vertex: the fill's half gets `fillColor`, the stroke's gets
 * `strokeColor`, and whichever half named no paint gets the identity
 * `(1, 1, 1, 1)` so the material's own colour reaches it unmultiplied. A shape
 * with no paint at all therefore carries no colour stream, and its geometry is
 * identical to the one `R-23` built before §58 existed.
 */
function rebuildFill(
  target: BufferGeometry,
  regions: readonly PathFillRings[],
  stroke: StrokeMesh | undefined,
  fillColor: ColorRGBA | undefined,
  strokeColor: ColorRGBA | undefined,
): void {
  const triangulations: GeometryIndexArray[] = [];
  let vertexCount = 0;
  let indexCount = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const region of regions) {
    const indices = triangulatePolygon(region.outline, region.holes);
    triangulations.push(indices);
    indexCount += indices.length;
    vertexCount += region.outline.length;
    for (const hole of region.holes) {
      vertexCount += hole.length;
    }
    for (const point of region.outline) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  const fillVertexCount = vertexCount;
  if (stroke !== undefined) {
    vertexCount += stroke.positions.length;
    indexCount += stroke.indices.length;
    for (const point of stroke.positions) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  const colors =
    fillColor === undefined && strokeColor === undefined
      ? undefined
      : new Float32Array(vertexCount * 4);

  // §53 validates every buffer against the ones already on the geometry, so a
  // shape whose vertex count changed cannot simply assign its new arrays — it
  // has to pass through a configuration legal at both counts, and neither
  // obvious end of the swap is one. Dropping the index buffer first leaves a
  // *non-indexed* triangle geometry, which is refused unless the old vertex
  // count happens to divide by three; replacing `positions` first leaves the
  // old indices pointing past the end.
  //
  // An **empty index buffer** is the configuration that is legal at every
  // vertex count, in both directions: it indexes nothing, so it constrains
  // nothing. Dropping `uvs` and `colors` alongside it (both are index-aligned
  // with `positions`, §53) leaves a geometry that accepts any new vertex count
  // at all. That is the rule `applyDebugDrawStreams` records, one step
  // further. Each assignment bumps the version; the version is a counter, and
  // the backend re-uploads once per frame regardless.
  target.indices = EMPTY_INDICES;
  target.uvs = undefined;
  target.colors = undefined;
  if (vertexCount === 0) {
    target.positions = EMPTY_POSITIONS;
    target.indices = undefined;
    return;
  }

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices =
    vertexCount - 1 > MAX_UINT16_INDEX
      ? new Uint32Array(indexCount)
      : new Uint16Array(indexCount);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  let vertex = 0;
  let index = 0;
  for (let region = 0; region < regions.length; region += 1) {
    const base = vertex;
    for (const ring of [regions[region].outline, ...regions[region].holes]) {
      for (const point of ring) {
        positions[vertex * 3] = point.x;
        positions[vertex * 3 + 1] = point.y;
        positions[vertex * 3 + 2] = 0;
        uvs[vertex * 2] = (point.x - minX) / spanX;
        uvs[vertex * 2 + 1] = (point.y - minY) / spanY;
        vertex += 1;
      }
    }
    for (const local of triangulations[region]) {
      indices[index] = base + local;
      index += 1;
    }
  }
  if (stroke !== undefined) {
    for (const point of stroke.positions) {
      positions[vertex * 3] = point.x;
      positions[vertex * 3 + 1] = point.y;
      positions[vertex * 3 + 2] = 0;
      uvs[vertex * 2] = (point.x - minX) / spanX;
      uvs[vertex * 2 + 1] = (point.y - minY) / spanY;
      vertex += 1;
    }
    for (const local of stroke.indices) {
      indices[index] = fillVertexCount + local;
      index += 1;
    }
  }
  if (colors !== undefined) {
    writeVertexColors(colors, 0, fillVertexCount, fillColor ?? UNPAINTED);
    writeVertexColors(
      colors,
      fillVertexCount,
      vertexCount,
      strokeColor ?? UNPAINTED,
    );
  }

  target.positions = positions;
  target.uvs = uvs;
  if (colors !== undefined) {
    target.colors = colors;
  }
  target.indices = indices;
}

/** Fills `[from, to)` of a §53 colour stream with one straight RGBA. */
function writeVertexColors(
  colors: Float32Array,
  from: number,
  to: number,
  color: ColorRGBA,
): void {
  for (let vertex = from; vertex < to; vertex += 1) {
    colors[vertex * 4] = color[0];
    colors[vertex * 4 + 1] = color[1];
    colors[vertex * 4 + 2] = color[2];
    colors[vertex * 4 + 3] = color[3];
  }
}

/** A paint's drawn RGBA — its colour with its opacity folded into the alpha. */
function paintColor(paint: ResolvedPaint | undefined): ColorRGBA | undefined {
  if (paint === undefined) {
    return undefined;
  }
  const color = paint.color;
  return [color[0], color[1], color[2], color[3] * paint.opacity];
}

/**
 * The options every §50 shape takes: the material it is filled with, the
 * flattening tolerance its curves are measured against, and the two
 * {@link RenderableOptions} fields every drawable carries.
 */
export interface Shape2DOptions<
  M extends Material = SurfaceMaterial,
> extends RenderableOptions {
  /**
   * Surface appearance (§57). **Required**, exactly as `Renderable`'s is: a
   * shape without a material draws nothing, and defaulting it would both hide
   * the mistake behind an invisible node and hand the application a resource it
   * never created and now owes a `dispose()` to (§83).
   *
   * §50's example writes `fill: "#4466ff"` *instead of* a material. That
   * remains deliberately unsupported: a shape that invented a material would
   * hand the application a resource it never created and now owes a
   * `dispose()` to, and §79 has no key to write for it. {@link
   * Shape2DOptions.fill} is §58's paint and sits **beside** the material —
   * see {@link Shape2D.fill}.
   */
  material: M;
  /**
   * Initial {@link Shape2D.tolerance} in world units; defaults to §51's
   * `DEFAULT_FLATTEN_TOLERANCE`.
   */
  tolerance?: number;
  /**
   * Initial {@link Shape2D.fill} (§58). Defaults to `"inherit"` — the
   * material's own colour — for every closed primitive, and to `"none"` for
   * the three stroke-only ones ({@link Line}, {@link Polyline}, {@link Arc}).
   */
  fill?: ShapeFill;
  /**
   * Initial {@link Shape2D.stroke} (§58). Defaults to `null`: no stroke.
   */
  stroke?: StrokeStyle | null;
}

/**
 * A 2D shape (§49, §50) — the abstract root of the shape family.
 *
 * A subclass supplies validated parameters and a {@link Shape2D.toPath}; this
 * class owns everything downstream of it: flattening, tessellation, stroke
 * expansion, the derived geometry, its dirtying, and its disposal. See the
 * module header for the tier this ships at and why there is still no
 * `ShapeMaterial`.
 *
 * Consumers can extend it: a class that answers `toPath()` with a §51 path is a
 * full member of the family, gets a rebuilt fill and stroke for free, and needs
 * nothing from this module that is not public.
 *
 * ## How a paint reaches the screen (decision, `R-16`, 2026-08-09)
 *
 * A fill and a stroke are two colours, and a node draws **one** geometry with
 * **one** material — §49's `material: Material[]` and the submesh ranges it
 * needs are `R-27`'s residue, not this packet's. So the two colours travel as
 * §53's **per-vertex colour stream**: the fill's triangles carry the fill
 * paint, the stroke's carry the stroke paint, and the §57 pipelines already
 * multiply `vertexColors` into the material's own colour
 * (`fragment = color × vColor`, `R-19`). One geometry, one draw, one material,
 * **no new render-item kind, no new backend pipeline, no frame-path edit** —
 * `R-23`'s property, kept.
 *
 * Two consequences an author has to know, both refused rather than surprising:
 *
 * - a material that does not multiply vertex colours cannot draw a paint, so
 *   authoring one on such a material throws (§85) naming `vertexColors: true`;
 * - the drawn colour is `material.color × paint`, so a material left at its
 *   `UnlitMaterial` default of white draws the paint exactly.
 */
export abstract class Shape2D<M extends Material = SurfaceMaterial>
  extends Renderable<M>
  implements Disposable
{
  /**
   * The owned geometry, kept privately as well as in the inherited `geometry`
   * slot — so the override and the rebuild never read through the accessor they
   * are overriding. Created once; its buffers are replaced, its id never
   * changes.
   */
  readonly #derived: BufferGeometry;

  #tolerance: number;

  #fill: ResolvedShapeFill;

  #stroke: ResolvedStrokeStyle | null;

  /** Whether the geometry still matches the shape's parameters. */
  #stale = true;

  #disposed = false;

  /**
   * Builds the shared half of a shape. The geometry is created **before**
   * `super()`, because `Renderable`'s constructor takes the geometry: a shape
   * owns its own rather than being handed one, so it hands its own to the base
   * and keeps the reference.
   */
  protected constructor(options: Shape2DOptions<M>) {
    const derived = new BufferGeometry({
      positions: new Float32Array(0),
      mode: "triangles",
    });
    super(derived, options.material, options);
    this.#derived = derived;
    this.#tolerance = requirePositive(
      "Shape2D tolerance",
      options.tolerance ?? DEFAULT_FLATTEN_TOLERANCE,
    );
    this.#fill = requireFill(options.fill ?? "inherit");
    this.#stroke =
      options.stroke === undefined || options.stroke === null
        ? null
        : requireStroke(options.stroke);
    requirePaintableMaterial(this.material, this.#paints);
  }

  /**
   * What fills this shape's interior (§50 "fill and stroke", §58) — a
   * {@link Paint}, `"inherit"` for the material's own colour, or `"none"`.
   *
   * ```ts
   * // §50's own example, in this repository's colour convention
   * const panel = new Rectangle({
   *   width: 2,
   *   height: 1,
   *   radius: 0.12,
   *   material: new UnlitMaterial({ vertexColors: true }),
   *   fill: { kind: "solid", color: [0.27, 0.4, 1, 1] },
   *   stroke: { width: 0.03, paint: { kind: "solid", color: [1, 1, 1, 1] } },
   * });
   * ```
   *
   * Validated and copied on assignment (§85); assigning rebuilds. `"none"`
   * skips the tessellation entirely, which is what makes an outline-only
   * rectangle cost no fill triangles rather than invisible ones.
   *
   * A shape whose path is **open** — {@link Line}, {@link Polyline},
   * {@link Arc}, or a {@link PathShape} over an unclosed path — fills as if it
   * were closed, SVG's and Canvas's rule, if you ask it to; the three
   * stroke-only primitives simply default to `"none"` so that nobody asks by
   * accident.
   */
  get fill(): ResolvedShapeFill {
    return this.#fill;
  }

  set fill(value: ShapeFill) {
    const fill = requireFill(value);
    requirePaintableMaterial(
      this.material,
      fill !== "inherit" && fill !== "none",
    );
    this.#fill = fill;
    this.markDirty();
  }

  /**
   * How this shape's outline is drawn (§50, §58's `StrokeStyle`), or `null`
   * for no stroke.
   *
   * Validated and **copied** on assignment (§85): what comes back is a fresh
   * record with every optional field resolved, so `shape.stroke.lineJoin`
   * reads `"miter"` rather than `undefined` and an in-place edit of the object
   * you passed cannot desynchronise the geometry from the style that built it.
   * Assigning rebuilds; there is deliberately no way to mutate a stroke in
   * place, which is the one place this family does *not* follow
   * {@link Polygon.points}' announce-it-yourself contract — a stroke is six
   * fields that have to agree, not one array.
   *
   * The band is expanded by §52's `expandStroke` at this shape's
   * {@link Shape2D.tolerance}, from the same flattening the fill uses.
   */
  get stroke(): ResolvedStrokeStyle | null {
    return this.#stroke;
  }

  set stroke(value: StrokeStyle | null) {
    const stroke = value === null ? null : requireStroke(value);
    requirePaintableMaterial(this.material, stroke?.paint !== undefined);
    this.#stroke = stroke;
    this.markDirty();
  }

  /** Whether either half of this shape names a §58 paint of its own. */
  get #paints(): boolean {
    return (
      (this.#fill !== "inherit" && this.#fill !== "none") ||
      this.#stroke?.paint !== undefined
    );
  }

  /**
   * Greatest distance, in world units, between this shape's curves and the
   * polyline that stands in for them (§51 "flatten", §52 "adaptive curve
   * subdivision"). Smaller is smoother and costs more vertices; assigning
   * rebuilds the fill.
   *
   * It is a **world-space** length, not a screen-space one: a shape that is
   * scaled up by its transform, or drawn by a camera that zooms in, does not
   * re-tessellate. Screen-space tolerance needs a per-view render list (`R-8`)
   * and a rebuild inside the frame, which §61 forbids throwing in and §33
   * forbids making frame-rate dependent.
   */
  get tolerance(): number {
    return this.#tolerance;
  }

  set tolerance(value: number) {
    this.#tolerance = requirePositive("Shape2D tolerance", value);
    this.markDirty();
  }

  /**
   * The fill and stroke this shape draws (§53), rebuilt on read whenever a
   * parameter has changed since the last one.
   *
   * Owned by the shape — do not dispose it yourself, and do not hand it to a
   * `Renderable`, which would then draw a geometry that changes under it.
   * Reading it is cheap: the rebuild is skipped unless something moved.
   *
   * Overrides `Renderable.geometry` with a **read-only** accessor, like
   * `Sprite`: a shape derives its geometry from its parameters, so there is
   * nothing sensible to assign.
   */
  override get geometry(): BufferGeometry {
    if (this.#stale) {
      this.#rebuild();
    }
    return this.#derived;
  }

  /** Whether {@link Shape2D.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * This shape as a §51 path, in the node's own local space — a **new** path on
   * every call, owned by the caller.
   *
   * ```ts
   * const outline = new Star({ points: 5, innerRadius: 0.4, outerRadius: 1, material })
   *   .toPath();
   * outline.length();          // perimeter in world units
   * outline.closestPoint(hit); // §51's query, on the real curve
   * ```
   *
   * This is the family's one polymorphic operation and the seam §50's "SVG
   * import/export compatibility" (`R-26`) and §51's boolean operations both
   * need: a consumer of a shape gets vector source data rather than a triangle
   * soup, and never has to learn which shape it is holding.
   *
   * A fresh path rather than a cached one because a `Path` is mutable: handing
   * out the shape's own would let a caller edit a rectangle into something that
   * is not the rectangle the shape's parameters describe, silently, until the
   * next rebuild threw it away.
   */
  abstract toPath(): Path;

  /**
   * Announces a parameter change the shape could not see — a write into a point
   * record handed to {@link Polygon}, or into the `Path` a {@link PathShape}
   * was built from. The geometry is rebuilt on the next read of
   * {@link Shape2D.geometry}, not here, so a burst of edits in one frame costs
   * one rebuild rather than one per edit.
   */
  markDirty(): void {
    this.#stale = true;
  }

  /**
   * Releases the geometry this shape owns (§83). Idempotent.
   *
   * **The material is not disposed**: it is shared, and §83 puts disposal on
   * whoever created it. After disposal the geometry has no vertices, so a
   * backend meeting this shape in a render list skips it — the behaviour a
   * disposed `BufferGeometry` already produces for a `Renderable`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#derived.dispose();
  }

  /**
   * Flattens this shape's path at the current tolerance, sorts the rings into
   * filled regions (§51's fill rules) and tessellates each (§52), then expands
   * the outline into its stroke band (§52, §58).
   *
   * **One `toPath()` and one flattening feed both halves.** Fill and stroke
   * disagreeing about where a curve is would show as a hairline of fill
   * outside its own outline, and the only way they cannot disagree is for the
   * flattening tolerance to be the shape's rather than the stroke's — which is
   * why §58's `StrokeStyle` here has no `tolerance` field even though §52's
   * `StrokeGeometryOptions` requires one.
   *
   * A disposed shape rebuilds nothing: `dispose()` is terminal and has already
   * emptied the geometry.
   */
  #rebuild(): void {
    this.#stale = false;
    if (this.#disposed) {
      return;
    }
    const path = this.toPath();
    const stroke = this.#stroke;
    rebuildFill(
      this.#derived,
      this.#fill === "none" ? [] : path.fillRings(this.#tolerance),
      stroke === null
        ? undefined
        : expandStroke(path.polylines(this.#tolerance), {
            ...stroke,
            tolerance: this.#tolerance,
          }),
      this.#fill === "inherit" || this.#fill === "none"
        ? undefined
        : paintColor(this.#fill),
      paintColor(stroke?.paint),
    );
  }
}

/** Options of {@link Circle} (§50 "circle"). */
export interface CircleOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Circle.radius}; defaults to 1. */
  radius?: number;
}

/**
 * A filled circle centred on the node origin (§49, §50 "circle").
 *
 * ```ts
 * const dot = new Circle({ radius: 0.25, material });
 * ```
 */
export class Circle<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #radius: number;

  constructor(options: CircleOptions<M>) {
    super(options);
    this.#radius = requirePositive("Circle radius", options.radius ?? 1);
  }

  /** Radius in world units; strictly positive (§85). Assigning rebuilds. */
  get radius(): number {
    return this.#radius;
  }

  set radius(value: number) {
    this.#radius = requirePositive("Circle radius", value);
    this.markDirty();
  }

  override toPath(): Path {
    return new Path().arc(0, 0, this.#radius, 0, TURN).close();
  }
}

/** Options of {@link Ellipse} (§50 "ellipse"). */
export interface EllipseOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Ellipse.radiusX}; defaults to 1. */
  radiusX?: number;
  /** Initial {@link Ellipse.radiusY}; defaults to 1. */
  radiusY?: number;
  /** Initial {@link Ellipse.startAngle} in radians; defaults to 0. */
  startAngle?: number;
}

/**
 * A filled ellipse centred on the node origin (§49, §50 "ellipse").
 *
 * The tilt is the ellipse's own, about its centre, and is deliberately kept
 * beside the radii rather than pushed onto the node transform: it is a
 * parameter of the shape (§51's `ellipse` command carries it), so a shape that
 * is a child of something else can be tilted without disturbing the transform
 * §42 says exactly one system owns.
 *
 * It is spelled `startAngle`, not `rotation`, and that is not taste: §6's
 * `Node` publishes `rotation` as the live alias of its transform's quaternion
 * (the §15/§97 idiom), so a shape parameter of that name would shadow the
 * node's own orientation — the compiler refuses it outright, which is how this
 * was found. `startAngle` is the family's one name for "where the outline
 * begins, measured from +X": an ellipse's outline begins on its rotated X
 * semi-axis, a regular polygon's at vertex 0, a star's at outer point 0, and a
 * sector's arc at exactly that angle.
 */
export class Ellipse<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #radiusX: number;

  #radiusY: number;

  #startAngle: number;

  constructor(options: EllipseOptions<M>) {
    super(options);
    this.#radiusX = requirePositive("Ellipse radiusX", options.radiusX ?? 1);
    this.#radiusY = requirePositive("Ellipse radiusY", options.radiusY ?? 1);
    this.#startAngle = requireFinite(
      "Ellipse startAngle",
      options.startAngle ?? 0,
    );
  }

  /** Semi-axis along the ellipse's own X; strictly positive (§85). */
  get radiusX(): number {
    return this.#radiusX;
  }

  set radiusX(value: number) {
    this.#radiusX = requirePositive("Ellipse radiusX", value);
    this.markDirty();
  }

  /** Semi-axis along the ellipse's own Y; strictly positive (§85). */
  get radiusY(): number {
    return this.#radiusY;
  }

  set radiusY(value: number) {
    this.#radiusY = requirePositive("Ellipse radiusY", value);
    this.markDirty();
  }

  /**
   * Counter-clockwise tilt of the ellipse's own frame, in radians (§7a, §7b) —
   * equivalently, where its outline begins, measured from +X. See the class
   * documentation for why it is not called `rotation`.
   */
  get startAngle(): number {
    return this.#startAngle;
  }

  set startAngle(value: number) {
    this.#startAngle = requireFinite("Ellipse startAngle", value);
    this.markDirty();
  }

  override toPath(): Path {
    return new Path()
      .ellipse(0, 0, this.#radiusX, this.#radiusY, this.#startAngle, 0, TURN)
      .close();
  }
}

/** Options of {@link Rectangle} (§50 "rectangle", "rounded rectangle"). */
export interface RectangleOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Rectangle.width}; defaults to 1. */
  width?: number;
  /** Initial {@link Rectangle.height}; defaults to 1. */
  height?: number;
  /** Initial {@link Rectangle.radius}; defaults to 0 (square corners). */
  radius?: number;
}

/**
 * A filled rectangle centred on the node origin, with optionally rounded
 * corners (§49, §50 "rectangle" and "rounded rectangle").
 *
 * ```ts
 * // §50's own example, in this repository's units and colour convention
 * const panel = new Rectangle({ width: 2, height: 1, radius: 0.12, material });
 * ```
 *
 * The corners straddle `(±width/2, ±height/2)`, matching `planeGeometry` and
 * `boxGeometry`. A `radius` of 0 — the default — gives four straight edges and
 * exactly four vertices; a positive one replaces each corner with a quarter
 * arc, written as four arcs whose connecting edges are *implicit*, because a
 * hand-written `lineTo` at an arc's analytic start point misses it by an ulp
 * and leaves a hairline spike (§51's own warning, and the recipe its tests
 * pin).
 */
export class Rectangle<
  M extends Material = SurfaceMaterial,
> extends Shape2D<M> {
  #width: number;

  #height: number;

  #radius: number;

  constructor(options: RectangleOptions<M>) {
    super(options);
    this.#width = requirePositive("Rectangle width", options.width ?? 1);
    this.#height = requirePositive("Rectangle height", options.height ?? 1);
    this.#radius = this.#checkRadius(options.radius ?? 0);
  }

  /** Full width in world units; strictly positive (§85). */
  get width(): number {
    return this.#width;
  }

  set width(value: number) {
    const width = requirePositive("Rectangle width", value);
    this.#checkRadius(this.#radius, width, this.#height);
    this.#width = width;
    this.markDirty();
  }

  /** Full height in world units; strictly positive (§85). */
  get height(): number {
    return this.#height;
  }

  set height(value: number) {
    const height = requirePositive("Rectangle height", value);
    this.#checkRadius(this.#radius, this.#width, height);
    this.#height = height;
    this.markDirty();
  }

  /**
   * Corner radius in world units; 0 for square corners (§50 "rounded
   * rectangle").
   *
   * Refused, never clamped (§85), when it exceeds half the shorter side —
   * a rectangle cannot have corners rounder than itself, and clamping would
   * make `rectangle.radius` read back a number the caller never wrote. The
   * check runs on every write to `width` and `height` too, so the three can
   * never disagree.
   */
  get radius(): number {
    return this.#radius;
  }

  set radius(value: number) {
    this.#radius = this.#checkRadius(value);
    this.markDirty();
  }

  override toPath(): Path {
    const halfWidth = this.#width / 2;
    const halfHeight = this.#height / 2;
    const radius = this.#radius;
    if (radius === 0) {
      return new Path()
        .moveTo(-halfWidth, -halfHeight)
        .lineTo(halfWidth, -halfHeight)
        .lineTo(halfWidth, halfHeight)
        .lineTo(-halfWidth, halfHeight)
        .close();
    }
    const insetX = halfWidth - radius;
    const insetY = halfHeight - radius;
    return new Path()
      .arc(insetX, -insetY, radius, -Math.PI / 2, 0)
      .arc(insetX, insetY, radius, 0, Math.PI / 2)
      .arc(-insetX, insetY, radius, Math.PI / 2, Math.PI)
      .arc(-insetX, -insetY, radius, Math.PI, 1.5 * Math.PI)
      .close();
  }

  /**
   * Validates a corner radius against the extents it has to fit inside (§85),
   * returning it. Zero is legal and is the square-cornered rectangle.
   */
  #checkRadius(
    value: number,
    width = this.#width,
    height = this.#height,
  ): number {
    requireFinite("Rectangle radius", value);
    const limit = Math.min(width, height) / 2;
    if (value < 0 || value > limit) {
      throw new RangeError(
        `Rectangle radius must be between 0 and half the shorter side ` +
          `(${String(limit)}); got ${String(value)} (§85).`,
      );
    }
    return value;
  }
}

/** Options of {@link RegularPolygon} (§50 "regular polygon"). */
export interface RegularPolygonOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link RegularPolygon.sides}; required, at least 3. */
  sides: number;
  /** Initial {@link RegularPolygon.radius}; defaults to 1. */
  radius?: number;
  /** Initial {@link RegularPolygon.startAngle} in radians; defaults to 0. */
  startAngle?: number;
}

/**
 * A filled regular polygon inscribed in a circle about the node origin (§50
 * "regular polygon").
 *
 * ```ts
 * const hexagon = new RegularPolygon({ sides: 6, radius: 1, material });
 * ```
 *
 * `sides` is required and every extent has a unit default, which is this
 * family's rule: a dimension with an obvious unit size defaults to 1, and a
 * parameter that *is* the shape's identity — the side count, a star's waist,
 * a sector's angles, a polygon's points — is required rather than invented.
 *
 * Vertex 0 lies at `startAngle` measured from +X and the walk is
 * counter-clockwise (§7a). The name is the family's, and is not `rotation`
 * because §6's `Node` already publishes that as its transform's quaternion —
 * see {@link Ellipse}.
 */
export class RegularPolygon<
  M extends Material = SurfaceMaterial,
> extends Shape2D<M> {
  #sides: number;

  #radius: number;

  #startAngle: number;

  constructor(options: RegularPolygonOptions<M>) {
    super(options);
    this.#sides = requireCount("RegularPolygon sides", options.sides, 3);
    this.#radius = requirePositive(
      "RegularPolygon radius",
      options.radius ?? 1,
    );
    this.#startAngle = requireFinite(
      "RegularPolygon startAngle",
      options.startAngle ?? 0,
    );
  }

  /** Number of sides; an integer of at least 3 (§85). */
  get sides(): number {
    return this.#sides;
  }

  set sides(value: number) {
    this.#sides = requireCount("RegularPolygon sides", value, 3);
    this.markDirty();
  }

  /** Circumradius in world units; strictly positive (§85). */
  get radius(): number {
    return this.#radius;
  }

  set radius(value: number) {
    this.#radius = requirePositive("RegularPolygon radius", value);
    this.markDirty();
  }

  /** Angle of vertex 0 from +X, in radians (§7b). */
  get startAngle(): number {
    return this.#startAngle;
  }

  set startAngle(value: number) {
    this.#startAngle = requireFinite("RegularPolygon startAngle", value);
    this.markDirty();
  }

  override toPath(): Path {
    const path = new Path();
    for (let i = 0; i < this.#sides; i += 1) {
      const angle = this.#startAngle + (TURN * i) / this.#sides;
      const x = this.#radius * Math.cos(angle);
      const y = this.#radius * Math.sin(angle);
      if (i === 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path.close();
  }
}

/** Options of {@link Star} (§50 "star"). */
export interface StarOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Star.points}; required, at least 2. */
  points: number;
  /** Initial {@link Star.innerRadius}; required, strictly positive. */
  innerRadius: number;
  /** Initial {@link Star.outerRadius}; required, greater than the inner one. */
  outerRadius: number;
  /** Initial {@link Star.startAngle} in radians; defaults to 0. */
  startAngle?: number;
}

/**
 * A filled star about the node origin (§50 "star") — `points` outer vertices
 * on the outer circle, alternating with `points` inner ones on the inner
 * circle.
 *
 * ```ts
 * const star = new Star({
 *   points: 5,
 *   innerRadius: 0.4,
 *   outerRadius: 1,
 *   startAngle: Math.PI / 2,   // the first point straight up
 *   material,
 * });
 * ```
 *
 * Both radii are required rather than defaulted: the ratio between them *is*
 * what a star looks like, and a default would be an invented aesthetic rather
 * than a size. Outer vertex 0 lies at `startAngle` from +X, so the default 0
 * points a star along +X — pass `Math.PI / 2` for the upright one.
 */
export class Star<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #points: number;

  #innerRadius: number;

  #outerRadius: number;

  #startAngle: number;

  constructor(options: StarOptions<M>) {
    super(options);
    this.#points = requireCount("Star points", options.points, 2);
    this.#innerRadius = requirePositive(
      "Star innerRadius",
      options.innerRadius,
    );
    this.#outerRadius = this.#checkOuter(options.outerRadius);
    this.#startAngle = requireFinite(
      "Star startAngle",
      options.startAngle ?? 0,
    );
  }

  /**
   * Number of points; an integer of at least 2 (§85). Two is a legal
   * degenerate star — a four-vertex lozenge — and is where the family's lower
   * bound honestly sits: one point encloses no area at all.
   */
  get points(): number {
    return this.#points;
  }

  set points(value: number) {
    this.#points = requireCount("Star points", value, 2);
    this.markDirty();
  }

  /** Radius of the waist vertices; strictly positive and below the outer (§85). */
  get innerRadius(): number {
    return this.#innerRadius;
  }

  set innerRadius(value: number) {
    requirePositive("Star innerRadius", value);
    this.#checkOuter(this.#outerRadius, value);
    this.#innerRadius = value;
    this.markDirty();
  }

  /** Radius of the point vertices; strictly greater than the inner one (§85). */
  get outerRadius(): number {
    return this.#outerRadius;
  }

  set outerRadius(value: number) {
    this.#outerRadius = this.#checkOuter(value);
    this.markDirty();
  }

  /** Angle of outer vertex 0 from +X, in radians (§7b). */
  get startAngle(): number {
    return this.#startAngle;
  }

  set startAngle(value: number) {
    this.#startAngle = requireFinite("Star startAngle", value);
    this.markDirty();
  }

  override toPath(): Path {
    const path = new Path();
    const step = TURN / (this.#points * 2);
    for (let i = 0; i < this.#points * 2; i += 1) {
      const radius = i % 2 === 0 ? this.#outerRadius : this.#innerRadius;
      const angle = this.#startAngle + step * i;
      const x = radius * Math.cos(angle);
      const y = radius * Math.sin(angle);
      if (i === 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    return path.close();
  }

  /**
   * Validates an outer radius against the inner one (§85). A star whose waist
   * reaches its points is a regular polygon written the wrong way round, and
   * one whose waist passes them is inside out — both are mistakes in the
   * caller, and neither is fixable by clamping.
   */
  #checkOuter(value: number, inner = this.#innerRadius): number {
    requirePositive("Star outerRadius", value);
    if (value <= inner) {
      throw new RangeError(
        `Star outerRadius must be greater than innerRadius (${String(inner)}); ` +
          `got ${String(value)} (§85).`,
      );
    }
    return value;
  }
}

/** Options of {@link Sector} (§50 "sector"). */
export interface SectorOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Sector.startAngle} in radians; required. */
  startAngle: number;
  /** Initial {@link Sector.endAngle} in radians; required. */
  endAngle: number;
  /** Initial {@link Sector.radius}; defaults to 1. */
  radius?: number;
}

/**
 * A filled circular sector — a pie slice — about the node origin (§50
 * "sector").
 *
 * ```ts
 * const quarter = new Sector({ startAngle: 0, endAngle: Math.PI / 2, material });
 * ```
 *
 * The region is bounded by the arc and the two radii to the centre; the sweep
 * follows §51's Canvas rule, measured counter-clockwise from `startAngle` and
 * wrapped into one turn, so `0 → 4π` and `0 → 2π` are both the whole disc. A
 * sweep of exactly zero is legal and encloses nothing, which is the state an
 * author animating a pie chart from empty passes through.
 */
export class Sector<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #radius: number;

  #startAngle: number;

  #endAngle: number;

  constructor(options: SectorOptions<M>) {
    super(options);
    this.#radius = requirePositive("Sector radius", options.radius ?? 1);
    this.#startAngle = requireFinite("Sector startAngle", options.startAngle);
    this.#endAngle = requireFinite("Sector endAngle", options.endAngle);
  }

  /** Radius in world units; strictly positive (§85). */
  get radius(): number {
    return this.#radius;
  }

  set radius(value: number) {
    this.#radius = requirePositive("Sector radius", value);
    this.markDirty();
  }

  /** Where the arc begins, in radians from +X (§7b). */
  get startAngle(): number {
    return this.#startAngle;
  }

  set startAngle(value: number) {
    this.#startAngle = requireFinite("Sector startAngle", value);
    this.markDirty();
  }

  /** Where the arc ends, in radians from +X, swept counter-clockwise (§7b). */
  get endAngle(): number {
    return this.#endAngle;
  }

  set endAngle(value: number) {
    this.#endAngle = requireFinite("Sector endAngle", value);
    this.markDirty();
  }

  override toPath(): Path {
    return new Path()
      .moveTo(0, 0)
      .arc(0, 0, this.#radius, this.#startAngle, this.#endAngle)
      .close();
  }
}

/** Options of {@link Ring} (§50 "ring"). */
export interface RingOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Ring.innerRadius}; required, strictly positive. */
  innerRadius: number;
  /** Initial {@link Ring.outerRadius}; defaults to 1. */
  outerRadius?: number;
}

/**
 * A filled annulus about the node origin (§50 "ring") — the disc of
 * `outerRadius` with the disc of `innerRadius` cut out of it.
 *
 * ```ts
 * const annulus = new Ring({ innerRadius: 0.6, outerRadius: 1, material });
 * ```
 *
 * The hole is a real hole, not two draws: the path carries the outer ring
 * counter-clockwise and the inner one **clockwise**, so §51's nonzero fill rule
 * sees winding zero inside the inner circle and `fillRings` hands §52's
 * tessellator one region with one hole. Authoring both rings the same way round
 * would fill the middle twice — which `fillRings` documents as its one
 * overlapping case, and which is invisible under an opaque fill and wrong under
 * a translucent one.
 */
export class Ring<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #innerRadius: number;

  #outerRadius: number;

  constructor(options: RingOptions<M>) {
    super(options);
    this.#innerRadius = requirePositive(
      "Ring innerRadius",
      options.innerRadius,
    );
    this.#outerRadius = this.#checkOuter(options.outerRadius ?? 1);
  }

  /** Radius of the hole; strictly positive and below the outer one (§85). */
  get innerRadius(): number {
    return this.#innerRadius;
  }

  set innerRadius(value: number) {
    requirePositive("Ring innerRadius", value);
    this.#checkOuter(this.#outerRadius, value);
    this.#innerRadius = value;
    this.markDirty();
  }

  /** Radius of the outer edge; strictly greater than the inner one (§85). */
  get outerRadius(): number {
    return this.#outerRadius;
  }

  set outerRadius(value: number) {
    this.#outerRadius = this.#checkOuter(value);
    this.markDirty();
  }

  override toPath(): Path {
    return new Path()
      .arc(0, 0, this.#outerRadius, 0, TURN)
      .close()
      .moveTo(this.#innerRadius, 0)
      .arc(0, 0, this.#innerRadius, 0, -TURN, true)
      .close();
  }

  /** Validates an outer radius against the hole it has to contain (§85). */
  #checkOuter(value: number, inner = this.#innerRadius): number {
    requirePositive("Ring outerRadius", value);
    if (value <= inner) {
      throw new RangeError(
        `Ring outerRadius must be greater than innerRadius (${String(inner)}); ` +
          `got ${String(value)} (§85).`,
      );
    }
    return value;
  }
}

/** Options of {@link Polygon} (§50 "arbitrary polygon"). */
export interface PolygonOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /**
   * Initial {@link Polygon.points}; required, at least three, copied into the
   * shape's own records.
   */
  points: readonly Point2D[];
}

/**
 * A filled arbitrary polygon (§49's `Polygon`, §50 "arbitrary polygon") — the
 * closed ring through `points`, in either winding.
 *
 * ```ts
 * const arrow = new Polygon({
 *   points: [{ x: 0, y: 1 }, { x: -1, y: -1 }, { x: 0, y: -0.4 }, { x: 1, y: -1 }],
 *   material,
 * });
 * ```
 *
 * Concave outlines are fine — that is what §52's tessellator is for. **Self-
 * intersecting ones are refused** at rebuild time with the tessellator's own
 * `RangeError`, because filling one needs a planar-subdivision pass that §52
 * stages rather than an approximation that quietly draws a shape the author did
 * not describe. The refusal surfaces on the read of `geometry`, not on the
 * write of `points`, since it is a property of the ring as a whole.
 *
 * Holes belong to {@link PathShape}: a polygon is one ring by §50's own
 * wording, and a path expresses any number of them under either fill rule.
 */
export class Polygon<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #points: Point2D[];

  constructor(options: PolygonOptions<M>) {
    super(options);
    this.#points = requirePoints(options.points);
  }

  /**
   * The polygon's vertices, in order — the shape's **own** records, rewritten
   * only through this accessor.
   *
   * Reading gives the live array: writing into a point directly is legal and
   * cheap, but invisible, so call {@link Shape2D.markDirty} afterwards — the
   * contract `Sprite.anchor` and `SpriteMaterial.tint` already carry. Assigning
   * validates and copies (§85).
   */
  get points(): readonly Point2D[] {
    return this.#points;
  }

  set points(value: readonly Point2D[]) {
    this.#points = requirePoints(value);
    this.markDirty();
  }

  override toPath(): Path {
    const path = new Path().moveTo(this.#points[0].x, this.#points[0].y);
    for (let i = 1; i < this.#points.length; i += 1) {
      path.lineTo(this.#points[i].x, this.#points[i].y);
    }
    return path.close();
  }
}

/** Validates and copies a polygon ring (§85). */
function requirePoints(points: readonly Point2D[]): Point2D[] {
  if (points.length < 3) {
    throw new RangeError(
      `Polygon points must contain at least 3 points; got ` +
        `${String(points.length)} (§85).`,
    );
  }
  return copyPoints("Polygon points", points);
}

/** Options of {@link PathShape} (§50 "path", "Bézier path"). */
export interface PathShapeOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /**
   * Initial {@link PathShape.path}; required. Held by reference, not copied —
   * see the property.
   */
  path: Path;
}

/**
 * A filled §51 path (§49's `Path` node, §50 "path" and "Bézier path").
 *
 * ```ts
 * const glyph = new PathShape({
 *   path: new Path()
 *     .moveTo(-1, -1).lineTo(1, -1).cubicCurveTo(1, 1, -1, 1, -1, -1).close(),
 *   material,
 * });
 * ```
 *
 * Every subpath contributes: `fillRings` sorts them into regions and holes
 * under the path's own `fillRule`, so a letter "O" is one region with one hole
 * and a letter "e" is two regions — an island in a hole comes back as its own
 * region rather than as a hole inside a hole, which §52 refuses.
 *
 * ## The name
 *
 * §49 spells this node `Path`. `@four/geometry` already publishes a `Path` —
 * §51's model, which is exactly the **data** this node draws — and the two
 * would collide in the umbrella's barrels precisely where an author needs both
 * in one expression. The suffix follows `ImageWidget`, which carries one for
 * the same reason (`Image` is a browser global), and `Line3D`, which §49 itself
 * disambiguates by suffix.
 */
export class PathShape<
  M extends Material = SurfaceMaterial,
> extends Shape2D<M> {
  #path: Path;

  constructor(options: PathShapeOptions<M>) {
    super(options);
    this.#path = options.path;
  }

  /**
   * The §51 path this shape fills — held **by reference**, not copied.
   *
   * A `Path` is source data a caller builds, keeps, and may go on editing; a
   * defensive copy would make `shape.path.lineTo(…)` silently affect nothing,
   * which is a worse failure than an aliased one. The contract is therefore the
   * one {@link Polygon.points} carries: edit it and call
   * {@link Shape2D.markDirty}, or assign a new path, which marks it for you.
   */
  get path(): Path {
    return this.#path;
  }

  set path(value: Path) {
    this.#path = value;
    this.markDirty();
  }

  /**
   * A **copy** of {@link PathShape.path}, per the family contract that
   * `toPath()` returns a path the caller owns. Cheap: §51's `clone` shares the
   * readonly command objects.
   */
  override toPath(): Path {
    return this.#path.clone();
  }
}

/** Options of {@link Line} (§50 "line"). */
export interface LineOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Line.start}; required, copied. */
  start: Point2D;
  /** Initial {@link Line.end}; required, copied. */
  end: Point2D;
  /**
   * How the segment is drawn (§58). **Required**, unlike every other shape's:
   * a line *is* its stroke, and one that defaulted to `null` would be a node
   * drawing nothing while claiming to draw a line — the failure mode whose
   * absence `R-23` recorded as the reason this class did not exist yet.
   */
  stroke: StrokeStyle;
  /** Initial {@link Shape2D.fill}; defaults to `"none"`. */
  fill?: ShapeFill;
}

/**
 * A straight segment between two points (§50 "line") — the first of the three
 * stroke-only primitives.
 *
 * ```ts
 * const axis = new Line({
 *   start: { x: -1, y: 0 },
 *   end: { x: 1, y: 0 },
 *   stroke: { width: 0.02, lineCap: "round" },
 *   material,
 * });
 * ```
 *
 * Both endpoints are in the node's own local space, like every other shape's
 * parameters, so a line is moved either by editing them or by moving the node
 * — and §42's transform authority is untouched either way.
 *
 * A zero-length line is legal and draws nothing: it is the state an author
 * animating an endpoint through its partner passes through, and refusing it
 * would be refusing a frame of an animation rather than a mistake. A dot at
 * that point is a {@link Circle}; §52's expansion says so in the same words.
 */
export class Line<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #start: Point2D;

  #end: Point2D;

  constructor(options: LineOptions<M>) {
    super({ ...options, fill: options.fill ?? "none" });
    this.#start = requirePoint("Line start", options.start);
    this.#end = requirePoint("Line end", options.end);
  }

  /** Where the segment begins, in local space; copied on assignment (§85). */
  get start(): Point2D {
    return this.#start;
  }

  set start(value: Point2D) {
    this.#start = requirePoint("Line start", value);
    this.markDirty();
  }

  /** Where the segment ends, in local space; copied on assignment (§85). */
  get end(): Point2D {
    return this.#end;
  }

  set end(value: Point2D) {
    this.#end = requirePoint("Line end", value);
    this.markDirty();
  }

  override toPath(): Path {
    return new Path()
      .moveTo(this.#start.x, this.#start.y)
      .lineTo(this.#end.x, this.#end.y);
  }
}

/** Options of {@link Polyline} (§50 "polyline"). */
export interface PolylineOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /**
   * Initial {@link Polyline.points}; required, at least two, copied into the
   * shape's own records.
   */
  points: readonly Point2D[];
  /** How the chain is drawn (§58). **Required**, for {@link Line}'s reason. */
  stroke: StrokeStyle;
  /** Initial {@link Shape2D.fill}; defaults to `"none"`. */
  fill?: ShapeFill;
}

/**
 * An open chain of segments (§50 "polyline") — {@link Polygon}'s unclosed
 * sibling.
 *
 * ```ts
 * const trace = new Polyline({
 *   points: samples,
 *   stroke: { width: 0.01, lineJoin: "round", lineCap: "round" },
 *   material,
 * });
 * ```
 *
 * **Open, and that is the whole difference from `Polygon`.** No segment runs
 * from the last point back to the first, so the two ends are capped and every
 * interior vertex is joined — which is why §50 lists them as two primitives
 * rather than one with a flag. Two points is the honest lower bound: a
 * one-point chain has no segment and strokes to nothing.
 *
 * Its `fill` defaults to `"none"`, but a fill *is* expressible: like SVG's own
 * `<polyline>`, an open ring fills as if closed, so `fill` on a chain that
 * nearly meets itself paints the region it nearly encloses.
 */
export class Polyline<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #points: Point2D[];

  constructor(options: PolylineOptions<M>) {
    super({ ...options, fill: options.fill ?? "none" });
    this.#points = requirePolylinePoints(options.points);
  }

  /**
   * The chain's vertices, in order — the shape's **own** records, rewritten
   * only through this accessor.
   *
   * Reading gives the live array; writing into a point directly is legal and
   * invisible, so call {@link Shape2D.markDirty} afterwards, exactly as
   * {@link Polygon.points} documents. Assigning validates and copies (§85).
   */
  get points(): readonly Point2D[] {
    return this.#points;
  }

  set points(value: readonly Point2D[]) {
    this.#points = requirePolylinePoints(value);
    this.markDirty();
  }

  override toPath(): Path {
    const path = new Path().moveTo(this.#points[0].x, this.#points[0].y);
    for (let i = 1; i < this.#points.length; i += 1) {
      path.lineTo(this.#points[i].x, this.#points[i].y);
    }
    return path;
  }
}

/** Options of {@link Arc} (§50 "arc"). */
export interface ArcOptions<
  M extends Material = SurfaceMaterial,
> extends Shape2DOptions<M> {
  /** Initial {@link Arc.startAngle} in radians; required. */
  startAngle: number;
  /** Initial {@link Arc.endAngle} in radians; required. */
  endAngle: number;
  /** Initial {@link Arc.radius}; defaults to 1. */
  radius?: number;
  /** How the curve is drawn (§58). **Required**, for {@link Line}'s reason. */
  stroke: StrokeStyle;
  /** Initial {@link Shape2D.fill}; defaults to `"none"`. */
  fill?: ShapeFill;
}

/**
 * An open circular arc about the node origin (§50 "arc") — the curve, not the
 * region.
 *
 * ```ts
 * const gauge = new Arc({
 *   radius: 1,
 *   startAngle: Math.PI,
 *   endAngle: 2 * Math.PI,
 *   stroke: { width: 0.06, lineCap: "round" },
 *   material,
 * });
 * ```
 *
 * §50 lists "arc", "sector" and "ring" as three primitives, and this is the
 * one of the three that is only a curve: {@link Sector} is the arc closed back
 * through the centre and {@link Ring} the arc's annulus, and both of those
 * ship a *region*. The parameters are {@link Sector}'s, deliberately — a
 * `Sector` and an `Arc` written with the same three numbers describe the same
 * curve, and the difference between them is exactly the two radii `Sector`
 * adds.
 *
 * The sweep follows §51's Canvas rule, counter-clockwise from `startAngle` and
 * wrapped into one turn, so `0 → 4π` and `0 → 2π` are both a whole circle. A
 * zero sweep draws nothing, which is where a dial animating from empty starts.
 */
export class Arc<M extends Material = SurfaceMaterial> extends Shape2D<M> {
  #radius: number;

  #startAngle: number;

  #endAngle: number;

  constructor(options: ArcOptions<M>) {
    super({ ...options, fill: options.fill ?? "none" });
    this.#radius = requirePositive("Arc radius", options.radius ?? 1);
    this.#startAngle = requireFinite("Arc startAngle", options.startAngle);
    this.#endAngle = requireFinite("Arc endAngle", options.endAngle);
  }

  /** Radius in world units; strictly positive (§85). */
  get radius(): number {
    return this.#radius;
  }

  set radius(value: number) {
    this.#radius = requirePositive("Arc radius", value);
    this.markDirty();
  }

  /** Where the curve begins, in radians from +X (§7b). */
  get startAngle(): number {
    return this.#startAngle;
  }

  set startAngle(value: number) {
    this.#startAngle = requireFinite("Arc startAngle", value);
    this.markDirty();
  }

  /** Where the curve ends, in radians from +X, swept counter-clockwise (§7b). */
  get endAngle(): number {
    return this.#endAngle;
  }

  set endAngle(value: number) {
    this.#endAngle = requireFinite("Arc endAngle", value);
    this.markDirty();
  }

  override toPath(): Path {
    return new Path().arc(0, 0, this.#radius, this.#startAngle, this.#endAngle);
  }
}

/** Validates and copies one point (§85). */
function requirePoint(name: string, point: Point2D): Point2D {
  return {
    x: requireFinite(`${name}.x`, point.x),
    y: requireFinite(`${name}.y`, point.y),
  };
}

/** Validates and copies a polyline's chain (§85). */
function requirePolylinePoints(points: readonly Point2D[]): Point2D[] {
  if (points.length < 2) {
    throw new RangeError(
      `Polyline points must contain at least 2 points; got ` +
        `${String(points.length)} (§85).`,
    );
  }
  return copyPoints("Polyline points", points);
}
