# @four/geometry

Geometry primitives and buffers. Part of [four.js](../../README.md).

Implements the MVP tier of §50–53 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 3 (§106). Coordinates follow the §7a right-handed Y-up convention.

## What's here

- **`BufferGeometry`** — positions, optional index (`GeometryIndexArray`), draw mode (`GeometryDrawMode`, including `"lines"`), and bounds (`GeometryBounds`).
- **Primitive factories** — `boxGeometry`, `planeGeometry`, and `circleGeometry2D`, each with an options type.

## Staged / not yet implemented

- The path model (Bézier curves, arcs, Boolean operations) and tessellation / stroke generation — §52's isolated, replaceable tessellator module.
- Further 3D primitives and procedural geometry beyond the three factories above.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/geometry`; publishes as `@danielsimonjr/fourjs-geometry`.
