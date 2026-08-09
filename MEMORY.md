# MEMORY

Persistent memory for agents and contributors working across sessions: decisions made, facts
that are easy to lose, and conventions in force. Append new entries with a date; never silently
rewrite a recorded decision — supersede it with a new entry. Tasks go in `TODO.md`; released
changes in `CHANGELOG.md`. **Compaction convention (2026-07-29):** at each phase close (see
the implementation plan), the orchestrator may collapse superseded/expired entries into a
one-line pointer at their original position ("superseded by <date> entry") so this file stays
readable; never delete the pointer itself.

## Standing facts

- The repository is **fully implemented** (implementation plan complete 2026-08-02; this
  bullet said "scaffold only" until 2026-08-05 — it predated Phase 0): 24 packages build,
  test (~3,000 unit + suites + browser/visual), and lint, with ≥95% coverage gates. Five
  packages are deliberate reserved stubs (physics-box2d/soft, render-webgpu/canvas/svg).
- `docs/SPECIFICATION.md` is the working reference — the current revision is whatever tops
  its amendments table (1.6 as of 2026-07-29; this bullet froze at "1.2") (amendments
  table at its top; § numbering 1–120 frozen, lettered sections for insertions).
  `docs/archive/four-js-specification.pdf` is the unmodified original, frozen at the pre-1.0
  text, and still contains the old duplicate numbering — translate its references via the map
  in `docs/ERRATA.md`. Run `node tools/check-spec.mjs` after any spec edit.
- Plain "§N" citations mean `SPECIFICATION.md` numbering. Cite the PDF explicitly when meant
  ("PDF §49, second range").
- All 24 packages under `packages/` are `@four/`-scoped; `four` is the umbrella package.
  Layering: stable `@four/physics` API above solver adapters; backend-independent `@four/render`
  above `render-*` backends; the logical scene never depends on a concrete backend.

## Decisions

- **2026-08-09 — A-18 abort half + A-9 `pointerType`.** Decisions worth keeping:
  - **Cancellation semantics for `AssetManager` (A-18).** Three rules, in source as the
    contract: (1) an aborted load never holds a reference — a pre-aborted signal is
    refused before the cache is consulted, a later abort hands the reference back, and an
    aborted load must therefore never be `release`d; (2) one waiter's abort is not the
    others' — aborting decrements and the request is abandoned only at refcount zero;
    (3) **`release` is not `abort`** — releasing the last reference to a pending load
    still lets it settle. Rule 3 deviates from GAP v0's closure sketch ("the last release
    of a pending load aborts it") on purpose: the caller still holds that promise, and
    rejecting it turns a tidy teardown into an unhandled rejection in application code.
    Cancellation has its own channel because it is the caller asking for the rejection.
  - **A generic type parameter must not reach a class's instance type when the class is
    named in another package's option type (measured).** `AssetManager<TSignal>` with
    `#fetch: FetchLike<TSignal>` makes `AssetManager<AbortSignal>` unassignable to
    `AssetManager`, breaking `ApplicationOptions.assets`. Fix: keep the parameter in the
    _options_ interface (where it forces `fetch` and `abortController` to agree) and
    erase it at the constructor. Generalizes to every future capability-typed seam.
  - **`typeof fetch` IS assignable to `FetchLike<TSignal = never>` =
    `(url, init?: { signal?: TSignal }) => …` (measured).** This supersedes nothing in
    the 2026-08-07 note — that finding was about a _concrete_ structural
    `AbortSignalLike` parameter, which does break it. Generic in, concrete out.
  - **Unknown platform enum values are reported as absent, not refused (A-9).**
    `SurfacePointerEvent.pointerType` is typed `string` (because `lib.dom` types
    `PointerEvent.pointerType` as `string`, and narrowing the seam breaks structural
    assignability — measured); the `"mouse" | "pen" | "touch"` union lives on the scene
    event, and a vendor value or `""` yields an absent field. §85's refuse-don't-clamp
    governs _configuration_, not hardware telemetry arriving mid-gesture: throwing there
    would break input on a device newer than the union.
  - **A pointer's teardown is a property of the device, not of the ending (A-9).** A
    release forgets the pointer unless the device outlives its gesture _and_ has a hover
    worth keeping (a mouse over a node). `pointercancel` ends every pointer regardless —
    the platform withdrew it, and device knowledge must not override that. The retained
    entry cannot re-open §83's leak: a mouse's `pointerId` is stable, and an entry with
    no hover is dropped.
- **2026-08-09 — R-23 §50 shape nodes.** Decisions worth keeping:
  - **The honest tier is fill-only, and the three stroke-only primitives get no class at
    all** — line, polyline and the open arc. Fifth application of
    absent-beats-accepted-and-ignored, and the first where the absence is a whole _class_
    rather than a field. Three independent reasons, not one: §58 is silent, §52 puts
    stroke expansion in `@four/geometry` by name, and a stroke without a join rule is
    _wrong_ at every corner rather than merely plain.
  - **A packet can close a gap by adding nothing to the frame path.** Shapes carry a
    `SurfaceMaterial` and draw through the existing unlit pipeline, so `RenderItemKind`
    was not widened, no pipeline was compiled, `render-webgl` was not opened, and the
    byte-identity argument is a _code-path_ argument. The mechanical form: a scene of
    shapes emits the identical GL transcript as a scene of plain `Renderable`s over the
    same geometries. Reusable technique.
  - **`ShapeMaterial` is deliberately unshipped** — without §58 it is `UnlitMaterial`
    renamed, and it costs either a `RenderItemKind` arm (which RFC 0001 _and_ RFC 0003
    both want, first-to-land owning `pipelineId`) plus 0.75–1.9 kB gzip in every
    `WebglRenderer` bundle, or a discriminant that lies. §57's family list is not a build
    order.
  - **`Node.rotation` is taken** (the §15/§97 live-quaternion alias), so no node subclass
    may have a scalar `rotation`. `tsc` refuses it; vitest does not — third confirmation
    that `pnpm run docs` is the real type gate. The family's name is `startAngle`: where
    the outline begins, from +X, for ellipse, regular polygon, star and sector alike.
  - **§53's validate-against-current-attributes rule has no legal end to swap from** when
    the vertex count changes: dropping indices leaves a non-indexed triangle geometry at
    an arbitrary count, replacing positions leaves indices dangling. **An empty index
    buffer is the configuration legal at every count** — the pivot every derived,
    resizable geometry has to pass through.
  - **§79's validating parse of a §51 path is the builder, replayed** (R-24's
    no-`fromCommands` rule), so a malformed document fails exactly where a malformed call
    sequence does. **Write the arc's _end_ angle, never its sweep**:
    `fl(fl(s+d) − s) ≠ d` for 63% of samples (worst 1.8e-15 rad) and no end angle can fix
    it, but `fl(s + arcSweep(s,e)) === e` in 500 000/500 000 — so the _document_ stays
    byte-exact while the reloaded sweep may move a bit.
  - **A shape parameter is required exactly when it _is_ the shape** (side count, star
    radii, sector angles, ring hole, polygon points, path); everything with an obvious
    unit size defaults to 1. The §79 read side follows the same line: defaulted fields
    restore their default when corrupt, required ones are refused loudly — inventing a
    triangle looks like a bug in the author's data.
  - **A ring's hole is a winding decision, not a second draw**: outer CCW, inner CW, so
    nonzero sees zero inside. Same-winding rings fill the middle twice — invisible under
    an opaque fill, wrong under a translucent one.
  - Measured: registering the nine §79 pairs pulls `Path` + the tessellator into any
    bundle calling `registerSceneNodeTypes()` — **+10.46 kB gzip** on
    `motor-digital-twin`, 0 B on the five examples that do not (hash-identical).
    Composing the pair in anyway is deliberate: a shape that failed to match `nodeTypeOf`
    would save as a bare `Node`, which is A-15's failure mode.
- **2026-08-09 — R-26 §50 SVG path data.** Decisions worth keeping:
  - **A format conformance rule is not an §85 clamp.** SVG 1.1 F.6.6 _defines_ what a
    reader does with a negative, zero, or too-small arc radius; refusing those would make
    valid documents unreadable, which is the opposite of §50's requirement. The line is
    drawn in a table in-source: format-defined normalizations are honoured, malformed
    text is refused with a `SyntaxError` naming the offset. Corollary, and a deliberate
    divergence from SVG: a viewer renders _up to_ the error; an importer must not, because
    that turns a typo into silently missing geometry — nothing parsed is kept.
  - **A `d` parser transcribes; it does not flip Y.** The transform that lands SVG in a
    Y-up world is `y ↦ height − y`, and `height` lives in the `viewBox`, not in `d`.
    Negating alone is _half_ a transform performed silently, and half a correction is
    worse than none because none is visible. Transcription also makes
    `format(parse(d))` a checkable identity — which is what §50's word _compatibility_
    has to mean. The one-liner (`Matrix3().fromArray([1,0,0, 0,-1,0, 0,height,1])`) is
    exact and arcs survive it, because a reflection is a similarity.
  - **An arc's start is authoritative over the segment that reaches it — the finding that
    changed the design.** SVG's `A` begins at the current point _by definition_; §51's arc
    begins where `centre + R(rot)·(rx cos θ₁, ry sin θ₁)` lands, and no centre hits an
    arbitrary point exactly (**measured: ~83% over 200 000 arcs**; `(a−b)+b` is not an
    identity in binary FP). The two ulps became §51's implicit connecting segment pointing
    _back_ along the arriving line — a zero-area spike §52 refuses, making the **rounded
    rectangle** unfillable. Fix: the reader is one command behind and retargets the held
    segment's endpoint onto the arc's start. This is the concrete, unavoidable form of
    R-24's recorded "ulp trap" (an arc's analytic start never equals a hand-written
    `lineTo` to the same coordinates) — an SVG document _always_ writes that `lineTo`, so
    the trap is not avoidable by authoring convention on the import path.
  - **`fromCommands` is still not needed** — export is a read of `Path.commands` plus a
    cursor; import is builder calls. The R-24 decision stands, unamended. The single
    temptation (`Path.ellipse` re-deriving the sweep as `(θ₁+Δ) − θ₁`, ±1 ulp) was
    resisted: the quantity is already same-runtime tier.
  - **A §33 cross-platform claim can rest on ECMA-262 rather than on geometry.**
    `golden/svg-path.json`'s `text` half is exact because decimal→double (≤20 significant
    digits) and `Number::toString` are _exactly specified_, which is why `String(value)`
    is the writer's number format: cross-platform **and** lossless, where any
    fixed-decimal format is neither. Proof is mechanical, two ways (all 2 408 coordinates
    dyadic; every case a byte-for-byte text fixed point). The stated edge is ECMA-262's
    > 20-significant-digit freedom.
  - **A parser's §96 story is one bound plus a structural argument.** No regexes anywhere
    (single forward character-code scan ⇒ O(n) on _every_ input, so ReDoS is impossible
    rather than unlikely); one finite `maximumTextLength`, because the parser recurses
    nowhere and allocates linearly, so bounding the text bounds time, stack and heap
    together — a second limit would be a number with no independent meaning. Totality
    (path-or-throw, three documented error types) is fuzzed, not asserted.
  - Gotcha: **`pnpm graph:duplicates` counts only _exported_ names** (`collectOwnDefiners`
    reads `file.exports`), so a module-private `TAU` beside `path.ts`'s costs nothing —
    but any newly _exported_ helper must be checked repo-wide first.
  - Doc-truth: `packages/geometry/README.md` still said the path model and tessellation
    were "staged / not yet implemented" a day after R-24/R-25 shipped. Package READMEs are
    **not** scanned by `tools/check-docs.mjs` (it walks the root list plus `docs/`) — the
    24 package READMEs are an unguarded doc-truth surface.
- **2026-08-09 — R-18 §69 shadows.** Decisions worth keeping:
  - **§69 ships one tier: the sun's map.** Point/spot carry no `castShadow` at all —
    §69's answer for them is a cube map and a per-light index the single-map tier has
    nowhere to put. Absent beats accepted-and-ignored, fourth application of the rule.
  - **A shadow volume must be authored, not fitted** — auto-fit needs §87's bounds pass
    and makes texel density frame-dependent, which is shimmer §33 forbids. The volume is
    the light's _node_: position matters for shadows even though §68 says it does not
    matter for lighting.
  - **`castShadow` defaults `false` on the light and `true` on the node.** Switching a
    light on buys a whole pass (§61: a renderer does not silently spend that); switching
    a node off is a per-object exclusion. The asymmetry is what makes "enable the sun and
    shadows appear" true.
  - **Byte-identity, fifth confirmation of mirror-at-GL-initial-0** — a `bool` uniform at
    `false` plus a `hasShadow` flag suppressing the pass. The pixel half needs the shadow
    to _multiply the existing product in place_, never a rewrite:
    `direct = lightColor*diffuse; if (useShadow) direct *= f; lighting = ambient + direct`.
  - **`targetRecord !== null` was never the right F13 condition** — it was only
    accidentally right while off-screen frames were the only ones that bound a
    framebuffer. Any new pass that binds one must extend the `framebufferBound` flag, not
    add a second condition. (New instance class: an envelope condition that encodes _why_
    a resource was bound rather than _that_ it was.)
  - **Explicit PCF taps beat hardware `sampler2DShadow`** — compare mode is sampler
    state, so it would couple `gl-render-target.ts`'s cache to what a consumer intends;
    2×2 is a smaller filter than §69 asks for; and a fake GL context can assert
    arithmetic but not what a driver does inside a shadow sampler.
  - **Depth textures are not filterable** — `LINEAR` on `DEPTH_COMPONENT` makes the
    texture incomplete and every receiver reads fully occluded. `NEAREST` is mandatory,
    not a preference.
  - **Measured:** a seventh compiled-at-init pipeline plus a pass costs **~1.9 kB gzip in
    every bundle carrying `WebglRenderer`**, regardless of whether the app uses lights at
    all — R-6's 0.75 kB law at scale. Making §69 opt-in needs a registration seam (A-4's
    define/opt-in), not a smaller shader.
  - **Gotcha (multi-agent, joins the ports set): `ss` is not installed in this
    container**, so port checks must read `/proc/net/tcp`; and orphaned preview servers
    do **not** match `pkill -f "vite preview"` — their cmdline is
    `node .../vite.js preview`. A killed `pnpm test:browser` leaves all nine servers
    running and the next run dies with "port 4173 is already used".
  - **Gotcha, second confirmation of R-38's:** a new required field on `RenderItemBase`
    breaks hand-built item literals only under TypeDoc/tsc, never under Vitest —
    `pnpm run docs` was the gate that caught it.
- **2026-08-09 — R-24 §51 Path.** Decisions worth keeping:
  - **A determinism tier is a property of the operation, not the module** — R-25's
    one-tier rule does not survive §51 (Béziers can be exact, arcs cannot); the honest
    answer is two goldens with two `_tier` labels, because merging them lets a
    transcendental hide inside the weaker claim.
  - **The dyadic-rational assertion is a better tier proof than a digest** — integer
    inputs + power-of-two tolerances make "cross-platform" _checkable_ (`x·2²⁴ ∈ ℤ`),
    not argued.
  - **A canonical model beats a faithful one** — storing the signed sweep instead of
    the raw end angle makes reverse/subdivide/transform one line each.
  - **Analytic-area oracles find winding-sign bugs that reading does not** — all three
    real bugs came from the area tests. The ulp trap: an arc's analytic start never
    equals a hand-written `lineTo` to the same coordinates — author arc-bearing shapes
    with implicit connecting segments. After `close()` the current point is the
    subpath's first point — a _disjoint_ ring needs an explicit `moveTo` (hit twice).
  - **No `fromCommands`** — the builder is the well-formedness invariant every reader
    assumes; §79 gets the validating parse. Offset paths belong to R-16 (an offset at
    a concave corner _is_ the §58 join rule); the four booleans belong to the one
    planar-subdivision packet §52 also needs.

- **2026-08-09 — R-25 §52 tessellation.** Decisions worth keeping:
  - **§52 ships ear clipping, not monotone — the deciding argument is determinism**
    (sweep-line equal-y tie-breaking is where a determinism claim quietly stops being
    true), not simplicity; `PolygonTessellator` is the swap seam.
  - **First cross-platform-tier §33 claim in the repo**: exactly-rounded IEEE ops only,
    squared distances, cross-product signs, integer tie-breaks — no
    `atan2`/`sqrt`/`hypot`. An edit introducing a transcendental there breaks the
    golden's _stated tier_, not just its numbers.
  - **A tessellator must prove its input simple before clipping** — ear clipping fed a
    pentagram succeeds _wrongly_; the O(n²) pairwise proof costs nothing beside the
    O(n²) clip and makes every §85 refusal precise.
  - **Bridged rings are only weakly simple** — the two-ears theorem does not apply;
    the two real bugs (bridge-seam self-veto, stacked bridges) were found by fuzzing
    against an area/winding oracle, not by reasoning. The multi-hole residual
    (~2/1000 refused, never wrong) is documented in-source with the fuzz table.
  - `Point2D` now lives in `tessellation.ts` (export path unchanged). Third
    shared-worktree incident class: **an agent's in-flight file can be silently
    reverted to HEAD by a concurrent process** — verify with `md5sum` vs
    `git show HEAD:` after any unexplained modification notice.

- **2026-08-09 — R-17 §68 multi-light.** Decisions worth keeping:
  - **The bound is the shader's, not the API's** — `MAX_PUNCTUAL_LIGHTS = 8` is a TS
    constant interpolated into the GLSL so the two cannot disagree; a runtime
    `maxLights` would recompile inside a frame (§61 forbids throwing there). Overflow
    order is **authored** (scene-graph), never nearest/brightest — both flicker (§33).
  - **The R-13 irradiance-over-π convention extends to distance**: `color × intensity`
    is the irradiance at _unit distance_ for a punctual light — what lets point and
    directional lights agree at 1 m and mix in one scene. The range window is a
    culling aid, not physics; `range: 0` = unbounded is the honest default.
  - **Byte-identity now has a pixel half**: the GL half is the mirror-at-GL-initial-0
    technique (fourth confirmation); the pixel half requires adding the new term to
    the old expression in source order — re-association moves pixels
    (`viewProjection * model * p` must not become `viewProjection * (model * p)`).
  - **A recorded transcript must be recorded on the reverted build**, never
    hand-copied from a neighbouring packet (four plausible-looking errors).
  - **Never `git stash` in the shared worktree** (now the fourth multi-agent incident
    class): swap your own files with `git show HEAD:<f> > <f>` and restore from a
    scratchpad copy. A shared GLSL chunk is worth real bytes (~400 vs ~700); one
    ungated `console.warn` costs 122 B (vs R-29's five at 330 B).
  - Still exactly one directional light — deliberately; a second sun needs a third
    set-entry kind (the clustered/forward-plus path). Hemisphere is a two-colour
    ambient term beside `Scene.ambientLight`, not a punctual light.

- **2026-08-08 — Spec revision 1.8 (consolidated amendment pass).** All queued
  spec-revisit items applied in one pass; no new lettered sections, `ALLOWED_LETTERED`
  unchanged. Rules that emerged:
  - **A spec section that lists requirements is not stale merely because the
    requirement is unbuilt** — only statements about implementation _status_ are
    amendment targets (why §65/§55/§100 were triaged out while §18/§97a were
    rewritten).
  - **When the spec's own placement of a field is unimplementable under the frozen
    dependency matrix, correct the spec** rather than annotate the source (§54's
    `morphTargetWeights` → `MorphWeights` component, declared spelling kept as an
    accessor).
  - **RFC-derived amendments carry the RFC's status** — §57's `ShaderMaterial` row is
    _provisionally withdrawn, RFC 0001 draft, decision pending_, never settled while
    the RFC is a draft.
  - Gotcha: **"§3.1" in the RFCs/plan is the implementation plan's dependency matrix,
    not the spec's §3.1 ("Scene")** — `check-spec`'s reference check resolves the
    number and cannot catch the confusion.
  - Gotcha: `docs/SPECIFICATION.md` + `docs/ERRATA.md` are hand-formatted and have
    never been prettier-clean (2,128 diff-lines at HEAD) though neither is in
    `.prettierignore`; CI runs no prettier job — treat the spec as prettier-exempt and
    never `--write` it as a side effect (owner call: make the exemption explicit).

- **2026-08-08 — R-29 sprite frames + A-24 context-loss suite.** Decisions worth
  keeping:
  - **A §55 frame does not need authored uv** — it is an affine reparametrization of
    the derived-uv map (`quad.zw = w·tw/fw`, `quad.xy = minX − fx·w/fw`); the `quad`
    uniform survives generalized and its _name_ is load-bearing (an argument of
    `getUniformLocation`). The 2026-08-07 retire-the-uniform prediction is retracted
    in place. A real uv stream remains §65 batching's answer.
  - **Frames are texels, bottom-left origin** — forced by `MaterialTexture.data`'s
    row-0-is-`v=0`; normalized units would make §85's containment check vacuous. A
    frame write re-uploads nothing (the property §55 clips and §86 batching need).
    Named hole: containment is write-time only; a later texture swap samples
    clamp-to-edge (wants R-30's §77 change notification).
  - **Diagnostics cost bytes, measured**: five per-component §85 messages = +330 B
    gzip, more than the feature; two whole-value messages are the trade. ui-demo at
    32.98/33 kB — **20 B left**; next bundle-touching packet needs a proposal.
  - **§61's loss path was correct before it was tested** (A-24: 17 tests, no product
    bug) — the gap was proof, not behaviour. The four remaining uncovered
    render-webgl statements are invariant guards unreachable through the public API —
    do not chase 100% there. `getExtension` on a lost context returns `null` —
    capture `WEBGL_lose_context` before losing.
  - **Owner call recorded:** dispose-after-failed-restore leaks rebuilt programs
    (§83); the obvious `gl.isContextLost()` fix breaks the tested
    not-one-GL-call-while-lost property — deliberately unmade.
  - Serializer follow-up: `Sprite` documents don't yet carry `frame` (one field;
    round-trip passes today because the field is simply absent).

- **2026-08-08 — R-38 §46 layers.** Decisions worth keeping:
  - **Layers are self-only, never subtree** — a layer is identity, not state (off-ness
    inherits; belonging doesn't); subtree gating is strictly less expressive (a `"ui"`
    node could not carry a `"default"` child); changing a layer can never make
    something _else_ disappear. `applyLayers` is the subtree spelling (the
    Three.js/Unity model).
  - `Camera.layers` **overrides** `Node.layers` — safe because nothing reads a
    camera's membership. The registry is **module-level, not per-Scene** (nodes exist,
    move between scenes, and deserialize before their scene is assembled).
  - **§46 requires names in scene files, never bits** — round-trip is `layerNames()`
    out, `resetLayers()` + replay in saved order back.
  - **`@four/scene` may not branch on `DEV` at all** (the dev-build suite's blunt §33
    rule for simulation packages) — its §85 check is unconditional; the render tier's
    copy is GATED with a recorded argument (~115 B, the difference between +240 B and
    +120 B).
  - Byte-identity technique, third confirmation: **a permissive default mask makes a
    new filter a no-op on the existing path**, exactly as a `bool` uniform at GL's
    initial `false` did. Gotcha: a new required field on `RenderItemBase` breaks
    hand-built item literals only under TypeDoc/tsc, not Vitest.

- **2026-08-08 — A-6 composition root.** Decisions worth keeping:
  - **A world cannot be an option-record here** — `four/application` importing
    `@four/physics` puts a solver in every UI bundle; §45's `PhysicsWorldOptions` form
    waits for a world front-door the way `renderer: "auto"` waited for §62's registry
    (third deferred-string-selection instance; the import is type-only).
  - **The factory form exists because `PhysicsWorld` takes `poses` at construction** —
    an instance-only option would ship an `app.physics` that silently cannot
    interpolate (§43). **Ownership follows construction, in both directions** (§83).
  - `reducedMotion` resolves through the injected source **on every read, never
    cached**; a boolean short-circuits the source. `autoResize` defaults true iff an
    observer was supplied — an observer is never accepted-and-ignored.
  - `contacts` stays staged: the world publishes §29 _events_, not a live manifold
    count — differencing them answers a different question (§37 seam needed).
  - **Measured gotcha (third cannot-tree-shake instance):** naming one leaf function
    in `debug-draw.ts` cost 939 B gzip (module-level scratch + frozen lists);
    producers belong in the module of the record they write. Spec-revisit: §97's
    "a world is built and tracked, not an app option" is stale after A-6.

- **2026-08-08 — R-15 §60a colour management.** Decisions worth keeping:
  - **The working-space policy is written down once** (`@four/math` `color.ts` header):
    material/light/vertex colours _are_ linear-light — no per-value tag (it would have
    one legal value); §60a's metadata lives on _resources_ only (textures §77, targets
    §63).
  - **The output transform is a pass, never a per-material encode** — §60a's "is the
    final render-graph pass" selects the design (a per-shader encode would encode five
    times into one framebuffer and blend between draws in the wrong space).
  - **Both new defaults are `"linear"`** (deviating from §60a's sRGB texture default),
    so opt-in preserves every golden — owner decision to flip + move goldens
    deliberately. Alpha never runs through a transfer curve; nothing clamps (odd
    extension).
  - **§101's mapping row settles the CSS-string-options question** — §59/§68 show
    strings in _examples_, §101 pins tuples as the shipped tier; not widened;
    `srgbToLinearRGBA(parseColor(css), out)` is the one-line path (owner may widen).
  - Byte-identity technique, reconfirmed twice: a second `bool` uniform seeded at GL's
    initial `false` costs nothing; an optional resource field read as `?? "linear"`
    keeps every pre-existing double on the old call. §86 gotcha: effect-program GLSL
    ships in every backend bundle — the encode was inlined to fit ui-demo at
    31.99/32 kB.

- **2026-08-08 — §119 motor digital twin.** Decisions worth keeping:
  - **§84 is readable only _after_ `app.step` returns** — `step` resets the record on
    entry; reading from the `update` event gives all-`NaN` (measured).
  - **An instrumented example must not define `__FOUR_DEV__: "false"`** — A-4 gates
    `Application.stats` on `DEV`; a page about instrumentation cannot ship the build
    that strips it. The twin is the one documented dev-build example.
  - **A derated actuator is a second controller's `outputLimits`, never an external
    clamp** — clamping after `update` + `ki = 0` removes the accumulated term from the
    output too and produces a two-step limit cycle (measured: command alternating
    8.7/14.0 rad/s); §111's own anti-windup solves it exactly.
  - Short horizontal `GL_LINES` segments are dropped by the diamond-exit rule —
    decimate chart traces below ~4 px/segment. A rebuilt text line must `dispose()`
    its removed sprites or it leaks one geometry per character per rebuild (measured:
    953 kB → 1.44 MB before the fix).
  - Two coaxial hinges are stable on Rapier 3D over 900 steps with a contact fault
    applied and released. `collectBodyOrigins`' default cross size confirmed unusable
    in 3D a second time; an over-long cross projects across the frame off-axis.
  - **Index-race gotcha (second occurrence):** an agent staging files for
    check-docs' `git ls-files` + the orchestrator committing another batch sweeps the
    staged files into the wrong commit (dc8e1ae carries an intermediate twin
    snapshot; superseded by the twin's own batch). Rule: `git reset` before every
    selective staging, always.

- **2026-08-08 — A-27 §86 benchmarks (CPU tier).** Decisions worth keeping:
  - **A §86 row with a measurable CPU half and a blocked draw half is recorded as
    `half`, never as measured** — the benchmarks README now has that third category
    beside `hardware` and `feature`.
  - §86 states the retained-UI and animated-glyph rows as **counts with no rate**;
    60 Hz is an interpretation borrowed from neighbouring rows and must be labelled as
    such wherever it appears.
  - **The runner asserts on no timing** — exit 1 = a benchmark failed, exit 2 =
    operator error; a timing threshold would be the back door the benchmarks README
    forbids. Process-per-script is deliberate isolation (JIT, heap, throw containment).
  - **Gotcha:** a committed benchmark record may not contain a short array of scalars —
    Prettier collapses it while `JSON.stringify(…,null,2)` expands it, so the format
    gate fails; use an object (written into the README's Results section).
  - The 2026-08-08 re-records were taken on a loaded shared host; `physics-step`'s
    +24% is explicitly non-attributable — re-record on a quiet host before reading any
    trend.

- **2026-08-08 — PH-22 sweep.** Decisions worth keeping:
  - **A composite shape is a legal collider and an illegal §30 query shape** — Rapier
    answers _wrongly_ (zero intersections) rather than failing; `validateQueryShape`
    refuses them at all four adapter query entry points.
  - **§24 `compound` is deliberately not a tag** — several colliders on one body,
    runtime-assemblable since PH-5; Rapier models it the same way.
  - `jointMotorEffortCap` is the first capability field whose `false` means "applied,
    _differently_" rather than "not applied" — documented as such.
  - The per-property Rapier joint survey replaced the blanket freeze claim;
    `collisionEnabled` was the only mutable-with-throw property (base-class
    `setContactsEnabled`), the rest are `readonly` compile errors.
  - **A diagnostic threshold sits a decade past the guide's advice** so it never
    becomes routine (§41 warnings: 1e5 origin, [1e-2,1e3] dynamic extents, 1000:1
    mass ratio; static/kinematic exempt from the extent check).
  - Heightfield facts measured, not assumed: `heights` is column-major with row→local
    Z, column→local X (the opposite of the intuitive reading); the public shape counts
    samples, the adapter subtracts one. Gotcha repeat: vitest doesn't typecheck —
    three test-only type errors only surfaced at `pnpm run docs`.

- **2026-08-08 — R-13 StandardMaterial.** Decisions worth keeping:
  - **The radiometric convention is now written down**: light colour × intensity is an
    irradiance already divided by π — neither lobe carries a `1/π`. This is what makes
    `LitMaterial` and `StandardMaterial` composable in one scene, and the constraint
    any future BRDF must honour.
  - Defaults are `metalness: 0` / `roughness: 1` (three.js's, not glTF's 1/1) — a glTF
    importer assigns both explicitly, so it cannot inherit the difference.
  - Ambient reaches the diffuse lobe only (no IBL; a metal under ambient alone renders
    black, honestly); roughness is floored in the shader (0.045) where the 0/0 lives,
    not clamped in the material.
  - `SurfaceMaterial` deliberately NOT widened (would strip `color`/`setColor` off
    every ordinary renderable's material type — the `SpriteMaterial` exclusion
    argument); inference handles `new Renderable(geo, new StandardMaterial())`.
  - The duplicate-symbol gate is load-bearing — it refused a second `ColorRGB`; the
    shared RGB tuple alias belongs in `@four/math` with R-15.
  - ui-demo budget 31 → 32 kB on the R-6-style structural proof (compile-at-init
    alone was 547 B over); two consecutive pipeline additions absorbed — A-4's
    build-time pipeline-selection seam is the structural fix.

- **2026-08-08 — Gotcha (multi-agent, joins the rebase/stash/ports set): a batch that
  lands code without touching a tracking file is undiscoverable within a day.** The
  `ab13840`/`fe8eb6f` closures (nine gap items) were invisible to every later agent
  and to the gap document until the v1 rewrite re-verified them in source — the
  analysis's own A-28 failure mode aimed at itself. Rule: no batch commits without its
  CHANGELOG entry and gap banner in the same commit. Also: `docs/GAP ANALYSIS v1.md`
  supersedes v0 as the working gap document (v0 kept as history with a pointer).

- **2026-08-07 — A-4 dev/prod builds.** Decisions worth keeping:
  - **Dev is the default; you opt out** — `typeof __FOUR_DEV__ !== "undefined" ?
__FOUR_DEV__ : true` in one file (`@four/core` `dev.ts`); the identifier is never
    read outside `typeof`; un-bundled runs (tests, determinism) are dev automatically.
  - **The flag may remove work, never change a number (§33)** — enforced by the
    `GATED` allowlist in `tests/integration/dev-build-mode.test.ts`, not prose;
    simulation packages refused outright. **Guard at the call site** — the helpers'
    internal early-return only stops the console write, not message construction.
  - **Gotchas (measured):** a private class method cannot be tree-shaken off a class
    (empty it with a leading `if (!DEV) return;`); a top-level _call_ survives
    tree-shaking without `/* @__PURE__ */`; storing the option beats storing the
    resolved value when the default lives in a package production drops.
  - **§83's leak check is an audit you call, not a watcher** — a growing counter is
    not a leak; only the caller knows which span should balance. §85's asymmetry is
    deliberate: `devAssert` skips entirely in production; every `FourError` stays
    unconditional. R-6's pipeline is NOT dev-gated — `renderEffect` is a production
    feature; its cost needs a registry split.
- **2026-08-07 — §118 flagship.** Decisions worth keeping:
  - **A screen-space UI is a camera child until §46 layers land** — §48's `layerMask`
    is deferred, so a second viewport would draw the whole scene twice; camera
    parenting gives screen-space behaviour, one pass, and working §71 picking (first
    perspective pick in the repo, measured).
  - **A browser gate must not re-derive §74 layout** — the page publishes
    `data-controls` in canvas pixels and the spec validates the claim via `data-hover`
    before clicking. `page.mouse` needs `boundingBox()` added (canvas-relative vs
    viewport is the trap; measured offset).
  - **Pause is exactly 0 changed pixels**; single-step is exact because the
    accumulator is public (`fixedDeltaTime − accumulator + 1e-6` runs exactly one
    step, and `fixedStepsLastFrame` lets the claim be checked, not trusted).
  - `data-*` published with `toFixed(4)` cannot support `toBeCloseTo(…, 4)` — two
    roundings carry 1e-4. Particle hue counts swing 5× with burst phase — thresholds
    must be set at "never ran", not "typical".
  - **`registerRapierSolver()` pulls both wasm images** (1.54 MB gzip vs 0.69 for one
    adapter) — the measured price of `solver: "auto"`; per-dimension registration is
    the recorded fix.
  - Gate repair: `generate-compatibility.mjs` now requires an upper-case initial on
    `*Adapter` exports (the `createRapierAdapter` factory turned check-compat red at
    HEAD for ~5 commits until the flagship's gate run caught it).
- **2026-08-07 — A-5 §83 resource accounting.** Decisions worth keeping:
  - **Numbers, not references** — a tracker holding its resources would _be_ the leak;
    `WeakRef`/`FinalizationRegistry` answers "was this collected?", not §83's "was this
    disposed?", and non-deterministically.
  - **A resource dropped without `dispose()` is never subtracted** — a self-healing
    counter would hide the leak signal it exists to show; §83's contract is explicit
    lifetimes and the accounting refuses to be more forgiving than the spec.
  - **"A disposed resource holds nothing"** (`byteLength → 0`) — one rule makes
    double-dispose, resurrection-by-setter, and delta arithmetic all fall out.
  - **Levels, not per-frame counters** — `textureMemory`/`bufferMemory` describe the
    engine, not the frame; reported with or without a renderer; an accounting of what
    the engine holds and would upload, not GPU residency — stated on the fields.
  - **Not every seam needs a transcribed shape** — `ResourceMemoryLike` was built then
    deleted (no producer-owned record exists); `recordResourceMemory(stats, tex, buf)`
    is allocation-free by construction. Duck-typed-contract count stays at five.
  - **Gotchas (measured):** folding accounting into `markDirty()` with an
    `#accountedBytes` field is _larger_ minified and puts byte math on a per-frame
    path — don't retry. A-5 costs +0.22 kB gzip; ui-demo at 30.96/31 — A-4's
    `__FOUR_DEV__` is now the practical blocker for the next four/ui-touching packet.
- **2026-08-07 — A-16 remainder (drawing-tier §79 pairs).** Decisions worth keeping:
  - **Resources are keys, not payloads, and the catalog is a seam not a format** — §79
    mandates key-plus-manifest; the manifest needs A-18 content hashing, so what ships
    is `SceneResourceCatalog` (`keyOf`/`get`, method syntax for bivariance per the
    `ComponentSerializer` precedent; a bare `Map` is a valid read catalog), which a
    manifest later implements.
  - **`unknownResources: "skip"` is write-side only** — A-15's symmetry does not
    survive here: a component can be dropped and leave a valid node; a `Renderable`
    cannot default its resources without inventing ones the application must dispose
    (§83). A _node_-level skip is inexpressible through `nodeTypeOf`/`nodeDataOf`
    (per-node data, not a filter) — recorded.
  - **Material kind is checked for `Sprite` only** — `Renderable<M>` is generic on
    purpose; a read-side kind whitelist would make `Renderable<GlowMaterial>` savable
    and unloadable. Dispatch is on the §57 discriminant, never `instanceof`.
  - **Type names are `<package>:<class>`** (extends `ui:*`); the prefix is a namespace,
    not an import path — rev 1.3 already moved cameras between packages and a published
    name must outlive that. Camera documents carry no `depthRange` (renderer-owned,
    §47).
- **2026-08-07 — Auto-selection registries (A-8/R-2/PH-19).** Decisions worth keeping:
  - **The WP-3.6/§45 departure is retired, not reversed** — §45's string works as a
    _widening_; `four` still never imports a backend. Payload measured both ways:
    instance +0.2–0.3 kB gzip, `"auto"` +0.78 kB paid only by the asker.
  - **Explicit registration calls, never side-effect imports** — forced by
    `"sideEffects": false` on all 24 packages (a side-effect module is _correctly_
    deletable). Applies to every future registry in this repo.
  - **`resolveRenderer`/`resolveSolver` must never statically reference their registry
    class** (lazily-created module `let`) — the single discipline keeping registries
    and backends out of instance-naming bundles; breaking it silently regresses every
    example.
  - **§62's diagnostics event is a callback in both tiers** (`onFallback`/
    `onSolverReject`) — §3.1 gives neither `render` nor `physics` a diagnostics edge.
  - **`isSupported` must never touch the caller's canvas** — a probing `getContext`
    would fix the context attributes and silently disable `antialias`; the probe is an
    environment question, `initialize` is the real gate, and `"auto"` recovers from its
    failure.
  - Renderer `"auto"` uses §62's order (registration order ignored — §33); solver
    `"auto"` uses registration order (§37 fixes no preference); the headless tier is
    never auto-selected; a _named_ solver is handed back unfiltered so `PhysicsWorld`
    reports mismatches with its own precise message.
- **2026-08-07 — PH-9 AnimationController.** Decisions worth keeping:
  - **The controller is a pose evaluator, not a mixer scheduler** — cross-fades need
    two clips writing one property at once, which the mixer's claim semantics call a
    conflict; the controller owns one channel per path, blends via `ValueAdapter`, and
    writes once under one claim in the same §16 registry.
  - **Un-animated channels contribute the `play()` baseline** — the pose is a pure
    function of (state, time, weight); a controller pins every channel it owns.
  - **Typed predicates over the string DSL** — a parser is a second §33 surface; the
    sugar can compile to the records later. `exitTime` is seconds of source-state time
    (§7a), a gate not an instant. Interruption freezes the outgoing pose (captured
    through the same blend path). No `seek` — a machine's pose is a function of
    history; §34 replays deltas. Controllers are never `finished` and are deliberately
    not §6a components / not serialized (§18 constructs directly; `Node.animation` is
    unshipped per §97a).
- **2026-08-07 — R-6 post-processing (full-screen effect tier).** Decisions worth
  keeping:
  - **An effect is a graph pass kind, not an escape-hatch pass** — a pass whose
    sampling is a _field_ is validated exactly with no traversal; expressing §70
    through `CustomRenderPass` would be unvalidatable exactly where feedback and
    ordering mistakes live. That asymmetry, not convenience, is the argument.
  - **A second verb keeps the first byte-identical** — `renderEffect` is a separate
    entry point; `render` was not edited; the frame transcript is identical modulo a
    constant handle-serial shift of exactly 6. Routing effects through `render` would
    put a branch in the loop R-4/R-5/F13 each had to re-prove.
  - **Closed unions are the staging mechanism** — `ScreenEffect` is
    `"copy" | "grade"`; `{ kind: "bloom" }` is a compile error, and the backend skips
    an unknown kind rather than quietly copying (a JSON value must not become a
    different picture). R-14's RFC widens the union.
  - **Copy is bit-exact** (`useGrade` seeded at GL initial `0`, zero uniform traffic on
    copy chains) — what makes the blit usable as §63's debug view.
  - **Measured gotcha:** a fifth compiled-at-init pipeline costs **0.75 kB gzip in
    every example bundle** — nothing reachable from a class method tree-shakes
    (second instance of A-1's cannot-tree-shake class). Even a stubbed `renderEffect`
    exceeded ui-demo's 30 kB by 99 B, so the budget moved to 31 kB (owner-recorded
    trade; §86's 150 kB untouched). A-4's define/opt-in seam is the eventual fix.
  - `renderEffect` does **not** reset the §57 mirror — it borrows only the depth test
    and restores exactly that, strictly more conservative than `render`'s
    reset-on-entry.
- **2026-08-07 — §40 UnitSystem (A-2/PH-13).** Decisions worth keeping:
  - Shipped in `@four/core` as a **conversion tier, never an engine mode**;
    `tests/integration/units-display.test.ts` mechanically forbids any package source
    outside `@four/core` from importing it (visible `ALLOWED` allowlist) and proves
    helper-authored values bit-identical to engine-unit authoring.
  - `"custom"` = "the display unit _is_ the world unit" (exact identity) and has **no
    symbol** — §40's two under-specified points, decided rather than guessed.
  - **No `ApplicationOptions.units`, no `PhysicsWorldOptions.units`** — §45's record
    lists neither; adding one would be inventing API. The physics §41 envelope reading
    `lengthToMeters` is a staged `@four/physics` packet.
  - The conversions are documented as **inexact** (8.8% / 2.5% last-bit divergence for
    degrees / milliseconds over 2 000 samples) — an intentional non-fix; the only safe
    answer is keeping them off simulation paths (§33–§34).
- **2026-08-07 — R-5 render graph (linear-pass tier).** Decisions worth keeping:
  - **The graph is a driver, not a backend** — one pass = one `renderer.render(root,
views, interpolation, target)`, asserted transcript-identical against hand-written
    calls. Re-prove that property after any backend restructure.
  - **Acyclicity by construction beats a topological sort** — inputs must already exist;
    insertion order is execution order (§63's own example is written in execution
    order); a sort would buy reordering nobody asked for and cost "the graph does what
    the list says". `removePass` refused while a consumer names it.
  - **Sampling is discovered, not declared** — `validate()` runs the real
    `buildRenderList` and reads `isRenderTargetTexture`, seeing what the backend sees;
    deliberately setup-time (a `map` reassignment makes any cache unsound; per-frame
    checking doubles traversal).
  - **An escape hatch must report its own opacity** — `CustomRenderPass` always emits an
    `"opaque"` info issue; a graph that stopped being checkable says so.
  - **Correction to the R-4 entry (supersede, not rewrite):** "feedback loops are
    refused, not drawn" holds for _sprites_; for `UnlitMaterial`/`LitMaterial` the
    `map` is refused but the draw survives untextured — one rule for the sample, two
    outcomes for the draw (`webgl-renderer.ts` sprite skip vs `setFeatures(false)`).
  - Clear policy stays on `Viewport` — what makes a compositing pass (no `clearColor`)
    expressible. No new duck-typed contract — the graph reuses `isRenderTargetTexture`.
- **2026-08-07 — PH-5 (runtime colliders).** Decisions worth keeping:
  - **No `node` parameter, no diffing refresh** — `Collider.requireBody()` is the single
    source of truth about which body a collider joins, shared verbatim with `addBody`'s
    subtree scan; a diffing `refreshBody(node)` would be a second rule and a per-step
    cost.
  - **`removeCollider` returns `false`; `addCollider` throws** — removal follows
    `removeBody`/`removeJoint` (unconditional teardown paths); `refreshCollider` throws
    because a silent no-op refresh is invisible. Contrast documented in the methods.
  - **`derivedMass` clears only at zero colliders**, never on a non-positive reported
    mass — §23 forbids reading a solver's 0 as "no mass" (non-dynamic bodies answer 0).
    `setRigidBodyDerivedMass` takes `number | undefined` (package-internal).
  - **The adapters and §34 needed nothing**: F8's kept mass refresh was written for the
    body-survives case, PH-3's heir logic holds, and F8's re-derivation of `colliderIds`
    from the envelope's collider table makes a runtime add snapshot-safe for free —
    proven, not assumed.
- **2026-08-07 — PH-1 stage 2 (live solver writes).** Decisions worth keeping:
  - **A third optional seam, detected structurally, not a seventh capability field** —
    `supportsSolverBodyTuning` is **all-or-nothing** across six methods (per-property
    bits would push a warn table into `RigidBody`). `PhysicsTuningCapabilities` still
    answers "which coefficients apply"; the new predicate answers "can anything change
    after `createBody`".
  - **The dirty set is a bit set, one bit per solver call** (§23's triple one bit, the
    damping pair one). `0` keeps the goldens still — a quiet world makes no extra call,
    proven by deep-equalling adapter `callOrder` with and without the seam.
  - **Draining clears** — a body in two worlds hands writes to whichever steps first
    (§26 command-buffer semantics), chosen over per-world dirty sets.
  - **Colliders cannot be intercepted** (§24/§25 plain public fields) → `refreshCollider`
    is explicit by design; the alternative was shadow-copying six values per collider
    and diffing every step.
  - **`mass = undefined` is permanently unreachable, not staged** — un-authoring means
    restoring collider densities only the registration path holds.
  - **Rapier's live mass write re-runs `resolveMassMode`** and rewrites
    `BodyRecord.massMode`, so live writes and re-registration converge and PH-3's heir
    logic keeps working.
  - **Gotcha:** vitest transpiles without typechecking — a changed package-internal
    signature passes unit suites and only fails at `pnpm run docs`/`tsc`; run the docs
    gate after touching any cross-file signature.
- **2026-08-07 — A-1 §84 statistics.** Decisions worth keeping:
  - **`NaN` means "not measured", `0` means "measured zero"** — the rule that let §84
    ship before all its producers; staged counters are test-asserted to stay `NaN` so
    none can quietly start reading 0.
  - **Presence is the capability**: `Renderer.statistics` is optional; a backend that
    cannot count omits the member instead of reporting zeros. **Backends accumulate,
    owners clear** — a frame may be several `render` calls (off-screen + on-screen), so
    totals only work if the backend never resets.
  - `Date.now` is banned repo-wide (§33) → `createMonotonicClock` has **no fallback**; a
    wall clock in diagnostics is not a §33 violation because nothing there feeds a
    simulation. `FrameStats.simulationTime` is a **duration** (seconds inside the
    frame's fixed steps), not §9's clock — one name, two quantities, settled by §84's
    neighbouring fields.
  - The renderer-counter transcription (`RenderStatisticsLike`) is the **fifth**
    duck-typed contract; a `@four/render` test pins the real type against it.
  - **Gotcha:** `four/application`'s runtime import of `@four/diagnostics` costs
    ~0.4 kB gzip per example even with stats off — the first diagnostic that cannot
    tree-shake; concrete motivation for A-4's `__FOUR_DEV__` define.
- **2026-08-07 — R-4 render targets.** Decisions worth keeping:
  - **A render target is a CPU-side descriptor; the framebuffer is a backend cache** —
    third instance of the `GeometryCache`/`TextureCache` pattern, and why §61's
    `createRenderTarget` stays deferred _by decision_: a renderer-owned target cannot
    exist before a renderer and must be hand-rebuilt after context loss. Loss
    re-allocates lazily; the application is told nothing.
  - **The render-to-texture seam is `MaterialTexture`, not a new type** —
    `RenderTarget.colorTexture` satisfies it, so R-5/R-6 inherit zero adapter work and
    `@four/materials` needed no widening. Backends distinguish via the marker guard
    `isRenderTargetTexture` (4th duck-typed contract).
  - **Target depth defaults `true`** — a depth-less target would composite the same
    scene differently off-screen than on, the exact difference render-to-texture exists
    to avoid.
  - **`bindFramebuffer` belongs inside the F13 envelope** — an FBO left bound by a
    throwing frame sends every later on-screen frame into a surface nobody sees;
    `effectiveGlState` now folds framebuffer binds so all exception-safety tests assert
    it. The byte-identical-sequence property survived a second structural change
    (no-target frames issue _no_ framebuffer call, not even an unbind).
  - **Feedback loops are refused, not drawn** — a material sampling the target currently
    rendered into is skipped like a disposed texture; ping-pong is the supported form.
- **2026-08-07 — A-12 cheap tier (six §73 controls).** Decisions worth keeping:
  - **Radio groups are names scoped to the tree** (the `focusedWidget` scope — one notion
    of "the tree we're in"), enforced **on the transition to checked only**, never at
    construction or attach — §79 documents reload exactly as saved (two radios authored
    `checked: true` stay both-checked until one is re-checked; tested and documented).
    Group-by-parent was rejected because wrapping radios in a layout `Panel` would
    silently dissolve the group.
  - **`Slider` owns its pointer math** (`worldPoint` + inverse world matrix), not
    `DragManager` — §42: the slider's transform is layout-owned; what moves is a number.
    Drag-past-the-track is staged on A-9's captured-pointer `worldPoint: null` decision.
    `resolveValue` is clamp → snap → step-back-if-over-max (the `<input type=range>`
    rule: a step that doesn't divide the range leaves the top unreachable).
  - Checkedness is §75 _state_ on `WidgetStateSnapshot` (`checked: boolean | null`,
    ARIA's absent-vs-false); values flow through `uivaluechange` + the new
    `onContentChange` skin hook — neither layout nor state.
  - `ImageWidget` carries the suffix because `Image` is a browser global that
    `import { Image } from "@four/ui"` would shadow exactly where pictures load.
  - Menu/tooltip staged honestly: a hover delay is a §9 time reading, and the §10 loop
    that owns time lives above `@four/ui` — a tooltip built today would invent a clock.
- **2026-08-07 — R-35 + F7 (diagnostics).** Decisions worth keeping:
  - `diagnostics → geometry` re-confirmed **absent** from the frozen §3.1 matrix; R-35
    closed by emitting `Float32Array`s whose field names (`positions`, `colors`) spread
    straight into `BufferGeometryOptions` — third instance of the duck-typed-contract
    pattern (`ParticleDrawable`, `ReplayTarget`, `DebugGeometrySink`).
  - `debugDrawStreams` deliberately does **not** copy `DebugDrawBuffer`'s
    grow-never-shrink policy: §85 index alignment makes an oversized colour array
    _illegal_, not merely wasteful. The `colors = undefined` → `positions` → `colors`
    assignment order in `applyDebugDrawStreams` is required by `BufferGeometry`'s
    validate-against-current-attributes rule — a shrinking overlay throws in any other
    order.
  - **A version constant that names a bound must say so** (F7): `REPLAY_FORMAT_VERSION`'s
    name silently became false on 2026-08-06 when PH-6 introduced the lowest-version
    rule; renamed `LATEST_`/`MINIMUM_` with a deprecated alias, and existing documents'
    byte-identity is now asserted by a test rather than assumed.
- **2026-08-07 — Render-tier review fixes (F13–F16).** Decisions worth keeping:
  - **F14 policy: validated accessors, unchanged version semantics.** `opacity`/
    `blendMode` are accessors applying the constructor's validation on every write; the
    four boolean §57 fields stay plain (no invalid values). Neither bumps `version` —
    R-12's "render state is read per draw, never cached" stands, and bumping would
    invalidate the geometry/texture bindings that _are_ cached on that counter.
  - **F13 audit: only `glState` was both module-global and frame-scoped** — now
    per-`WebglRenderer`, with the frame in `try`/`finally`. The R-19 program-lifetime
    mirrors (`useMap`/`useVertexColors`/sampler, seeded at GL initial `0`) were audited
    and deliberately left alone — they belong to the program object and survive a throw
    correctly; the byte-identical-sequence property was re-proved (449-call comparison).
  - **Follow-up not taken:** `renderList`/`viewProjection`/`sceneLights`/`rect` remain
    module-global _scratch_ (fully written before read, safe while `render` is
    synchronous and non-re-entrant); a re-entrant `render` would corrupt them
    independently of F13.
  - **Gotcha (multi-agent): the Playwright browser gate is not concurrency-safe** — seven
    fixed-port `vite preview` servers with `reuseExistingServer: false`; two agents
    running `test:browser` kill each other's servers (`ERR_CONNECTION_REFUSED` that looks
    like regressions). Check ports 4173–4179; re-run cut-off specs by path.
- **2026-08-07 — first-3d-scene (S-8 half-closure).** Decisions worth keeping:
  - **A perspective claim must be measured in pixels**: two spheres sharing a geometry
    _instance_ and a material _instance_ at 5.0 m / 10.2 m give a 4.04× area ratio; an
    orthographic camera gives exactly 1.0. A `data-camera` page attribute is context, not
    evidence.
  - **Hue classifiers need every channel pair pinned** — `blue − red` alone let lit green
    `(86,255,143)` pass as violet (5 287 capsule pixels misattributed, measured). The
    palette is stated as byte values in both the example and its spec.
  - **Ergonomics gaps observed, no engine change made**: no `lookAt` on `Node`/`Camera`
    (aiming camera and light is hand-composed quaternions — §44 camera rigs still
    unshipped, roughest edge of the first 3D scene); the 3D primitives' segment-option
    names are inconsistent across the family (`widthSegments`/`tubularSegments`/
    `capSegments`) — candidates for a future naming pass.
  - Gotcha: `vite preview --strictPort` servers survive an interrupted Playwright run —
    kill `vite.js preview` processes before re-running `pnpm test:browser`.
- **2026-08-07 — Closure-review fix batch (24 findings).** Decisions worth keeping:
  - **`KinematicController`'s §79 payload is deliberately empty** (`{}`): no constructor
    options; in-flight commands are simulation state; `followPath` holds a live
    `Trajectory` no document can reference. **Registry completeness is enforced
    mechanically** — `packages/four/tests/scene-serializers.test.ts` enumerates every
    umbrella barrel class carrying `static typeName` (currently `collider,
kinematic-controller, motion, pose-target, rigid-body`) and requires each registered;
    a sixth component fails the suite until registered.
  - **`PhysicsWorld.#destroyRegistration` issues one `destroyBody`** (§37: "destroys a
    body and everything attached to it"), teardown-path-only; adapters keep
    `destroyCollider`'s mass refresh for the body-survives case, and Rapier `BodyRecord`s
    carry `colliderIds` so heir lookup is O(1). The §34 snapshot envelope still writes a
    collider _count_ (format-2 layout pinned); restore re-derives the id list from the
    collider table.
  - `RigidBodyDocument.sleeping` stays write-only diagnostics, now optional on the read
    side — dropping it would move every document's bytes for no reader.
  - The §25 unhonoured-material warning stays registration-time-only, documented in the
    method; moving it belongs to the packet that widens §37 for live material changes.
  - `worldDrivenTypeWrite` is a process-global suppression, safe only while the `type`
    setter runs no callbacks — a setter that gains one must carry its own suppression
    token (hazard paragraph added in place).
  - `wrap: false` traversal exits cost two keystrokes (blur, then pass-through) — the
    one-shot `exited` flag is forgotten by any programmatic focus.
- **2026-08-07 — A-23 (§96 untrusted content).** Decisions worth keeping:
  - **A signal cannot cross the `FetchLike` seam today — measured, not assumed.** Widening
    to `(url, init?: { signal?: AbortSignalLike })` breaks `typeof fetch` assignability
    (contravariant parameters; `RequestInit.signal` is `AbortSignal | null`, and a
    structural stand-in is missing `onabort`/`reason`/`throwIfAborted`/`dispatchEvent`).
    The compatible widening is generic — `FetchLike<TSignal = never>` plus an injected
    `() => { signal: TSignal; abort(): void }` — recorded in `asset-manager.ts` as A-18's
    remaining half. `FetchResponse` **property** widening is safe
    (`headers?: ResponseHeadersLike`) and is how the `content-length` pre-check got in.
  - **§96 guards belong at the text boundary (`decode*`), never at `validate*`** — the
    validators take values the process itself built, so guarding them refuses nothing an
    attacker controls and would bound the recorder's own output. This is what kept every
    golden byte-identical.
  - **Any depth checker must be iterative** — a recursive one overflows on precisely the
    input it guards (proven: the unguarded validators stack-overflow at 50 000 nesting
    generations while `JSON.parse` succeeds).
  - **A limit defaulting to `Infinity` is documentation, not a limit** — all four defaults
    are finite (64 MiB / 30 s / 32 Mi code units / 1024 levels);
    `Number.POSITIVE_INFINITY` is the explicit in-source opt-out.
  - New §89 code `UNTRUSTED_INPUT_REJECTED` ("hostile input") vs the validators'
    `TypeError` ("malformed input"); asset refusals stay `ASSET_LOAD_FAILED`; all carry
    `context.limitName`/`.limit`.
  - **The CSP claim is enforced, not asserted** (`tests/integration/security-csp.test.ts`,
    self-testing matchers) — per the 2026-08-05 doc-truth rule. A package that needs
    `eval` changes the guide first.
- **2026-08-07 — R-19/R-20 (render keystones).** Decisions worth keeping:
  - **Textured meshes are a uniform switch, not shader variants** (`useMap`/
    `useVertexColors` on the one unlit/lit program each): the CPU-mirrored default at GL's
    initial `0` is what keeps an untextured scene's GL sequence byte-identical, which is
    what let R-19 land under the pixel-golden gate. Fixed attribute locations: 0 position,
    1 normal, **2 uv, 3 colour**; `MAP_TEXTURE_UNIT = 0` shared with the sprite pipeline.
  - The material texture contract is `MaterialTexture` (`@four/materials`, `texture.ts`);
    `SpriteTexture` is an alias of it — published name kept, `@four/render`'s `Texture`
    untouched.
  - `extrudeGeometry` **rejects concave outlines when capped** (centroid-fan caps); §52's
    tessellation module lifts the restriction. `tubeGeometry` uses parallel transport, not
    Frenet. `capsuleGeometry.height` measures the cylindrical section only, matching §24's
    capsule collider.
  - Sprite's derived-uv path deliberately not rewritten — identical mapping makes a
    rewrite unfalsifiable by the goldens; §55's atlas packet owns it (dated note in
    `sprite.ts`).
  - Gotcha (repeat offender): **never `git stash` in the shared worktree** — the keystone
    agent's baseline-comparison stash swept another agent's in-flight files for ~9 minutes
    (restored and verified, nothing lost). Same lesson as the rebase incident.
- **2026-08-07 — A-25: §94 machinery built, publish owner-gated.** Changesets config
  hand-authored (no `changeset init`, no lockfile change); `release.yml` calls `ci.yml`
  via a new `workflow_call` trigger so a release clears exactly the PR gates; publish is
  inert without `NPM_TOKEN`. Two standing facts discovered:
  - **The §98 rename must include emitted code.** `dist/*.js` and `.d.ts` carry
    `from "@four/core"` — renaming only manifests would publish 24 mutually-unresolvable
    packages. `apply-publish-names.mjs` rewrites quoted workspace specifiers in staged
    code (405 sites), resolves `workspace:` ranges, and publishes from the staging tree so
    the checkout is never renamed.
  - **The five reserved stubs cannot be Changesets-`ignore`d** while `four` depends on and
    re-exports them (validation error reproduced). `ignore: []` until the owner decides
    the packaging question (publish stubs / drop subpaths / optional peers).
- **2026-08-07 — A-26 closed: §90 compatibility tables.** `docs/COMPATIBILITY.md` carries
  the five tables. The solver-adapter section is **generated** between
  `<!-- BEGIN/END GENERATED: solver-adapters -->` markers by
  `tools/generate-compatibility.mjs` from live `PhysicsCapabilities` instances — never
  hand-edit it. The generator imports the built `dist/` (deliberate: a source parse would
  re-implement a const evaluator) and pads tables exactly as Prettier does, so `--check`
  and `prettier --check` agree — changing one convention without the other breaks the gate.
  The Rapier snapshot envelope version (2) is module-private and therefore hand-cited in
  the format section, not generated — the one number there that can drift.
- **2026-08-07 — Gotcha (concurrent agents + rebase): `git rebase` with autostash while
  agents hold uncommitted work wiped their in-flight files** (autostash carries tracked
  edits but the reset window still clobbered untracked files mid-write; the A-26 agent had
  to rebuild from a scratchpad backup). When the remote moves during a multi-agent wave,
  prefer: let agents finish → commit their batches → rebase once, or snapshot untracked
  work first.
- **2026-08-07 — GAP-CLOSURE WAVE 2: keyboard tier (A-10 done, A-13 keyboard half).**
  `KeyboardInput` in `@four/input`, traversal + activation in `@four/ui`. Decisions:
  - **Focus crosses `ui → input` as an injected resolver** — `KeyboardInput(surface,
{ focusTarget: () => Node | null })`. `@four/ui` supplies `keyboardFocusTarget(root)`;
    `@four/input` never imports it. §3.1 stays frozen; a `null` answer dispatches nothing
    (the analogue of a pointer that hit nothing).
  - **Three-phase dispatch is shared machinery** (`packages/input/src/propagation.ts`):
    `SceneInputEvent` base + `dispatchThreePhase(event, path, type, captureKey)`. The two
    listener keys are _arguments_ typed against `NodeEventMap` — no `"capture:" + type`
    string concatenation, no cast. `dispatchPointerEvent` delegates to it; its public
    surface (and `ScenePointerEvent`'s members) is unchanged.
  - **`SceneKeyEvent.preventDefault()` forwards to the platform event** through an optional
    `KeyDefaultSuppressor` — default-suppression (Tab/Space mean something to the host) is
    deliberately separate from `stopPropagation`.
  - **Traversal sorts `accessibility.tabIndex` plainly ascending** (ties by scene order,
    stable sort; negative opts out of traversal but stays programmatically focusable) —
    deliberately _not_ the DOM's positive-before-zero rule, which exists only because HTML
    interleaves with a document order it cannot see. `tabIndex: 0,1,2` means what an author
    intends.
  - **Enter/Space live on `Button`; Tab lives on the tree** (the DOM's split). Both
    activation keys fire on `keydown` — the DOM's Enter-down/Space-up asymmetry is a stated,
    deliberate simplification. `WidgetActivationSource` is an open union; adding
    `"keyboard"` was additive.
  - `keypress` is deliberately unimplemented (documented in `key-events.ts`); wheel, gamepad,
    XR, and focus/blur-as-input-events are recorded in `packages/input/README.md`.
- **2026-08-06 — GAP-CLOSURE WAVE 1 (A-7, A-9, A-14/PH-17 partial, A-15, A-17, PH-6).**
  Six `docs/GAP ANALYSIS v0.md` items closed, each with regression tests. Decisions worth
  keeping:
  - **A-9 (`PointerInput` leak).** Per-pointer state is now deleted on `pointerup` _and_ on
    the new `pointercancel`; `pointercancel` joined `PropagatingPointerEventType` (and
    `DragManager` ends a drag on it). **Known behaviour change:** because
    `SurfacePointerEvent` carries no `pointerType`, a mouse release now also fires
    `pointerleave` and the next move re-fires `pointerenter`. That is right for touch/pen
    (the contact ceased to exist) and a regression for the mouse; retaining a mouse's hover
    needs `pointerType` on that structural interface and is left to the packet that widens
    it. `PointerInput.trackedPointerCount` was added so the leak stays testable.
  - **A-15 (silent component drop on save).** `Node.components` forwards §6a's registry;
    `serializeComponents` walks the node and emits in _registry_ order, so output ordering —
    and therefore every byte-identical golden — is unchanged. Unserializable components now
    throw `INVALID_APPLICATION_STATE`; `SerializeSceneOptions.unknownComponents: "skip"`
    mirrors the read side.
  - **A-17 (id collisions).** `NodeOptions.id` restores an id at construction and _reserves_
    it against the module counter; `restoreNodeId` moved from `@four/serialization` (where it
    cast a foreign class's `readonly` field) into `@four/scene`, which owns the field, for the
    `nodeFactory` path that cannot use the constructor. `instantiateScene` refuses a document
    that produces one id twice with `INVALID_SCENE_GRAPH`.
  - **§79 node data (enabling change for A-14).** `SceneNodeDocument.data` + the
    `SerializeSceneOptions.nodeDataOf` writer carry one opaque JSON value per node — the seam
    A-16 records as missing, and the only place a widget's box model could go without
    polluting §6's user `metadata`. Absent unless a writer produces one, so every document
    written before it encodes byte for byte as before; `SCENE_FORMAT_VERSION` is unmoved.
  - **A-14/PH-17 (partial).** `MOTION_COMPONENT_SERIALIZER` ships from `@four/motion` against
    a structural `ComponentSerializerShape` (no new §3.1 edge, the `ParticleDrawable` pattern);
    `registerSceneNodeTypes()` / `registerUISerializers()` ship from the umbrella `four`
    package, which is the only place allowed to see `ui` + `serialization`. **`RigidBody` and
    `Collider` serializers are the follow-up** — they belong in `@four/physics`, which this
    change could not touch.
  - **PH-6 (§34 world configuration).** `ReplayRecording.worldConfiguration` carries §34's
    "solver settings", captured off `ReplaySnapshot.configuration` at `begin` and re-attached
    by `ReplayPlayer.#snapshotAt`, so `PhysicsWorld.restoreSnapshot`'s field-by-field refusal
    finally fires on the replay path. **Versioning rule: a document declares the lowest
    version that can express its content** — `2` with a configuration, `1` without — so
    `REPLAY_FORMAT_VERSION` is 2, `SUPPORTED_REPLAY_FORMAT_VERSIONS` is `[1, 2]`, and every
    existing version-1 recording still validates _and re-encodes byte for byte_.
  - **The phase-10 golden was amended, envelope only, with proof.** `recordingDigest`
    2642391973 → 1754656889 and `recordingLength` 46822 → 47008 (+186 bytes); _nothing else
    moved_ — `initialSnapshotDigest`, both checksum-stream digests, `seekTailDigest`, the
    first/last/final checksums and every contact count are bit-identical to the 2026-08-02
    record. The claim was proved, not assumed: re-running the scenario with the capture
    neutralized (a wrapper dropping `ReplaySnapshot.configuration`) reproduces the old digest
    and length exactly. The golden carries that proof in a new `_amended` field, and gained
    `formatVersion` / `worldConfigurationKeys` so the §34 configuration is now pinned too.
  - **`Application.resize(width, height, resolution?)` (A-7).** Records the size, forwards to
    `renderer.resize`, and updates the `aspect` + projection of perspective cameras on
    _full-surface_ viewports only (`normalized` `(0,0,1,1)`) — §61 says the aspect is the
    application's to set and this class is the only thing that knows the viewport→camera
    mapping. `ApplicationOptions` gained `width`/`height`/`resolution` and a `depthRange`
    (D8) for the projection rebuild. Orthographic extents and partial viewports are left
    alone, deliberately.

- **2026-08-05 — DOC-TRUTH GATE (`tools/check-docs.mjs`, `pnpm check-docs`, wired into CI
  next to `check-spec`).** A sweep found prose claims that were false when written and
  survived for months, because prose has no type checker: `ROADMAP.md` still said "nothing
  on this roadmap has shipped yet" three days after the plan closed; `README.md` said
  "42/43 … lighting is the single staged absence" after lighting shipped;
  `docs/AUDIT-120.md` claimed "10 example applications" when six exist (the other six
  `examples/*` directories hold a `.gitkeep` — now staged as **S-8**), called
  `tests/visual/` "an empty placeholder" after a golden suite landed there, and called
  sprites "batched" when the WebGL backend draws one per draw call;
  `playwright.config.ts` said "There are no golden images" after the `visual` project
  landed; `materials-and-render-graph.md` described a sort by "layer, then kind, then
  material" that `compareRenderItems` has never implemented (it is `renderLayer` then
  `renderOrder`, stable-sorted); `custom-shaders.md` said "three" internal GL programs
  after `LitProgram` made it four. **Standing rules from this:** (1) any count in prose
  that the filesystem can decide must be pinned mechanically — check-docs compares
  AUDIT-120's example count against `git ls-files`; (2) a doc may name an empty
  `examples/*` directory only in a block that also carries the marker "not yet written;
  directory is a placeholder"; (3) corrections are **dated in place**, quoting the
  superseded wording, and check-docs re-reads those quotes to require a nearby date, so
  the house style is enforced rather than merely recommended; (4) documents whose subject
  _is_ the false claims (`docs/GAP ANALYSIS v0.md`, `docs/SPEC-REVIEW.md`) are excluded by
  name in `QUOTES_DEFECTS` — a gate must not fire on the report that found the defect.
  Also recorded: `benchmarks/README.md`'s §86 table now separates rows blocked by
  **hardware** (need a GPU) from rows blocked by a missing **feature** (no sprite
  batching, no instancing outside particles, no shape system, per-glyph textures) —
  reading "needs a GPU" across all of them had been hiding four unbuilt features.

- **2026-08-04 — LIGHTING MVP SHIPPED (owner-directed; §120 now 43/43 shipped-or-MVP —
  AUDIT-120 amended).** Tier: ONE directional light, Lambert diffuse + scene ambient,
  nothing else — §68's smallest honest slice. Standing decisions: `DirectionalLight`
  lives in `@four/scene` (mirrors the rev-1.3 cameras placement; a light is a node),
  shines along its node's **−Z world axis** (camera look convention; direction read via
  `getWorldDirection(out)`, resolve-on-demand like `Camera.updateViewMatrix`; degenerate
  scale → zero vector → lights nothing); §68's "ambient" is `Scene.ambientLight`, a
  scene-wide RGB term (default black), NOT an AmbientLight node (dated staging note in
  light.ts); light discovery in `@four/render` (`collectSceneLights`) is **duck-typed**
  (`isDirectionalLight` brand + ambient duck-read off the root) even though the
  render→scene edge exists — `instanceof` would be unfakeable in render-webgl's
  doubles-only tests; unlike the particle contract, drift IS type-pinned (render's tests
  assign the real classes to the contracts). First light in scene-graph DFS order wins
  (§33-deterministic); light collection runs only for frames whose list contains a lit
  item; lights are NOT §43-interpolated (same trade as particle positions, dated).
  Materials: `LitMaterial` mirrors `UnlitMaterial` member-for-member (color-only, §60a
  no-color-space/no-clamp stance); both carry a NEW `readonly kind` discriminant
  ("unlit"/"lit") — the render list picks the pipeline from `material.kind` with an
  "unlit" fallback, no instanceof (SpriteMaterial gets a kind only when it joins a
  discriminated union). NOTE: §57's family list has no LitMaterial — spec-revisit item
  in TODO. Geometry: optional `normals` attribute on BufferGeometry (index-aligned,
  finite-validated, unit length is the author's contract); `boxGeometry` went 8→24
  vertices (per-face normals — same 12 triangles, unlit rendering identical);
  `planeGeometry` +Z normals; circle/2D stay position-only (unlit tier). WebGL:
  `NORMAL_ATTRIBUTE_LOCATION = 1` (VAO-scoped, no clash with particle instance slots);
  fourth program `LitProgram` (uniforms viewProjection/model/color + vec3
  ambientLight/lightDirection/lightColor; lightColor premultiplied by intensity CPU-side
  — black when no light, so one shader, no variants); normal matrix =
  `transpose(inverse(mat3(model)))` **in the vertex shader** (GLSL ES 3.00 builtins;
  hoist-to-uniform staged until math has a Matrix3 utility); fragment guards zero-length
  normals → a normal-less geometry under LitMaterial shades ambient-only (never NaN);
  lit runs are opaque (blend disabled on switch, mirroring unlit); `uniform3fv` added to
  the GL seam (now 34 methods) and to REQUIRED_CONTEXT_METHODS (fail-fast, not
  discriminating). Unlit path byte-identical: a scene with no lit items issues the same
  GL sequence as before (only init/restore gain the fourth program build); all 32
  browser specs + pixel goldens pass unchanged. Exit numbers (worktree; merged-tree
  verification below): coverage geometry/materials 100%, scene 99.66 (light.ts 100),
  render 99.63 (lights.ts 97.36 — two defensive branches), render-webgl 99.5
  (gl-program/gl-geometry 100); §86 gate 33.28/150 kB (+1.13 kB, genuine). Merged with
  the same-day backlog burn-down: 3,077 unit + 174 suite + 38 browser/visual tests,
  TypeDoc 0 warnings (the packet's two new private-symbol `{@link}`s were demoted to
  backticks pre-merge). Staged with dated notes
  (2026-08-04): point/spot/hemisphere/area + multi-light (uniform arrays / §68 clustered
  path), shadows §69 (castShadow deliberately NOT accepted-and-ignored), §59
  StandardMaterial/PBR, §60a color strings + tone mapping, light layers, per-material
  specular/emissive/maps.
- **2026-08-04 (backlog burn-down, owner-directed "implement all your suggestions and
  more").** Landed in one batch: (1) **README truth** — all 24 package READMEs rewritten
  against `package-export-surfaces.json` (the five placeholder packages honestly say
  "interface reserved; not yet implemented"); root README rewritten with the §93
  quick-start (every identifier verified against the real API). (2) **De-flake** —
  blending RECOVER's sweep clock now starts BEFORE the click (the old placement started
  it after a SwiftShader screenshot that could eat 500+ ms of the 1.5 s sweep — the
  recorded 1-in-3 fail); collapse wait → `expect.poll`; 3/3 local runs green.
  (3) **UI browser proof** (closes the WP-11.5 shortfall) — `examples/ui-demo` (panel/
  buttons/labels, app-supplied WidgetSkins, §72 pointer + staged-seam keyboard hosting,
  25 kB gzip) + `tests/browser/ui.spec.ts` (4 tests, sixth webServer, port 4178);
  `.size-limit.json` gains particles-demo (19.36/25 kB) and ui-demo (25/30 kB).
  (4) **§92 visual category seeded** — `tests/visual/ui-demo.spec.ts`, a second
  Playwright project (`visual`), committed SwiftShader-to-SwiftShader pixel goldens
  (the browser suite's "no goldens" doctrine is about SwiftShader-vs-GPU and does not
  apply; animated sites need a deterministic stepping hook first — recorded next step).
  (5) **Node.position/rotation/scale alias getters** (the §15/§97 idiom; getter-only,
  returns the LIVE transform members so change-hooks fire; WP-3.1 flag resolved).
  (6) **getBodyCenterOfMass** on SolverBodyAccess (+ both Rapier adapters via
  `worldCom()`, fakes, scripted adapters) and **collectCentersOfMass** in diagnostics —
  the center-of-mass DEBUG_DRAW_STAGED entry is unstaged; all seven debug providers now
  run against LIVE Rapier (replay rig runs origins/velocities/COM/impulses per step;
  the jointed pendulum asserts solverJointStatistics) — the "fakes only" verifier note
  is closed. (7) **§28 solverIterations** world option → Rapier
  `World.numSolverIterations` (proven behaviourally: 1 vs 4 diverge on a stack;
  explicit 4 bit-identical to omitted, so recorded checksums stand). (8) **§31
  ccdPredictionDistance** descriptor field replaces the WP-5.4 pinned 1 m constant
  (proven at the boundary: 0.001 m tunnels a thin wall at 200 m/s, 10 m catches it;
  contradiction with a non-speculative resolved mode is refused). (9) **§34
  world-configuration refusal** — PhysicsSnapshot gains optional
  `PhysicsSnapshotConfiguration` (dimension, resolved gravity, resolved sleeping,
  determinism, solverIterations-if-set); restore refuses field-by-field when present;
  absent = pre-existing envelopes and §34 replay documents (which record adapter
  identity only) restore exactly as before. Gotcha: the visual goldens live in
  `tests/visual/*-snapshots/` and refresh with
  `npx playwright test --project visual --update-snapshots` — review the diff first.
- **2026-08-04 (later) — ZERO-FINDINGS SWEEP (owner-directed: "resolve all issues the
  tools report; defer nothing"): all 5 baselined duplicates consolidated, both type-only
  cycles broken, all 21 unused exports resolved; every docs/Architecture report is now 0
  and duplicate-baseline.json is empty.** Standing homes: `SeededRandom` →
  `@four/core/src/random.ts` (WP-8.2 original verbatim; motion/particles re-export;
  streams bit-identical, motion's known-answer suite moved to core, particles'
  BigInt-oracle suite still pins stream identity); `JsonValue`+`cloneJsonValue` →
  `core/src/json.ts` carrying serialization's `__proto__` refusal — this is the "owner
  decision" the serialization module note was waiting on, and it CHANGES diagnostics
  behavior: a payload with a `__proto__` own key is now refused with TypeError instead of
  silently re-parenting the copy; `DEFAULT_GRAVITY_Y` → `core/src/conventions.ts`;
  `ColorRGBA` → `math/src/color.ts`. Cycle breaks: scene's `warnAuthorityConflict` takes
  structural `AuthorityNode` (exported from the barrel; every Node satisfies it);
  physics' `RigidBodyCollisionEvent` lives in `collider.ts` and the three §29 collision
  keys merge into `RigidBodyEventMap` via `declare module "./rigid-body.js"` declaration
  merging (the @four/input→NodeEventMap pattern) — public surface unchanged, but the
  type's DECLARING file moved (deep-importers of `../src/rigid-body.js` must use
  `../src/collider.js`). physics-rapier's 21 transcribed-subset interfaces are no longer
  exported (in-file type contracts only). Gotchas: (1) the interface-merging
  augmentation must NOT carry a doc comment — TypeDoc emits "multiple declarations with
  a comment" once per package that re-exports the map (12 warnings); (2) typedoc
  baseline is now 123 warnings (was 125). Verified: 24/24 build, 2,985 unit, coverage
  ≥95% everywhere (core 99.01 with new json.test.ts at 100%), suites 174, browser 32,
  size 32.13 kB unchanged, all four graph gates + check-spec green.
- **2026-08-04 — Dependency-graph tooling (CDG/QDG) fully integrated; duplicate-symbol
  gate wired.** Context (2026-08-03, recorded in CHANGELOG but not here until now): the
  MathTS dependency-graph tools were vendored under `tools/` — `pnpm graph` (CDG full
  parse → committed `docs/Architecture/`), `pnpm graph:query`/`graph:check`/`graph:test`
  (QDG), with `graph:check` a CI gate (no `node:` builtin may reach a browser-facing `.`
  entry; 24/24 pass); turbo was replaced by `pnpm -r --workspace-concurrency=4` the same
  day; the vendored tool **code** is eslint-ignored and kept byte-identical with
  `llm-wiki/tools/`. Today's decision closes the last gap: `pnpm graph:duplicates`
  (CDG's `check-duplicates.mjs --no-regen`, reading the report `pnpm graph` regenerates)
  joins the CI architecture-invariants step and fails on any TRUE_DUPLICATE symbol name
  beyond `docs/Architecture/duplicate-baseline.json`. Split applied: **allowlist** (=
  legitimately independent forever, per-repo _data_ exempt from the byte-identity rule) got
  per-package `PACKAGE_NAME` and `PARTICLE_INSTANCE_FLOATS` (deliberate duck-typed
  contract, matrix forbids the particles↔render edge — Phase 9 entry below); **baseline**
  (= accepted shrinking backlog, re-seed via `gen-duplicate-baseline.mjs` after
  consolidating) holds `cloneJsonValue`, `JsonValue`, `DEFAULT_GRAVITY_Y`, `SeededRandom`
  (the dated hoist-to-core item), `ColorRGBA`. Gotcha: `duplicate-allowlist.json` is
  hand-formatted — do not round-trip it through `JSON.stringify` (rewraps 500+ lines);
  append entries textually.
- **2026-08-02 — PHASE 11 CLOSED — THE IMPLEMENTATION PLAN IS COMPLETE (final exit
  GREEN; §113a exit TRUE: saved, reloaded, benchmarked; §120 complete at 42/43
  shipped-or-MVP with lighting the single dated staged absence — a traceable
  scheduling gap, never assigned to any phase).** Five packets. Key surfaces:
  @four/serialization (SceneDocument v1, canonical validation, ComponentSerializer
  registry keyed by component CLASS, §80 migrations; byte-identical round trips;
  known boundaries as of Phase 11 — unregistered components silently unsaved, restored
  ids can collide with the live counter — **both closed 2026-08-06, see the A-15/A-17
  entry above**); @four/assets (AssetManager with coalescing
  refcounted cache, ImageAsset disposal wrapper; glTF staged — needs §55 textures +
  non-unlit materials); @four/ui (WidgetSkin seam: layout/state owned, visuals
  app-supplied per the matrix; flex/stack/absolute layout; a11y mirror + keyboard
  staged); benchmarks harness + five suites with committed records (findings:
  contacts+events = ~88% of a physics step; clean scene pass only ~3× cheaper than
  full recompute; recursion-limited scene depth ~8k); docs/AUDIT-120.md. THE §79/§34
  BOUNDARY (WP-11.5): a contact-free save round-trips BIT-IDENTICALLY for 200
  further steps; an in-contact save diverges only through solver warm-start state —
  §34 snapshots carry that, §79 documents don't. Reference RigidBody/Collider
  serializers live in tests/integration/helpers/roundtrip-scenarios.ts. Whole-plan
  audit: all 13 phase sections (§103–§113a) decomposed, dispatched, closed, dated;
  8 goldens 1:1 with determinism specs; §94 release workflow correctly owner-gated.
  Final numbers: **2,971 unit / 172 suite / 32 browser tests; 24/24 build; coverage
  ≥95% everywhere (Phase 11 packages 100%); §86 at 32.13/150 kB; docs 0 errors.**
  Remaining backlog (priority order, verifier G-list): package README sweep (all 24
  say "scaffold only"); UI browser proof (WP-11.5 substituted a node-level §72
  assertion — the one packet-intent shortfall); lighting packet (owner tier
  decision); de-flake blending.spec.ts RECOVER (1 hard fail in 3 full runs,
  retries: 0 — Phase 7 wall-clock thresholds under SwiftShader); §93 quick-start +
  prose guides (the guide half is thin — examples + doc-comments today); gotcha:
  `pnpm size` is a pnpm builtin like `pnpm docs` — always `pnpm run size`.
- **2026-08-02 — PHASE 10 CLOSED (exit GREEN, zero defects; §113 exit sentence TRUE:
  record → bit-identical replay (240/240 checksums; stepChecksumDigest ===
  replayChecksumDigest pinned in golden/phase10.json) → snapshot-seek (cost ≤
  interval−1) → frame-by-frame inspection reading contact geometry at the exact
  recorded steps → exact slow motion).** Five packets. Standing decisions: §34
  envelope in @four/diagnostics (formatVersion 1 exact-match; canonical re-build
  validation → encode(decode(t))===t, prototype-pollution-safe; strict canonical
  base64, hand-rolled, RFC-vector-pinned); ReplayTarget duck-types PhysicsWorld
  (applyInput OPTIONAL — apps wrap world+input-applier, PhysicsReplayTarget in
  tests/integration/helpers/replay-scenarios.ts is the reference pattern; one code
  path applies inputs live AND on replay); ReplayPlayer owns bookkeeping only, host
  supplies stepFn (nothing type-checks the pairing — runtime signal via
  verifyChecksum, deliberately tested); recording is non-perturbing (Rapier
  takeSnapshot is a pure read — tested); DebugDrawBuffer 7-floats/vertex line list +
  duck-typed providers; STAGED with dated notes + DEBUG_DRAW_STAGED export: COM
  display (no seam accessor; Rapier localCom/worldCom exist — unblock verified),
  joint-anchor/constraint viz (seam has no anchors), force vectors (channel is
  write-only), per-segment-colored draw (needs vertex colors — "lines" GeometryDrawMode
  → GL.LINES wiring exists but is undemonstrated; §118 flagship pickup). Known
  boundary: §34 world-CONFIGURATION mismatch is not refused (name/version only —
  pre-existing Phase 5 scope). Exit: 2,766 unit + 159 suite + 32 browser; diagnostics
  210 tests at 100%. Verifier notes: all 24 package READMEs still say "scaffold only"
  (sweep chore); 4 of 6 debug providers exercised via fakes only (one-line rig
  extension would close it).
- **2026-08-02 — PHASE 9 CLOSED (exit GREEN; the plan's honest §112 reading TRUE: 100k
  measured-and-recorded, one-draw-call batching asserted in fake-GL tests, browser demo
  at SwiftShader scale).** Five packets + doc fixes. Key facts: SoA Float32Array pools
  with swap-remove (layout = deterministic function of history — the accepted P9-4
  reading; literal insertion order NOT preserved); fixed 4-draws-per-spawn RNG
  contract (dropped spawns burn none — capacity is part of the stream); SeededRandom
  duplicated from motion (dated, hoist-to-core backlog); §27 fields as factories
  (turbulence = bounded hash-value-noise curl, honestly NOT divergence-free; radial =
  inverse-square, positive-outward); "particles" RenderItem: instanced quads, stride-8
  interleaved, 6 GL calls/frame at any count, straight-alpha blending (first blended
  non-sprite pass); ParticleDrawable + ParticleSystem's SimulationSystem are DUCK-TYPED
  cross-package contracts (matrix forbids the edges; drift caught by tests — plan §6h
  dated note); PRIORITY_PARTICLES = 500. **Benchmark (recorded, NOT a 60fps claim):**
  100k + 3 fields = 16.54 ms/step mean (99.2% of the 60 Hz budget; p95 over), on a
  4-core CI Xeon; integrator alone 1.35 ms — each polymorphic §27 sample() call site
  costs ~5.3 ms/100k; field batching is a scoped future optimization. Exit: 2,585 unit
  - 138 suite + 32 browser tests (five example sites, five webServers); particles/
    render 100%, render-webgl 99.83%; §86 gate 32.13 kB (grew +1.21 kB from the render
    union — verified genuine); particles-demo 18.9 kB gzip non-wasm.
- **2026-08-02 — PHASE 8 CLOSED (exit GREEN; plan-defined criterion TRUE — §111 sets no
  exit, the plan's "PID + steering pass analytic tests, demo composes with the stack"
  stands owner-to-confirm).** Five packets + one doc fix, all in `@four/motion`.
  Shipped: PIDController (§111 sketch verbatim; conditional-integration anti-windup,
  bit-identical to naive while unsaturated; derivative-on-measurement default);
  SpringDamper (exact ZOH matrix-exponential step, memoised per dt, unconditionally
  stable; matched an independent scaling-and-squaring exponential to 1e-12); steering
  (Reynolds set + flocking, acceleration out-params, brute-force neighbors —
  spatial hash staged; the implicit 1 s⁻¹ gain documented); SeededRandom (xorshift128,
  splitmix32 seeding, BigInt oracle known answers); prediction (ballistic + stable-
  quadratic intercept); two-bone analytic IK (positions not angles — no bone-axis
  convention pinned yet). Staged with dated notes: path-planning adapters (RFC),
  CCD/FABRIK, spatial hash, spherical wander, robotic joint commands (MAY declined;
  the PID→setMotor hinge scenario demonstrates the mapping). Integration facts: PID
  actuation = targetVelocity cascade (maxTorque held; on Rapier it is the loop GAIN if
  modulated); a velocity written after world.addBody reaches no solver (author it on
  the descriptor); steering probes (12k overlapSphere calls) provably perturb no
  solver state (checksum-stream identity). Exit: 2,359 unit + 131 suite + 27 browser;
  motion 99.78% (all six new modules 100%); typedoc warnings now 74 (chore count
  stale).
- **2026-08-02 — PHASE 7 CLOSED (exit GREEN, zero defects; §110 criterion TRUE —
  uniquely, both control switches cost LESS than the animation's own per-step motion:
  activation 9.33 mm and retype 2.69 mm vs the wave's 14.63 mm, pinned in
  golden/phase7.json; the chain re-locks onto its animation bit-identically two wave
  periods after a ragdoll cycle).** Eight packets + one doc fix. Standing decisions:
  `PoseTarget` lives in `@four/scene` (position+rotation MVP, no scale — backlog;
  previous* history + capturePrevious); §19 weights on RigidBody (independent,
  normalized at use, defaults 1/0, both-zero warns once and falls back physical);
  transitions retype IN PLACE via SolverBodyAccess.setBodyType (Rapier verified both
  dims — handle/id/colliders/mass survive); velocity inheritance = finite-differenced
  PoseTarget history (world-frame quaternion delta, atan2 form); **no separate
  BlendSystem** — feed and publish live inside PhysicsWorld.step, plus
  createPoseTargetCaptureSystem at 299 (MUST be registered by applications using
  blending/inheritance — an uncaptured animated target inherits ~30× inflated
  velocity, WP-7.3-fix1); kinematic feed is UNWEIGHTED (weights apply once, at
  publish); blending covers every §22 body type; missing-trio throws from the step;
  weight extremes are bit-identical (Object.is-tested) to pure physics/pure target;
  root motion = translation-only mixer option (rotational staged 2026-08-02, seek
  never accumulates); "blended" authority unlocked (WP-2.3 guard removed). Rapier
  note for capability tables: a driven kinematic-position body already carries
  solver-derived velocity, so inheritVelocityFrom is nearly a no-op there (2.4e-7 m
  / 0.5 s) — it matters on solvers that do not derive it. Exit: 2,176 unit + 124
  suite + 27 browser tests (four webServers); scene 99.64, physics/animation 100%
  coverage; first-2d-scene 30.72 kB gzip vs §86; blending example 675.9 kB (wasm,
  ungated).
- **2026-08-02 — PHASE 6 CLOSED (exit verdict: §109 criterion TRUE; one CI-wiring
  defect WP-6.6-fix1 landed by the orchestrator — build all three example sites before
  test:browser — after which the verifier's stated condition for GREEN holds; zero
  engine defects).** Seven packets + two fixes. Standing decisions: joints register on
  the WORLD (`world.addJoint`), not as §6a components (P6-3); anchors/axes authored in
  world space, converted once at addJoint from live solver poses (pose before
  jointing); limits + motors are live (command queues via `SolverJointAccess`
  setJointLimits/setJointMotor); anchors/axis/rope/spring/cone/collisionEnabled frozen
  post-registration (dated staging). `SolverJointAccess` joins SolverBodyAccess as
  required engine surface beyond §37. **Rapier 0.19.3 facts (all measured):** no joint
  reaction getters exist (typings + prototypes + wasm exports) → reportsJointReactions
  false on both adapters, breakable joints refused, §28 breakage proven via scripted
  adapters through the full Application pipeline; motor maxTorque/maxForce is a
  ForceBased GAIN, not §28's hard cap (deviation recorded in the stable API docs with
  cross-references; Box2D could honor a real cap — capability-table item); disabled
  motor = INERT_MOTOR_GAIN 1e-12, measured bit-identical to never-motored over 3600
  steps in BOTH dims (2D initially threw; unified by WP-6.2-fix1 after measurement);
  spherical ships 3D-only WITHOUT limits (per-axis limits do not form a cone — ±0.3
  rad limit lets a diagonal swing reach 1.1247 rad; limited descriptors refused
  quoting the numbers); distance + gear staged loudly (P6-1); FixedJoint with no
  anchor welds origins (documented trap); §28 solver-iterations feature not exposed
  anywhere (recorded gap, TODO). Stability evidence: 3600-step mechanism, hinge
  anchor drift 1.3e-5 m, rope slack 0, slider off-axis ≤1.6e-11, pendulum period
  within 6e-5 of the amplitude-corrected closed form. Exit: 1,998 unit + 95 suite +
  23 browser tests; physics 390 @ 100%, physics-rapier 248 @ 98.14/96.44/100/98.14;
  mechanism example 674 kB gzip (wasm, ungated); first-2d-scene 30.19 kB vs §86.
- **2026-08-01 — PHASE 5 CLOSED (exit GREEN, zero defects; §108 criterion TRUE on three
  axes: mixed-world integration test, playground demo + browser pixels, cross-process
  determinism golden).** Nine packets + two fix packets. Key decisions/facts:
  **SolverBodyAccess** (per-handle transform/velocity/force/kinematic accessors) is an
  engine seam beyond §37's sketch, defined in `@four/physics` and mirrored
  member-for-member by the adapters — future adapters (Box2D) must implement it and the
  §90/§102 compatibility tables should name it. Rapier pinned `-compat@0.19.3` (base64
  wasm, async init; NodeNext cannot resolve its .d.ts → a verified transcribed subset
  lives in `physics-rapier/src/init.ts`, cleanup backlogged). Mass model: density-derived
  by default (delegated to Rapier; WP-5.2-fix1's authoredness union rule — sticky flag OR
  non-origin — keeps an unauthored origin centerOfMass out of descriptors); three
  MassModes; inertia tensors diagonal-only (off-diagonal throws). Adapters own monotonic
  never-reused ids (Rapier handles are unordered doubles) → §33 checksum order;
  snapshot envelopes F4R2/F4R3 carry the id registry. collisionstay is adapter-derived
  from a touching-pair map (Rapier has only start/stop); restitution combine forced Max
  (Rapier default Average contradicts Appendix A); §32 sleep thresholds have NO Rapier
  binding (only `enabled` maps — honest gap); §31 "speculative" = softCcdPrediction(1.0),
  distance param backlogged. §33 FNV-1a duplicated in world.ts (matrix has no
  physics→diagnostics edge; pinned against a reference impl). Verified: 2D and 3D solvers
  bit-identical on mirrored scenarios (identical scenes hash identically across
  dimensions — checksums include z/quaternion, so divergence must be authored into
  tests). §21 z-plane rule shapes node structure (2D bodies must sit at z=0; visuals go
  on child nodes). Rapier 0.19.3 surprises recorded in the WP-5.4/5.5 reports (world
  retains gravity object; colliders query-invisible until next step; dt/4 substepping;
  shapeCast ≤1 hit in 2D). Exit: 1,827 unit + 60 suite (first §92 integration suite) +
  19 browser tests; physics 100/100/100/100, physics-rapier 97.99/96.94/100/97.99;
  first-2d-scene still 30.19 kB gzip vs §86; playground 1.51 MB gzip (wasm, ungated per
  MEMORY 2026-07-29).
- **2026-08-01 — PHASE 4 CLOSED (exit GREEN, zero defects; §107 criterion TRUE per value
  kind with unit + golden + browser-pixel evidence).** Ten packets. API surface:
  34-key easing registry (§15 families, pinned constants incl. damped-spring closed form);
  `ValueAdapter` with `mutatesInPlace` split (primitives return, references mutate `out`);
  `PropertyBinding` (paths resolved once, in-place writes preserve identity + change
  hooks); `Tween` builder (repeat = extra cycles) with a writer-agnostic last-started-wins
  claim registry shared by tween AND mixer (internal exports, not in the barrel);
  `Timeline` (elapsed-space markers, `(from, to]` crossing shared with clip events,
  seek suppresses + per-marker/per-play replayOnSeek, loop = total iterations —
  documented divergence from tween.repeat); `AnimationTrack`/`AnimationClip` (§17 shape;
  cubic = motion's Catmull-Rom convention; quaternion linear = slerp, cubic/hermite
  rejected; morph/skeletal staged per P4-3); `AnimationMixer` (`prepare()`+`play()`,
  satisfies TimelineChild, seek in elapsed time); `AnimationSystem` (priority 300 <
  MotionSystem 400, fixed scaled delta = `fixedDeltaTime` (timeScale already applied by
  the accumulator), auto-untracks finished/stopped). **Renderer findings (WP-4.7):**
  unlit draws run with GL_BLEND off (alpha animation invisible — §60a/blending backlog);
  material color is read per draw (no version cache), so in-place tuple animation works.
  **Frozen behavior:** the fixed-step accumulator's ULP drift fires boundary-sitting
  markers one step late (step 199 not 198) — pinned in golden/phase4.json. WP-4.0 made
  the ≥95% coverage gate tooling-enforced (package-level thresholds; per-file granularity
  noted as a future hardening) + typecheck:examples in CI; barrel-wiring test took the
  umbrella to truthful 100%. Exit: 1,363 unit + 26 suite + 15 browser tests, animation
  100/100/100/100, example 30.19 kB gzip (21% of §86). Verifier notes adopted: §15's
  `node.position` snippet is not copy-pasteable (scene has `node.transform.position` —
  existing ergonomics backlog item); §17's slerp is folded into the quaternion adapter
  rather than named as a mode; 8 new cosmetic typedoc link warnings (cleanup chore).
- **2026-08-01 — PHASE 3a CLOSED (exit GREEN; §106a criterion TRUE with browser input +
  pixel evidence).** Seven packets: §71 picking (ray/AABB/oriented-box, +Y-up NDC), §72
  subset pointer input (capture:-prefixed capture keys on the four propagating types only;
  `NodeEventMap` augmentation via `declare module "@four/scene"`), DragManager (world-delta
  handoff to app callbacks — @four/input never writes transforms), §55/§77 MVP textures +
  sprites, §56 bitmap-tier text (6×12 font, 95 glyphs, base-32 rows; SDF staged), example
  upgrade (click palettes + drag with the §42 untrack+authority handover pair), 5-test
  browser interaction gate. Exit: 1,015 unit tests, 11 browser tests ×2, goldens untouched,
  example 21.46 kB gzip; coverage 100% on input/text/render/materials, render-webgl 99.42%
  (two defensive branches). **Advisory WP-3a.3-fix1:** §55 frame regions unimplemented —
  sprites map whole textures, so labels cost one texture per glyph cell (already in TODO;
  owner may record a spec-amendment deferral). **Exit-verifier notes adopted as chores:**
  examples are typechecked by nothing in CI (verifier's manual `tsc --noEmit` clean today;
  `typecheck:examples` chore queued for Phase 4), coverage ≥95% is review-enforced (no
  vitest thresholds configured — tooling chore queued), example dist uses base "/" (fine for
  root hosting + preview; subpath deploys need `--base`, a deployment-time flag).
  "Ship the public demo" = demo-ready static artifact confirmed (index.html + hashed asset,
  no dev-server references); actual deployment is the owner's step per POSITIONING.
- **2026-08-01 — PHASE 3 CLOSED (exit GREEN, zero defects; §106 criterion met with
  browser-pixel evidence).** Nine packets: cameras/viewport (§47-48, D8 depth ranges),
  geometry/materials/renderable lite + render lists (WeakMap-keyed pools, §43 interpolated
  builder), §61 Renderer interface + NullRenderer, WebGL 2 backend (33-method structural GL
  seam, fake-GL units, 99.66%), Application renderer integration (injected Renderer
  INSTANCE, RenderInterpolation plumbing), real example (14.88 kB gzip vs 150 kB §86),
  Playwright browser gate (ANGLE/SwiftShader pinned; caught a real rAF-seed defect =
  WP-3.7-fix1), exit with centroid-tracked smoothness + a virtual-clock test proving
  alpha-0.5 interpolated draws. **Deferral recorded (spec §45 departure):**
  `ApplicationOptions.renderer` takes a Renderer instance, not §45's string union —
  string/"auto" selection deferred to a §62 registry packet so `four` never imports
  backends at runtime (payload evidence: 14.88 kB). Informational: §106 "textures" deferred
  to §106a/§55 tier; tests/integration+visual still empty (§92 backlog);
  four-package barrel coverage artifact persists (cosmetic). Repo: 813 unit tests +
  17 suite + 6 browser.
- **2026-08-01 — PHASE 2 CLOSED (exit GREEN; §105 criterion met; coverage ≥95% everywhere).**
  Seven packets: five §38 integrators; MotionComponent+MotionSystem (pinned semi-implicit
  formula, explicit track/untrack, parent-frame angular premultiply); eight §13 trajectories
  (CR antisymmetric-tangent bug caught by symmetry tests); §42 TransformAuthority
  (NOT_IMPLEMENTED added to FourErrorCode; refusals skip whole advance);
  KinematicController (channel state machines, float-safe completion tolerance, refused
  commands freeze); scene-side PoseBuffer (single §37 store, lerp/slerp, no write-back API,
  turbo override orders scene#test after motion#build). Exit verified against independently
  derived closed forms (Barry-Goldman, RK4 ODE, algebraic recurrence; worst dev 3.1e-13),
  golden digests cross-process. Motion 200 tests / 99.63%, scene 114 / 99.55%. Fixes: CI
  Node 20→22 (type-strip children); four/application subpath (renderer-free headless
  composition). Repo: 545 tests. Next: Phase 3 rolling-wave decomposition (renderer
  foundation §106 + §61-62, cameras §47 in @four/scene per spec rev 1.3).
- **2026-08-01 — PHASE 1 CLOSED (exit GREEN; §104 criterion met; coverage ≥95% everywhere).**
  All 14 packets landed (Opus workers, per-packet commits): math (Vector2/3/4, Quaternion,
  Matrix3/4 — 154 tests), core (EventEmitter, component model, FourError+Disposable — 57),
  scene (Transform with D3 dirty channel, Node/Group/Scene, world-transform resolver — 84),
  motion (Clock/TimeState, §10 scheduler, §39 system registry — 56), diagnostics (D6
  checksum with independently cross-checked golden vectors — 28), four (Application root —
  25), plus the WP-1.14 exit: 100-node/1000-frame determinism scenario with committed
  golden digests, proven in-process AND in a fresh node process, with sensitivity evidence.
  Coverage: math 98.9 / core 98.5 / scene 99.3 / motion 99.3 / diagnostics 100 /
  application.ts 100 (% statements). **API decisions recorded from [S] packets:** registry
  re-entrancy throws (protects §34 replay) while EventEmitter queues-and-defers; Node's
  parent setter delegates to add/remove; world resolver's three-part staleness incl.
  parent-identity (catches version-less reparenting); Application wraps
  attachToScheduler's installed callback (registry first, then event), resolves world
  transforms before update/render listeners; `INVALID_APPLICATION_STATE` added to
  FourErrorCode (WP-1.12-fix1); @types/node@22 + tests/tsconfig.json (WP-1.14-fix1);
  @vitest/coverage-v8 pin added — coverage joins phase-exit gates. Node 22 runs .ts
  helpers natively (type-strip) — the determinism child process imports the same .ts
  scenario file Vitest uses.
- **2026-07-31 — PHASE 0 CLOSED (exit verifier: GREEN, zero defects).** All 15 packets
  executed by Opus workers under the plan's protocol; 24/24 packages scaffolded, building
  (`tsc -b`, cold and warm), testing, linting; docs, example, size gate (425 B / 150 kB),
  CI workflow, community files, ROADMAP all landed. Per-packet commits `WP-0.*` on the
  working branch. **Findings folded back into the plan (dated in-place revisions):**
  WP-0.2's original Done check was vacuous (TS18003 with no .ts files); WP-0.4/0.5 Files
  lines omitted `tsconfig.build.json`; **`pnpm docs` without `run` is a pnpm builtin
  no-op** — always `pnpm run docs` (CI updated); `*.tsbuildinfo` needed gitignoring;
  root-level `.ts` files need `allowDefaultProject: "*.ts"` (WP-0.7-fix1); the umbrella's
  root barrel uses namespace re-exports to avoid symbol collisions. Dormant-but-harmless:
  turbo's `lint` task (root eslint is the gate); `test:suites` vacuous until WP-1.14.
  Phase 1 dispatch begins with WP-1.1 (math vectors) and the batched core trio
  (WP-1.4/1.5/1.6 — batched because all three edit core's `src/index.ts`).

- **2026-07-28 — Spec corrected in place (owner decision).** E-1/E-2/E-3 from `ERRATA.md`
  resolved directly in `SPECIFICATION.md`: second `Part VII` → `Part VIII` (later parts
  IX–XIII); second §45–67 range renumbered +53 to §98–120; §102 lists only `physics-rapier`
  and `physics-box2d` as solver packages. The PDF was left unmodified.
- **2026-07-28 — PDF archived.** Original spec PDF moved to `docs/archive/`; the corrected
  Markdown is the working reference for the repository.
- **2026-07-28 — Plugin marketplace registered (owner decision).** `.claude/settings.json`
  registers `local-marketplace` (GitHub `danielsimonjr/skills`, a **private** repo — sessions
  need the owner's GitHub auth to clone it) and enables `rfl`, `dev-workflow`, and
  `honest-claude` as project defaults. Machine-bound plugins from that marketplace (Windows
  automation, Outlook, local symlink/junction sources, personal MCP servers) are deliberately
  NOT project defaults — they belong in the owner's user-level settings. The settings file
  was created by the owner directly; agent writes to `.claude/settings.json` are blocked by
  the permission classifier in this environment.
- **2026-07-28 — Repository layout conventions.** Per package: `README.md` + `src/`
  (strict TS, ESM) + `tests/` (unit tests colocated, §92). Cross-package suites live in
  `tests/{integration,visual,determinism}/`; performance tests in `benchmarks/`. Examples
  follow §93 naming (`first-*-scene`, `mixed-scene`) with flagship demos under
  `examples/flagship/`. Still no `package.json`/toolchain — that remains Phase 0 (§103).
- **Pre-existing (recorded in ERRATA E-3):** the scaffold follows the monorepo tree —
  `physics-matter` and `physics-cannon` are deliberately absent and must not be added without
  a spec amendment.
- **From the spec (not yet revisited):** first physics adapter is Rapier (§108); MVP renders
  with WebGL 2 only (§120); toolchain baseline is strict TS + ESM + pnpm + Vitest +
  Playwright + ESLint + Prettier + Vite + Changesets (§91).

- **2026-07-28 — Specification review recorded, not applied.** `docs/SPEC-REVIEW.md` proposes
  improvements R-1…R-35 (P1 = internal contradictions, e.g. §23 vs §26 force signatures,
  §19 vs §42 authority enums, §52 tessellator package missing from §98; P2 = underspecified
  load-bearing designs, e.g. component model, event system, coordinate conventions, adapter
  interface gaps; P3 = structural/editorial). Cite items as "R-N" (same style as ERRATA
  "E-N"). _Superseded the same day by the revision-1.1 entry below._
- **2026-07-28 — Spec revision 1.1 applied (owner-directed).** All 35 review items applied to
  `SPECIFICATION.md`; Amendments table added at the top of the spec. Key standing rules the
  revision established: **§ numbering 1–120 is frozen** — new sections use letter suffixes
  (now 6a Component Model, 6b Eventing, 7a Coordinate/Unit Conventions, 7b Math Conventions,
  60a Color Management) and appendices (A Normative Defaults, B Glossary); world space is
  right-handed **Y-up in both 2D and 3D** (2D gravity is negative Y); **all engine times are
  seconds** (tween/timeline durations included — no milliseconds anywhere); the single
  authority enum is `TransformAuthority` (§42, now includes `"blended"`; `MotionAuthority`
  no longer exists); force APIs use explicit `…AtPoint` names; `RigidBody`/colliders are
  _components_ (§6a); the solver adapter contract (§37) includes destroy/query/drainEvents
  methods and a defined `PhysicsCapabilities`. §86 payload budget (≤150 kB gzip) was
  confirmed by the owner on 2026-07-29 (revision 1.2; no longer provisional). The `dev-workflow` plugin could not load in this
  remote session (private `danielsimonjr/skills` marketplace repo is outside the session's
  GitHub scope), so the revision was done inline.

- **2026-07-29 — Phase 0 toolchain decisions (proposed by Claude at owner direction to
  "close the open decisions"; each overridable by a superseding entry before Phase 0
  starts):**
  - **Task runner: Turborepo** (§91 permitted either). Rationale: simpler config surface for
    a pnpm workspace with uniform package shapes; no need for Nx's generator/plugin layer.
    Revisit via RFC (§95) only if remote caching/constraints prove insufficient.
  - **Browser/Node baseline** (feeds §90 compatibility tables): evergreen last-2 versions of
    Chrome/Edge/Firefox and Safari ≥ 16.4; **WebGL 2 required** for the MVP (§120); WebGPU
    is an optional tier. Node ≥ 20 (LTS) for tooling and headless simulation.
  - **Rapier strategy** (§108): official `@dimforge/rapier2d` + `@dimforge/rapier3d` wasm
    packages; the wasm loads asynchronously inside `PhysicsSolverAdapter.initialize()` (§37
    permits a Promise); exact version pinned when Phase 5 starts (tracked in TODO). Solver
    wasm is **outside** the §86 payload budget, which by its wording covers only
    core + math + scene + render-webgl.
  - **Budget enforcement**: a size-limit check in CI is a **Phase 0 deliverable**, gating
    the §86 payload row from the first compilable package onward.
  - **API docs: TypeDoc** for generated reference docs (§93). API Extractor deferred;
    revisit before 1.0 if API-report/compat gating is wanted (§90).
- **2026-07-29 — Implementation plan written for subagent execution.**
  `docs/plans/IMPLEMENTATION_PLAN.md` (Phase 0 deliverable, §103; moved from the root to
  `docs/plans/` by owner direction the same day — §103's deliverable list names the file
  without a path, so this is a location choice, not a spec deviation) structures all work
  as **work packets** `WP-<phase>.<n>` with a fixed format (Depends/Reads/Files/Steps/Done). Packets
  are tiered: **[H]** = mechanical, pre-decided, Haiku-executable; **[S]** = needs judgment,
  stronger model. Conventions in force: §1 ground rules go verbatim into every worker
  prompt; parallel packets need disjoint `Files` sets; two retries then escalate; a phase's
  exit packet must pass before the next phase starts; Phases 0–2 are fully decomposed,
  Phases 3–10 are deliberately rolling-wave (decomposed only when their predecessor exits
  green). The §98 directory tree was verified complete — packets fill directories, never
  create packages.
- **2026-07-29 — npm publish names decided (owner): `@danielsimonjr/fourjs`.** Spec
  revision 1.6. Umbrella publishes as `@danielsimonjr/fourjs`, all other packages as
  `@danielsimonjr/fourjs-<name>`, from the owner's personal npm scope — no org claim or
  dispute needed (supersedes the `fourjs`/`@fourjs` fallback in the 1.5 note below).
  Workspace names stay `four`/`@four/*`; the mechanical rename happens in the release
  workflow at first publish (§94 0.1). Subpath exports (`@danielsimonjr/fourjs/scene`)
  carry the §91 tree-shaking requirement.
- **2026-07-29 — Gap-closure pass (spec 1.5, plan 2.1) after the "what else are we
  missing" review.** (1) **Naming:** npm `four` (0.0.1-a, unrelated) and `four-js` are
  occupied; `fourjs`/`@fourjs` were free 2026-07-29 (org pages bot-blocked — claiming needs
  the owner's npm account). Workspace names stay `four`/`@four/*`; rename-or-dispute is an
  owner decision due before release 0.1 (TODO). (2) **MVP coverage hole closed:** Part IX
  never scheduled §120's interaction/content/tooling scope — spec 1.5 adds §106a (Phase 3a:
  input, picking, dragging, sprites, MVP-tier text) and §113a (Phase 11: assets,
  serialization, UI, benchmark harness, docs); §56 gains an MVP text tier with full shaping
  staged behind a shaping-engine RFC (HarfBuzz-wasm the likely route). (3) **Phase −1
  smoke passed:** the full §3.2 pin set installed and ran together (build/test/lint/docs/
  vite/size-limit); template corrections folded into plan 2.1 — split dev/build tsconfigs
  per package, `pnpm.onlyBuiltDependencies: ["esbuild"]`, validated ESLint config, example
  needs a root `four` workspace devDep, size-limit set to gzip. (4) **Process homes:**
  `docs/rfcs/` created (template + process, backing the plan's RFC gate);
  `docs/POSITIONING.md` states the why-exist case, audience order (engineering/digital-twin
  first), migration story, demo-first principle (public demo ships at Phase 3a exit), and
  plain-language risks; CI gains a non-blocking `pnpm audit` step; visual tests will run
  Playwright + Chromium/SwiftShader in CI (plan Phase 3 note); MEMORY compaction convention
  added to this file's header. Release (Changesets) workflow deliberately deferred to first
  publish (§94 0.1).
- **2026-07-29 — Implementation plan stress-tested; revision 2 written.** Five independent
  passes (Haiku dry-run of WP-0.1 in a worktree — succeeded, logged 5 forced guesses;
  executability review with empirical probes; spec-fidelity review; Sonnet orchestration
  red-team; Opus technical-design red-team) produced ~85 findings, all applied in plan
  revision 2. Standing outcomes: **toolchain pins are exact** (TypeScript 5.9.3 — never
  7.x; eslint 9.39.5; typescript-eslint 8.65.0; vitest 3.2.7; turbo 2.10.7; full table in
  plan §3.2, orchestrator-adjusts-only); **frozen dependency matrix** (plan §3.1, 6 waves);
  build is **`tsc -b`** with `types`-first exports maps and `.js` relative-import suffixes;
  design decisions **D1–D8** pre-decided (Node = single inheritance extending
  EventEmitter, no mixins; `typeName`-keyed components; Transform dirty via math
  change-hooks + `markDirty`; Application composition root in `four` (spec rev 1.4);
  §39 system registry — nothing edits the scheduler; diagnostics checksum utility with
  fresh-process golden-hash determinism tests; `out?`-optional allocation policy;
  depth-range-parameterized projections, shortest-arc slerp). Orchestration now specifies:
  per-packet orchestrator commits scoped to Files, orchestrator-only installs/lockfile,
  worktree merge order, retry-with-failure-output then validate-the-Done-check escalation,
  in-place packet revisions, independent second-agent review for [S] packets,
  `WP-N.M-fixK` defect convention, orchestrator-owned tracking files, RFC gate for
  rolling-wave API surfaces. **Spec revision 1.4** (found by this pass): §98 Application
  composition root moved from `core` to `four`.
- **2026-07-29 — Spec revision 1.3 (verification pass).** Two independent adversarial
  re-reads of the 1.1 material (time/physics-semantics lens and cross-reference lens)
  surfaced 16 unique findings — 7 confirmed, 9 plausible — all fixed in revision 1.3 (see
  the spec's amendments table and CHANGELOG). Notable standing corrections: world matrices
  resolve **per fixed step**; §39 order is now …7 constraint solve, **8 sensor update,
  9 collision event dispatch**…; `Collider.density` beats `PhysicsMaterial.density`;
  checksums visit existing bodies (incl. sleeping) in monotonic body-id order; cameras and
  viewports belong to `@four/scene` (rigs stay in `@four/motion`); §40's degree/millisecond
  options are display/authoring conversion only.
- **2026-07-29 — Scaffold docs synced to revision 1.2.** CLAUDE.md, AGENTS.md, README.md,
  ERRATA.md (scope note: amendments live in the spec's table, ERRATA covers only PDF
  defects), website/README.md, and the core/motion/physics/geometry package READMEs were
  updated to match the revised spec (transform authority incl. `blended`, seconds, Y-up,
  components, adapter contract, camera rigs in `@four/motion`, units in `@four/core`,
  tessellation as a geometry module). `tools/check-spec.mjs` added as the mechanical spec
  checker (future CI docs job).

## Open questions

- Whether/when to regenerate the PDF from the corrected Markdown (it is now formally frozen
  at the pre-1.0 text — regeneration is optional, not blocking).

## Gotchas

- The ERRATA "non-defects" list exists so known false alarms aren't rediscovered: §118's
  title starts with a typographic quote (easy to miss in heading scans), and low repeated
  numbers (1., 2., 3., …) in the spec body are lists, not sections.
- The spec body text is hard-wrapped plain text under Markdown headings; code snippets have
  been fenced since 2026-07-28.
