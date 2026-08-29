/**
 * This package's §81 capability tokens (RFC 0002; declared here since
 * 2026-08-29).
 *
 * RFC 0002 §2 spells it this way: *each token is exported from the package
 * that owns its registry*. The tokens first shipped together in
 * `@four/four`'s `plugins.ts` — a recorded, reversible spelling difference —
 * and moved home once the owning packages were free; the umbrella still
 * re-exports the very same objects, so every existing import keeps working
 * and a token's identity (its `name` string) never changed.
 *
 * **Declaring a token is not reaching the §96 plugin host.** This module
 * names `defineCapability` and nothing else: a token is `{ name, revocable }`
 * — a key a *host* may choose to provide a value for — and holding or
 * declaring one confers no ability to install a plugin or to acquire a
 * capability. The host machinery — `@four/core`'s installer, host class, and
 * install-time context, none of which this comment may even name — remains
 * banned from this package (`tests/integration/plugin-boundary.test.ts`):
 * nothing a document names can become a plugin, exactly as before.
 *
 * The registry imports are type-only, and that is load-bearing: a bundle can
 * carry a token an application passes around without carrying the §79
 * serializer machinery. Each definition is `@__PURE__`-annotated so a token
 * nothing references leaves the bundle entirely.
 */

import { defineCapability } from "@four/core";

import type { SceneMigrationRegistry } from "./migration.js";
import type { ComponentSerializerRegistry } from "./serializer.js";

/**
 * §81's *"serialization types"*, first half: the §79 component-serializer
 * registry. This is the extension point `serializer.ts` was already written
 * against — *"components serialize under registered type names; plugins
 * register theirs (§81)"* — and the one that made §79 a promise the
 * repository could not keep until RFC 0002 landed.
 *
 * **Emphatically not revocable.** `ComponentSerializerRegistry.register` throws
 * on a duplicate deliberately, because a silent overwrite would make the shape
 * of a document depend on module evaluation order; adding removal would re-open
 * exactly that hazard, in the form of a document written by one registry state
 * and read by another.
 */
export const COMPONENT_SERIALIZERS =
  /* @__PURE__ */ defineCapability<ComponentSerializerRegistry>(
    "four:component-serializers",
  );

/**
 * §81's *"serialization types"*, second half: the §80 upgrade chain. Not
 * revocable, for {@link COMPONENT_SERIALIZERS}' reason — §80 calls the upgrade
 * path deterministic, and a removable step is not.
 */
export const SCENE_MIGRATIONS =
  /* @__PURE__ */ defineCapability<SceneMigrationRegistry>(
    "four:scene-migrations",
  );
