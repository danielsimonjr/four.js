/**
 * The color value type shared by materials and animation (§60a, plan P4-2).
 *
 * `@four/materials` authors colors and `@four/animation` tweens them, but the
 * §3.1 dependency matrix has no edge between the two, so each originally
 * declared the identical tuple structurally with a dated note. Hoisted here
 * 2026-08-04 — `@four/math` is the value-type home below both — and re-exported
 * unchanged by each, so values keep passing between the two without conversion.
 */

/**
 * Straight (non-premultiplied) RGBA, each component nominally in 0…1.
 *
 * A mutable 4-tuple rather than a `Vector4`: a color is not a geometric vector
 * (adding two colors is not a transform, and none of `Vector4`'s dot/normalize
 * surface means anything here), and a plain array uploads to
 * `uniform4fv`/`Float32Array.set` without an adapter.
 *
 * No color space is attached, and components are **not clamped** anywhere:
 * §60a's pipeline is linear-light with extended range, its working/output
 * space policy is a later packet, and clamping would silently rewrite authored
 * data (decision, WP-3.3; the same rule mid-tween, plan P4-2).
 */
export type ColorRGBA = [
  red: number,
  green: number,
  blue: number,
  alpha: number,
];
