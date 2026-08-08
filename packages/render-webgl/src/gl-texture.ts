/**
 * GPU-side textures for the WebGL 2 backend: one `WebGLTexture` per
 * `@four/render` `Texture`, cached and invalidated by version (§77, §61, §55).
 *
 * The twin of `gl-geometry.ts`, and deliberately so — same key (`id`), same
 * validator (`version`), same lazy eviction, same loss-aware
 * {@link TextureCache.forget}. Reading one module tells you how the other
 * behaves, and both back the same claim: **GPU residency is a backend cache, not
 * an application concern.**
 *
 * ## Why there is no `Renderer.createTexture` (decision, WP-3a.3)
 *
 * §61's interface declares `createTexture(source: TextureSource): Texture`, and
 * `@four/render`'s `renderer.ts` records it as a typed TODO. This packet leaves
 * it deferred and discovers textures from the render list instead: every sprite
 * item carries a `SpriteMaterial`, every sprite material names a texture, and
 * this cache uploads it the first time it is drawn.
 *
 * The alternative — a renderer-owned texture — would mean an application cannot
 * build a texture before it has a renderer, must build one per renderer, and
 * must re-create all of them by hand after a §61 context loss. None of that is
 * true of geometry today, and the geometry cache is the proof that it need not
 * be true of textures either. `createTexture` remains the right entry point for
 * the tier that has no CPU-side source to discover — render targets (§63),
 * compressed and GPU-only formats — and it lands with that tier. The deferral is
 * documented in `@four/render`'s `texture.ts` as well, on the class it concerns.
 *
 * ## What one entry holds
 *
 * A texture object and the version it was uploaded from. Sampler state — filter
 * and wrap — is set on the texture object at upload time and never changed, so
 * the per-draw cost in `webgl-renderer.ts` is one `bindTexture` and nothing
 * else. §77's mipmaps, anisotropy, and configurable wrap/filter modes are
 * deferred with the state that would carry them; the fixed choice is
 * **`LINEAR` filtering with `CLAMP_TO_EDGE` wrapping**, which is the only
 * combination that is correct for a sprite or a glyph atlas without mip levels
 * and without bleeding neighbouring texels across a frame boundary.
 *
 * ## Eviction policy
 *
 * Identical to `GeometryCache`'s, for the identical reasons — see that module's
 * header for the full argument:
 *
 * - a **version bump** (an in-place texel edit plus `markDirty()`, or a new
 *   `source`) is detected on the next `acquire`, which deletes the stale texture
 *   and uploads a fresh one;
 * - **`texture.dispose()`** bumps the version and marks the texture disposed, so
 *   the next `acquire` deletes the GL object and returns `null` — the sprite is
 *   then skipped rather than drawn with undefined content (§83's "disposed
 *   resources still in use"). A texture disposed and never submitted again keeps
 *   its GL object until the renderer is disposed: the same documented leak
 *   window, with the same alternatives rejected for the same reasons;
 * - **context loss** is not eviction: {@link TextureCache.forget} drops the
 *   records without calling `deleteTexture`, because every handle is already
 *   invalid and the context must not be touched (§61).
 */

import type { SpriteRenderItem } from "@four/render";

import { GL, type GlTexture, type WebglContext } from "./gl-program.js";

/**
 * The texture type this cache stores, taken from `@four/render`'s sprite render
 * item rather than imported by name.
 *
 * `@four/render-webgl`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen), so `@four/render`'s `Texture` *could* be imported directly.
 * Deriving it from `SpriteRenderItem["material"]["texture"]` instead is the
 * choice `CacheableGeometry` already makes in `gl-geometry.ts`: it types the
 * cache against **what the render list actually hands it**, which is
 * `@four/materials`' `SpriteTexture` read contract — so this module keeps
 * working unchanged if a second texture implementation ever satisfies that
 * contract, and it cannot accidentally reach for state a render item does not
 * carry.
 */
export type CacheableTexture = SpriteRenderItem["material"]["texture"];

/** Everything one cached texture needs at draw time. */
export interface TextureRecord {
  /** The GL texture object to bind. */
  readonly texture: GlTexture;

  /** `Texture.version` this record was uploaded from. */
  readonly version: number;
}

/**
 * Per-context store of uploaded textures (§77, §61).
 *
 * One cache belongs to one GL context: the renderer builds it during
 * `initialize` and builds a *new* one on context restore, since every handle the
 * old one held died with the context.
 *
 * ```ts
 * const cache = new TextureCache(gl);
 * const record = cache.acquire(item.material.texture);
 * if (record !== null) {
 *   gl.bindTexture(GL.TEXTURE_2D, record.texture);
 *   // draw…
 * }
 * ```
 */
export class TextureCache {
  readonly #gl: WebglContext;

  /** Records by `Texture.id`; see the module header for eviction. */
  readonly #records = new Map<string, TextureRecord>();

  #disposed = false;

  constructor(gl: WebglContext) {
    this.#gl = gl;
  }

  /** Number of textures currently uploaded. Diagnostics and tests (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link TextureCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the GL texture for `texture`, uploading it on first use and
   * re-uploading it whenever `texture.version` has advanced.
   *
   * Returns `null` — and creates no entry — when the texture has been disposed
   * or when GL refuses to allocate an object. **Never throws**: this runs inside
   * `Renderer.render`, and §61 forbids throwing there for a lost context; a
   * failed allocation is the same class of asynchronous, driver-scheduled event,
   * so it skips the object rather than unwinding the frame.
   */
  acquire(texture: CacheableTexture): TextureRecord | null {
    const existing = this.#records.get(texture.id);
    if (existing !== undefined) {
      if (existing.version === texture.version) {
        return existing;
      }
      this.#gl.deleteTexture(existing.texture);
      this.#records.delete(texture.id);
    }

    if (texture.disposed) {
      return null;
    }

    const record = this.#upload(texture);
    if (record === null) {
      return null;
    }
    this.#records.set(texture.id, record);
    return record;
  }

  /**
   * Drops every record **without touching the context** — the context-loss path
   * (§61). The handles are already invalid; calling `deleteTexture` on them
   * would be a GL call against a lost context for no benefit.
   */
  forget(): void {
    this.#records.clear();
  }

  /**
   * Deletes every texture this cache created (§83). Idempotent.
   *
   * Only valid on a live context — the renderer calls
   * {@link TextureCache.forget} instead when the context is lost. The
   * *application's* `Texture` objects are untouched: the renderer did not create
   * them, so it does not dispose them.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#gl.deleteTexture(record.texture);
    }
    this.#records.clear();
  }

  /**
   * Uploads `texture` into a fresh GL texture object, or returns `null` if GL
   * would not allocate one.
   *
   * `data === null` uploads `null` pixels, which allocates zero-filled storage
   * of the requested size (WebGL initializes it): the sampler stays valid and
   * the sprite draws as transparent black, which is a defined outcome rather
   * than the undefined content an unallocated texture would sample.
   *
   * The binding is cleared afterwards so an upload triggered mid-frame cannot
   * leave a texture other than the one being drawn bound to unit 0.
   *
   * ## Colour space (§60a, R-15, 2026-08-08)
   *
   * A texture tagged `colorSpace: "srgb"` is allocated `SRGB8_ALPHA8` instead of
   * `RGBA8`, so the GPU decodes every sample to linear-light before filtering
   * and before the fragment stage sees it — which is what makes §60a's
   * "lighting and blending run in linear space" true for a textured surface and
   * not only for an untextured one. The tag is read defensively
   * (`?? "linear"`): `MaterialTexture.colorSpace` is optional, so every texture
   * written before the field existed, and every test double, keeps uploading
   * `RGBA8` and issuing the byte-identical call it always did.
   */
  #upload(texture: CacheableTexture): TextureRecord | null {
    const gl = this.#gl;
    const handle = gl.createTexture();
    if (handle === null) {
      return null;
    }

    gl.bindTexture(GL.TEXTURE_2D, handle);
    gl.texImage2D(
      GL.TEXTURE_2D,
      0,
      (texture.colorSpace ?? "linear") === "srgb" ? GL.SRGB8_ALPHA8 : GL.RGBA8,
      texture.width,
      texture.height,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      texture.data,
    );
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
    gl.bindTexture(GL.TEXTURE_2D, null);

    return { texture: handle, version: texture.version };
  }
}
