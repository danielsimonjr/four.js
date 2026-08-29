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
 * The `SystemRegistry` import is type-only, and that is load-bearing: a token
 * is `{ name, revocable }`, so a bundle can carry it without carrying the §39
 * scheduler. The definition is `@__PURE__`-annotated so a token nothing
 * references leaves the bundle entirely.
 */

import { defineCapability } from "@four/core";

import type { SystemRegistry } from "./systems.js";

/**
 * §81's *"animation systems"* and, with the §84 statistics record, its
 * *"diagnostics"* point: the §39 ordered set of simulation systems.
 *
 * **The one revocable capability in the MVP**, and the only one whose registry
 * really supports removal: `SystemRegistry.register` returns an idempotent
 * unregister and `unregister(system)` exists, so a plugin's own `uninstall` can
 * put the registry back exactly as it found it. Every other §81 token keeps
 * RFC 0002's conservative default (owner decision, Q3), which means a plugin
 * that touches one of them cannot be uninstalled at all.
 *
 * ```ts
 * const plugin = {
 *   name: "@vendor/wind",
 *   version: "1.0.0",
 *   install(context) {
 *     context.require(SIMULATION_SYSTEMS).register(new WindSystem());
 *   },
 * };
 * const app = new Application({ plugins: [plugin] });
 * await app.initialize();
 * ```
 *
 * (The plugin and context types live in `@four/core`; naming them here would
 * trip the §96 boundary test's textual ban, which is blunt on purpose.)
 *
 * Provided by `Application` for every application that configures plugins: the
 * registry is `app.systems`, which the application owns outright.
 */
export const SIMULATION_SYSTEMS =
  /* @__PURE__ */ defineCapability<SystemRegistry>("four:simulation-systems", {
    revocable: true,
  });
