/**
 * §50 SVG path-data determinism (§33, gap `R-26`).
 *
 * The `d` attribute is the on-ramp for 2D content: it is how a shape authored
 * in an illustrator becomes a §51 `Path`, and how one leaves again. "Same
 * attribute, same path — and same path, same attribute" is what every consumer
 * downstream assumes (`R-23`'s shape nodes, `R-16`'s strokes, §56's text on a
 * curve), and this file is the gate on it, in the four forms the phase suites
 * established:
 *
 * 1. **Headless and dependency-free.** The scenario imports `@four/geometry`,
 *    `@four/core` and `@four/diagnostics` — no renderer, no application, no
 *    canvas, no DOM. Parsing a string is a pure function; there is no clock to
 *    inject and nothing to mock.
 * 2. **Deterministic in-process.** Two independent runs produce identical
 *    per-case digests and identical records.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child — new heap, new module graph, new JIT state — running *the
 *    same helper file* reproduces every digest and matches
 *    `golden/svg-path.json`.
 * 4. **Correct where correctness is checkable without re-deriving the module.**
 *    The cross-platform half's coordinates are asserted to be exactly
 *    representable dyadic rationals, and its text a byte-for-byte fixed point
 *    of parse → format → parse. Those two are the mechanical proof of the tier.
 *
 * ## The golden file is immutable
 *
 * `golden/svg-path.json` is evidence, not configuration. **Never regenerate it
 * to make a test pass.** A mismatch means the bridge changed what it produces.
 * Find the change, decide whether it is correct, and record a deliberate one in
 * `CHANGELOG.md` and `MEMORY.md` with the reason.
 *
 * ## Two tiers, two digests, on purpose
 *
 * The split is `golden/path.json`'s, inherited for a related but distinct
 * reason. There the two tiers came from geometry — a Bézier can be halved
 * exactly, an arc cannot. Here the *cross-platform* half's exactness comes from
 * **ECMA-262's own specification of the two conversions**: decimal string →
 * double is exactly specified up to 20 significant digits, and
 * `Number::toString` is exactly specified as the shortest decimal that round
 * trips. The arc half is same-runtime because SVG's endpoint parameterization
 * and §51's centre parameterization are separated by `atan2`, `sqrt`, `cos` and
 * `sin`, in both directions.
 *
 * Averaging them would let a `Math.hypot` introduced into the number scanner
 * hide inside the arc half's weaker claim. Keeping them apart is what makes the
 * stronger claim checkable.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { formatSvgPathData, parseSvgPathData } from "@four/geometry";
import { beforeAll, describe, expect, test } from "vitest";

import {
  RANDOM_CASES,
  SEED,
  TOLERANCES,
  arcCatalogue,
  runSvgPathScenario,
  textCatalogue,
  type SvgPathScenarioResult,
  type SvgPathTierResult,
} from "./helpers/svg-path-scenario.js";

/** One half of the committed golden. */
interface GoldenTier {
  _tier: string;
  cases: number;
  commands: number;
  written: number;
  summaryDigest: number;
  firstCaseDigest: number;
  lastCaseDigest: number;
}

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile {
  _warning: string;
  _scenario: string;
  _tiers: string;
  seed: number;
  tolerances: number[];
  text: GoldenTier;
  arc: GoldenTier;
}

const GOLDEN_URL = new URL("./golden/svg-path.json", import.meta.url);
const HELPER_URL = new URL("./helpers/svg-path-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one run is milliseconds; a cold child adds process start. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Runs the scenario in a fresh `node` process and parses what it printed.
 *
 * The child inherits no state from Vitest beyond the environment: no Vite, no
 * transform pipeline, no test globals. It writes exactly one JSON object to
 * stdout; anything on stderr is surfaced in the failure message.
 */
function runScenarioInChildProcess(): SvgPathScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = scenario.runSvgPathScenario();\n` +
    `process.stdout.write(JSON.stringify(result));\n`;

  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", source],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    },
  );

  if (child.error !== undefined) {
    throw new Error(
      `Failed to spawn the fresh-process determinism run: ${child.error.message}`,
    );
  }
  if (child.status !== 0) {
    throw new Error(
      `Fresh-process determinism run exited with status ${String(child.status)} ` +
        `(signal ${String(child.signal)}).\n--- stderr ---\n${child.stderr}\n` +
        `--- stdout ---\n${child.stdout}`,
    );
  }

  return JSON.parse(child.stdout) as SvgPathScenarioResult;
}

/** The index of the first differing record, or `-1` when the two agree. */
function firstDivergence(a: SvgPathTierResult, b: SvgPathTierResult): number {
  const shared = Math.min(a.records.length, b.records.length);
  for (let i = 0; i < shared; i += 1) {
    if (
      a.records[i].digest !== b.records[i].digest ||
      a.records[i].commands !== b.records[i].commands ||
      a.records[i].written !== b.records[i].written
    ) {
      return i;
    }
  }
  return a.records.length === b.records.length ? -1 : shared;
}

/** Both halves of a run, paired with the golden half they answer to. */
function halves(
  result: SvgPathScenarioResult,
): readonly (readonly [string, SvgPathTierResult, GoldenTier])[] {
  return [
    ["text", result.text, golden.text],
    ["arc", result.arc, golden.arc],
  ];
}

describe("§50 SVG path data is deterministic", () => {
  let first: SvgPathScenarioResult;
  let second: SvgPathScenarioResult;
  let child: SvgPathScenarioResult;

  beforeAll(() => {
    first = runSvgPathScenario();
    second = runSvgPathScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario really exercised the catalogues it claims to", () => {
    // Guards on the *inputs*. A scenario that quietly stopped generating cases,
    // or started parsing them to nothing, could otherwise satisfy every digest
    // assertion below with a degenerate run.
    expect(SEED).toBe(golden.seed);
    expect(TOLERANCES).toEqual(golden.tolerances);
    for (const [name, tier, expected] of halves(first)) {
      expect(tier.cases, name).toBe(expected.cases);
      expect(tier.records, name).toHaveLength(expected.cases);
      expect(tier.cases, name).toBeGreaterThan(RANDOM_CASES);
      expect(tier.commands, name).toBeGreaterThan(RANDOM_CASES);
    }
    expect(textCatalogue()).toHaveLength(golden.text.cases);
    expect(arcCatalogue()).toHaveLength(golden.arc.cases);
  });

  test("two in-process runs agree case for case, in both tiers", () => {
    expect(firstDivergence(first.text, second.text)).toBe(-1);
    expect(firstDivergence(first.arc, second.arc)).toBe(-1);
    expect(second.text.summaryDigest).toBe(first.text.summaryDigest);
    expect(second.arc.summaryDigest).toBe(first.arc.summaryDigest);
  });

  test("a fresh node process agrees case for case, in both tiers", () => {
    expect(firstDivergence(first.text, child.text)).toBe(-1);
    expect(firstDivergence(first.arc, child.arc)).toBe(-1);
    expect(child.text.summaryDigest).toBe(first.text.summaryDigest);
    expect(child.arc.summaryDigest).toBe(first.arc.summaryDigest);
  });

  test("the run matches the committed golden, tier by tier", () => {
    // If this fails: DO NOT edit golden/svg-path.json. See this file's header.
    for (const [name, tier, expected] of halves(first)) {
      expect(tier.tier, name).toBe(expected._tier);
      expect(tier.commands, name).toBe(expected.commands);
      expect(tier.written, name).toBe(expected.written);
      expect(tier.summaryDigest, name).toBe(expected.summaryDigest);
      expect(tier.records[0].digest, name).toBe(expected.firstCaseDigest);
      expect(tier.records[tier.records.length - 1].digest, name).toBe(
        expected.lastCaseDigest,
      );
    }
  });

  test("the cross-platform half really is exact, not merely reproducible", () => {
    // The tier claim, mechanically, in the half that depends only on ECMA-262's
    // two exactly-specified conversions:
    //
    //   1. every literal in the catalogue is a dyadic rational, so every parsed
    //      coordinate is an exact multiple of 2^-24 well inside 53 bits — a
    //      value no conforming engine is free to compute differently;
    //   2. writing and re-reading is a byte-for-byte fixed point, which is what
    //      makes `Number::toString`'s exactness observable rather than assumed.
    //
    // A `Math.round`, a `toFixed`, or a non-dyadic constant introduced into
    // either direction breaks this before it breaks a digest.
    let checked = 0;
    for (const { name, data } of textCatalogue()) {
      const path = parseSvgPathData(data);
      for (const command of path.commands) {
        for (const value of Object.values(command)) {
          if (typeof value === "number") {
            expect(Number.isInteger(value * 2 ** 24), name).toBe(true);
            expect(Math.abs(value), name).toBeLessThanOrEqual(256);
            checked += 1;
          }
        }
      }
      const written = formatSvgPathData(path);
      const reread = parseSvgPathData(written);
      expect(reread.commands, name).toEqual(path.commands);
      expect(formatSvgPathData(reread), name).toBe(written);
    }
    expect(checked).toBeGreaterThan(2_000);
  });

  test("the same-runtime half is honest about why it is not exact", () => {
    // The counterpart: an arc's centre parameters are *not* exact, and
    // pretending otherwise is the failure this split exists to prevent. A
    // quarter-turn arc between integer endpoints has a sweep that is not a
    // dyadic rational at all — `atan2` put it there, and no amount of care in
    // this module can take it back out.
    const quarter = parseSvgPathData("M 16 0 A 16 16 0 0 1 0 16");
    const arc = quarter.commands[1];
    expect(arc.kind).toBe("arc");
    const sweep = (arc as { deltaAngle: number }).deltaAngle;
    expect(sweep).toBeCloseTo(Math.PI / 2, 12);
    expect(Number.isInteger(sweep * 2 ** 24)).toBe(false);

    // The contrast that makes the split meaningful: the *same two endpoints*
    // joined by a line are transcribed exactly, in the other tier.
    const line = parseSvgPathData("M 16 0 L 0 16");
    expect(line.commands[1]).toEqual({ kind: "line", x: 0, y: 16 });
  });
});
