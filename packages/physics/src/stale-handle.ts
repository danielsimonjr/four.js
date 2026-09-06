/**
 * §83's stale physics handle development warning (A-4/A-5).
 *
 * Solver adapters refuse destroyed or foreign handles with
 * `INVALID_APPLICATION_STATE`; this helper pairs that refusal with a
 * one-time §83 warning. {@link devWarnOnce} is safe in simulation packages:
 * it never changes a number the engine computes (§33).
 */

import {
  FourError,
  devWarnOnce,
  type FourErrorCode,
} from "@four/core";

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
  devWarnOnce(`stale-physics-handle:${kind}:${key}`, message);
  throw new FourError(code, message, context ? { context } : undefined);
}
