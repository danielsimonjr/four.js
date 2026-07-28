# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository State

four.js is a **proposed** unified JS/TS framework combining 2D/2.5D/3D graphics, animation,
motion, and physics in one shared scene model. This repository currently contains **only the
directory scaffold and the specification — there is no implementation, no `package.json`, and
no build/test tooling yet.** Every `packages/*` directory holds just a `.gitkeep`.

There are consequently no build, lint, or test commands to run today. When implementation
begins, the spec (§91, Coding Standards and Toolchain) prescribes the baseline: strict
TypeScript, ESM, pnpm workspace, Turborepo or Nx, Vitest, Playwright, ESLint, Prettier, Vite,
and Changesets. Phase 0 of the implementation plan (Part VIII, §50) lists the exact root files
to create (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.js`,
CI workflow).

## The Specification — read ERRATA.md first

- `docs/four-js-specification.pdf` is the **authoritative** source (65 pages).
- `docs/SPECIFICATION.md` is an auto-extracted rendering of it (kerning artifacts like
  `T agline` are extraction noise, not errors).
- `docs/ERRATA.md` documents known internal defects. Read it before trusting any
  cross-reference in the section 45–67 range:
  - **E-1/E-2:** two different parts are both labelled `Part VII`, and section numbers
    **45–67 are assigned twice** (first range: graphics/rendering/application; second range:
    package architecture and implementation plan). Always disambiguate citations by content,
    e.g. "§49 (Solver Packages)" vs. "§49 (Renderable Node Hierarchy)".
  - **E-3 (resolved):** the scaffold deliberately contains only `physics-rapier`,
    `physics-box2d`, and `physics-soft`. Do **not** add `physics-matter` or `physics-cannon`
    without a decision to amend the specification.

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

`packages/` follows the monorepo tree in the second Part VII, §45 (Proposed Monorepo). All
packages are `@four/`-scoped; `packages/four` is the umbrella package. Rough layering:

- Foundation: `core`, `math`
- Scene/time: `scene`, `motion`, `animation`
- Physics: `physics` (stable API), `physics-rapier` / `physics-box2d` (solver adapters),
  `physics-soft`, `particles`
- Rendering: `geometry`, `materials`, `render` (interface), `render-webgpu`, `render-webgl`,
  `render-canvas`, `render-svg`
- Application: `input`, `assets`, `text`, `ui`, `serialization`, `diagnostics`

Implementation is planned in phases (Part VIII, §50–60): foundation → math/scene/time →
motion → renderer → animation → physics adapter → joints → physics-animation blending →
advanced motion → particles/GPU → replay/diagnostics. The MVP scope is defined in Part XI,
§67 (MVP Requirements): WebGL 2 only, one solver adapter, basic 2D/3D primitives.
