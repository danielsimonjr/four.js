# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Once packages
are published, releases will follow [Semantic Versioning](https://semver.org/) per §90 of the
specification; until then, entries are grouped by date under **Unreleased**.

## [Unreleased]

### 2026-07-28

#### Added
- `docs/SPEC-REVIEW.md` — technical review of `SPECIFICATION.md` proposing improvements
  R-1…R-35 (contradictions, underspecified designs, missing topics, structure), with a
  suggested disposition order keyed to the implementation phases. Proposals only; the
  specification itself is unchanged.
- `AGENTS.md` — detailed orientation for AI agents and new contributors (repo state,
  architecture reference, package map, implementation phases, guardrails).
- `CLAUDE.md` — guidance for Claude Code sessions.
- `TODO.md`, `CHANGELOG.md`, `MEMORY.md` — root tracking files.
- `docs/archive/` — archive location for the original specification PDF.
- `.claude/settings.json` — registers the `local-marketplace` plugin marketplace
  (`danielsimonjr/skills` on GitHub) and enables three portable skill plugins as project
  defaults: `rfl`, `dev-workflow`, `honest-claude`.
- Directory tree built out from the specification: every `packages/*` package gained a
  `README.md` (responsibilities + spec references) plus `src/` and `tests/` placeholders;
  `examples/` gained the §93 quick-start examples and the two flagship demos (§118–119);
  `tests/` gained `integration/`, `visual/`, and `determinism/` per the §92 taxonomy;
  `benchmarks/`, `tools/`, and `website/` gained purpose READMEs.

#### Changed
- `docs/SPECIFICATION.md` revised to **revision 1.1**, applying all 35 review items from
  `docs/SPEC-REVIEW.md` (owner-directed): contradictions resolved (force API §23/§26,
  authority enums §19/§42 merged into `TransformAuthority` + `"blended"`, 2D gravity sign,
  ms→s time units, `TimeState` completed, accumulator substep clamp); new lettered sections
  6a (Component Model), 6b (Eventing), 7a (Coordinate and Unit Conventions), 7b (Math Type
  Conventions), 60a (Color Management); solver adapter contract extended (destroy/query/
  `drainEvents`, `PhysicsCapabilities` defined); scope settled (audio and networking added
  to §5 non-goals); context-loss handling, precision-at-scale, COOP/COEP, per-backend visual
  baselines, package responsibilities for all 24 packages, Part VII group headings, RFC 2119
  conformance note, Amendments table, and Appendices A (Normative Defaults) and B (Glossary).
  §1–120 numbering unchanged.
- `docs/SPEC-REVIEW.md` header updated with the disposition (all items applied in 1.1;
  §86 payload budget provisional).
- `docs/SPECIFICATION.md` typeset for readability: all 96 code snippets and ASCII diagrams
  fenced (`ts`/`json`/`text`) with indentation restored, `•` bullets converted to Markdown
  lists, the §86 performance targets converted to a real table, and a parts table of
  contents added. Word-for-word equivalence with the pre-typeset text was machine-verified
  (7,257 words preserved exactly); no wording changed.
- `docs/SPECIFICATION.md` rewritten as the **corrected working rendering** of the
  specification (by owner decision): the duplicated `Part VII` became `Part VIII` with later
  parts shifted to IX–XIII (E-1); the twice-assigned section range 45–67 renumbered +53 to
  §98–120, giving one sequence 1–120 (E-2); §102 (Solver Packages) aligned with the monorepo
  tree — `physics-rapier` and `physics-box2d` only (E-3); extraction artifacts repaired
  (kerning splits, ligature, mid-word line-break hyphens); Markdown headings added.
- `docs/ERRATA.md` rewritten as a correction log with a PDF→Markdown numbering map; all
  three defects (E-1, E-2, E-3) marked resolved.
- `README.md` updated to present `SPECIFICATION.md` as the working reference and the PDF as
  the archived original.
- `docs/four-js-specification.pdf` moved unchanged to `docs/archive/`.

### Earlier
- Initial commit: directory scaffold (24 empty `@four/*` package directories, empty
  `examples/`, `benchmarks/`, `tests/`, `tools/`, `website/`), specification PDF and
  extracted Markdown, `ERRATA.md`, `README.md`, MIT `LICENSE`.
