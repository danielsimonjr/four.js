# @four/assets

Asset system. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

Declarative asset loading with deduplication, caching, reference counting, streaming, worker decoding, and hot reload; loaders for images, glTF/GLB, fonts; the texture system.

Specification: §76–78 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
