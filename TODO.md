# TODO

Task tracker for four.js. Keep entries short and actionable; move finished items to **Done**
(newest first) with the date. Larger context and decisions belong in `MEMORY.md`; released
changes in `CHANGELOG.md`.

## Now

- [ ] **The implementation plan is COMPLETE (2026-08-02).** All 13 phase sections
      (§103–§113a) built, tested, verified. What remains is post-plan work, in the
      verifier's priority order:

- [ ] **RFC implementation queue (accepted 2026-08-21):** ~~0002 plugins (done
      2026-08-28)~~ → 0003 skinning → 0001 shader/node materials → 0005 pixel
      picking → 0004 raster painting, interleaved with WP-R1.3…R1.8. First-to-land
      of 0001/0003 owns the `RenderItemKind`/`pipelineId` widening.
- [ ] **Move the six capability tokens to their owning packages** when
      `packages/render`/`motion`/`physics`/`serialization` are free (RFC 0002 §2's
      spelling). They ship in `four/plugins.ts` because the A-3 packet could not
      touch `packages/render*`; `four` already depends on all four so no §3.1 edge
      moves either way, and the migration is a re-export — a token's identity is its
      `name` string.
- [ ] **Tokens for the five absent §81 extension points** arrive with the registries
      they need: asset formats (`asset-manager.ts` states there is no registry by
      design), materials/shader nodes (RFC 0001's deferred alternative E), UI
      controls, editor tools, compute workloads (§82, WebGPU).

### Post-plan backlog (final exit verifier, 2026-08-02)

- [ ] Lighting follow-ups (MVP tier shipped 2026-08-04 — see Done): multi-light +
      point/spot/hemisphere/area (§68 uniform arrays / clustered path), shadows (§69 —
      directional tier shipped 2026-08-09; cascades, point/spot maps, the atlas,
      transparent masks and contact shadows remain),
      §59 StandardMaterial/PBR, §60a color management + tone mapping + CSS color
      strings on lights, light layers; hoist the lit shader's per-vertex
      inverse-transpose to a per-draw normal-matrix uniform when @four/math grows a
      Matrix3 utility (dated note in gl-program.ts)
- [x] Spec-revisit note (2026-08-04) — **done, spec revision 1.8 (2026-08-08)**: §57's
      family list now names `LitMaterial`
- [ ] First publish (§94 0.1): Changesets release workflow + the
      @danielsimonjr/fourjs publish-name mapping — owner step

### Gap-closure wave 3 (2026-08-07) — in progress

> **2026-08-08:** `docs/GAP ANALYSIS v1.md` supersedes v0 as the working gap document —
> its §4.6 attack order and §5 owner-decision register are the tracker for what
> remains; the wave sections below are the historical per-batch record. v1 also
> recorded nine closures from `ab13840`/`fe8eb6f` (2026-08-06) that these sections
> never listed: PH-2, PH-3, PH-4, PH-7, PH-14, PH-15, PH-16, PH-1 stage 1, R-11, and
> the R-12/R-10 base tiers — all closed, now in CHANGELOG.

- [x] **R-1 / WP-R1.1 — WebGPU device, registry, clear, unlit triangle, fake-device
      harness. Landed 2026-08-21.** `RendererCapabilities` widened once (additive,
      optional members); `webgpu` Playwright project added with the flag confined to it
      (globally it perturbs the flagship's frame-pacing spec); render-list consumption
      harness added under `tests/determinism/`.
- [x] **R-1 / WP-R1.2 — WebGPU geometry, texture and sampler caches** (§77, §83) —
      **done 2026-08-28, all gates green.** Sampler cache keyed on the five resolved
      values; blit-based lazy mip generation; unlit `map` variant at bind group 1.
- [x] **R-1 / WP-R1.3 — sprites, text and `wgpu-batch.ts`** — landed 2026-08-28.
      Sprite pipeline over a second lazy group-0 layout; text proved as the textured
      unlit tier (R-28); `createWgpuBatching` uploader (buffer pair per batch slot —
      queue-order rationale in the module header; staging ring noted, not built).
      Browser specs written (sprites/batch + WP-R1.2's deferred texture evidence,
      stencil intersection), self-skipping; validated with the wave's browser gate
      at the RFC 0003 landing.
- [ ] **R-1 / WP-R1.4 → WP-R1.8** — shapes/vertex colours, lit + standard, render
      targets and effects (`readPixels` via `copyTextureToBuffer` + `mapAsync`),
      shadows and stencil parity, compute and GPU particles (unblocks R-31). Strictly
      serial; all share `packages/render-webgpu/src/`. Plan:
      `docs/plans/R1-WEBGPU_PLAN.md`.
- [ ] **§62's "applications may declare required and optional capabilities"** — still
      unimplemented; now that the capability record is complete it is cheap
      (WP-R1.9's first half, dispatches with the `R-14` wave).

- [ ] **R-31 stays blocked but is no longer evidence-blocked** — WP-R1.8 owns it;
      compute-with-storage-buffers is probe-verified to run headless in CI. Closes on
      WebGPU only; WebGL 2 declares the tier absent.
- [ ] **Follow-ups the R-1 plan explicitly defers** (each needs its own filing): §63
      transient-target pooling and barrier scheduling (must land on both backends or
      neither); §65's persistent-mapped/staging-ring buffers; §27 GPU fields and §36
      `collisions: "depth-buffer"`; RFC 0005's `Rectangle2` prerequisite for a regional
      `readPixels`.
- [x] **PH-11 residue — §12 character controllers DONE 2026-08-21.**
      `CharacterController` + `FirstPersonLook` in `@four/motion`, advanced by the
      existing `KinematicSystem` under §42's `"kinematic"` authority; §79 pair
      registered; new §33 golden; first-person closed by composition (character yaw +
      child-node pitch), not by a new rig class. Playground sensor-zone test verified
      green on the settled tree (the earlier failure was the in-flight build state).
- [x] **PH-11b — solver-backed character controller DONE 2026-08-21.**
      `SweptCharacterController` + `SweptCharacterSystem` in `@four/physics` over
      `PhysicsWorld.shapeCast` (§30): capsule sweep, slide-along-wall, step height,
      slope limit, ground snap. The recorded question is answered — it **holds** a
      `CharacterController` (its vertical state is ES-private with no setters, and
      `grounded` is a promise about a plane), so `@four/motion` needed no edit. §39
      step 4 before the solve, §42 `"kinematic"`, §79 with the physics family, new §33
      golden on real Rapier 3D. Platform carry and pushing dynamics staged with seams
      named (`groundBody` + `translate()` published for the first).
- [ ] **PH-11c — character/dynamics push interaction (`@four/physics`).** The one
      staged half of PH-11b that needs a _decision_ rather than code: how much impulse
      a kinematic character imparts to a dynamic body it sweeps into, how it is split
      against §23's mass, and whether it may wake a §32 sleeper. The seam is
      `RigidBody.applyImpulseAtPoint` at `ShapeCastHit.point`. Effort S once the
      policy is chosen; blocked on the choice, not on engineering.
- [ ] **Character-controller example follow-up (extended):** nothing in `examples/`
      exercises `CharacterController`, `FirstPersonLook` **or**
      `SweptCharacterController` — the only first-person camera and the only swept
      capsule in the repo live in tests. A single first-person example would exercise
      all three and the §39 ordering at once.

- [ ] **Character-controller example follow-up:** nothing in `examples/` exercises the
      new components — the only first-person camera in the repo lives in a test. Worth
      folding into the next examples packet.
- [x] **Tests typecheck sweep DONE 2026-08-21** — `pnpm typecheck:tests` added and
      wired into CI after `Build`; 21 errors in five classes fixed as the misspelled
      intent; the text visual golden regenerated deliberately (the fixture now clears
      as it always intended). Closes the hole R-8 identified.
- [ ] **A-11 / RFC 0005 — owner decision** on pixel + GPU-id picking
      (`docs/rfcs/0005-pixel-picking.md`). Six questions in the §5 register (rows
      18–20). Blocked on the owner, not on engineering.
- [ ] **A-11 analytic tier (`"geometry"`)** — unblocked since R-23/R-24's `toPath()`
      and **not** covered by RFC 0005: a normal packet in a layer that may import
      `@four/geometry`. RFC 0005 recommends it also add `node.hitTestMode` (§71's
      field, currently a silent divergence; §79 field + §90 scene-format row).
- [ ] **`Rectangle2` in `@four/math`** — still the shared prerequisite for §61's
      `readPixels`, staged in `render/src/renderer.ts` _and_
      `render-webgl/src/gl-render-target.ts`. RFC 0005 Q5 asks whether picking should
      bypass it entirely (it reads one texel, not a region).
- [ ] **Playground sensor-zone browser test failing on the shared tree (2026-08-21,
      under investigation):** `playground.spec.ts` "each sensor zone repaints" fails
      consistently while the character-controllers agent holds in-flight
      `packages/motion`/`physics` edits; the spec is untouched by any landed batch.
      Re-check on the settled tree at the controllers landing — it is that batch's
      gate to pass.
- [x] **R-37 CLOSED 2026-08-21** — §47's `ScreenCamera` (three origins × two unit
      systems, §7a defaults, negative near, §85 refusals, §79 pair) plus
      `Application.resize` feeding it through the structural `SurfaceSizedCamera`
      opt-in, and `TrackballRig`, the last staged §44/§47 rig. 27 new package tests, 4
      integration, 1 new browser test with pixel-exact placement on SwiftShader. 0 B in
      bundles that do not register serializers.
- [x] **Flagship UI-panel follow-up — DONE 2026-08-21 (examples packet).** Both
      flagships on the ScreenCamera recipe; workaround notes deleted; AUDIT-120 and
      the text README corrected with a new check-docs pin.
- [x] **Stale trackball staging note — DONE 2026-08-21** (rig table points at
      `@four/scene`'s `TrackballRig`).
- [x] **R-21 — §53 geometry model (2026-08-21).** `Geometry` base, `clone()`,
      `BoundingVolume` (box + circumscribing sphere). `GeometryBounds` aliased, R-8
      unmodified. Seven §53 subclasses and hierarchical volumes deliberately staged with
      the 2026-08-02 argument intact.
- [x] **R-34 — §27 field batching (2026-08-21).** `ParticleForceField.sampleAll`, all
      seven built-ins, bit-identical, per-field cost 5.15 → 1.12 ms;
      `benchmarks/results/particles-100k.json` re-recorded (3-field 100k stack
      16.58 → 4.51 ms).
- [ ] **R-32 — textured / rotated / soft particles.** Owner: the `render-webgl`
      particle-pipeline packet (NOT `@four/particles` — the flat square, the shader pair
      and the 8-float instance stream are all backend-side; the stream constant is
      triplicated across three packages by §3.1). Design recorded in the GAP row.
      Sequence after the ScreenCamera wave so the particle pixel goldens move once.
- [ ] **R-33 — §112's exit, rendered as well as simulated.** Owner: the browser-gate
      packet, on non-SwiftShader hardware. Now has headroom (see R-34). Report
      simulate-ms and present-ms separately.
- [ ] **R-31 — GPU particle simulation.** Blocked by R-1 (WebGPU is one line) and §82.
      Do NOT add an accepted-then-rejected `simulation: "gpu"` option — the type-level
      absence is a recorded WP-9.1 decision.
- [x] **R-7 — §67 stencil support (2026-08-21).** `StencilState` in `@four/materials`,
      `RendererOptions.stencil` / `RenderTargetOptions.stencil`, backend application and
      packed `DEPTH24_STENCIL8` allocation, `FRAME_BEFORE_R7` recorded on the reverted
      build, real-driver masking proof (browser gate now 64 tests). Budgets bumped
      34/31/39.5 kB with A/B measurements.
- [x] **§67 clipping API (from R-7's residue) — closed 2026-08-28.** `node.clip` in
      `@four/scene`; allocator/mask emission in `@four/render/src/clip.ts`; backend
      application, §79 pair, batching break, per-view masks; browser proof
      `tests/browser/clipping.spec.ts` (nested intersection measured at exactly 1/6).
      §73's scroll view now waits only on §74 overflow/scroll extent + a gesture
      source (staging note updated in `widget.ts`); §119's section views unblocked
      (a section view = a clip whose source is a §50 shape). Staged with named
      owners in `clip.ts`: alpha masks, 3D clip planes; the scissor fast-path
      bullet below is unchanged and still open.
- [x] **render-webgpu ignores `item.clip`** — closed by WP-R1.3 (2026-08-28): masks
      write bit planes / content tests them, `item.clip` outranks `material.stencil`,
      batch runs break on record identity; `depth24plus-stencil8` chosen per frame
      from R-23's O(1) first-item read; clipless transcripts byte-identical. Residue
      (rides WP-R1.7's stencil-parity packet): §57 `material.stencil` on a frame that
      never clips is inert on WebGPU — GL-without-`{stencil:true}` parity, stated in
      source.
- [ ] **Sprite §79 flag drop (pre-existing, found 2026-08-28):** the writer writes
      `castShadow`/`receiveShadow`/`frustumCulled` for sprites; `Sprite`'s
      constructor filters its options and drops all three, so they do not survive a
      round trip. `clip` was plumbed through explicitly; the other three need the
      same one-line pass-through plus a round-trip test.
- [ ] **Scissor clipping (§67's first bullet, small)** — unrelated to the stencil and
      unblocked: the backend already keeps `SCISSOR_TEST` enabled and sets the rect per
      view. A per-item scissor is a render-list field, not a buffer.
- [ ] **Flake to watch (pre-existing):** `packages/render/tests/shape.test.ts`'s "widens
      to a 32-bit index buffer" times out under `--coverage` on a loaded box. Either
      raise that one test's timeout or shrink the fixture; do not weaken the assertion.
- [x] **PH-21 — §39 step 9 occupiable (2026-08-21).** `PhysicsEventSystem` at
      `PRIORITY_EVENT_DISPATCH` + `PhysicsSystemOptions.dispatchEvents`; golden
      `event-dispatch-split.json`. Steps 7–8 closed as not splittable, documented in
      `physics-event-system.ts`.
- [x] **PH-20 — §33 rollback (2026-08-21).** `RollbackBuffer` + `RollbackTarget` in
      `@four/diagnostics`; `tests/determinism/rollback.test.ts`.
- [ ] **PH-22 residue (re-read 2026-08-21):** `PH-22f` joint-anchor mutability still
      blocked on the which-pose decision (physics-joints packet); `PH-22i` IK still
      blocked on a skeleton/chain model (PH-10's skinning RFC) + an adapter RFC;
      `PH-22l` `Clock` is naming-only (owner call); `PH-22n` remainder — §10's
      dropped-time warning is app-tier in `packages/four`'s `Application`.
- [ ] **Step-8 sensor bookkeeping example.** `PRIORITY_SENSOR_UPDATE` is now genuinely
      reachable (a system there runs before listeners at 900). Worth one worked example
      in `examples/physics-playground` showing a sensor tally read at 800 and consumed
      at 900.
- [x] **R-8 DONE 2026-08-09** — §64 per-view render lists (`buildViewRenderList`, derive
      not rebuild), §87 frustum culling (`Frustum` in `@four/math`,
      `computeWorldBoundingSphere`, default-on, fails towards drawing), §49
      `frustumCulled` (§79-serialized), and §66 key 4 (`sortRenderListByDepth`, opt-in
      verb). Budgets bumped 32.5/30/38 kB with A/B measurements. Residue: occlusion
      culling and a spatial index — neither blocks anything.
- [ ] **R-8 follow-ups:** (a) one comparator carrying §66 keys 3 and 4 — a real design
      question (which key wins for transparent content), staged rather than guessed;
      (b) a bound over a §36 particle system's _live_ particles (today its item is
      `frustumCulled: false` as data — the shared instance quad's bounds are a square at
      the emitter); (c) sweep `tests/` for options objects with fields the target type
      does not declare — three found in `tests/integration` by R-8; `tests/` sits
      outside every tsc project, so excess-property checking never runs there.
- [x] **PH-8 — §26/§27 force fields for rigid bodies.** Closed 2026-08-09: `ForceField` +
      `ForceFieldSystem` at §39's `PRIORITY_FORCES`, `PhysicsWorld.forEachActiveBody`,
      required per-field units, structural reuse of `@four/particles`' §27 field set with
      no new §3.1 edge, new same-runtime golden
      `tests/determinism/golden/force-fields.json`.
- [x] **PH-12 — §8 space modes, physics tier.** Closed 2026-08-09: `SpaceMode` vocabulary
      in `@four/core`, `RigidBody.space`, `PhysicsWorld.addBody` enforcing §8's sentence
      with two distinct refusals, §79 round trip.
- [ ] **§8 node-level `NodeSpace` component (PH-12 remainder).** One packet, three parts
      that cannot be split: the component class, its §79 serializer, and its registration
      in `registerSceneNodeTypes` (`packages/four/src/scene-serializers.ts`) — a
      component with a `static typeName` and no registered serializer makes
      `serializeScene` throw. Should land with the render-side consumer that gives
      `screen`/`viewport`/`camera`/`billboard` a meaning (§47/§48/§74). Owner: whoever
      takes the screen-space UI packet.
- [ ] **§21 `"local-plane"` simulation frame (PH-12 remainder).** A plane descriptor on
      the world plus a mapping in `PhysicsWorld`'s feed and publish passes; `addBody`
      refuses the mode loudly until then. Touches the step path — needs its own
      determinism golden.
- [ ] **§27 field torque and field-driven waking (PH-8 remainders).** Both deliberately
      absent with recorded reasons: §27's `sample` names no angular channel, and
      automatic waking needs a per-entry `wakesSleepingBodies` flag plus a policy for two
      entries that disagree.
- [x] **R-10 keys 3–4 DONE 2026-08-09 (key 3 shipped, key 4 staged on R-8)** —
      `groupRenderListByPipeline` puts §66's key 3 in a second verb, stably, with
      `RenderItem.materialId` as its material half; `buildRenderList` untouched and every
      existing scene byte-identical. Key 4 deferred on `R-8`'s per-view list with a dated
      argument (one list, many views ⇒ a depth key would be wrong, not merely
      disruptive).
- [x] **R-9 DONE 2026-08-09 (consecutive-run tier)** — §65 sprite and compatible-shape
      batching: `RenderBatcher` (`@four/render`) + `createGlBatching()`
      (`@four/render-webgl`), opt-in per renderer and 0 B in bundles that do not ask.
      Drawn through the existing unlit program (no new pipeline, no shader edit); pixel-
      identical on SwiftShader (0/76 800 differ, 13 draws → 3); 100 k sprites → 7 draws,
      50 k shapes → 4. Two §86 rows moved from feature-blocked to half-measured.
- [ ] Batching follow-ups (§65, after R-9's consecutive-run tier, 2026-08-09):
      instanced meshes for the shaded pipelines (`R-22` — a baked batch has no normals);
      glyph batching once `R-30` → `R-28` land a `Text` node (its sprites over one atlas
      material batch as they are); texture-atlas _grouping_ of distinct textures (needs a
      packer); a change-detecting batch cache so a still scene re-uploads nothing (§86's
      idle-scene row — today a batched run re-uploads every frame); making batching the
      default, which needs A-4's build-time pipeline-selection seam (the opt-in seam
      already costs every bundle +0.17 kB).
- [ ] `buildRenderList` is now ~40% of a 100 000-sprite frame's preparation
      (`benchmarks/results/render-batching.json`, 2026-08-09) — the next §86 batching win
      is in list construction, not in batching. Worth a look together with `R-8`'s
      per-view restructure.
- [x] **R-36 DONE 2026-08-09 (helper tier)** — `Node.lookAt(target, up?)` +
      `Node.getWorldDirection(out)` over `Quaternion.setFromLookDirection`; −Z confirmed
      as every node's forward, world-space target with the parent rotation divided out,
      §85 refusals, `same-runtime` determinism. `getWorldDirection` hoisted off the two
      light classes; `Matrix4.decompose` now shares one Shepperd implementation (goldens
      bit-identical, `matrix4.ts` to 100%). 36 tests. **Rig half still open.**
- [x] **R-28 DONE 2026-08-13 (bitmap-label tier)** — the `Text` node in `four`
      (dependency matrix forbids `render`↔`text`), one geometry over one atlas material,
      one draw per label; §65 glyph batching closed by construction; §56 alignment on
      `layoutText` (cross-platform §33 tier, stated mechanically); §79 pair with loud
      atlas refusal; `castShadow` false-by-data on this class alone. §86's
      animated-glyph row now `half`-measured.
- [x] **R-30 advanced 2026-08-13 (sampler-state tier)** — `TextureSource.filter`/`wrap`
      through `Texture`/`MaterialTexture` to `TextureCache`; structural byte-identity;
      +0.11 kB per Texture-carrying bundle.
- [x] **R-30b advanced 2026-08-21 (mipmap + anisotropy tier)** — `TextureSource.mipmaps`
      / `.minFilter` / `.anisotropy`, applied by `TextureCache` at upload
      (`generateMipmap`, the min/mag split, a lazily negotiated
      `EXT_texture_filter_anisotropic`). `Texture.byteLength` bills the chain.
      Byte-identity structural, asserted as whole transcripts; new integration + browser
      gates. `@four/assets` deliberately untouched — mipmap generation is an upload
      decision, and `new Texture({ ...asset, mipmaps: true })` already works. Budgets
      bumped 34.5/32/40.5 kB with A/B numbers.
- [ ] **R-30c — the rest of §77, scoped by why each is not ordinary work:** cube/array/3D
      targets (sampler-type change in every shader — pipeline/RFC-entangled, pairs with
      R-1); compressed containers (`compressedTexImage2D`, a format enum shared with §79,
      §62's compressed-format capability report — pairs with R-31/R-32); video and
      `ImageBitmap`/canvas sources (per-frame update semantics under §9; the DOM-free
      `TextureSource` rule puts the adapter in `@four/assets` — A-19's successor); §77
      map roles (which would let §60a's colour-space defaults land); async upload and
      residency diagnostics (§84 counters plus a worker split). Also: a §62
      `capabilities.maxAnisotropy` / texture-format report, deliberately not added by
      R-30b because reading it at `initialize` would move landed GL transcripts.

- [x] **Examples onto `Text` — DONE 2026-08-21**, extended to both flagships
      (layer assignment needs one node per label). Draw calls: first-2d 30 → 1,
      ui-demo 44 → 3, twin 159 → 59; bundles shrank; two ui-demo goldens
      regenerated deliberately (glyph pixels only, crisper).
- [x] **§44/§47 camera rigs DONE 2026-08-09 (R-36 rig half + PH-11)** — `OrbitRig`,
      `FollowRig` (follow target **and** spring arm, one class switched by `frame`,
      smoothed by `SpringDamper`), `LookAtConstraint` and `ConstraintSystem` at §39
      step 7 under §42's `"constraint"` authority — the first producing system that
      authority has ever had. A rig places, a constraint aims, both in one system
      because §42 gives a node one owner. Path animation and physics attachment close
      by composition (no class). §85 refusals at authoring, counted skips
      mid-simulation, §79 serializers registered in the same batch, new determinism
      golden. 0 B in five of six bundles, +2.8 kB in `motor-digital-twin`.
- [ ] **§12 character controllers, and first-person camera control with them (PH-11
      residue, 2026-08-09)** — the last open §12 feature. First-person is filed here
      rather than with the rigs because it _writes a rotation_, so it collides with
      `LookAtConstraint` for the node's one §42 authority; the packet has to decide the
      aim-vs-free-look arbitration, and a character controller wants the same yaw
      source. Effort M.
- [ ] **Staged rigs (R-36/R-37 residue, 2026-08-09):** trackball belongs to the
      `ScreenCamera` packet (defined over a viewport in screen space; `motion` has no
      `input`/`render` edge); fly is a two-line application snippet once deltas are fed
      in and needs no class; shake/impulse is a `CameraShake` additive offset over
      `SeededRandom`, blocked only on choosing an interpolated value-noise function —
      per-step white noise is a jitter whose character changes with the fixed rate
      (§33).
- [ ] **Nothing exercises a rig against a live solver (2026-08-09)** — §44's _physics
      attachment_ is argued from the priority numbers (`PRIORITY_CONSTRAINTS` 700 >
      `PRIORITY_PHYSICS_SOLVE` 600) and from a rig reading rather than writing its
      target. Cheap to make evidence: add a `@four/physics-rapier` arm to
      `tests/integration/camera-rigs.test.ts` chasing a dynamic body.
- [ ] **§44/§47 camera rigs (R-36 rig half + PH-11)** — orbit, fly, first-person,
      trackball, follow target, spring arm, shake/impulse, path animation, physics
      attachment; plus §12's orbit motion and character controllers. Build on
      `Node.lookAt`. The look-at _constraint_ wants §42's `"constraint"` authority,
      which has no producing system: seam is a `LookAtConstraint` component + a system
      at `PRIORITY_CONSTRAINTS` (empty today, PH-21). One packet, effort L.
- [x] **Examples onto `lookAt` — DONE 2026-08-21.** Camera and sun in
      `first-3d-scene`; the aim moved 2×10⁻⁴ rad, no golden at risk, thresholds
      held. Rigs declined on merit (nothing moves).
- [ ] **Size budgets are thin after R-36 (measured A/B, 2026-08-09)** — first-3d
      31.30/31.5, ui-demo 36.73/37, particles-demo 28.70/29 (each +0.50 kB gzip;
      `Node`/`Quaternion` methods are never tree-shaken, so every bundle pays). Proposed
      bumps, owner call: first-3d → 32 kB, ui-demo → 37.5 kB, particles-demo → 29.5 kB.
      The concurrent render batching work is consuming the same headroom.
- [x] **R-16 DONE 2026-08-09 (solid-paint + full-stroke tier)** — `Paint`/`SolidPaint`,
      `ShapeFill`, `StrokeStyle` whole (alignment, caps, joins with miter-limit
      fallback, dashes with phase offset) over `expandStroke` in §52's tessellation
      module; `Line`/`Polyline`/`Arc` complete all fourteen §50 rows (twelve classes);
      fill+stroke travel as per-vertex colour — no `RenderItemKind`, no pipeline, no
      frame-path edit. **Group 5 (the 2D vector stack) is closed.**
- [ ] **The shape paint pipeline** _(R-16 residue, blocked on RFC 0001/0003 deciding
      `pipelineId` — first to land owns it)_: §58's six non-solid paints (linear /
      radial / conic gradients, patterns, procedural, render-target) — per-vertex colour
      is exact only for solids and two-stop linear gradients, so the exact tier is a
      compiled pipeline at the measured ~1.9 kB-per-`WebglRenderer`-bundle price; §52's
      anti-alias fringe (needs a per-vertex coverage attribute no §57 pipeline reads).
      This is also what would finally give `ShapeMaterial` content (re-examined and
      deliberately unshipped twice — R-23, R-16).
- [ ] **R-23 follow-ups (solid-fill tier shipped 2026-08-09):** (a) §50 residue after
      R-16 — clipping and masks (needs §57's `stencil`, which no backend reads), Boolean
      geometry operations (§51's four, the shared planar-subdivision packet), world
      bounds (§87), analytic hit testing (`A-11`, whose §50 blocker fell — every shape
      answers `toPath()`); (b) screen-space flattening tolerance — `Shape2D.tolerance`
      is a world-space length by decision; a screen-space one needs a per-view render
      list (`R-8`) and a rebuild inside the frame, which §61 forbids throwing in.
- [ ] **R-26 follow-ups (path-data tier shipped 2026-08-09):** (a) the `<svg>` document
      tier (`viewBox`, `transform`, `<g>`) is an owner decision — ship a small XML
      tokenizer in `@four/geometry`, or take a host-parsed document through an injected
      seam (`DOMParser` is browser-only and packages must stay node-safe per
      `graph:check`); (b) SVG shape elements map onto R-23's classes and presentation
      attributes (`fill`/`stroke`/`fill-rule`) onto R-16 when the document tier lands;
      (c) residual: arc → arc seams still carry §51's sub-ulp implicit connecting
      segment — tangentially continuous, no §52 refusal observed, but the general fix
      needs §51 to express "this arc starts exactly here"; (d) a lossy
      `formatSvgPathData` precision option is deliberately absent — the packet adding it
      must decide what it does to `golden/svg-path.json`; (e) doc-truth gap found:
      `tools/check-docs.mjs` does not scan `packages/*/README.md` — 24 unguarded prose
      surfaces (geometry's was two days stale).
- [x] **RFCs 0001–0003 drafted 2026-08-07** (R-14, A-3, PH-10/R-22) — all three
      **owner decision pending**; packets blocked on acceptance: - R-14 packet gate: byte-identical GL for node-material-free scenes (F13 method) + grep-proven bundle A/B; sequence R-12 (done) → R-14 → {R-1, R-6 widening,
      R-13} - PH-10/R-22 named owner question: bone-axis convention (RFC recommends imposing
      none; +Y for helpers only). Packet gates: `MorphWeights` is the sixth
      `static typeName` and fails the registry-completeness test until registered - Cross-RFC coordination: 0001 and 0003 both widen `RenderItemKind` — whichever
      packet lands first owns the `pipelineId` shape - New spec-revisit items: §57 `ShaderMaterial` row may become permanently
      unshipped (0001 Q1); §54 `morphTargetWeights` placement conflicts with §3.1
      (0003); §17's track-type promise in `track.ts:40-45` is wrong (binding forms,
      not `ValueKind`s)
- [x] **A-8/R-2/PH-19 CLOSED 2026-08-07** (one design, three filings): renderer +
      solver registries with explicit registration; `renderer: "auto"` /
      `solver: "auto"`; instance-naming apps keep tree-shaking (grep-proven)
- [ ] **Auto-selection follow-ups:** ui-demo is at 30.74/31 kB after this packet —
      review the limit before the next ui-demo-touching packet; register a second
      backend (R-1) so §62's ladder has a real WebGPU rung (upper rungs currently
      exercised against doubles)
- [x] **PH-9 CLOSED (state-machine tier) 2026-08-07:** `AnimationController` — seven
      of §18's nine features, typed predicates, own determinism golden, animation
      package still 100% coverage
- [ ] **PH-9 follow-ups (staged 2026-08-07):** blend trees (N-way channel sample);
      layered/additive animation (needs an additive op on `ValueAdapter` + a
      layer/claim policy); clip-event dispatch from a controller; "any state"
      transitions; live three-clip interruption chasing; optional `when` string sugar
      compiling to the typed records
- [x] Spec-revisit note (2026-08-07) — **done, spec revision 1.8**: §18 + §97a rewritten
      to shipped; §100 triaged out (a requirements list, never a status claim)
- [x] **R-6 CLOSED (full-screen effect tier) 2026-08-07:** `EffectRenderPass` as a
      third graph pass kind; copy + colour grade; separate `renderEffect` verb keeps
      `render` byte-identical; ui-demo budget bumped 30 → 31 kB on a proven structural
      conflict (even a stubbed renderEffect exceeded by 99 B)
- [ ] **R-6 follow-ups (§70 tier 2):** per-viewport effect rectangles ("composable per
      viewport"); tone mapping + sRGB encode with §60a/R-15 colour management + float
      targets; the §63 on-screen pass inspector R-6 unblocked (needs the per-effect
      viewport rectangle); outlines still wait on R-7/§71; user-authored effects are
      R-14's RFC (the closed `ScreenEffect` union is the widening point)
- [x] **A-2/PH-13 CLOSED 2026-08-07** (one item, filed twice): §40 `UnitSystem` in
      `@four/core` at the conversion/authoring tier the spec specifies; display-only
      rule enforced by an integration test that forbids any other package importing it
- [ ] **§40 follow-ups:** physics §41-envelope-in-SI (`PhysicsWorldOptions.units`, a
      `@four/physics` packet); §79 header units (after A-16); text parsing
      (`parseAngle("90°")` — needs locale + failure policy); consider a row for
      `packages/math/src/color.ts` at 0% coverage (pre-existing, spotted during gates)
- [x] **R-5 CLOSED (linear-pass tier) 2026-08-07:** `RenderGraph` in `@four/render` —
      passes over R-4's target seam, transcript-identical to hand-written calls,
      tree-shakes out of all bundles. **R-6 (§70 post-FX) now unblocked — effects are
      graph passes; do not build a parallel mechanism**
- [ ] **R-5 follow-ups:** add `INVALID_RENDER_GRAPH` to §89's `FourErrorCode` union and
      switch `GRAPH_ERROR_CODE` to it; adopt `tests/integration/helpers/recording-gl.ts`
      in `render-to-texture.test.ts` (mechanical dedupe); §63's on-screen pass-output
      debug view waits on §70's full-screen blit; format the two pre-existing prettier
      warnings (`packages/render/package.json`,
      `tests/integration/examples-build-coverage.test.ts`)
- [x] **PH-5 CLOSED 2026-08-07:** `PhysicsWorld.addCollider`/`removeCollider` — one
      collider on a live body, handle/id/checksum position/joints/pose all surviving;
      mass proven both directions on authored- and derived-mass bodies; §34 needed
      nothing. PH-1's post-registration-collider refusal blocker lifted
- [x] **PH-1 CLOSED 2026-08-07** (stage 1 truth table 2026-08-06; stage 2 live writes
      2026-08-07): `SolverBodyTuningAccess` + step-top drain; mass/damping/gravity/CCD/
      collider material/filter live on Rapier; `PhysicsWorld.teleport` ships
- [ ] **PH-1 follow-ups:** (a) PH-5 (runtime collider add/remove) is now the only
      blocker on a `Collider` appearing after registration — `refreshCollider` refuses
      one loudly; (b) `Collider`'s six live fields could become accessors in a future
      pass, removing the need for `refreshCollider` (deliberately not done — public-field
      shape change, serialization risk); (c) live velocity writes on a dynamic body need
      a §42-style "who wins" rule first
- [x] **A-1 DONE (measurable tier) 2026-08-07:** `app.stats` (`FrameStats`, §84's
      eleven counters; opt-in, default off; byte-identical GL + allocation-free when
      off). The A-6 `app.stats` slice is closed
- [x] **A-4 CLOSED (build-mode tier) 2026-08-07:** `DEV`/`devWarn*`/`devAssert` behind
      optional `__FOUR_DEV__` (dev-default, opt-out); §84 stats + §6a duplicate warn +
      §83 leak audit gated; eight example configs define it false; 0.46–0.52 kB gzip
      saved each (ui-demo 30.46/31); §33 allowlist enforced by an integration test.
      A-1 follow-up (d) closed; A-5's dev-flag dependency discharged
- [ ] **A-4 remainder:** the `@four/diagnostics` §85 validation catalogue (closure
      step 2); converting scattered scene/physics checks to `devAssert` (step 3);
      routing §42's authority-conflict warn through `devWarnOnce` (step 4 — scene
      package); R-6's effect pipeline needs an opt-in registry split, not the dev
      define (0.75 kB); remaining §83 warnings: disposed-in-use, duplicate asset
      loads, detached-node listeners, stale physics handles, per-frame allocations
- [x] **§118 flagship DONE 2026-08-07** (A-21's second half):
      `flagship/one-scene-everything-moves` — §118's full list in one scene, 6
      measuring browser tests (49 total), first user of the §62/§37 registries and
      the §113 overlay streams. Remaining under A-21/S-8: the three §93 stand-in
      scenes (owner retire-or-write decision) and §119's motor-digital-twin
- [ ] **Flagship follow-ups:** (a) per-dimension Rapier registration to halve the
      1.54 MB payload (registerRapierSolver pulls both wasm images); (b) widen
      `examples-build-coverage`'s regex to nested example paths (matches only the
      first segment today); (c) `collectBodyOrigins`' default cross size is invisible
      in 3D (drawn inside the body; 0 pixels at 0.18, 251 at 0.55) — consider a
      larger default or a doc note; (d) §46 layers would let the panel move to its
      own viewport
- [x] **A-5 partial DONE 2026-08-07 (accounting tier):** byte + live-instance
      accounting on BufferGeometry/Texture/RenderTarget; §84's two memory counters
      live. A-1 follow-up (b) closed
- [ ] **A-5 remainder (dev-warning tier, folded into A-4):** the six §83 development
      warnings — leaked resources (now _derivable_ from the counters, but nothing
      warns), disposed-in-use, duplicate asset loads, detached-node listeners, stale
      physics handles, per-frame allocations; creation-site capture and
      FinalizationRegistry leak detection need A-4's dev flag
- [ ] **A-5 follow-ups:** AssetManager duplicate-load warning; materials + solver
      handles unaccounted (§83 names "GPU and solver resources");
      `RenderTarget.byteLength` hardcodes DEPTH_COMPONENT16 (2 B/texel) — must move
      with §67's DEPTH24_STENCIL8 and float formats
- [ ] **A-1 follow-ups:** (a) `physicsStepTime`/`contacts`/`activeBodies` wiring
      belongs to the packet that gives `Application` a physics world (A-6);
      (c) `gpuFrameTime` waits on `RendererCapabilities` growing §62's timestamp-query
      field; (d) **A-4's `__FOUR_DEV__` define should drop the §84 path from production
      bundles** — now the practical blocker: ui-demo is at **30.96/31 kB (~40 B
      headroom)** after A-5; Application's unconditional stats references cost ~0.4 kB gzip per
      example and ui-demo is at 29.68/30 kB (0.32 kB headroom); (e) `WorldTransformStats`
      (visited/recomputed) is computed every frame and unexposed — deliberately, §84
      does not name it

- [x] **A-12 cheap tier DONE 2026-08-07:** `Toggle`, `Checkbox`, `RadioButton`,
      `Slider`, `ProgressIndicator`, `ImageWidget` — nine of §73's sixteen now ship.
      Follow-ups now recorded per blocker: menu/tooltip need a widget-reachable §9
      update hook; list/virtual list/scroll view need §74 overflow + §67 clipping; text
      input needs §56 (S-6); embedded viewport needs §48; slider drag-past-the-track
      needs §71's analytic drag plane
- [x] **R-4 DONE 2026-08-07:** `RenderTarget` (@four/render) + `RenderTargetCache`
      (@four/render-webgl), `Renderer.render(..., target?)`; render-to-texture through
      the untouched `MaterialTexture` seam; no-target frames issue zero framebuffer
      calls (byte-identical 449-call proof). **R-5 (§63 graph) and R-6 (§70 post-FX)
      now unblocked.** Follow-ups: `Viewport.renderTarget` (needs @four/scene),
      `readPixels` + `Rectangle2` in @four/math (§92 first consumer), stencil (R-7),
      MRT/multisample/float formats, samplable depth (§69)

### Gap-closure wave 2 (2026-08-07) — in progress

- [x] **A-23 DONE 2026-08-07** (§96): asset `maximumBytes`/`timeoutSeconds`,
      `decodeSceneDocument`/`decodeReplayRecording` over `parseUntrustedJson`
      (text-length + iterative depth limits), `UNTRUSTED_INPUT_REJECTED`, the
      security guide, and the CSP grep test
- [x] **A-18 abort half DONE 2026-08-09** (§76): `load(url, loader, { signal })` over a
      structural `AbortSignalLike`, refcounted (last waiter's abort abandons the load),
      `AssetManagerOptions.abortController` + `canAbortTransport` for transport-level
      abort, which the §96 deadline now uses too. The generic `FetchLike<TSignal>`
      design recorded on 2026-08-07 was built as recorded; the variance trap it did not
      foresee (a `TSignal` field breaks `AssetManager<AbortSignal>` → `AssetManager`) is
      solved by erasing the parameter at the constructor, and both properties are
      compile-time assertions in `tests/integration/asset-abort.test.ts`
- [ ] **A-18 remainder:** streaming, dependency graphs, progress reporting, worker
      decoding, hot reload. Each needs a contract this packet does not have — progress
      needs a byte-length channel `FetchLike` does not expose, dependency graphs need a
      loader that can load, hot reload needs a dev-server protocol. **Content hashing
      DONE 2026-08-21** (SHA-256 behind an injected `digest`, `expectedHash`
      verification that refuses rather than passes, §79 manifest in `src/manifest.ts`)
      — `A-16`'s manifest is unblocked
- [ ] **A-16 remainder (manifest half):** the §79 manifest substrate ships in
      `@four/assets` (2026-08-21). What is left is `@four/four`:
      `SceneResourceCatalog.get(key)` is synchronous, so wiring is preload-then-catalog
      — walk a document's resource keys, `loadFromManifest` each, hand the resulting map
      to `resourceCatalog(...)`. `tests/integration/texture-manifest.test.ts` runs the
      seam by hand today
- [ ] **A-19 remainder:** §78 glTF/GLB (three blockers unchanged: §55/§59 materials, the
      renderer-side texture tier, skins/morph targets — RFC 0003 answers the third on
      paper) and renderer-side §77 (`R-30b`). The assets-side texture loader tier
      shipped 2026-08-21 (`createTextureLoader`, `TextureAsset`, §96 decompression
      bounds)
- [ ] **§96 residue:** decompression limits — **half done 2026-08-21**: `createTextureLoader` enforces an absolute decoded-size bound and an expansion-ratio bound (pre-decode with a `probe`, post-decode without). Still open for gzip/Draco/Basis when they land, and for platform decoders that cannot be pre-bounded at all; shader trust boundary still open (RFC 0001's, not A-3's — shading is a graph of
      closed operators and a new operator is out of scope in both RFCs). **Plugin trust
      boundary discharged 2026-08-28 with A-3**: a plugin is a value, never a name from a
      document; enforced by `tests/integration/plugin-boundary.test.ts`; explicitly not a
      sandbox. Guide row moved absent → partial
- [ ] **Regenerate `docs/Architecture/` graph artifacts** (`pnpm graph`) — dependency
      graph + export surfaces are stale for the wave-2 exports (new input/ui/geometry/
      materials/assets/core/serialization/diagnostics surface)

- [x] **R-19 + R-20 DONE 2026-08-07** (render-tier keystones): `BufferGeometry.uvs`/
      `.colors`, `UnlitMaterial.map`/`.vertexColors`, `LitMaterial.map`, nine 3D
      primitives. **R-35 is now unblocked** (data path + vertexColors exist; what's left
      is wiring `DebugDrawBuffer`'s 7-float layout into a `BufferGeometry` — a
      `@four/diagnostics` packet). R-9/R-13/R-22/R-30/R-32 lose their R-19 dependency
- [ ] **R-19/R-20 follow-ups:** §52 tessellation module (lifts the concave-extrude
      restriction); §55 atlas packet (retires the sprite `quad` uniform with authored
      uvs); qualify `docs/AUDIT-120.md`'s "basic 3D meshes: shipped" row honestly
- [ ] **Flaky gate (pre-existing, confirmed at baseline 2026-08-07):**
      `tests/browser/blending.spec.ts:978` ("RECOVER: a second click blends the chain
      back onto its animation") fails intermittently under load, passes in isolation —
      needs a de-flake pass of its own

- [x] **A-26 DONE 2026-08-07.** `docs/COMPATIBILITY.md` (§90's five tables) +
      `tools/generate-compatibility.mjs` (solver-adapter block generated from live
      capability declarations; `--check` detects drift)
- [x] **A-26 follow-up done 2026-08-07:** `check-compat` root script + ci.yml step wired
      once A-25's agent freed those files; `tools/README.md` documents the three new tools
- [ ] **A-26 follow-up:** extend the generated block to renderer backends once
      `RendererCapabilities` grows past 2 fields
- [x] **A-25 machinery DONE 2026-08-07** (publish itself stays owner-gated): Changesets
      config, `apply-publish-names.mjs` (+tests; rewrites emitted code, not just
      manifests), `release.yml` reusing ci.yml via `workflow_call`, `docs.yml` Pages
      deploy, honest `website/`
- [ ] **A-25 owner decisions before first publish:** (1) the five reserved stubs cannot be
      Changesets-`ignore`d while `four` depends on them — publish them, drop the umbrella
      subpaths, or make them optional peers; (2) add the `NPM_TOKEN` secret; (3) enable
      Pages (Settings → Pages → source "GitHub Actions")
- [ ] **A-25 remainder:** host the 13 guides (needs a static-site-generator decision);
      flagship demo page blocked on A-21. §113a's "documentation and website per §93" exit
      criterion is now recorded as having been met on the documentation half only —
      partially addressed by the Pages deploy
- [x] **Closure-diff review findings — 24 of 25 fixed 2026-08-07** (adversarial pass over
      commits 93cda8d, ab13840, fe8eb6f, c843e2d, b48f053): KinematicController
      serializer + mechanical registry-completeness test, physics teardown O(N·M) →
      one destroyBody + per-body collider ids, keyboard wrap:false trap, Button
      preventDefault-only-when-consumed, pointer re-entrancy, KeyboardInput dispose
      guard, resolution validation, reserveNodeId saturation, loud inertiaTensor
      refusal, fabricated-§61-quote and lifecycle-count doc corrections, plus the
      simplification set (#massAuthored, no-op warn guards, scratch allocation,
      capture-key type pairing)
- [x] **Review findings — ALL 25 closed 2026-08-07:** the render-tier set landed
      (per-renderer `glState` + try/finally, validated `opacity`/`blendMode` accessors,
      restoreGlState coherence, dead-fallback cleanup) and F7 landed
      (`LATEST_REPLAY_FORMAT_VERSION`/`MINIMUM_REPLAY_FORMAT_VERSION` with the old name
      as a deprecated alias; document bytes proven unchanged)

- [x] **A-10 DONE 2026-08-07.** `@four/input` gains `KeyboardInput` over a duck-typed
      `KeySurface`, `SceneKeyEvent` with `preventDefault()`, `dispatchKeyEvent`, and the
      shared three-phase `propagation.ts`. Remaining input sources (wheel, gamepad, XR)
      plus `keypress` and focus/blur-as-input-events are recorded in
      `packages/input/README.md`, not here
- [ ] **A-13 PARTIAL** — keyboard traversal + Enter/Space activation shipped 2026-08-07
      (`collectFocusOrder` / `keyboardFocusTarget` / `installKeyboardTraversal`;
      `tabIndex` live). Still inert: `label`, `role`, `disabled`'s a11y surface — DOM
      mirror, screen-reader updates, high contrast, scalable text all blocked on a DOM
      integration policy decision; reduced motion waits on A-6's `app.reducedMotion`

### Gap-closure wave 1 (2026-08-06) — follow-ups left open

Closed this wave, with tests: `A-7` (`Application.resize`), `A-9` (`PointerInput` dead-pointer
leak + `pointercancel`), `A-15` (unregistered components no longer dropped on save), `A-17`
(restored ids reserve against the counter; duplicate-id refusal), `A-14`/`PH-17` **partially**
(`MOTION_COMPONENT_SERIALIZER`, `registerSceneNodeTypes()`/`registerUISerializers()`), `PH-6`
(§34 `worldConfiguration`). What they left behind:

- [x] **PH-17 remainder — done 2026-08-06.** `@four/physics` exports
      `RIGID_BODY_SERIALIZER` / `COLLIDER_SERIALIZER` (plus `serializeCollisionShape` /
      `deserializeCollisionShape` and the three document types), typed against the
      `ComponentSerializerShape` `@four/motion` declares — imported over the existing
      `physics → motion` edge, so there is one transcription in the repo and no new §3.1
      edge. Registered by the umbrella's new `registerPhysicsSerializers()`, which
      `registerSceneNodeTypes()` calls; a physics scene now saves with no
      `{ unknownComponents: "skip" }`. `tests/integration/helpers/roundtrip-scenarios.ts`
      lost its WP-11.5 duplicates and calls the shipped registration, and
      `scene-roundtrip.test.ts` proves a contact-free save reloads bit-identically through
      `registerSceneNodeTypes()` alone. **One behaviour changed:** §25's friction /
      restitution / density are written **as authored** rather than as the effective values
      the reference wrote, so the fallback chain re-resolves on load instead of pinning
      today's defaults into every document (a `PhysicsMaterial` round-trips by value, not
      by identity — resource-keyed sharing is a §79 resource concern)
- [x] **PH-17 doc follow-up — done by 2026-08-07:** the serializer references in
      `docs/Architecture/API.md` and `docs/guides/digital-twin.md` were updated in an
      earlier pass; the gap-doc banner was fixed by the 2026-08-07 branch merge; API.md's
      adjacent stale "silently unsaved" claim corrected 2026-08-07 (A-15 made it throw)
- [x] **A-9 remainder DONE 2026-08-09:** `pointerType` runs end to end — platform
      `string` in, `PointerDeviceType` (`"mouse" | "pen" | "touch"`) on every
      `ScenePointerEvent`, unknown values reported as absent rather than refused. A
      mouse now keeps its hover across its own release (a `@four/ui` button no longer
      un-highlights when clicked — `tests/integration/pointer-type.test.ts`);
      `pointercancel`, pen, and device-less sources keep the old teardown. Bounded:
      10 000 mouse clicks leave `trackedPointerCount` at 1
- [x] **A-16 remainder — done 2026-08-07:** `Renderable`, `Sprite`, both cameras and
      `DirectionalLight` have §79 node-type pairs (`registerRenderSerializers`, chained
      by `composeSceneNodeTypes`). Geometry/material are **references** resolved through
      the injected `SceneResourceCatalog` seam; §79's manifest (key → URL + content
      hash) remains staged behind A-18 content hashing. Still open under A-16: the §80
      `.four` binary package format and the manifest document itself
- [ ] **A-6 remainder:** `application.ts`'s header note is now a dated post-plan note, but
      `app.input` / `app.assets` / `app.diagnostics` / `app.stats` / `app.physics` and
      `autoResize`/`reducedMotion` are still absent

### Backlog additions (doc-truth sweep, 2026-08-05)

- [ ] The §93/§118–119 examples: five of the six directories still do not exist
      (`docs/AUDIT-120.md` **S-8**, partially closed 2026-08-07 — `first-3d-scene` was
      written): `first-animated-scene`, `first-physics-scene`, `mixed-scene`,
      `flagship/one-scene-everything-moves`, `flagship/motor-digital-twin` are
      `.gitkeep`-only. All three remaining §93 scenes have shipped stand-ins (animation
      inside `first-2d-scene`; physics and mixed 2D/3D by `physics-playground`), so what
      is left is the two §118–119 flagships plus an owner decision to retire the three
      stand-in directories
- [ ] §65 sprite/glyph batching is unshipped and now says so in three places
      (AUDIT-120 sprites row + S-4, the render-graph guide, `benchmarks/README.md`);
      it blocks two §86 benchmark rows outright
- [ ] Extend `tools/check-docs.mjs` as new mechanically-checkable claims appear
      (candidates: package counts, test-suite counts in `tests/README.md`, the
      §120 verdict totals) — each addition must stay decidable by reading files

### Backlog additions (Phase 10, 2026-08-02)

- [x] Debug overlay render wiring — **done 2026-08-07** (R-35 closed:
      `debugDrawStreams`/`applyDebugDrawStreams` + R-19's vertex colors; one draw call,
      demonstrated in `tests/integration/debug-overlay-render.test.ts`)

### Backlog additions (Phase 9, 2026-08-02)

- [ ] §27 field batching (each polymorphic sample() costs ~5.3 ms/100k — a batch API
      is the scoped fix; benchmark attribution in benchmarks/results/)
- [ ] Particle trails (position-history ring buffer + ribbon path), multi-stop ramps,
      GPU compute (WebGPU tier), depth-buffer collision, spatial-hash neighbors

### Backlog additions (Phase 8, 2026-08-02)

- [ ] Fold steering's private interceptTime into prediction's export (dated note in
      steering.ts); spatial-hash neighbors; spherical wander; CCD/FABRIK (skeleton
      model first); path-planning adapters (RFC); robotic joint commands utility
      (MAY declined — see prediction.ts staging note)
- [x] §111 namespace note — **already satisfied by spec revision 1.7** (§111 cites
      `Four.motion.PIDController` via §97a); this entry was the stale artifact

### Backlog additions (Phase 7, 2026-08-02)

- [ ] Rotational root motion (staged 2026-08-02 — quaternion track throws)
- [ ] PoseTarget scale channel (P7-1 MVP cut — needs a decision on what scale blends
      against; solver bodies have no scale)
- [ ] Capability-table note: Rapier derives kinematic velocity itself, so
      inheritVelocityFrom is nearly a no-op there; other solvers may need it

### Backlog additions (Phase 6 exit, 2026-08-02)

- [ ] §28 motor cap: both Rapier adapters supply maxTorque/maxForce as a ForceBased
      gain, not a hard ceiling (documented in the stable API docs); name it in the
      §90/§102 capability tables when a capping adapter (Box2D) arrives

### Backlog additions (Phase 5, 2026-08-01)

- [ ] Replace the transcribed Rapier type subset in `physics-rapier/src/init.ts` once a
      toolchain answer exists for rapier-compat's NodeNext-unresolvable .d.ts
- [ ] §24 remaining shapes (polyline/chain/cylinder/cone/convex hull/trimesh/
      heightfield/compound) — staged out by P5-6, widen in a later packet
- [ ] Document SolverBodyAccess in the §90/§102 compatibility material when adapters
      beyond Rapier arrive (it is required engine surface beyond §37's sketch)

### Chores (Phase 4 exit-verifier notes, 2026-08-01)

- [ ] Coverage thresholds are package-level; consider per-file granularity so a weak file
      can't hide behind a strong package average
- [ ] Unlit materials render with GL_BLEND off (WP-4.7 finding) — alpha animation is
      invisible; schedule blending with §60a color management work

### Backlog additions (Phase 3 exit findings)

- [x] §45 renderer-string ("auto") selection — **done 2026-08-07** (A-8/R-2/PH-19
      closure; the 2026-08-01 instance-injection deferral is retired, not reversed)

## Backlog

### Later milestones (decided 2026-07-29)

- [ ] Deploy the public interactive demo (demo-first principle, `docs/POSITIONING.md`) —
      demo-ready static build confirmed at Phase 3a exit; deployment is the owner's step
      (note: subpath hosting like GitHub Pages needs a `--base` flag at build time)
- [ ] §55 frame regions + §65 sprite batching (evidence: the example labels cost one
      texture per glyph cell — WP-3a.5 header)
- [ ] Before §56 full text shaping: RFC the shaping engine (HarfBuzz-wasm vs native)
- [ ] First publish (§94 0.1): Changesets release workflow + apply the
      `@danielsimonjr/fourjs` publish-name mapping (spec §98, rev 1.6)

### Documentation

- [ ] Optionally regenerate the specification PDF from `docs/SPECIFICATION.md` (the archived
      PDF is formally frozen at the pre-1.0 text and carries the old duplicate numbering)

## Done

- [x] 2026-08-04 — **Lighting MVP shipped** (§120's last unshipped bullet; owner-directed,
      minimal tier): `DirectionalLight` node + `Scene.ambientLight` in @four/scene (§68),
      `LitMaterial` + `kind` discriminants in @four/materials (§57), optional `normals`
      vertex attribute in @four/geometry (box now 24 verts with per-face normals, plane
      +Z; 2D shapes stay unlit), `"lit"` render-item kind + duck-typed `collectSceneLights`
      in @four/render, `LitProgram` (Lambert + ambient) + normal-stream upload in
      @four/render-webgl. Unlit path untouched — every browser spec and pixel golden
      passes; merged tree: 3,077 unit + 174 suite + 38 browser/visual tests, coverage
      ≥95% everywhere, TypeDoc 0 warnings, §86 gate 33.28/150 kB. Wider §68/§69/§59/§60a scope staged
      with dated notes (see backlog and docs/AUDIT-120.md S-5)
- [x] 2026-08-04 — **Zero-findings sweep** (owner-directed): consolidated all 5
      baselined TRUE_DUPLICATE names (SeededRandom → core, JsonValue/cloneJsonValue →
      core with the **proto** strengthening, DEFAULT_GRAVITY_Y → core, ColorRGBA →
      math; includes the Phase 9 "hoist SeededRandom" item), broke both type-only
      import cycles (AuthorityNode structural seam; RigidBodyEventMap declaration
      merging), un-exported physics-rapier's 21 in-file-only transcribed interfaces;
      every docs/Architecture report now 0, duplicate baseline empty, all gates green
- [x] 2026-08-02 — **Phase 11 complete — THE PLAN IS DONE** (§113a): 5 packets, final
      exit GREEN — serialization (byte-identical round trips + the proven §79/§34
      boundary), assets, UI MVP, benchmark harness with committed records, the §120
      audit (42/43 shipped-or-MVP, lighting staged); whole-plan audit clean; final
      totals 2,971 unit + 172 suite + 32 browser tests, coverage ≥95% everywhere
- [x] 2026-08-02 — **Phase 10 complete** (§113): 5 packets, exit GREEN zero defects —
      §34 replay format with canonical serialization, ReplayRecorder/ReplayPlayer over
      duck-typed targets, debug-draw providers with honestly-staged seam gaps, the
      §113 exit proven end-to-end on Rapier (bit-identical replay, snapshot-seek,
      frame stepping, slow motion); 2,766 unit + 159 suite + 32 browser tests
- [x] 2026-08-02 — **Phase 9 complete** (§112): 5 packets — SoA particle core, §27
      fields, one-draw-call instanced rendering, ParticleSystem, 100k benchmark
      (16.5 ms/step recorded honestly on CI hardware with per-field cost attribution),
      phase9 determinism golden, particles-demo (fifth example site); 2,585 unit +
      138 suite + 32 browser tests
- [x] 2026-08-02 — **Phase 8 complete** (§111): 5 packets + 1 doc fix — PID/spring-
      damper/steering/RNG/prediction/IK in @four/motion, all six modules at 100%
      coverage with genuinely independent analytic oracles; PID closes a real Rapier
      hinge loop to exact setpoint; every declined §111 component staged with a dated
      note; 2,359 unit + 131 suite + 27 browser tests
- [x] 2026-08-02 — **Phase 7 complete** (§110): 8 packets + 1 fix, exit GREEN zero
      defects — "blended" authority live with the §19 pipeline inside PhysicsWorld,
      in-place retype + velocity inheritance, root-motion MVP, mode-cycle example;
      both control switches measured below the animation's own per-step motion;
      2,176 unit + 124 suite + 27 browser tests
- [x] 2026-08-02 — **Phase 6 complete** (§109): 7 packets + 2 fixes — §28 joint tier
      shipped honestly against measured Rapier 0.19.3 behavior (breakage via the engine
      seam, refused where solvers can't report reactions; spherical without fake cone
      limits), slider-crank mechanism demo, jointed determinism golden, mechanism
      browser spec; 1,998 unit + 95 suite + 23 browser tests; §109 stability proven
      over 3600 steps with drift ≤1.3e-5 m
- [x] 2026-08-01 — **Phase 5 complete** (§108): 9 packets + 2 fixes, exit GREEN zero
      defects — full physics API over the §37 adapter contract, Rapier 2D+3D on pinned
      -compat@0.19.3 wasm, density-derived mass end-to-end, mixed 2D/3D proven by
      integration tests, the physics-playground demo with browser-pixel evidence, and a
      600-step cross-process determinism golden; 1,827 unit + 60 suite + 19 browser
      tests; physics 100% coverage
- [x] 2026-08-01 — **Phase 4 complete** (§107): 10 packets, exit GREEN zero defects —
      numeric/vector/quaternion/color/transform properties all animatable, proven at
      unit, determinism-golden (cross-process, marker steps pinned), and browser-pixel
      layers; 1,363 unit + 26 suite + 15 browser tests; animation package 100% coverage;
      coverage gate now tooling-enforced repo-wide; example 30.19 kB gzip
- [x] 2026-08-01 — **Phase 3a complete** (§106a): 7 packets, exit GREEN — pointer events,
      picking, dragging, sprites, and text labels proven working together in the mixed
      2D/3D example via real Chromium input + framebuffer assertions; 1,015 unit + 11
      browser tests, coverage 100% on input/text/render/materials (render-webgl 99.42%),
      demo-ready static build at 21.46 kB gzip
- [x] 2026-08-01 — **Phase 3 complete** (§106): 9 packets, browser-verified rendering
      (SwiftShader gate caught a real rAF defect), interpolated draws proven at alpha 0.5,
      example at 14.88 kB gzip, coverage ≥95% everywhere
- [x] 2026-08-01 — **Phase 2 complete** (§105): 7 packets, repo at 545 tests, coverage
      ≥95% every package, demos verified against independently derived closed forms,
      cross-process determinism vs goldens
- [x] 2026-08-01 — **Phase 1 complete** (§104): 14 packets, 405 tests, coverage ≥95% every
      package, deterministic headless stepping proven in-process + fresh-process against
      committed golden digests
- [x] 2026-07-31 — **Phase 0 complete** (§103): all 15 packets landed via Opus workers,
      independent exit verifier GREEN with zero defects — 24-package monorepo installs,
      compiles (cold+warm), tests, lints; docs/example/size/CI gates live
- [x] 2026-07-29 — npm naming decided (owner): publish under `@danielsimonjr/fourjs` /
      `@danielsimonjr/fourjs-<name>` (spec revision 1.6); no org claim or dispute needed
- [x] 2026-07-29 — Stress-test the implementation plan (5 passes: Haiku dry-run,
      executability, spec fidelity, Sonnet orchestration, Opus design; ~85 findings) and
      apply all findings as plan revision 2 + spec revision 1.4 (§98 Application → `four`)
- [x] 2026-07-29 — Write `docs/plans/IMPLEMENTATION_PLAN.md` (Phase 0 deliverable, §103): subagent-
      driven work packets WP-N.M with [H]/[S] model tiers, mechanical Done-checks,
      Phase 0–2 fully decomposed, Phases 3–10 rolling-wave; §98 directory tree verified
      complete (already built 2026-07-28)
- [x] 2026-07-29 — Confirm the §86 payload budget (minimal 2D app ≤ 150 kB gzip): owner
      confirmed; provisional marker removed (spec revision 1.2)
- [x] 2026-07-28 — Disposition the specification review: all 35 items (R-1…R-35) accepted
      and applied as `SPECIFICATION.md` revision 1.1 (lettered sections 6a/6b/7a/7b/60a,
      Appendices A–B; §1–120 numbering unchanged)
- [x] 2026-07-28 — Typeset `SPECIFICATION.md`: 96 fenced code/diagram blocks (with restored
      indentation), Markdown bullet lists, §86 performance table, parts TOC; word-for-word
      equivalence machine-verified
- [x] 2026-07-28 — Build out the directory tree from the spec: per-package `README.md` +
      `src/`/`tests/` for all 24 packages; `examples/` (§93 + flagship §118–119); `tests/`
      categories (§92); READMEs for `benchmarks/`, `tools/`, `website/`
- [x] 2026-07-28 — Move original spec PDF to `docs/archive/`; update all path references
- [x] 2026-07-28 — Correct `SPECIFICATION.md` (E-1/E-2/E-3 resolved: parts I–XIII, sections
      1–120, solver-package list fixed, extraction artifacts repaired); rewrite `ERRATA.md`
      as a correction log with a PDF→Markdown numbering map
- [x] 2026-07-28 — Add `AGENTS.md` (detailed agent orientation)
- [x] 2026-07-28 — Add `CLAUDE.md` (Claude Code guidance)
