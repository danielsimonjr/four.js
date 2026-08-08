/**
 * `UnlitMaterial` (§57) — a flat RGBA color, optionally multiplied by a texture
 * and by the geometry's own per-vertex colors.
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
 * ## Colour space (§60a)
 *
 * **Superseded 2026-08-08 by R-15.** This block used to say "no color space
 * attached: §60a's working/output space policy, transfer functions, and tone
 * mapping are a later packet, and tagging a space here would pin half of that
 * design by accident". The policy has landed and it pins this: these four
 * components are **linear-light**, the working space §60a makes the GPU
 * pipeline run in. The numbers did not move — an unlit draw multiplied them
 * unchanged before and multiplies them unchanged now — but they are named
 * rather than untagged, and the transfer functions that convert *into* this
 * space ship in `@four/math` (`srgbToLinearRGBA`, `parseColor`; see that
 * package's `color.ts` header for the policy in full).
 *
 * There is still no colour-space **field** here, and that is now a decision
 * rather than a deferral: §60a puts its metadata on resources — textures (§77)
 * and render targets (§63) — and a material colour is working-space by
 * definition, so a tag would have one legal value.
 *
 * Values outside 0…1 are still passed through rather than clamped (decision,
 * WP-3.3) — clamping would silently rewrite authored data, and extended-range
 * colours are exactly what §60a carries — but non-finite components are
 * rejected (§85). The encode on the way out is §60a's *final render-graph pass*
 * (`@four/render`'s `OutputTransformEffect`), never a step in this material.
 *
 * ## Texture and vertex colors (R-19, 2026-08-07)
 *
 * Until R-19 a mesh in this engine could not be textured at all: only `Sprite`
 * sampled a texture, and it derived its uv from vertex position because §53
 * carried no uv attribute. Both halves landed together —
 * `BufferGeometry.uvs`/`colors` (§53) and the two multipliers below:
 *
 * ```text
 * fragment = color × (map ? texture(map, uv) : 1) × (vertexColors ? vColor : 1)
 * ```
 *
 * Both are **off by default and cost nothing when off**: the backend leaves the
 * shader's two feature uniforms at GL's `0` and issues no extra call, so a
 * scene that names neither draws the byte-identical GL sequence it drew before
 * either existed (see `@four/render-webgl`). That property is what let this
 * land under the pixel-golden gate, and it is why the fields are a uniform
 * switch rather than a second material family.
 */

import type { ColorRGBA } from "@four/math";

import { Material, type MaterialOptions } from "./material.js";
import type { MaterialTexture } from "./texture.js";

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

  /**
   * Initial {@link UnlitMaterial.map} — the texture sampled with the geometry's
   * `uvs` (§53, §55, §77). Defaults to `null`: no texture, and no cost.
   */
  map?: MaterialTexture | null;

  /**
   * Initial {@link UnlitMaterial.vertexColors}; defaults to `false`.
   */
  vertexColors?: boolean;
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

  #map: MaterialTexture | null;

  #vertexColors: boolean;

  constructor(options: UnlitMaterialOptions = {}) {
    super(ID_PREFIX, options);
    const color = options.color ?? [1, 1, 1, 1];
    this.color = [
      requireFinite("red", color[0]),
      requireFinite("green", color[1]),
      requireFinite("blue", color[2]),
      requireFinite("alpha", color[3]),
    ];
    this.#map = options.map ?? null;
    this.#vertexColors = options.vertexColors ?? false;
  }

  /**
   * The texture this material samples with the geometry's `uvs`, or `null` for
   * an untextured surface (§53, §55, §77).
   *
   * ```ts
   * const material = new UnlitMaterial({ map: texture });
   * const mesh = new Renderable(boxGeometry(), material);   // a textured box
   * ```
   *
   * The sampled texel **multiplies** the material's `color`, so the default
   * white leaves the texture untinted and a coloured material tints it. Both
   * sides are straight (non-premultiplied) alpha, matching §66's policy for
   * this tier and `SpriteMaterial`'s identical rule.
   *
   * Assigning bumps {@link Material.version}, which is what makes a backend
   * re-bind; the version this bumps does **not** follow the texture's own (see
   * `SpriteMaterial.texture` for why the two counters stay separate). The
   * **old texture is not disposed** — it may still back other materials (§83) —
   * nor is the new one adopted.
   *
   * A geometry with no `uvs` samples the texel at `(0, 0)` for every fragment,
   * because GL's constant attribute default is `(0, 0, 0, 1)`. That is a
   * legible mistake (a flat-coloured surface) rather than a crash, and it is
   * the reason every §53 primitive builder emits uvs.
   */
  get map(): MaterialTexture | null {
    return this.#map;
  }

  set map(value: MaterialTexture | null) {
    this.#map = value;
    this.markDirty();
  }

  /**
   * Whether to multiply by the geometry's per-vertex `colors` attribute (§53,
   * §60a). `false` by default: a geometry may carry colors and still draw
   * flat, so a mesh does not change appearance the day someone adds the
   * attribute to it.
   *
   * ```ts
   * // §113's debug-draw overlay: one segment list, one draw, per-segment colour.
   * const geometry = new BufferGeometry({ positions, colors, mode: "lines" });
   * const material = new UnlitMaterial({ vertexColors: true });
   * ```
   *
   * This is the flag that makes §84/§113's debug overlays drawable at all
   * (R-35): a `GL.LINES` geometry carries one colour per endpoint, so contact
   * normals, joint frames, and force vectors are a single draw call instead of
   * one per differently-coloured segment.
   *
   * A `vertexColors` material drawing a geometry with **no** `colors` attribute
   * multiplies by GL's constant default `(0, 0, 0, 1)` and renders black. That
   * is deliberate: it is visible, and the alternative — silently ignoring the
   * flag — hides the missing attribute.
   *
   * Assigning bumps {@link Material.version}: the backend switches shader
   * feature state on it.
   */
  get vertexColors(): boolean {
    return this.#vertexColors;
  }

  set vertexColors(value: boolean) {
    this.#vertexColors = value;
    this.markDirty();
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
