/**
 * This package's §81 capability token (RFC 0002; declared here since
 * 2026-08-29).
 *
 * RFC 0002 §2 spells it this way: *each token is exported from the package
 * that owns its registry*. The tokens first shipped together in
 * `@four/four`'s `plugins.ts` — a recorded, reversible spelling difference —
 * and moved home once the owning packages were free; the umbrella still
 * re-exports the very same object, so every existing import keeps working and
 * the token's identity (its `name` string) never changed.
 *
 * The `SolverRegistry` import is type-only, and that is load-bearing: a token
 * is `{ name, revocable }`, so a bundle can carry it without carrying the §37
 * registry or any adapter. The definition is `@__PURE__`-annotated so a token
 * nothing references leaves the bundle entirely.
 */

import { defineCapability } from "@four/core";

import type { SolverRegistry } from "./solver-registry.js";

/**
 * §81's *"physics solvers"*: the §37 registry a solver adapter registers into.
 *
 * Not revocable, by RFC 0002 Q3's conservative default (owner decision) —
 * revocation is granted only where a plugin's `uninstall` can provably put
 * the registry back exactly as it found it, and `SIMULATION_SYSTEMS`'
 * idempotent-unregister contract is the one registry that qualifies.
 * Provided only by a standalone `@four/core` plugin host (its name is left
 * unwritten here — the §96 boundary test's textual ban is blunt on purpose)
 * — `Application` never constructs or holds a `SolverRegistry` (§45 takes a
 * constructed `PhysicsWorld`, and naming the registry would put
 * `@four/physics` in every bundle).
 */
export const SOLVER_REGISTRY = /* @__PURE__ */ defineCapability<SolverRegistry>(
  "four:solver-registry",
);
