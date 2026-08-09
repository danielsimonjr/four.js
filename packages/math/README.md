# @four/math

Math primitives. Part of [four.js](../../README.md).

Implements §7 and the §7b math conventions of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 1 (§104). Mutable types with `out`-parameter hot paths (`out?` optional-allocation policy), radians everywhere, right-handed Y-up.

## What's here

- **Vectors** — `Vector2`, `Vector3`, `Vector4`.
- **`Quaternion`** — with shortest-arc slerp (decision D8).
- **Matrices** — `Matrix3` and `Matrix4`, including depth-range-parameterized projections (`DepthRange`).
- **`Frustum` (§87)** — the six clip planes of a view-projection matrix, with `setFromViewProjection` (both `DepthRange` conventions) and a conservative `intersectsSphere`. The one culling primitive; the world bounds it tests come from `@four/render`.
- **`ColorRGBA`** — the shared color tuple type used by materials, animation, and particles.
- **Allocation counter** — `constructionCount` / `resetConstructionCount` / `noteConstruction`, the test hook that keeps hot paths allocation-free.

## Notes

- `Transform` (position/rotation/scale with the dirty channel) lives in `@four/scene`, not here.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/math`; publishes as `@danielsimonjr/fourjs-math`.
