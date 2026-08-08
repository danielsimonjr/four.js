# @four/physics

Stable, solver-independent physics API. Part of [four.js](../../README.md).

Implements §20–§34 and §37 (§101, Part IV) of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 5–7. Application code targets this package, never a solver directly — a concrete engine plugs in through `PhysicsSolverAdapter` (see `@four/physics-rapier`). Y-up gravity, seconds, radians; 2D bodies sit on the z = 0 plane (§21).

## What's here

- **Components (§6a)** — `RigidBody` (§23, §26; body types, mass modes, forces/impulses via command buffers) and `Collider` (§24, §25; shape unions `CollisionShape2D`/`CollisionShape3D`, `PhysicsMaterial` with §25 combine rules, collision groups, triggers).
- **World** — `PhysicsWorld` / `PhysicsSystem`: fixed-step solve, event dispatch after each step (§29 collision/trigger/sleep events), snapshots (§34), and §30 queries (raycast, shape cast, overlap, point) with filter semantics.
- **Joints (§28)** — `FixedJoint`, `RevoluteJoint`/`HingeJoint`, `PrismaticJoint`/`SliderJoint`, `SphericalJoint`/`BallJoint`, `RopeJoint`, `SpringJoint`; registered on the world (`addJoint`), anchors/axes authored in world space, limits and motors live via the `SolverJointAccess` seam, break monitoring included.
- **Adapter contract (§37)** — `PhysicsSolverAdapter`, `PhysicsCapabilities`, plus the `SolverBodyAccess` seam every adapter must implement and the two optional, structurally detected ones: `SolverJointAccess` (§28) and `SolverBodyTuningAccess` (post-registration property changes).
- **Live property changes (§37)** — writing `RigidBody.mass`, `linearDamping`, `angularDamping`, `gravityScale`, or `ccdMode` on a registered body queues the change; `PhysicsWorld` drains it into the solver at the top of the next fixed step. `world.refreshCollider(collider)` does the same for a `Collider`'s §25 material and §24 filter (its fields are plain data, so the request is explicit), and `world.teleport(node, position, rotation?)` is §37's teleport. `world.supportsLiveProperties` says whether the adapter can carry any of it; where it cannot, the write is kept on the component and reported once per body per field rather than dropped in silence. In-place edits to `centerOfMass` / `inertiaTensor` need `body.markMassPropertiesChanged()`; `mass = undefined` (going back to a density-derived mass) needs re-registration.
- **§19 blending** — blend weights on `RigidBody`, `PhysicsWorld.setBodyControlMode` (in-place re-typing with optional velocity inheritance from an animated `PoseTarget`), and `createPoseTargetCaptureSystem` — applications using blending **must** register it.
- **§85 validators** — descriptor, shape, mass/inertia, and joint validation.

## Staged / not yet implemented

- Distance and gear joints (`STAGED_JOINT_TYPES`, staged loudly with dated notes).
- Spherical-joint cone limits (spherical ships 3D-only, limitless; limited descriptors are refused with measurements).
- Going back to a collider-derived mass on a registered body (`mass = undefined`) — restoring the colliders' densities needs the registration path; warned, never silent.
- Breakable-joint reactions depend on solver capability — Rapier reports none, so breakable joints are refused there; §32 sleep thresholds have no Rapier binding (only `enabled` maps).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/physics`; publishes as `@danielsimonjr/fourjs-physics`.
