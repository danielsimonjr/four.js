# @fourjs/text

Text at §56's MVP bitmap tier. Part of [fourJS](../../README.md).

Implements the MVP text tier of §56 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 3a (§106a). Three pieces, each usable on its own; the package **produces data, never nodes** — its dependencies are `core`, `math`, and `geometry` only, so the atlas is emitted in exactly the shape `@fourjs/render`'s `TextureSource` accepts and node assembly happens elsewhere.

## What's here

- **`BUILTIN_FONT` / `createBitmapFont`** — a dependency-free 6×12 monospace bitmap face covering the 95 printable ASCII glyphs, pixels in source (`BitmapFont`, `BitmapGlyph`, `glyphFor`, `glyphPixel`, `glyphToAscii`).
- **`buildGlyphAtlas`** — the face packed into one RGBA8 buffer plus a uv table (`GlyphAtlas`, `GlyphAtlasEntry`).
- **`layoutText`** — a string laid out against an atlas as world-space quads (`TextLayout`, `TextQuad`; baseline-left origin, +Y up).

## Staged / not yet implemented

- SDF/MSDF rendering tiers (staged 2026-08-01, Phase 3a).
- Shaping, bidi, rich spans, and text on paths — full shaping is staged behind a shaping-engine RFC (HarfBuzz-wasm the likely route).
- The one-texture-per-glyph-cell workaround this section used to record was retired on 2026-08-21: every example now draws labels through the `Text` node in `four` (one geometry over one atlas material, one draw per label).

Unit tests are colocated in `tests/` per §92.

Workspace name `@fourjs/text`; publishes as `@danielsimonjr/fourjs-text`.

## Optional shaping (RFC 0008)

The default `@fourjs/text` / `fourJS/text` entry has no wasm import. Bitmap layout
keeps its existing world-units-per-line convention. `IdentityShapingEngine` exposes
that code-point walk, including UTF-16 clusters; identity advances denote cells and
layout uses each atlas entry's pixel advance to preserve existing numbers exactly.
Other engines use 1000 font units/em: horizontal advances and offsets scale by
`size / 1000`. Glyph quad dimensions still come from the application's atlas.

```ts
import { HarfBuzzShapingEngine } from "fourJS/text/harfbuzz";
import { layoutText } from "fourJS/text";

const shaper = await HarfBuzzShapingEngine.create({ wasm: wasmBytes });
const fontId = shaper.addFont(fontBytes);
const layout = layoutText("لا", fontSpecificAtlas, {
  size: 1,
  shaper,
  fontId,
  direction: "rtl",
  script: "arab",
  language: "ar",
  features: { liga: 1, kern: 1 },
});
shaper.dispose();
```

Applications supply the pinned `harfbuzzjs@0.4.13/hb.wasm` bytes or a compiled
WebAssembly.Module. The adapter does no network requests. Font input is SFNT TTF/OTF,
with a 16 MiB default maximum and bounds-checked table ranges. TTC/WOFF/WOFF2 need
application-side conversion. Font IDs are monotonic within each engine. Each font
must have a matching `glyphsById` atlas: the built-in ASCII atlas does not rasterize
arbitrary fonts, and missing IDs deliberately use its fallback box.

`Text` and `Label` accept the shaping options at construction and retain the externally
owned engine. They do not dispose it. Features are copied so mutation of the options
object cannot silently alter a cached layout. Change text/size through existing setters
to invalidate layout; construct another node to change its shaping configuration.

Runs are logical-order records, placed from their right edge for RTL. Direction defaults
to LTR; callers must supply RTL explicitly. This is not UAX #9 bidi resolution. Explicit
newlines break lines; wrapping, vertical text, rich spans and font rasterization remain
separate features. Vertical requests throw `NOT_IMPLEMENTED`. Clusters are UTF-16 indices
in the original source, including the offset of preceding explicit lines.

The fixtures and wasm hash pin deterministic tests. `benchmarks/text-shaping-init.mjs`
records startup and warm shaping cost with host metadata. Initial instances share one
runtime and may benefit from its compilation cache; these are observations, not gates.
