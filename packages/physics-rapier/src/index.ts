/**
 * `@four/physics-rapier` — the Rapier solver adapters (§37, §102, §108).
 *
 * This package sits *below* `@four/physics`: it implements
 * `PhysicsSolverAdapter` and depends on nothing else in the engine, which is
 * what makes the solver swappable (§20, §37). Application code should target
 * `@four/physics` and hand it an adapter instance (plan P5-5) rather than
 * importing Rapier types from here.
 *
 * Two adapters share the barrel — {@link Rapier2dAdapter} (WP-5.4) and
 * {@link Rapier3dAdapter} (WP-5.5) — one per §21 dimension, each wrapping its
 * own `@dimforge/rapier{2,3}d-compat` build and its own wasm image. Neither
 * loads the other's module: importing this barrel costs nothing until an
 * adapter is actually initialized.
 *
 * `RapierBodyAccess` is the per-handle seam both adapters implement (see
 * `rapier2d-adapter.ts` for why it lives beside §37's `sync*` no-ops); it is
 * declared once and is dimension-independent, confirmed by WP-5.5.
 *
 * Named exports only, alphabetical within each module group.
 */

export const PACKAGE_NAME = "@four/physics-rapier";

export {
  createRapierColliderDesc,
  createRapierShape,
  createRapierVector2,
  fromRapierAngle,
  fromRapierVector2,
  packInteractionGroups,
  quaternionToAngleZ,
  revoluteAxisSignZ,
  toRapierAngle,
  toRapierAngularScalar,
  toRapierBodyType,
  toRapierJointAxis2d,
  toRapierVector2,
} from "./conversions2d.js";
export type { RapierVector2 } from "./conversions2d.js";
export {
  createRapierColliderDesc3d,
  createRapierRotation3,
  createRapierShape3d,
  createRapierVector3,
  fromRapierRotation3,
  fromRapierVector3,
  packInteractionGroups3d,
  rotateVectorByRotation3,
  toPrincipalInertia3d,
  toRapierAngularVector3,
  toRapierBodyType3d,
  toRapierRotation3,
  toRapierVector3,
} from "./conversions3d.js";
export type { RapierRotation3, RapierVector3 } from "./conversions3d.js";
export { initializeRapier2d, rapier2dModule, rapier2dVersion } from "./init.js";
export { initializeRapier3d, rapier3dModule, rapier3dVersion } from "./init.js";
export type { Rapier2dModule, Rapier3dModule } from "./init.js";
export { Rapier2dAdapter } from "./rapier2d-adapter.js";
export type { RapierBodyAccess } from "./rapier2d-adapter.js";
export { Rapier3dAdapter } from "./rapier3d-adapter.js";
