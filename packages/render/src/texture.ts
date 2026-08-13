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
 * all — plus, since R-15 (2026-08-08), the **colour-space tag** §60a needs, which
 * the WebGL 2 backend turns into an sRGB internal format, and, since R-30
 * (2026-08-13), **wrap and filter modes**. The rest are named as
 * deferred on {@link Texture} rather than sketched, because each of them (a
 * mip chain, a compressed-format enum) is a public shape the §79
 * scene format and every backend have to agree on.
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
import type {
  MaterialTextureFilter,
  MaterialTextureWrap,
  SpriteTexture,
} from "@four/materials";
import type { ColorSpace } from "@four/math";

import { validateColorSpace } from "./render-target.js";
import { noteTexture } from "./resource-memory.js";

/**
 * How a texture is sampled between texel centres (§77's "filter modes"; R-30,
 * 2026-08-13).
 *
 * ```ts
 * new Texture({ ...atlas, filter: "nearest" });   // a crisp bitmap font
 * ```
 *
 * ## Why two values, and why one field rather than `minFilter`/`magFilter`
 *
 * §77 asks for filter modes, and GL offers six — but four of them
 * (`*_MIPMAP_NEAREST`, `*_MIPMAP_LINEAR`) name a choice *between mip levels*,
 * and a texture with one level has none to choose between. This tier generates
 * no mipmaps ({@link Texture}), so the honest set is the two that mean something
 * here, and naming the other four would be accepting a value the backend must
 * then reinterpret.
 *
 * For the same reason there is one field and not two. `minFilter` and
 * `magFilter` are a *pair* precisely because minification is the direction with
 * mip levels in it; with one level the two accept the same two values and
 * differing between them buys nothing an author can describe. When mipmaps
 * land, `minFilter` gains four values and the split becomes a real choice —
 * and it widens beside this field, which keeps its meaning ("both, unless
 * overridden").
 */
export type TextureFilter = MaterialTextureFilter;

/**
 * How a texture is addressed outside `[0, 1]` (§77's "wrap modes"; R-30,
 * 2026-08-13).
 *
 * One field for both axes — see {@link MaterialTextureWrap} for why, and for how
 * it widens.
 */
export type TextureWrap = MaterialTextureWrap;

/** The legal {@link TextureFilter} values, in the §85 message's order. */
const FILTERS: readonly TextureFilter[] = ["nearest", "linear"];

/** The legal {@link TextureWrap} values, in the §85 message's order. */
const WRAPS: readonly TextureWrap[] = [
  "clamp-to-edge",
  "repeat",
  "mirrored-repeat",
];

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
   * for this tier and `UnlitMaterial.color`. Colour-space metadata is carried
   * by {@link TextureSource.colorSpace} since 2026-08-08 (R-15); it was
   * deliberately absent before that, and the note that said so — "tagging a
   * space here would pin half of §60a's design by accident" — is superseded.
   */
  readonly data?: Uint8Array;

  /**
   * The colour space these texels are in — §60a's first bullet: "color textures
   * default to sRGB-encoded and are decoded to linear on sample; data maps
   * (normal, roughness, occlusion) default to linear" (R-15, 2026-08-08).
   *
   * ```ts
   * // An albedo map authored in an image editor: sRGB-encoded bytes.
   * new Texture({ width, height, data, colorSpace: "srgb" });
   * ```
   *
   * `"srgb"` makes the backend allocate an sRGB internal format, so the GPU
   * decodes each sample to linear-light before the shader sees it and §60a's
   * "lighting and blending run in linear space" holds for textured surfaces
   * too. `"linear"` uploads the bytes as the numbers they are — the right tag
   * for a data map, a mask, or texels a program computed.
   *
   * ## The dated deviation from §60a's default (owner decision, R-15)
   *
   * §60a defaults *colour* textures to sRGB. This field **defaults to
   * `"linear"`**, and the reason is the one this repository applies to every
   * default: nothing in the engine distinguishes a colour map from a data map
   * (§59's `normalMap`/`occlusionMap` are staged, so every texture here is a
   * colour map by elimination), so the §60a-faithful default would silently
   * darken every texture already authored against this engine and move every
   * pixel golden, for scenes that never asked for colour management. Opt-in
   * keeps §60a's behaviour available and every existing frame byte-identical.
   * Flipping it is an owner call, and the day §77's map roles land is the day
   * it becomes cheap to make.
   */
  readonly colorSpace?: ColorSpace;

  /**
   * How this texture is sampled between texel centres (§77; R-30,
   * 2026-08-13). Defaults to `"linear"`.
   *
   * ```ts
   * // A 6 × 12 bitmap font: every glyph texel stays a square.
   * const atlas = new Texture({ ...buildGlyphAtlas(), filter: "nearest" });
   * ```
   *
   * The default is `"linear"` because that is what this tier sampled with
   * before the field existed: a texture that names no filter issues the
   * identical `texParameteri` pair it always did, so no already-authored scene
   * moves a pixel (the rule R-15's `colorSpace` default follows, for the same
   * reason).
   */
  readonly filter?: TextureFilter;

  /**
   * How this texture is addressed outside `[0, 1]` (§77; R-30, 2026-08-13).
   * Defaults to `"clamp-to-edge"`, this tier's previous fixed choice.
   *
   * ```ts
   * // A tiling ground texture, with uv running 0…8 across the plane.
   * new Texture({ width, height, data, wrap: "repeat" });
   * ```
   *
   * Note that `"repeat"` and `"mirrored-repeat"` are legal on a
   * non-power-of-two texture in WebGL 2 (they were not in WebGL 1), so a
   * backend at §62's WebGL 1 tier would have to refuse the combination rather
   * than silently sample black.
   */
  readonly wrap?: TextureWrap;
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

/**
 * Refuses a sampler-state value the backend has no meaning for (§85).
 *
 * **Refuses; never substitutes.** A misspelled `"nearset"` that quietly became
 * `"linear"` would be a texture sampled the wrong way with nothing anywhere
 * saying so — and the §85 rule this repository applies to every configuration
 * value is that a wrong one is louder than a plausible-looking rewrite.
 */
function validateEnum<T extends string>(
  value: T,
  legal: readonly T[],
  field: string,
): void {
  if (!legal.includes(value)) {
    throw new RangeError(
      `Texture ${field} must be one of ${legal.map((one) => JSON.stringify(one)).join(", ")}; ` +
        `got ${JSON.stringify(value)} (§77, §85).`,
    );
  }
}

/** Runs the §85 checks for one source. Throws on the first violation. */
function validate(source: TextureSource): void {
  if (source.colorSpace !== undefined) {
    validateColorSpace(source.colorSpace, "Texture");
  }
  if (source.filter !== undefined) {
    validateEnum(source.filter, FILTERS, "filter");
  }
  if (source.wrap !== undefined) {
    validateEnum(source.wrap, WRAPS, "wrap");
  }
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
 * Cube/array/3D targets, mipmaps and their generation, anisotropy, the §77 *map roles* that
 * would let colour-space metadata carry §60a's own defaults (colour maps sRGB,
 * data maps linear — the tag itself ships, see
 * {@link TextureSource.colorSpace}), compressed containers, render-target textures (§63), video textures,
 * and asynchronous upload with residency diagnostics (§84). Every one of them
 * adds public state that a backend, the §79 scene format, and §76's asset
 * manager all have to agree on.
 *
 * **Wrap and filter modes left that list on 2026-08-13 (R-30)** — see
 * {@link TextureSource.filter} and {@link TextureSource.wrap}. They were the
 * cheapest member of it by a wide margin, because sampler state is set on the
 * texture object at upload time and read by nothing on the draw path: a
 * `texParameteri` argument became a variable, and no frame does one thing more
 * than it did.
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
   * The colour space of the texels (§60a), `"linear"` when the source names
   * none — see {@link TextureSource.colorSpace} for the default and its dated
   * deviation from §60a's own.
   *
   * Resolved here rather than left optional so the backend reads one value and
   * never repeats the `?? "linear"`; `MaterialTexture.colorSpace` stays
   * optional because a test double and every pre-R-15 texture satisfy it
   * unchanged.
   */
  get colorSpace(): ColorSpace {
    return this.#source.colorSpace ?? "linear";
  }

  /**
   * How this texture is sampled between texel centres (§77; R-30), `"linear"`
   * when the source names none — see {@link TextureSource.filter}.
   *
   * Resolved here rather than left optional for `colorSpace`'s reason: the
   * backend reads one value and never repeats the `??`, while
   * `MaterialTexture.filter` stays optional so every pre-R-30 texture and every
   * test double satisfies the contract unchanged.
   *
   * **Sampler state is read at upload time.** Changing it on a texture the
   * backend has already uploaded therefore needs {@link Texture.markDirty} (or
   * a new {@link Texture.source}, which bumps the version for you) — the same
   * announcement an in-place texel edit needs, and for the same reason.
   */
  get filter(): TextureFilter {
    return this.#source.filter ?? "linear";
  }

  /**
   * How this texture is addressed outside `[0, 1]` (§77; R-30),
   * `"clamp-to-edge"` when the source names none — see
   * {@link TextureSource.wrap} and {@link Texture.filter}'s note on when a
   * change takes effect.
   */
  get wrap(): TextureWrap {
    return this.#source.wrap ?? "clamp-to-edge";
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
