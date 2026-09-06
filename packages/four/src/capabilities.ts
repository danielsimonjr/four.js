/**
 * The umbrella's own §81 capability token (RFC 0002).
 *
 * Editor tools have no package in the §98 tree, so this token is declared
 * here — the host side — rather than in a workspace package that does not
 * exist. `plugins.ts` re-exports the very same object.
 *
 * The `EditorToolRegistry` import is type-only, and that is load-bearing:
 * a token is `{ name, revocable }`, so a bundle can carry it without
 * carrying the registry class. The definition is `@__PURE__`-annotated so
 * a token nothing references leaves the bundle entirely.
 */

import { defineCapability } from "@four/core";

import type { EditorToolRegistry } from "./editor-tools.js";

/**
 * §81's *"editor tools"*: a named {@link EditorToolRegistry} of tool
 * factories.
 *
 * **Host-side.** four.js ships no editor; a host that wants a tool palette
 * constructs the registry and provides this token. `Application` does not
 * hold one — see `editor-tools.ts`.
 *
 * Not revocable — the registry has no removal.
 */
export const EDITOR_TOOLS =
  /* @__PURE__ */ defineCapability<EditorToolRegistry>("four:editor-tools");
