/**
 * §83's stale physics handle development warning (A-4/A-5).
 *
 * Solver adapters refuse destroyed or foreign handles with
 * `INVALID_APPLICATION_STATE`; this helper pairs that refusal with a
 * one-time §83 warning. The warn is unconditional `console.warn` — this
 * package is in the §33 simulation envelope and must not import `DEV` /
 * `devWarnOnce`. The throw is the behaviour; the message is diagnostics.
 */

import { FourError, type FourErrorCode } from "@four/core";

const warnedStaleHandles = new Set<string>();

/** Test hook — forgets keys so a second suite run still sees the first warn. */
export function resetStaleHandleWarnings(): void {
  warnedStaleHandles.clear();
}

/** Which §37 handle kind was stale. */
export type StalePhysicsHandleKind = "body" | "collider" | "joint";

/**
 * Emits a one-time §83 warning and throws — the adapter's stale-handle path.
 */
export function rejectStalePhysicsHandle(
  kind: StalePhysicsHandleKind,
  key: string,
  message: string,
  code: FourErrorCode = "INVALID_APPLICATION_STATE",
  context?: Record<string, unknown>,
): never {
  const warnKey = `${kind}:${key}`;
  if (!warnedStaleHandles.has(warnKey)) {
    warnedStaleHandles.add(warnKey);
    console.warn(`[four] ${message}`);
  }
  throw new FourError(code, message, context ? { context } : undefined);
}
