/** Aggregates §83 live-resource counts for auditResourceLeaks. */

import type { LiveResourceCounts } from "@four/diagnostics";
import { geometryMemoryBytes, liveGeometryCount } from "@four/geometry";
import { liveMaterialCount } from "@four/materials";
import { liveSolverBodyCount } from "@four/physics";
import {
  liveRenderTargetCount,
  liveTextureCount,
  textureMemoryBytes,
} from "@four/render";

export function readLiveResourceCounts(): LiveResourceCounts {
  return {
    geometries: liveGeometryCount(),
    bufferBytes: geometryMemoryBytes(),
    textures: liveTextureCount(),
    renderTargets: liveRenderTargetCount(),
    textureBytes: textureMemoryBytes(),
    materials: liveMaterialCount(),
    solverBodies: liveSolverBodyCount(),
  };
}
