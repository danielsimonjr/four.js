# @four/input

Input, events, and picking. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

Input sources (pointer, keyboard, gamepad), DOM-mirroring event propagation (capture → target → bubble), pointer capture across mixed 2D/3D content, and the unified picking / hit-testing API.

Specification: §71–72 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
