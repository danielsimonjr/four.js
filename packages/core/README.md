# @four/core

Shared foundation infrastructure. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

EventEmitter, disposal/lifecycle interfaces (`Disposable`, ownership tracking), the `FourError` error model, and validation hooks used by every other package.

Specification: §6, §83, §85, §89 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
