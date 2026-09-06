/**
 * §83 resource accounting for solver handles — how many bodies, colliders,
 * and joints are live in a {@link PhysicsWorld} (A-5 follow-up).
 *
 * The twin of `@four/geometry`'s and `@four/render`'s `resource-memory.ts`:
 * **numbers, not references**, so the tracker cannot itself become the leak
 * it reports; process-wide rather than per-world, because a handle belongs
 * to whoever created it (§83); absolute and never reset; never healed by
 * garbage collection.
 *
 * ## Handles, not components
 *
 * A `RigidBody` / `Collider` / `Joint` component can exist without a solver
 * object. These counters move when {@link PhysicsWorld.addBody},
 * {@link PhysicsWorld.addCollider}, or {@link PhysicsWorld.addJoint} mint a
 * §37 handle, and when the matching destroy (`removeBody`, `removeCollider`,
 * `removeJoint`, `dispose`, or a solver-side `jointbreak`) retires it.
 * Constructing a component and never registering it does not increment
 * anything — there is no solver resource to leak.
 *
 * ## Count only — no byte total
 *
 * A solver handle is an opaque id. The WASM heap behind Rapier (or any other
 * adapter) is the solver's, not this package's, and §84 has no
 * `solverMemory` slot. Instance counts are what §83 can answer here.
 *
 * ## Always on, no DEV
 *
 * This package is inside the §33 simulation envelope and must not import
 * `DEV`. The counters are numbers: they do not change the step, the
 * checksum, or event order. Production gating lives on the *message*
 * (`auditResourceLeaks` is inert when `DEV` is false), not on the count.
 *
 * {@link liveSolverHandleCount} is the combined total a caller passes to
 * `@four/diagnostics`' `auditResourceLeaks` as
 * `LiveResourceCounts.solverHandles`. The three population readers stay
 * separate so a report can still say which kind grew.
 */

/** Live (created, not yet destroyed) solver body handles. */
let liveSolverBodies = 0;

/** Live solver collider handles. */
let liveSolverColliders = 0;

/** Live solver joint handles. */
let liveSolverJoints = 0;

/**
 * Records a change to the live body-handle count: `+1` at `createBody`,
 * `-1` at `destroyBody`. Internal — absent from the package index.
 */
export function noteSolverBody(instances: number): void {
  liveSolverBodies += instances;
}

/**
 * Records a change to the live collider-handle count: `+1` at
 * `createCollider`, `-1` when the collider is destroyed — either by
 * `destroyCollider` or as part of `destroyBody` (§37: a body takes its
 * attachments with it). Internal.
 */
export function noteSolverCollider(instances: number): void {
  liveSolverColliders += instances;
}

/**
 * Records a change to the live joint-handle count: `+1` at `createJoint`,
 * `-1` when the joint is retired (explicit `destroyJoint`, body teardown,
 * world `dispose`, or a solver-side `jointbreak`). Internal.
 */
export function noteSolverJoint(instances: number): void {
  liveSolverJoints += instances;
}

/**
 * How many solver body handles have been created and not yet destroyed (§83).
 */
export function liveSolverBodyCount(): number {
  return liveSolverBodies;
}

/**
 * How many solver collider handles have been created and not yet destroyed
 * (§83). Separate from {@link liveSolverBodyCount} because a body can carry
 * several colliders, and a late {@link PhysicsWorld.addCollider} mints one
 * without minting a body.
 */
export function liveSolverColliderCount(): number {
  return liveSolverColliders;
}

/**
 * How many solver joint handles have been created and not yet destroyed (§83).
 */
export function liveSolverJointCount(): number {
  return liveSolverJoints;
}

/**
 * Bodies + colliders + joints — the combined §83 handle total.
 *
 * ```ts
 * const before = liveSolverHandleCount();
 * world.addBody(node); // body + its scanned colliders
 * liveSolverHandleCount() - before; // 1 + collider count
 * world.removeBody(node);
 * liveSolverHandleCount(); // === before
 * ```
 */
export function liveSolverHandleCount(): number {
  return liveSolverBodies + liveSolverColliders + liveSolverJoints;
}
