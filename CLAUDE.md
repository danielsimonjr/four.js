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

- `docs/SPECIFICATION.md` is the **corrected rendering and the working reference**: parts
  I–XIII, sections 1–120, no duplicate numbering, extraction artifacts repaired.
- `docs/archive/four-js-specification.pdf` is the unmodified original (65 pages). It **still
  contains** the old defects (duplicate `Part VII`, section numbers 45–67 assigned twice) —
  when reading the PDF, translate references via the numbering map in `docs/ERRATA.md`
  (PDF second-range §45–67 = Markdown §98–120). Do not edit the PDF.
- ERRATA E-3 (resolved): the scaffold deliberately contains only `physics-rapier`,
  `physics-box2d`, and `physics-soft`, matching §102 (Solver Packages). Do **not** add
  `physics-matter` or `physics-cannon` without a decision to amend the specification.

## Architecture (from the specification)

Four coequal pillars — **Scene, Render, Motion, Physics** — over one shared scene graph in
which 2D shapes, 3D meshes, text, UI, rigid bodies, joints, and particle emitters all
participate. Key cross-cutting designs to understand before implementing anything:

- **Fixed-step simulation loop (§10):** physics steps on a fixed-delta accumulator;
  rendering runs at its own rate and interpolates between the previous and current physics
  state using `interpolationAlpha`. Separate `fixedUpdate` / `update` / `render` events.
- **Time domains (§9):** `TimeState` distinguishes real, render, simulation, animation,
  scaled, and unscaled time; each system picks its time source.
- **Transform authority (§42):** exactly one system (`manual`, `animation`, `kinematic`,
  `physics`, `constraint`, `network`) owns a node's transform; conflicts must warn rather
  than silently overwrite. Render interpolation never feeds back into physics state.
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

Implementation is planned in phases (Part IX, §103–113): foundation → math/scene/time →
motion → renderer → animation → physics adapter → joints → physics-animation blending →
advanced motion → particles/GPU → replay/diagnostics. The MVP scope is defined in Part XII,
§120 (MVP Requirements): WebGL 2 only, one solver adapter, basic 2D/3D primitives.
