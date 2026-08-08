/**
 * Lights (§68) — the MVP tier: one directional light node.
 *
 * §68's initial light set is ambient, hemisphere, directional, point, spot,
 * and rectangular area. The §120 MVP ships the two cheapest members and stages
 * the rest with this dated note (2026-08-04):
 *
 * - **directional** — {@link DirectionalLight}, this module;
 * - **ambient** — a *scene-wide constant term* on `Scene.ambientLight` rather
 *   than a node: with exactly one value per scene there is nothing positional
 *   about it, and a node would only add a traversal to find it (an
 *   `AmbientLight` node — and hemisphere, point, spot, area — arrives with the
 *   multi-light packet, which needs per-light uniform arrays and §68's
 *   clustered/forward-plus path to draw more than one light honestly);
 * - **shadows** (`castShadow` in §68's own example) are §69, a package of
 *   machinery (shadow maps, cascades, bias controls) this tier does not
 *   pretend to have — the option is absent rather than accepted-and-ignored;
 * - §68's **CSS color strings** denote sRGB values (§60a) and need the §60a
 *   color-management packet to parse honestly; until then light colors are
 *   numeric tuples exactly like `UnlitMaterial.color`'s components;
 * - physically coherent units, light layers, environment/image-based
 *   lighting, tone mapping, and exposure (§68's requirements list) are all
 *   staged with their owning designs.
 *
 * A light is a {@link Node} — the placement decision cameras made (§47,
 * spec rev 1.3 put cameras in `@four/scene`): it sits in the scene graph,
 * is parented, animated, and driven like anything else, and a light on a
 * turntable is a light added under the turntable's node.
 *
 * ## Direction
 *
 * A directional light shines along its node's **−Z axis in world space** —
 * the direction a camera looks (§7a, plan D8), so the same rig conventions
 * aim both. An unrotated light therefore shines toward −Z; a sun overhead is
 * the node rotated −π/2 about X (shining −Y, §7a's "down"). The node's world
 * *position* is irrelevant, as §68's directional model requires.
 *
 * ## The renderer contract
 *
 * `@four/render` discovers lights **structurally** (its `lights.ts` declares
 * the `DirectionalLightSource` shape) — the same duck-typed pattern as its
 * `ParticleDrawable`, though for the opposite reason: the dependency edge
 * render → scene exists, but the *WebGL backend's* unit tests build scenes
 * from typed doubles and an `instanceof` check would be unfakeable there.
 * `@four/render`'s own tests pin this class against the contract, so drift is
 * caught at type level where the particle contract can only catch it by test.
 */

import { Vector3 } from "@four/math";
import type { ColorRGB } from "@four/math";

import { Node } from "./node.js";
import { resolveWorldTransform } from "./world-transforms.js";

/**
 * Straight RGB, each component nominally in 0…1 — `@four/math`'s
 * {@link ColorRGB}, re-exported (hoisted 2026-08-08 by R-15's colour packet,
 * exactly as `ColorRGBA` was hoisted 2026-08-04).
 *
 * The declaration moved; the type did not. A light colour is a **linear-light**
 * value: §60a makes the GPU pipeline linear-light, and `@four/render` uploads
 * these numbers to the shader as they stand. An author who has a CSS string
 * decodes it first — §60a says a string denotes *sRGB* — with `@four/math`'s
 * `srgbToLinearRGB(parseColorRGB("#ffcc00"), light.color)`. The option is not
 * widened to accept the string itself: §101's shipped-name mapping says colours
 * are "linear RGBA arrays in 0..1 (§60a), not CSS strings" for this tier, and
 * changing that is an owner decision, recorded 2026-08-08.
 */
export type { ColorRGB } from "@four/math";

/** Construction arguments of {@link DirectionalLight} (§68). */
export interface DirectionalLightOptions {
  /**
   * Initial color, copied into the light's own array. Defaults to white
   * `[1, 1, 1]`, §68's own example value.
   */
  color?: readonly [number, number, number];
  /**
   * Initial {@link DirectionalLight.intensity}. Defaults to `1`, so an
   * unconfigured light contributes exactly its color (decision, 2026-08-04:
   * §68's example `intensity: 3` is illustrative and Appendix A pins no light
   * defaults; `1` is the multiplicative identity).
   */
  intensity?: number;
}

/** Rejects non-finite light parameters (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Light ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * A light infinitely far away, shining uniformly along its node's −Z world
 * axis (§68) — sunlight.
 *
 * ```ts
 * const sun = new DirectionalLight({ color: [1, 0.98, 0.9], intensity: 3 });
 * // Shine down −Y: rotate the node's −Z axis onto it (−π/2 about X, §7a).
 * sun.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
 * scene.add(sun);
 * ```
 *
 * The MVP lit pipeline shades with **at most one** directional light — the
 * first one in scene-graph order (see `@four/render`'s `collectSceneLights`);
 * additional lights are staged with the module's dated note. Visibility
 * follows §6 exactly as it does for drawables: a light under a `visible =
 * false` or `enabled = false` ancestor (or itself hidden or disabled) does
 * not illuminate.
 *
 * There is no version counter, unlike materials and geometry: light uniforms
 * are a handful of floats uploaded per view per frame, so there is no backend
 * cache to invalidate — `color` and `intensity` may simply be written
 * (non-finite values excepted, §85) and take effect next frame.
 */
export class DirectionalLight extends Node {
  /**
   * The brand `@four/render`'s light collection recognises — a literal `true`,
   * one property load per node, exactly as `ParticleDrawable.isParticleDrawable`.
   */
  readonly isDirectionalLight = true as const;

  /**
   * Straight RGB in 0…1; white by default. The array instance is `readonly`
   * — write *into* it — because the renderer may read it every frame and
   * replacing the array would leave a captured reference stale.
   */
  readonly color: ColorRGB;

  /**
   * Scalar multiplier on {@link DirectionalLight.color} (§68). Dimensionless
   * in this tier — §68's "physically coherent units where practical" is
   * staged with the module's dated note. Values outside 0…1 are the point
   * (sunlight is bright); negative values pass through un-clamped like every
   * other color component (WP-3.3's no-silent-rewrites decision). Must be
   * finite; validated at construction, and by contract when written directly.
   */
  intensity: number;

  constructor(options: DirectionalLightOptions = {}) {
    super();
    const color = options.color ?? [1, 1, 1];
    this.color = [
      requireFinite("color red", color[0]),
      requireFinite("color green", color[1]),
      requireFinite("color blue", color[2]),
    ];
    this.intensity = requireFinite("intensity", options.intensity ?? 1);
  }

  /**
   * Writes the world-space unit vector this light travels along — the node's
   * −Z axis — into `out` and returns it (§7b's `out`-parameter convention).
   *
   * World transforms are resolved on demand (`resolveWorldTransform(this)`),
   * exactly as `Camera.updateViewMatrix` resolves — O(depth), version-cached,
   * so the render path's prior resolve pass makes this a few comparisons.
   * The −Z basis column is read straight out of the world matrix and
   * normalized, so ancestor scale does not stretch the direction.
   *
   * A degenerate light — zero scale somewhere up the chain — yields the zero
   * vector rather than `NaN` (`Vector3.normalize`'s documented zero-length
   * behaviour), and a zero direction lights nothing: like a degenerate
   * camera (§47), it poisons nothing downstream and raises no error on a
   * per-frame path.
   */
  getWorldDirection(out: Vector3): Vector3 {
    const elements = resolveWorldTransform(this).elements;
    // Column-major Matrix4 (§7b): column 2 — elements 8, 9, 10 — is the
    // node's local +Z axis in world space; the light travels along −Z.
    out.set(-elements[8], -elements[9], -elements[10]);
    return out.normalize();
  }
}
