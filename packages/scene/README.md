# @four/scene

Scene graph. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

Node, Group, Scene, the unified 3D transform hierarchy, space modes, symbolic layers, tags, indexed scene queries, and the camera (§47) and viewport (§48) types (camera *rigs/controls* live in `@four/motion`). First implemented in Phase 1 (§104).

Specification: §6–8, §46–48 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
