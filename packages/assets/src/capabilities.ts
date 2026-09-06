/**
 * This package's §81 capability token (RFC 0002).
 *
 * RFC 0002 §2 spells it this way: *each token is exported from the package
 * that owns its registry*. The umbrella re-exports the very same object, so
 * `import { ASSET_LOADERS } from "four"` and
 * `import { ASSET_LOADERS } from "@four/assets"` compare `===`.
 *
 * **Declaring a token is not reaching the §96 host.** This module names
 * `defineCapability` and nothing else: a token is `{ name, revocable }` — a
 * key a host may choose to provide a value for. The `AssetLoaderRegistry`
 * import is type-only, and that is load-bearing: a bundle can carry the
 * token without carrying the registry class. The definition is
 * `@__PURE__`-annotated so a token nothing references leaves the bundle
 * entirely.
 */

import { defineCapability } from "@four/core";

import type { AssetLoaderRegistry } from "./loader-registry.js";

/**
 * §81's *"asset formats"*: a named {@link AssetLoaderRegistry} plugins
 * register loaders into.
 *
 * Not revocable — the registry has no removal, so a plugin that registered
 * a loader has no way to take it back. {@link AssetLoaderRegistry.register}
 * of the identical loader is a no-op; a different loader under the same
 * name throws.
 */
export const ASSET_LOADERS =
  /* @__PURE__ */ defineCapability<AssetLoaderRegistry>("four:asset-loaders");
