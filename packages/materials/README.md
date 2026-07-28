# @four/materials

Materials and shading. Part of [four.js](../../README.md) — **scaffold only; no implementation yet.**

The unified material model, paints/fills/strokes, glTF-compatible metallic-roughness StandardMaterial, and the backend-independent node-material shader system (WGSL + GLSL ES generation).

Specification: §57–60 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

## Layout

- `src/` — implementation (strict TypeScript, ESM)
- `tests/` — unit tests (Vitest), colocated per package (§92)
