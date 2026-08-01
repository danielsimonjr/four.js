/**
 * `@four/physics` — the stable, solver-independent physics API (§101, Part IV).
 *
 * Application code targets this package and never a solver directly (§20); a
 * concrete engine reaches it through `PhysicsSolverAdapter` (§37).
 *
 * This packet (WP-5.1) ships the **types and the pure functions**: the §20–§34
 * public vocabulary, the four §37 descriptors, the §24 shape unions,
 * `PhysicsMaterial` and the §25 combination rules, the §29 event payloads, the
 * §30 query records and their filter semantics, the §37 adapter contract, and
 * the §85 validators. The `RigidBody` and `Collider` components (§6a) arrive in
 * WP-5.2 and `PhysicsWorld`/`PhysicsSystem` in WP-5.3.
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
  ColliderDescriptor,
  JointDescriptor,
  JointType,
  PhysicsWorldOptions,
  RigidBodyDescriptor,
} from "./descriptors.js";
export {
  DEFAULT_GRAVITY_Y,
  JOINT_TYPES,
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
  PhysicsEvent,
  PhysicsEventType,
  SleepEvent,
  SleepPhase,
  TriggerEvent,
  TriggerPhase,
} from "./events.js";
export type { PhysicsMaterialOptions } from "./material.js";
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
  validateColliderDescriptor,
  validateInertiaTensor,
  validateJointDescriptor,
  validateMass,
  validatePhysicsWorldOptions,
  validateRigidBodyDescriptor,
} from "./validation.js";
