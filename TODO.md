# TODO

Task tracker for four.js. Keep entries short and actionable; move finished items to **Done**
(newest first) with the date. Larger context and decisions belong in `MEMORY.md`; released
changes in `CHANGELOG.md`.

## Now

- [ ] **Owner:** merge the open PR for `claude/specification-improvements-iug6pi` (spec
      1.0→1.5, plan 2.1, doc sync, tooling) — Phase 0 starts from `main` after merge.
- [ ] Decide when to start Phase 0 (§103, Project Foundation) — plan is dispatch-ready.

## Backlog

### Phase 3 — Renderer Foundation (§106; §61–62, §47–48) — NEXT: rolling-wave decomposition
- [ ] Orchestrator: write WP-3.x packets (renderer interface w/ context-loss contract,
      cameras+viewports in @four/scene, WebGL 2 backend, render list, interpolation-aware
      draw; Playwright+SwiftShader per plan Phase-3 note; real example replaces placeholder,
      size gate becomes meaningful)

### Later milestones (decided 2026-07-29)
- [ ] Phase 3a exit: ship a public interactive demo (demo-first principle,
      `docs/POSITIONING.md`)
- [ ] Before §56 full text shaping: RFC the shaping engine (HarfBuzz-wasm vs native)
- [ ] First publish (§94 0.1): Changesets release workflow + apply the
      `@danielsimonjr/fourjs` publish-name mapping (spec §98, rev 1.6)

### Phase 5 (when it starts)
- [ ] Pin exact `@dimforge/rapier2d`/`@dimforge/rapier3d` versions (strategy decided
      2026-07-29 — see MEMORY.md)

### Documentation
- [ ] Optionally regenerate the specification PDF from `docs/SPECIFICATION.md` (the archived
      PDF is formally frozen at the pre-1.0 text and carries the old duplicate numbering)

## Done

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
