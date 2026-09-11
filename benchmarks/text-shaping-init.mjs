/** RFC0008 initialization and warm shaping; wall time is a measurement, never a gate. */
import { readFileSync } from "node:fs";
import { HarfBuzzShapingEngine } from "../packages/text/dist/harfbuzz/index.js";
import { hostRecord, measure, summarize, writeResult } from "./harness.mjs";
const wasm = readFileSync(
  new URL("../packages/text/node_modules/harfbuzzjs/hb.wasm", import.meta.url),
);
const font = readFileSync(
  new URL("../tests/fixtures/fonts/NotoSans-Regular.ttf", import.meta.url),
);
const cold = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  const engine = await HarfBuzzShapingEngine.create({ wasm });
  cold.push(performance.now() - start);
  engine.dispose();
}
const engine = await HarfBuzzShapingEngine.create({ wasm }),
  fontId = engine.addFont(font);
const warm = measure(
  () => engine.shape({ text: "The quick brown fox", fontId }),
  { warmupIterations: 100, measuredIterations: 1000 },
);
engine.dispose();
const record = {
  benchmark: "text-shaping-init",
  recordedAt: new Date().toISOString(),
  host: hostRecord(),
  note: "Five fresh instances in one process; runtime compilation caches may benefit later samples. Warm shape excludes font load.",
  coldMilliseconds: cold,
  coldSummary: summarize(cold),
  warmSummary: summarize(warm.measured),
};
writeResult("text-shaping-init", record);
console.log(JSON.stringify(record, null, 2));
