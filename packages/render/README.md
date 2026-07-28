# @four/render

Renderer interface and render graph. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

The backend-independent `Renderer` interface, capability tiers, the render graph (DAG of passes), render preparation (traversal → culling → render items → sorting → batching → submission), and batching/instancing strategies.

Specification: §61–66 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
