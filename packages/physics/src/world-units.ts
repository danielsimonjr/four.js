/**
 * §40 scale factors a {@link PhysicsWorld} may apply at the authoring boundary.
 *
 * Internal solver state is **SI** (metres, kilograms, seconds). When a world
 * is constructed with {@link PhysicsWorldUnits}, authored gravity, poses, and
 * masses are converted into that representation on the way to the solver and
 * converted back on the way out. When the option is omitted every conversion
 * is the identity, so existing tests and §33 goldens stay bit-identical.
 *
 * ## Why this is not the core display record
 *
 * `@four/core`'s unit-system helpers are display/authoring conversion and are
 * inexact in the last bits by construction — an integration gate forbids the
 * identifier on any simulation path. This record is the two §40 *scale*
 * factors only, which are exact multiplies when they are 1 and otherwise a
 * deliberate, once-at-the-boundary conversion. Pass a core unit-system object
 * through: it is structurally compatible (`{ scale: { lengthToMeters,
 * massToKilograms } }`).
 */

/**
 * The two §40 scale factors a world reads. Structurally compatible with
 * `@four/core`'s frozen unit-system record.
 */
export interface PhysicsWorldUnits {
  readonly scale: {
    /** Metres per authored length unit. Finite and greater than zero. */
    readonly lengthToMeters: number;
    /** Kilograms per authored mass unit. Finite and greater than zero. */
    readonly massToKilograms: number;
  };
}

/**
 * Freezes and returns `units`, or `undefined` when omitted so the identity
 * path allocates nothing and compares with one pointer check.
 */
export function resolvePhysicsWorldUnits(
  units?: PhysicsWorldUnits,
): PhysicsWorldUnits | undefined {
  if (units === undefined) {
    return undefined;
  }
  return Object.freeze({
    scale: Object.freeze({
      lengthToMeters: units.scale.lengthToMeters,
      massToKilograms: units.scale.massToKilograms,
    }),
  });
}

/** Metres from an authored length. Identity when `units` is omitted. */
export function toSiLength(
  value: number,
  units: PhysicsWorldUnits | undefined,
): number {
  return units === undefined ? value : value * units.scale.lengthToMeters;
}

/** Authored length from metres. Identity when `units` is omitted. */
export function fromSiLength(
  meters: number,
  units: PhysicsWorldUnits | undefined,
): number {
  return units === undefined ? meters : meters / units.scale.lengthToMeters;
}

/** Kilograms from an authored mass. Identity when `units` is omitted. */
export function toSiMass(
  value: number,
  units: PhysicsWorldUnits | undefined,
): number {
  return units === undefined ? value : value * units.scale.massToKilograms;
}

/** Authored mass from kilograms. Identity when `units` is omitted. */
export function fromSiMass(
  kilograms: number,
  units: PhysicsWorldUnits | undefined,
): number {
  return units === undefined
    ? kilograms
    : kilograms / units.scale.massToKilograms;
}
