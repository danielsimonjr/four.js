# @four/physics-box2d

Box2D solver adapter — **interface reserved; not yet implemented.** Part of [four.js](../../README.md).

Reserved for the 2D solver adapter backed by Box2D, implementing `@four/physics`'s `PhysicsSolverAdapter` (§37) plus the `SolverBodyAccess`/`SolverJointAccess` seams, and declaring its capability differences per §102 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md).

The package exists in the workspace so the §98 monorepo tree and the §102 solver list stay accurate (see ERRATA E-3: `physics-rapier`, `physics-box2d`, and `physics-soft` are the deliberate set — no `physics-matter` or `physics-cannon` without a spec amendment). The barrel currently exports only `PACKAGE_NAME`, and `tests/` holds a single smoke test.

One recorded motivation for this adapter: Box2D could honor §28's motor `maxTorque`/`maxForce` as a real hard cap, which Rapier treats as a force-based gain (capability-table item).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/physics-box2d`; publishes as `@danielsimonjr/fourjs-physics-box2d`.
