# @four/physics-rapier

Rapier solver adapter. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

2D/3D solver adapter backed by Rapier (WebAssembly), implementing the shared `PhysicsSolverAdapter` interface and declaring its capabilities. The first adapter per Phase 5 (§108).

Specification: §37, §102, §108 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
