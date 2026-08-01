/**
 * A built-in, dependency-free monospace bitmap font (§56 MVP tier).
 *
 * §56 asks for Unicode, font fallback, bidirectional layout, ligatures,
 * kerning, shaping, line breaking, rich spans, text on paths, and bitmap /
 * SDF / MSDF rendering — and then states the tier this packet implements:
 *
 * > MVP tier: initial releases may ship bitmap/SDF text with basic Latin-script
 * > layout only. Full shaping, bidirectional layout, and ligatures are staged
 * > behind a shaping-engine decision […] to be recorded by amendment before
 * > that work begins.
 *
 * So this module ships **one bitmap font, in source, with no I/O**: printable
 * ASCII (U+0020…U+007E) as 5×7 pixel letterforms on a 6×12 monospace cell. That
 * is deliberately not a font *loader*. A loader needs a file format, an
 * asynchronous asset path (§76), and a rasterizer; a label in the §106a demo
 * needs none of those, and a test that asserts a glyph's pixels must not depend
 * on a font file being installed. When real fonts arrive, they arrive as
 * additional {@link BitmapFont} producers behind the same interface — the atlas
 * builder and the layout engine never learn where a font came from.
 *
 * ## Why the pixels live in source (decision, WP-3a.4)
 *
 * There is no DOM here, no `<canvas>`, no `document.fonts`, and no file read.
 * `@four/text` depends on `core`, `math`, and `geometry` only (plan §3.1), it is
 * imported by headless tests and by Node, and §33 forbids anything whose result
 * varies by environment. A canvas rasterizer fails all three: it needs a
 * browser, it renders differently on every platform's font stack, and it makes a
 * glyph atlas non-reproducible — which would put text outside the determinism
 * tier the rest of the engine is held to. Pixels in source are byte-identical on
 * every machine, forever.
 *
 * ## The cell (decision, WP-3a.4)
 *
 * ```text
 *  cell row │  ← 6 px wide ──→
 *     0     │ . . . . . .        ← always blank (accent/diacritic headroom)
 *     1     │ # # # # # .   ┐
 *     2     │ # . . . # .   │ cap / ascender band (rows 1…7)
 *     3     │ # . . . # .   │ x-height band starts at row 3
 *     4     │ # # # # # .   │
 *     5     │ # . . . # .   │
 *     6     │ # . . . # .   │
 *     7     │ # . . . # .   ┘
 *  ─────────┼─────────────── baseline (8 px below the cell top)
 *     8     │ . . . . . .   ┐ descender band (rows 8…9)
 *     9     │ . . . . . .   ┘
 *    10     │ . . . . . .   ┐ line gap
 *    11     │ . . . . . .   ┘
 * ```
 *
 * - **6 × 12 cell**, of which the letterform occupies columns 0…4; column 5 is
 *   the inter-glyph gap, so quads laid out at `advance = 6` tile exactly with no
 *   overlap and one clear pixel between neighbours.
 * - **`ascent = 8`, `descent = 4`, `lineHeight = 12`** — and `ascent + descent`
 *   equals `cellHeight` exactly, which is what lets {@link BitmapFont} metrics
 *   and the atlas cell be the same rectangle (see `text-layout.ts`).
 * - Glyph bitmaps cover cell rows **1…9** only ({@link BitmapFont.glyphTop} = 1,
 *   nine rows). Row 0 and rows 10…11 are blank in every glyph, so encoding them
 *   would be 3 wasted rows × 96 glyphs.
 *
 * ## The encoding
 *
 * One glyph is one **9-character string**, one character per cell row, top row
 * first. Each character is a base-32 digit (`0`…`9`, `a`…`v`) holding the row's
 * five pixels, **most significant bit leftmost**: `0b10001` = `"h"` is the two
 * stems of an `H`. Decoding is one index into that digit table, done once per
 * face in {@link createBitmapFont}.
 *
 * The encoded table is unreadable on purpose — it is data, not code — so
 * {@link glyphToAscii} renders any glyph back to `.`/`#` art, and `text.test.ts`
 * asserts several letterforms against that art. The art in the test file *is*
 * the human-readable copy of the font; if a row here is edited by accident, the
 * test fails with a picture of what changed.
 *
 * ## Coverage
 *
 * Every printable ASCII code point, U+0020 through U+007E — all 95, not only the
 * Latin letters. Anything else — a control character, an accented letter, an
 * emoji, an unpaired surrogate — resolves to {@link BitmapFont.fallback}, the
 * hollow "missing glyph" box (`▯`) that every font in the world uses for the
 * same purpose. There is no silent dropping: an unrepresentable character
 * occupies a cell and is visible, which is the behaviour that makes a missing
 * script obvious instead of mysterious.
 *
 * Non-ASCII coverage is a **font** problem, not a layout problem, and it is
 * staged with §56's shaping decision: a Latin-1 or Greek block is 96 more rows
 * of this table, while Arabic or Devanagari need the shaping engine that spec
 * §56 explicitly defers.
 */

/** Base-32 digits used by the encoded glyph table, in value order. */
const BASE32 = "0123456789abcdefghijklmnopqrstuv";

/**
 * Widest letterform the base-32 row encoding can express: one digit is exactly
 * five bits, so five pixels. A wider face needs a wider encoding, which is a
 * change to {@link createBitmapFont}'s input format and not to anything
 * downstream of it.
 */
const MAX_GLYPH_WIDTH = 5;

/** First code point of the built-in face. */
const FIRST_CODE_POINT = 0x20;

/**
 * The letterforms, in code-point order from U+0020, one 9-character row string
 * each. See the module header for the encoding, and {@link glyphToAscii} for
 * reading one back.
 */
const ENCODED_GLYPHS: readonly string[] = [
  "000000000", // U+0020 space
  "444440400", // U+0021 !
  "aa0000000", // U+0022 "
  "aavavaa00", // U+0023 #
  "4fke5u400", // U+0024 $
  "pp248jj00", // U+0025 %
  "cik8lid00", // U+0026 &
  "440000000", // U+0027 '
  "248884200", // U+0028 (
  "842224800", // U+0029 )
  "0level000", // U+002A *
  "044v44000", // U+002B +
  "000006648", // U+002C ,
  "000v00000", // U+002D -
  "000006600", // U+002E .
  "11248gg00", // U+002F /
  "ehjlphe00", // U+0030 0
  "4c4444e00", // U+0031 1
  "eh1248v00", // U+0032 2
  "v2421he00", // U+0033 3
  "26aiv2200", // U+0034 4
  "vgu11he00", // U+0035 5
  "68guhhe00", // U+0036 6
  "v12488800", // U+0037 7
  "ehhehhe00", // U+0038 8
  "ehhf12c00", // U+0039 9
  "066006600", // U+003A :
  "066006648", // U+003B ;
  "248g84200", // U+003C <
  "00v0v0000", // U+003D =
  "842124800", // U+003E >
  "eh1240400", // U+003F ?
  "ehnlnge00", // U+0040 @
  "4ahhvhh00", // U+0041 A
  "uhhuhhu00", // U+0042 B
  "ehggghe00", // U+0043 C
  "uhhhhhu00", // U+0044 D
  "vgguggv00", // U+0045 E
  "vgguggg00", // U+0046 F
  "ehgjhhf00", // U+0047 G
  "hhhvhhh00", // U+0048 H
  "e44444e00", // U+0049 I
  "72222ic00", // U+004A J
  "hikokih00", // U+004B K
  "ggggggv00", // U+004C L
  "hrllhhh00", // U+004D M
  "hplljhh00", // U+004E N
  "ehhhhhe00", // U+004F O
  "uhhuggg00", // U+0050 P
  "ehhhlid00", // U+0051 Q
  "uhhukih00", // U+0052 R
  "fgge11u00", // U+0053 S
  "v44444400", // U+0054 T
  "hhhhhhe00", // U+0055 U
  "hhhhha400", // U+0056 V
  "hhhllrh00", // U+0057 W
  "hha4ahh00", // U+0058 X
  "hha444400", // U+0059 Y
  "v1248gv00", // U+005A Z
  "744444700", // U+005B [
  "gg8421100", // U+005C \
  "s44444s00", // U+005D ]
  "4ah000000", // U+005E ^
  "0000000v0", // U+005F _
  "840000000", // U+0060 `
  "00e1fhf00", // U+0061 a
  "gguhhhu00", // U+0062 b
  "00eggge00", // U+0063 c
  "11fhhhf00", // U+0064 d
  "00ehvge00", // U+0065 e
  "688u88800", // U+0066 f
  "00fhhhf1e", // U+0067 g
  "gguhhhh00", // U+0068 h
  "40c444e00", // U+0069 i
  "2062222ic", // U+006A j
  "ggikoki00", // U+006B k
  "c44444e00", // U+006C l
  "00qllll00", // U+006D m
  "00uhhhh00", // U+006E n
  "00ehhhe00", // U+006F o
  "00uhhhugg", // U+0070 p
  "00fhhhf11", // U+0071 q
  "00mpggg00", // U+0072 r
  "00fge1u00", // U+0073 s
  "88u889600", // U+0074 t
  "00hhhjd00", // U+0075 u
  "00hhha400", // U+0076 v
  "00hhlla00", // U+0077 w
  "00ha4ah00", // U+0078 x
  "00hhhhf1e", // U+0079 y
  "00v248v00", // U+007A z
  "344844300", // U+007B {
  "444444400", // U+007C |
  "o44244o00", // U+007D }
  "009li0000", // U+007E ~
];

/** The "missing glyph" box drawn for anything the font does not cover. */
const ENCODED_FALLBACK = "vhhhhhv00";

/**
 * One monospace letterform: its pixels, plus the metrics a layout needs.
 *
 * Glyphs are immutable — a font is shared by every atlas built from it, and by
 * every layout that reads one — so nothing here has a setter.
 */
export interface BitmapGlyph {
  /** The character this glyph draws, or `""` for {@link BitmapFont.fallback}. */
  readonly char: string;

  /**
   * The code point this glyph draws, or `-1` for {@link BitmapFont.fallback},
   * which stands for every code point the font does not cover rather than one.
   */
  readonly codePoint: number;

  /**
   * Pixel rows, **top first**, one bitmask each, covering cell rows
   * {@link BitmapFont.glyphTop} onwards. Bit `glyphWidth - 1 - column` is column
   * `column`, so the most significant of the five bits is the leftmost pixel.
   *
   * Read pixels with {@link glyphPixel} rather than shifting by hand — it takes
   * cell coordinates, so it also answers correctly for the blank rows this array
   * does not contain.
   */
  readonly rows: readonly number[];

  /**
   * Pen movement after drawing this glyph, in font pixels. Equal to
   * {@link BitmapFont.cellWidth} for every glyph of a monospace font;
   * per-glyph here because the field is what a proportional font will vary, and
   * a layout that reads it today needs no change then.
   */
  readonly advance: number;

  /**
   * Whether every pixel is clear — true for the space, and for nothing else in
   * the built-in font.
   *
   * Layout uses it to advance the pen without emitting a quad: a fully
   * transparent quad costs a draw and contributes nothing, and a string of text
   * is roughly one-fifth spaces.
   */
  readonly blank: boolean;
}

/**
 * A monospace bitmap font: glyph pixels plus vertical metrics.
 *
 * The interface, not the built-in table, is the contract — a loaded BMFont, a
 * generated SDF atlas, or a second built-in face all satisfy it, and
 * `buildGlyphAtlas` and `layoutText` accept any of them.
 */
export interface BitmapFont {
  /** Identifying name, for diagnostics and for keying atlas caches. */
  readonly name: string;

  /**
   * Width of one cell in pixels, letterform plus inter-glyph gap. The atlas
   * cell and the laid-out quad are both this wide.
   */
  readonly cellWidth: number;

  /** Height of one cell in pixels. Equals `ascent + descent` exactly. */
  readonly cellHeight: number;

  /** Width of a letterform in pixels; `cellWidth - glyphWidth` is the gap. */
  readonly glyphWidth: number;

  /** Cell row holding {@link BitmapGlyph.rows}`[0]`; rows above it are blank. */
  readonly glyphTop: number;

  /** Pixels from the cell's top edge down to the baseline. */
  readonly ascent: number;

  /** Pixels from the baseline down to the cell's bottom edge. */
  readonly descent: number;

  /**
   * Baseline-to-baseline distance in pixels for single-spaced lines. Equal to
   * {@link BitmapFont.cellHeight}: consecutive lines' cells stack edge to edge,
   * which is what makes `size` in `layoutText` mean "world units per line".
   */
  readonly lineHeight: number;

  /**
   * Every covered character, keyed by the single-character string, in ascending
   * code-point order (§33: insertion order is the only iteration order).
   */
  readonly glyphs: ReadonlyMap<string, BitmapGlyph>;

  /** Drawn for any character absent from {@link BitmapFont.glyphs}. */
  readonly fallback: BitmapGlyph;
}

/**
 * Everything {@link createBitmapFont} needs to assemble a face.
 *
 * The shape is deliberately the *encoded table plus metrics* rather than
 * decoded pixels: that is what a source table looks like, what a converted
 * BMFont or a subsetted face will be generated as, and what stays diffable in
 * a repository.
 */
export interface BitmapFontOptions {
  /** {@link BitmapFont.name}. */
  name: string;

  /** {@link BitmapFont.cellWidth}; a positive integer, and the advance. */
  cellWidth: number;

  /** {@link BitmapFont.cellHeight}; a positive integer. */
  cellHeight: number;

  /**
   * {@link BitmapFont.glyphWidth}; 1…5. Capped at five because one base-32
   * digit is five bits — see {@link MAX_GLYPH_WIDTH}.
   */
  glyphWidth: number;

  /** {@link BitmapFont.glyphTop}; the cell row the first encoded row occupies. */
  glyphTop: number;

  /** {@link BitmapFont.ascent}; 0…`cellHeight`. `descent` is the remainder. */
  ascent: number;

  /** Code point of `glyphs[0]`; the rest follow consecutively. */
  firstCodePoint: number;

  /**
   * One encoded row string per code point, from {@link firstCodePoint} upwards,
   * with no gaps. Every string must be the same length — that length is the
   * font's row count — and `glyphTop + rowCount` must fit inside the cell.
   */
  glyphs: readonly string[];

  /** The missing-glyph box, encoded like the others. */
  fallback: string;
}

/** Validates one integer metric (§85). */
function requireInteger(name: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `BitmapFont ${name} must be an integer of at least ${String(minimum)}; ` +
        `got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Decodes one row string into bitmasks. Throws on anything malformed. */
function decodeRows(encoded: string, rowCount: number): readonly number[] {
  if (encoded.length !== rowCount) {
    throw new RangeError(
      `Every encoded glyph of a font must be the same length; expected ` +
        `${String(rowCount)} characters but "${encoded}" has ` +
        `${String(encoded.length)}.`,
    );
  }
  const rows: number[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const digit = BASE32.indexOf(encoded.charAt(index));
    if (digit < 0) {
      throw new RangeError(
        `"${encoded}" is not base-32 ("0"…"9", "a"…"v"): character ` +
          `${String(index)} is "${encoded.charAt(index)}".`,
      );
    }
    rows.push(digit);
  }
  return Object.freeze(rows);
}

/**
 * Assembles a {@link BitmapFont} from an encoded table (§56 MVP tier).
 *
 * {@link BUILTIN_FONT} is built with it, and so is any other face that reaches
 * the engine as pixels — a converted BMFont, a subset shipped with an
 * application, a second built-in weight. Keeping one constructor means one
 * place validates the metrics, and {@link buildGlyphAtlas} never meets a font
 * whose glyphs overflow its cell.
 *
 * ```ts
 * const tiny = createBitmapFont({
 *   name: "tiny-3x5",
 *   cellWidth: 4, cellHeight: 5, glyphWidth: 3,
 *   glyphTop: 0, ascent: 5, firstCodePoint: 0x41,
 *   glyphs: ["57575", "77577"],   // A, B — three bits per row
 *   fallback: "77777",
 * });
 * ```
 *
 * Every glyph is monospaced at `cellWidth`: {@link BitmapGlyph.advance} exists
 * so a proportional face can vary it later, but nothing here reads a per-glyph
 * width, and a proportional font arrives with the kerning table §56 also
 * defers.
 *
 * Throws `RangeError` on any malformed metric or row string (§85). Validation
 * is at construction because a font is built once and read millions of times.
 */
export function createBitmapFont(options: BitmapFontOptions): BitmapFont {
  const cellWidth = requireInteger("cellWidth", options.cellWidth, 1);
  const cellHeight = requireInteger("cellHeight", options.cellHeight, 1);
  const glyphWidth = requireInteger("glyphWidth", options.glyphWidth, 1);
  const glyphTop = requireInteger("glyphTop", options.glyphTop, 0);
  const ascent = requireInteger("ascent", options.ascent, 0);
  const firstCodePoint = requireInteger(
    "firstCodePoint",
    options.firstCodePoint,
    0,
  );

  if (glyphWidth > MAX_GLYPH_WIDTH || glyphWidth > cellWidth) {
    throw new RangeError(
      `BitmapFont glyphWidth must be at most ${String(MAX_GLYPH_WIDTH)} ` +
        `(one base-32 digit is five bits) and at most cellWidth ` +
        `(${String(cellWidth)}); got ${String(glyphWidth)}.`,
    );
  }
  if (ascent > cellHeight) {
    throw new RangeError(
      `BitmapFont ascent must fit inside the cell; got ${String(ascent)} in a ` +
        `cell ${String(cellHeight)} pixels tall.`,
    );
  }
  if (options.glyphs.length === 0) {
    throw new RangeError("A BitmapFont must encode at least one glyph.");
  }

  const rowCount = options.fallback.length;
  if (glyphTop + rowCount > cellHeight) {
    throw new RangeError(
      `A font's ${String(rowCount)} encoded rows starting at cell row ` +
        `${String(glyphTop)} overflow a cell ${String(cellHeight)} pixels ` +
        "tall.",
    );
  }

  const makeGlyph = (
    char: string,
    codePoint: number,
    encoded: string,
  ): BitmapGlyph => {
    const rows = decodeRows(encoded, rowCount);
    return Object.freeze<BitmapGlyph>({
      char,
      codePoint,
      rows,
      advance: cellWidth,
      blank: rows.every((row) => row === 0),
    });
  };

  const glyphs = new Map<string, BitmapGlyph>();
  for (let index = 0; index < options.glyphs.length; index += 1) {
    const codePoint = firstCodePoint + index;
    const char = String.fromCodePoint(codePoint);
    glyphs.set(char, makeGlyph(char, codePoint, options.glyphs[index]));
  }

  return Object.freeze<BitmapFont>({
    name: options.name,
    cellWidth,
    cellHeight,
    glyphWidth,
    glyphTop,
    ascent,
    descent: cellHeight - ascent,
    lineHeight: cellHeight,
    glyphs,
    // Code point -1: the fallback stands for every code point the font does not
    // cover, so it can honestly claim none of them.
    fallback: makeGlyph("", -1, options.fallback),
  });
}

/**
 * The built-in 6 × 12 monospace face covering printable ASCII (§56 MVP tier).
 *
 * ```ts
 * const atlas = buildGlyphAtlas(BUILTIN_FONT);
 * const layout = layoutText("Motor 42 °C", atlas, { size: 0.25 });
 * //                                  ↑ not covered — drawn as the fallback box
 * ```
 *
 * Frozen, shared, and built once: two atlases built from it are byte-identical
 * (§33), and nothing in the engine may mutate a face other packages are reading.
 */
export const BUILTIN_FONT: BitmapFont = createBitmapFont({
  name: "four-mono-6x12",
  cellWidth: 6,
  cellHeight: 12,
  glyphWidth: MAX_GLYPH_WIDTH,
  glyphTop: 1,
  ascent: 8,
  firstCodePoint: FIRST_CODE_POINT,
  glyphs: ENCODED_GLYPHS,
  fallback: ENCODED_FALLBACK,
});

/**
 * Resolves one character to a glyph, falling back to the missing-glyph box.
 *
 * `char` is expected to be a single code point's worth of string — what
 * iterating a string with `for…of` yields, so an astral character arrives whole
 * rather than as two lone surrogates.
 */
export function glyphFor(font: BitmapFont, char: string): BitmapGlyph {
  return font.glyphs.get(char) ?? font.fallback;
}

/**
 * Reads one pixel of a glyph in **cell coordinates** — `x` from the cell's left
 * edge, `y` from its **top** edge, both zero-based.
 *
 * Top-down here, unlike everything world-space in §7a, because a glyph's rows
 * are authored top-down and a font's metrics (ascent, `glyphTop`) are quoted
 * that way in every font format there is. The single flip into the Y-up world
 * happens once, in `buildGlyphAtlas`, and is documented there.
 *
 * Coordinates outside the cell, and rows outside the encoded band, read as
 * clear rather than throwing: the caller is a rasterization loop over the whole
 * cell, and a bounds check per pixel it already performed would be pure cost.
 */
export function glyphPixel(
  font: BitmapFont,
  glyph: BitmapGlyph,
  x: number,
  y: number,
): boolean {
  if (x < 0 || x >= font.glyphWidth || y < 0 || y >= font.cellHeight) {
    return false;
  }
  const row = glyph.rows[y - font.glyphTop];
  if (row === undefined) {
    return false;
  }
  return ((row >> (font.glyphWidth - 1 - x)) & 1) === 1;
}

/**
 * Renders a glyph back to `.`/`#` art — one line per encoded row, top first.
 *
 * The inverse of the source table's encoding, and the only readable view of it.
 * Tests assert letterforms against literal art through this function, so the
 * art in `text.test.ts` is the reviewable copy of the font (see the module
 * header). Diagnostics-grade, not a hot path.
 *
 * ```ts
 * glyphToAscii(BUILTIN_FONT, glyphFor(BUILTIN_FONT, "T"));
 * // "#####\n..#..\n..#..\n..#..\n..#..\n..#..\n..#..\n.....\n....."
 * ```
 */
export function glyphToAscii(font: BitmapFont, glyph: BitmapGlyph): string {
  const lines: string[] = [];
  for (const row of glyph.rows) {
    let line = "";
    for (let x = 0; x < font.glyphWidth; x += 1) {
      line += ((row >> (font.glyphWidth - 1 - x)) & 1) === 1 ? "#" : ".";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
