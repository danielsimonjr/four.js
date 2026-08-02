/**
 * §112's 100 000-particle CPU budget, measured (plan §6h, WP-9.4).
 *
 * ```sh
 * pnpm run build           # this script imports the built dist, not src
 * node benchmarks/particles-100k.mjs
 * ```
 *
 * §112 closes Phase 9 on *"≥100,000 simple particles simulated and rendered at
 * interactive rates on suitable hardware"*. Plan §6h reads that honestly for
 * this environment and splits it in two: the **renderer** must draw a system in
 * one draw call (`@four/render-webgl`'s instanced particle path, WP-9.3), and
 * the **CPU simulation** must step 100 000 particles inside a fixed-step budget
 * *measured and documented in a benchmark* — recorded numbers, deliberately not
 * gated on wall time in CI. This file is that benchmark. It is the first real
 * script in `benchmarks/`; the §92/§86 harness proper is Phase 11 (§113a), so
 * this is plain Node with no new dependencies and no framework.
 *
 * ## What is measured
 *
 * **The headline run**: one `ParticleEmitter` at capacity —
 * {@link PARTICLE_COUNT} live particles, none spawning, none dying — stepped
 * {@link MEASURED_STEPS} times under the §27 field stack the packet names:
 * **uniform gravity, linear drag, and a vortex**. Every step does the full
 * per-particle job: three field samples, an acceleration sum in the pinned
 * order, a semi-implicit Euler integration, an age update and a death test,
 * over 100 000 particles.
 *
 * The reported figure is **milliseconds per fixed step**, mean and p95, against
 * the 16.667 ms a 60 Hz fixed step has to spend (Appendix A's `fixedTimeStep`).
 * Mean says whether it fits; p95 says whether it fits *reliably*, which is what
 * "interactive rates" actually asks — a mean inside budget with a fat tail
 * still drops frames.
 *
 * **The attribution run** then repeats the same pool with 0, 1 and 2 fields, in
 * shorter bursts, because the headline number alone is uninterpretable. On the
 * recorded host the integrator itself costs about **1 ms per 100 000
 * particles** and each §27 field adds about **5–6 ms** — the fields, not the
 * integration, are the whole cost, and they are the cost of a virtual
 * `sample()` call per particle per field across a polymorphic call site
 * (`emitter.ts`'s field loop). That is a real finding about the current design
 * and is exactly what a benchmark is for; suppressing it and printing one
 * number would leave a reader guessing whether "particles are slow" means the
 * simulation or the extension seam. §27 field batching (sampling a whole lane
 * per call, or specialising the common built-ins) is the obvious follow-up and
 * is **not** in this packet's scope.
 *
 * ## Wall clocks: measurement, never simulation (ground rule)
 *
 * `performance.now()` appears in this file and nowhere near a simulation. It is
 * a **measurement instrument**: nothing it returns is fed back into the engine,
 * and the simulation is driven by a constant injected {@link FIXED_DELTA_TIME},
 * exactly as `Application`'s fixed-step accumulator would (§10, §33). Remove
 * every timer here and the steps produce the identical pool. The same applies
 * to the ISO timestamp written into the result file — it dates the record, it
 * does not enter the run.
 *
 * Determinism is likewise not what this file tests;
 * `tests/determinism/phase9-particles.test.ts` does that. Here the seed is
 * fixed only so that two runs measure the same work.
 *
 * ## Hardware caveat — read before quoting any number from this file
 *
 * The numbers this script prints describe **the machine it ran on**, and the
 * machine that produced the committed `results/particles-100k.json` is a **CI
 * container with no GPU**, sharing a host with other work. That matters twice
 * over:
 *
 * - **It is not "suitable hardware".** §112's phrase is a claim about a target
 *   machine; plan §6h's interpretation is what this benchmark can honestly
 *   answer, namely "here is the measured cost, on the record, on this box". A
 *   slower result here is not a failed §112 and a faster one is not a passed
 *   one. Nothing in CI asserts on these timings, and the run-to-run spread on a
 *   shared host is large (a first cold run measured a 24.6 ms mean where two
 *   later runs measured 17.5 and 17.4 — the same code, the same seed).
 * - **It measures the CPU half only.** No GL context is created, nothing is
 *   uploaded, nothing is drawn. The rendering half of §112 is WP-9.3's single
 *   instanced draw call, pinned structurally by the render and backend suites
 *   and exercised visibly — at a size SwiftShader can sustain — by
 *   `examples/particles-demo` and `tests/browser/particles.spec.ts`.
 *
 * Every run rewrites `results/particles-100k.json`, which is **committed** (it
 * is not covered by `.gitignore`). That is deliberate: plan §6h asks for
 * recorded numbers, so the file is a dated record and `git diff` after a run is
 * the honest way to see what changed. Re-running it on a different machine and
 * committing the result silently would be the dishonest use — note the host
 * fields the file carries.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Vector3 } from "@four/math";
import {
  ParticleEmitter,
  dragField,
  uniformGravityField,
  vortexField,
} from "@four/particles";

/**
 * §112's number. The emitter is sized exactly here, and prefilled to exactly
 * here, so every measured step integrates 100 000 live particles.
 */
const PARTICLE_COUNT = 100_000;

/** Fixed steps timed and reported for the headline run (600 = 10 s at 60 Hz). */
const MEASURED_STEPS = 600;

/**
 * Unmeasured steps run first, so the reported mean is steady-state rather than
 * a report on V8's optimising compiler. Their own mean is reported separately —
 * the gap between the two *is* the warm-up cost, and hiding it would be the
 * kind of omission this file exists not to make.
 */
const WARMUP_STEPS = 60;

/** Warm-up and measured steps for each attribution variant (see the header). */
const ATTRIBUTION_WARMUP_STEPS = 30;
const ATTRIBUTION_MEASURED_STEPS = 120;

/** §45 `fixedTimeStep`, in seconds (§7a: never milliseconds). */
const FIXED_DELTA_TIME = 1 / 60;

/** The budget one fixed step has at 60 Hz, in milliseconds. */
const FIXED_STEP_BUDGET_MS = FIXED_DELTA_TIME * 1000;

/** Fixed seed (§33), so two runs on one machine measure identical work. */
const SEED = 20260802;

/**
 * Lifetime long enough that nothing dies during warm-up plus measurement
 * (`660 × 1/60 = 11 s`), so the live count is constant at
 * {@link PARTICLE_COUNT} and the timings are not quietly measuring a shrinking
 * pool.
 */
const LIFETIME_SECONDS = 1_000;

/** Linear drag coefficient in s⁻¹ — well inside `c · dt < 1` at 60 Hz. */
const DRAG_COEFFICIENT = 0.2;

/** Tangential vortex strength, units²/s². */
const VORTEX_STRENGTH = 6;

/** Gravity, §7a: Y-up in both 2D and 3D, so it is negative Y. */
const GRAVITY = new Vector3(0, -9.81, 0);

/** Where the JSON record is written, relative to this file. */
const RESULTS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "results",
  "particles-100k.json",
);

/** Human-readable name of the headline field stack, for stdout and the record. */
const FIELD_STACK = `uniformGravity(0,${GRAVITY.y},0) + drag(${DRAG_COEFFICIENT}) + vortex(origin,+Y,${VORTEX_STRENGTH})`;

/**
 * The §27 stack, rebuilt per emitter so no two runs share a field object (a
 * field may hold scratch; sharing one would be a benchmark artefact).
 *
 * Order is part of the emitter's contract — floating-point addition is not
 * associative — so it is written once, here.
 */
function fieldStack(count) {
  const all = [
    () => uniformGravityField(GRAVITY),
    () => dragField(DRAG_COEFFICIENT),
    () =>
      vortexField(new Vector3(0, 0, 0), new Vector3(0, 1, 0), VORTEX_STRENGTH),
  ];
  return all.slice(0, count).map((make) => make());
}

/**
 * Builds an emitter with `fieldCount` §27 fields, already full.
 *
 * Emission is switched off and the pool is filled with a single
 * {@link ParticleEmitter.emit} call *before* timing starts, rather than left to
 * a rate or a burst. Spawning is a different cost with a different shape (four
 * seeded draws per particle, §36's cone mapping) and folding it into a per-step
 * average would make "the cost of stepping 100 000 particles" unanswerable —
 * the number §112 is stated over.
 *
 * At `fieldCount === 0` the same gravity is applied through the emitter's own
 * `gravity` option instead, so the variant measures *the field seam*, not *the
 * absence of gravity*: the arithmetic per particle is the same and only the
 * per-particle virtual call is gone.
 */
function buildFullEmitter(fieldCount) {
  const fields = fieldStack(fieldCount);
  const emitter = new ParticleEmitter({
    maxParticles: PARTICLE_COUNT,
    seed: SEED,
    emissionRate: 0,
    lifetime: { min: LIFETIME_SECONDS, max: LIFETIME_SECONDS },
    // A wide cone at a spread of speeds, so the particles occupy a volume and
    // the position-dependent field (the vortex) is sampled across its whole
    // range rather than at one radius.
    initialSpeed: { min: 1, max: 6 },
    direction: new Vector3(0, 1, 0),
    spreadAngle: Math.PI,
    size: { start: 1, end: 0 },
    color: {
      start: { r: 1, g: 0.8, b: 0.3, a: 1 },
      end: { r: 0.8, g: 0.1, b: 0.2, a: 0 },
    },
    gravity: fieldCount === 0 ? GRAVITY : undefined,
    fields,
  });

  const spawned = emitter.emit(PARTICLE_COUNT);
  if (spawned !== PARTICLE_COUNT || emitter.particleCount !== PARTICLE_COUNT) {
    throw new Error(
      `benchmark setup failed: wanted ${PARTICLE_COUNT} live particles, got ${emitter.particleCount}`,
    );
  }
  return emitter;
}

/**
 * Steps `emitter` `steps` times from `startStep`, returning one duration in
 * milliseconds per step.
 *
 * The clock is read immediately around `step` and nothing else happens inside
 * the loop: the durations array is preallocated, so the measurement does not
 * measure its own bookkeeping.
 */
function timeSteps(emitter, steps, startStep) {
  const durations = new Float64Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const time = (startStep + i + 1) * FIXED_DELTA_TIME;
    const began = performance.now();
    emitter.step(FIXED_DELTA_TIME, time);
    durations[i] = performance.now() - began;
  }
  return durations;
}

/** Arithmetic mean of a `Float64Array`. */
function mean(values) {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) {
    total += values[i];
  }
  return total / values.length;
}

/**
 * The `q`-quantile by **nearest rank** on the sorted copy — `p95` is "the 570th
 * of 600 slowest steps", an observed step time and not an interpolation between
 * two of them. Interpolating would invent a duration no step actually took.
 */
function quantile(sorted, q) {
  const rank = Math.ceil(q * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index];
}

/** Rounds to `digits` decimals, so the record is readable and diffable. */
function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Runs one attribution variant and returns its median ms/step. */
function attributionMedian(fieldCount) {
  const emitter = buildFullEmitter(fieldCount);
  timeSteps(emitter, ATTRIBUTION_WARMUP_STEPS, 0);
  const measured = timeSteps(
    emitter,
    ATTRIBUTION_MEASURED_STEPS,
    ATTRIBUTION_WARMUP_STEPS,
  );
  if (emitter.particleCount !== PARTICLE_COUNT) {
    throw new Error(
      `benchmark invalid: the ${fieldCount}-field pool changed size during the run`,
    );
  }
  return quantile(Float64Array.from(measured).sort(), 0.5);
}

// --- the headline run --------------------------------------------------------

const emitter = buildFullEmitter(3);
const warmup = timeSteps(emitter, WARMUP_STEPS, 0);
const measured = timeSteps(emitter, MEASURED_STEPS, WARMUP_STEPS);

if (emitter.particleCount !== PARTICLE_COUNT) {
  throw new Error(
    `benchmark invalid: the pool changed size during the run (${emitter.particleCount} live at the end)`,
  );
}

const sorted = Float64Array.from(measured).sort();
const meanMs = mean(measured);
const p95Ms = quantile(sorted, 0.95);
const medianMs = quantile(sorted, 0.5);
const particleStepsPerSecond = (PARTICLE_COUNT / meanMs) * 1000;

// --- the attribution run -----------------------------------------------------

const integratorOnlyMs = attributionMedian(0);
const oneFieldMs = attributionMedian(1);
const twoFieldMs = attributionMedian(2);
const perFieldMs = (twoFieldMs - integratorOnlyMs) / 2;

// --- the record --------------------------------------------------------------

const host = cpus();
const record = {
  _note:
    "Recorded measurement, not a gate. Nothing in CI asserts on these timings; see benchmarks/README.md and the header of benchmarks/particles-100k.mjs for how §112's 'suitable hardware' is interpreted (plan §6h) and why this host is not it.",
  benchmark: "particles-100k",
  specification: "§112 (Phase 9 exit), §36, §27; plan §6h, WP-9.4",
  recordedAt: new Date().toISOString(),
  particles: PARTICLE_COUNT,
  measuredSteps: MEASURED_STEPS,
  warmupSteps: WARMUP_STEPS,
  fixedDeltaTimeSeconds: round(FIXED_DELTA_TIME, 9),
  fixedStepBudgetMs: round(FIXED_STEP_BUDGET_MS, 4),
  fields: FIELD_STACK,
  collision:
    "none (the plane-collision tier is exercised by the phase9 golden)",
  warmupMeanMsPerStep: round(mean(warmup), 4),
  meanMsPerStep: round(meanMs, 4),
  medianMsPerStep: round(medianMs, 4),
  p95MsPerStep: round(p95Ms, 4),
  p99MsPerStep: round(quantile(sorted, 0.99), 4),
  minMsPerStep: round(sorted[0], 4),
  maxMsPerStep: round(sorted[sorted.length - 1], 4),
  totalMeasuredMs: round(meanMs * MEASURED_STEPS, 2),
  meanFractionOfFixedStepBudget: round(meanMs / FIXED_STEP_BUDGET_MS, 4),
  p95FractionOfFixedStepBudget: round(p95Ms / FIXED_STEP_BUDGET_MS, 4),
  particleStepsPerSecond: Math.round(particleStepsPerSecond),
  nanosecondsPerParticleStep: round((meanMs * 1e6) / PARTICLE_COUNT, 1),
  attributionMeasuredSteps: ATTRIBUTION_MEASURED_STEPS,
  integratorOnlyMedianMsPerStep: round(integratorOnlyMs, 4),
  oneFieldMedianMsPerStep: round(oneFieldMs, 4),
  twoFieldMedianMsPerStep: round(twoFieldMs, 4),
  threeFieldMedianMsPerStep: round(medianMs, 4),
  perFieldMedianMsPerStep: round(perFieldMs, 4),
  hostNode: process.version,
  hostPlatform: `${process.platform} ${process.arch}`,
  hostCpuModel: host.length > 0 ? host[0].model : "unknown",
  hostCpuCount: host.length,
  hostTotalMemoryGb: round(totalmem() / 1024 ** 3, 1),
  hostCaveat:
    "CI container, no GPU, shared host; run-to-run spread is large. CPU simulation only: no GL context, no upload, no draw. The rendering half of §112 is the single instanced draw call of @four/render-webgl, shown in examples/particles-demo.",
};

mkdirSync(dirname(RESULTS_PATH), { recursive: true });
writeFileSync(RESULTS_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");

const budgetVerdict =
  p95Ms <= FIXED_STEP_BUDGET_MS
    ? "inside the 60 Hz fixed-step budget at p95"
    : "over the 60 Hz fixed-step budget at p95 (recorded, not gated — see the header)";

process.stdout.write(
  [
    `four.js — ${PARTICLE_COUNT.toLocaleString("en-US")} particles, CPU simulation (§112, plan §6h)`,
    `  fields                  ${FIELD_STACK}`,
    `  steps                   ${MEASURED_STEPS} measured, ${WARMUP_STEPS} warm-up (${record.warmupMeanMsPerStep} ms/step)`,
    "",
    `  mean                    ${record.meanMsPerStep} ms/step`,
    `  median                  ${record.medianMsPerStep} ms/step`,
    `  p95                     ${record.p95MsPerStep} ms/step`,
    `  p99                     ${record.p99MsPerStep} ms/step`,
    `  min / max               ${record.minMsPerStep} / ${record.maxMsPerStep} ms/step`,
    "",
    `  60 Hz budget            ${round(FIXED_STEP_BUDGET_MS, 3)} ms/step — mean uses ${round(record.meanFractionOfFixedStepBudget * 100, 1)}%, p95 ${round(record.p95FractionOfFixedStepBudget * 100, 1)}%`,
    `  verdict                 ${budgetVerdict}`,
    `  throughput              ${record.particleStepsPerSecond.toLocaleString("en-US")} particle-steps/s (${record.nanosecondsPerParticleStep} ns per particle per step)`,
    "",
    `  where it goes           integrator alone ${record.integratorOnlyMedianMsPerStep} ms/step; +1 field ${record.oneFieldMedianMsPerStep}; +2 ${record.twoFieldMedianMsPerStep}; +3 ${record.threeFieldMedianMsPerStep}`,
    `                          ≈ ${record.perFieldMedianMsPerStep} ms per §27 field per ${PARTICLE_COUNT.toLocaleString("en-US")} particles (medians of ${ATTRIBUTION_MEASURED_STEPS} steps)`,
    "",
    `  host                    ${record.hostCpuModel} × ${record.hostCpuCount}, node ${record.hostNode}, ${record.hostPlatform}`,
    "  caveat                  CI container, no GPU, shared host; CPU simulation only, nothing is drawn.",
    '                          §112\'s "suitable hardware" is interpreted per plan §6h — recorded, never gated.',
    "",
    `  written                 ${RESULTS_PATH}`,
    "",
  ].join("\n"),
);
