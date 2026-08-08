# @four/physics-rapier

Rapier solver adapters (2D and 3D, WebAssembly). Part of [four.js](../../README.md).

Implements §37 and §102 of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); the first adapter per Phase 5 (§108). This package sits _below_ `@four/physics`: it implements `PhysicsSolverAdapter` and depends on nothing else in the engine, which is what makes the solver swappable. Application code should target `@four/physics` and hand it an adapter instance.

## What's here

- **`Rapier2dAdapter`** and **`Rapier3dAdapter`** — one per §21 dimension, each wrapping its own `@dimforge/rapier{2,3}d-compat` build (pinned 0.19.3, base64-inlined wasm). Neither loads the other's module; importing the barrel costs nothing until `initializeRapier2d` / `initializeRapier3d` runs (async, §37 permits a Promise).
- **`RapierBodyAccess`** — the per-handle `SolverBodyAccess` implementation, declared once and dimension-independent. Both adapters also implement `SolverBodyTuningAccess` (§37 property changes after `createBody`: the §23 mass triple, damping, gravity scale, the §31 mode, and a collider's §25 material / §24 filter), so a `PhysicsWorld` on either of them reports `supportsLiveProperties: true`.
- **Conversion helpers** — `toRapierVector2/3`, `fromRapierVector2/3`, angle/rotation/quaternion conversions, shape and collider-descriptor builders, interaction-group packing, and principal-inertia conversion.

## Notes and measured deviations (recorded in the stable API docs)

- Adapters own monotonic, never-reused body ids (Rapier handles are unordered doubles) — the §33 checksum order; snapshot envelopes `F4R2`/`F4R3` carry the id registry.
- Rapier 0.19.3 exposes no joint reaction getters → `reportsJointReactions` is false and breakable joints are refused; motor `maxTorque`/`maxForce` acts as a force-based gain, not §28's hard cap.
- `collisionstay` is adapter-derived from a touching-pair map (Rapier reports only start/stop); restitution combine is forced to Max per Appendix A; §32 sleep thresholds are unmapped (only `enabled`).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/physics-rapier`; publishes as `@danielsimonjr/fourjs-physics-rapier`.
