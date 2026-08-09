/**
 * The §51 path determinism scenario (§33, gap `R-24`) — one pass over a fixed
 * catalogue of paths plus seeded random ones, reduced to per-path checksums.
 *
 * ## Why this scenario has two halves, with two tiers
 *
 * `R-25` set the house rule for a §33 `cross-platform` claim: only `+`, `-`,
 * `*`, `/`, `%` and comparisons, the operations ECMA-262 defines as exactly
 * rounded, and no `Math.sin`, `Math.cos`, `Math.acos`, `Math.atan2` or
 * `Math.sqrt`, all of which it leaves implementation-approximated. §51's path
 * model cannot claim one tier under that rule, because it has two kinds of
 * segment:
 *
 * - **Béziers and lines** flatten by de Casteljau at `t = ½` — `(a + b) × 0.5`,
 *   one rounding and an exact halving — under a flatness test built from cross
 *   products compared against a squared tolerance. Nothing there is
 *   approximated, so the `bezier` half below claims **`cross-platform`**.
 * - **Arcs** are a centre and two angles, and a point on one *is*
 *   `centre + r·(cos θ, sin θ)`. There is no exact route to it. Worse, the
 *   sample *count* comes from `Math.acos` and a `Math.ceil`, so two conforming
 *   engines may legally differ by a whole sample at a tolerance that lands on
 *   the boundary. The `arc` half below therefore claims **`same-runtime`**, and
 *   says so in the golden.
 *
 * Splitting them is the point. A single averaged digest would let a future edit
 * introduce a `Math.hypot` into the Bézier path and hide inside the arc half's
 * weaker claim; two digests with two stated tiers do not allow that.
 *
 * ## Why the cross-platform half is exactly reproducible, bit for bit
 *
 * Its control points are **integers** and its tolerances are **powers of two**.
 * Midpoint subdivision of dyadic rationals is exact while the results stay
 * inside 53 bits, so every emitted coordinate is an exactly representable
 * dyadic rational — not a value that happens to agree to fifteen digits. The
 * determinism test asserts exactly that (`x × 2²⁴` is an integer), which is a
 * mechanical proof of the tier rather than a restatement of it.
 *
 * The checksum (plan D6) quantizes to 1e-6 before hashing; on dyadic values of
 * this size that quantization is itself exact, so it neither adds nor hides
 * anything.
 *
 * ## What each record covers
 *
 * Not only flattening: the exact operations are hashed too — `subdivide`,
 * `reverse`, `simplify` and the `fillRings` grouping (counts only, which are
 * integers). A golden that pinned flattening alone would not notice a change in
 * how a path is reversed, and `R-23` builds geometry from all of them.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * The arrangement WP-1.14 established and `R-25` reused: the determinism gate
 * demands the scenario run twice in-process **and** once in a fresh `node`
 * child, and those runs are only evidence if they execute the same code. So
 * this file is loaded by Vitest (through Vite) and by plain `node` (through its
 * default type-stripping), which means it must stay inside Node's **erasable
 * syntax** subset: type annotations, `interface`, `type` and `import type` are
 * fine; `enum`, `namespace`, constructor parameter properties and decorators
 * are not.
 */

import { SeededRandom } from "@four/core";
import { createChecksum } from "@four/diagnostics";
import { Path, type Point2D } from "@four/geometry";

/** Seed of the random half of each catalogue. Fixed forever; it is the input. */
export const SEED = 0x51a7d24c;

/** Random paths generated after each fixed catalogue. */
export const RANDOM_PATHS = 120;

/**
 * The two flattening tolerances every path is measured at.
 *
 * Powers of two, so `tolerance × tolerance` is exact and the flatness test
 * compares exactly representable values (see this file's header).
 */
export const TOLERANCES: readonly number[] = [0.25, 0.0625];

/** What one path produced. */
export interface PathRecord {
  readonly name: string;
  /** Flattened points across both tolerances. */
  readonly points: number;
  /** Checksum of everything the path was asked for. */
  readonly digest: number;
}

/** One tier's half of the run. */
export interface PathTierResult {
  /** The §33 tier this half claims — and the whole reason for the split. */
  readonly tier: string;
  readonly paths: number;
  readonly points: number;
  readonly records: readonly PathRecord[];
  /** Checksum over every record, in order. */
  readonly summaryDigest: number;
}

/** The whole run: two halves, two tiers, two digests. */
export interface PathScenarioResult {
  /** Lines and Béziers only — `cross-platform`. */
  readonly bezier: PathTierResult;
  /** Arcs — `same-runtime`. */
  readonly arc: PathTierResult;
}

/** A path under test, with a name for failure output. */
export interface NamedPath {
  readonly name: string;
  readonly path: Path;
}

/** The hand-written half of the Bézier catalogue. */
function fixedBezierPaths(): NamedPath[] {
  const square = new Path()
    .moveTo(-8, -8)
    .lineTo(8, -8)
    .lineTo(8, 8)
    .lineTo(-8, 8)
    .close();

  const letterO = new Path()
    .moveTo(-6, -9)
    .lineTo(6, -9)
    .lineTo(6, 9)
    .lineTo(-6, 9)
    .close()
    .moveTo(-3, -5)
    .lineTo(-3, 5)
    .lineTo(3, 5)
    .lineTo(3, -5)
    .close();

  const island = new Path({ fillRule: "even-odd" })
    .moveTo(-12, -12)
    .lineTo(12, -12)
    .lineTo(12, 12)
    .lineTo(-12, 12)
    .close()
    .moveTo(-8, -8)
    .lineTo(-8, 8)
    .lineTo(8, 8)
    .lineTo(8, -8)
    .close()
    .moveTo(-2, -2)
    .lineTo(2, -2)
    .lineTo(2, 2)
    .lineTo(-2, 2)
    .close();

  const wave = new Path()
    .moveTo(-16, 0)
    .quadraticCurveTo(-8, 12, 0, 0)
    .quadraticCurveTo(8, -12, 16, 0);

  const blob = new Path()
    .moveTo(0, -10)
    .cubicCurveTo(10, -10, 10, 10, 0, 10)
    .cubicCurveTo(-10, 10, -10, -10, 0, -10)
    .close();

  const collinear = new Path()
    .moveTo(0, 0)
    .lineTo(4, 0)
    .lineTo(8, 0)
    .lineTo(8, 8)
    .lineTo(0, 8)
    .close();

  const openWithGap = new Path()
    .moveTo(0, 0)
    .lineTo(6, 0)
    .close()
    .lineTo(0, 6)
    .cubicCurveTo(2, 8, 4, 8, 6, 6);

  return [
    { name: "square", path: square },
    { name: "letter-O", path: letterO },
    { name: "island", path: island },
    { name: "wave", path: wave },
    { name: "blob", path: blob },
    { name: "collinear", path: collinear },
    { name: "open-with-gap", path: openWithGap },
  ];
}

/**
 * The seeded half of the Bézier catalogue: integer control points on a ±32
 * grid, so every subdivision stays an exactly representable dyadic rational.
 */
function randomBezierPaths(): NamedPath[] {
  const random = new SeededRandom(SEED);
  const coordinate = (): number => Math.floor(random.nextFloat01() * 65) - 32;
  const paths: NamedPath[] = [];
  for (let index = 0; index < RANDOM_PATHS; index += 1) {
    const path = new Path({
      fillRule: index % 2 === 0 ? "nonzero" : "even-odd",
    });
    path.moveTo(coordinate(), coordinate());
    const segments = 2 + Math.floor(random.nextFloat01() * 5);
    for (let i = 0; i < segments; i += 1) {
      const kind = Math.floor(random.nextFloat01() * 3);
      if (kind === 0) {
        path.lineTo(coordinate(), coordinate());
      } else if (kind === 1) {
        path.quadraticCurveTo(
          coordinate(),
          coordinate(),
          coordinate(),
          coordinate(),
        );
      } else {
        path.cubicCurveTo(
          coordinate(),
          coordinate(),
          coordinate(),
          coordinate(),
          coordinate(),
          coordinate(),
        );
      }
    }
    if (random.nextFloat01() < 0.5) {
      path.close();
    }
    paths.push({ name: `bezier-${String(index)}`, path });
  }
  return paths;
}

/** The hand-written half of the arc catalogue. */
function fixedArcPaths(): NamedPath[] {
  const circle = new Path().arc(0, 0, 10, 0, Math.PI * 2).close();

  const roundedRectangle = new Path()
    .arc(6, -2, 2, -Math.PI / 2, 0)
    .arc(6, 2, 2, 0, Math.PI / 2)
    .arc(-6, 2, 2, Math.PI / 2, Math.PI)
    .arc(-6, -2, 2, Math.PI, 1.5 * Math.PI)
    .close();

  const sector = new Path()
    .moveTo(0, 0)
    .arc(0, 0, 8, 0, Math.PI / 3)
    .close();

  // The `moveTo` is load-bearing: after a `close` the current point is the
  // closed subpath's first point, and an arc without one would be joined to it
  // by the implicit segment rather than starting a disjoint ring.
  const ring = new Path()
    .arc(0, 0, 10, 0, Math.PI * 2)
    .close()
    .moveTo(5, 0)
    .arc(0, 0, 5, 0, -Math.PI * 2, true)
    .close();

  const ellipse = new Path()
    .ellipse(0, 0, 12, 4, Math.PI / 6, 0, Math.PI * 2)
    .close();

  const mixed = new Path()
    .moveTo(-10, 0)
    .lineTo(-4, 0)
    .arc(0, 0, 4, Math.PI, 0, true)
    .cubicCurveTo(6, 4, 8, 6, 10, 0);

  return [
    { name: "circle", path: circle },
    { name: "rounded-rectangle", path: roundedRectangle },
    { name: "sector", path: sector },
    { name: "ring", path: ring },
    { name: "ellipse", path: ellipse },
    { name: "mixed", path: mixed },
  ];
}

/** The seeded half of the arc catalogue. */
function randomArcPaths(): NamedPath[] {
  const random = new SeededRandom(SEED);
  const paths: NamedPath[] = [];
  for (let index = 0; index < RANDOM_PATHS; index += 1) {
    const path = new Path();
    const centerX = Math.floor(random.nextFloat01() * 21) - 10;
    const centerY = Math.floor(random.nextFloat01() * 21) - 10;
    const radiusX = 1 + Math.floor(random.nextFloat01() * 8);
    const radiusY = 1 + Math.floor(random.nextFloat01() * 8);
    const quarter = Math.PI / 2;
    const rotation = Math.floor(random.nextFloat01() * 4) * quarter;
    const start = Math.floor(random.nextFloat01() * 8) * (quarter / 2);
    const sweep = 1 + Math.floor(random.nextFloat01() * 8);
    path.ellipse(
      centerX,
      centerY,
      radiusX,
      radiusY,
      rotation,
      start,
      start + sweep * (quarter / 2),
      random.nextFloat01() < 0.5,
    );
    if (random.nextFloat01() < 0.5) {
      path.close();
    }
    paths.push({ name: `arc-${String(index)}`, path });
  }
  return paths;
}

/** The Bézier catalogue: the fixed paths, then the seeded ones. */
export function bezierCatalogue(): NamedPath[] {
  return [...fixedBezierPaths(), ...randomBezierPaths()];
}

/** The arc catalogue: the fixed paths, then the seeded ones. */
export function arcCatalogue(): NamedPath[] {
  return [...fixedArcPaths(), ...randomArcPaths()];
}

/** Feeds a ring's coordinates to a checksum, in order. */
function absorbPoints(
  checksum: { addFloat: (x: number) => void },
  points: readonly Point2D[],
): void {
  for (const point of points) {
    checksum.addFloat(point.x);
    checksum.addFloat(point.y);
  }
}

/**
 * Feeds a path's command list to a checksum: the kinds as integers, then every
 * number each command carries, in declaration order.
 */
function absorbCommands(
  checksum: { addFloat: (x: number) => void },
  path: Path,
): void {
  for (const command of path.commands) {
    if (command.kind === "move" || command.kind === "line") {
      checksum.addFloat(command.kind === "move" ? 0 : 1);
      checksum.addFloat(command.x);
      checksum.addFloat(command.y);
    } else if (command.kind === "quadratic") {
      checksum.addFloat(2);
      checksum.addFloat(command.controlX);
      checksum.addFloat(command.controlY);
      checksum.addFloat(command.x);
      checksum.addFloat(command.y);
    } else if (command.kind === "cubic") {
      checksum.addFloat(3);
      checksum.addFloat(command.control1X);
      checksum.addFloat(command.control1Y);
      checksum.addFloat(command.control2X);
      checksum.addFloat(command.control2Y);
      checksum.addFloat(command.x);
      checksum.addFloat(command.y);
    } else if (command.kind === "arc") {
      checksum.addFloat(4);
      checksum.addFloat(command.centerX);
      checksum.addFloat(command.centerY);
      checksum.addFloat(command.radiusX);
      checksum.addFloat(command.radiusY);
      checksum.addFloat(command.rotation);
      checksum.addFloat(command.startAngle);
      checksum.addFloat(command.deltaAngle);
    } else {
      checksum.addFloat(5);
    }
  }
}

/**
 * Runs one path through everything the golden pins, returning its record.
 *
 * `measure` adds the operations that take a square root — length, tangent,
 * closest point. They are only asked of the `same-runtime` half, because a
 * `Math.sqrt` in the `cross-platform` half would quietly demote the claim the
 * golden makes for it.
 */
function recordPath(entry: NamedPath, measure: boolean): PathRecord {
  const checksum = createChecksum();
  let points = 0;

  for (const tolerance of TOLERANCES) {
    for (const ring of entry.path.flatten(tolerance)) {
      points += ring.length;
      checksum.addFloat(ring.length);
      absorbPoints(checksum, ring);
    }
    const groups = entry.path.fillRings(tolerance);
    checksum.addFloat(groups.length);
    for (const group of groups) {
      checksum.addFloat(group.outline.length);
      checksum.addFloat(group.holes.length);
      for (const hole of group.holes) {
        checksum.addFloat(hole.length);
      }
    }
  }

  absorbCommands(checksum, entry.path.subdivide(2));
  absorbCommands(checksum, entry.path.reverse());
  absorbCommands(checksum, entry.path.simplify(0.25));

  if (measure) {
    const length = entry.path.length(TOLERANCES[1]);
    checksum.addFloat(length);
    if (length > 0) {
      for (let i = 0; i <= 8; i += 1) {
        const t = i / 8;
        const point = entry.path.pointAt(t, TOLERANCES[1]);
        const tangent = entry.path.tangentAt(t, TOLERANCES[1]);
        checksum.addFloat(point.x);
        checksum.addFloat(point.y);
        checksum.addFloat(tangent.x);
        checksum.addFloat(tangent.y);
      }
      const nearest = entry.path.closestPoint({ x: 3, y: 4 }, TOLERANCES[1]);
      checksum.addFloat(nearest.point.x);
      checksum.addFloat(nearest.point.y);
      checksum.addFloat(nearest.distance);
      checksum.addFloat(nearest.t);
    }
  }

  return { name: entry.name, points, digest: checksum.digest() };
}

/** Runs one tier's catalogue. */
function runTier(
  tier: string,
  catalogue: readonly NamedPath[],
  measure: boolean,
): PathTierResult {
  const records: PathRecord[] = [];
  const summary = createChecksum();
  let points = 0;
  for (const entry of catalogue) {
    const record = recordPath(entry, measure);
    records.push(record);
    points += record.points;
    summary.addFloat(record.points);
    summary.addFloat(record.digest);
  }
  return {
    tier,
    paths: catalogue.length,
    points,
    records,
    summaryDigest: summary.digest(),
  };
}

/** Runs both halves of the scenario. */
export function runPathScenario(): PathScenarioResult {
  return {
    bezier: runTier("cross-platform", bezierCatalogue(), false),
    arc: runTier("same-runtime", arcCatalogue(), true),
  };
}
