/**
 * The §31 CCD-mode resolution both Rapier adapters share.
 *
 * Extracted (2026-08-05) from the two byte-identical module-private copies in
 * `rapier2d-adapter.ts` and `rapier3d-adapter.ts`: the rule is written once in
 * terms of `@four/physics` types alone, so the two adapters cannot drift apart
 * on which §31 mode a descriptor selects. How the resolved mode is *applied*
 * stays with each adapter (`setCcdEnabled` for `"swept"`,
 * `setSoftCcdPrediction` for `"speculative"`), because that is where the
 * dimension-specific Rapier surface lives.
 */

import { DEFAULT_ENABLED_CCD_MODE } from "@four/physics";
import type { CCDMode, RigidBodyDescriptor } from "@four/physics";

/**
 * Reconciles §23's `continuousCollisionDetection` switch with §31's mode —
 * the WP-5.2 table `RigidBodyDescriptor.ccdMode` documents, row for row.
 *
 * `validateRigidBodyDescriptor` has already rejected the one contradictory
 * combination (`false` plus a non-`"disabled"` mode). An explicit
 * non-`"disabled"` mode wins; **`true` plus an explicit `"disabled"` resolves
 * to {@link DEFAULT_ENABLED_CCD_MODE}** ("on, with no method" selects the
 * default method — the table's last-but-one row). The 2026-08-05 review found
 * the adapters' previous copies returned `"disabled"` for that row, silently
 * diverging from the component's pinned rule; this shared implementation now
 * matches the documented table, so `new RigidBody(desc)` + `world.addBody`
 * and `adapter.createBody(desc)` produce the same body.
 */
export function resolveCcdMode(desc: RigidBodyDescriptor): CCDMode {
  const mode = desc.ccdMode;
  if (mode !== undefined && mode !== "disabled") {
    return mode;
  }
  return desc.continuousCollisionDetection === true
    ? DEFAULT_ENABLED_CCD_MODE
    : "disabled";
}
