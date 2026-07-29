# @four/physics

Stable physics API. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

The renderer-independent public physics API: world/body/collider descriptors, physics materials, constraints and joints, force fields, queries, event normalization, the `PhysicsSolverAdapter` interface (§37, including `PhysicsCapabilities` and event draining), snapshots, unit application in simulation (the unit system itself lives in `@four/core`, §40), and debug data. Application code targets this package, never a solver directly. First implemented in Phase 5 (§108).

Specification: §101, Part IV in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
