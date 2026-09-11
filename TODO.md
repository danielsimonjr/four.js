# TODO

Task tracker for fourJS. Keep entries short and actionable. **Closed rows live in
[`docs/archive/TODO-DONE.md`](docs/archive/TODO-DONE.md)** (since 2026-09-11; every `- [x]`
row moved there under its original heading) — mark a row `[x]` with the date, then move it
there in the same commit, so this file holds only open work. Larger context and decisions belong in `MEMORY.md`; released
changes in `CHANGELOG.md`.

## Priority order

Every open item in the **Now** section, ranked least-to-most complex. This is an *index*: each
entry keeps its body where it already lives, so the thematic grouping and the
`R-`/`PH-`/`A-` series stay readable. Line numbers drift — the titles are the key.

Ordered by complexity rather than importance on purpose: the cheap end clears fastest,
and tier 4 surfaces the decisions that block otherwise-small work.

Counts as of **2026-09-11**, recounted not estimated (`grep -c '^- \[ \]'` here / `'^- \[x\]'` in `docs/archive/TODO-DONE.md`): **12 open**, **263 closed (archived)**. The 2026-09-11 archive move took every closed row out of this file (2,400 → ~500 lines); the section headings stay so residue rows keep their context.

### 0 · Blocked on an event, not on effort

Each waits on a **second solver adapter** existing. None is minutes-work; none is work at
all yet. Listed first so they are not repeatedly re-triaged as quick wins — which is what
happened on 2026-09-06, when all three sat in the minutes tier until someone read them.

- Capability-table note: Rapier `inheritVelocityFrom` no-op — DONE 2026-09-06 (`COMPATIBILITY.md` deviations); other solvers still need a column when they land
- Document SolverBodyAccess — DONE 2026-09-06 (Rapier column in COMPATIBILITY.md; other adapters still get a column when they land)
- §28 motor cap — DONE 2026-09-06 (Rapier force-based gain named in COMPATIBILITY.md; Box2D column when it ships)

### 1 · Minutes — mechanical, no design in them

Config, a regeneration, or a sentence of prose. Nothing here needs a decision.

- Coverage thresholds are package-level — DONE 2026-09-06 (80% per-file floor under the 95% package gate).

- **Why does a 12.8s test survive a 5s deadline?** DONE 2026-09-09 — it does not
  survive a 5s deadline. `packages/fourjs/tests/barrels.test.ts` sets
  `{ timeout: 30_000 }` on the suite (cold-start WASM / lazy dynamic imports). The
  printed **12802ms** is wall-clock duration under that 30s budget. The **9809ms**
  on `tests/application.test.ts` is the reporter's **file aggregate** (131 tests
  summed); each `it()` still has Vitest 3's default 5s `testTimeout`, and no
  hidden config raises it. `vitest.coverage.config.ts` (30s) is coverage-only.
  Duration shown ≠ deadline. Headroom on a slow test is that test's own timeout.

- **vitest 3.2.7 -> 5.0.0: DONE 2026-09-09.** The 2026-09-08 attempt was
  reverted because Vitest 5's honest v8 remap dropped six thresholds below
  95%. The campaign closed those gaps without weakening the gate:
  `resource-warnings.ts` now exercises `__FOUR_DEV__ = false`; Rapier `init`
  reject/retry, stale-handle context, and R-32 particle appearance /
  wide-stream / trail tests lifted physics / render-webgl / text / render;
  `rapier-defensive-branches.test.ts` covers `countContacts` and the
  snapshot-envelope guards (unknown mass mode, orphaned Rapier colliders,
  collider-without-body, stay without body records). Re-measured under
  5.0.0: **physics 97.27%, render-webgl 95.57%, text 100%, render 97.59%,
  physics-rapier 95.26%** branches. `vitest` and `@vitest/coverage-v8`
  bumped together to 5.0.0. Written up in `docs/MIGRATION.md` section 5.
  Follow-up the same day: CI `bun run coverage` then failed on
  **`@fourjs/particles` at 92.1% branches** — the original campaign only
  re-measured the five named failures. Honest tests for ramp-stop
  validation, empty/NaN lifetime ramps, trail store guards, and
  `computeBounds` non-positive lifetime lifted particles to **97.16%**
  (480/494). Gate unchanged.

- **Triage the 42 Oxlint warnings the ESLint config never surfaced.** DONE 2026-09-09.
  Count on this tree was **40** (two `no-misused-spread` hits had already gone).
  Real one-line fixes: `Array.from` for string spreads, `localeCompare` on tool
  sorts, computed quaternion `w` instead of a precision-loss literal, comment
  rewrite so `packages/*/src` cannot close a JSDoc. Deliberate tests: `no-self-assign`
  line-allows on the rigid-body no-op-write probe; `no-control-regex` allow on
  NUL-delimited guide slots; `no-unsafe-optional-chaining` off under `**/tests/**`
  (every hit was `(optional?.x).y` after an `expect` that the value exists).
  `bun run lint` is **0 warnings / 0 errors**.
  Follow-up 2026-09-09: the `**/tests/**` override also turns off
  `typescript/no-unsafe-*` so Vitest 5's `vi.spyOn` types do not fail
  suites that were clean under 3.2.7. Package test tsconfigs set
  `"types": ["node"]` because Vitest 5 no longer references Node from
  its own typings (TypeDoc's TS 6 pass typechecks those tests).

### 2 · Hours — one contained fix, already diagnosed

Each has its cause written down. The thinking is done; what remains is the change and its test.

- `smoothness.spec.ts` aliasing — DONE 2026-09-06 (virtual-frame parity sampler).
- `blending.spec.ts` RECOVER / sample-count — DONE 2026-09-06 (page `data-chain-y` watches).
- Run the README snippet in the browser gate — DONE 2026-09-06 (`tests/browser/readme.spec.ts`).
- Scissor clipping (§67's first bullet, small) — DONE 2026-09-06.
- §59 second texture unit — DONE 2026-09-06 (`StandardMaterial.metalRoughnessMap`).
- Dogfooding coverage map (standing assignment) — surfaces DONE, so they are not redone.

### 3 · A day — a real packet, cause known

Bounded work with a clear shape, but more than a single edit.

- The browser gate on Windows — DONE 2026-09-06 (WebGPU 22/22 via platform argv; `animation.spec` simulation-bound `#status` sampling; Windows timeout 180 s; `smoothness.spec` uses `page.evaluate` parity wait per #72).
- Unlit materials render with GL_BLEND off — DONE 2026-09-06 (alpha / `transparent` enables SRC_ALPHA blend).
- Size budgets are thin after R-36 — DONE 2026-09-07 (re-measured after #76: 43 / 43 / 49.5 kB and 2.05 / 1.25 / 1.20 MB; rationale in `tools/size-budgets.mjs`). Follow-up 2026-09-09 after #86: particles-demo 43 → 43.5 kB, ui-demo 49.5 → 50 kB (CI 43.04 / 49.51 kB).
- Replace the transcribed Rapier type subset in `physics-rapier/src/init.ts` — DONE 2026-09-06 (package `moduleResolution: bundler`; upstream type aliases).
- Extend `tools/check-docs.mjs` — DONE 2026-09-06 (24 packages, suite counts, AUDIT-120 census).

### 4 · Blocked on a decision, then small

The work is modest; the judgement in front of it is not. Cheapest to unblock, so worth raising early.

- rapier 0.20 adoption — DONE 2026-09-06 (0.20.0; contactPair takes bodies; goldens re-recorded from scenario helpers).
- Lift the TypeScript/vitest pin once typedoc supports TS 7.
  Vitest half **DONE 2026-09-09** (5.0.0). TypeDoc isolation still owns the
  remaining `typescript@6.0.3` in `tools/docs`.
- PoseTarget scale channel — DONE 2026-09-06 (physical side is identity).
- Rotational root motion — DONE 2026-09-06 (quaternion track extracts local rotation).
- A-25 owner decisions before first publish: DONE 2026-09-06 (stubs publish as 0.x; `NPM_TOKEN` stays owner secret; Pages enabled).
- A-25 remainder: DONE 2026-09-06 (guides on Pages, demos on `website/`). Publish itself is the First-publish row.

### 5 · Feature packets — multi-day, deliberately deferred

The RFC residues and the R-/PH-/A- series. Several are parked by their own RFC's §6 table; these are the post-1.0 roadmap rather than release work.

- Fold steering's private interceptTime into prediction's export — interceptTime fold DONE 2026-09-06; ~~spatial-hash neighbors~~ DONE 2026-09-06; ~~spherical wander~~ DONE 2026-09-06; ~~CCD/FABRIK~~ DONE 2026-09-06; ~~path-planning adapters (RFC)~~ **Proposed 2026-09-06** (`docs/rfcs/0007-path-planning-adapters.md`; corrected 2026-09-10, four-agent plan `docs/plans/RFC-0007-PATH-PLANNING_PLAN.md`); ~~text shaping engine (RFC)~~ **Proposed 2026-09-06** (`docs/rfcs/0008-text-shaping-engine.md`; corrected 2026-09-10, plan `docs/plans/RFC-0008-TEXT-SHAPING_PLAN.md`); robotic joint commands utility (MAY declined — see prediction.ts staging note)
- RFC 0004 residue (all deferred by the RFC's own §6 table, none scheduled):
- RFC 0005 residue — **CLOSED 2026-09-10** (WebGPU skinned id pass). All named slices landed.
- RFC 0001 residue (staged in source, 2026-08-28):
- RFC 0003 residue (staged in source, 2026-08-28): WebGPU colour pair DONE 2026-09-09; WebGL shadow caster DONE 2026-09-09; WebGPU skinned id DONE 2026-09-10 (lives in `wgpu-picking.ts`); still GPU morph, CPU skinning, bone-texture; WebGPU skinned shadow still skips.
- RFC 0003 prototype measurements — DONE 2026-09-09 (`benchmarks/skinning-resolve.mjs`):
- Tokens for the five absent §81 extension points — DONE 2026-09-06 (`ASSET_LOADERS`, `SHADER_OPERATORS`, `UI_CONTROLS`, `EDITOR_TOOLS`, `COMPUTE_WORKLOADS`)
- Lighting follow-ups (MVP tier shipped 2026-08-04 — see Done): ~~point/spot multi-light~~ **DONE 2026-08-09** (R-17, 8 punctual); ~~hemisphere~~ **DONE 2026-09-10** (`HemisphereLight`, first-match, +Y sky); still multi-directional + area + clustered path, shadows (§69 — directional tier shipped; cascades, point/spot maps, the atlas, transparent masks and contact shadows remain), §59 PBR rest, §60a tone-mapping operator + IBL (sRGB encode + color grade shipped), light layers. CSS light colors + WebGL/WebGPU normal-matrix hoist DONE 2026-09-09. WebGPU `metalRoughnessMap` sampling DONE 2026-09-09. WebGL `emissiveMap` (unit 3) DONE 2026-09-09 (still open: extra directionals / area / clustered, cascades, PBR rest, tone-map operator, light layers, `normalMap` / `occlusionMap`, WebGPU emissive).
- First publish (§94 0.1): Changesets release workflow + the @danielsimonjr/fourjs publish-name mapping — owner step
- Follow-ups the R-1 plan explicitly defers
- PH-11c — character/dynamics push interaction — DONE 2026-09-06 (`pushMass` / reduced-mass impulse / wake).
- R-32 — textured / rotated / soft particles — DONE 2026-09-06 (opt-in 10-float stream).
- R-33 — §112's exit, rendered as well as simulated. Split landed 2026-09-09; exit still needs non-SwiftShader.
- R-31 — GPU particle simulation integrator tier — DONE 2026-08-29 (`simulation: "gpu"`); §27 GPU fields / depth-buffer collision / GPU snapshots remain under R-31 residue.
- PH-22 residue (re-read 2026-08-21): PH-22f anchors DONE 2026-09-06; path-planning RFC Proposed.
- R-8 follow-ups:
- §8 node-level `NodeSpace` component — DONE 2026-09-06.
- §21 `"local-plane"` simulation frame — DONE 2026-09-06.
- §27 field torque and field-driven waking — DONE 2026-09-06 (`sampleTorque` + per-entry `wakesSleepingBodies`).
- Batching follow-ups (§65, after R-9's consecutive-run tier, 2026-08-09): instanced meshes for the shaded pipelines (`R-22`); texture-atlas grouping; making batching the default (A-4). Idle-cache (GL + WebGPU) + glyph batching already shipped.
- `buildRenderList` optimization — DONE 2026-09-06 (homogeneous sort skip + sprite fast path; benchmark re-recorded).
- R-30c — the rest of §77, scoped by why each is not ordinary work: map roles DONE 2026-09-09; still cube/array/3D, compressed, video/`ImageBitmap`, async upload.
- §12 character controllers + first-person look — DONE (PH-11/PH-11b 2026-08-21; `examples/character-controller` browser gate 2026-08-29).
- Staged rigs (R-36/R-37 residue, 2026-08-09): DONE 2026-09-06 (trackball, fly snippet, `CameraShake`).
- §44/§47 camera rigs residue — DONE 2026-09-06 (orbit/follow/spring/look-at/trackball/fly/shake).
- R-23 follow-ups (solid-fill tier shipped 2026-08-09):
- R-26 follow-ups (path-data tier shipped 2026-08-09):
- Auto-selection follow-ups: **CLOSED 2026-09-06** — ui-demo budget reviewed
  (45 kB limit); real WebGPU rung in `backend-selection.test.ts`.
- PH-9 follow-ups (staged 2026-08-07):
- R-6 follow-ups (§70 tier 2):
- §40 follow-ups:
- PH-1 follow-ups:
- A-4 remainder — CLOSED 2026-09-07: step 2 DONE (§85 catalogue); step 3 WON'T-DO (§33 simulation envelope — scene/physics must not import `DEV`).
- A-5 remainder — CLOSED 2026-09-09: opt-in leak audit is the design (`auditFinalizedLeaks`).
- A-5 follow-ups: materials + solver handles accounted at count tier — DONE 2026-09-06; `RenderTarget.byteLength` moved with §67 formats.
- A-1 follow-ups: contacts wired via `SolverStatistics.contactCount` → `app.stats.contacts` (2026-09-06); `physicsStepTime` already via A-6; `gpuFrameTime` copies `Renderer.lastGpuFrameTimeSeconds` (2026-09-06).
- A-18 remainder — DONE 2026-09-06 (progress, stream, dependency graph, injected worker decode, injected watch).
- A-16 remainder (manifest half): DONE 2026-09-06 (`preloadManifestIntoCatalog`).
- A-19 remainder: MERGED 2026-09-09 into R-30c.
- §96 residue:
- R-19/R-20 follow-ups — DONE 2026-09-09 (§52 already shipped; §55 authored sprite uvs).
- Flaky gate — DONE 2026-09-06 (smoothness parity + blending page watches).
- A-13 — DONE 2026-09-06 (`installAccessibilityMirror` opt-in DOM mirror).
- Particle trails — PARTIAL 2026-09-06: CPU ring buffer + ribbon path + multi-stop ramps DONE; GPU trail compute refused in GPU mode; true depth-texture collide-and-kill still open (ground-rest stub DONE). Spatial-hash neighbors is a separate closed row (`SpatialHash` in `@fourjs/motion`).
- §24 remaining shapes — DONE (PH-22a, 2026-08-02); compound = multiple colliders by design.

## Now

### 🔧 "fourJS" is the library name — rebrand, staged (2026-09-07)

Daniel: *"fourJS is the library name; not four or four.js. Refactor codebase to reflect
this reality."* Staged deliberately, because the three layers have very different costs
and only the first is unambiguous.

> **npm forbids capitals in package names**, so "fourJS" can only ever be branding at the
> identifier layer — `@danielsimonjr/fourjs` stays lowercase however far stages 2 and 3 go.

### 🔧 Tech-lead decisions on the four dogfooding findings (authorised 2026-09-07)

Daniel delegated all four. Ordered by value-over-risk, not by how annoying each felt.

> **VERIFICATION RECORD — not a task, so deliberately not a checkbox.**
> Re-ran BOTH described personas against current `main` (2026-09-07). They
> were last exercised on 09-06, before ten commits landed; a passing scenario from
> yesterday is not evidence about today's tree. Both **pass**, and the fixes they
> originally produced are holding.
>
> · **Indie-studio flight simulator.** Flies under real key input: orientation composes
> from identity to `[-0.398, -0.138, 0.553, 0.719]`, position `[0,60,350]` →
> `[-237,176,746]` (rolled, climbed, accelerated 120→157), chase camera trailing, **zero
> page errors**. The `FollowRig` crash found on 09-06 stays fixed.
> **Quaternion norm measured at full precision: exactly `1`** — no drift. Worth recording
> *how* that was nearly misreported: the app's own diagnostic rounds the quaternion to 4
> decimals, so computing the norm from telemetry read **1.000062** and looked like
> normalisation drift. It was my instrument, not the engine. A rounded readout cannot
> measure a quantity whose interesting deviation is smaller than the rounding.
>
> · **Engineering-student two-cylinder boxer.** The crank turns (θ swept a full
> revolution over 400 samples), so the frozen-engine defect from 09-06 — a dynamic body
> with no collider has zero angular inertia — stays fixed. Measured against closed form:
> piston error **mean 0.46 %, max 0.99 %** of a 1.0043 stroke; mirror invariant
> `|x_A + x_B|` mean 3.4 mm, max 9.5 mm; piston **y-drift exactly 0**; zero errors.
>
> **One number I cannot account for, stated rather than smoothed:** on 09-06 I recorded a
> mean piston error of **1.56 mm (0.16 %)**; today the same app measures **4.62 mm
> (0.46 %)**, roughly 3×. Both are small and every invariant still holds, but I will not
> call that "consistent" — the sample window, crank speed and Rapier version (0.20 landed
> 09-06) all differ, and I did not run a controlled comparison. It needs one before either
> figure is quoted as the engine's accuracy.
>

- [ ] **Dogfooding coverage map (standing assignment) — surfaces DONE, so they are not redone.**
      Verified from a clean consumer against the staged published-name packages, each with a
      control: JS runtime · TypeScript types (strict, `skipLibCheck: false`) · publish/staging
      path · all 25 umbrella subpaths · §33/§34 determinism · §34 snapshot round-trip · §7a
      Y-up in 2D. Evidence in MEMORY.md under 2026-09-06.
      **Cycle 3 (2026-09-07, `.dogfood/charselect`) exercised, from a consumer seat and
      verified in a real browser:** the WebGL render path (7,938→10,080 lit pixels by
      screenshot), assets/glTF (`AssetManager` + `createGltfLoader`, loaded), animation
      (`Timeline` + `tween` + `AnimationSystem`, observed driving `scale.x`), UI
      (`Panel` + `Label` constructed into the scene), and §42 authority. **Five findings,
      all filed above.**
      **Particles exercised 2026-09-07 (cycle 3b) — CLEAN, no findings.** A 400-capacity
      `ParticleEmitter` + `ParticleRenderable` + `ParticleSystem` with a §27 gravity field
      ran in the browser beside the rest of the app: **245 particles alive**, zero console
      errors, no §42 interaction (particle transforms are not node transforms). The only
      friction was guessing `aliveCount` for what is `particleCount` — discoverable, and
      not worth filing.
      **WebGPU exercised 2026-09-07 (cycle 3c) — CLEAN, and the strongest positive result so
      far.** §62's renderer abstraction holds from outside: swapping `WebglRenderer` →
      `WebgpuRenderer` is a **two-line change** — the import and the constructor — and the
      whole app kept working on the other backend with nothing else touched. Measured side
      by side: glTF loaded / loaded, particles 245 / 247 alive, tween 1.025–1.550 /
      1.050–1.575, lit pixels 9,462 / 10,903, console errors 0 / 0. The only WebGPU-only
      message is §10's dropped-time guard on the slower first frame — *"dropped 0.0666s
      … TimeState.droppedTime is now 0.0666s"* — which is the documented behaviour and names
      the field to inspect, not a defect.
      **Cycle 4 (2026-09-09, `.dogfood/cycle4`) — the three remaining surfaces,
      from a consumer seat, in one Scene, in Chrome + Node.** §56 `Text` via
      `buildGlyphAtlas` (layout 2.240 × 0.280); `.four.json` round-trip 7→7
      nodes, byte-stable 1939 B; §34 Rapier2D snapshot checksum restored
      exactly; 2D disc + 3D sphere + Text under one `PerspectiveCamera`.
      Engine: clean. Docs were the defect: `digital-twin.md` taught the
      `serializeScene` call that throws (no `nodeTypeOf`); `fourJS/text` does
      not export `Text` (umbrella only, §3.1); `examples/mixed-scene` is a
      playground re-export, not one graph. Guides + barrel headers corrected.
      Standing: next cycle picks a new surface, not these three.
      **Cycle 5 (2026-09-09, `.dogfood/cycle5`) — GPU picking / PickProvider.**
      Headless + Chrome WebGL 2: `registerPickingPipeline` →
      `createPickingService` → `createPickProvider` → `PointerInput`
      dispatched the front id. Engine: clean. Docs were stale (cameras
      guide described only the sync ray path); patched. No Pages demo
      calls `registerPickingPipeline()` (only `tests/browser/fixtures/picking-page.ts`).
      Standing checkbox stays open.
      **Cycle 6 (2026-09-09) — §43 interpolated skin palettes.** Consumer
      seat, public `@fourjs/*` APIs: two-bone hip+knee, hip rotated 90°
      about +Z. `Skeleton.update(mesh, worldOf)` at alpha 0 / 0.5 / 1
      (consumer `worldOf` composes `PoseBuffer.computeRenderPose` locals)
      matches `buildInterpolatedRenderList`. Palettes at 0 and 1 differ;
      mid-alpha is a 45° slerp (`cos(π/4)`), **not** the lerp of the
      endpoint palettes (`0.5`). Scene transforms unchanged. Engine: **clean**.
      Docs were the defect: guides and architecture still described §43 as
      node-matrix lerp only. Patched. Checkbox stays `[ ]`.
      **Cycle 7 (2026-09-09) — WebGL skinned GPU picking.** Consumer
      seat: `registerPickingPipeline` + `registerSkinningPipeline` then
      `createPickingService`. One-bone 2×2 plane translated +1 Y. Id pass
      compiles `skinMatrix()` + `pickId`, uploads the live palette
      (`jointMatrices[13] === 1`, not bind pose), unskinned control
      transcripts identical with/without the skinning seam. Recording GL
      cannot rasterise; staged texels still resolve through the §33 table.
      Engine: **clean**. Guide index patched. WebGPU still skips skinned
      items. Checkbox stays `[ ]`.

- [ ] **RFC 0004 residue (all deferred by the RFC's own §6 table, none
      scheduled; RFC corrections + plan 2026-09-10:
      `docs/plans/RFC-0004-RESIDUE_PLAN.md`):** video textures (frame-arrival signal, DOM-free);
      `ImageBitmap`/decoded-image raster sources (A-18's generic
      `FetchLike<TSignal>` half + the §96 decode row); in-place resize +
      partial/dirty-rect upload + mipmaps/filter modes for raster surfaces (all
      R-30); ~~GPU readback as a raster source (wants its own RFC)~~ **Proposed
      2026-09-06** (`docs/rfcs/0009-gpu-readback-raster-source.md` — display-only
      snapshot, not riding 0004/0005; corrected 2026-09-10, plan
      `docs/plans/RFC-0009-GPU-READBACK_PLAN.md`); the §62
      Canvas 2D backend (stays a stub **by decision** — and if ever built,
      refusing a feedback `CanvasTexture` sampling the surface being rendered is
      that packet's named obligation); ~~a docs/guides page carrying the browser adapter~~ (done 2026-08-29:
      `docs/guides/raster-painting.md`, listed as guide 15).

- [ ] **RFC 0001 residue (staged in source, 2026-08-28; RFC corrections + plan
      2026-09-10: `docs/plans/RFC-0001-RESIDUE_PLAN.md`, which also takes the
      node-material pixel golden the RFC owed):** uniform blocks (std140,
      with a measurement), reusable functions (named subgraphs need an emission
      scope + call-site key), conditional variants (a second cache dimension),
      storage buffers (§82, WebGPU), source maps (per-node provenance; the error
      path ships source + driver log); lighting-aware graphs (R-17's light-uniform
      contract exists on lit/standard; node emitters still unlit); alternative E (data-declared custom operators — a follow-up
      RFC; ~~`SHADER_OPERATORS` token~~ **DONE 2026-09-06**); ~~an angle operator
      (unlocks §58's conic gradient)~~ **DONE 2026-09-06** (`angle` +
      `registerShapePaints` conic lowering); ~~the §58 Paint-object tier on `Shape2D`~~ (done 2026-08-29).

- [ ] **RFC 0003 residue (staged in source, 2026-08-28; RFC corrections + plan
      2026-09-10: `docs/plans/RFC-0003-RESIDUE_PLAN.md`):** GPU morph path (the
      extra-vertex-stream layout decision, stated in `mesh.ts`/`render-list.ts`/§54);
      ~~skinned shadow caster program (the §69 pass skips skinned draws — a bind-pose
      shadow is a different picture)~~ **DONE 2026-09-09** (WebGL
      `SkinnedShadowProgram` via `acquireShadow()` on the first skinned
      caster; unregistered still skips); ~~WebGPU skinned colour pair~~ **DONE 2026-09-09**
      (`registerSkinningPipeline()` unlit+lit; 3072-byte palette bind group;
      skip unregistered/failed, never bind-pose;
      ~~WebGPU skinned shadow caster still skips~~ **DONE 2026-09-10**
      (`acquireShadow()` on the registered pair; lazy compile, fail-once
      skip, never bind-pose; palette at group 1);
      RFC 0005 skinned id lives in `wgpu-picking.ts`);
      CPU skinning (Canvas/SVG tiers + the skinned bounds/picking home,
      with its own `same-runtime` golden); bone-texture palette (unbounds
      `MAX_SKINNING_JOINTS = 48`; needs a render-target format union +
      vertex texture fetch); ~~§43-interpolated palettes (today the palette
      is the last resolved pose)~~ **DONE 2026-09-09**
      (`Skeleton.update(skinRoot, worldOf?)`; interpolated list composes
      local poses then the palette product — palettes are never lerped).

### Post-plan backlog (final exit verifier, 2026-08-02)

- [ ] Lighting follow-ups (MVP tier shipped 2026-08-04 — see Done):
      ~~point/spot multi-light~~ **DONE 2026-08-09** (R-17: `MAX_PUNCTUAL_LIGHTS`
      = 8; one directional still wins by scene-graph order). Remaining light
      types: extra directionals, ~~hemisphere~~ **DONE 2026-09-10**, rectangular area, clustered /
      forward-plus. Shadows (§69 — directional tier shipped 2026-08-09;
      cascades, point/spot maps, the atlas, transparent masks and contact
      shadows remain),
      §59 StandardMaterial/PBR rest (`normalMap` / `occlusionMap` staged;
      IBL / PhysicalMaterial extensions absent), §60a tone-mapping operator
      (sRGB encode + `ColorGradeEffect` shipped; operator waits on float
      targets),
      ~~CSS color strings on lights~~ **DONE** (`parseColorRGB` on `Light`),
      light layers; ~~hoist the lit shader's per-vertex inverse-transpose to a
      per-draw normal-matrix uniform when @fourjs/math grows a Matrix3
      utility~~ **DONE 2026-09-09** — WebGL `uniform mat3 normalMatrix`;
      WebGPU `DrawUniforms.normalMatrix` (192-byte block, standard extras
      shifted to 192/208). `Matrix3.setNormalFromMatrix4` on CPU; singular
      models upload identity. ~~WebGPU `metalRoughnessMap` staged inert~~
      **DONE 2026-09-09** (sampled at group 2 when `!map`, group 3 when
      albedo occupies group 2). ~~WebGL `emissiveMap` staged~~ **DONE
      2026-09-09** (unit 3, glTF factor × texture; WebGPU unsampled —
      groups 2/3 already hold albedo/MR). Remaining: extra directionals /
      area / clustered, cascades, PBR rest, tone-map operator,
      light layers, `normalMap` / `occlusionMap`, WebGPU emissive.
- [ ] First publish (§94 0.1): Changesets release workflow + the
      @danielsimonjr/fourjs publish-name mapping — owner step.
      **Infrastructure is done (verified 2026-09-07); the publish itself is not.**
      `release.yml` runs Changesets, `tools/apply-publish-names.mjs` exists with its own
      test, the version PR (#67) merged, and every package carries a 0.1.0/0.0.x version.
      What is missing is the release itself: **no git tag exists and nothing is on npm.**
      Publishing is ZBOOK-manual by charter and gated on Daniel's "not ready until we run
      more dogfooding cycles" — so this stays open on his word, not on missing work.

### Gap-closure wave 3 (2026-08-07) — in progress

> **2026-08-08:** `docs/GAP ANALYSIS v1.md` supersedes v0 as the working gap document —
> its §4.6 attack order and §5 owner-decision register are the tracker for what
> remains; the wave sections below are the historical per-batch record. v1 also
> recorded nine closures from `ab13840`/`fe8eb6f` (2026-08-06) that these sections
> never listed: PH-2, PH-3, PH-4, PH-7, PH-14, PH-15, PH-16, PH-1 stage 1, R-11, and
> the R-12/R-10 base tiers — all closed, now in CHANGELOG.

- [ ] **Follow-ups the R-1 plan explicitly defers** (each needs its own filing): §63
      transient-target pooling and barrier scheduling (must land on both backends or
      neither); §65's persistent-mapped/staging-ring buffers; §27 GPU fields
      (radial-only stub on `simulation: "gpu"`; generic GPU field stack staged)
      and §36 `collisions: "depth-buffer"` (CPU kill-below-ground + GPU
      `y=ground` rest; true depth-texture collide-and-kill still open); ~~RFC 0005's `Rectangle2` prerequisite for a regional
      `readPixels`~~ **DONE 2026-08-29** — `render/src/renderer.ts:464` states it outright
      (*"`readPixels` joined the interface when `Rectangle2` landed in `@fourjs/math`
      (2026-08-29; RFC 0005's recorded prerequisite, cleared)"*), `Rectangle2` is exported
      from `@fourjs/math`, and `render/src/read-pixels.ts:44` declares
      `readPixels(target, region?)`.

- [ ] **R-33 — §112's exit, rendered as well as simulated.** Owner: the browser-gate
      packet, on non-SwiftShader hardware. Now has headroom (see R-34).
      ~~Report simulate-ms and present-ms separately~~ **DONE 2026-09-09**:
      `examples/particles-demo` publishes `data-simulate` / `data-present`
      (seconds, §7a) on `#status`; the browser gate asserts they exist as
      two finite non-negative attributes. **No fps budget** — SwiftShader is
      not suitable hardware; the exit itself is still open.
- [ ] Batching follow-ups (§65, after R-9's consecutive-run tier, 2026-08-09):
      instanced meshes for the shaded pipelines (`R-22` — a baked batch has no normals);
      ~~glyph batching once `R-30` → `R-28` land a `Text` node (its sprites over one atlas
      material batch as they are)~~ **DONE 2026-08-13 (R-28)** — and both the CHANGELOG and
      the code say so: *"consecutive labels sharing a material merge into one draw under
      §65 batching, which closes §65's glyph-batching strategy at the label level"*, and
      `four/src/text-node.ts:71` repeats it, adding that the residue is grouping labels
      that do NOT share a material — which is the atlas-grouping sub-part already listed
      separately below, not a second open claim; texture-atlas _grouping_ of distinct textures (needs a
      packer); ~~a change-detecting batch cache so a still scene re-uploads nothing (§86's
      idle-scene row — today a batched run re-uploads every frame)~~ **DONE
      (already on the tree):** `RenderBatch.contentVersion` +
      `createGlBatching` `#canSkipUpload`;
      `webgl-renderer.test.ts` asserts a still scene issues **0**
      `bufferSubData` and a transform bump re-uploads. ~~WebGPU
      `WgpuBatching.draw` still `writeBuffer`s every frame~~ **DONE
      2026-09-10** (`#canSkipUpload` per slot; `contentVersion === 0`
      always uploads). Making batching the
      default still needs A-4's build-time pipeline-selection seam (the opt-in
      seam already costs every bundle +0.17 kB).
- [ ] **R-30c — the rest of §77, scoped by why each is not ordinary work:**
      ~~`capabilities.maxAnisotropy` / texture-format report~~ **DONE 2026-09-06**
      (lazy after init; `textureFormats` already shipped). `TextureSource.dimension`
      refuses non-2d. ~~map roles~~ **DONE 2026-09-09** (`TextureMapRole`
      `"color"` | `"data"`; omitted role keeps R-15 `"linear"` so goldens
      do not move; `role: "color"` defaults omitted `colorSpace` to `"srgb"`;
      authored `colorSpace` always wins; backends still read `colorSpace`
      only). Still open: cube/array/3D uploads, compressed containers,
      video/`ImageBitmap`, async upload.

      · **OVERLAP, closed 2026-09-09:** "A-19 remainder" described the SAME remaining
        work. A-19 is now marked merged; this is the surviving item. GlTF residue
        (morph / CUBICSPLINE / remaining texture slots) stays with those rows.

### Gap-closure wave 2 (2026-08-07) — in progress

- [ ] **2026-09-11 audit follow-ups** (three read-only audits; the mechanical
      findings landed the same day — see CHANGELOG — these need a measurement
      or a decision first):
      **Performance.** ~~(B1) Rapier adapters build `collisionstay` payloads
      (`#pairKey` strings, `contacts[]`, `Vector3`s per contact) for every
      active pair every step whether or not any listener exists — the
      benchmark's largest suspect (~9 of 10.4 ms/step at 5k piled bodies);
      gate on `RigidBody` listener presence, numeric pair keys, lazy
      `contacts`; re-run `physics-step` golden.~~ **DONE 2026-09-11**
      (`setEventInterest`, listener-gated, checksum-neutral). ~~(B4) batch content hash~~ **measured and declined 2026-09-11** (a
      version stamp misses the in-place matrix write the idle-skip contract
      pins; interpolated matrices change per frame). ~~(A2/A3) WebGPU per-draw allocations~~ **DONE 2026-09-11** (reused
      offset array; previous-draw pipeline memo). (A5/A6) WebGL
      `setColor`/`setTint` and `bindTexture` have no CPU mirrors — adding them
      changes the F13 GL-sequence goldens, so re-record deliberately. ~~(A7) `EventEmitter.emit` slices the listener array per emit~~ **DONE
      2026-09-11** (index loop + deferred compaction). (B2, B3, B5, B6, B7) measure
      first: Rapier wrapper allocations per body read, the resolver's
      `WeakMap` per node, the O(n·depth) interpolated list, string-keyed
      geometry/texture cache lookups per draw, the two O(n) pre-scans per
      WebGL frame. (D) `ShadowProgram`, `StandardProgram`, `EffectProgram`,
      the particle programs compile at init and ride every bundle (~2.7 /
      8.2 / 5.0 / 8.8 kB gz standalone) — each is a `register*()` seam
      candidate like skinning/picking/node materials; A/B per module.
      **Stability.** ~~77 `page.waitForTimeout` calls across 14 Playwright specs~~
      **DONE 2026-09-11** (0 left; `tests/browser/helpers/wait.ts`). The
      playground `each sensor zone repaints` race (a ~0.36 s screenshot window)
      is closed the same day: the emptiness proof is gated on the page's
      `data-zone*` occupancy mirror read before and after the grab.
      ~~`Scheduler.step` counter skew on a throwing step~~ **DONE 2026-09-11**
      (counters roll back with the accumulator). ~~Seventeen `dispose()` implementations have no disposed flag~~ **DONE
      2026-09-11** (eleven guarded; drag / snapshot-system / event-system /
      physics-system / adapter documented as exceptions; `gl-batch.ts` with
      the WebGL seams packet).
      WebGPU picking uses `CONTEXT_LOST` where the renderer uses
      `DEVICE_LOST` for the same condition (tests pin both; pick one).
      **Security.** ~~`bun audit` non-blocking~~ **DONE 2026-09-11** (critical
      gates; high stays visible). ~~glTF subresource fetches carry no abort signal~~ **DONE 2026-09-11**
      (`AssetLoadContext.signal` forwarded). ~~Manifest URLs have no origin
      policy~~ **DONE 2026-09-11** (`allowCrossOriginUrls`, default off).
- [ ] **§96 residue:** decompression limits — **half done 2026-08-21**: `createTextureLoader` enforces an absolute decoded-size bound and an expansion-ratio bound (pre-decode with a `probe`, post-decode without). Still open for gzip/Draco/Basis when they land, and for platform decoders that cannot be pre-bounded at all; shader trust **runtime** boundary is the closed operator union (shipped); **extensible** data-declared operators remain a follow-up RFC (0001 alternative E — `SHADER_OPERATORS` is the named hook only). **Plugin trust
      boundary discharged 2026-08-28 with A-3**: a plugin is a value, never a name from a
      document; enforced by `tests/integration/plugin-boundary.test.ts`; explicitly not a
      sandbox. Guide row **partial** 2026-09-10 (`docs/guides/security-and-untrusted-content.md`: texture-loader bounds; gzip/Draco/Basis still absent)

### Gap-closure wave 1 (2026-08-06) — follow-ups left open

Closed this wave, with tests: `A-7` (`Application.resize`), `A-9` (`PointerInput` dead-pointer
leak + `pointercancel`), `A-15` (unregistered components no longer dropped on save), `A-17`
(restored ids reserve against the counter; duplicate-id refusal), `A-14`/`PH-17` **partially**
(`MOTION_COMPONENT_SERIALIZER`, `registerSceneNodeTypes()`/`registerUISerializers()`), `PH-6`
(§34 `worldConfiguration`). What they left behind:

### Backlog additions (doc-truth sweep, 2026-08-05)

### Backlog additions (Phase 10, 2026-08-02)

### Backlog additions (Phase 9, 2026-08-02)

### Backlog additions (Phase 8, 2026-08-02)

### Backlog additions (Phase 7, 2026-08-02)

### Backlog additions (Phase 6 exit, 2026-08-02)

### Backlog additions (Phase 5, 2026-08-01)

### Chores (Phase 4 exit-verifier notes, 2026-08-01)

### Backlog additions (Phase 3 exit findings)

## Backlog

### Later milestones (decided 2026-07-29)

### Documentation

## Done

- **2026-09-05 — RFC 0006 TypeScript-on-Bun toolchain.** Bun workspace; spec 1.14; Vitest/`tsc -b` retained.

