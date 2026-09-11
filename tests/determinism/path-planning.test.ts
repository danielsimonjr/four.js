import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runPathPlanningScenario } from "./helpers/path-planning-scenario.js";
const golden = JSON.parse(
  readFileSync(new URL("./golden/path-planning.json", import.meta.url), "utf8"),
) as { cost: number; sha256: string };
describe("RFC 0007 same-runtime determinism", () => {
  it("reproduces the recorded route and per-step positions in a fresh process", () => {
    const result = runPathPlanningScenario();
    expect(runPathPlanningScenario()).toEqual(result);
    expect(result.cost).toBe(golden.cost);
    expect(
      createHash("sha256")
        .update(JSON.stringify(result.positions))
        .digest("hex"),
    ).toBe(golden.sha256);
    const helper = new URL(
      "./helpers/path-planning-scenario.ts",
      import.meta.url,
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {runPathPlanningScenario} from ${JSON.stringify(helper)}; console.log(JSON.stringify(runPathPlanningScenario()));`,
      ],
      { encoding: "utf8" },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual(result);
  });
});
