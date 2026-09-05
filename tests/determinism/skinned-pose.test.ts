/**
 * §54 skinned-pose determinism gate (RFC 0003 — gaps PH-10 + R-22; §33, §92).
 *
 * `phase4-animation.test.ts` proves authored animation is a pure function of
 * the step count; `animation-controller.test.ts` proves it for a machine's
 * history. What neither covers is the value RFC 0003 §6 draws its boundary
 * at: the **skinning palette** — the last CPU value of the skeletal pipeline
 * before vertex deformation leaves the §33 envelope for the GPU. This file
 * pins it in the gate's three forms:
 *
 * 1. **Headless.** The scenario imports `@four/animation`, `@four/scene`,
 *    `@four/math`, `@four/diagnostics` and `four/application` — no renderer
 *    package, no canvas, no DOM. That it *can* is itself part of the claim:
 *    the palette is engine state, skinned vertices are not.
 * 2. **Deterministic in-process.** Two runs in one process produce
 *    byte-identical per-step digests.
 * 3. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process reproduces the same 600 digests and matches
 *    `golden/skinned-pose.json`.
 *
 * ## The golden file is immutable
 *
 * `golden/skinned-pose.json` is evidence, not configuration. **Never
 * regenerate it to make this test pass.** A mismatch means the palette
 * arithmetic, the track evaluation, or the world-transform resolution changed
 * between the run that produced the golden and the run under test; identify
 * the change, decide whether it is intended, and only then — as a reviewed,
 * recorded decision — write new values.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  BONE_COUNT,
  PROBE_STEP_MID,
  STEP_COUNT,
  runSkinnedPoseScenario,
  type SkinnedPoseResult,
  type SkinnedPoseSummary,
} from "./helpers/skinned-pose-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields. */
interface GoldenFile extends SkinnedPoseSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/skinned-pose.json", import.meta.url);
const HELPER_URL = new URL(
  "./helpers/skinned-pose-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

const RUN_TIMEOUT_MS = 120_000;

/** First differing index, or -1 — reported so a divergence names a step. */
function firstDivergence(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return a.length === b.length ? -1 : shared;
}

function runScenarioInChildProcess(): SkinnedPoseResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runSkinnedPoseScenario();\n` +
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
  return JSON.parse(child.stdout) as SkinnedPoseResult;
}

describe("skinned pose: the palette is deterministic (§33, §54; RFC 0003)", () => {
  let first: SkinnedPoseResult;
  let second: SkinnedPoseResult;
  let child: SkinnedPoseResult;

  beforeAll(async () => {
    first = await runSkinnedPoseScenario();
    second = await runSkinnedPoseScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 600-step schedule the golden assumes", () => {
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);
    expect(first.droppedTime).toBe(0);
    // §42 and §16: every write was under a declared authority, measured.
    expect(first.authorityWarningCount).toBe(0);
    // The digest is over what this suite claims: 16 floats per bone plus the
    // two morph weights.
    expect(first.finalPalette).toHaveLength(BONE_COUNT * 16);
    expect(first.finalWeights).toHaveLength(2);
  });

  test("two runs in one process are byte-identical", () => {
    expect(firstDivergence(first.digests, second.digests)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(second.finalPalette).toEqual(first.finalPalette);
    expect(second.finalWeights).toEqual(first.finalWeights);
  });

  test("a fresh process reproduces the same run", () => {
    expect(firstDivergence(first.digests, child.digests)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.finalPalette).toEqual(first.finalPalette);
  });

  test("the run matches the committed golden", () => {
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.midStepDigest).toBe(golden.midStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
  });

  test("the rig actually moved — the golden is not a rest pose", () => {
    // Distinct digests on most steps of one loop: a hash over a frozen rig
    // would reproduce perfectly and prove nothing. The 2 s clip loops five
    // times in 600 steps and every later loop reproduces the first's poses
    // **bit-exactly** (measured: 121 distinct digests of 600) — which is
    // itself the purity claim: evaluation is a pure function of clip time,
    // and the clip time comes round again.
    expect(new Set(first.digests).size).toBeGreaterThan(STEP_COUNT / 6);
    expect(new Set(first.digests).size).toBeLessThan(STEP_COUNT / 4);
    // Step 120 (t = 2 s, PROBE_STEP_MID) sits at a loop seam, not at rest.
    expect(PROBE_STEP_MID).toBe(120);
    // The morph weight ramped: at the end of the run (t = 10 s, five whole
    // loops) the track is back at its loop-start sample of step 600's time.
    expect(first.finalWeights[0]).toBe(0);
  });
});
