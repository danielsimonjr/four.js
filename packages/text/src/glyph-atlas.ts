/**
 * `buildGlyphAtlas` (§56 MVP tier) — every glyph of a {@link BitmapFont} packed
 * into one RGBA8 buffer, with a uv rectangle per character.
 *
 * This is the whole bridge between a font and a renderer: the buffer is uploaded
 * as a texture, the uv rectangles become quad texture coordinates, and a label
 * is then one textured draw per glyph (or one batched draw, when §65 batching
 * lands) over a single texture binding. No glyph is ever rasterized again.
 *
 * ## Why the result is a plain object and not a `Texture` (decision, WP-3a.4)
 *
 * `@four/text` depends on `core`, `math`, and `geometry` — **not** on `render`,
 * `materials`, or `scene` (plan §3.1, frozen). `Texture` lives in `@four/render`
 * and cannot be imported here, and reversing that edge to get a convenience
 * constructor would put a text package underneath the renderer for the rest of
 * the project's life.
 *
 * So the atlas is **data**, and it is data in exactly the shape `@four/render`'s
 * `TextureSource` already accepts — `{ width, height, data }`, tightly packed
 * RGBA8, `width * height * 4` bytes, **row 0 is `v = 0`, the bottom row**. That
 * is a *structural* agreement, checked by neither compiler nor test in this
 * package, and it is stated here so it survives: an application writes
 *
 * ```ts
 * const atlas = buildGlyphAtlas();
 * const texture = new Texture(atlas);              // @four/render
 * const material = new SpriteMaterial({ texture }); // @four/materials
 * ```
 *
 * and the extra fields the atlas carries beyond `TextureSource` (the glyph
 * table, the metrics) are simply ignored by the texture. The same principle runs
 * through the rest of the packet: **text produces data — atlas bytes and quad
 * geometry — never nodes.** A `Text` *node* belongs in whichever package may
 * depend on `scene` and `materials`; it is a thin wrapper over
 * {@link GlyphAtlas} and `layoutText`, and it is not this package's to write.
 *
 * **It was written on 2026-08-13 (R-28), and it landed in the umbrella package
 * `four`** — the only one the frozen §3.1 matrix lets see both this package and
 * `@four/render`. It takes an atlas and a material and turns a string into one
 * geometry of glyph quads: `packages/four/src/text-node.ts`.
 *
 * ## Y-up, once (§7a)
 *
 * A font's rows are authored top-down; §7a's world and GL's default texture
 * unpack are both bottom-up. The flip happens **here and only here**: cell row
 * `cy` (0 = top of the cell) is written to atlas row `cellY + cellHeight - 1 -
 * cy`. Downstream, `v0` is the bottom of a glyph and `v1` its top, which is what
 * a Y-up quad wants without a second flip anywhere.
 *
 * ## White everywhere, alpha as coverage (decision, WP-3a.4)
 *
 * Ink texels are `(255, 255, 255, 255)`; clear texels are `(255, 255, 255, 0)` —
 * white with **zero alpha**, not transparent black.
 *
 * Straight (non-premultiplied) alpha is the MVP policy (§66, and
 * `SpriteMaterial`'s tint), and under straight alpha a bilinear sample halfway
 * between an ink texel and a `(0, 0, 0, 0)` texel returns colour `(0.5, 0.5,
 * 0.5)` — the glyph's edges are filtered *towards black*, which is the grey
 * fringe that makes naive bitmap text look dirty and, worse, gets darker the
 * more the text is minified. Holding RGB at white makes every interpolated
 * sample white with a fractional alpha, so an edge fades to transparent instead
 * of to soot, and `texture(map, uv) * tint` tints the antialiased edge correctly
 * too. The buffer is still "white glyphs on transparent": what varies is alpha,
 * which is what a coverage mask means.
 *
 * ## Padding
 *
 * Cells are separated by a one-texel transparent gutter (configurable). Without
 * it a linear sample at a cell edge reaches into the neighbouring glyph and
 * leaves a sliver of the wrong letter along the seam — the classic atlas bleed.
 * The uv rectangle covers the cell only; the gutter is never addressed, it is
 * only sampled *into*.
 *
 * ## Deferred from §56 (named, not dropped)
 *
 * SDF and MSDF fields (this is the bitmap half of §56's "bitmap, signed-distance
 * field, and multi-channel SDF"), dynamic atlases that rasterize on demand and
 * evict, multi-page atlases for fonts too large for one texture, and kerning
 * pairs. None changes the shape of {@link GlyphAtlas}: an SDF atlas is the same
 * table over a distance field, and kerning is a second table beside it.
 */

import type { BitmapFont, BitmapGlyph } from "./bitmap-font.js";
import { BUILTIN_FONT, glyphPixel } from "./bitmap-font.js";

/** Bytes per texel — RGBA8 (§77). */
const BYTES_PER_TEXEL = 4;

/** Where one glyph lives in an atlas, and what it costs to draw. */
export interface GlyphAtlasEntry {
  /** The character drawn, or `""` for {@link GlyphAtlas.fallback}. */
  readonly char: string;

  /** Left edge of the cell in normalized texture coordinates, 0…1. */
  readonly u0: number;

  /** **Bottom** edge of the cell in normalized texture coordinates (§7a). */
  readonly v0: number;

  /** Right edge of the cell. */
  readonly u1: number;

  /** **Top** edge of the cell. */
  readonly v1: number;

  /** Pen movement after this glyph, in font pixels (see {@link BitmapGlyph.advance}). */
  readonly advance: number;

  /** Whether the cell is entirely clear — layout skips the quad (space). */
  readonly blank: boolean;

  /** Left edge of the cell in texels. Diagnostics and tests; uv is the API. */
  readonly x: number;

  /** Bottom edge of the cell in texels. */
  readonly y: number;

  /** Cell width in texels — {@link BitmapFont.cellWidth}. */
  readonly width: number;

  /** Cell height in texels — {@link BitmapFont.cellHeight}. */
  readonly height: number;
}

/**
 * A packed font: RGBA8 texels, plus the table that says where each glyph is.
 *
 * The first three fields are deliberately `@four/render`'s `TextureSource` —
 * see the module header.
 */
export interface GlyphAtlas {
  /** Texture width in texels; a power of two. */
  readonly width: number;

  /** Texture height in texels; a power of two. */
  readonly height: number;

  /**
   * Tightly packed RGBA8 texels, `width * height * 4` bytes, **row 0 first and
   * row 0 is the bottom row** (`v = 0`) — the orientation `@four/render`'s
   * `TextureSource` documents and GL's default unpack expects.
   */
  readonly data: Uint8Array;

  /** Every covered character, keyed by single-character string. */
  readonly glyphs: ReadonlyMap<string, GlyphAtlasEntry>;

  /** The cell drawn for characters absent from {@link GlyphAtlas.glyphs}. */
  readonly fallback: GlyphAtlasEntry;

  /** The font this atlas was built from. */
  readonly font: BitmapFont;

  /** Cell width in texels — copied from the font so layout needs only the atlas. */
  readonly cellWidth: number;

  /** Cell height in texels. */
  readonly cellHeight: number;

  /** Pixels from a cell's top edge to the baseline. */
  readonly ascent: number;

  /** Pixels from the baseline to a cell's bottom edge. */
  readonly descent: number;

  /** Baseline-to-baseline distance in pixels at single spacing. */
  readonly lineHeight: number;

  /** Transparent gutter in texels between cells, and around the edges. */
  readonly padding: number;
}

/** Optional arguments of {@link buildGlyphAtlas}. */
export interface GlyphAtlasOptions {
  /**
   * Transparent gutter in texels between neighbouring cells and around the
   * atlas edge; defaults to `1`. Zero is legal and packs tighter, at the price
   * of bleeding between neighbours under linear filtering — see the module
   * header.
   */
  padding?: number;
}

/** Smallest power of two ≥ `value`. `value` is a positive integer. */
function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) {
    result *= 2;
  }
  return result;
}

/** Validates `padding` (§85). */
function requirePadding(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(
      `Glyph atlas padding must be a non-negative integer number of texels; ` +
        `got ${String(value)} (§85).`,
    );
  }
  return value;
}

/**
 * Packs `font` into one RGBA8 atlas (§56 MVP tier).
 *
 * ```ts
 * const atlas = buildGlyphAtlas();                       // the built-in face
 * atlas.width;                                           // 128
 * atlas.glyphs.get("A");                                 // { u0, v0, u1, v1, … }
 * const texture = new Texture(atlas);                    // @four/render
 * ```
 *
 * ## The packing
 *
 * A monospace font's cells are all one size, so the packer is a **grid**, not a
 * bin packer: rectangle packing exists to fit *differently sized* boxes, and
 * running one over 96 identical rectangles would trade an exact answer for a
 * heuristic. Glyphs are placed left to right, bottom row of cells first, in
 * ascending code-point order, with the fallback box last. Column count is
 * whatever makes the atlas roughly square and then rounds the width up to a
 * power of two, which the height gets too.
 *
 * Powers of two because a §77-tier texture with `LINEAR` filtering and
 * `CLAMP_TO_EDGE` is safest at POT sizes across the WebGL 2 / WebGL 1 boundary,
 * and because a POT atlas can grow mipmaps later without being repacked. The
 * unused remainder is transparent and costs one quarter of a 128² atlas — 16 kB
 * of the built-in font's 64 kB — which is a good trade against a repack.
 *
 * ## Determinism (§33)
 *
 * Nothing here reads a clock, a random number, or the environment: the same font
 * and the same padding produce a byte-identical buffer and an identically
 * ordered glyph map on every machine and in every process.
 */
export function buildGlyphAtlas(
  font: BitmapFont = BUILTIN_FONT,
  options: GlyphAtlasOptions = {},
): GlyphAtlas {
  const padding = requirePadding(options.padding ?? 1);

  // The fallback box is packed alongside the covered characters: it is drawn
  // exactly as often as an unrepresentable character appears, and giving it its
  // own texture would double the bindings for one cell.
  const packed: BitmapGlyph[] = [...font.glyphs.values(), font.fallback];

  const strideX = font.cellWidth + padding;
  const strideY = font.cellHeight + padding;

  // Square-ish, then rounded out to powers of two. `columns` is recomputed from
  // the rounded width so the extra space is used rather than wasted.
  const squareColumns = Math.max(1, Math.ceil(Math.sqrt(packed.length)));
  const width = nextPowerOfTwo(padding + squareColumns * strideX);
  const columns = Math.max(1, Math.floor((width - padding) / strideX));
  const rows = Math.ceil(packed.length / columns);
  const height = nextPowerOfTwo(padding + rows * strideY);

  const data = new Uint8Array(width * height * BYTES_PER_TEXEL);
  // White everywhere; alpha alone carries coverage. See the module header for
  // why this is not transparent *black*.
  for (let index = 0; index < data.length; index += BYTES_PER_TEXEL) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
  }

  /** Rasterizes one glyph into cell `index` and returns its table entry. */
  const place = (glyph: BitmapGlyph, index: number): GlyphAtlasEntry => {
    const cellX = padding + (index % columns) * strideX;
    const cellY = padding + Math.floor(index / columns) * strideY;

    if (!glyph.blank) {
      for (let cy = 0; cy < font.cellHeight; cy += 1) {
        // The single Y flip (§7a): cell row 0 is the cell's *top*, atlas row 0
        // is the texture's *bottom*.
        const atlasY = cellY + font.cellHeight - 1 - cy;
        for (let cx = 0; cx < font.cellWidth; cx += 1) {
          if (!glyphPixel(font, glyph, cx, cy)) {
            continue;
          }
          const texel = (atlasY * width + cellX + cx) * BYTES_PER_TEXEL;
          data[texel + 3] = 255;
        }
      }
    }

    return Object.freeze<GlyphAtlasEntry>({
      char: glyph.char,
      u0: cellX / width,
      v0: cellY / height,
      u1: (cellX + font.cellWidth) / width,
      v1: (cellY + font.cellHeight) / height,
      advance: glyph.advance,
      blank: glyph.blank,
      x: cellX,
      y: cellY,
      width: font.cellWidth,
      height: font.cellHeight,
    });
  };

  const glyphs = new Map<string, GlyphAtlasEntry>();
  for (let index = 0; index < packed.length - 1; index += 1) {
    const glyph = packed[index];
    glyphs.set(glyph.char, place(glyph, index));
  }
  // The fallback is the last cell, by construction of `packed` above.
  const fallback = place(font.fallback, packed.length - 1);

  return Object.freeze<GlyphAtlas>({
    width,
    height,
    data,
    glyphs,
    fallback,
    font,
    cellWidth: font.cellWidth,
    cellHeight: font.cellHeight,
    ascent: font.ascent,
    descent: font.descent,
    lineHeight: font.lineHeight,
    padding,
  });
}
