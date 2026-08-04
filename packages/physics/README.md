# @four/physics

Stable, solver-independent physics API. Part of [four.js](../../README.md).

Implements §20–§34 and §37 (§101, Part IV) of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 5–7. Application code targets this package, never a solver directly — a concrete engine plugs in through `PhysicsSolverAdapter` (see `@four/physics-rapier`). Y-up gravity, seconds, radians; 2D bodies sit on the z = 0 plane (§21).

## What's here

- **Components (§6a)** — `RigidBody` (§23, §26; body types, mass modes, forces/impulses via command buffers) and `Collider` (§24, §25; shape unions `CollisionShape2D`/`CollisionShape3D`, `PhysicsMaterial` with §25 combine rules, collision groups, triggers).
- **World** — `PhysicsWorld` / `PhysicsSystem`: fixed-step solve, event dispatch after each step (§29 collision/trigger/sleep events), snapshots (§34), and §30 queries (raycast, shape cast, overlap, point) with filter semantics.
- **Joints (§28)** — `FixedJoint`, `RevoluteJoint`/`HingeJoint`, `PrismaticJoint`/`SliderJoint`, `SphericalJoint`/`BallJoint`, `RopeJoint`, `SpringJoint`; registered on the world (`addJoint`), anchors/axes authored in world space, limits and motors live via the `SolverJointAccess` seam, break monitoring included.
- **Adapter contract (§37)** — `PhysicsSolverAdapter`, `PhysicsCapabilities`, plus the `SolverBodyAccess`/`SolverJointAccess` seams every adapter must implement.
- **§19 blending** — blend weights on `RigidBody`, `PhysicsWorld.setBodyControlMode` (in-place re-typing with optional velocity inheritance from an animated `PoseTarget`), and `createPoseTargetCaptureSystem` — applications using blending **must** register it.
- **§85 validators** — descriptor, shape, mass/inertia, and joint validation.

## Staged / not yet implemented

- Distance and gear joints (`STAGED_JOINT_TYPES`, staged loudly with dated notes).
- Spherical-joint cone limits (spherical ships 3D-only, limitless; limited descriptors are refused with measurements).
- Breakable-joint reactions depend on solver capability — Rapier reports none, so breakable joints are refused there; §32 sleep thresholds have no Rapier binding (only `enabled` maps).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/physics`; publishes as `@danielsimonjr/fourjs-physics`.
