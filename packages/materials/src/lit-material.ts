/**
 * `LitMaterial` (§57, §68, §120) — one RGBA color that responds to lights.
 *
 * §120's rendering list names "lighting" as MVP scope, and §68 defines the
 * light set. This is the material half of that tier: a surface shaded as
 *
 * ```text
 * fragment = color.rgb × (sceneAmbient + lightColor × intensity × max(N·−L, 0))
 * ```
 *
 * — Lambert diffuse under §68's directional light plus the scene ambient term,
 * nothing else. §57's family puts `StandardMaterial` (§59's metallic-roughness
 * PBR workflow) above this; `LitMaterial` is the minimal lit member the MVP
 * ships **below** it, exactly as `UnlitMaterial` is the minimal unlit member.
 * §57's family list does not name `LitMaterial` — the addition is recorded as
 * a spec-revisit item (TODO 2026-08-04) rather than silently absorbed.
 * Staged with that dated note, not sketched: per-material specular terms,
 * emissive, maps (§59), shadows (§69), and tone mapping (§60a) all belong to
 * the packets that own those designs.
 *
 * The class deliberately mirrors `UnlitMaterial` member for member — id,
 * version counter, `setColor`, `markDirty`, `dispose` — so the two read as the
 * §57 siblings they are; see that module's headers for the reasoning behind
 * each convention. Since 2026-08-06 the mirroring is literal: both extend
 * §57's abstract {@link Material}, which owns the id, the version counter,
 * `markDirty`, `dispose`, and the six shared render-state fields (`opacity`,
 * `transparent`, `blendMode`, `depthTest`, `depthWrite`, `colorWrite`). What
 * is left here is the lit colour and the {@link LitMaterial.kind} discriminant.
 *
 * ## Color space (§60a)
 *
 * Identical to `UnlitMaterial`, stated once more because lighting is where it
 * starts to matter: the four components are **plain numbers in the documented
 * range 0…1** with no color space attached. §60a makes lighting linear-light
 * on the GPU backends, and the lit pipeline multiplies these numbers as-is —
 * so they are *treated* as linear-light — but the working/output space policy,
 * transfer functions, and tone mapping are a later packet, and tagging a space
 * here would pin half of that design by accident. Values outside 0…1 pass
 * through rather than clamp (the WP-3.3 decision `UnlitMaterial` records);
 * non-finite components are rejected (§85).
 */

import { Material, type MaterialOptions } from "./material.js";
import type { ColorRGBA } from "./unlit-material.js";

/**
 * Construction arguments of {@link LitMaterial} — its own colour, plus §57's
 * shared render state from {@link MaterialOptions}.
 */
export interface LitMaterialOptions extends MaterialOptions {
  /**
   * Initial color, copied into the material's own array. Defaults to opaque
   * white `[1, 1, 1, 1]`, so an untinted material shows the lighting alone.
   */
  color?: readonly [number, number, number, number];
}

/**
 * The prefix this family member's ids carry. The counter behind it is the
 * family-wide one in `material.ts` — one counter, one prefix per member, so
 * two members can never mint a colliding cache key (§33).
 */
const ID_PREFIX = "lit-material";

/** Rejects non-finite color components (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Color component ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * A material shaded by the scene's lights: Lambert diffuse plus the scene
 * ambient term (§57, §68).
 *
 * ```ts
 * const material = new LitMaterial({ color: [1, 0.4, 0, 1] });
 * material.setColor(0, 0.6, 1);   // alpha defaults back to opaque
 * material.dispose();             // §83: explicit lifetime
 * ```
 *
 * A `Renderable` carrying one produces a `"lit"` render item and draws through
 * the lit pipeline; with no directional light in the scene it shades from the
 * ambient term alone, and with a black (default) ambient it renders black —
 * lights are part of the scene, not of the material. A geometry without a
 * `normals` attribute also shades ambient-only (see `BufferGeometry.normals`).
 *
 * Materials are **shared, not owned by nodes**: any number of `Renderable`s may
 * point at one, and disposing it is the job of whoever created it (§83).
 */
export class LitMaterial extends Material {
  /** Pipeline discriminant (§57, §64) — see `UnlitMaterial.kind`. */
  readonly kind = "lit" as const;

  /**
   * Straight RGBA in 0…1; opaque white by default. The array instance is
   * `readonly` — write *into* it — for the reason `UnlitMaterial.color`
   * documents: a backend may keep a reference to it. Use
   * {@link LitMaterial.setColor}, or write components directly and call
   * {@link Material.markDirty}.
   */
  readonly color: ColorRGBA;

  constructor(options: LitMaterialOptions = {}) {
    super(ID_PREFIX, options);
    const color = options.color ?? [1, 1, 1, 1];
    this.color = [
      requireFinite("red", color[0]),
      requireFinite("green", color[1]),
      requireFinite("blue", color[2]),
      requireFinite("alpha", color[3]),
    ];
  }

  /**
   * Writes the color and bumps {@link Material.version} once. Returns
   * `this` for chaining (§7b). `alpha` defaults to `1` rather than to the
   * current alpha, for the reason `UnlitMaterial.setColor` documents.
   */
  setColor(red: number, green: number, blue: number, alpha = 1): this {
    // Validate before the first write — see UnlitMaterial.setColor (the
    // 2026-08-04 torn-state review fix, applied to all three materials).
    const validRed = requireFinite("red", red);
    const validGreen = requireFinite("green", green);
    const validBlue = requireFinite("blue", blue);
    const validAlpha = requireFinite("alpha", alpha);
    this.color[0] = validRed;
    this.color[1] = validGreen;
    this.color[2] = validBlue;
    this.color[3] = validAlpha;
    this.markDirty();
    return this;
  }
}
