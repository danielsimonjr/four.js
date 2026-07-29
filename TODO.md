# TODO

Task tracker for four.js. Keep entries short and actionable; move finished items to **Done**
(newest first) with the date. Larger context and decisions belong in `MEMORY.md`; released
changes in `CHANGELOG.md`.

## Now

- [ ] Decide when to start Phase 0 (§103, Project Foundation) — see backlog below.

## Backlog

### Phase 0 — Project Foundation (§103) — now tracked as work packets in `IMPLEMENTATION_PLAN.md`
- [ ] WP-0.1–0.4 — root manifests, `tsconfig.base.json`, ESLint/Prettier, Turborepo
- [ ] WP-0.5 — per-package `package.json` + build wiring, fan-out ×24
- [ ] WP-0.6–0.7 — size-limit budget gate (§86) and `.github/workflows/ci.yml`
      (incl. `tools/check-spec.mjs` docs job)
- [ ] WP-0.8–0.9 — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `ROADMAP.md`
- [ ] WP-0.10 — exit verification: monorepo installs, all packages compile, tests run,
      docs build, example application starts

### Phase 5 (when it starts)
- [ ] Pin exact `@dimforge/rapier2d`/`@dimforge/rapier3d` versions (strategy decided
      2026-07-29 — see MEMORY.md)

### Documentation
- [ ] Optionally regenerate the specification PDF from `docs/SPECIFICATION.md` (the archived
      PDF is formally frozen at the pre-1.0 text and carries the old duplicate numbering)

## Done

- [x] 2026-07-29 — Write `IMPLEMENTATION_PLAN.md` (Phase 0 deliverable, §103): subagent-
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
