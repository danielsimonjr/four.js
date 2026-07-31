/**
 * Explicit disposal (§83).
 *
 * GPU and solver resources are explicitly disposable — textures, geometries,
 * materials, physics worlds, and the application itself all expose
 * `dispose()`. This module defines the shared interface and the batch helper
 * every owner uses to tear its children down.
 */

/** A resource whose lifetime is owned explicitly (§83). */
export interface Disposable {
  dispose(): void;
}

/**
 * Disposes `items` in **reverse insertion order**: teardown mirrors
 * construction, so a resource is always disposed before whatever it was built
 * on top of (a render target before its device, a joint before its bodies).
 * Owners therefore only have to record acquisitions in order.
 *
 * Every item is disposed even if an earlier one throws — a failed dispose must
 * not leak the resources behind it (§83). If any `dispose()` threw, the first
 * thrown value is re-thrown after the pass completes.
 */
export function disposeAll(items: Iterable<Disposable>): void {
  const ordered = [...items].reverse();
  let firstFailure: unknown;
  let failed = false;
  for (const item of ordered) {
    try {
      item.dispose();
    } catch (error) {
      if (!failed) {
        failed = true;
        firstFailure = error;
      }
    }
  }
  if (failed) {
    throw firstFailure;
  }
}
