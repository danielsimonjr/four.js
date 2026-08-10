# @four/physics

Stable, solver-independent physics API. Part of [four.js](../../README.md).

Implements §20–§34 and §37 (§101, Part IV) of [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped across Phases 5–7. Application code targets this package, never a solver directly — a concrete engine plugs in through `PhysicsSolverAdapter` (see `@four/physics-rapier`). Y-up gravity, seconds, radians; 2D bodies sit on the z = 0 plane (§21).

## What's here

- **Components (§6a)** — `RigidBody` (§23, §26; body types, mass modes, forces/impulses via command buffers) and `Collider` (§24, §25; shape unions `CollisionShape2D`/`CollisionShape3D`, `PhysicsMaterial` with §25 combine rules, collision groups, triggers).
- **World** — `PhysicsWorld` / `PhysicsSystem`: fixed-step solve, event dispatch after each step (§29 collision/trigger/sleep events), snapshots (§34), and §30 queries (raycast, shape cast, overlap, point) with filter semantics. `world.forEachActiveBody(visit)` walks every dynamic, awake body in registration order (§33) with its world-space centre of mass — the iteration a §39 step-5 force generator needs.
- **Force fields (§26, §27)** — `ForceField` (§27's interface, transcribed) and `ForceFieldSystem`, the engine occupant of §39 step 5. It samples every registered field at every active body each fixed step and applies the sum through §26's `applyForce`; `world.step` is not involved, so an application that does not register it issues the solver-call sequence it always did. Units are declared per field, `"force"` (N) or `"acceleration"` (m/s², multiplied by the body's mass) — a **required** argument, because §27's own built-in list mixes the two. `ParticleForceField` from `@four/particles` is structurally identical, so every built-in field there (`uniformGravityField`, `radialField`, `vortexField`, `windField`, `dragField`, `turbulenceField`, `volumeField`) works here with no adapter and no dependency edge.
- **§8 space modes** — `RigidBody.space` declares the frame a body is solved in (`@four/core`'s `SpaceMode`; default `"world"`, round-trips through §79). `PhysicsWorld.addBody` refuses everything else: the four presentation frames because §8 forbids screen-space content from automatically participating, and `"local-plane"` because §21's plane→XY mapping is unbuilt — two refusals with two messages, because the fixes differ.
- **Joints (§28)** — `FixedJoint`, `RevoluteJoint`/`HingeJoint`, `PrismaticJoint`/`SliderJoint`, `SphericalJoint`/`BallJoint`, `RopeJoint`, `SpringJoint`; registered on the world (`addJoint`), anchors/axes authored in world space, limits and motors live via the `SolverJointAccess` seam, break monitoring included.
- **Adapter contract (§37)** — `PhysicsSolverAdapter`, `PhysicsCapabilities`, plus the `SolverBodyAccess` seam every adapter must implement and the two optional, structurally detected ones: `SolverJointAccess` (§28) and `SolverBodyTuningAccess` (post-registration property changes).
- **Live property changes (§37)** — writing `RigidBody.mass`, `linearDamping`, `angularDamping`, `gravityScale`, or `ccdMode` on a registered body queues the change; `PhysicsWorld` drains it into the solver at the top of the next fixed step. `world.refreshCollider(collider)` does the same for a `Collider`'s §25 material and §24 filter (its fields are plain data, so the request is explicit), and `world.teleport(node, position, rotation?)` is §37's teleport. `world.supportsLiveProperties` says whether the adapter can carry any of it; where it cannot, the write is kept on the component and reported once per body per field rather than dropped in silence. In-place edits to `centerOfMass` / `inertiaTensor` need `body.markMassPropertiesChanged()`; `mass = undefined` (going back to a density-derived mass) needs re-registration.
- **§19 blending** — blend weights on `RigidBody`, `PhysicsWorld.setBodyControlMode` (in-place re-typing with optional velocity inheritance from an animated `PoseTarget`), and `createPoseTargetCaptureSystem` — applications using blending **must** register it.
- **§85 validators** — descriptor, shape, mass/inertia, and joint validation.

## Staged / not yet implemented

- Distance and gear joints (`STAGED_JOINT_TYPES`, staged loudly with dated notes).
- Spherical-joint cone limits (spherical ships 3D-only, limitless; limited descriptors are refused with measurements).
- Going back to a collider-derived mass on a registered body (`mass = undefined`) — restoring the colliders' densities needs the registration path; warned, never silent.
- §27's field **torque** channel (§27's `sample` answers one vector at one point and names none) and automatic waking of sleeping bodies by a field (§32: a persistent field would stop anything ever sleeping; the seam is a per-entry `wakesSleepingBodies` flag).
- §21's `"local-plane"` simulation frame: the plane descriptor plus a mapping in the publish pass. Refused loudly at `addBody` until it exists.
- Breakable-joint reactions depend on solver capability — Rapier reports none, so breakable joints are refused there; §32 sleep thresholds have no Rapier binding (only `enabled` maps).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/physics`; publishes as `@danielsimonjr/fourjs-physics`.
