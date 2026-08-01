/**
 * `@four/physics` — the stable, solver-independent physics API (§101, Part IV).
 *
 * Application code targets this package and never a solver directly (§20); a
 * concrete engine reaches it through `PhysicsSolverAdapter` (§37).
 *
 * WP-5.1 shipped the **types and the pure functions**: the §20–§34 public
 * vocabulary, the four §37 descriptors, the §24 shape unions, `PhysicsMaterial`
 * and the §25 combination rules, the §29 event payloads, the §30 query records
 * and their filter semantics, the §37 adapter contract, and the §85 validators.
 * WP-5.2 adds the two §6a components — `RigidBody` (§23, §26) and `Collider`
 * (§24, §25) — which hold the authored state a user manipulates and produce the
 * descriptors an adapter is built from. `PhysicsWorld` / `PhysicsSystem`, which
 * register those components and drain their command buffers, arrive in WP-5.3.
 * WP-6.1 adds §28's constraints: the `Joint` classes, the full
 * `JointDescriptor` union of the plan P6-1 tier, the `SolverJointAccess` seam,
 * and the world's `addJoint`/`removeJoint` with plan P6-2 break monitoring.
 *
 * Named exports only, alphabetical within each module group.
 */

export const PACKAGE_NAME = "@four/physics";

export type {
  PhysicsCapabilities,
  PhysicsQueryCapabilities,
  PhysicsSolverAdapter,
} from "./adapter.js";
export type {
  SolverBodyAccess,
  SolverJointAccess,
  SolverJointMotor,
} from "./body-access.js";
export {
  missingSolverJointAccess,
  supportsSolverJointAccess,
} from "./body-access.js";
export type {
  ColliderEventMap,
  ColliderOptions,
  ColliderTriggerEvent,
} from "./collider.js";
export { Collider } from "./collider.js";
export type {
  AngularJointMotor,
  ColliderDescriptor,
  FixedJointDescriptor,
  JointDescriptor,
  JointDescriptorBase,
  JointLimits,
  JointType,
  LinearJointMotor,
  PhysicsWorldOptions,
  PrismaticJointDescriptor,
  RevoluteJointDescriptor,
  RigidBodyDescriptor,
  RopeJointDescriptor,
  ShippedJointType,
  SphericalJointDescriptor,
  SphericalJointLimits,
  SpringJointDescriptor,
  StagedJointType,
} from "./descriptors.js";
export {
  DEFAULT_GRAVITY_Y,
  JOINT_TYPES,
  SHIPPED_JOINT_TYPES,
  SHIPPED_JOINT_TYPES_2D,
  SHIPPED_JOINT_TYPES_3D,
  STAGED_JOINT_TYPES,
  jointTypeSupportsDimension,
  resolveAngularVelocity,
  resolveGravity,
  resolveRotation,
  resolveSleepingConfig,
  widenToVector3,
} from "./descriptors.js";
export type {
  CollisionEvent,
  CollisionPhase,
  ContactPoint,
  JointBreakEvent,
  JointPhase,
  PhysicsEvent,
  PhysicsEventType,
  SleepEvent,
  SleepPhase,
  TriggerEvent,
  TriggerPhase,
} from "./events.js";
export type {
  HingeJointOptions,
  JointBinding,
  JointBreakPayload,
  JointCommands,
  JointEventMap,
  JointOptions,
  RopeJointOptions,
  SliderJointOptions,
  SphericalJointOptions,
  SpringJointOptions,
} from "./joints.js";
export {
  BallJoint,
  FixedJoint,
  HingeJoint,
  Joint,
  PrismaticJoint,
  RevoluteJoint,
  RopeJoint,
  SliderJoint,
  SphericalJoint,
  SpringJoint,
  worldAnchorToLocal,
  worldAxisToLocal,
} from "./joints.js";
export type { PhysicsMaterialOptions } from "./material.js";
export type { PhysicsSystemOptions } from "./physics-system.js";
export { PhysicsSystem } from "./physics-system.js";
export {
  DEFAULT_DENSITY,
  DEFAULT_FRICTION,
  DEFAULT_FRICTION_COMBINE_MODE,
  DEFAULT_RESTITUTION,
  DEFAULT_RESTITUTION_COMBINE_MODE,
  PhysicsMaterial,
  combineFriction,
  combineRestitution,
  combineValues,
  resolveDensity,
} from "./material.js";
export type {
  OverlapHit,
  OverlapQuery,
  PointHit,
  PointQuery,
  QueryCandidate,
  QueryFilter,
  QueryHit,
  QueryHitMode,
  QueryOptions,
  RaycastHit,
  RaycastQuery,
  ResolvedQueryOptions,
  ShapeCastHit,
  ShapeCastQuery,
} from "./queries.js";
export {
  ALL_COLLISION_GROUPS,
  passesQueryFilter,
  resolveQueryOptions,
  sortHitsByDistance,
} from "./queries.js";
export type {
  PointLoad,
  RigidBodyCollisionEvent,
  RigidBodyCommands,
  RigidBodyEventMap,
  RigidBodySleepEvent,
  SleepCommand,
  TorqueInput,
} from "./rigid-body.js";
export { RigidBody } from "./rigid-body.js";
export type {
  BoxShape,
  CapsuleShape,
  CircleShape,
  CollisionShape,
  CollisionShape2D,
  CollisionShape3D,
  CollisionShapeType,
  PolygonShape,
  RectangleShape,
  SphereShape,
} from "./shapes.js";
export {
  COLLISION_SHAPE_TYPES_2D,
  COLLISION_SHAPE_TYPES_3D,
  shapeSupportsDimension,
  validateCollisionShape,
} from "./shapes.js";
export type {
  AngularVelocityInput,
  BodyType,
  CCDMode,
  CombineMode,
  DeterminismLevel,
  PhysicsBodyHandle,
  PhysicsColliderHandle,
  PhysicsDimension,
  PhysicsHandle,
  PhysicsJointHandle,
  RotationInput,
  SleepingConfig,
  Vector3Input,
} from "./types.js";
export {
  BODY_TYPES,
  CCD_MODES,
  COMBINE_MODES,
  DEFAULT_CCD_MODE,
  DEFAULT_DETERMINISM_LEVEL,
  DEFAULT_ENABLED_CCD_MODE,
  DEFAULT_SLEEPING_CONFIG,
  DETERMINISM_LEVELS,
  PHYSICS_DIMENSIONS,
} from "./types.js";
export {
  validateAngularJointMotor,
  validateColliderDescriptor,
  validateInertiaTensor,
  validateJointBreakThreshold,
  validateJointDescriptor,
  validateJointLimits,
  validateLinearJointMotor,
  validateMass,
  validatePhysicsWorldOptions,
  validateRigidBodyDescriptor,
  validateSphericalJointLimits,
} from "./validation.js";
export type {
  PhysicsSnapshot,
  PhysicsWorldAdapter,
  PhysicsWorldInit,
  WorldOverlapHit,
  WorldPhysicsEvent,
  WorldPointHit,
  WorldQueryHit,
  WorldRaycastHit,
  WorldShapeCastHit,
} from "./world.js";
export { PhysicsWorld } from "./world.js";
