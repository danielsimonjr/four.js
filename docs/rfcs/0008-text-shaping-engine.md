# RFC 0008: §56 full text shaping engine (HarfBuzz-wasm vs native)

- **Status:** Proposed
- **Date:** 2026-09-06
- **Owner decision:** pending
- **Spec sections affected:** §56 (primary), §33, §49, §73, §76, §79, §83, §85, §86, §89, §90, §91, §96, §98

## Context

§56 stages full shaping, bidirectional layout, and ligatures behind a
**shaping-engine decision** — "for example HarfBuzz via WebAssembly versus a
native implementation" — "to be recorded by amendment before that work
begins." `TODO.md` repeats the gate: "Before §56 full text shaping: RFC the
shaping engine." AUDIT-120 **S-6** and MEMORY (2026-07-29, Phase −1) both name
HarfBuzz-wasm as the likely route. This RFC is that decision.

Verified against the tree (2026-09-06):

- `@four/text` is the §56 MVP tier: a built-in 6×12 monospace ASCII face,
  `buildGlyphAtlas`, and `layoutText`. It **produces data, never nodes**. Its
  frozen §3.1 row is `core, math, geometry`.
- `layoutText` is a pen walk: one atlas glyph per code unit, explicit `\n`
  only, no wrapping, no bidi, no ligatures, no kerning. Alignment is
  post-walk. The module header lists shaping as staged on this RFC.
- The `Text` node lives in the umbrella `four` (R-28): one geometry over one
  atlas material. It consumes `layoutText`'s quads. It does not shape.
- `@four/ui` `Label` measures through the same layout. Text *input*
  (selection, caret, clusters) is still blocked on a real shaper (S-6).
- RFC 0004 alternative C was rejected in part because an engine `fillText`
  would pre-empt this decision. That rejection still holds.

Two things §56 names that this RFC does **not** decide:

- **SDF / MSDF rendering.** S-6 separates it: the atlas is coverage bitmaps
  today; crisp scale is a rasterisation problem, not a shaping problem. A
  shaper that emits glyph ids works with bitmap, SDF, or MSDF atlases.
- **Line breaking (UAX #14).** `text-layout.ts` already says wrapping is a
  different packet — it decides where lines *end*, not how a run is shaped.
  A shaper must expose cluster and break-opportunity data so wrapping can
  land later without a second engine choice.

The decision is forced now because every further §56 row (bidi, ligatures,
kerning, rich spans, caret, text-on-path that follows clusters) is a
consumer of one shaping ABI. Picking the engine after those packets would
rewrite them.

## Proposed decision

### 1. HarfBuzz via WebAssembly is the full-shaping engine

The engine for §56's non-MVP rows — complex scripts, OpenType GSUB/GPOS,
ligatures, mark positioning, Arabic/Indic reordering in concert with a bidi
pass — is **HarfBuzz compiled to WebAssembly**, loaded as an **optional**
adapter. It is not compiled into `@four/text`'s default graph and it is not
a §3.1 dependency of `text`, `ui`, or `four`.

Reasons, against the native alternative argued in § Alternatives:

- HarfBuzz is the industry shaper (Chrome, Firefox, FreeType stacks,
  rustybuzz). A first-party "native" shaper that claimed §56 completeness
  would be a multi-year Unicode project the repository is not staffed to
  own.
- WASM is the only form that runs in the browser *and* in the headless
  Node/Bun suites without a native addon. A `.node` HarfBuzz binding would
  split the matrix (browser vs CI) and fail the "engine runs without DOM"
  rule `@four/text` already keeps.
- Same WASM module + same font bytes + same script/language/features is
  **same-runtime deterministic** (§33). Host-OS text APIs are not.

"Native" in this RFC means a first-party TypeScript shaper *or* a
host-OS/ICU binding. Both lose for full §56. A small first-party path
remains as the **default identity shaper** (today's 1:1 code-unit walk) so
the MVP tier and the §86 payload budget do not move.

### 2. The seam is a `ShapingEngine` in `@four/text`

```ts
export interface ShapedGlyph {
  /** Atlas / font glyph id. */
  readonly glyphId: number;
  /** Cluster index into the original string (caret / selection). */
  readonly cluster: number;
  /** Advance in font units (em-relative). */
  readonly advanceX: number;
  readonly advanceY: number;
  /** Offset from the current pen, font units. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ShapedRun {
  readonly glyphs: readonly ShapedGlyph[];
  readonly script: string;
  readonly direction: "ltr" | "rtl" | "ttb" | "btt";
}

export interface ShapeQuery {
  readonly text: string;
  readonly fontId: string;
  readonly script?: string;
  readonly language?: string;
  readonly direction?: "ltr" | "rtl" | "ttb" | "btt";
  /** OpenType feature tags, e.g. `{ liga: 1, kern: 1 }`. */
  readonly features?: Readonly<Record<string, number>>;
}

export interface ShapingEngine extends Disposable {
  readonly name: string;
  readonly version: string;
  /**
   * Load font bytes. Returns a `fontId` the engine minted (monotonic,
   * never a clock — §33). Refuses over `maximumFontBytes` with
   * `UNTRUSTED_INPUT_REJECTED` (§96).
   */
  addFont(bytes: Uint8Array, options?: { maximumFontBytes?: number }): string;
  removeFont(fontId: string): void;
  shape(query: ShapeQuery): readonly ShapedRun[];
}
```

Placement: `packages/text/src/shaping.ts`. No new package. `layoutText`
gains an optional `shaper` / pre-shaped `runs` input; omitted, it keeps
today's identity walk **bit-identical**. That is the R-28 alignment
precedent (the `"left"` path does not run the shift loop).

The WASM adapter (`HarfBuzzShapingEngine`) lives in the same package as a
**separate entry** — `four/text/harfbuzz` or a dynamic import — so a
consumer that never names it does not download the wasm. If the wasm blob
cannot legally sit inside `@four/text` without dragging every importer
(bundler / `exports` map), the packet splits it into a workspace package
**only after** an owner amendment to §98. The default recommendation is
the extra `exports` entry, not a 25th package.

### 3. Bidi is in the adapter, not a second engine

Full §56 requires UAX #9 before HarfBuzz sees each run. The
HarfBuzz-wasm adapter owns that pass (the usual
unicode-bidi / rustybuzz-pre-process pair, compiled into the same wasm or
as a second small wasm loaded with it). Application code does not pick a
separate bidi library. The identity shaper does not run bidi — ASCII MVP
text is LTR, as today.

Vertical directions (`ttb` / `btt`) are declared on the interface so a
later packet can fill them; the first HarfBuzz packet may refuse them
with `UNSUPPORTED_GPU_FEATURE`-style `FourError` (`UNSUPPORTED_TEXT_FEATURE`
or `INVALID_APPLICATION_STATE`) rather than invent a vertical layout.

### 4. Fonts are untrusted bytes

`addFont` is the §96 boundary. Font files are decoded content: finite
`maximumFontBytes` (recommendation: **16 MiB** default, A-23's "a limit
defaulting to `Infinity` is documentation"), no `eval`, no native code.
A malformed table is `UNTRUSTED_INPUT_REJECTED`, not a throw from inside
wasm that escapes as an opaque trap — the adapter catches wasm faults and
re-throws `FourError`.

`@four/assets` may grow a font loader later; this RFC does not add one.
The shaper accepts bytes the application already has. No URL parameter
(RFC 0002 / RFC 0004: a function or a buffer, never a specifier).

### 5. Determinism

Shaping is **in** the §33 envelope when — and only when — the engine,
the wasm build id, the font bytes, and the query are fixed. The packet
pins a wasm build (hash in the adapter) and a golden: known font +
`"fi"` + `liga` → one ligature glyph, bit-identical clusters and
advances.

Host measurement (`measureText`, `Intl.Segmenter` as the *engine*) is
rejected as a shaper: segmenter locale data and font rasterisation differ
by platform. `Intl.Segmenter` MAY be used later for UAX #14 wrapping as
an *optional* host hint, with a first-party fallback; that is the
wrapping packet, not this one.

Shaped advances are **font units**, converted to world units by
`layoutText` using the same `size / lineHeight` scale the MVP already
defines. Conversion is deterministic arithmetic in `@four/text`.

Painted or host-rasterised glyph *images* remain display content (RFC
0004's rule). Glyph **metrics** from HarfBuzz are not: they are a pure
function of bytes. Atlas rasterisation (FreeType, msdfgen, the built-in
bitmap) is a later/other packet and stays out of checksums if it is
host-dependent; the layout quads from HarfBuzz advances may be
checksummed.

### 6. Payload and tree-shaking

§86's minimal 2D app is `core + math + scene + render-webgl` ≤ 150 kB
gzip and does not include `@four/text`. The real risk is **ui-demo** and
any example that imports `four/text`. The identity path must remain the
default export; the wasm must be absent from every bundle that does not
name `HarfBuzzShapingEngine` or `four/text/harfbuzz`.

Published HarfBuzz-wasm builds are typically hundreds of kilobytes gzip.
That is acceptable as an **opt-in** and forbidden as a default. The
packet's A/B measurement (below) is a gate, not a hope.

### 7. What `layoutText` and `Text` gain

- Optional shaped runs → quads (clusters preserved on `TextQuad` so
  caret/selection can land).
- RTL runs reverse the pen walk per run, not per string.
- Ligatures occupy one quad and a cluster range.
- Bit-identical output when no shaper is passed.

The `Text` node and `Label` do not import the wasm. They accept layout
output. An application that wants Arabic constructs a
`HarfBuzzShapingEngine`, `addFont`s, and passes the shaper into layout.

### 8. Staging

**Decision this RFC records (no code).** After acceptance, the first
packet is: `ShapingEngine` + identity default + `layoutText` option +
cluster field on `TextQuad` (additive, default unused) + the wasm
adapter behind a separate export + one Latin-ligature golden + the
§96 font-byte limit + A/B bundle proof.

**Deferred:** wrapping / UAX #14; SDF/MSDF; vertical writing; colour
fonts (COLR/CPAL); variable-font axis animation; a §79 font resource;
`@four/assets` font loader; a 25th package.

## Alternatives

**A. First-party "native" TypeScript shaper.** A Latin kerning table and
a hard-coded `fi` ligature could ship small. It loses the moment §56's
list is read honestly: Arabic, Devanagari, Hebrew, Thai, emoji ZWJ,
mark-to-base — each is a specialist problem HarfBuzz already solved.
Owning a partial shaper that applications will treat as complete is
worse than staging. A first-party path **already exists**: the identity
shaper. That is the native implementation this RFC keeps, and it is
explicitly *not* the full engine.

**B. Host-OS / browser shaping (`measureText`, `Intl`, CoreText,
Uniscribe, DirectWrite).** Nicest visual match to the platform. Rejected:
not same-runtime portable, not available in the headless suites without
a DOM or a native addon, and `@four/text` compiles without `lib.dom`.
RFC 0004 already refused a DOM-typed paint seam for this reason.

**C. rustybuzz (Rust → wasm) instead of HarfBuzz C → wasm.** rustybuzz
is a HarfBuzz subset/port. It is an implementation detail of the
adapter, not a second engine. The packet may pick either wasm *build*
so long as the ABI above is stable and the build is pinned. This RFC
does not freeze the crate vs `harfbuzzjs` vs a custom build; it freezes
**HarfBuzz-compatible shaping** behind `ShapingEngine`.

**D. Make HarfBuzz a hard dependency of `@four/text`.** Simplest import.
It blows the payload budget for every UI label in existence and pulls
wasm init onto the critical path of the bitmap tier. Rejected.

**E. New `@four/text-harfbuzz` package now.** Cleaner graph, but it is a
25th directory not in §98. Rejected until the owner amends the monorepo
tree. The `exports` map (or a later amendment) is the escape hatch.

**F. Delay until SDF lands.** Shaping and SDF are independent (S-6).
Waiting couples a metrics problem to a filtering problem and keeps
caret/bidi blocked for no reason.

## Consequences

**Easier.** A single ABI unblocks bidi, ligatures, kerning, caret
clusters, and (later) wrapping. Applications that only need ASCII keep
the current path with no wasm and no API break. The specification's
"record by amendment" gate becomes a concrete choice.

**Harder.** The project takes a wasm lifecycle (init, fail, version
pin, fault isolation) in a package that today is pure arithmetic.
Font-byte limits and untrusted-table handling become standing §96
surface. Contributors will want to "just import HarfBuzz" from `Label`;
the optional-entry rule will need repeating, the way RFC 0004 repeats
"no `fillRect`".

**Committed to.** Full §56 shaping is HarfBuzz-compatible WASM, optional.
The default engine remains the identity pen walk. `@four/text` stays
data-only and DOM-free. Font bytes are untrusted. No new §98 package
in this RFC. SDF and wrapping stay separate packets.

## Compatibility analysis

Rows in `docs/COMPATIBILITY.md` this RFC moves:

- **Public API (§90).** Additive: `ShapingEngine`, `ShapeQuery`,
  `ShapedRun`, `ShapedGlyph`, optional `layoutText` argument,
  optional `cluster` on `TextQuad`, optional
  `HarfBuzzShapingEngine` on a subpath. **Minor.** Existing
  `layoutText("Motor 42", atlas)` stays bit-identical. No closed
  union widens.
- **Scene format versions (§79).** Unmoved in the first packet. A
  `Text` document already stores string + style, not glyph ids. Shaping
  is recovered at load from the string plus a font key (A-16:
  resources are keys). A font *key* in the document is a later additive
  row if `@four/assets` grows fonts.
- **Plugin API versions (§81).** Unmoved. A shaper is a value the
  application constructs (RFC 0002's preferred shape). No new
  capability token is required; one MAY be added later if plugins need
  to register alternate engines.
- **WebGPU/WebGL / solvers.** Unmoved. Do not regenerate the adapter
  block.
- **Browser/runtime (§90 §1).** WASM is already required for physics
  (Rapier). Shaping WASM is the same class of dependency, optional per
  app. The compatibility table should note "optional HarfBuzz-wasm for
  §56 full shaping" when the packet lands — expected, not a new
  verified-browser row.

## Prototype / benchmark

None run. What the first packet must measure:

1. **Bundle A/B.** ui-demo and first-2d-scene with and without a
   `HarfBuzzShapingEngine` import. Target: **zero gzip delta** when
   unused; wasm + adapter size reported (not gated) when used.
2. **Correctness.** Pinned wasm + Roboto (or another OFL face checked
   into `tests/fixtures`) + `"fi"` / `"لام"` (Arabic lam-alef) goldens
   for glyph ids, clusters, and advances. Same answers on Node and
   Chromium.
3. **Init cost.** `WebAssembly.instantiate` time for the pinned build,
   once, so Application startup guides can say whether to lazy-load.
4. **Layout parity.** Identity shaper vs today's `layoutText` on the
   built-in ASCII corpus: byte-identical quads (the non-regression that
   makes this a minor API change).

## Open questions

1. **Subpath vs §98 package for the wasm.** Recommendation: subpath
   `four/text/harfbuzz` first; amend §98 only if the blob cannot be
   kept off the default export.
2. **Which wasm build?** `harfbuzzjs`, rustybuzz-wasm, or a repo-owned
   build. Recommendation: leave to the packet, with the ABI and the
   pin-hash as the acceptance tests. Prefer a build that includes a
   bidi pass so we do not take two wasm files.
3. **Default `maximumFontBytes`.** 16 MiB vs A-23's 64 MiB texture
   default. Recommendation: 16 MiB — fonts that large are already
   pathological, and a font is more "decoded program-like tables" than
   a raster.
4. **Does `Label` grow a `shaper` option in the first packet?** It can
   pass through to `layoutText` with no new `@four/ui` dependency.
   Recommendation: yes, optional, default omitted.
5. **Vertical text.** Interface-ready, implementation refused until a
   dedicated packet. Confirm.
