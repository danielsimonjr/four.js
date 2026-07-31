# four

Umbrella package. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

Aggregates the public API surface: `import * as Four from "four"`. Re-exports the stable APIs of the other packages.

Specification: §98 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
