# @four/geometry

Geometry and tessellation. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

2D shape primitives, the path model (Bézier, arcs, Boolean ops), tessellation and stroke generation (an isolated, replaceable tessellator *module* of this package per §52), 3D primitives, and buffer/indexed/procedural geometry.

Specification: §50–53 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
