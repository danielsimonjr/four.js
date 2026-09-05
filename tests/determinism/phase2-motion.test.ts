/**
 * Phase 2 exit test (plan WP-2.7; §105 demonstration set and exit criterion;
 * §33, §92 determinism).
 *
 * §105 closes Phase 2 on one demonstration — *"a set of 2D and 3D objects move
 * through: constant velocity; constant acceleration; circular paths; spline
 * paths; damped spring motion"* — and one criterion: *"motion is deterministic,
 * renderer-independent, and unit tested"*. This file is the proof, in four
 * forms:
 *
 * 1. **Correct.** Each of the five motions is checked at t = 1 s and t = 10 s
 *    against a closed form **derived here, from the §11/§13/§38 mathematics**,
 *    not from the engine's own code. Every reference below is written from the
 *    governing equation or from an independent formulation of the same curve
 *    (Barry–Goldman for the spline, the ODE plus an RK4 integration for the
 *    spring), so agreement is evidence rather than tautology.
 * 2. **Renderer-independent.** Nothing in the scenario constructs, configures,
 *    or is parameterised by a renderer, no canvas or DOM is touched, and the
 *    whole run executes under plain `node` with no browser environment at all
 *    (the fresh-process test). Stated precisely, because the import graph does
 *    not say it on its own: `Application` is reachable only through `four`'s
 *    root barrel, which namespace-re-exports every workspace package including
 *    `@four/render-webgl`/`-webgpu`/`-canvas`/`-svg`. Those are still Phase 0
 *    one-line stubs, so today nothing renderer-shaped even evaluates — but the
 *    guarantee this test can honestly make is behavioural, not structural, and
 *    it will need a `four/application` subpath (or a direct
 *    `@four/scene` + `@four/motion` composition) once Phase 3 puts real code
 *    behind those names. Filed by WP-2.7.
 * 3. **Deterministic in-process.** Two independent runs in one process produce
 *    byte-identical per-step digests, simulation and render poses alike.
 * 4. **Deterministic across processes, against a committed golden.** A fresh
 *    `node` child process — new heap, new module graph, new JIT state — running
 *    *the same helper file* reproduces the same 600 digests and the same probe
 *    poses, and matches `golden/phase2.json`.
 *
 * ## The golden file is immutable
 *
 * `golden/phase2.json` is evidence, not configuration. **Never regenerate it to
 * make this test pass.** A mismatch is a real finding: engine behaviour changed
 * between the run that produced the golden and the run under test. The correct
 * response is to identify the change and decide whether it is intended — and
 * only then, as a reviewed and recorded decision (CHANGELOG.md, MEMORY.md),
 * write new values. The per-step digests exist for exactly this diagnosis: the
 * first index at which two runs disagree localises the divergence to a step.
 * The closed-form tests above localise it further, to a motion.
 *
 * ## Tolerances
 *
 * Two constants, used deliberately (WP-2.7 requires each choice to be
 * justified):
 *
 * - {@link DISCRETE_TOLERANCE} = 1e-9 wherever the reference value is
 *   **exactly** what the engine should compute in real arithmetic, so the only
 *   admissible difference is floating-point: summing 600 deltas of 1/60,
 *   evaluating a transcendental by a different but algebraically equal route,
 *   or renormalising a quaternion 600 times. The largest such difference
 *   actually observed across all five motions is 3.2e-13 (the circular path at
 *   t = 10 s, where the controller's accumulated elapsed time is
 *   10 + 7.6e-14 rather than exactly 10) — roughly 3000× inside the tolerance,
 *   which leaves room for a different engine's transcendentals without leaving
 *   room for a real regression.
 * - {@link CONTINUOUS_TOLERANCE} = 1e-6 for the two places where a *discrete*
 *   quantity is compared with a *continuous* one: the damped-acceleration
 *   closed form refined toward `dt → 0` against the solution of `v' = a − c·v`,
 *   and the spring's analytic envelope against an RK4 integration of its ODE.
 *   Both carry genuine truncation error, bounded and measured in the comments
 *   at their use sites.
 *
 * ## Why the child process runs a `.ts` file directly
 *
 * Identical to WP-1.14: the in-process and fresh-process runs must execute the
 * same code, so both load `helpers/phase2-scenario.ts` — Vitest through Vite,
 * plain `node` through its default type-stripping (Node ≥ 22.18; this repo pins
 * Node ≥ 20 and runs 22.22). The child is launched with `--input-type=module
 * -e`, importing the helper by absolute `file:` URL, so there is no second
 * runner file to drift out of sync with this one.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, test } from "vitest";

import {
  CIRCULAR,
  CONSTANT_ACCELERATION,
  CONSTANT_VELOCITY,
  DEMO_NAMES,
  FIXED_TIME_STEP,
  PROBE_STEP_ONE_SECOND,
  PROBE_STEP_TEN_SECONDS,
  SIMULATED_SECONDS,
  SPLINE,
  SPRING,
  STEP_COUNT,
  runPhase2Scenario,
  type DemoSample,
  type Phase2ScenarioResult,
  type Phase2Summary,
  type ProbeSample,
  type Triple,
} from "./helpers/phase2-scenario.js";

/** The committed golden, plus the underscore-prefixed prose fields it carries. */
interface GoldenFile extends Phase2Summary {
  _warning: string;
  _tier: string;
}

const GOLDEN_URL = new URL("./golden/phase2.json", import.meta.url);
const HELPER_URL = new URL("./helpers/phase2-scenario.ts", import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** Generous ceiling: one scenario run is well under a second; a cold child adds process start. */
const RUN_TIMEOUT_MS = 120_000;

/** See the header: exact-in-real-arithmetic comparisons. */
const DISCRETE_TOLERANCE = 1e-9;

/** See the header: discrete-vs-continuous comparisons. */
const CONTINUOUS_TOLERANCE = 1e-6;

// ---------------------------------------------------------------------------
// Assertion helper
// ---------------------------------------------------------------------------

/**
 * Absolute-tolerance comparison with a labelled failure.
 *
 * Absolute rather than relative because several expected values are legitimately
 * zero or near-zero (the constant-velocity node's Y, the settled spring's
 * offset, the `w` component of a quaternion at 5π), where a relative test is
 * either undefined or absurdly strict.
 */
function expectWithin(
  actual: number,
  expected: number,
  tolerance: number,
  what: string,
): void {
  const difference = Math.abs(actual - expected);
  expect(
    difference,
    `${what}: actual ${String(actual)} vs expected ${String(expected)} (difference ${String(difference)})`,
  ).toBeLessThanOrEqual(tolerance);
}

/** {@link expectWithin} for all three components of a position. */
function expectPositionWithin(
  actual: Triple,
  expected: Triple,
  tolerance: number,
  what: string,
): void {
  expectWithin(actual[0], expected[0], tolerance, `${what} x`);
  expectWithin(actual[1], expected[1], tolerance, `${what} y`);
  expectWithin(actual[2], expected[2], tolerance, `${what} z`);
}

// ---------------------------------------------------------------------------
// Reference 1 — MotionComponent under constant velocity (§11, §38)
// ---------------------------------------------------------------------------

/**
 * Position of a `MotionComponent` with zero acceleration and zero damping,
 * after `n` fixed steps of `dt`.
 *
 * WP-2.2 pins the per-step rule to semi-implicit Euler:
 *
 * ```text
 * v ← (v + a·dt) / (1 + c·dt);   x ← x + v·dt
 * ```
 *
 * With `a = 0` and `c = 0` the velocity never changes, so `x_n = x₀ + n·v·dt`
 * exactly — and since `n·dt` is the simulated time, this is also the continuous
 * answer `x(t) = x₀ + v·t`. The discrete and continuous forms coincide, which is
 * why this case is asserted at {@link DISCRETE_TOLERANCE}: the only difference
 * available is the rounding of 600 successive additions (observed: 1.5e-13 on
 * a coordinate of magnitude 20).
 */
function constantVelocityPosition(x0: number, v: number, t: number): number {
  return x0 + v * t;
}

/**
 * Orientation after `t` seconds of a constant axis-angle rate `ω` about a fixed
 * axis, as `[x, y, z, w]`.
 *
 * WP-2.2's angular rule builds `q = axisAngle(ω̂, |ω|·dt)` each step and
 * premultiplies. Rotations about a **fixed** axis commute and their angles add,
 * so `n` such steps compose to a single rotation of `n·|ω|·dt = |ω|·t` about
 * that axis — continuously through the quaternion double cover, so the sign is
 * unambiguous and no shortest-arc wrapping applies. For the scenario's +Y axis
 * that is `(0, sin(θ/2), 0, cos(θ/2))` with `θ = |ω|·t`.
 *
 * At t = 10 s, θ = 5π: the expected quaternion is `(0, 1, 0, 0)` — the *second*
 * sheet of the double cover, which is what makes this a real test of the
 * composition rather than of `setFromAxisAngle`.
 */
function rotationAboutY(rate: number, t: number): readonly number[] {
  const halfAngle = (rate * t) / 2;
  return [0, Math.sin(halfAngle), 0, Math.cos(halfAngle)];
}

// ---------------------------------------------------------------------------
// Reference 2 — MotionComponent under constant acceleration with damping
// ---------------------------------------------------------------------------

/**
 * Exact solution of WP-2.2's pinned recurrence after `n` steps.
 *
 * The recurrence (§38 semi-implicit Euler, with the damping factor and the
 * speed clamp between the two half-updates; no clamp is set on this node):
 *
 * ```text
 * v_k = f · (v_{k-1} + a·dt),      f = 1 / (1 + c·dt)
 * x_k = x_{k-1} + v_k·dt
 * ```
 *
 * Unrolling the velocity recurrence gives a geometric series,
 *
 * ```text
 * v_n = fⁿ·v₀ + a·dt·(f + f² + … + fⁿ)
 * ```
 *
 * and the position is `x₀ + dt·Σ_{k=1..n} v_k`. Writing `S_n = Σ_{k=1..n} fᵏ =
 * f(1 − fⁿ)/(1 − f)`,
 *
 * ```text
 * x_n = x₀ + dt·[ v₀·S_n + a·dt·(f/(1−f))·(n − S_n) ]
 * ```
 *
 * The two awkward factors simplify exactly, because `1 − f = c·dt·f`:
 *
 * ```text
 * f/(1−f) = 1/(c·dt)      S_n = (1 − fⁿ)/(c·dt)
 * x_n = x₀ + dt·[ v₀·S_n + (a/c)·(n − S_n) ]
 * ```
 *
 * which is the form below. Note `a/c` is the terminal velocity, and `n − S_n`
 * is the number of steps' worth of terminal-velocity travel already achieved —
 * the formula's two terms are "the initial velocity decaying away" and "the
 * approach to terminal velocity", which is the right physics.
 *
 * Requires `c > 0`; the undamped limit is {@link undampedAccelerationPosition}.
 */
function dampedAccelerationPosition(
  x0: number,
  v0: number,
  a: number,
  c: number,
  dt: number,
  n: number,
): number {
  const f = 1 / (1 + c * dt);
  const partialSum = (1 - f ** n) / (c * dt);
  return x0 + dt * (v0 * partialSum + (a / c) * (n - partialSum));
}

/**
 * The same recurrence with `c = 0`, where `f = 1` makes
 * {@link dampedAccelerationPosition} divide by zero.
 *
 * ```text
 * v_k = v₀ + k·a·dt
 * x_n = x₀ + dt·Σ_{k=1..n}(v₀ + k·a·dt) = x₀ + n·v₀·dt + a·dt²·n(n+1)/2
 * ```
 *
 * Used only as a cross-check of the general formula's limiting behaviour. It is
 * also the cleanest statement of why semi-implicit Euler is *not* the continuous
 * answer: against `x₀ + v₀t + ½at²` it carries a systematic `+½·a·dt·t` — at
 * dt = 1/60 and a = −9.81 that is −8.2 cm after one second, far above any
 * tolerance here, and a test that ignored it would be testing the wrong
 * equation.
 */
function undampedAccelerationPosition(
  x0: number,
  v0: number,
  a: number,
  dt: number,
  n: number,
): number {
  return x0 + n * v0 * dt + (a * dt * dt * (n * (n + 1))) / 2;
}

/**
 * The continuous motion the damped recurrence discretises: `v' = a − c·v`,
 * `x' = v`, with `x(0) = x₀`, `v(0) = v₀`.
 *
 * ```text
 * v(t) = a/c + (v₀ − a/c)·e^(−c·t)
 * x(t) = x₀ + (a/c)·t + (v₀ − a/c)·(1 − e^(−c·t))/c
 * ```
 *
 * (The per-step factor `1/(1 + c·dt)` is the backward-Euler discretisation of
 * that decay, so the recurrence is first-order consistent with this ODE —
 * which the convergence test asserts rather than assumes.)
 */
function continuousDampedPosition(
  x0: number,
  v0: number,
  a: number,
  c: number,
  t: number,
): number {
  const terminal = a / c;
  return x0 + terminal * t + ((v0 - terminal) * (1 - Math.exp(-c * t))) / c;
}

// ---------------------------------------------------------------------------
// Reference 3 — circular trajectory (§13)
// ---------------------------------------------------------------------------

/**
 * `CircularTrajectory`'s parametrisation, in the XY plane (§7a: Y-up in 2D as
 * well as 3D), followed with `loop: true`:
 *
 * ```text
 * θ(t) = phase + ω·(t mod T),   T = 2π/|ω|
 * p(t) = center + (r·cos θ, r·sin θ, 0)
 * ```
 *
 * The wrap is `KinematicController.followPath`'s `elapsed % duration`, and the
 * revolution time `T` is the trajectory's derived `duration`. Both are pinned
 * by WP-2.4/WP-2.5; the evaluation here is written from the parametrisation.
 */
function circularPosition(t: number): Triple {
  const revolution = (2 * Math.PI) / Math.abs(CIRCULAR.angularVelocity);
  const wrapped = t % revolution;
  const angle = CIRCULAR.phase + CIRCULAR.angularVelocity * wrapped;
  return [
    CIRCULAR.center[0] + CIRCULAR.radius * Math.cos(angle),
    CIRCULAR.center[1] + CIRCULAR.radius * Math.sin(angle),
    CIRCULAR.center[2],
  ];
}

// ---------------------------------------------------------------------------
// Reference 4 — Catmull-Rom spline (§13), Barry–Goldman formulation
// ---------------------------------------------------------------------------

/**
 * Non-uniform Catmull-Rom by the **Barry–Goldman pyramidal algorithm** — three
 * levels of knot-parameter linear interpolation:
 *
 * ```text
 * A₁ = lerp(p₀, p₁; t₀, t₁)   A₂ = lerp(p₁, p₂; t₁, t₂)   A₃ = lerp(p₂, p₃; t₂, t₃)
 * B₁ = lerp(A₁, A₂; t₀, t₂)   B₂ = lerp(A₂, A₃; t₁, t₃)
 * C  = lerp(B₁, B₂; t₁, t₂)
 * ```
 *
 * This is a genuinely independent evaluation: the engine builds a cubic Hermite
 * with Catmull-Rom finite-difference tangents, which is provably the same curve
 * but a completely different arithmetic route. The knot construction it shares
 * (cumulative `|Δp|^alpha` with the 1e-8 floor, reflected virtual end points,
 * and the affine `time → knot` map) is *design*, pinned by WP-2.4, not
 * implementation — the reference reproduces those conventions from the
 * documented construction, then evaluates the curve its own way.
 *
 * Sanity anchors that come out of this reference for free and are asserted
 * below: `s(0)` is the first waypoint and `s(duration)` the last, exactly.
 */
function splinePosition(t: number): Triple {
  const points = SPLINE.points;
  const last = points.length - 1;
  const reflect = (a: Triple, b: Triple): Triple => [
    2 * a[0] - b[0],
    2 * a[1] - b[1],
    2 * a[2] - b[2],
  ];
  const extended: Triple[] = [
    reflect(points[0], points[1]),
    ...points,
    reflect(points[last], points[last - 1]),
  ];

  const knots: number[] = [0];
  for (let i = 1; i < extended.length; i += 1) {
    const dx = extended[i][0] - extended[i - 1][0];
    const dy = extended[i][1] - extended[i - 1][1];
    const dz = extended[i][2] - extended[i - 1][2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // 1e-8 floor: WP-2.4's guard against coincident waypoints collapsing a span.
    knots.push(knots[i - 1] + Math.max(distance ** SPLINE.alpha, 1e-8));
  }
  const span = knots[knots.length - 2] - knots[1];
  const s = knots[1] + (t / SPLINE.duration) * span;

  // Segment j spans extended[j] → extended[j+1]; the last real segment also
  // serves out-of-range times, which extrapolate its cubic.
  const lastSegment = extended.length - 3;
  let j = 1;
  while (j < lastSegment && s >= knots[j + 1]) {
    j += 1;
  }

  const between = (p: Triple, q: Triple, ta: number, tb: number): Triple => {
    const u = (s - ta) / (tb - ta);
    return [
      p[0] + (q[0] - p[0]) * u,
      p[1] + (q[1] - p[1]) * u,
      p[2] + (q[2] - p[2]) * u,
    ];
  };

  const a1 = between(extended[j - 1], extended[j], knots[j - 1], knots[j]);
  const a2 = between(extended[j], extended[j + 1], knots[j], knots[j + 1]);
  const a3 = between(
    extended[j + 1],
    extended[j + 2],
    knots[j + 1],
    knots[j + 2],
  );
  const b1 = between(a1, a2, knots[j - 1], knots[j + 1]);
  const b2 = between(a2, a3, knots[j], knots[j + 2]);
  return between(b1, b2, knots[j], knots[j + 1]);
}

// ---------------------------------------------------------------------------
// Reference 5 — damped spring (§13)
// ---------------------------------------------------------------------------

/** `ωₙ = 2π·f`, the undamped natural frequency in radians per second. */
const SPRING_OMEGA = 2 * Math.PI * SPRING.frequencyHz;

/** `σ = ζ·ωₙ`, the envelope decay rate. */
const SPRING_SIGMA = SPRING.dampingRatio * SPRING_OMEGA;

/** `ω_d = ωₙ·√(1 − ζ²)`, the damped frequency (ζ < 1 here). */
const SPRING_DAMPED_OMEGA =
  SPRING_OMEGA * Math.sqrt(1 - SPRING.dampingRatio * SPRING.dampingRatio);

/**
 * Fraction of the initial displacement remaining at `t`, for the underdamped
 * solution of `y'' + 2ζωₙ·y' + ωₙ²·y = 0` released from rest (`y(0) = 1`,
 * `y'(0) = 0`):
 *
 * ```text
 * y(t) = e^(−σt)·(cos ω_d t + (σ/ω_d)·sin ω_d t)
 * ```
 *
 * Derivation: the characteristic roots are `−σ ± i·ω_d`, so
 * `y = e^(−σt)(A cos ω_d t + B sin ω_d t)`; `y(0) = 1` gives `A = 1`, and
 * `y'(0) = −σA + ω_d B = 0` gives `B = σ/ω_d`.
 *
 * The scenario's spring pulls a point along the straight line `from → to`, so
 * every component shares this one scalar envelope:
 * `x(t) = to + (from − to)·y(t)`.
 */
function springEnvelope(t: number): number {
  return (
    Math.exp(-SPRING_SIGMA * t) *
    (Math.cos(SPRING_DAMPED_OMEGA * t) +
      (SPRING_SIGMA / SPRING_DAMPED_OMEGA) * Math.sin(SPRING_DAMPED_OMEGA * t))
  );
}

/** Position of the spring node at `t`, from {@link springEnvelope}. */
function springPosition(t: number): Triple {
  const e = springEnvelope(t);
  return [
    SPRING.to[0] + (SPRING.from[0] - SPRING.to[0]) * e,
    SPRING.to[1] + (SPRING.from[1] - SPRING.to[1]) * e,
    SPRING.to[2] + (SPRING.from[2] - SPRING.to[2]) * e,
  ];
}

/**
 * The same envelope obtained by integrating the ODE numerically with classical
 * RK4 — an independent route to the same number that uses none of the closed
 * form's algebra.
 *
 * State `(y, y')` with `y'' = −2ζωₙ·y' − ωₙ²·y`. RK4's global error is
 * `O(h⁴)`; at `h = 1e-4` and `ωₙ ≈ 3.14` that bound is ~1e-14, and the observed
 * difference from the closed form is 1e-15, which is why
 * {@link CONTINUOUS_TOLERANCE} (1e-6) is a comfortable ceiling rather than a
 * fudge.
 */
function rk4Envelope(t: number, h: number): number {
  const accelerationOf = (y: number, v: number): number =>
    -2 * SPRING.dampingRatio * SPRING_OMEGA * v -
    SPRING_OMEGA * SPRING_OMEGA * y;
  let y = 1;
  let v = 0;
  const steps = Math.round(t / h);
  for (let i = 0; i < steps; i += 1) {
    const k1y = v;
    const k1v = accelerationOf(y, v);
    const k2y = v + (h / 2) * k1v;
    const k2v = accelerationOf(y + (h / 2) * k1y, v + (h / 2) * k1v);
    const k3y = v + (h / 2) * k2v;
    const k3v = accelerationOf(y + (h / 2) * k2y, v + (h / 2) * k2v);
    const k4y = v + h * k3v;
    const k4v = accelerationOf(y + h * k3y, v + h * k3v);
    y += (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  }
  return y;
}

// ---------------------------------------------------------------------------
// Cross-run comparison plumbing
// ---------------------------------------------------------------------------

/**
 * The index of the first differing digest, or `-1` when the two arrays are
 * identical. Reported on failure so a divergence names a step rather than just
 * a mismatched summary hash.
 */
function firstDivergence(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    if (a[i] !== b[i]) {
      return i;
    }
  }
  return a.length === b.length ? -1 : shared;
}

/**
 * Runs the scenario in a fresh `node` process and parses what it printed.
 *
 * The child inherits no state from Vitest beyond the environment: no Vite, no
 * transform pipeline, no test globals. It writes exactly one JSON object to
 * stdout; anything on stderr is surfaced in the failure message.
 */
function runScenarioInChildProcess(): Phase2ScenarioResult {
  const source =
    `const scenario = await import(${JSON.stringify(HELPER_URL.href)});\n` +
    `const result = await scenario.runPhase2Scenario();\n` +
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

  return JSON.parse(child.stdout) as Phase2ScenarioResult;
}

/** Every demonstration's pose in one probe, as a flat comparable array. */
function flattenProbe(sample: ProbeSample): number[] {
  const flat: number[] = [];
  for (const name of DEMO_NAMES) {
    const demo: DemoSample = sample[name];
    flat.push(...demo.position, ...demo.rotation);
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Phase 2 exit: the §105 motion demonstration set", () => {
  let first: Phase2ScenarioResult;
  let second: Phase2ScenarioResult;
  let child: Phase2ScenarioResult;

  beforeAll(async () => {
    first = await runPhase2Scenario();
    second = await runPhase2Scenario();
    child = runScenarioInChildProcess();
  }, RUN_TIMEOUT_MS);

  test("the scenario runs the clean 600-step schedule the closed forms assume", () => {
    // Guards on the *inputs*. A scenario that quietly stopped stepping, or
    // started dropping time, could otherwise satisfy the digest tests with a
    // degenerate run — and would silently invalidate every "at t = 1 s" claim
    // below, since those name a simulation time, not a frame index.
    expect(first.frameCount).toBe(STEP_COUNT);
    expect(first.fixedStepCount).toBe(STEP_COUNT);
    expect(first.digests).toHaveLength(STEP_COUNT);
    expect(first.renderDigests).toHaveLength(STEP_COUNT);
    expect(first.hashedNodeCount).toBe(DEMO_NAMES.length + 1);

    // Exactly one fixed step per frame: nothing clamped, nothing dropped, and
    // no partial step left in the accumulator (§9, §10).
    expect(first.droppedTime).toBe(0);
    expect(first.maximumInterpolationAlpha).toBe(0);
    expectWithin(
      first.simulationTime,
      SIMULATED_SECONDS,
      DISCRETE_TOLERANCE,
      "simulationTime",
    );
    expectWithin(
      STEP_COUNT * FIXED_TIME_STEP,
      SIMULATED_SECONDS,
      DISCRETE_TOLERANCE,
      "STEP_COUNT * FIXED_TIME_STEP",
    );

    // §42: every node declared "kinematic" before any system ran, so no system
    // ever attempted a write it did not own. Measured, not assumed.
    expect(first.authorityWarningCount).toBe(0);

    // §43: render poses are presentation-only and never feed back (§42).
    expect(first.renderPoseTouchedTransforms).toBe(false);

    // Not a stuck scene: every step's world state, and every step's render
    // pose, is distinct.
    expect(new Set(first.digests).size).toBe(STEP_COUNT);
    expect(new Set(first.renderDigests).size).toBe(STEP_COUNT);
  });

  test("1. constant velocity (§105) matches x = x₀ + v·t", () => {
    const rate = CONSTANT_VELOCITY.angularVelocity[1];
    for (const [step, t] of [
      [PROBE_STEP_ONE_SECOND, 1],
      [PROBE_STEP_TEN_SECONDS, SIMULATED_SECONDS],
    ] as const) {
      const sample =
        step === PROBE_STEP_ONE_SECOND ? first.atOneSecond : first.atTenSeconds;
      const demo = sample["constant-velocity"];
      const expected: Triple = [
        constantVelocityPosition(
          CONSTANT_VELOCITY.start[0],
          CONSTANT_VELOCITY.linearVelocity[0],
          t,
        ),
        constantVelocityPosition(
          CONSTANT_VELOCITY.start[1],
          CONSTANT_VELOCITY.linearVelocity[1],
          t,
        ),
        constantVelocityPosition(
          CONSTANT_VELOCITY.start[2],
          CONSTANT_VELOCITY.linearVelocity[2],
          t,
        ),
      ];
      expectPositionWithin(
        demo.position,
        expected,
        DISCRETE_TOLERANCE,
        `constant velocity at t=${String(t)}s`,
      );

      // The zero-velocity axis is exactly zero, not merely close: adding 0·dt
      // to 0 six hundred times must not manufacture drift.
      expect(demo.position[1]).toBe(0);

      // Angular: 600 composed axis-angle premultiplies about a fixed axis.
      const expectedRotation = rotationAboutY(rate, t);
      for (let i = 0; i < 4; i += 1) {
        expectWithin(
          demo.rotation[i],
          expectedRotation[i],
          DISCRETE_TOLERANCE,
          `constant velocity rotation[${String(i)}] at t=${String(t)}s`,
        );
      }
    }

    // At t = 10 s the accumulated angle is 5π — the far sheet of the double
    // cover — so the composition genuinely wrapped past 2π twice.
    expect(
      Math.abs(first.atTenSeconds["constant-velocity"].rotation[1]),
    ).toBeGreaterThan(0.999_999);
  });

  test("2. constant acceleration (§105) matches the discrete damped closed form", () => {
    const { start, linearVelocity, linearAcceleration, damping } =
      CONSTANT_ACCELERATION;
    for (const [step, n] of [
      [PROBE_STEP_ONE_SECOND, PROBE_STEP_ONE_SECOND],
      [PROBE_STEP_TEN_SECONDS, PROBE_STEP_TEN_SECONDS],
    ] as const) {
      const sample =
        step === PROBE_STEP_ONE_SECOND ? first.atOneSecond : first.atTenSeconds;
      const demo = sample["constant-acceleration"];
      const expected: Triple = [
        dampedAccelerationPosition(
          start[0],
          linearVelocity[0],
          linearAcceleration[0],
          damping,
          FIXED_TIME_STEP,
          n,
        ),
        dampedAccelerationPosition(
          start[1],
          linearVelocity[1],
          linearAcceleration[1],
          damping,
          FIXED_TIME_STEP,
          n,
        ),
        dampedAccelerationPosition(
          start[2],
          linearVelocity[2],
          linearAcceleration[2],
          damping,
          FIXED_TIME_STEP,
          n,
        ),
      ];
      expectPositionWithin(
        demo.position,
        expected,
        DISCRETE_TOLERANCE,
        `constant acceleration after ${String(n)} steps`,
      );
    }

    // The engine is *not* computing the continuous ½at² answer, and must not
    // be: semi-implicit Euler carries a systematic +½·a·dt·t. Asserting the
    // size of that gap pins which equation is being solved — a naive test
    // against x₀+v₀t+½at² would have to loosen its tolerance to 0.1 and would
    // then pass for an integrator that was simply wrong.
    const t = 1;
    const continuousUndamped =
      start[1] + linearVelocity[1] * t + 0.5 * linearAcceleration[1] * t * t;
    const discreteUndamped = undampedAccelerationPosition(
      start[1],
      linearVelocity[1],
      linearAcceleration[1],
      FIXED_TIME_STEP,
      PROBE_STEP_ONE_SECOND,
    );
    expectWithin(
      discreteUndamped - continuousUndamped,
      0.5 * linearAcceleration[1] * FIXED_TIME_STEP * t,
      DISCRETE_TOLERANCE,
      "semi-implicit Euler offset ½·a·dt·t (undamped limit)",
    );
  });

  test("2b. the damped recurrence converges to v' = a − c·v as dt → 0", () => {
    // The one genuine continuous-vs-discrete comparison for this node, at
    // CONTINUOUS_TOLERANCE. `dampedAccelerationPosition` is O(1) to evaluate
    // for any n, so the limit can be probed directly at dt = 1e-8 (n = 1e8 and
    // 1e9 steps) instead of by simulating it.
    //
    // Truncation is first order in dt, with a coefficient of ~5 for these
    // values, so the residual at dt = 1e-8 is ~5e-8; floating-point noise in
    // `f ** n` starts to dominate below about dt = 1e-9. 1e-6 sits an order of
    // magnitude above the observed residual (5e-8 worst case, at t = 1 s) and
    // three below the dt = 1/60 error (5.7e-2), so it distinguishes
    // "consistent integrator" from "wrong equation".
    const { start, linearVelocity, linearAcceleration, damping } =
      CONSTANT_ACCELERATION;
    const refinedStep = 1e-8;
    for (const t of [1, SIMULATED_SECONDS]) {
      const refined = dampedAccelerationPosition(
        start[1],
        linearVelocity[1],
        linearAcceleration[1],
        damping,
        refinedStep,
        t / refinedStep,
      );
      expectWithin(
        refined,
        continuousDampedPosition(
          start[1],
          linearVelocity[1],
          linearAcceleration[1],
          damping,
          t,
        ),
        CONTINUOUS_TOLERANCE,
        `damped acceleration limit at t=${String(t)}s`,
      );
    }
  });

  test("3. circular path (§105) matches the circle parametrisation", () => {
    expectPositionWithin(
      first.atOneSecond["circular-path"].position,
      circularPosition(1),
      DISCRETE_TOLERANCE,
      "circular path at t=1s",
    );
    // t = 10 s is two revolutions plus 2 s, i.e. the diametrically opposite
    // point of the t = 2 s pose — the assertion that proves `loop: true`
    // actually wrapped rather than the command having quietly completed at its
    // 4 s duration.
    expectPositionWithin(
      first.atTenSeconds["circular-path"].position,
      circularPosition(SIMULATED_SECONDS),
      DISCRETE_TOLERANCE,
      "circular path at t=10s",
    );

    // §7a: the circle lies in the XY plane, so Z never leaves the centre.
    expect(first.atOneSecond["circular-path"].position[2]).toBe(
      CIRCULAR.center[2],
    );
    expect(first.atTenSeconds["circular-path"].position[2]).toBe(
      CIRCULAR.center[2],
    );

    // Still on the circle after 10 s of stepping, to the same tolerance: a
    // drifting radius would be invisible to a component-wise check that
    // happened to land near a symmetric point.
    const p = first.atTenSeconds["circular-path"].position;
    const radius = Math.hypot(
      p[0] - CIRCULAR.center[0],
      p[1] - CIRCULAR.center[1],
    );
    expectWithin(radius, CIRCULAR.radius, DISCRETE_TOLERANCE, "circle radius");
  });

  test("4. spline path (§105) matches an independent Barry–Goldman evaluation", () => {
    expectPositionWithin(
      first.atOneSecond["spline-path"].position,
      splinePosition(1),
      DISCRETE_TOLERANCE,
      "spline path at t=1s",
    );

    // The spline's 8 s duration expires before the run ends and the follow is
    // not looping, so the node holds the final waypoint for the last 2 s.
    // Both facts are asserted: the reference curve at t = duration *is* the
    // last waypoint (a property of the Catmull-Rom construction), and the
    // engine is sitting there.
    expectPositionWithin(
      splinePosition(SPLINE.duration),
      SPLINE.points[SPLINE.points.length - 1],
      DISCRETE_TOLERANCE,
      "spline reference at t=duration",
    );
    expectPositionWithin(
      first.atTenSeconds["spline-path"].position,
      SPLINE.points[SPLINE.points.length - 1],
      DISCRETE_TOLERANCE,
      "spline path at t=10s (held after completion)",
    );

    // Interpolating, not approximating: the reference passes through the first
    // waypoint at t = 0, which is what makes the t = 1 s value above a claim
    // about the *curve* and not just about two matching formulas.
    expectPositionWithin(
      splinePosition(0),
      SPLINE.points[0],
      DISCRETE_TOLERANCE,
      "spline reference at t=0",
    );

    // And the t = 1 s point is genuinely mid-curve, not parked on a waypoint.
    const mid = first.atOneSecond["spline-path"].position;
    for (const point of SPLINE.points) {
      const distance = Math.hypot(
        mid[0] - point[0],
        mid[1] - point[1],
        mid[2] - point[2],
      );
      expect(distance).toBeGreaterThan(0.1);
    }
  });

  test("5. damped spring (§105) matches the underdamped closed form", () => {
    expectPositionWithin(
      first.atOneSecond["damped-spring"].position,
      springPosition(1),
      DISCRETE_TOLERANCE,
      "damped spring at t=1s",
    );
    expectPositionWithin(
      first.atTenSeconds["damped-spring"].position,
      springPosition(SIMULATED_SECONDS),
      DISCRETE_TOLERANCE,
      "damped spring at t=10s",
    );

    // Underdamped means it overshoots: at t = 1 s the envelope is negative, so
    // the node is on the far side of `to` from `from`. Without this the
    // closed-form match could be satisfied by a monotone ease.
    expect(springEnvelope(1)).toBeLessThan(-0.1);
    expect(first.atOneSecond["damped-spring"].position[0]).toBeGreaterThan(
      SPRING.to[0],
    );

    // And it settles: 10 s is ~7.9 time constants, leaving 1.3e-4 of the
    // displacement.
    expect(Math.abs(springEnvelope(SIMULATED_SECONDS))).toBeLessThan(1e-3);
  });

  test("5b. the spring's closed form matches an RK4 integration of its ODE", () => {
    // Continuous-vs-continuous by two different methods, at
    // CONTINUOUS_TOLERANCE: the analytic envelope against a numerical solution
    // of x'' + 2ζωₙx' + ωₙ²x = 0. Observed difference is ~1e-15 at both probes;
    // 1e-6 is the stated ceiling for any non-exact comparison.
    for (const t of [1, SIMULATED_SECONDS]) {
      expectWithin(
        rk4Envelope(t, 1e-4),
        springEnvelope(t),
        CONTINUOUS_TOLERANCE,
        `spring envelope by RK4 at t=${String(t)}s`,
      );
    }
  });

  test("two in-process runs produce identical digests and probes", () => {
    expect(firstDivergence(first.digests, second.digests)).toBe(-1);
    expect(firstDivergence(first.renderDigests, second.renderDigests)).toBe(-1);
    expect(second.summary).toEqual(first.summary);
    expect(flattenProbe(second.atOneSecond)).toEqual(
      flattenProbe(first.atOneSecond),
    );
    expect(flattenProbe(second.atTenSeconds)).toEqual(
      flattenProbe(first.atTenSeconds),
    );
    expect(second.fixedStepCount).toBe(first.fixedStepCount);
    expect(second.droppedTime).toBe(first.droppedTime);
  });

  test("the in-process run matches the committed golden digests", () => {
    // If this fails: DO NOT edit golden/phase2.json. See this file's header.
    expect(first.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(first.summary.lastStepDigest).toBe(golden.lastStepDigest);
    expect(first.summary.summaryDigest).toBe(golden.summaryDigest);

    // The published probes really are the digests they claim to be.
    expect(first.digests[0]).toBe(first.summary.firstStepDigest);
    expect(first.digests[STEP_COUNT - 1]).toBe(first.summary.lastStepDigest);
  });

  test("a fresh node process reproduces the same digests and the golden", () => {
    expect(firstDivergence(child.digests, first.digests)).toBe(-1);
    expect(firstDivergence(child.renderDigests, first.renderDigests)).toBe(-1);
    expect(child.summary).toEqual(first.summary);
    expect(child.summary.summaryDigest).toBe(golden.summaryDigest);
    expect(child.summary.firstStepDigest).toBe(golden.firstStepDigest);
    expect(child.summary.lastStepDigest).toBe(golden.lastStepDigest);

    // The child ran the same simulation, not just the same hash.
    expect(flattenProbe(child.atOneSecond)).toEqual(
      flattenProbe(first.atOneSecond),
    );
    expect(flattenProbe(child.atTenSeconds)).toEqual(
      flattenProbe(first.atTenSeconds),
    );
    expect(child.fixedStepCount).toBe(first.fixedStepCount);
    expect(child.droppedTime).toBe(first.droppedTime);
    expect(child.authorityWarningCount).toBe(0);
    expect(child.renderPoseTouchedTransforms).toBe(false);
  });

  test("the golden file carries its immutability warning and tier", () => {
    expect(golden._warning).toMatch(/DO NOT REGENERATE/i);
    expect(golden._tier).toMatch(/same-runtime/i);
  });
});
