# @four/core

Shared foundation infrastructure. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

EventEmitter and the eventing rules (§6b), the component model (§6a), disposal/lifecycle interfaces (`Disposable`, ownership tracking), the unit system (§40), the plugin host (§81), the `FourError` error model, and validation hooks used by every other package.

Specification: §6, §6a, §6b, §40, §81, §83, §85, §89 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
