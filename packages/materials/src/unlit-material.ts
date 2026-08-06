/**
 * `UnlitMaterial` (§57) — a flat RGBA color, and nothing else.
 *
 * §57 defines a `Material` family (`ShapeMaterial`, `SpriteMaterial`,
 * `TextMaterial`, `LineMaterial`, `UnlitMaterial`, `StandardMaterial`,
 * `PhysicalMaterial`, `ShaderMaterial`, `NodeMaterial`, `ComputeMaterial`) over
 * an abstract base carrying `opacity`, `transparent`, `blendMode`, `depthTest`,
 * `depthWrite`, `colorWrite`, and an optional `stencil`. The §120 MVP renders
 * "unlit colored geometry" with WebGL 2, so this packet implements the one
 * family member that tier needs and **does not** introduce the abstract base:
 *
 * - every field of §57's base is a piece of render state the backend has to
 *   translate into GL calls, and the packet that writes those calls (WP-3.5) is
 *   the one that can say what each of them means for a WebGL 2 pipeline;
 * - an abstract class with a single subclass constrains nothing and would have
 *   to be re-opened anyway when `ShapeMaterial` and `StandardMaterial` arrive.
 *
 * `Renderable.material` (`@four/render`) is therefore typed as `UnlitMaterial`
 * for now, and widens to `Material | Material[]` (§49) when the base lands. The
 * deferral is deliberate and reported as a WP-3.3 decision.
 *
 * **The base landed on 2026-08-06** (`material.ts`), and this class is now one
 * of its subclasses: `id`, `version`, `markDirty`, `dispose`, and §57's six
 * render-state fields (`opacity`, `transparent`, `blendMode`, `depthTest`,
 * `depthWrite`, `colorWrite`) all live on {@link Material} and are documented
 * there. What is left here is the one thing that is `UnlitMaterial`'s own: a
 * flat RGBA colour. Every inherited default reproduces this class's previous
 * behaviour exactly — see {@link Material}'s header.
 *
 * ## Version, not events
 *
 * Backends cache uniform uploads and pipeline state per material, keyed on
 * {@link Material.version} — the same contract `BufferGeometry.version`
 * and `Transform.version` offer. {@link UnlitMaterial.setColor} bumps it;
 * writing a component in place does not, and must be announced:
 *
 * ```ts
 * material.setColor(1, 0, 0);  // version += 1
 * material.color[3] = 0.5;     // in-place edit — invisible to the material
 * material.markDirty();        // announce it: version += 1
 * ```
 *
 * ## Alpha is drawn now (§66, R-11)
 *
 * `color[3]` was a **dead field** until 2026-08-06: the backend disabled
 * blending for this pipeline unconditionally, so an animated alpha was a
 * silent no-op. It is live from the moment a material asks for it —
 * `new UnlitMaterial({ color: [1, 0, 0, 0.5], transparent: true })` blends, and
 * so does `material.opacity = 0.5` on a `transparent` material. An *opaque*
 * material still writes its alpha unblended, which is what every scene
 * authored before the flag existed did.
 *
 * ## Color space (§60a)
 *
 * The four components are **plain numbers in the documented range 0…1**, with
 * no color space attached: §60a's working/output space policy, transfer
 * functions, and tone mapping are a later packet, and tagging a space here
 * would pin half of that design by accident. Values outside 0…1 are passed
 * through rather than clamped (decision, WP-3.3) — clamping would silently
 * rewrite authored data, and extended-range colors are exactly what §60a will
 * need to carry — but non-finite components are rejected (§85).
 */

import type { ColorRGBA } from "@four/math";

import { Material, type MaterialOptions } from "./material.js";

/**
 * Straight (non-premultiplied) RGBA, each component nominally in 0…1 —
 * `@four/math`'s {@link ColorRGBA}, re-exported (hoisted 2026-08-04;
 * `@four/animation` tweens the same tuple and §3.1 has no edge between the
 * two packages).
 *
 * A mutable 4-tuple rather than a `Vector4`: a color is not a geometric vector
 * (adding two colors is not a transform, and none of `Vector4`'s dot/normalize
 * surface means anything here), and a plain array uploads to
 * `uniform4fv`/`Float32Array.set` without an adapter.
 */
export type { ColorRGBA } from "@four/math";

/**
 * Construction arguments of {@link UnlitMaterial} — its own colour, plus §57's
 * shared render state from {@link MaterialOptions}.
 */
export interface UnlitMaterialOptions extends MaterialOptions {
  /**
   * Initial color, copied into the material's own array. Defaults to opaque
   * white `[1, 1, 1, 1]`, so an untinted material multiplies to no change.
   */
  color?: readonly [number, number, number, number];
}

/**
 * The prefix this family member's ids carry; the counter behind it is the
 * family-wide one in `material.ts`. `material-<n>` rather than
 * `unlit-material-<n>` because that is the id space this class has minted since
 * WP-3.3 and ids appear in backend cache keys and diagnostics.
 */
const ID_PREFIX = "material";

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
 * A material that shades every fragment with one color, ignoring lights (§57).
 *
 * ```ts
 * const material = new UnlitMaterial({ color: [1, 0.4, 0, 1] });
 * material.setColor(0, 0.6, 1);   // alpha defaults back to opaque
 * material.dispose();             // §83: explicit lifetime
 * ```
 *
 * Materials are **shared, not owned by nodes**: any number of `Renderable`s may
 * point at one, and disposing it is the job of whoever created it (§83).
 */
export class UnlitMaterial extends Material {
  /**
   * Pipeline discriminant (§57, §64), introduced with the §68 lighting packet
   * (2026-08-04): with two surface-material families (`UnlitMaterial`,
   * `LitMaterial`) sharing `Renderable.material`, the render-list builder
   * needs one property load — not an `instanceof`, which a structurally-typed
   * material double could never satisfy — to pick the item's pipeline. A
   * literal string, mirroring `RenderItemKind`; §57's {@link Material} base
   * declares it abstract, and every family member answers it.
   */
  readonly kind = "unlit" as const;

  /**
   * Straight RGBA in 0…1; opaque white by default.
   *
   * The array instance is `readonly` — write *into* it — for the reason
   * `Transform`'s math members are: a backend may keep a reference to it, and
   * replacing the array wholesale would leave that reference pointing at the
   * old color forever. Use {@link UnlitMaterial.setColor}, or write components
   * directly and call {@link Material.markDirty}.
   */
  readonly color: ColorRGBA;

  constructor(options: UnlitMaterialOptions = {}) {
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
   * `this` for chaining, following the math types' mutate-and-return convention
   * (§7b).
   *
   * `alpha` defaults to `1` rather than to the current alpha: the three-argument
   * form reads as "make it this color", and silently inheriting a previous
   * transparency would make the same call mean different things at different
   * times.
   */
  setColor(red: number, green: number, blue: number, alpha = 1): this {
    // Validate every component before the first array write (2026-08-04
    // review fix): writing as we validate left a rejected call's material
    // torn — partially rewritten with no version bump, so backends kept the
    // old color while CPU readers saw the mix. A throw now leaves the color
    // exactly as it was, matching the constructor's atomicity.
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
