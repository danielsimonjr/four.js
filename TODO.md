# TODO

Task tracker for four.js. Keep entries short and actionable; move finished items to **Done**
(newest first) with the date. Larger context and decisions belong in `MEMORY.md`; released
changes in `CHANGELOG.md`.

## Now

- [ ] **The implementation plan is COMPLETE (2026-08-02).** All 13 phase sections
      (§103–§113a) built, tested, verified. What remains is post-plan work, in the
      verifier's priority order:

### Post-plan backlog (final exit verifier, 2026-08-02)
- [ ] Package README sweep — all 24 still say "scaffold only" (shipping-false text)
- [ ] UI browser proof — @four/ui has node-level §72 coverage only; no example app
      imports it (the one WP-11.5 packet-intent shortfall)
- [ ] Lighting (§120's single unshipped bullet — never scheduled to a phase; needs a
      light type, lit shading path, AND normals in the vertex layouts; owner tier
      decision first)
- [ ] De-flake tests/browser/blending.spec.ts RECOVER (1 hard fail in 3 full runs;
      retries: 0; Phase 7 wall-clock thresholds under SwiftShader)
- [ ] §93 quick-start (root README is 27 lines) + the thirteen prose guides
- [ ] First publish (§94 0.1): Changesets release workflow + the
      @danielsimonjr/fourjs publish-name mapping — owner step

### Backlog additions (tools integration, 2026-08-04)
- [ ] Consolidate the 5 baselined TRUE_DUPLICATE names (docs/Architecture/
      duplicate-baseline.json): cloneJsonValue + JsonValue (diagnostics/serialization),
      DEFAULT_GRAVITY_Y (particles/physics), SeededRandom (= the existing Phase 9
      hoist-to-core item), ColorRGBA (animation/materials); shrink the baseline via
      gen-duplicate-baseline.mjs as each lands

### Backlog additions (Phase 10, 2026-08-02)
- [ ] Package README sweep — all 24 still say "scaffold only" despite implementation
- [ ] Debug overlay render wiring undemonstrated (lines→GL.LINES path exists;
      vertex-color attribute needed for per-segment color) — §118 flagship pickup
- [ ] Exercise the remaining 4 debug providers against the real Rapier rig (one line)
- [ ] §34 world-configuration mismatch not refused on restore (name/version only)
- [ ] getBodyCenterOfMass seam member (Rapier localCom/worldCom verified available)

### Backlog additions (Phase 9, 2026-08-02)
- [ ] §27 field batching (each polymorphic sample() costs ~5.3 ms/100k — a batch API
      is the scoped fix; benchmark attribution in benchmarks/results/)
- [ ] Particle trails (position-history ring buffer + ribbon path), multi-stop ramps,
      GPU compute (WebGPU tier), depth-buffer collision, spatial-hash neighbors
- [ ] .size-limit.json entry for examples/particles-demo (18.9 kB, suggested WP-9.4)

### Backlog additions (Phase 8, 2026-08-02)
- [ ] Fold steering's private interceptTime into prediction's export (dated note in
      steering.ts); spatial-hash neighbors; spherical wander; CCD/FABRIK (skeleton
      model first); path-planning adapters (RFC); robotic joint commands utility
      (MAY declined — see prediction.ts staging note)
- [ ] §111 sketch namespace: spec writes Four.PIDController; real path is
      Four.motion.PIDController (pre-existing umbrella convention — spec-revisit note)

### Backlog additions (Phase 7, 2026-08-02)
- [ ] Rotational root motion (staged 2026-08-02 — quaternion track throws)
- [ ] PoseTarget scale channel (P7-1 MVP cut — needs a decision on what scale blends
      against; solver bodies have no scale)
- [ ] Capability-table note: Rapier derives kinematic velocity itself, so
      inheritVelocityFrom is nearly a no-op there; other solvers may need it

### Backlog additions (Phase 6 exit, 2026-08-02)
- [ ] §28 solver-iterations constraint feature is not exposed anywhere — Rapier offers
      world-level `IntegrationParameters.numSolverIterations`; a world option is
      plausible (recorded gap, not per-joint)
- [ ] §28 motor cap: both Rapier adapters supply maxTorque/maxForce as a ForceBased
      gain, not a hard ceiling (documented in the stable API docs); name it in the
      §90/§102 capability tables when a capping adapter (Box2D) arrives

### Backlog additions (Phase 5, 2026-08-01)
- [ ] Replace the transcribed Rapier type subset in `physics-rapier/src/init.ts` once a
      toolchain answer exists for rapier-compat's NodeNext-unresolvable .d.ts
- [ ] §24 remaining shapes (polyline/chain/cylinder/cone/convex hull/trimesh/
      heightfield/compound) — staged out by P5-6, widen in a later packet
- [ ] §31 speculative-CCD prediction distance is a pinned constant (1.0) — needs a
      descriptor field
- [ ] Document SolverBodyAccess in the §90/§102 compatibility material when adapters
      beyond Rapier arrive (it is required engine surface beyond §37's sketch)

### Chores (Phase 4 exit-verifier notes, 2026-08-01)
- [ ] Typedoc link warnings cleanup (34 total, 8 new from animation: ./clip.js#…,
      SPRING_NORMALIZATION, PRIORITY_ANIMATION_TARGETS) — cosmetic, batch with a tooling
      packet
- [ ] Coverage thresholds are package-level; consider per-file granularity so a weak file
      can't hide behind a strong package average
- [ ] Unlit materials render with GL_BLEND off (WP-4.7 finding) — alpha animation is
      invisible; schedule blending with §60a color management work

### Backlog additions (Phase 3 exit findings)
- [ ] §92 integration/visual test directories still empty — schedule with Phase 11
- [ ] §45 renderer-string ("auto") selection via §62 registry packet (instance-injection
      deferral recorded in MEMORY 2026-08-01)

## Backlog

### Later milestones (decided 2026-07-29)
- [ ] Ergonomics decision before the §97 example: `Node.position/rotation/scale` aliases
      onto `transform.*` (flagged by the WP-3.1 worker — spec idiom `camera.position.set`)
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

- [x] 2026-08-04 — **Zero-findings sweep** (owner-directed): consolidated all 5
      baselined TRUE_DUPLICATE names (SeededRandom → core, JsonValue/cloneJsonValue →
      core with the __proto__ strengthening, DEFAULT_GRAVITY_Y → core, ColorRGBA →
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
