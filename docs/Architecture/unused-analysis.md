# Unused Files and Exports Analysis

**Generated**: 2026-08-07

## Summary

- **Potentially unused files**: 0
- **Dormant files** (runtime code on disk, unreachable from any entry/build root): 0
  - **Orphaned (reachable from nothing — delete/wire candidates)**: 0
  - **Test-only (exercised by a test, ships nothing)**: 0
- **Potentially unused exports**: 0
  - **Unreferenced anywhere (deletion candidates)**: 0
  - **Referenced in-module (type contracts / helpers backing live exports)**: 0

## Dormant Files — Orphaned (delete/wire candidates)

Runtime source files reachable from NO root and NO test. Each is either dead code
to delete, or a root the tool cannot see (a new build/worker entry, a
`new URL()`-loaded script, or a side-effect-only module) — in which case wire it
or seed it. Verify before deleting.

_None._

## Dormant Files — Test-only (ships nothing, but exercised)

Not reachable from any package entry point, but imported by a test — deliberately
kept, standalone-tested code (e.g. legacy signal kernels) or a helper a test drives
directly. Not dead; not shipped. No action needed.

_None._

## Potentially Unused Files

These files are not imported by any other file in the codebase:


## Unreferenced Anywhere (deletion candidates)

Not imported by any other file AND not referenced within their own module — the true dead-code candidates. Verify each isn't consumed by a mechanism the
parser can't see (dynamic access, docs examples, published-API contract) before deleting.


## Referenced In-Module (type contracts / helpers backing live exports)

Not imported cross-file, but referenced within their own module — they type or
support exports that ARE used, so they cannot be deleted in isolation. Mostly
interfaces typing live guards and per-package API completeness, not rot.

