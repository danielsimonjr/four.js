# @four/physics-soft

Soft bodies and deformables — **interface reserved; not yet implemented.** Part of [four.js](../../README.md).

Reserved for soft-body and deformable simulation (cloth, rope, pressure/volume models) per §35 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md). It is not a solver adapter — see ERRATA E-3; the §102 solver packages are `physics-rapier` and `physics-box2d`.

The package exists in the workspace so the §98 monorepo tree stays accurate. The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test. No implementation phase has been scheduled for §35 yet.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/physics-soft`; publishes as `@danielsimonjr/fourjs-physics-soft`.
