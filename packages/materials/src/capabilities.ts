/**
 * This package's §81 capability token (RFC 0002).
 *
 * RFC 0002 §2 spells it this way: *each token is exported from the package
 * that owns its registry*. The umbrella re-exports the very same object, so
 * both import paths hand out one identity.
 *
 * **Declaring a token is not reaching the §96 host.** This module names
 * `defineCapability` and nothing else. The `ShaderOperatorRegistry` import
 * is type-only, and that is load-bearing: a bundle can carry the token
 * without carrying the registry class. The definition is
 * `@__PURE__`-annotated so a token nothing references leaves the bundle
 * entirely.
 */

import { defineCapability } from "@four/core";

import type { ShaderOperatorRegistry } from "./shader-operators.js";

/**
 * §81's *"materials and shader nodes"*: a named
 * {@link ShaderOperatorRegistry} of operator factories.
 *
 * Not revocable — the registry has no removal. The shader-graph IR stays a
 * closed union; this token hands over a place to register *named factories
 * that produce closed nodes*, not a way to widen the union (RFC 0001
 * alternative E's named-hook half).
 */
export const SHADER_OPERATORS =
  /* @__PURE__ */ defineCapability<ShaderOperatorRegistry>(
    "four:shader-operators",
  );
