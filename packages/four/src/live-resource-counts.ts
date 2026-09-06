/**
 * Aggregates §83 live-resource counts for `auditResourceLeaks`.
 *
 * `@four/diagnostics` cannot import `@four/geometry`, `@four/render`,
 * `@four/materials`, or `@four/physics` (plan §3.1), so the audit takes a
 * plain {@link LiveResourceCounts} record. The umbrella is the one package
 * that may see every producer; this helper is the fill.
 *
 * Materials and solver handles have no §84 `app.stats` slot — they are
 * count-tier only, and the audit is the surface.
 */

import type { LiveResourceCounts } from "@four/diagnostics";
import { geometryMemoryBytes, liveGeometryCount } from "@four/geometry";
import { liveMaterialCount } from "@four/materials";
import {
  liveSolverBodyCount,
  liveSolverColliderCount,
  liveSolverHandleCount,
  liveSolverJointCount,
} from "@four/physics";
import {
  liveRenderTargetCount,
  liveTextureCount,
  textureMemoryBytes,
} from "@four/render";

/** A snapshot of every live-instance / byte reader the engine publishes. */
export function readLiveResourceCounts(): LiveResourceCounts {
  return {
    geometries: liveGeometryCount(),
    bufferBytes: geometryMemoryBytes(),
    textures: liveTextureCount(),
    renderTargets: liveRenderTargetCount(),
    textureBytes: textureMemoryBytes(),
    materials: liveMaterialCount(),
    solverBodies: liveSolverBodyCount(),
    solverColliders: liveSolverColliderCount(),
    solverJoints: liveSolverJointCount(),
    solverHandles: liveSolverHandleCount(),
  };
}
