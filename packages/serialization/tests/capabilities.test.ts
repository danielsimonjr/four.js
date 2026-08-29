/**
 * `COMPONENT_SERIALIZERS` and `SCENE_MIGRATIONS` (§81, RFC 0002 §2): declared
 * here since 2026-08-29, when the tokens moved home from `four/plugins.ts`.
 * The umbrella's `plugins.test.ts` pins cross-package identity; this file
 * pins what the owner itself promises — the names (a token's identity), the
 * Q3 non-revocable dispositions, and that each token really keys this
 * package's registry for the compiler.
 *
 * The §96 boundary is untouched by the declaration: `capabilities.ts` names
 * `defineCapability` and no host machinery, and
 * `tests/integration/plugin-boundary.test.ts` still bans `PluginHost`,
 * `installPlugins`, and `PluginContext` from this package entirely.
 */

import { bindCapability } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  COMPONENT_SERIALIZERS,
  ComponentSerializerRegistry,
  SCENE_MIGRATIONS,
  SceneMigrationRegistry,
} from "../src/index.js";

describe("serialization capability tokens", () => {
  it("are the four:component-serializers and four:scene-migrations tokens, not revocable (RFC 0002 Q3)", () => {
    expect(COMPONENT_SERIALIZERS).toEqual({
      name: "four:component-serializers",
      revocable: false,
    });
    expect(SCENE_MIGRATIONS).toEqual({
      name: "four:scene-migrations",
      revocable: false,
    });
  });

  it("key this package's registries for the compiler", () => {
    const serializers = new ComponentSerializerRegistry();
    const migrations = new SceneMigrationRegistry();
    expect(bindCapability(COMPONENT_SERIALIZERS, serializers).value).toBe(
      serializers,
    );
    expect(bindCapability(SCENE_MIGRATIONS, migrations).value).toBe(migrations);
  });
});
