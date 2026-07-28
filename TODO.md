# TODO

Task tracker for four.js. Keep entries short and actionable; move finished items to **Done**
(newest first) with the date. Larger context and decisions belong in `MEMORY.md`; released
changes in `CHANGELOG.md`.

## Now

- [ ] Decide when to start Phase 0 (§103, Project Foundation) — see backlog below.

## Backlog

### Phase 0 — Project Foundation (§103)
- [ ] Root `package.json` and `pnpm-workspace.yaml`
- [ ] `tsconfig.base.json` (strict, ESM) and `eslint.config.js`
- [ ] Task runner choice: Turborepo or Nx (§91 allows either — needs a decision)
- [ ] `.github/workflows/ci.yml`
- [ ] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
- [ ] `IMPLEMENTATION_PLAN.md`, `ROADMAP.md`
- [ ] Per-package `package.json` + build wiring for all 24 `@four/*` packages
- [ ] Exit criteria: monorepo installs, all packages compile, tests run, docs build,
      example application starts

### Documentation
- [ ] Optionally regenerate the specification PDF from the corrected `docs/SPECIFICATION.md`
      (the archived PDF still carries the old duplicate numbering)
- [ ] Wrap code snippets in `docs/SPECIFICATION.md` in fenced code blocks (readability;
      content itself is already corrected)

## Done

- [x] 2026-07-28 — Move original spec PDF to `docs/archive/`; update all path references
- [x] 2026-07-28 — Correct `SPECIFICATION.md` (E-1/E-2/E-3 resolved: parts I–XIII, sections
      1–120, solver-package list fixed, extraction artifacts repaired); rewrite `ERRATA.md`
      as a correction log with a PDF→Markdown numbering map
- [x] 2026-07-28 — Add `AGENTS.md` (detailed agent orientation)
- [x] 2026-07-28 — Add `CLAUDE.md` (Claude Code guidance)
