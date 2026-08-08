/**
 * `Texture` (§77, §55, §61) — CPU-side texel data with a stable identity and a
 * version, in the one shape the MVP renderer uploads.
 *
 * §77 asks for 2D, cube, array, and 3D textures; mipmaps; wrap, filter, and
 * anisotropy state; colour-space metadata; compressed containers; render-target
 * textures; video textures; canvas and image-bitmap sources; and asynchronous
 * upload with residency diagnostics. This packet implements **one** of those:
 * a 2D, RGBA8, non-mipmapped texture built from a plain byte array, which is
 * what §55's sprite tier and §56's glyph atlas need in order to draw anything at
 * all. The rest are named as deferred on {@link Texture} rather than sketched,
 * because each of them (a sampler-state object, a colour-space tag, a
 * compressed-format enum) is a public shape the §79 scene format and every
 * backend have to agree on.
 *
 * ## Two departures worth stating up front
 *
 * ### 1. No DOM in the source (decision, WP-3a.3)
 *
 * §61 types the renderer's texture entry point as
 * `createTexture(source: TextureSource)` and §77 lists "canvas and image-bitmap
 * sources". {@link TextureSource} here is **structural and DOM-free**: a width,
 * a height, and optional tightly packed RGBA8 bytes. That is deliberate —
 * `@four/render` compiles with no `lib.dom` (see `renderer.ts` on
 * `RendererOptions.canvas`), a glyph atlas rasterized into a byte array is
 * exactly what §56's MVP text tier produces, and a test can build a 2×2
 * checkerboard with no browser at all. `ImageBitmap`/`HTMLImageElement`/video
 * sources are an *adapter* problem, and they land with §76's asset manager,
 * which is the layer that already owns decoding and the main-thread/worker
 * split. When they do, they widen {@link TextureSource} rather than replace it.
 *
 * ### 2. `Renderer.createTexture` stays deferred; backends discover textures
 *
 * §61's interface has `createTexture(source): Texture`, and `renderer.ts`
 * records it as a typed TODO. **This packet does not add it**, and that is a
 * considered decision rather than an omission:
 *
 * - `createTexture` makes the texture a *renderer-owned* object, which means an
 *   application must have a renderer before it can build a texture, must build a
 *   second one for a second renderer, and must re-create all of them by hand
 *   after a §61 context loss. None of that is true of geometries or materials
 *   today, and none of it should be true of textures either.
 * - The backend already solves the same problem for geometry, with a cache keyed
 *   on `id` and validated by `version` (`@four/render-webgl`'s `GeometryCache`).
 *   A texture carries the same two fields for the same reason, so the WebGL
 *   backend discovers textures from the materials in the render list and uploads
 *   them on first use — and a context loss is handled by dropping the cache, not
 *   by asking the application to rebuild anything.
 *
 * The MVP tier therefore reads: **a `Texture` is a CPU-side resource; GPU
 * residency is a backend cache.** §61's `createTexture` stays on the deferred
 * list in `renderer.ts` for the tier that needs renderer-owned textures —
 * render targets (§63) and compressed or GPU-only formats, which have no
 * CPU-side source to discover.
 *
 * ## Ownership (§83)
 *
 * A texture is **shared, not owned by the materials that sample it**: one atlas
 * backs many `SpriteMaterial`s. Whoever created it disposes it, and
 * `SpriteMaterial.dispose()` deliberately does not.
 *
 * Because nothing owns a shared texture, nothing could say how much texture
 * memory the engine held — which is why every texture reports its size
 * ({@link Texture.byteLength}) to the process-wide totals in
 * `resource-memory.ts` at construction, on each source replacement, and on
 * `dispose()` (A-5, 2026-08-07). That accounting is what makes §84's
 * `textureMemory` measurable and a leaked atlas visible; it holds no reference
 * to anything and never runs on a draw path.
 */

import type { Disposable } from "@four/core";
import type { SpriteTexture } from "@four/materials";

import { noteTexture } from "./resource-memory.js";

/**
 * The texel data a {@link Texture} is built from (§61's `TextureSource`, §77).
 *
 * Structural and DOM-free — see the module header for why, and for where
 * `ImageBitmap`-like sources land.
 *
 * ```ts
 * // A 2×2 opaque red/blue checkerboard, bottom row first.
 * const source: TextureSource = {
 *   width: 2,
 *   height: 2,
 *   data: new Uint8Array([
 *     255, 0, 0, 255,   0, 0, 255, 255,
 *     0, 0, 255, 255,   255, 0, 0, 255,
 *   ]),
 * };
 * ```
 */
export interface TextureSource {
  /** Width in texels. A finite integer ≥ 1. */
  readonly width: number;

  /** Height in texels. A finite integer ≥ 1. */
  readonly height: number;

  /**
   * Tightly packed RGBA8 texels — four bytes per texel, exactly
   * `width * height * 4` bytes — or absent for a texture with no CPU-side
   * content (a backend then allocates zero-filled storage of the given size,
   * which samples as transparent black).
   *
   * **Row 0 is `v = 0`**, the bottom row: §7a is Y-up, and GL's default unpack
   * orientation already reads the first row as the bottom one, so the MVP tier
   * needs no flip anywhere. Sources whose first row is the top one — a decoded
   * PNG, an `ImageBitmap` — are flipped by the adapter that produces them
   * (§76), not by the backend.
   *
   * Straight (non-premultiplied) alpha, matching §66's straight-alpha policy
   * for this tier and `UnlitMaterial.color`. Colour-space metadata (§60a: sRGB
   * for colour maps, linear for data maps) is **not** carried yet — tagging a
   * space here would pin half of §60a's design by accident — so the MVP tier
   * samples these bytes as-is.
   */
  readonly data?: Uint8Array;
}

/**
 * Source of texture ids. Monotonic and process-wide, exactly like `Node`'s,
 * `BufferGeometry`'s, and `UnlitMaterial`'s — §33 forbids random or
 * clock-derived identity, and a counter makes two identical construction
 * sequences produce identical ids.
 */
let nextTextureId = 1;

function assignTextureId(): string {
  const id = `texture-${String(nextTextureId)}`;
  nextTextureId += 1;
  return id;
}

/** The source a disposed texture is left holding. */
const EMPTY_SOURCE: TextureSource = Object.freeze({ width: 1, height: 1 });

/** Runs the §85 checks for one source. Throws on the first violation. */
function validate(source: TextureSource): void {
  for (const axis of ["width", "height"] as const) {
    const value = source[axis];
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(
        `Texture ${axis} must be a finite integer of at least 1; got ` +
          `${String(value)} (§85).`,
      );
    }
  }

  const data = source.data;
  if (data === undefined) {
    return;
  }
  const expected = source.width * source.height * 4;
  if (data.length !== expected) {
    throw new RangeError(
      `A ${String(source.width)}×${String(source.height)} RGBA8 texture needs ` +
        `${String(expected)} bytes; got ${String(data.length)} ` +
        "(§77: four bytes per texel, tightly packed).",
    );
  }
}

/**
 * A 2D RGBA8 texture (§77) — texel data, an identity, and a version.
 *
 * ```ts
 * const texture = new Texture({ width: 2, height: 2, data: bytes });
 * texture.data![0] = 255;   // in-place edit — invisible to the texture
 * texture.markDirty();      // announce it: version += 1, backends re-upload
 * texture.dispose();        // §83: explicit lifetime
 * ```
 *
 * ## Version, not events
 *
 * Backends cache GPU uploads per texture, keyed on {@link Texture.id} and
 * validated by {@link Texture.version} — the identical contract
 * `BufferGeometry` offers, and for the identical reason: a renderer that draws
 * a texture every frame compares a number, whereas a change event would cost a
 * subscription per texture per backend for no extra information. Assigning a new
 * {@link Texture.source} validates and bumps the version for you; editing the
 * byte array in place is the fast path and must be announced with
 * {@link Texture.markDirty}.
 *
 * ## Deferred from §77 (named, not dropped)
 *
 * Cube/array/3D targets, mipmaps and their generation, wrap and filter modes
 * (the MVP samples `LINEAR` with `CLAMP_TO_EDGE` — see
 * `@four/render-webgl`'s `TextureCache`), anisotropy, colour-space metadata
 * (§60a), compressed containers, render-target textures (§63), video textures,
 * and asynchronous upload with residency diagnostics (§84). Every one of them
 * adds public state that a backend, the §79 scene format, and §76's asset
 * manager all have to agree on.
 */
export class Texture implements Disposable, SpriteTexture {
  /**
   * Stable identity (§77, §83), assigned at construction from a monotonic
   * counter and formatted `texture-<n>`. Unique within a process, ascending in
   * construction order, never reused.
   */
  readonly id: string = assignTextureId();

  #source: TextureSource;

  #version = 0;

  #disposed = false;

  constructor(source: TextureSource) {
    validate(source);
    this.#source = source;
    noteTexture(1, this.byteLength);
  }

  /**
   * The texel data this texture holds.
   *
   * The source object and its `data` array are held **by reference**, not
   * copied: a rasterizer that produced the bytes hands over ownership, and a
   * backend uploads straight out of them. Assigning a new source validates it
   * (§85) and bumps {@link Texture.version}; editing the existing array in place
   * is legal and cheap, but invisible here — call {@link Texture.markDirty}.
   */
  get source(): TextureSource {
    return this.#source;
  }

  set source(value: TextureSource) {
    validate(value);
    const before = this.byteLength;
    this.#source = value;
    noteTexture(0, this.byteLength - before);
    this.markDirty();
  }

  /** Width in texels. */
  get width(): number {
    return this.#source.width;
  }

  /** Height in texels. */
  get height(): number {
    return this.#source.height;
  }

  /**
   * The RGBA8 bytes, or `null` when the source carries none.
   *
   * A flat accessor rather than `source.data` because it is the field a backend
   * reads on the upload path, and because `SpriteMaterial`'s `SpriteTexture`
   * contract — the seam through which a backend actually sees a texture — is
   * expressed in terms of it. `null` rather than `undefined` for the same
   * reason: the contract is "there is no data", and a backend narrows it with
   * one comparison.
   */
  get data(): Uint8Array | null {
    return this.#source.data ?? null;
  }

  /**
   * Counter incremented on every mutation (§77). Backends cache GPU uploads
   * against it; treat it as opaque and compare for inequality, exactly like
   * `Transform.version`. Monotonic, never wraps in a realistic session.
   */
  get version(): number {
    return this.#version;
  }

  /** Whether {@link Texture.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Bytes this texture describes (§83, §84's `textureMemory`) — four per texel
   * at the current size, which is what an RGBA8 upload costs.
   *
   * ```ts
   * new Texture({ width: 256, height: 256 }).byteLength; // 262144
   * ```
   *
   * Counted from the **size**, not from `data`: a source with no CPU-side bytes
   * still makes the backend allocate zero-filled storage of exactly this size
   * (see {@link TextureSource.data}), so billing it zero would under-report the
   * memory the engine holds. Mip levels are not counted because this tier
   * generates none (§77, module header).
   *
   * **`0` once disposed**, because a disposed texture holds nothing — one rule,
   * so that a write into a disposed texture (already a §83 "disposed resource
   * still in use" mistake) cannot resurrect its bytes in the process-wide
   * totals.
   */
  get byteLength(): number {
    if (this.#disposed) {
      return 0;
    }
    return this.#source.width * this.#source.height * 4;
  }

  /**
   * Announces a mutation the texture could not see — an in-place write into
   * `source.data`. Bumps {@link Texture.version} by one, which invalidates every
   * backend upload keyed on it.
   *
   * Calling it after assigning {@link Texture.source} is harmless, only
   * wasteful: the version advances again and the texture re-uploads once more.
   */
  markDirty(): void {
    this.#version += 1;
  }

  /**
   * Releases this texture's CPU-side data (§83). Idempotent.
   *
   * The byte array is dropped — a 2048² atlas is 16 MB, and its owner should be
   * able to reclaim that the moment nothing needs it — and the version is bumped
   * so any backend cache keyed on it re-reads. A backend that then meets this
   * texture in a render list **skips the draw**: {@link Texture.disposed} is the
   * flag the §83 "disposed resource still in use" diagnostic checks, and drawing
   * a sprite with no texels would paint undefined content rather than report the
   * mistake.
   *
   * Disposing does **not** notify the materials pointing at this texture;
   * ownership is explicit and upwards (§83), so whoever created the texture
   * decides when nothing needs it any more.
   *
   * It **does** remove this texture and its bytes from the process-wide §83
   * totals (`textureMemoryBytes`, `liveTextureCount`), exactly once: the
   * idempotence guard above is what makes a double `dispose()` subtract once
   * rather than twice.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    const before = this.byteLength;
    this.#disposed = true;
    this.#source = EMPTY_SOURCE;
    noteTexture(-1, -before);
    this.markDirty();
  }
}
