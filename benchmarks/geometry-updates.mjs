/**
 * WebGL geometry-cache submission preparation (§53, §64, §83, §92).
 *
 * Counts calls and object lifetimes against a counting GL seam; timings are
 * JavaScript plus that seam, NOT driver time, GPU time, or frame rate. Full
 * buffer uploads remain in both arms. Static acquisitions are the control.
 *
 * Run after building: node benchmarks/geometry-updates.mjs
 * Optional same-checkout A/B against a previously built baseline module:
 * node benchmarks/geometry-updates.mjs --baseline=packages/render-webgl/dist/gl-geometry.baseline.js
 * Preserve that module before rebuilding; its relative gl-program import must
 * still resolve. The browser regression supplies the separate pixel proof.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BufferGeometry } from "@four/geometry";
import { GeometryCache } from "@four/render-webgl";

import {
  MEASUREMENT_NOTE,
  hostRecord,
  measure,
  printReport,
  summarize,
  summaryFields,
  writeResult,
} from "./harness.mjs";

const GEOMETRIES = 1000;
const WARMUP = 100;
const SAMPLES = 200;
const names = [
  "createVertexArray",
  "createBuffer",
  "bindVertexArray",
  "bindBuffer",
  "bufferData",
  "enableVertexAttribArray",
  "vertexAttribPointer",
  "deleteVertexArray",
  "deleteBuffer",
];

/** No arrays copied and no timer per GL call: only counters, never rasterization. */
function countingGl() {
  const counts = Object.fromEntries(names.map((name) => [name, 0]));
  let uploadedBytes = 0;
  const gl = Object.fromEntries(
    names.map((name) => [
      name,
      () => {
        counts[name]++;
      },
    ]),
  );
  gl.createVertexArray = () => {
    counts.createVertexArray++;
    return {};
  };
  gl.createBuffer = () => {
    counts.createBuffer++;
    return {};
  };
  gl.bufferData = (_target, data) => {
    counts.bufferData++;
    uploadedBytes += data.byteLength;
  };
  return {
    gl,
    reset() {
      for (const name of names) counts[name] = 0;
      uploadedBytes = 0;
    },
    snapshot() {
      return { ...counts, uploadedBytes };
    },
  };
}

function makeGeometry(kind) {
  if (kind === "position-only") {
    return new BufferGeometry({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    });
  }
  const options = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
  if (kind === "all-attributes")
    Object.assign(options, {
      normals: new Float32Array(12).fill(1),
      uvs: new Float32Array(8),
      colors: new Float32Array(16).fill(1),
      joints: new Uint16Array(16),
      weights: new Float32Array(16).fill(0.25),
    });
  return new BufferGeometry(options);
}

function run(Cache, implementation, kind, dirty) {
  const counter = countingGl();
  const cache = new Cache(counter.gl);
  const geometries = Array.from({ length: GEOMETRIES }, () =>
    makeGeometry(kind),
  );
  for (const geometry of geometries) assert.ok(cache.acquire(geometry));
  let count = 0;
  const iterate = () => {
    count = 0;
    for (const geometry of geometries) count += cache.acquire(geometry).count;
  };
  const prepare = () => {
    counter.reset();
    if (dirty)
      for (const geometry of geometries) {
        geometry.positions[0] = geometry.version % 2;
        geometry.markDirty();
      }
  };
  const times = measure(iterate, {
    warmupIterations: WARMUP,
    measuredIterations: SAMPLES,
    prepare,
  });
  const calls = counter.snapshot();
  for (const key of Object.keys(calls)) calls[key] /= GEOMETRIES;
  assert.equal(count, GEOMETRIES * (kind === "position-only" ? 3 : 6));
  assert.equal(cache.size, GEOMETRIES);
  if (!dirty) assert.ok(Object.values(calls).every((value) => value === 0));
  // Pin data traffic: fewer calls must not mean quietly dropping a stream.
  const byteLength = geometries[0].byteLength;
  assert.equal(calls.uploadedBytes, dirty ? byteLength : 0);
  cache.dispose();
  for (const geometry of geometries) geometry.dispose();
  return {
    implementation,
    kind,
    dirty,
    geometries: GEOMETRIES,
    apiCallsPerGeometry: names.reduce((sum, name) => sum + calls[name], 0),
    callsPerGeometry: calls,
    ...summaryFields(summarize(times.measured), "Frame"),
    warmup: summaryFields(summarize(times.warmup), "Frame"),
  };
}

const implementations = [["optimized", GeometryCache]];
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 && !args[0].startsWith("--baseline="))
) {
  throw new Error(
    "usage: node benchmarks/geometry-updates.mjs [--baseline=path-to-built-module]",
  );
}
const baseline = args[0]?.slice("--baseline=".length);
if (baseline !== undefined) {
  if (baseline.length === 0) throw new Error("baseline path must not be empty");
  const module = await import(pathToFileURL(resolve(baseline)).href);
  if (typeof module.GeometryCache !== "function")
    throw new Error("baseline must export GeometryCache");
  implementations.unshift(["baseline", module.GeometryCache]);
}
const scenarios = [];
for (const kind of ["position-only", "indexed-quad", "all-attributes"]) {
  for (const dirty of [false, true]) {
    for (const [name, Cache] of implementations)
      scenarios.push(run(Cache, name, kind, dirty));
  }
}
const record = {
  _note: MEASUREMENT_NOTE,
  benchmark: "geometry-updates",
  specification:
    "§53 geometry versioning; §64 submission; §83 resource lifetimes; §92 measurements",
  recordedAt: new Date().toISOString(),
  measuredFramesPerScenario: SAMPLES,
  warmupFramesPerScenario: WARMUP,
  baselineModule: baseline ?? null,
  iteration:
    "Acquire 1000 geometries; mutations and counter resets outside the timed interval",
  scenarios,
  ...hostRecord(),
  hostCaveat:
    "Counting GL seam, not a GPU or driver. Wall times include mock dispatch and vary with JIT/GC and host load. These are not FPS measurements; exact call counts are the primary result. Upload bytes are unchanged.",
};
const path = writeResult("geometry-updates", record);
printReport([
  "four.js — dynamic geometry submission preparation (counting GL seam)",
  "implementation | geometry | dirty | API calls/geometry | upload bytes | median ms/1000 acquisitions",
  ...scenarios.map(
    (row) =>
      `${row.implementation} | ${row.kind} | ${String(row.dirty)} | ${String(row.apiCallsPerGeometry)} | ${String(row.callsPerGeometry.uploadedBytes)} | ${String(row.medianMsPerFrame)}`,
  ),
  "No driver/GPU/frame-rate claim. Full uploads retained; static draws are the zero-call control.",
  `Written: ${path}`,
]);
