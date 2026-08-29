/**
 * `SIMULATION_SYSTEMS` (§81, RFC 0002 §2): declared here since 2026-08-29,
 * when the tokens moved home from `four/plugins.ts`. The umbrella's
 * `plugins.test.ts` pins cross-package identity; this file pins what the
 * owner itself promises — the name (a token's identity), the one revocable
 * disposition in the MVP, and that the token really keys this package's §39
 * registry for the compiler.
 */

import { bindCapability } from "@four/core";
import { describe, expect, it } from "vitest";

import { SIMULATION_SYSTEMS, SystemRegistry } from "../src/index.js";

describe("SIMULATION_SYSTEMS", () => {
  it("is the four:simulation-systems token, revocable (RFC 0002 Q3)", () => {
    expect(SIMULATION_SYSTEMS).toEqual({
      name: "four:simulation-systems",
      revocable: true,
    });
  });

  it("keys a SystemRegistry for the compiler", () => {
    // `bindCapability` is the type-safe pairing; a registry of the wrong type
    // would not compile. Runtime carries only `{ capability, value }`.
    const registry = new SystemRegistry();
    const binding = bindCapability(SIMULATION_SYSTEMS, registry);
    expect(binding.capability).toBe(SIMULATION_SYSTEMS);
    expect(binding.value).toBe(registry);
  });
});
