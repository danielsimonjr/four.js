/**
 * The §52 tessellation determinism scenario (§33, gap `R-25`) — one pass over a
 * fixed catalogue of polygons plus 200 seeded random ones, reduced to a
 * per-shape checksum of the index array the tessellator produced.
 *
 * §52's module is the load-bearing prerequisite of the whole 2D stack, and
 * "same input, same triangles" is the property everything above it — a `Path`'s
 * cached fill, a shape node's geometry, a pixel golden, a replay — quietly
 * assumes. This file is that sentence, executable: it builds the polygons from
 * arithmetic that is exact, tessellates each one, and checksums the resulting
 * indices.
 *
 * ## Why this scenario can claim `cross-platform`, not just `same-runtime`
 *
 * Every other determinism scenario in this directory reaches §33's
 * `same-runtime` tier and says so, because its inputs are computed with
 * `Math.sin`, `Math.exp` or `**`, whose last bits ECMA-262 leaves to the
 * implementation. This one reaches **`cross-platform`**:
 *
 * - the tessellator itself uses only `+`, `-`, `*`, `/` and comparisons, the
 *   exactly-rounded IEEE-754 operations (see `packages/geometry/src/
 *   tessellation.ts` for the full argument);
 * - the polygons are built from `SeededRandom` — whose `nextFloat01` is a
 *   uint32 scaled by an exact power of two — and then **snapped to integers**,
 *   so every coordinate is exactly representable and identical everywhere;
 * - the output is an integer index array, and the checksum over it (plan D6)
 *   is integer arithmetic.
 *
 * There is therefore no step between the seed and the golden where two
 * conforming engines are allowed to differ. A mismatch is a behaviour change,
 * never a platform difference — which is what makes `golden/tessellation.json`
 * worth committing.
 *
 * ## Refusals are part of the record
 *
 * The random polygons are *not* filtered to the ones that tessellate. Roughly a
 * quarter of them self-intersect, and §52's tier refuses those (§85) — so the
 * scenario records the refusal alongside the successes and checksums the two
 * counts. That makes the golden sensitive to a change in what the module
 * accepts, not only to a change in how it cuts up what it accepts: silently
 * starting to tessellate a self-intersecting star would move these numbers.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * The same arrangement WP-1.14 established: the determinism gate demands the
 * scenario run twice in-process **and** once in a fresh `node` child process,
 * and those runs are only evidence if they execute the same code. So this file
 * is loaded by Vitest (through Vite) and by plain `node` (through its default
 * type-stripping). The constraint that imposes: it must stay within Node's
 * **erasable-syntax subset** — type annotations, `interface`, `type` and
 * `import type` are fine; `enum`, `namespace`, constructor parameter
 * properties and decorators are not.
 */

import { SeededRandom } from "@four/core";
import { createChecksum } from "@four/diagnostics";
import { triangulatePolygon, type Point2D } from "@four/geometry";

/** Seed of the random half of the catalogue. Fixed forever; it is the input. */
export const SEED = 0x4f5231a7;

/** Random polygons generated after the fixed catalogue. */
export const RANDOM_SHAPES = 200;

/** A polygon under test: an outline, its holes, and a name for failure output. */
export interface ScenarioShape {
  readonly name: string;
  readonly outline: readonly Point2D[];
  readonly holes: readonly (readonly Point2D[])[];
}

/** What one shape produced. */
export interface ShapeRecord {
  readonly name: string;
  /** Triangles emitted, or `-1` when the tessellator refused the shape. */
  readonly triangles: number;
  /** Checksum of the index array, or `0` for a refusal. */
  readonly digest: number;
}

/** The whole run, reduced to what a golden can pin. */
export interface TessellationScenarioResult {
  readonly shapes: number;
  readonly tessellated: number;
  readonly refused: number;
  /** Total triangles across every shape that tessellated. */
  readonly triangles: number;
  readonly records: readonly ShapeRecord[];
  /** Checksum over every record, in order. */
  readonly summaryDigest: number;
}

/** Builds a ring from a flat `x, y, x, y, …` list. */
function ring(coordinates: readonly number[]): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i < coordinates.length; i += 2) {
    points.push({ x: coordinates[i], y: coordinates[i + 1] });
  }
  return points;
}

/**
 * The hand-written half of the catalogue: one shape per property §52's polygon
 * tier has to get right, so a red test names the property rather than a seed.
 */
function fixedShapes(): ScenarioShape[] {
  return [
    { name: "square", outline: ring([0, 0, 4, 0, 4, 4, 0, 4]), holes: [] },
    {
      name: "square-clockwise",
      outline: ring([0, 4, 4, 4, 4, 0, 0, 0]),
      holes: [],
    },
    {
      name: "L",
      outline: ring([0, 0, 4, 0, 4, 2, 2, 2, 2, 4, 0, 4]),
      holes: [],
    },
    {
      name: "comb",
      outline: ring([
        0, 0, 12, 0, 12, 6, 10, 6, 10, 2, 8, 2, 8, 6, 6, 6, 6, 2, 4, 2, 4, 6, 2,
        6, 2, 2, 0, 2,
      ]),
      holes: [],
    },
    {
      name: "collinear-run",
      outline: ring([0, 0, 2, 0, 4, 0, 4, 4, 2, 4, 0, 4]),
      holes: [],
    },
    {
      name: "frame-one-hole",
      outline: ring([-8, -8, 8, -8, 8, 8, -8, 8]),
      holes: [ring([-3, -3, -3, 3, 3, 3, 3, -3])],
    },
    {
      name: "frame-two-holes",
      outline: ring([-16, -8, 16, -8, 16, 8, -16, 8]),
      holes: [
        ring([-12, -4, -12, 4, -6, 4, -6, -4]),
        ring([6, -4, 6, 4, 12, 4, 12, -4]),
      ],
    },
    {
      name: "hole-in-concave",
      outline: ring([0, 0, 16, 0, 16, 6, 8, 6, 8, 16, 0, 16]),
      holes: [ring([2, 2, 2, 4, 6, 4, 6, 2])],
    },
  ];
}

/**
 * A random star-shaped outline on an integer grid: `sides` vertices at evenly
 * spaced angles with randomized radii.
 *
 * The angles come from a table of exact integer direction vectors rather than
 * from `Math.cos`/`Math.sin`, so the whole scenario stays inside the four exact
 * arithmetic operations. Twelve directions is enough spread to produce concave
 * outlines, self-intersecting ones, and everything between.
 */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [4, 0],
  [3, 2],
  [2, 3],
  [0, 4],
  [-2, 3],
  [-3, 2],
  [-4, 0],
  [-3, -2],
  [-2, -3],
  [0, -4],
  [2, -3],
  [3, -2],
];

/** Generates the seeded half of the catalogue. */
function randomShapes(): ScenarioShape[] {
  const random = new SeededRandom(SEED);
  const shapes: ScenarioShape[] = [];
  for (let index = 0; index < RANDOM_SHAPES; index += 1) {
    const sides =
      3 + Math.floor(random.nextFloat01() * (DIRECTIONS.length - 2));
    const step = Math.floor(DIRECTIONS.length / sides);
    const outline: Point2D[] = [];
    for (let i = 0; i < sides; i += 1) {
      const [dx, dy] = DIRECTIONS[(i * step) % DIRECTIONS.length];
      const scale = 2 + Math.floor(random.nextFloat01() * 8);
      outline.push({ x: dx * scale, y: dy * scale });
    }

    const holes: Point2D[][] = [];
    if (random.nextFloat01() < 0.4) {
      const cx = Math.floor(random.nextFloat01() * 9) - 4;
      const cy = Math.floor(random.nextFloat01() * 9) - 4;
      const w = 1 + Math.floor(random.nextFloat01() * 3);
      const h = 1 + Math.floor(random.nextFloat01() * 3);
      holes.push(
        ring([cx - w, cy - h, cx - w, cy + h, cx + w, cy + h, cx + w, cy - h]),
      );
    }
    shapes.push({ name: `random-${String(index)}`, outline, holes });
  }
  return shapes;
}

/** The full catalogue: the fixed shapes, then the seeded ones. */
export function scenarioShapes(): ScenarioShape[] {
  return [...fixedShapes(), ...randomShapes()];
}

/**
 * Tessellates every shape in the catalogue and reduces the run to checksums.
 *
 * A refusal is recorded, not thrown: §52's tier refuses self-intersecting
 * input, the random half produces plenty of it, and *which* shapes are refused
 * is part of what the golden pins.
 */
export function runTessellationScenario(): TessellationScenarioResult {
  const shapes = scenarioShapes();
  const records: ShapeRecord[] = [];
  const summary = createChecksum();
  let tessellated = 0;
  let refused = 0;
  let triangles = 0;

  for (const shape of shapes) {
    let record: ShapeRecord;
    try {
      const indices = triangulatePolygon(shape.outline, shape.holes);
      const checksum = createChecksum();
      checksum.addFloats(indices);
      record = {
        name: shape.name,
        triangles: indices.length / 3,
        digest: checksum.digest(),
      };
      tessellated += 1;
      triangles += indices.length / 3;
    } catch {
      // The message is deliberately not hashed: it is prose, and a reworded
      // refusal is not a behaviour change. That a shape *was* refused is.
      record = { name: shape.name, triangles: -1, digest: 0 };
      refused += 1;
    }
    records.push(record);
    summary.addFloat(record.triangles);
    summary.addFloat(record.digest);
  }

  return {
    shapes: shapes.length,
    tessellated,
    refused,
    triangles,
    records,
    summaryDigest: summary.digest(),
  };
}
