/**
 * `SOLVER_REGISTRY` (§81, RFC 0002 §2): declared here since 2026-08-29, when
 * the tokens moved home from `four/plugins.ts`. The umbrella's
 * `plugins.test.ts` pins cross-package identity; this file pins what the
 * owner itself promises — the name (a token's identity), the Q3
 * non-revocable disposition, and that the token really keys this package's
 * §37 registry for the compiler.
 */

import { bindCapability } from "@four/core";
import { describe, expect, it } from "vitest";

import { SOLVER_REGISTRY, SolverRegistry } from "../src/index.js";

describe("SOLVER_REGISTRY", () => {
  it("is the four:solver-registry token, not revocable (RFC 0002 Q3)", () => {
    expect(SOLVER_REGISTRY).toEqual({
      name: "four:solver-registry",
      revocable: false,
    });
  });

  it("keys a SolverRegistry for the compiler", () => {
    const registry = new SolverRegistry();
    const binding = bindCapability(SOLVER_REGISTRY, registry);
    expect(binding.capability).toBe(SOLVER_REGISTRY);
    expect(binding.value).toBe(registry);
  });
});
