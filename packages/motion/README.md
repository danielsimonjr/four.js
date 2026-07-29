# @four/motion

Motion system. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

Clocks and time domains, the fixed-step scheduler, MotionComponent (velocity/acceleration), kinematic controllers, path following, camera rigs and controls (§44, §47 — assigned here per §98, with input bindings via `@four/input`), trajectories, spring motion, steering, render interpolation, and transform authority. First implemented in Phases 1–2 (§104–105).

Specification: §99, Parts II & VI in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
