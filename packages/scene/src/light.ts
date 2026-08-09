/**
 * Lights (§68) — the multi-light tier: directional, point, and spot nodes.
 *
 * §68's initial light set is ambient, hemisphere, directional, point, spot,
 * and rectangular area. The §120 MVP shipped the two cheapest members
 * (2026-08-04); **R-17 adds the two positional ones on 2026-08-09** and leaves
 * the remaining two staged. What is here, and what is not:
 *
 * - **directional** — {@link DirectionalLight}, this module. Exactly one
 *   illuminates a frame: it is the sun, it has dedicated shader uniforms, and
 *   further directional lights are still ignored (deterministically —
 *   scene-graph order decides which one wins, §33). Widening *that* one means
 *   retiring the dedicated uniforms in favour of a third entry kind in the
 *   light set, which is the clustered/forward-plus path's job (§68) and not
 *   this tier's;
 * - **point** — {@link PointLight}, new. A position, an inverse-square falloff,
 *   and an optional range window;
 * - **spot** — {@link SpotLight}, new. A point light with a cone: an axis (the
 *   node's −Z, as a directional light's) and two half-angles;
 * - **ambient** — still a *scene-wide constant term* on `Scene.ambientLight`
 *   rather than a node: with exactly one value per scene there is nothing
 *   positional about it, and a node would only add a traversal to find it;
 * - **hemisphere** and **rectangular area** — staged (2026-08-09). Neither is a
 *   punctual light: a hemisphere light is a two-colour directional *ambient*
 *   term (sky above, ground below) that belongs beside `Scene.ambientLight`
 *   rather than in the punctual set, and a rectangular area light needs the
 *   linearly-transformed-cosine machinery §68's "where supported" already
 *   hedges on. Both are absent rather than accepted-and-ignored;
 * - **shadows** (`castShadow` in §68's own example) are §69, a package of
 *   machinery (shadow maps, cascades, bias controls) this tier does not
 *   pretend to have — the option is absent rather than accepted-and-ignored;
 * - §68's **CSS color strings** denote sRGB values (§60a); §101's shipped-name
 *   mapping pins colours as linear tuples for this tier (R-15, 2026-08-08), so
 *   an author with a string decodes it first — see {@link ColorRGB};
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
 * *position* is irrelevant, as §68's directional model requires. A
 * {@link SpotLight} aims its cone along the same axis, so one rig points
 * either kind; a {@link PointLight} has no axis at all and reads only its
 * node's world *position*.
 *
 * ## Intensity, and what a light's numbers mean
 *
 * `color × intensity` is an **irradiance already divided by π** — the
 * radiometric convention R-13 wrote down on 2026-08-08 and the reason neither
 * the Lambert lobe nor the GGX one carries a `1/π`. For a directional light
 * that product *is* the irradiance on a surface facing it. For a point or spot
 * light it is the irradiance at **unit distance** (one metre, §40), which the
 * inverse-square falloff then scales — so a `PointLight` and a
 * `DirectionalLight` of equal `intensity` agree exactly on a surface one metre
 * away and facing both. That is the whole content of the choice: it makes the
 * two kinds comparable without introducing a candela/lumen conversion §68's
 * "physically coherent units *where practical*" does not yet pay for.
 *
 * ## The renderer contract
 *
 * `@four/render` discovers lights **structurally** (its `lights.ts` declares
 * the `DirectionalLightSource` and `PunctualLightSource` shapes) — the same
 * duck-typed pattern as its `ParticleDrawable`, though for the opposite
 * reason: the dependency edge render → scene exists, but the *WebGL backend's*
 * unit tests build scenes from typed doubles and an `instanceof` check would
 * be unfakeable there. `@four/render`'s own tests pin these classes against
 * the contracts, so drift is caught at type level where the particle contract
 * can only catch it by test.
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
 * A frame shades with **at most one** directional light — the first one in
 * scene-graph order (see `@four/render`'s `collectSceneLights`); further
 * directional lights are still ignored, for the reason the module header
 * gives. {@link PointLight} and {@link SpotLight} are how a scene gets more
 * than one lamp (R-17, 2026-08-09). Visibility
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

/** Rejects a negative light parameter (§85); `requireFinite` runs first. */
function requireNonNegative(name: string, value: number): number {
  if (requireFinite(name, value) < 0) {
    throw new RangeError(
      `Light ${name} must not be negative; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Construction arguments shared by {@link PointLight} and {@link SpotLight}. */
export interface PunctualLightOptions {
  /**
   * Initial color, copied into the light's own array. Defaults to white
   * `[1, 1, 1]`, §68's own example value.
   */
  color?: readonly [number, number, number];
  /**
   * Initial {@link PunctualLight.intensity}. Defaults to `1` — the
   * multiplicative identity, exactly as {@link DirectionalLightOptions}
   * defaults it.
   */
  intensity?: number;
  /**
   * Initial {@link PunctualLight.range}, in metres (§40). Defaults to `0`,
   * which means **unbounded**.
   */
  range?: number;
}

/**
 * The shared half of §68's two *positional* light types — a light that has a
 * place in the world and fades with distance from it (R-17, 2026-08-09).
 *
 * Abstract because §68 has no "punctual light" of its own: the class exists so
 * that {@link PointLight} and {@link SpotLight} cannot disagree about what
 * `color × intensity` means, how `range` windows the falloff, or where the
 * light *is*. Concrete subclasses add only what distinguishes them, which for
 * a spot light is exactly a cone.
 *
 * ## Falloff (§68, "physically coherent units where practical")
 *
 * Irradiance at distance `d` is `color × intensity / d²` — the inverse-square
 * law, unmodified, because a point emitter genuinely obeys it and any
 * "smoother" curve would be an art direction rather than a light. The one
 * departure is {@link PunctualLight.range}, glTF's `KHR_lights_punctual`
 * window:
 *
 * ```text
 * attenuation = clamp(1 − (d / range)⁴, 0, 1) / d²          range > 0
 * attenuation = 1 / d²                                       range = 0
 * ```
 *
 * The window is a **culling aid, not physics**: it drives the contribution
 * smoothly to exactly zero at `d = range` so a renderer may one day skip the
 * light beyond it without a visible seam. `range = 0` — the default — declares
 * that no such cut-off exists, which is why the default is the honest one.
 *
 * The `1/d²` term is evaluated in the shader with `d²` floored at a tiny
 * epsilon, so a surface *at* the light's exact position renders very bright
 * rather than `NaN`; the floor lives where the division does, the placement
 * rule R-13 fixed for `roughness`.
 */
export abstract class PunctualLight extends Node {
  /**
   * The brand `@four/render`'s light collection recognises — a literal `true`,
   * one property load per node, exactly as `DirectionalLight.isDirectionalLight`.
   */
  readonly isPunctualLight = true as const;

  /** Which of §68's positional types this is; fixed by the subclass. */
  abstract readonly lightType: "point" | "spot";

  /**
   * Straight linear-light RGB in 0…1; white by default. The array instance is
   * `readonly` — write *into* it — for the reason
   * {@link DirectionalLight.color} records.
   */
  readonly color: ColorRGB;

  /**
   * Scalar multiplier on {@link PunctualLight.color} (§68): the irradiance,
   * over π, this light delivers to a surface **one metre away and facing it**
   * (see the module header). Must be finite; negatives pass through
   * un-clamped, like every other authored colour component.
   */
  intensity: number;

  /**
   * Distance in metres (§40) at which this light's contribution reaches
   * exactly zero, or `0` for **unbounded** — see the class header for the
   * window this switches on. Must be finite and non-negative.
   */
  range: number;

  constructor(options: PunctualLightOptions = {}) {
    super();
    const color = options.color ?? [1, 1, 1];
    this.color = [
      requireFinite("color red", color[0]),
      requireFinite("color green", color[1]),
      requireFinite("color blue", color[2]),
    ];
    this.intensity = requireFinite("intensity", options.intensity ?? 1);
    this.range = requireNonNegative("range", options.range ?? 0);
  }

  /**
   * Writes this light's world-space position into `out` and returns it (§7b's
   * `out`-parameter convention) — the translation column of the resolved world
   * matrix.
   *
   * World transforms are resolved on demand, exactly as
   * {@link DirectionalLight.getWorldDirection} resolves them: O(depth),
   * version-cached, so the render path's prior resolve pass makes this a few
   * comparisons. Unlike a direction, a position needs no normalization and has
   * no degenerate case — a light under a zero scale still sits somewhere.
   */
  getWorldPosition(out: Vector3): Vector3 {
    const elements = resolveWorldTransform(this).elements;
    // Column-major Matrix4 (§7b): elements 12, 13, 14 are the translation.
    return out.set(elements[12], elements[13], elements[14]);
  }
}

/**
 * An omnidirectional light at a point in space (§68) — a bare bulb.
 *
 * ```ts
 * const lamp = new PointLight({ color: [1, 0.9, 0.75], intensity: 4, range: 12 });
 * lamp.transform.position.set(0, 3, 0);
 * scene.add(lamp);
 * ```
 *
 * Everything about it is {@link PunctualLight}'s; the class adds only the
 * discriminant. Visibility follows §6 exactly as a drawable's does: a light
 * under a `visible = false` or `enabled = false` ancestor does not illuminate.
 * There is no version counter, for the reason {@link DirectionalLight} records
 * — light uniforms are a handful of floats uploaded per frame.
 *
 * A frame draws at most {@link @four/render!MAX_PUNCTUAL_LIGHTS} point and
 * spot lights together; the rest are skipped, in a documented order, with one
 * warning. See `@four/render`'s `collectSceneLights`.
 */
export class PointLight extends PunctualLight {
  readonly lightType = "point" as const;
}

/** Construction arguments of {@link SpotLight} (§68). */
export interface SpotLightOptions extends PunctualLightOptions {
  /**
   * Initial {@link SpotLight.innerConeAngle}, in radians (§7a). Defaults to
   * `0` — glTF `KHR_lights_punctual`'s default, i.e. a cone that fades from
   * its axis outward with no fully-lit core.
   */
  innerConeAngle?: number;
  /**
   * Initial {@link SpotLight.outerConeAngle}, in radians (§7a). Defaults to
   * `Math.PI / 4`, glTF's default: a 90° cone.
   */
  outerConeAngle?: number;
}

/**
 * A point light restricted to a cone about its node's −Z axis (§68).
 *
 * ```ts
 * const spot = new SpotLight({
 *   intensity: 8,
 *   outerConeAngle: Math.PI / 6,
 *   innerConeAngle: Math.PI / 8,
 * });
 * spot.transform.position.set(0, 4, 0);
 * // Aim it down −Y, exactly as a directional light is aimed (§7a).
 * spot.transform.rotation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
 * scene.add(spot);
 * ```
 *
 * ## The cone (§7a: half-angles, in radians)
 *
 * Both angles are measured from the axis, not across the cone, and both are
 * glTF `KHR_lights_punctual`'s — the same parameterization a loaded asset
 * carries, so an importer assigns them straight across. Inside
 * `innerConeAngle` the light is at full strength; between the two it falls off
 * smoothly; outside `outerConeAngle` it contributes nothing:
 *
 * ```text
 * t = clamp((cos θ − cos outer) / (cos inner − cos outer), 0, 1)
 * ```
 *
 * Nothing here clamps or reorders the two angles (WP-3.3's no-silent-rewrites
 * rule). `inner ≥ outer` is therefore expressible and means a **hard-edged**
 * cone: `@four/render` divides by `max(cos inner − cos outer, 1e-6)`, which
 * turns the ramp into a step rather than into a division by zero. An angle
 * past `π/2` is likewise expressible and lights a hemisphere or more — a
 * floodlight, not an error.
 */
export class SpotLight extends PunctualLight {
  readonly lightType = "spot" as const;

  /** Half-angle of the fully-lit core, in radians (§7a). See the class header. */
  innerConeAngle: number;

  /** Half-angle at which the cone reaches zero, in radians (§7a). */
  outerConeAngle: number;

  constructor(options: SpotLightOptions = {}) {
    super(options);
    this.innerConeAngle = requireFinite(
      "innerConeAngle",
      options.innerConeAngle ?? 0,
    );
    this.outerConeAngle = requireFinite(
      "outerConeAngle",
      options.outerConeAngle ?? Math.PI / 4,
    );
  }

  /**
   * Writes the world-space unit vector this light's cone points along — the
   * node's −Z axis — into `out` and returns it.
   *
   * Identical in contract, convention, and degenerate behaviour to
   * {@link DirectionalLight.getWorldDirection}: the same axis, so the same rig
   * aims either kind, and a zero-scaled ancestor yields the zero vector rather
   * than `NaN`. A zero axis makes `cos θ` zero for every surface, which the
   * cone term then resolves against the authored angles — nothing downstream
   * is poisoned.
   */
  getWorldDirection(out: Vector3): Vector3 {
    const elements = resolveWorldTransform(this).elements;
    out.set(-elements[8], -elements[9], -elements[10]);
    return out.normalize();
  }
}
