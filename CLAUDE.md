# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository State

four.js is a **proposed** unified JS/TS framework combining 2D/2.5D/3D graphics, animation,
motion, and physics in one shared scene model. This repository currently contains **only the
directory scaffold and the specification — there is no implementation, no `package.json`, and
no build/test tooling yet.** Each `packages/*` package holds a `README.md` plus empty `src/`
and `tests/` placeholders; unit tests are colocated per package, cross-package suites live in
`tests/{integration,visual,determinism}/`, and performance tests in `benchmarks/`.

There are consequently no build, lint, or test commands to run today. When implementation
begins, the spec (§91, Coding Standards and Toolchain) prescribes the baseline: strict
TypeScript, ESM, pnpm workspace, Turborepo or Nx, Vitest, Playwright, ESLint, Prettier, Vite,
and Changesets. Phase 0 of the implementation plan (Part IX, §103) lists the exact root files
to create (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`,
CI workflow).

## Tracking files (root)

Read `MEMORY.md` (decisions, standing facts, gotchas) and `TODO.md` (task tracker) at the
start of a session. Before finishing: record new decisions in `MEMORY.md`, update `TODO.md`,
and add substantive changes to `CHANGELOG.md`.

## The Specification

- `docs/SPECIFICATION.md` is the **working reference** — the current revision is whatever
  tops the amendments table in the file itself; do not trust hardcoded numbers elsewhere (see the
  amendments table at its top): parts I–XIII, sections 1–120, no duplicate numbering.
  Revision 1.1 applied all 35 items from `docs/SPEC-REVIEW.md`; new material lives in
  lettered sections (**6a** Component Model, **6b** Eventing, **7a** Coordinate/Unit
  Conventions, **7b** Math Conventions, **60a** Color Management) and Appendices **A**
  (Normative Defaults) / **B** (Glossary). **§ numbering 1–120 is frozen** — new sections get
  letter suffixes; amendments are recorded in the spec's amendments table (owner decision).
- `docs/archive/four-js-specification.pdf` is the unmodified original (65 pages), **frozen at
  the pre-1.0 text**. It still contains the old defects (duplicate `Part VII`, section
  numbers 45–67 assigned twice) and predates all revisions — when reading the PDF,
  translate references via the numbering map in `docs/ERRATA.md` (PDF second-range §45–67 =
  Markdown §98–120). Do not edit the PDF.
- Run `node tools/check-spec.mjs` after editing the spec — it verifies section sequence,
  fence balance, TOC anchors, and the absence of banned pre-revision terms.
- ERRATA E-3 (resolved): the scaffold deliberately contains only `physics-rapier`,
  `physics-box2d`, and `physics-soft`, matching §102 (Solver Packages). Do **not** add
  `physics-matter` or `physics-cannon` without a decision to amend the specification.

## Architecture (from the specification)

Four coequal pillars — **Scene, Render, Motion, Physics** — over one shared scene graph in
which 2D shapes, 3D meshes, text, UI, rigid bodies, joints, and particle emitters all
participate. Key cross-cutting designs to understand before implementing anything:

- **Conventions (§7a/§7b):** right-handed **Y-up world in both 2D and 3D** (2D gravity is
  negative Y), radians everywhere, **all times in seconds** (tween/timeline durations
  included — no milliseconds anywhere), mutable math types with `out`-parameter hot paths.
- **Components and events (§6a/§6b):** `RigidBody`, colliders, and `MotionComponent` are
  *components* attached via `node.addComponent(...)` (one per type); one typed
  `EventEmitter` API serves nodes and the application; physics events dispatch after each
  fixed step.
- **Fixed-step simulation loop (§10):** physics steps on a fixed-delta accumulator clamped
  at `maximumSubSteps` (excess time is dropped and surfaced via `TimeState.droppedTime`);
  rendering runs at its own rate and interpolates between the previous and current physics
  state using `interpolationAlpha`. Separate `fixedUpdate` / `update` / `render` events.
- **Time domains (§9):** `TimeState` distinguishes real, render, simulation, scaled, and
  unscaled time (animation time is clip-local); each system picks its time source.
- **Transform authority (§42):** exactly one system (`manual`, `animation`, `kinematic`,
  `physics`, `blended`, `constraint`, `network`) owns a node's transform; conflicts must
  warn rather than silently overwrite. `"blended"` selects the §19 physics-animation
  pipeline. Render interpolation never feeds back into physics state.
- **Motion vs. animation vs. physics:** animation specifies how something *should* move,
  kinematics moves objects directly, dynamics derives motion from forces — the engine
  supports all of these with controlled blending (§19: animation pose → kinematic
  modification → physics solve → interpolated render pose).
- **Pluggable physics solvers (§37):** the stable `@four/physics` API sits above a
  `PhysicsSolverAdapter` interface; solver packages (`physics-rapier`, `physics-box2d`)
  implement it and declare capability differences.
- **Determinism (§33–34):** tiered (`none` → `cross-platform`); initial target is
  same-runtime determinism. Seeded RNG, snapshots, replay, and checksum tests are
  first-class requirements.
- **Rendering backends (§62):** one renderer interface over WebGPU, WebGL 2, Canvas 2D,
  SVG, and headless tiers.

## Package layout

`packages/` follows the monorepo tree in Part VIII, §98 (Proposed Monorepo). All
packages are `@four/`-scoped; `packages/four` is the umbrella package. Rough layering:

- Foundation: `core`, `math`
- Scene/time: `scene`, `motion`, `animation`
- Physics: `physics` (stable API), `physics-rapier` / `physics-box2d` (solver adapters),
  `physics-soft`, `particles`
- Rendering: `geometry`, `materials`, `render` (interface), `render-webgpu`, `render-webgl`,
  `render-canvas`, `render-svg`
- Application: `input`, `assets`, `text`, `ui`, `serialization`, `diagnostics`

Implementation is planned in phases (Part IX, §103–113a): foundation → math/scene/time →
motion → renderer → **interaction/sprites/text (§106a)** → animation → physics adapter →
joints → physics-animation blending → advanced motion → particles/GPU →
replay/diagnostics → **assets/serialization/UI/tooling (§113a)**. The MVP scope is defined
in Part XII, §120: WebGL 2 only, one solver adapter, basic 2D/3D primitives. The
executable plan is `docs/plans/IMPLEMENTATION_PLAN.md` (work packets; stress-tested);
`docs/POSITIONING.md` states why the project exists; `docs/rfcs/` hosts the RFC process.
