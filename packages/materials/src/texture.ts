/**
 * The read surface of a texture as a **material** and a rendering backend see
 * it (§77) — implemented by `@four/render`'s `Texture`.
 *
 * ## Why the contract is declared here (decision, WP-3a.3, widened by R-19)
 *
 * The concrete `Texture` class lives in `@four/render`, because a texture is a
 * renderer resource (§61, §77) and `@four/render` is where the renderer
 * interface lives. But the dependency matrix (plan §3.1, frozen) puts
 * `materials` *below* `render` — `render` depends on `materials`, never the
 * other way round — so this package cannot import that class.
 *
 * So the **contract** is declared here and `@four/render`'s `Texture` declares
 * `implements SpriteTexture`: the compiler checks the two agree, the dependency
 * edge stays pointing the one legal way, and a caller writes
 * `new SpriteMaterial({ texture })` or `new UnlitMaterial({ map })` with a real
 * `Texture` and never sees the seam. It is the same technique
 * `@four/render-webgl` uses for the GL context it does not own, one layer down.
 *
 * It lives in a module of its own since R-19 (2026-08-07), when
 * `UnlitMaterial.map` and `LitMaterial.map` made it the *family's* texture
 * contract rather than the sprite's: it was declared in `sprite-material.ts`
 * while sprites were the only textured pipeline, and `SpriteTexture` remains
 * exported from there, as an alias, because it is a published name.
 *
 * {@link MaterialTexture} describes the texture's whole **read** surface, not
 * only the parts a material touches: a backend reaches the texture *through*
 * the material (`item.material.map`), so anything the upload path needs — the
 * texel data above all — has to be visible here.
 *
 * ## Ownership (§83)
 *
 * A material **points at** its texture; it does not own it. One texture atlas
 * routinely backs hundreds of materials, so `Material.dispose()` deliberately
 * does *not* dispose the texture: whoever created the texture disposes it.
 * Tearing it out from under its other users is exactly the bug the ownership
 * rule exists to prevent. This is the same rule `Renderable` follows for its
 * geometry and material.
 */

import type { ColorSpace } from "@four/math";

/**
 * The read surface of a texture, as a material and a rendering backend see it
 * (§77) — see the module header for why it is declared in this package rather
 * than imported from the package that owns the class.
 *
 * Everything is `readonly`: a material and a backend observe a texture, they
 * never edit one. Mutation goes through the concrete class, which is what
 * advances {@link MaterialTexture.version}.
 */
export interface MaterialTexture {
  /**
   * Stable identity (§83's resource model). Backends key their upload caches on
   * it and validate the entry with {@link MaterialTexture.version}, exactly as
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

  /**
   * The colour space the texels are in — §60a's texture metadata, read by the
   * backend on the upload path (R-15, 2026-08-08).
   *
   * **Optional, and absent means `"linear"`.** §60a says colour textures
   * *default* to sRGB-encoded; this tier defaults them to linear instead, and
   * the deviation is deliberate and dated: flipping the default would change
   * what every already-authored texture in the engine looks like — every pixel
   * golden with it — for scenes that never asked for colour management. An
   * author who has sRGB-encoded texels (a decoded PNG, an authored albedo map)
   * says so with `colorSpace: "srgb"` and the backend decodes on sample; the
   * §60a-conformant default is an owner decision, recorded with R-15.
   *
   * Optional rather than required so that a test double, a procedurally
   * generated atlas, and every texture written before this field existed keep
   * satisfying the contract without a line of change. Read it as
   * `texture.colorSpace ?? "linear"`.
   */
  readonly colorSpace?: ColorSpace;
}
