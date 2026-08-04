/**
 * `layoutText` (§56 MVP tier) — a string plus a {@link GlyphAtlas} becomes a
 * list of textured quads in world units.
 *
 * This is pure arithmetic: no allocation of engine objects, no scene graph, no
 * renderer, no DOM, no measurement callback. Give it a string and it returns
 * where each glyph's rectangle goes and which part of the atlas it samples. A
 * caller turns those into geometry (`@four/geometry`), a sprite batch
 * (`@four/render`), or SVG rects — the layout never learns which.
 *
 * ## Coordinates (§7a)
 *
 * **Origin is the first line's baseline at its left edge**, and **+Y is up**, in
 * 2D exactly as in 3D. So `y0 < y1` in every quad, ascenders have positive `y`,
 * descenders negative, and the second line's baseline is at `y = -size`.
 *
 * Baseline-relative rather than top-left-relative because the baseline is the
 * line that text actually sits on: mixing two fonts, or two sizes, or an icon
 * with a label, aligns on baselines and on nothing else. A caller who wants
 * top-left origin subtracts `ascent`, which is on the atlas; a caller who wants
 * the text centred uses the returned `width`/`height`.
 *
 * ```text
 *            ┌───────┬───────┬───────┐   y1 = +ascent · scale
 *            │  ###  │  #    │       │
 *            │ #   # │  #    │  ###  │
 *   baseline ├───────┼───────┼───────┤   y = 0  ← the origin's row
 *            │       │       │    #  │
 *            └───────┴───────┴───────┘   y0 = −descent · scale
 *            x=0     ↑ advance · scale
 * ```
 *
 * ## `size` is world units per **line**, not per em
 *
 * `scale = size / atlas.lineHeight`, so `size` is the baseline-to-baseline
 * distance of single-spaced lines and the height of one glyph cell. Two
 * consequences, both intended: a block of `n` lines is exactly `n · size` tall,
 * and `size` means the same thing whatever a font's internal pixel grid is — a
 * 6 × 12 face and a 16 × 32 face at `size: 0.5` produce text of the same
 * physical height. Quoting a font size in em would make the same number mean
 * different heights per face, which is precisely the CSS behaviour that forces
 * everyone to measure.
 *
 * ## What this tier does not do (§56, staged)
 *
 * Line **breaking** and wrapping (only an explicit `\n` breaks a line here),
 * horizontal and vertical **alignment**, word spacing, rich-text spans, text on
 * paths, bidirectional reordering, shaping, ligatures, and kerning. §56 stages
 * shaping/bidi/ligatures behind a shaping-engine decision recorded by amendment;
 * wrapping and alignment are not blocked by that, they are simply the next
 * packet — and both are computed *from* this function's output (a wrap needs
 * per-glyph advances; an alignment needs per-line widths), so neither changes
 * the shape of {@link TextLayout}.
 */

import type { GlyphAtlas, GlyphAtlasEntry } from "./glyph-atlas.js";

/**
 * One glyph's rectangle: where it goes, and what it samples.
 *
 * Positions are world units in the layout's own frame (baseline-left origin,
 * §7a Y-up); texture coordinates are the atlas cell, normalized 0…1. Corners
 * are given as a minimum/maximum pair rather than as four vertices because
 * every consumer — a quad builder, a sprite, an SVG rect — wants the rectangle,
 * and expanding it to vertices is one line at the point of use.
 */
export interface TextQuad {
  /** Left edge in world units. */
  readonly x0: number;

  /** **Bottom** edge in world units; below the baseline for a descender. */
  readonly y0: number;

  /** Right edge in world units. */
  readonly x1: number;

  /** **Top** edge in world units. */
  readonly y1: number;

  /** Left edge of the atlas cell, 0…1. */
  readonly u0: number;

  /** **Bottom** edge of the atlas cell, 0…1. */
  readonly v0: number;

  /** Right edge of the atlas cell, 0…1. */
  readonly u1: number;

  /** **Top** edge of the atlas cell, 0…1. */
  readonly v1: number;
}

/** Arguments of {@link layoutText}. */
export interface TextLayoutOptions {
  /**
   * World units per line — the baseline-to-baseline distance of single-spaced
   * lines, and the height of one glyph cell. Must be finite and positive. See
   * the module header for why this is not an em size.
   */
  size: number;

  /**
   * Extra world units inserted **between** adjacent glyphs on a line; defaults
   * to `0`. Negative values tighten.
   *
   * Between, not after: no spacing precedes the first glyph of a line or
   * follows the last, so {@link TextLayout.width} stays the true extent of the
   * text and centring it does not drift by half a spacing (decision, WP-3a.4 —
   * CSS `letter-spacing` appends after every character instead, which is why
   * centred CSS text with wide tracking looks a touch left of centre).
   */
  letterSpacing?: number;
}

/** What {@link layoutText} produces. */
export interface TextLayout {
  /**
   * One quad per **drawn** glyph, in reading order, line by line.
   *
   * Blank glyphs — the space, and anything else a font marks
   * {@link BitmapGlyph.blank} — advance the pen but
   * emit no quad: a fully transparent rectangle costs a draw call and a blend
   * and contributes nothing. So `quads.length` is *not* the string's length, and
   * a caller mapping quads back to characters must track that itself.
   */
  readonly quads: readonly TextQuad[];

  /** Width of the widest line in world units; `0` for text with no glyphs. */
  readonly width: number;

  /**
   * Total height in world units — `lineCount · size`, measuring from the first
   * line's cell top to the last line's cell bottom (the two are the same
   * because a cell is exactly one `lineHeight` tall).
   */
  readonly height: number;

  /**
   * Number of lines: one more than the `\n` count, or `0` for the empty string.
   *
   * Zero rather than one for `""` so that an empty label has zero height and
   * occupies no space in a layout — a caller that reserves a line for empty text
   * wants `Math.max(1, lineCount)`, which is explicit at the point that wants it
   * (decision, WP-3a.4).
   */
  readonly lineCount: number;
}

/** Validates one numeric option (§85). */
function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `layoutText: ${name} must be finite; got ${String(value)} ` +
        "(§85: NaN and infinite values).",
    );
  }
  return value;
}

/**
 * Lays `text` out against `atlas` (§56 MVP tier).
 *
 * ```ts
 * const atlas = buildGlyphAtlas();
 * const layout = layoutText("Motor\n42 C", atlas, { size: 0.5 });
 * layout.lineCount; // 2
 * layout.height;    // 1     — 2 lines × 0.5
 * layout.width;     // 1.25  — "Motor", 5 cells × 6 px × (0.5 / 12)
 * ```
 *
 * ## Character handling
 *
 * - Iteration is by **code point** (`for…of`), so an astral character is one
 *   character and not two lone surrogates.
 * - `\n` ends the line: the pen returns to `x = 0` and the baseline drops by
 *   `size` (leading is exactly one line — see {@link TextLayoutOptions.size}).
 * - `\r` is **skipped entirely**, drawing nothing and advancing nothing, so
 *   CRLF-terminated text lays out identically to LF-terminated text (decision,
 *   WP-3a.4). A lone `\r` as a line terminator — Mac OS 9 and earlier — is not
 *   honoured as a break.
 * - Every other character absent from the atlas, control characters and tabs
 *   included, draws the fallback box and advances one cell. Nothing is silently
 *   dropped: an unrepresentable character is visible, which is what makes a
 *   missing script or a stray control byte diagnosable (§56's "font fallback"
 *   at this tier).
 *
 * ## Determinism (§33)
 *
 * Pure: same string, same atlas, same options → identical numbers, always. No
 * clock, no randomness, no measurement of the environment.
 */
export function layoutText(
  text: string,
  atlas: GlyphAtlas,
  options: TextLayoutOptions,
): TextLayout {
  const size = requireFinite("size", options.size);
  if (size <= 0) {
    throw new RangeError(
      `layoutText: size must be a positive number of world units per line; ` +
        `got ${String(size)} (§85).`,
    );
  }
  const letterSpacing = requireFinite(
    "letterSpacing",
    options.letterSpacing ?? 0,
  );

  const quads: TextQuad[] = [];
  if (text === "") {
    return Object.freeze<TextLayout>({
      quads: Object.freeze(quads),
      width: 0,
      height: 0,
      lineCount: 0,
    });
  }

  // Font pixels → world units. `lineHeight` rather than `cellHeight` because
  // `size` is defined as the baseline-to-baseline distance; the two are equal
  // for the built-in face and the distinction matters for a face with built-in
  // line gap.
  const scale = size / atlas.lineHeight;
  const top = atlas.ascent * scale;
  const bottom = atlas.descent * scale;
  const cellWidth = atlas.cellWidth * scale;

  let penX = 0;
  let baselineY = 0;
  let lineCount = 1;
  let glyphsOnLine = 0;
  let width = 0;

  for (const char of text) {
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      width = Math.max(width, penX);
      penX = 0;
      baselineY -= size;
      lineCount += 1;
      glyphsOnLine = 0;
      continue;
    }

    if (glyphsOnLine > 0) {
      penX += letterSpacing;
    }
    glyphsOnLine += 1;

    const entry: GlyphAtlasEntry = atlas.glyphs.get(char) ?? atlas.fallback;
    if (!entry.blank) {
      quads.push(
        Object.freeze<TextQuad>({
          x0: penX,
          y0: baselineY - bottom,
          x1: penX + cellWidth,
          y1: baselineY + top,
          u0: entry.u0,
          v0: entry.v0,
          u1: entry.u1,
          v1: entry.v1,
        }),
      );
    }
    penX += entry.advance * scale;
  }

  width = Math.max(width, penX);

  return Object.freeze<TextLayout>({
    quads: Object.freeze(quads),
    width,
    height: lineCount * size,
    lineCount,
  });
}
