# @four/diagnostics

Diagnostics and developer tools. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

Runtime statistics (`app.stats.*`), debug overlays (colliders, contacts, batches, overdraw, …), development-build validation, and numerical-stability warnings.

Specification: §41, §84–85 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
