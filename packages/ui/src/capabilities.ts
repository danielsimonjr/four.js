/**
 * This package's §81 capability token (RFC 0002).
 *
 * RFC 0002 §2 spells it this way: *each token is exported from the package
 * that owns its registry*. The umbrella re-exports the very same object, so
 * both import paths hand out one identity.
 *
 * **Declaring a token is not reaching the §96 host.** This module names
 * `defineCapability` and nothing else. The `UIControlRegistry` import is
 * type-only, and that is load-bearing: a bundle can carry the token without
 * carrying the registry class. The definition is `@__PURE__`-annotated so
 * a token nothing references leaves the bundle entirely.
 */

import { defineCapability } from "@four/core";

import type { UIControlRegistry } from "./control-registry.js";

/**
 * §81's *"UI controls"*: a named {@link UIControlRegistry} of widget
 * constructors.
 *
 * Not revocable — the registry has no removal, so a plugin that registered
 * a control has no way to take it back. {@link UIControlRegistry.register}
 * of the identical constructor is a no-op; a different constructor under
 * the same name throws.
 */
export const UI_CONTROLS =
  /* @__PURE__ */ defineCapability<UIControlRegistry>("four:ui-controls");
