/**
 * Shared loading of the Rapier WebAssembly modules, and the typed view of them
 * this package programs against.
 *
 * `PhysicsSolverAdapter.initialize` (§37) is allowed to return a promise
 * precisely so a WebAssembly-backed solver can load its module there. Rapier
 * ships as wasm, so every adapter in this package has to await that load before
 * it may touch a single Rapier class — and several adapters (and several worlds
 * on one adapter) must be able to await the *same* load rather than each
 * decoding the module again.
 *
 * This module is that one load, **per dimension**: {@link initializeRapier2d}
 * for `@dimforge/rapier2d-compat` and {@link initializeRapier3d} for
 * `@dimforge/rapier3d-compat`, each with its own cache. The two Rapier builds
 * are separate npm packages with separate wasm images, so they cannot share one
 * promise; loading one does not load the other, and an application that only
 * ever creates a `"2d"` world never decodes the 3D image.
 *
 * ## Why types come from the dependency (toolchain fix, 2026-09-06)
 *
 * `@dimforge/rapier2d-compat@0.20.0` and `@dimforge/rapier3d-compat@0.20.0`
 * declare `"type": "module"` but their `.d.ts` files import each other **without
 * file extensions** (`rapier.d.ts` does `export * from "./exports"`). Under the
 * repository's default `module`/`moduleResolution: NodeNext` baseline (§91),
 * ESM resolution does not add extensions, so `./exports` fails to resolve and
 * the package's public types collapse.
 *
 * **Fix:** this package's tsconfigs opt into `moduleResolution: bundler` (with
 * `module: ESNext`), which is the standard remedy and is scoped to this package
 * only — `tsconfig.base.json` stays on NodeNext. The upstream declarations then
 * resolve, and the ~1200-line member-for-member transcription they replaced is
 * deleted.
 *
 * Verified: `tsc -b` in this package and the full test suite (342 tests) pass
 * against the real wasm with these aliases; a transcription error would surface
 * as a compile or runtime failure rather than a silent wrong simulation.
 *
 * ## Other things verified against the installed wasm, not from memory
 *
 * Both builds behave identically here — the 3D column was re-verified for
 * WP-5.5 rather than assumed:
 *
 * - `init()` takes **no arguments** (`init.length === 0`) and returns
 *   `Promise<void>`. Plan P5-1's note about "the object-form argument" applies
 *   to the raw wasm-bindgen entry point of the *non*-compat builds; the
 *   `-compat` package wraps it and passes the decoded base64 bytes itself.
 * - `version()` reads the version string **out of the wasm module** and throws a
 *   `TypeError` when called before `init()`. That is why
 *   {@link rapier2dVersion} and {@link rapier3dVersion} answer `undefined`
 *   rather than a placeholder: this package never invents a version number for
 *   §34's snapshot validity key.
 * - **Joints report no reaction and take no motor force limit** (verified
 *   2026-08-01 for WP-6.2, in both the typings *and* the wasm). See the module
 *   header in git history before this rewrite for the full enumeration.
 * - **Runtime re-typing works, in both builds** (verified 2026-08-02 for
 *   WP-7.2). See the prior module header for measured behaviour.
 */

import RAPIER2D from "@dimforge/rapier2d-compat";
import RAPIER3D from "@dimforge/rapier3d-compat";

/* ------------------------------------------------------------------------- *
 * 2D — type aliases (legacy names preserved for adapter imports)             *
 * ------------------------------------------------------------------------- */

export type { Vector as RapierVector } from "@dimforge/rapier2d-compat";
export type { Shape as RapierShape } from "@dimforge/rapier2d-compat";
export type { RigidBody as RapierRigidBody } from "@dimforge/rapier2d-compat";
export type { RigidBodyDesc as RapierRigidBodyDesc } from "@dimforge/rapier2d-compat";
export type { Collider as RapierCollider } from "@dimforge/rapier2d-compat";
export type { ColliderDesc as RapierColliderDesc } from "@dimforge/rapier2d-compat";
export type { JointData as RapierJointData } from "@dimforge/rapier2d-compat";
export type { ImpulseJoint as RapierImpulseJoint } from "@dimforge/rapier2d-compat";
export type { UnitImpulseJoint as RapierUnitImpulseJoint } from "@dimforge/rapier2d-compat";
export type { EventQueue as RapierEventQueue } from "@dimforge/rapier2d-compat";
export type { World as RapierWorld } from "@dimforge/rapier2d-compat";

/** The Rapier 2D module namespace, once {@link initializeRapier2d} has resolved. */
export type Rapier2dModule = typeof RAPIER2D;

/**
 * The Rapier 2D namespace under the upstream types.
 *
 * Not part of the package barrel: it is the typed view the other modules in
 * this package share, and it is **only valid once {@link initializeRapier2d}
 * has resolved** — every member traps into wasm.
 */
export const RAPIER_2D: Rapier2dModule = RAPIER2D;

/* ------------------------------------------------------------------------- *
 * 2D — loading                                                               *
 * ------------------------------------------------------------------------- */

/** The in-flight or completed load; `undefined` before the first call. */
let loadPromise: Promise<Rapier2dModule> | undefined;

/** The module once its wasm is live — the flag {@link rapier2dVersion} reads. */
let loadedModule: Rapier2dModule | undefined;

/**
 * Loads the Rapier 2D wasm module once and returns the initialized namespace.
 *
 * Idempotent: concurrent and later callers receive the same promise, so the
 * base64 image is decoded exactly once per process no matter how many adapters
 * or worlds are created.
 */
export function initializeRapier2d(): Promise<Rapier2dModule> {
  loadPromise ??= RAPIER_2D.init().then(
    () => {
      loadedModule = RAPIER_2D;
      return RAPIER_2D;
    },
    (error: unknown) => {
      loadPromise = undefined;
      throw error;
    },
  );
  return loadPromise;
}

/**
 * The initialized Rapier 2D module, or `undefined` while it is still loading.
 *
 * For code that must stay synchronous — a `readonly` property on an adapter, a
 * diagnostic dump — and does not want to force a load it cannot await.
 */
export function rapier2dModule(): Rapier2dModule | undefined {
  return loadedModule;
}

/**
 * The version string Rapier itself reports, or `undefined` before the module is
 * initialized.
 */
export function rapier2dVersion(): string | undefined {
  return loadedModule?.version();
}

/* ------------------------------------------------------------------------- *
 * 3D — type aliases (legacy names preserved for adapter imports)             *
 * ------------------------------------------------------------------------- */

export type { Vector as RapierVector3 } from "@dimforge/rapier3d-compat";
export type { Rotation as RapierRotation3 } from "@dimforge/rapier3d-compat";
export type { Shape as RapierShape3d } from "@dimforge/rapier3d-compat";
export type { RigidBody as RapierRigidBody3d } from "@dimforge/rapier3d-compat";
export type { RigidBodyDesc as RapierRigidBodyDesc3d } from "@dimforge/rapier3d-compat";
export type { Collider as RapierCollider3d } from "@dimforge/rapier3d-compat";
export type { ColliderDesc as RapierColliderDesc3d } from "@dimforge/rapier3d-compat";
export type { EventQueue as RapierEventQueue3d } from "@dimforge/rapier3d-compat";
export type { World as RapierWorld3d } from "@dimforge/rapier3d-compat";

/** The Rapier 3D module namespace, once {@link initializeRapier3d} has resolved. */
export type Rapier3dModule = typeof RAPIER3D;

/**
 * The Rapier 3D namespace under the upstream types.
 *
 * Not part of the package barrel: same rules as {@link RAPIER_2D}.
 */
export const RAPIER_3D: Rapier3dModule = RAPIER3D;

/* ------------------------------------------------------------------------- *
 * 3D — loading                                                               *
 * ------------------------------------------------------------------------- */

/** The in-flight or completed 3D load; `undefined` before the first call. */
let loadPromise3d: Promise<Rapier3dModule> | undefined;

/** The 3D module once its wasm is live — the flag {@link rapier3dVersion} reads. */
let loadedModule3d: Rapier3dModule | undefined;

/**
 * Loads the Rapier 3D wasm module once and returns the initialized namespace.
 *
 * The 3D counterpart of {@link initializeRapier2d}, with its own cache: the two
 * builds are separate npm packages with separate wasm images.
 */
export function initializeRapier3d(): Promise<Rapier3dModule> {
  loadPromise3d ??= RAPIER_3D.init().then(
    () => {
      loadedModule3d = RAPIER_3D;
      return RAPIER_3D;
    },
    (error: unknown) => {
      loadPromise3d = undefined;
      throw error;
    },
  );
  return loadPromise3d;
}

/**
 * The initialized Rapier 3D module, or `undefined` while it is still loading.
 */
export function rapier3dModule(): Rapier3dModule | undefined {
  return loadedModule3d;
}

/**
 * The version string Rapier 3D itself reports, or `undefined` before the
 * module is initialized.
 */
export function rapier3dVersion(): string | undefined {
  return loadedModule3d?.version();
}
