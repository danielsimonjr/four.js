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
 * else. §77's mipmaps and anisotropy are deferred with the state that would
 * carry them.
 *
 * ## Filter and wrap became the texture's own (R-30, 2026-08-13)
 *
 * This module fixed the pair at **`LINEAR` + `CLAMP_TO_EDGE`** until
 * 2026-08-13, and the note that stood here called that "the only combination
 * that is correct for a sprite or a glyph atlas". It is the right *default* and
 * it is not the only correct choice: a bitmap glyph atlas drawn at or above 1:1
 * wants `NEAREST`, because a 5 × 7 letterform blurred across its neighbours is
 * exactly the soft, dirty look bitmap text is accused of, and a tiling ground
 * texture wants `REPEAT`. So the four `texParameteri` arguments are now read off
 * `texture.filter` / `texture.wrap` (§77, `@four/render`'s `Texture`).
 *
 * **Byte-identity is structural, not numerical**: both fields resolve to the
 * previously hard-coded value when a source names neither, so a texture written
 * against any earlier build issues the same four calls with the same four
 * arguments in the same order. Nothing was added to the draw path — sampler
 * state is upload-time state, and the upload path is the one that grew two
 * table lookups.
 *
 * Because the state is written **at upload**, changing `filter` or `wrap` on a
 * texture already resident needs a version bump (`markDirty()`, or a new
 * `source`); the eviction rule below then re-uploads it with the new sampler
 * state, which is the same path an in-place texel edit takes.
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

/**
 * `texture.filter` (§77, R-30) as a GL enum.
 *
 * A function of one comparison rather than a `Record` lookup, for the reason
 * §33 gives everywhere in this backend: no object-key iteration, no `Map`, and
 * an unknown value cannot reach here — `Texture` refuses one (§85) — so the
 * fallback arm is the *default*, which is the value this tier hard-coded before
 * the field existed.
 */
function glFilter(filter: string | undefined): number {
  return filter === "nearest" ? GL.NEAREST : GL.LINEAR;
}

/** `texture.wrap` (§77, R-30) as a GL enum; see {@link glFilter}. */
function glWrap(wrap: string | undefined): number {
  if (wrap === "repeat") return GL.REPEAT;
  if (wrap === "mirrored-repeat") return GL.MIRRORED_REPEAT;
  return GL.CLAMP_TO_EDGE;
}

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
    // R-30: the arguments are the texture's own, defaulting to the pair this
    // module hard-coded before 2026-08-13 — the same four calls in the same
    // order with the same enums for every texture that names neither.
    const filter = glFilter(texture.filter);
    const wrap = glWrap(texture.wrap);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, wrap);
    gl.bindTexture(GL.TEXTURE_2D, null);

    return { texture: handle, version: texture.version };
  }
}
