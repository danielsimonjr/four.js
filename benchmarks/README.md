# Benchmarks

Benchmark harness tracking the performance targets of §86 (e.g. 100k batched sprites @60fps,
50k batched shapes, 5k active rigid bodies, 25k CPU / 100k+ GPU particles, near-zero idle
work) and the metrics of §92: CPU/GPU/simulation time, draw calls, contacts, memory,
allocations, loading throughput.

**The harness proper is Phase 11 (§113a, plan §8).** Until it lands, this directory holds
individual standalone scripts written by the phase that needed them. There is no runner, no
shared reporting format, and no CI integration — deliberately: a harness designed around one
script is a harness designed around nothing.

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
  through the workspace package names, so `pnpm run build` has to have run first. Adding a
  benchmarking framework is a Phase 11 decision, not a per-script one.
- **Wall clocks are the instrument, never the simulation.** `performance.now()` is allowed
  in a script _around_ the work being measured; nothing it returns may ever be fed back into
  the engine. Simulation is always driven by a constant injected `fixedDeltaTime` (§10,
  §33) — delete every timer from a script here and it must produce the identical state.

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
