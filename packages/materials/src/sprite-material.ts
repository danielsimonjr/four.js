/**
 * `SpriteMaterial` (§55, §57) — one texture, one tint.
 *
 * §55 requires sprites to carry a texture plus "tint and opacity", and §57
 * lists `SpriteMaterial` as a member of the `Material` family. This packet
 * implements the MVP-tier member: the texture that is sampled, and a straight
 * (non-premultiplied) RGBA tint the sample is multiplied by. Everything else
 * §55 asks for — frame regions and atlases, nine-slice, billboarding,
 * per-instance data, alpha masks, sprite animation clips — belongs to the
 * packets that can draw them, and is listed as deferred on {@link SpriteMaterial}
 * rather than sketched here.
 *
 * As with `UnlitMaterial`, §57's abstract `Material` base was **not** introduced
 * by this packet: every field of it (`opacity`, `transparent`, `blendMode`,
 * `depthTest`, `depthWrite`, `colorWrite`, `stencil`) is render state whose
 * meaning is fixed by the backend packet that translates it into GL calls, and a
 * base class with two subclasses that share nothing but an id and a version
 * constrains nothing.
 *
 * **The base landed on 2026-08-06** (`material.ts`), the backend that gives its
 * fields meaning having shipped in between, and this class extends it: the id
 * spaces merged onto one counter exactly as predicted (see
 * {@link SpriteMaterial.id}), and `version`, `markDirty`, `dispose`, and §57's
 * six render-state fields now live on {@link Material}. This class also gained
 * the {@link SpriteMaterial.kind} discriminant its two siblings already had,
 * now that it shares a base — and therefore a `Renderable.material` slot —
 * with them.
 *
 * ## Why the texture type is declared here (decision, WP-3a.3)
 *
 * The concrete `Texture` class lives in `@four/render`, because a texture is a
 * renderer resource (§61, §77) and `@four/render` is where the renderer
 * interface lives. But the dependency matrix (plan §3.1, frozen) puts
 * `materials` *below* `render` — `render` depends on `materials`, never the
 * other way round — so this package cannot import that class.
 *
 * So the **contract** is declared here, as {@link SpriteTexture}, and
 * `@four/render`'s `Texture` declares `implements SpriteTexture`: the compiler
 * checks the two agree, the dependency edge stays pointing the one legal way,
 * and a caller writes `new SpriteMaterial({ texture })` with a real `Texture`
 * and never sees the seam. It is the same technique `@four/render-webgl` uses
 * for the GL context it does not own, one layer down.
 *
 * {@link SpriteTexture} therefore describes the texture's whole **read**
 * surface, not only the parts a material touches: a backend reaches the texture
 * *through* the material (`item.material.texture`), so anything the upload path
 * needs — the texel data above all — has to be visible here.
 *
 * ## Ownership (§83)
 *
 * A material **points at** its texture; it does not own it. One texture atlas
 * routinely backs hundreds of materials, so {@link Material.dispose} — which
 * this class inherits unchanged — deliberately does *not* dispose the texture:
 * whoever created the texture disposes it. Tearing it out from under its other
 * users is exactly the bug the ownership rule exists to prevent. This is the
 * same rule `Renderable` follows for its geometry and material.
 */

import { Material, type MaterialOptions } from "./material.js";
import type { ColorRGBA } from "./unlit-material.js";

/**
 * The read surface of a texture, as a sprite material and a rendering backend
 * see it (§77) — implemented by `@four/render`'s `Texture`.
 *
 * See the module header for why this interface is declared in this package
 * rather than imported from the package that owns the class.
 *
 * Everything is `readonly`: a material and a backend observe a texture, they
 * never edit one. Mutation goes through the concrete class, which is what
 * advances {@link SpriteTexture.version}.
 */
export interface SpriteTexture {
  /**
   * Stable identity (§83's resource model). Backends key their upload caches on
   * it and validate the entry with {@link SpriteTexture.version}, exactly as
   * they do for `BufferGeometry`.
   */
  readonly id: string;

  /** Counter advanced by every mutation; the cache-invalidation key (§53, §77). */
  readonly version: number;

  /** Width in texels. */
  readonly width: number;

  /** Height in texels. */
  readonly height: number;

  /**
   * Tightly packed RGBA8 texels — four bytes per texel, `width * height * 4`
   * bytes — or `null` when the texture carries no CPU-side data.
   *
   * **Row 0 is `v = 0`**, i.e. the bottom row in the Y-up convention of §7a and
   * in GL's default unpack orientation. A source whose first row is the *top*
   * one (an `ImageBitmap`, a decoded PNG) is flipped by whoever adapts it, not
   * here — see `@four/render`'s `TextureSource` for the note on where those
   * sources land.
   */
  readonly data: Uint8Array | null;

  /** Whether the texture has been disposed (§83). */
  readonly disposed: boolean;
}

/**
 * Construction arguments of {@link SpriteMaterial} — its texture and tint, plus
 * §57's shared render state from {@link MaterialOptions}.
 */
export interface SpriteMaterialOptions extends MaterialOptions {
  /**
   * The texture to sample. Required: a sprite material without one draws
   * nothing, and defaulting it would hide the mistake behind an invisible
   * sprite instead of a type error.
   */
  texture: SpriteTexture;

  /**
   * Initial tint, copied into the material's own array. Defaults to opaque
   * white `[1, 1, 1, 1]`, which multiplies the sampled texel to no change.
   */
  tint?: readonly [number, number, number, number];
}

/**
 * The prefix this family member's ids carry.
 *
 * It used to front a **separate** counter from `UnlitMaterial`'s, because §57's
 * `Material` base — which is what owns one id space for the whole family — was
 * not WP-3a.3's to introduce. The base landed 2026-08-06 and the counter behind
 * this prefix is now the family-wide one in `material.ts`; the prefix stays,
 * because two members sharing the `material-` prefix would mint colliding ids,
 * which is precisely what a cache key must never do (decision, WP-3a.3).
 */
const ID_PREFIX = "sprite-material";

/** Rejects non-finite tint components (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Tint component ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * A material that samples one texture and multiplies it by a tint (§55, §57).
 *
 * ```ts
 * const material = new SpriteMaterial({ texture, tint: [1, 0.8, 0.8, 1] });
 * material.setTint(1, 1, 1, 0.5);   // half-transparent, version += 1
 * material.dispose();               // §83 — the texture is *not* disposed
 * ```
 *
 * The fragment colour a backend produces is `texture(map, uv) * tint`, with
 * **straight (non-premultiplied) alpha** on both sides: §66 lists premultiplied
 * and straight alpha policies as a requirement and the MVP tier commits to
 * straight, matching `UnlitMaterial.color` and `Viewport.clearColor`. The
 * premultiplied path arrives with §66's blend-mode state.
 *
 * ## Deferred from §55 (named, not dropped)
 *
 * `frame`/atlas regions, nine-slice scaling, billboarding modes, per-instance
 * data, alpha masks, normal-mapped sprites, and sprite animation clips. Each
 * needs either a second texture binding, a second uniform block, or a batching
 * path, and each belongs to the packet that adds it. `sizeMode` (`"pixels"` vs
 * `"world"`) lives on `Sprite`, not here, and is likewise world-only in the MVP.
 *
 * ## Version, not events
 *
 * Backends cache uniform uploads and texture bindings against
 * {@link Material.version}, the same contract `UnlitMaterial`,
 * `BufferGeometry`, and `Transform` offer. {@link SpriteMaterial.setTint} and
 * the {@link SpriteMaterial.texture} setter bump it; writing into the tint array
 * in place does not, and must be announced with {@link Material.markDirty}.
 *
 * ## Blending (§66)
 *
 * The sprite pipeline blends **by construction** — it did before §57's
 * `transparent` flag existed and it still does, so a textured quad with an
 * alpha channel composites whether or not the material declares itself
 * transparent. What {@link Material.transparent} decides for a sprite is
 * therefore only its place in §66's sort key 2, and
 * {@link Material.blendMode} — honoured here whatever `transparent` says —
 * decides how it composites: `"additive"` gives the usual glow sprite.
 *
 * Materials are **shared, not owned by nodes** (§83): any number of sprites may
 * point at one, and disposing it is the job of whoever created it.
 */
export class SpriteMaterial extends Material {
  /**
   * Pipeline discriminant (§57, §64) — see `UnlitMaterial.kind`. Added
   * 2026-08-06, when this class joined the {@link Material} base and with it
   * the discriminated union a `Renderable`'s material is dispatched through.
   */
  readonly kind = "sprite" as const;

  /**
   * Straight RGBA in 0…1 multiplied into the sampled texel; opaque white by
   * default.
   *
   * The array instance is `readonly` — write *into* it — because a backend may
   * hold a reference to it, and replacing the array wholesale would leave that
   * reference pointing at the old tint forever. Use
   * {@link SpriteMaterial.setTint}, or write components directly and call
   * {@link Material.markDirty}.
   *
   * Values outside 0…1 are passed through rather than clamped, matching
   * `UnlitMaterial.color`: clamping would silently rewrite authored data, and
   * §60a's extended-range colours are exactly what this array will carry.
   * Non-finite components are rejected (§85).
   */
  readonly tint: ColorRGBA;

  #texture: SpriteTexture;

  constructor(options: SpriteMaterialOptions) {
    super(ID_PREFIX, options);
    this.#texture = options.texture;
    const tint = options.tint ?? [1, 1, 1, 1];
    this.tint = [
      requireFinite("red", tint[0]),
      requireFinite("green", tint[1]),
      requireFinite("blue", tint[2]),
      requireFinite("alpha", tint[3]),
    ];
  }

  /**
   * The texture this material samples (§77). Assigning a different one bumps
   * {@link Material.version}, which is what makes a backend re-bind.
   *
   * The version this bumps does **not** follow the texture's own: a texture
   * whose texels change bumps *its* version, and a backend validates its
   * texture upload against that one. Folding the two together would force a
   * material to subscribe to its texture, which is the subscription §53
   * rejected in favour of version counters in the first place.
   *
   * The **old texture is not disposed** — it may still back other materials
   * (§83). Nor is the new one adopted: this material points at it and nothing
   * more.
   */
  get texture(): SpriteTexture {
    return this.#texture;
  }

  set texture(value: SpriteTexture) {
    this.#texture = value;
    this.markDirty();
  }

  /**
   * Writes the tint and bumps {@link Material.version} once. Returns
   * `this` for chaining (§7b's mutate-and-return convention).
   *
   * `alpha` defaults to `1` rather than to the current alpha, for the reason
   * `UnlitMaterial.setColor`'s does: the three-argument form reads as "tint it
   * this colour", and silently inheriting a previous transparency would make
   * the same call mean different things at different times.
   */
  setTint(red: number, green: number, blue: number, alpha = 1): this {
    // Validate before the first write — see UnlitMaterial.setColor (the
    // 2026-08-04 torn-state review fix, applied to all three materials).
    const validRed = requireFinite("red", red);
    const validGreen = requireFinite("green", green);
    const validBlue = requireFinite("blue", blue);
    const validAlpha = requireFinite("alpha", alpha);
    this.tint[0] = validRed;
    this.tint[1] = validGreen;
    this.tint[2] = validBlue;
    this.tint[3] = validAlpha;
    this.markDirty();
    return this;
  }
}
