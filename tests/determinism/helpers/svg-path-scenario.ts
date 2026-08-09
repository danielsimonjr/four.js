/**
 * The §50 SVG path-data determinism scenario (§33, gap `R-26`) — one pass over
 * a fixed catalogue of `d` attributes plus seeded random ones, in and out and
 * back in again, reduced to per-case checksums.
 *
 * ## Two halves, two tiers — the `R-24` split, inherited
 *
 * `R-25` set the house rule for a §33 `cross-platform` claim (only exactly
 * rounded operations; no `Math.sin`, `Math.cos`, `Math.acos`, `Math.atan2`,
 * `Math.sqrt`), and `R-24` established that the tier is a property of the
 * **operation**, not the module: §51's Béziers can claim it and its arcs
 * cannot. Reading and writing SVG inherits exactly that split, for reasons that
 * are not about geometry at all but about what ECMA-262 specifies:
 *
 * - **`text` claims `cross-platform`.** Its `d` attributes contain only
 *   `M`/`L`/`H`/`V`/`C`/`S`/`Q`/`T`/`Z`. Reading one is `String → Number`,
 *   which ECMA-262 specifies **exactly** for literals of at most 20 significant
 *   digits, plus one `+` per relative coordinate. Writing one is
 *   `Number::toString`, which ECMA-262 also specifies exactly (the shortest
 *   decimal that round-trips). Neither direction has an approximated
 *   operation in it, so no conforming engine is free to differ — and the test
 *   proves that rather than asserting it, two ways: every parsed coordinate is
 *   an exactly representable dyadic rational, and every case's text survives a
 *   parse/format/parse cycle **byte for byte**.
 * - **`arc` claims `same-runtime` only.** SVG stores an arc by its endpoints;
 *   §51 stores it by its centre. The conversion is `cos`, `sin`, `sqrt` and
 *   two `atan2`s, and the reverse conversion is another `cos` and `sin` — all
 *   implementation-approximated. The flattening on top is same-runtime for the
 *   reason `R-24` recorded: a sample *count* that comes from `Math.acos`.
 *
 * Merging the two digests would let a `Math.hypot` introduced into the number
 * scanner hide inside the arc half's weaker claim. They stay apart.
 *
 * ## What each record covers
 *
 * Not only the parse. Each case is parsed, its command list hashed, **written
 * back out** and the output text hashed character by character, then re-read
 * and hashed again. A golden that pinned only the parse would not notice a
 * change in how a path is written, and a golden that pinned only the text
 * would not notice a change in what the text means.
 *
 * ## Why this file is `.ts` and imported by *both* runtimes
 *
 * The arrangement WP-1.14 established and every scenario since has reused: the
 * determinism gate demands the scenario run twice in-process **and** once in a
 * fresh `node` child, and those runs are only evidence if they execute the same
 * code. So this file is loaded by Vitest (through Vite) and by plain `node`
 * (through its default type-stripping), which means it must stay inside Node's
 * **erasable syntax** subset: type annotations, `interface`, `type` and
 * `import type` are fine; `enum`, `namespace`, constructor parameter properties
 * and decorators are not.
 */

import { SeededRandom } from "@four/core";
import { createChecksum } from "@four/diagnostics";
import { Path, formatSvgPathData, parseSvgPathData } from "@four/geometry";

/** Seed of the random half of each catalogue. Fixed forever; it is the input. */
export const SEED = 0x26e5c17b;

/** Random cases generated after each fixed catalogue. */
export const RANDOM_CASES = 120;

/**
 * The two flattening tolerances the arc half is measured at.
 *
 * Powers of two, matching `golden/path.json`, so the flatness test compares
 * exactly representable values and only the arc's own transcendentals are left
 * as the reason for its weaker tier.
 */
export const TOLERANCES: readonly number[] = [0.25, 0.0625];

/** One `d` attribute under test, with a name for failure output. */
export interface SvgPathCase {
  readonly name: string;
  readonly data: string;
}

/** What one case produced. */
export interface SvgPathRecord {
  readonly name: string;
  /** Commands in the parsed path — a structural guard on the input. */
  readonly commands: number;
  /** Code units in the written `d` attribute. */
  readonly written: number;
  /** Checksum of the parse, the write, and the re-parse. */
  readonly digest: number;
}

/** One tier's half of the run. */
export interface SvgPathTierResult {
  /** The §33 tier this half claims — and the whole reason for the split. */
  readonly tier: string;
  readonly cases: number;
  readonly commands: number;
  readonly written: number;
  readonly records: readonly SvgPathRecord[];
  /** Checksum over every record, in order. */
  readonly summaryDigest: number;
}

/** The whole run: two halves, two tiers, two digests. */
export interface SvgPathScenarioResult {
  /** Lines and Béziers only — `cross-platform`. */
  readonly text: SvgPathTierResult;
  /** Arcs — `same-runtime`. */
  readonly arc: SvgPathTierResult;
}

/**
 * The hand-written half of the arc-free catalogue.
 *
 * Every command the `d` grammar has except `A`/`a`, in both cases, plus the
 * separator forms that are easy to get wrong: no separator at all, a sign
 * acting as one, the greedy `1.5.5` split, and an exponent. Every literal is a
 * **dyadic rational** (integers, halves, quarters, and `1e2`), which is what
 * makes this half's exactness mechanically checkable.
 */
function fixedTextCases(): SvgPathCase[] {
  return [
    { name: "square", data: "M -8 -8 L 8 -8 L 8 8 L -8 8 Z" },
    { name: "square-relative", data: "m -8 -8 l 16 0 l 0 16 l -16 0 z" },
    { name: "axis-shorthands", data: "M 0 0 H 16 V 16 H 0 Z" },
    { name: "axis-shorthands-relative", data: "m 0 0 h 16 v 16 h -16 z" },
    { name: "implicit-lineto", data: "M 0 0 4 0 4 4 0 4 Z" },
    { name: "cubic-run", data: "M 0 0 C 4 8 12 8 16 0 C 20 -8 28 -8 32 0" },
    { name: "cubic-smooth", data: "M 0 0 C 4 8 12 8 16 0 S 28 -8 32 0" },
    { name: "cubic-smooth-cold", data: "M 0 0 L 8 0 S 12 8 16 0" },
    { name: "quadratic-run", data: "M 0 0 Q 8 8 16 0 Q 24 -8 32 0" },
    { name: "quadratic-smooth", data: "M 0 0 Q 8 8 16 0 T 32 0 T 48 0" },
    { name: "quadratic-smooth-cold", data: "M 0 0 L 8 0 T 16 0" },
    { name: "no-separators", data: "M1.5.5L.5.25L-2-4L+3+5Z" },
    { name: "commas", data: "M1,2L3,4L5,6Z" },
    { name: "exponent", data: "M 1e2 2e1 L 0 0 Z" },
    {
      name: "two-subpaths",
      data: "M 0 0 L 8 0 L 8 8 Z M 16 0 L 24 0 L 24 8 Z",
    },
    { name: "reopen-after-close", data: "M 0 0 L 8 0 Z L 8 8 Z" },
    { name: "redundant-close", data: "M 0 0 L 8 0 Z Z" },
    { name: "lone-move", data: "M 4 4" },
    { name: "empty", data: "" },
  ];
}

/** The hand-written half of the arc catalogue. */
function fixedArcCases(): SvgPathCase[] {
  return [
    { name: "quarter", data: "M 16 0 A 16 16 0 0 1 0 16" },
    { name: "quarter-clockwise", data: "M 16 0 A 16 16 0 0 0 0 -16" },
    { name: "major", data: "M 16 0 A 16 16 0 1 1 0 16" },
    { name: "major-clockwise", data: "M 16 0 A 16 16 0 1 0 0 16" },
    {
      name: "circle-two-arcs",
      data: "M 16 0 A 16 16 0 0 1 -16 0 A 16 16 0 0 1 16 0 Z",
    },
    { name: "ellipse-rotated", data: "M 0 0 A 20 10 45 1 0 20 20" },
    { name: "scaled-radii", data: "M 0 0 A 1 1 0 0 1 10 0" },
    {
      name: "rounded-rectangle",
      data: "M 4 0 L 12 0 A 4 4 0 0 1 16 4 L 16 12 A 4 4 0 0 1 12 16 L 4 16 A 4 4 0 0 1 0 12 L 0 4 A 4 4 0 0 1 4 0 Z",
    },
    { name: "relative-arc", data: "m 8 8 a 6 6 0 0 1 6 6 a 6 6 0 0 0 -6 6" },
    { name: "packed-flags", data: "M0 0a5 5 0 011 1" },
  ];
}

/** An integer in `[min, max]`, from the seeded stream. */
function nextInteger(random: SeededRandom, min: number, max: number): number {
  return min + Math.floor(random.nextFloat01() * (max - min + 1));
}

/**
 * The seeded half of the arc-free catalogue.
 *
 * Coordinates come from an integer ±32 grid and are occasionally halved, so
 * every literal is dyadic and every parsed coordinate is exact. Commands are
 * drawn from the nine non-arc letters, in both cases, so the generator exercises
 * relative arithmetic and the two smooth shorthands as well as the plain forms.
 */
function randomTextCases(): SvgPathCase[] {
  const random = new SeededRandom(SEED);
  const cases: SvgPathCase[] = [];
  const letters = ["L", "H", "V", "C", "S", "Q", "T"];
  for (let index = 0; index < RANDOM_CASES; index += 1) {
    const parts = [
      `M ${String(nextInteger(random, -32, 32))} ${String(nextInteger(random, -32, 32))}`,
    ];
    const commands = 2 + Math.floor(random.nextFloat01() * 6);
    for (let step = 0; step < commands; step += 1) {
      const letter = letters[Math.floor(random.nextFloat01() * letters.length)];
      const relative = random.nextFloat01() < 0.5;
      const numbers =
        letter === "H" || letter === "V"
          ? 1
          : letter === "C"
            ? 6
            : letter === "S" || letter === "Q"
              ? 4
              : 2;
      const values: string[] = [];
      for (let slot = 0; slot < numbers; slot += 1) {
        const whole = nextInteger(
          random,
          relative ? -16 : -32,
          relative ? 16 : 32,
        );
        values.push(
          random.nextFloat01() < 0.25 ? `${String(whole)}.5` : String(whole),
        );
      }
      parts.push(
        `${relative ? letter.toLowerCase() : letter} ${values.join(" ")}`,
      );
    }
    if (random.nextFloat01() < 0.5) {
      parts.push("Z");
    }
    cases.push({ name: `text-${String(index)}`, data: parts.join(" ") });
  }
  return cases;
}

/**
 * The seeded half of the arc catalogue: integer radii and endpoints, rotations
 * at eighth turns in degrees, and all four flag combinations.
 */
function randomArcCases(): SvgPathCase[] {
  const random = new SeededRandom(SEED);
  const cases: SvgPathCase[] = [];
  for (let index = 0; index < RANDOM_CASES; index += 1) {
    const startX = nextInteger(random, -16, 16);
    const startY = nextInteger(random, -16, 16);
    const radiusX = nextInteger(random, 1, 12);
    const radiusY = nextInteger(random, 1, 12);
    const rotation = nextInteger(random, 0, 7) * 45;
    const largeArc = random.nextFloat01() < 0.5 ? 0 : 1;
    const sweep = random.nextFloat01() < 0.5 ? 0 : 1;
    // Never coincident with the start: F.6.2 would omit the arc, and a
    // catalogue of omitted arcs would pin nothing.
    const endX = startX + nextInteger(random, 1, 12);
    const endY = startY + nextInteger(random, -12, 12);
    const data =
      `M ${String(startX)} ${String(startY)} ` +
      `A ${String(radiusX)} ${String(radiusY)} ${String(rotation)} ` +
      `${String(largeArc)} ${String(sweep)} ${String(endX)} ${String(endY)}` +
      (random.nextFloat01() < 0.5 ? " Z" : "");
    cases.push({ name: `arc-${String(index)}`, data });
  }
  return cases;
}

/** The arc-free catalogue: the fixed cases, then the seeded ones. */
export function textCatalogue(): SvgPathCase[] {
  return [...fixedTextCases(), ...randomTextCases()];
}

/** The arc catalogue: the fixed cases, then the seeded ones. */
export function arcCatalogue(): SvgPathCase[] {
  return [...fixedArcCases(), ...randomArcCases()];
}

/** Feeds a path's command list to a checksum, kind first, then its numbers. */
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

/** Feeds a written `d` attribute to a checksum, code unit by code unit. */
function absorbText(
  checksum: { addFloat: (x: number) => void },
  text: string,
): void {
  checksum.addFloat(text.length);
  for (let index = 0; index < text.length; index += 1) {
    checksum.addFloat(text.charCodeAt(index));
  }
}

/**
 * Runs one case through everything the golden pins: parse, hash, write, hash
 * the text, read the text back, hash again — and, for the arc half, flatten at
 * both tolerances.
 */
function recordCase(entry: SvgPathCase, flatten: boolean): SvgPathRecord {
  const checksum = createChecksum();
  const path = parseSvgPathData(entry.data);
  absorbCommands(checksum, path);

  const written = formatSvgPathData(path);
  absorbText(checksum, written);

  const reread = parseSvgPathData(written);
  absorbCommands(checksum, reread);

  if (flatten) {
    for (const tolerance of TOLERANCES) {
      for (const ring of path.flatten(tolerance)) {
        checksum.addFloat(ring.length);
        for (const point of ring) {
          checksum.addFloat(point.x);
          checksum.addFloat(point.y);
        }
      }
    }
  }

  return {
    name: entry.name,
    commands: path.commands.length,
    written: written.length,
    digest: checksum.digest(),
  };
}

/** Runs one tier's catalogue. */
function runTier(
  tier: string,
  catalogue: readonly SvgPathCase[],
  flatten: boolean,
): SvgPathTierResult {
  const records: SvgPathRecord[] = [];
  const summary = createChecksum();
  let commands = 0;
  let written = 0;
  for (const entry of catalogue) {
    const record = recordCase(entry, flatten);
    records.push(record);
    commands += record.commands;
    written += record.written;
    summary.addFloat(record.commands);
    summary.addFloat(record.written);
    summary.addFloat(record.digest);
  }
  return {
    tier,
    cases: catalogue.length,
    commands,
    written,
    records,
    summaryDigest: summary.digest(),
  };
}

/** Runs both halves of the scenario. */
export function runSvgPathScenario(): SvgPathScenarioResult {
  return {
    text: runTier("cross-platform", textCatalogue(), false),
    arc: runTier("same-runtime", arcCatalogue(), true),
  };
}
