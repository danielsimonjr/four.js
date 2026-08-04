# @four/text

Text at §56's MVP bitmap tier. Part of [four.js](../../README.md).

Implements the MVP text tier of §56 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 3a (§106a). Three pieces, each usable on its own; the package **produces data, never nodes** — its dependencies are `core`, `math`, and `geometry` only, so the atlas is emitted in exactly the shape `@four/render`'s `TextureSource` accepts and node assembly happens elsewhere.

## What's here

- **`BUILTIN_FONT` / `createBitmapFont`** — a dependency-free 6×12 monospace bitmap face covering the 95 printable ASCII glyphs, pixels in source (`BitmapFont`, `BitmapGlyph`, `glyphFor`, `glyphPixel`, `glyphToAscii`).
- **`buildGlyphAtlas`** — the face packed into one RGBA8 buffer plus a uv table (`GlyphAtlas`, `GlyphAtlasEntry`).
- **`layoutText`** — a string laid out against an atlas as world-space quads (`TextLayout`, `TextQuad`; baseline-left origin, +Y up).

## Staged / not yet implemented

- SDF/MSDF rendering tiers (staged 2026-08-01, Phase 3a).
- Shaping, bidi, rich spans, and text on paths — full shaping is staged behind a shaping-engine RFC (HarfBuzz-wasm the likely route).
- §55 frame regions are unimplemented in the sprite tier, so a dynamic label currently costs one texture per glyph cell (recorded advisory).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/text`; publishes as `@danielsimonjr/fourjs-text`.
