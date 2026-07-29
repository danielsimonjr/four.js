# Tools

Repository tooling (build scripts, code generation, release/CI helpers) supporting the
toolchain baseline of §91: pnpm workspace, Turborepo, Vitest, Playwright, ESLint,
Prettier, TypeDoc, Vite, Changesets (choices recorded in `MEMORY.md`, 2026-07-29).

## Available now

- `check-spec.mjs` — mechanical consistency checks for `docs/SPECIFICATION.md`: section
  sequence (1–120 + the frozen lettered insertions), duplicate detection, code-fence
  balance, TOC/body agreement, §-reference validity, and banned pre-revision terms
  (`MotionAuthority`, `syncToScene`, positive-Y 2D gravity, …). Run after any spec edit:

  ```sh
  node tools/check-spec.mjs
  ```

  Intended to become the docs job of the Phase 0 CI workflow (§103).

Everything else is scaffold only — no implementation yet.
