# Benchmarks

Benchmark harness tracking the performance targets of §86 (e.g. 100k batched sprites @60fps,
50k batched shapes, 5k active rigid bodies, 25k CPU / 100k+ GPU particles, near-zero idle
work) and the metrics of §92: CPU/GPU/simulation time, draw calls, contacts, memory,
allocations, loading throughput.

**The harness landed in Phase 11 (§113a, plan §6j P11-4, WP-11.4).** `harness.mjs` is a
library — warm up, measure, reduce to order statistics, stamp the host, write one JSON
record, print a report — extracted unchanged in substance from `particles-100k.mjs`, the
Phase 9 script that was deliberately written without a framework until there was more than
one script to design around. There is still no runner and no CI integration: a benchmark
here is a plain `node` script that imports six small functions.

```sh
pnpm run build               # every script imports the built dist, not src
node benchmarks/harness.mjs  # prints the suite index and how to run it
```

`node benchmarks/harness.mjs` runs nothing; it is the suite's index and the smoke test that
the module loads. Run the five scripts individually. The whole suite takes about **75 s** on
the recorded host, dominated by `physics-step.mjs` (~40 s) and `particles-100k.mjs` (~15 s).

| script                                                                         | what it measures                                                             | §86 row                                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`math-ops.mjs`](#math-opsmjs--7b-math-throughput-and-allocation)              | `Vector3`/`Quaternion`/`Matrix4` throughput **and per-operation allocation** | none — the foundation the rows sit on                     |
| [`scene-propagation.mjs`](#scene-propagationmjs--7-world-transform-resolution) | `resolveWorldTransforms` over deep and wide trees, dirty and clean           | _idle scene_, for the scene graph                         |
| [`physics-step.mjs`](#physics-stepmjs--86s-5-000-active-rigid-bodies)          | Rapier 3D fixed step at 500–5 000 **active** bodies                          | **active rigid bodies: 5 000 simple bodies baseline**     |
| [`animation-sampling.mjs`](#animation-samplingmjs--17-mixer-sampling)          | `AnimationMixer.advance` over N instances of a 4-track clip                  | none — _animated glyphs_ is a text row, not a mixer row   |
| [`particles-100k.mjs`](#particles-100kmjs--112s-particle-budget-wp-94-phase-9) | 100 000 CPU particles under a 3-field §27 stack                              | **CPU particles** (at 4× §86's 25 000 baseline, per §112) |

Two §86 rows have honest headless numbers today — active rigid bodies and CPU particles —
and both are **over** the 60 Hz fixed-step budget on this host. §86's clause is _"suitable
modern desktop hardware"_, which a shared CI container without a GPU is not, so neither
result is a §86 verdict; see each script's header. The rest of §86's rows (batched sprites,
batched shapes, mesh instances, retained UI nodes, animated glyphs, GPU particles, payload)
are GPU-bound, UI-tier or already covered elsewhere — the payload row is gated by
`pnpm size`, and the GPU rows need a GPU. Measuring them headless would produce numbers
about the wrong thing.

## What a script here is, and is not

A benchmark here **records** numbers. It is never a gate.

- **Nothing in CI asserts on a timing.** The verification stack (plan §8) gates types, unit
  tests, root suites, lint, spec integrity, docs, the example build, the §86 payload budget,
  and determinism. Wall-clock speed is not on that list and must not be added to it by the
  back door: CI containers are shared, have no GPU, and vary run to run by tens of percent.
- **Every number is a statement about the machine that produced it.** Each script prints its
  host (CPU model, core count, Node version, platform) and writes it into its result file.
  Quoting a number without its host is a misquote.
- **A script is standalone Node with no new dependencies.** It imports the built `dist`
  through the workspace package names, so `pnpm run build` has to have run first. Phase 11
  answered the "adopt a benchmarking framework?" question with `harness.mjs` — under 400 lines of
  plain ESM, still no new dependency.
- **Wall clocks are the instrument, never the simulation.** `performance.now()` lives in
  `harness.mjs`'s `measure` and nowhere else; nothing it returns may ever be fed back into
  the engine. Simulation is always driven by a constant injected `fixedDeltaTime` (§10,
  §33) — delete every timer from a script here and it must produce the identical state.
- **A micro-benchmark must prove it measured something.** The optimiser is entitled to
  delete work nothing observes. `harness.mjs` exports `keepAlive`, whose accumulator each
  script prints; `math-ops.mjs` additionally publishes a `baseline (no op)` row and varies
  its operands per iteration. A row at the baseline is a deleted operation, not a fast one.

## The harness

`harness.mjs` exports, and nothing else:

| export                                                                   | what it does                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure(iteration, { warmupIterations, measuredIterations, prepare? })` | times each call; returns `{ warmup, measured }` as `Float64Array` milliseconds. `iteration` gets a **globally monotonic index** so a script can derive simulation time from it. `prepare(index)` runs **untimed** before each iteration, for per-iteration setup that is not the subject |
| `summarize(durations)`                                                   | `{ samples, meanMs, medianMs, p95Ms, p99Ms, minMs, maxMs }`, quantiles by **nearest rank** — every printed number is a duration some iteration actually took                                                                                                                             |
| `summaryFields(summary, unit)` / `summaryLines(summary, unit)`           | those six statistics as record fields / as report lines                                                                                                                                                                                                                                  |
| `hostRecord()` / `hostLines(host, caveat)`                               | the host block every record ends with                                                                                                                                                                                                                                                    |
| `writeResult(name, record)` / `resultsPath(name)`                        | writes `results/<name>.json`, two-space JSON, trailing newline; returns the path                                                                                                                                                                                                         |
| `printReport(lines)`                                                     | newline-joined stdout                                                                                                                                                                                                                                                                    |
| `keepAlive(value)` / `keepAliveTotal()`                                  | cross-module accumulator that keeps measured work observable                                                                                                                                                                                                                             |
| `mean`, `quantile`, `round`, `MEASUREMENT_NOTE`                          | the primitives the above are built from                                                                                                                                                                                                                                                  |

A record is `{ _note, benchmark, specification, recordedAt, …the script's own fields…,
...hostRecord(), hostCaveat }` — the host block last, because it is the part a reader must
check before quoting anything above it.

## Results

`results/` holds one JSON record per benchmark, **committed** (`.gitignore` does not cover
it). That is deliberate: plan §6h asks Phase 9 for _recorded_ numbers, and a committed record
makes `git diff` after a run the honest way to see what changed and on which host. Each
record carries a `recordedAt` timestamp, the full host description, and a `_note` restating
that it is a measurement rather than a gate.

Re-running a script rewrites its record. Committing the rewrite is right when the intent is
"here is today's measurement on this machine"; committing it silently after moving to a
different machine is not — the host fields exist so a reader can tell the two apart.

## Scripts

Every script below prints a report, writes `results/<name>.json`, and asserts something
structural about its own run so a green exit means more than "it finished". The findings
quoted are the shape of the result, not its exact values — see the JSON for the run under
record, and its host fields before quoting it.

### `math-ops.mjs` — §7b math throughput and allocation

```sh
node benchmarks/math-ops.mjs
```

Sixteen rows — a `baseline (no op)` floor plus fifteen `Vector3`/`Quaternion`/`Matrix4`
operations — each run as 40 measured batches of 100 000 calls over 8 rotating operand sets.
Reports median ms/batch, ns/op, Mop/s, **and allocations per batch** from `@four/math`'s own
`constructionCount()` (§83).

**The durable finding is the allocation column: zero, on every row, across 1.6 million
calls.** §7b requires that steady-state engine code never allocates a math object, and this
is that requirement measured rather than asserted. It is also the one number here that is
host-independent — a non-zero row would be a hot-path defect on any machine.

The throughput column is softer and is bounded by two honesty devices. Mutating operations
are timed as `out.copy(src).op(...)`, so their rows include a copy of the same type and the
`copy` rows are the subtrahend; and the `baseline` row does the operand indexing and the
result read and no math at all. An earlier draft with fixed operands reported `Vector3.copy`
at 3.6 ns against `Vector3.add` at 51 ns — the copy loop had been hoisted out entirely. That
is why operands vary per iteration now, and why the floor is published.

On the recorded host the operations land between roughly 8 ns (`copy`) and 130 ns
(`Quaternion.slerp`, `Matrix4.decompose` — both transcendental-heavy), with `Matrix4.multiply`
and `Quaternion.multiply` near 45 ns including their copy reset.

### `scene-propagation.mjs` — §7 world-transform resolution

```sh
node benchmarks/scene-propagation.mjs
```

`resolveWorldTransforms(root)` runs twice per frame in a rendering application — before
physics synchronisation and before render-item generation — so its cost scales with node
count whatever else is happening. Four scene shapes (a flat 1 001-node root, an 11 111-node
and a 111 111-node ten-way tree, a 2 001-deep chain), each measured in the **three states a
real frame produces**:

| pass     | what is dirty | asserted                               |
| -------- | ------------- | -------------------------------------- |
| `full`   | the root      | `recomputed === visited === nodeCount` |
| `sparse` | 64 leaves     | `recomputed === 64`                    |
| `cached` | nothing       | `recomputed === 0`                     |

The assertions matter as much as the timings: a green run is itself evidence that §7's
version-based caching does what its documentation claims. Dirtying happens in the harness's
**untimed** `prepare` hook, so the measured region is resolution alone.

Two findings, both stable across runs:

- A **clean pass is only about 3× cheaper than a full recompute**, not free. §86's
  _"idle scene — near-zero unnecessary uploads and simulation work"_ holds for the
  arithmetic (zero matrices are multiplied) but the _walk_ is not free: on the order of
  120 ns per visited node, dominated by the per-node `WeakMap` lookup and the three version
  comparisons. At 111 111 nodes that is ~13 ms per pass, twice per frame, for a scene where
  nothing moved. A dirty-subtree skip list is the obvious follow-up and is not in scope here.
- The resolver **recurses once per level**, so scene depth is bounded by the JS stack. Probed
  once while authoring (not per run, and stated as such in the script): 8 000 deep resolves,
  12 000 throws `RangeError`. The deep scenario is 2 000, comfortably inside.

### `physics-step.mjs` — §86's 5 000 active rigid bodies

```sh
node benchmarks/physics-step.mjs
```

§86 targets _"active rigid bodies: 5 000 simple bodies baseline"_. Two words decide the
benchmark. **Active**: §32 sleeping is disabled in every scenario, because Appendix A's
default would put a settled pile to sleep within a second and make the number meaningless.
**Suitable modern desktop hardware**: not this container, so nothing here is a §86 verdict.

A static floor and N dynamic unit boxes on a lattice, dropped and left to pile up, at
N = 500 / 1 000 / 2 500 / 5 000. One measured iteration is `PhysicsWorld.step(dt)` — §39
steps 1–6. §39 step 9 (`dispatchEvents`) runs as the untimed `prepare` hook on a
listener-free world, so the timed region is the solve and the event queue cannot grow across
the run. `finalChecksum` is `world.checksum()` (§33): the scenario's fingerprint, so a future
run that is merely slower can be told from one whose _scene_ changed.

Every count is measured **twice** — piled, and in **free fall** with no floor, where nothing
ever touches. The recorded findings:

- At 5 000 active bodies the piled step costs on the order of **130 ms**, roughly **8× the
  16.667 ms** a 60 Hz fixed step has to spend, on this host.
- The same 5 000 bodies in free fall cost about **16 ms** — broad phase, integration and the
  per-body scene write-back alone, with zero events. So **~88 % of the piled figure is
  contact generation, contact solving and §29 event translation**, not per-body integration,
  and the split is stable across all four counts.
- The pile queues roughly **0.9 §29 events per body per step** (4 600 at 5 000 bodies), each
  translated into an object inside the timed region. How much of the 88 % is the solver and
  how much is the event seam is _not_ separated here — doing so needs an API to suppress
  event collection, which does not exist and is a decision, not a benchmark change.

### `animation-sampling.mjs` — §17 mixer sampling

```sh
node benchmarks/animation-sampling.mjs
```

One measured iteration is `mixer.advance(dt)` over every one of N mixers — a frame of
`AnimationSystem`'s work — at N = 250 / 1 000 / 5 000 / 20 000, on a shared 4-track clip
(`transform.position`, `.rotation`, `.scale`, `.pivot`; 8 linear keys over 2 s). Every node
is `transformAuthority: "animation"`: with the default `"manual"` the mixer refuses its own
transform writes and warns (§42), so a benchmark left on the default would measure the
refusal path. The clip and its tracks are **one shared immutable object set** (§17), as an
application animating a crowd would have it.

On the recorded host a mixer costs on the order of **1 µs per step** with this clip
(~200–290 ns per track sample), so 20 000 animated instances land around 23 ms — over a 60 Hz
budget on their own, and 5 000 sit comfortably inside it. An attribution run at 5 000
instances with 1, 2 and 4 tracks puts the marginal track at roughly **175–250 ns per instance
per step**.

The script also publishes its own **noise floor**: the 5 000 × 4 configuration is measured
twice, independently, in one process, and the two means have disagreed by 20–50 % between
runs on this host. That number is printed next to the results deliberately — it is the scale
below which nothing in this file is a finding.

### `particles-100k.mjs` — §112's particle budget (WP-9.4, Phase 9)

```sh
pnpm run build
node benchmarks/particles-100k.mjs
```

Steps **100 000 live particles** for 600 fixed steps (10 s at 60 Hz) under the §27 field
stack of uniform gravity, linear drag and a vortex, and reports **milliseconds per fixed
step** — mean and p95 — against the 16.667 ms a 60 Hz step has to spend. A 60-step warm-up
runs first and is reported separately. It then repeats the run with 0, 1 and 2 fields, so the
headline number can be attributed rather than merely quoted. Writes
`results/particles-100k.json`.

WP-11.4 moved this script's plumbing into `harness.mjs` — the timing loop, the statistics,
the host block, the writer, the printer. What is measured did not change, and the record's
fields and their order are unchanged; the extraction was verified by diffing the record's key
order before and after.

**How §112 is read.** §112's exit is _"≥100,000 simple particles simulated and rendered at
interactive rates on suitable hardware"_. Plan §6h interprets that for this environment and
splits it three ways, because no single artefact can honestly carry it:

| half of §112                      | where the evidence is                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 100 000 particles **simulated**   | this script — recorded ms/step, no CI assertion                                                                       |
| **rendered** in one draw call     | `@four/render`'s `particles.ts` contract and `@four/render-webgl`'s instanced path, pinned by their unit suites       |
| at **interactive rates**, visibly | `examples/particles-demo` + `tests/browser/particles.spec.ts`, at ~1 800 particles — the size SwiftShader can sustain |
| **deterministically** (P9-4)      | `tests/determinism/phase9-particles.test.ts` + `golden/phase9.json`                                                   |

"Suitable hardware" is the phrase this environment cannot satisfy, and the script says so
rather than pretending otherwise: the recorded host is a **CI container with no GPU**, shared
with other work, and the script measures the **CPU half only** — no GL context is created,
nothing is uploaded, nothing is drawn.

**What the recorded numbers say** (see `results/particles-100k.json` for the run under
record; the shape of the result, not its exact values, is the durable part):

- The **integrator alone** — semi-implicit Euler, ageing, expiry, swap-remove compaction,
  over 100 000 particles — costs on the order of **1 ms per step**, well inside a 60 Hz
  budget.
- Each **§27 force field** adds on the order of **5–6 ms per step per 100 000 particles**.
  That is the cost of a virtual `sample()` call per particle per field across a polymorphic
  call site (`emitter.ts`'s field loop), not the cost of the arithmetic inside the fields.
- So the three-field headline stack lands **around** the 16.667 ms budget on this host, and
  which side of it a given run lands on is mostly a statement about the container.

The finding is recorded rather than acted on: batching the §27 seam (sampling a lane per
call, or specialising the common built-ins) is a real optimisation with a real API cost, and
it belongs to a packet that is scoped to make that trade, not to the packet that measured it.
