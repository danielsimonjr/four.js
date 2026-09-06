/**
 * §21 `"local-plane"` simulation frame is deterministic (PH-12 remainder).
 *
 * Two dynamic bodies author a 2D pose in a tilted plane; feed/publish maps
 * through the plane basis. This file is the §33 golden, in the three forms
 * WP-1.14 established:
 *
 * 1. Headless — `@four/physics` + `@four/physics-rapier`, no renderer.
 * 2. Deterministic in-process — two independent runs agree bit-for-bit.
 * 3. Deterministic across processes, against `golden/local-plane.json`.
 *
 * `firstBodyV` is the readable pin: the first body must have slid *down* the
 * plane (plane-frame v decreases under the projected gravity).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  PROBE_STEP_ONE_SECOND,
  STEP_COUNT,
  type LocalPlaneScenarioResult,
  type LocalPlaneSummary,
  runLocalPlaneScenario,
} from "./helpers/local-plane-scenario.js";

interface GoldenFile extends LocalPlaneSummary {
  _warning: string;
  _scenario: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/local-plane.json", import.meta.url);
const HELPER_URL = new URL(
  "./helpers/local-plane-scenario.ts",
  import.meta.url,
);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

const RUN_TIMEOUT_MS = 120_000;

function firstDivergence(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return a.length === b.length ? -1 : shared;
}

function runScenarioInChildProcess(): LocalPlaneScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runLocalPlaneScenario();\n` +
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

  return JSON.parse(child.stdout) as LocalPlaneScenarioResult;
}

describe("§21 local-plane simulation frame is deterministic (§33)", () => {
  let first: LocalPlaneScenarioResult;
  let second: LocalPlaneScenarioResult;
  let child: LocalPlaneScenarioResult;

  beforeAll(async () => {
    first = await runLocalPlaneScenario();
    second = await runLocalPlaneScenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario is the one the golden assumes", () => {
    expect(first.stepCount).toBe(STEP_COUNT);
    expect(first.checksums).toHaveLength(STEP_COUNT);
    expect(first.bodyCount).toBe(2);
    expect(first.atOneSecond).toHaveLength(2);
    expect(PROBE_STEP_ONE_SECOND).toBe(60);
  });

  test("the first body slides down the plane (plane-frame v decreases)", () => {
    expect(first.firstBodyV).toBeLessThan(2);
    expect(first.atEnd[0].position[1]).toBe(first.firstBodyV);
  });

  test("two in-process runs agree bit-for-bit", () => {
    expect(firstDivergence(first.checksums, second.checksums)).toBe(-1);
    expect(first.firstBodyV).toBe(second.firstBodyV);
  });

  test("a fresh process matches the in-process run", () => {
    expect(firstDivergence(first.checksums, child.checksums)).toBe(-1);
  });

  test("the run matches the committed golden", () => {
    expect(firstDivergence(first.checksums, golden.checksums)).toBe(-1);
    expect(first.firstBodyV).toBe(golden.firstBodyV);
    expect(first.bodyCount).toBe(golden.bodyCount);
  });
});
