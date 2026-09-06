/**
 * Re-record Rapier-affected §33 goldens after the 0.20.0 solver bump.
 *
 * This is the documented exception in each golden's `_warning`: a reviewed
 * Rapier version change. Prose fields (`_warning`, `_scenario`, `_tier`,
 * `_claim`) stay byte-identical so the immutability assertions keep holding.
 *
 * Run from the repo root: `bun tools/rerecord-rapier-0.20-goldens.mjs`
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runEventSplitScenario } from "../tests/determinism/helpers/event-split-scenario.ts";
import { runForceFieldScenario } from "../tests/determinism/helpers/force-field-scenario.ts";
import { runPhase10Scenario } from "../tests/determinism/helpers/phase10-scenario.ts";
import { runPhase5Scenario } from "../tests/determinism/helpers/phase5-scenario.ts";
import { runPhase6Scenario } from "../tests/determinism/helpers/phase6-scenario.ts";
import { runPhase7Scenario } from "../tests/determinism/helpers/phase7-scenario.ts";
import { runSweptCharacterScenario } from "../tests/determinism/helpers/swept-character-scenario.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const goldenDir = join(root, "tests", "determinism", "golden");

function writeGolden(name, numbers) {
  const path = join(goldenDir, name);
  const previous = JSON.parse(readFileSync(path, "utf8"));
  const next = { ...previous, ...numbers };
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`wrote ${name}`);
}

const phase5 = await runPhase5Scenario();
writeGolden("phase5.json", phase5.summary);

const phase6 = await runPhase6Scenario();
writeGolden("phase6.json", phase6.summary);
console.log(
  "phase6 travel3d hits",
  phase6.summary.switches3d.leftHits,
  phase6.summary.switches3d.rightHits,
);

const phase7 = await runPhase7Scenario();
writeGolden("phase7.json", phase7.summary);

const phase10 = await runPhase10Scenario();
writeGolden("phase10.json", phase10.summary);

const fields = await runForceFieldScenario();
writeGolden("force-fields.json", fields.summary);

const split = await runEventSplitScenario();
writeGolden("event-dispatch-split.json", {
  ...split.combined.summary,
  stepsWithEvents: split.split.constraintOffsets.length,
});

const swept = await runSweptCharacterScenario();
writeGolden("swept-character.json", swept.summary);

console.log("done");
