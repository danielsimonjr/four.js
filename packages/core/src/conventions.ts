/**
 * Normative default constants shared across pillars (Appendix A, §7a).
 *
 * A number that Appendix A pins once but more than one pillar needs has to
 * live below all of them, or each grows its own copy — which is exactly what
 * happened to {@link DEFAULT_GRAVITY_Y} (`@four/physics` for world gravity,
 * `@four/particles` for the default gravity field, no §3.1 edge between them,
 * dated duplication notes on both). Hoisted here 2026-08-04; both packages
 * re-export it unchanged.
 */

/**
 * Standard gravity in units/s², as a signed Y component.
 *
 * Appendix A pins gravity at `(0, -9.81, 0)` m/s² in a 3D world and
 * `(0, -9.81)` in a 2D one — the same vector, because §7a puts +Y up in both.
 * Used by `@four/physics` as the default world gravity and by
 * `@four/particles` as the default acceleration of `uniformGravityField`.
 */
export const DEFAULT_GRAVITY_Y = -9.81;
