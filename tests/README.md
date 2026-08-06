# Cross-package test suites

This file described §92's _taxonomy_ — the categories the specification asks for — until
2026-08-05, and read as if each directory carried all of them. It now describes what is
**committed here**, with §92's uncovered categories listed as such. Unit tests are
colocated in each package (`packages/<name>/tests/`); performance measurements live in
[`benchmarks/`](../benchmarks/) and are recorded, never gated.

| directory                      | runner                                   | what is committed                                   |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------- |
| [`determinism/`](determinism/) | `pnpm test:suites`                       | 8 suites + 8 committed goldens                      |
| [`integration/`](integration/) | `pnpm test:suites`                       | 6 scenario suites + 1 example-build coverage suite  |
| [`browser/`](browser/)         | `pnpm test:browser` (project `chromium`) | 9 Playwright specs over the six built example sites |
| [`visual/`](visual/)           | `pnpm test:browser` (project `visual`)   | 1 spec, 2 committed PNG goldens                     |

## `determinism/` — §33, §92

Eight suites, one per phase that produced a determinism obligation, each pinned to a
committed checksum golden in `determinism/golden/phase<N>.json`:

| suite                              | golden    | what it pins                           |
| ---------------------------------- | --------- | -------------------------------------- |
| `phase1-headless-stepping.test.ts` | `phase1`  | fixed-step scheduling with no renderer |
| `phase2-motion.test.ts`            | `phase2`  | §11–§14 motion integration             |
| `phase4-animation.test.ts`         | `phase4`  | §15–§17 tweens, timelines, mixing      |
| `phase5-physics.test.ts`           | `phase5`  | the Rapier adapter's stepping          |
| `phase6-joints.test.ts`            | `phase6`  | §28 joints and motors                  |
| `phase7-blending.test.ts`          | `phase7`  | §19 animation-physics blending         |
| `phase9-particles.test.ts`         | `phase9`  | §36 seeded particle simulation         |
| `phase10-replay.test.ts`           | `phase10` | §34 snapshot/replay stability          |

The tier is §33's `same-runtime`, not `cross-platform`: a suite replays its scenario more
than once — in-process, and in a freshly spawned `node` process with no test environment —
and compares every run against the committed hash. Cross-platform determinism is not tested
and is not claimed.

## `integration/` — §92

Six scenario suites plus one repository-hygiene suite. Scenario builders shared between
them live in `integration/helpers/`.

| suite                             | what it crosses                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `physics-rapier.test.ts`          | `@four/physics` ↔ the Rapier adapter, both dimensions                                                                            |
| `physics-joints.test.ts`          | joints and motors across scene + physics                                                                                         |
| `physics-blending.test.ts`        | §19 animation → kinematic → physics → interpolated render                                                                        |
| `physics-replay.test.ts`          | §34 snapshot, restore and replay across packages                                                                                 |
| `motion-advanced.test.ts`         | §13–§14 trajectories and path following                                                                                          |
| `scene-roundtrip.test.ts`         | §79 serialization round-trips of a populated scene                                                                               |
| `examples-build-coverage.test.ts` | repository hygiene, not engine behaviour: every example `playwright.config.ts` previews must be one `pnpm examples:build` builds |

## `browser/` — §92's browser tier

Nine Playwright specs, run by the `chromium` project against the **built** example sites
(`pnpm examples:build` first). See `playwright.config.ts` for the site/port/spec map. The
assertions are thresholds — canvas is not blank, frame pacing is smooth, pointer and
keyboard reach the scene — because SwiftShader does not rasterise like a GPU.

## `visual/` — §92's visual-regression tier, seeded 2026-08-04

One spec (`ui-demo.spec.ts`) with two committed PNG goldens under
`ui-demo.spec.ts-snapshots/`. It runs in its own Playwright project (`visual`) so that the
comparison is SwiftShader-to-SwiftShader, which is what makes a pixel match legitimate
here; the `chromium` project's no-golden-images doctrine does not apply to it. Refresh with
`npx playwright test --project visual --update-snapshots` after reviewing the diff.

Only pages that are **static at rest** can join this suite. Animated example sites cannot,
which is why exactly one spec lives here.

## Not yet covered, by §92 category

Dated 2026-08-05. Each line is a statement of absence, not a plan.

- **Visual regression breadth (§92).** §92 names fills/strokes, joins/caps, transparency,
  materials/lighting, text layout, clipping, mixed 2D/3D ordering and debug overlays. One
  static UI page is covered; none of those eight topics has a golden. Several are blocked
  upstream — §50–§52 strokes/joins/caps are staged (`docs/AUDIT-120.md` S-4) and the debug
  overlay has no render wiring (S-3) — and the animated pages cannot produce a stable
  golden without a deterministic frame-stepping hook.
- **Per-backend perceptual baselines (§92).** Meaningless with one shipped backend; waits
  on WebGPU/Canvas/SVG.
- **Cross-platform determinism (§33–§34).** Only `same-runtime` is exercised; there is no
  second-runtime or second-architecture comparison, and no CI matrix that would produce
  one.
- **Cross-browser coverage.** Chromium only. No Firefox or WebKit project exists.
- **Accessibility (§75).** The UI focus/keyboard path is exercised by `browser/ui.spec.ts`,
  but there is no axe/ARIA audit and no screen-reader assertion.
- **Asset-loading integration (§76–§78).** `@four/assets` has unit tests; no root suite
  crosses assets with materials or geometry, and glTF is staged entirely
  (`docs/AUDIT-120.md` S-7).
- **Fuzz, soak and stress.** No long-running stability suite and no randomised-input
  fuzzing at any layer.
- **Performance as a gate.** Deliberate, not a gap: `benchmarks/` records numbers and
  nothing in CI asserts on a timing. See `benchmarks/README.md`.
