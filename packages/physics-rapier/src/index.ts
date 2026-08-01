/**
 * `@four/physics-rapier` — the Rapier solver adapters (§37, §102, §108).
 *
 * This package sits *below* `@four/physics`: it implements
 * `PhysicsSolverAdapter` and depends on nothing else in the engine, which is
 * what makes the solver swappable (§20, §37). Application code should target
 * `@four/physics` and hand it an adapter instance (plan P5-5) rather than
 * importing Rapier types from here.
 *
 * WP-5.4 ships the **2D** adapter; the 3D one (WP-5.5) joins it under the same
 * barrel.
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
  toRapierAngle,
  toRapierAngularScalar,
  toRapierBodyType,
  toRapierVector2,
} from "./conversions2d.js";
export type { RapierVector2 } from "./conversions2d.js";
export { initializeRapier2d, rapier2dModule, rapier2dVersion } from "./init.js";
export type { Rapier2dModule } from "./init.js";
export { Rapier2dAdapter } from "./rapier2d-adapter.js";
export type { RapierBodyAccess } from "./rapier2d-adapter.js";
