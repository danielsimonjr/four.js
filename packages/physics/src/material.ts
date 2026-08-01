/**
 * Physics materials and the §25 combination rules.
 *
 * §25 declares the material itself:
 *
 * ```ts
 * class PhysicsMaterial {
 *   friction: number;
 *   restitution: number;
 *   rollingFriction?: number;
 *   spinningFriction?: number;
 *   density: number;
 * }
 * ```
 *
 * and the four ways two of them are reduced to the single value a contact uses
 * (`CombineMode`, in `types.ts`). This module ships both, plus §25's density
 * rule.
 *
 * ## Why a class and not an interface
 *
 * §25 says `class`, and the class earns it: the constructor is where §85's
 * "NaN and infinite values" and "impossible mass/inertia values" are caught, at
 * the point a bad number enters the engine rather than three steps later inside
 * a solver. Fields stay plain and writable afterwards — a material is data a
 * user tweaks, not a state machine — so a value assigned after construction is
 * validated when the collider is created (`validateColliderDescriptor`).
 *
 * The class has no identity, no lifecycle, and no solver state: one material
 * may be shared by any number of colliders, which is the point of having it.
 *
 * ## Combination (§25)
 *
 * Two colliders meet; each brings a friction and a restitution; the contact
 * needs one of each. Appendix A fixes the defaults — **friction averages**,
 * **restitution takes the maximum** — and {@link combineFriction} and
 * {@link combineRestitution} apply exactly those unless a caller names another
 * mode. Maximum for restitution is the standard choice because a bouncy ball
 * should bounce off a dead floor; averaging would make every surface pair feel
 * like a compromise nobody authored.
 *
 * ## Density (§25, §23)
 *
 * `Collider.density` is authoritative for mass derivation;
 * `PhysicsMaterial.density` is a fallback used only when the collider does not
 * set one. {@link resolveDensity} is that rule, in one place, so §23's
 * mass-from-density derivation (WP-5.2) and any adapter agree.
 *
 * ## Units (§40)
 *
 * Friction and restitution are dimensionless coefficients; density is kg/m³ in
 * the default metre/kilogram unit system.
 */

import { FourError } from "@four/core";

import type { CombineMode } from "./types.js";

/** See `shapes.ts`: §89 has no physics-input code, so invalid input is this. */
const MATERIAL_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * Default Coulomb friction coefficient.
 *
 * Not fixed by the specification (Appendix A pins the *combine modes*, not the
 * coefficients), so `0.5` is chosen here: a mid-range value that neither slides
 * like ice nor grips like rubber, and the same number the mainstream solvers
 * this API sits above use as their own default (decision, WP-5.1).
 */
export const DEFAULT_FRICTION = 0.5;

/**
 * Default restitution — perfectly inelastic. Also not fixed by the
 * specification; `0` is chosen because a bouncy default silently injects energy
 * into every scene that never asked for it (decision, WP-5.1).
 */
export const DEFAULT_RESTITUTION = 0;

/**
 * Default density in kg/m³. Not fixed by the specification; `1` is chosen so
 * that a shape's derived mass equals its volume, which makes the §23
 * mass-from-density rule inspectable by hand (decision, WP-5.1).
 */
export const DEFAULT_DENSITY = 1;

/** Appendix A: friction combines by `average` (§25). */
export const DEFAULT_FRICTION_COMBINE_MODE: CombineMode = "average";

/** Appendix A: restitution combines by `maximum` (§25). */
export const DEFAULT_RESTITUTION_COMBINE_MODE: CombineMode = "maximum";

/** Construction-time values for a {@link PhysicsMaterial} (§25). */
export interface PhysicsMaterialOptions {
  /** Coulomb friction coefficient; finite and >= 0. */
  friction?: number;
  /** Restitution ("bounciness"); finite and >= 0. */
  restitution?: number;
  /** Optional rolling-resistance coefficient (§25); finite and >= 0. */
  rollingFriction?: number;
  /** Optional spin-resistance coefficient (§25); finite and >= 0. */
  spinningFriction?: number;
  /** Mass per unit volume in kg/m³; finite and >= 0. */
  density?: number;
}

/** Rejects a material coefficient that is not a finite, non-negative number (§85). */
function requireNonNegative(field: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new FourError(
      MATERIAL_ERROR_CODE,
      `PhysicsMaterial.${field} must be a finite number >= 0; got ${String(value)} (§25, §85).`,
      { context: { field, value } },
    );
  }
  return value;
}

/**
 * Surface properties shared by any number of colliders (§25).
 *
 * ```ts
 * const rubber = new PhysicsMaterial({ friction: 0.9, restitution: 0.8, density: 1100 });
 * const ice = new PhysicsMaterial({ friction: 0.05 });
 * combineFriction(rubber, ice);    // 0.475 — Appendix A: average
 * combineRestitution(rubber, ice); // 0.8   — Appendix A: maximum
 * ```
 *
 * Omitted options take {@link DEFAULT_FRICTION}, {@link DEFAULT_RESTITUTION},
 * and {@link DEFAULT_DENSITY}; the two optional §25 coefficients stay
 * `undefined` when omitted, because "not specified" and "zero rolling
 * resistance" are different statements and an adapter that supports rolling
 * friction needs to tell them apart.
 */
export class PhysicsMaterial {
  /** Coulomb friction coefficient (§25). */
  friction: number;

  /** Restitution — how much normal velocity a contact returns (§25). */
  restitution: number;

  /**
   * Rolling resistance (§25). `undefined` means "unspecified"; adapters that
   * model it fall back to their own default, and adapters that do not ignore it.
   */
  rollingFriction?: number;

  /** Spin resistance (§25). Same `undefined` semantics as rolling friction. */
  spinningFriction?: number;

  /**
   * Mass per unit volume in kg/m³ (§25). Only a **fallback** for mass
   * derivation: `Collider.density` wins wherever both exist — see
   * {@link resolveDensity}.
   */
  density: number;

  constructor(options: PhysicsMaterialOptions = {}) {
    this.friction = requireNonNegative(
      "friction",
      options.friction ?? DEFAULT_FRICTION,
    );
    this.restitution = requireNonNegative(
      "restitution",
      options.restitution ?? DEFAULT_RESTITUTION,
    );
    this.density = requireNonNegative(
      "density",
      options.density ?? DEFAULT_DENSITY,
    );
    if (options.rollingFriction !== undefined) {
      this.rollingFriction = requireNonNegative(
        "rollingFriction",
        options.rollingFriction,
      );
    }
    if (options.spinningFriction !== undefined) {
      this.spinningFriction = requireNonNegative(
        "spinningFriction",
        options.spinningFriction,
      );
    }
  }
}

/**
 * Applies one §25 combination rule to two coefficients.
 *
 * ```ts
 * combineValues(0.2, 0.8, "average");  // 0.5
 * combineValues(0.2, 0.8, "minimum");  // 0.2
 * combineValues(0.2, 0.8, "maximum");  // 0.8
 * combineValues(0.2, 0.8, "multiply"); // 0.16000000000000003
 * ```
 *
 * Commutative in every mode, which matters: a contact between A and B must
 * produce the same coefficient whichever collider the solver happens to list
 * first, or the simulation would depend on the solver's internal pair ordering
 * (§33 determinism).
 *
 * Throws on an unrecognized mode rather than falling through to a default. The
 * union makes that unreachable from TypeScript; the check exists for JavaScript
 * callers and for deserialized data, where a silently substituted rule would
 * produce a plausible-looking wrong simulation.
 */
export function combineValues(a: number, b: number, mode: CombineMode): number {
  switch (mode) {
    case "average":
      return (a + b) / 2;
    case "minimum":
      return Math.min(a, b);
    case "maximum":
      return Math.max(a, b);
    case "multiply":
      return a * b;
    default: {
      const unknownMode: never = mode;
      throw new FourError(
        MATERIAL_ERROR_CODE,
        `Unknown CombineMode ${JSON.stringify(unknownMode)}; expected one of average, minimum, maximum, multiply (§25).`,
        { context: { mode: unknownMode } },
      );
    }
  }
}

/**
 * Friction of a contact between two materials (§25), averaging by default
 * (Appendix A).
 */
export function combineFriction(
  a: PhysicsMaterial,
  b: PhysicsMaterial,
  mode: CombineMode = DEFAULT_FRICTION_COMBINE_MODE,
): number {
  return combineValues(a.friction, b.friction, mode);
}

/**
 * Restitution of a contact between two materials (§25), taking the maximum by
 * default (Appendix A).
 */
export function combineRestitution(
  a: PhysicsMaterial,
  b: PhysicsMaterial,
  mode: CombineMode = DEFAULT_RESTITUTION_COMBINE_MODE,
): number {
  return combineValues(a.restitution, b.restitution, mode);
}

/**
 * The density used to derive a collider's mass (§25, §23).
 *
 * §25's rule, verbatim: *"`Collider.density` (§24) is authoritative for mass
 * derivation (§23); `PhysicsMaterial.density` is a fallback used only when the
 * collider does not set one."* With neither present the result is
 * {@link DEFAULT_DENSITY}.
 *
 * ```ts
 * resolveDensity(7800, steel); // 7800 — the collider wins
 * resolveDensity(undefined, steel); // steel.density
 * resolveDensity(undefined); // DEFAULT_DENSITY
 * ```
 *
 * A collider density of `0` is a *set* density, not an absent one, so it wins
 * over the material — `??` and not `||`, deliberately.
 */
export function resolveDensity(
  colliderDensity?: number,
  material?: PhysicsMaterial,
): number {
  return colliderDensity ?? material?.density ?? DEFAULT_DENSITY;
}
