# @four/serialization

Serialization and scene format. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

The `.four.json` and binary `.four` scene formats: versioned, deterministic, diff-friendly, extension-preserving; scene migration tooling.

Specification: §79–80 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
