# @four/motion

Motion system. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

Clocks and time domains, the fixed-step scheduler, MotionComponent (velocity/acceleration), kinematic controllers, path following, trajectories, spring motion, steering, render interpolation, and transform authority. First implemented in Phases 1–2 (§104–105).

Specification: §99, Parts II & VI in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
