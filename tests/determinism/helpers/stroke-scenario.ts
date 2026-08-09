/**
 * The §52 stroke-expansion determinism scenario (§33, gap `R-16`) — one pass
 * over a fixed catalogue of polylines crossed with §58's option matrix,
 * reduced to a per-case checksum of the vertices and indices `expandStroke`
 * produced.
 *
 * ## The tier this claims is `same-runtime`, and its neighbour claims more
 *
 * `tessellation-scenario.ts` reaches §33's **cross-platform** tier and says so
 * at length: the fill tessellator is built from `+`, `-`, `*`, `/` and
 * comparisons alone. Stroke expansion cannot make that claim, and pretending
 * otherwise would be the exact failure `R-24` recorded — *a determinism tier is
 * a property of the operation, not of the module*, and merging two tiers into
 * one golden lets a transcendental hide inside the stronger claim. Offsetting a
 * polyline by a fixed distance needs a **unit normal**, so `Math.sqrt` is
 * unavoidable; a round join or cap needs `Math.acos` for its sample count and
 * `Math.cos`/`Math.sin` for its sample values. ECMA-262 leaves all four
 * implementation-approximated.
 *
 * So this scenario pins what it can honestly pin: the same engine, given the
 * same input, produces the same triangles — across runs, across heaps, across
 * processes. Everything the scenario itself controls is exact anyway (the
 * polylines are integer coordinates, the widths and dash lengths are dyadic,
 * the checksum is integer arithmetic), so a mismatch inside one runtime is a
 * behaviour change and never noise.
 *
 * ## What the catalogue is chosen to cover
 *
 * One case per branch a stroke can take: an open chain and a closed ring, every
 * alignment, every cap, every join, a miter that falls back to a bevel, a
 * hairpin, a dashed pattern crossing a ring's seam, and a flattened curve whose
 * hundreds of near-collinear corners are where a join rule's arithmetic is most
 * visible. A digest that matched while, say, the miter limit stopped firing
 * would have to survive all of them.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * The arrangement its neighbours use, for the same reason and under the same
 * constraint: it is loaded by Vitest (through Vite) and by plain `node`
 * (through its default type-stripping), so it must stay inside Node's
 * **erasable-syntax subset** — type annotations, `interface`, `type` and
 * `import type` are fine; `enum`, `namespace`, constructor parameter properties
 * and decorators are not.
 */

import { SeededRandom } from "@four/core";
import { createChecksum } from "@four/diagnostics";
import {
  Path,
  expandStroke,
  type Point2D,
  type Polyline2D,
  type StrokeGeometryOptions,
} from "@four/geometry";

/** Seed of the random half of the catalogue. Fixed forever; it is the input. */
export const SEED = 0x16b0a3d5;

/** Random chains generated after the fixed catalogue. */
export const RANDOM_CHAINS = 40;

/** One stroke under test: the polylines, the style, and a name. */
export interface ScenarioStroke {
  readonly name: string;
  readonly polylines: readonly Polyline2D[];
  readonly options: StrokeGeometryOptions;
}

/** What one stroke produced. */
export interface StrokeRecord {
  readonly name: string;
  /** Triangles emitted; zero when the input contributed nothing. */
  readonly triangles: number;
  /** Vertices placed. */
  readonly vertices: number;
  /** Checksum over every coordinate and every index, in order. */
  readonly digest: number;
}

/** The whole run, reduced to what a golden can pin. */
export interface StrokeScenarioResult {
  readonly strokes: number;
  readonly triangles: number;
  readonly vertices: number;
  readonly records: readonly StrokeRecord[];
  /** Checksum over every record, in order. */
  readonly summaryDigest: number;
}

/** Builds a polyline from a flat `x, y, x, y, …` list. */
function chain(coordinates: readonly number[], closed: boolean): Polyline2D {
  const points: Point2D[] = [];
  for (let i = 0; i < coordinates.length; i += 2) {
    points.push({ x: coordinates[i], y: coordinates[i + 1] });
  }
  return { points, closed };
}

const OPEN_CORNER = chain([0, 0, 8, 0, 8, 8], false);
const CLOSED_SQUARE = chain([-8, -8, 8, -8, 8, 8, -8, 8], true);
const SPIKE = chain([0, 0, 16, 0, 0, 1], false);
const HAIRPIN = chain([0, 0, 16, 0, 0, 0], false);
const STAIRCASE = chain(
  [0, 0, 4, 0, 4, 4, 8, 4, 8, 8, 12, 8, 12, 12, 16, 12],
  false,
);

/**
 * The hand-written half of the catalogue: one case per branch §58's option
 * record can take, so a red test names the property rather than a seed.
 */
function fixedStrokes(): ScenarioStroke[] {
  const base = { width: 2, tolerance: 0.03125 };
  const cases: ScenarioStroke[] = [
    { name: "open-butt-miter", polylines: [OPEN_CORNER], options: base },
    {
      name: "open-square-bevel",
      polylines: [OPEN_CORNER],
      options: { ...base, lineCap: "square", lineJoin: "bevel" },
    },
    {
      name: "open-round-round",
      polylines: [OPEN_CORNER],
      options: { ...base, lineCap: "round", lineJoin: "round" },
    },
    {
      name: "open-inside",
      polylines: [OPEN_CORNER],
      options: { ...base, alignment: "inside", lineCap: "round" },
    },
    {
      name: "open-outside",
      polylines: [OPEN_CORNER],
      options: { ...base, alignment: "outside", lineCap: "square" },
    },
    { name: "closed-miter", polylines: [CLOSED_SQUARE], options: base },
    {
      name: "closed-round",
      polylines: [CLOSED_SQUARE],
      options: { ...base, lineJoin: "round" },
    },
    {
      name: "closed-inside",
      polylines: [CLOSED_SQUARE],
      options: { ...base, alignment: "inside" },
    },
    {
      name: "spike-miter-generous",
      polylines: [SPIKE],
      options: { ...base, miterLimit: 64 },
    },
    {
      name: "spike-miter-bevelled",
      polylines: [SPIKE],
      options: { ...base, miterLimit: 2 },
    },
    {
      name: "hairpin-round",
      polylines: [HAIRPIN],
      options: { ...base, lineJoin: "round", lineCap: "round" },
    },
    { name: "hairpin-miter", polylines: [HAIRPIN], options: base },
    {
      name: "staircase-dashed",
      polylines: [STAIRCASE],
      options: { ...base, dash: [3, 1.5], lineCap: "round" },
    },
    {
      name: "closed-dashed-seam",
      polylines: [CLOSED_SQUARE],
      options: { ...base, dash: [12, 4], dashOffset: 6, lineCap: "square" },
    },
    {
      name: "closed-dashed-odd",
      polylines: [CLOSED_SQUARE],
      options: { ...base, dash: [5], lineJoin: "bevel" },
    },
    {
      name: "two-polylines",
      polylines: [OPEN_CORNER, CLOSED_SQUARE],
      options: { ...base, lineCap: "round", lineJoin: "round" },
    },
  ];

  // A flattened curve: hundreds of near-collinear corners, which is where a
  // join rule's arithmetic shows up most and where a miter limit is nearest to
  // its threshold. The path is §51's, so this case also pins that the two
  // modules still agree about what a polyline is.
  const curve = new Path()
    .moveTo(-8, 0)
    .cubicCurveTo(-4, 12, 4, -12, 8, 0)
    .arc(8, 4, 4, -Math.PI / 2, Math.PI / 2);
  cases.push({
    name: "flattened-curve",
    polylines: curve.polylines(0.03125),
    options: { ...base, width: 1, lineJoin: "round", lineCap: "round" },
  });
  const ring = new Path().arc(0, 0, 10, 0, Math.PI * 2).close();
  cases.push({
    name: "flattened-ring-dashed",
    polylines: ring.polylines(0.03125),
    options: { ...base, width: 1, dash: [2, 1], lineCap: "round" },
  });
  return cases;
}

/** The four join/cap combinations the random half cycles through. */
const JOINS: readonly StrokeGeometryOptions["lineJoin"][] = [
  "miter",
  "bevel",
  "round",
];

const CAPS: readonly StrokeGeometryOptions["lineCap"][] = [
  "butt",
  "round",
  "square",
];

const ALIGNMENTS: readonly StrokeGeometryOptions["alignment"][] = [
  "center",
  "inside",
  "outside",
];

/**
 * Generates the seeded half: integer-grid chains with a cycling option set.
 *
 * The coordinates are integers and the widths are powers of two, so every
 * quantity the *scenario* introduces is exact; whatever the golden pins is
 * `expandStroke`'s own arithmetic and nothing else.
 */
function randomStrokes(): ScenarioStroke[] {
  const random = new SeededRandom(SEED);
  const strokes: ScenarioStroke[] = [];
  for (let index = 0; index < RANDOM_CHAINS; index += 1) {
    const count = 2 + Math.floor(random.nextFloat01() * 7);
    const points: Point2D[] = [];
    for (let i = 0; i < count; i += 1) {
      points.push({
        x: Math.floor(random.nextFloat01() * 33) - 16,
        y: Math.floor(random.nextFloat01() * 33) - 16,
      });
    }
    const closed = random.nextFloat01() < 0.35;
    strokes.push({
      name: `random-${String(index)}`,
      polylines: [{ points, closed }],
      options: {
        width: 0.5 * (1 + Math.floor(random.nextFloat01() * 4)),
        tolerance: 0.03125,
        alignment: ALIGNMENTS[index % ALIGNMENTS.length],
        lineCap: CAPS[index % CAPS.length],
        lineJoin: JOINS[index % JOINS.length],
        miterLimit: 1 + Math.floor(random.nextFloat01() * 8),
      },
    });
  }
  return strokes;
}

/** The full catalogue: the fixed strokes, then the seeded ones. */
export function scenarioStrokes(): ScenarioStroke[] {
  return [...fixedStrokes(), ...randomStrokes()];
}

/**
 * Expands every stroke in the catalogue and reduces the run to checksums.
 *
 * Unlike the fill scenario there are no refusals to record: `expandStroke`
 * refuses only what §85 refuses at the option record — a width of zero, a dash
 * that never advances — and the catalogue carries none of those, because a
 * *refusal* is `stroke.test.ts`'s subject and a *digest* is this one's. What a
 * degenerate polyline produces (nothing) is still in the record, through the
 * random half.
 */
export function runStrokeScenario(): StrokeScenarioResult {
  const strokes = scenarioStrokes();
  const records: StrokeRecord[] = [];
  const summary = createChecksum();
  let triangles = 0;
  let vertices = 0;

  for (const stroke of strokes) {
    const mesh = expandStroke(stroke.polylines, stroke.options);
    const checksum = createChecksum();
    for (const point of mesh.positions) {
      checksum.addFloat(point.x);
      checksum.addFloat(point.y);
    }
    checksum.addFloats(mesh.indices);
    const record: StrokeRecord = {
      name: stroke.name,
      triangles: mesh.indices.length / 3,
      vertices: mesh.positions.length,
      digest: checksum.digest(),
    };
    records.push(record);
    triangles += record.triangles;
    vertices += record.vertices;
    summary.addFloat(record.triangles);
    summary.addFloat(record.vertices);
    summary.addFloat(record.digest);
  }

  return {
    strokes: strokes.length,
    triangles,
    vertices,
    records,
    summaryDigest: summary.digest(),
  };
}
