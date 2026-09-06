export const PACKAGE_NAME = "@four/diagnostics";

export type { Checksum } from "./checksum.js";
export { createChecksum, hashFloats } from "./checksum.js";

export type {
  ReplayRecorderOptions,
  ReplaySnapshot,
  ReplayTarget,
} from "./recorder.js";
export { ReplayRecorder } from "./recorder.js";

// --- PH-20 (§33 rollback) ---------------------------------------------------
export type { RollbackBufferOptions, RollbackTarget } from "./rollback.js";
export { RollbackBuffer } from "./rollback.js";

export type {
  JsonValue,
  ReplayAdapterIdentity,
  ReplayFrameRecord,
  ReplayInputRecord,
  ReplayRecording,
  ReplaySnapshotRecord,
  UntrustedJsonLimits,
} from "./replay-format.js";
export {
  LATEST_REPLAY_FORMAT_VERSION,
  MINIMUM_REPLAY_FORMAT_VERSION,
  // Deprecated 2026-08-07 (F7) alias of LATEST_REPLAY_FORMAT_VERSION; still
  // exported so no consumer breaks.
  REPLAY_FORMAT_VERSION,
  SUPPORTED_REPLAY_FORMAT_VERSIONS,
  assertReplayCompatible,
  cloneJsonValue,
  decodeBase64,
  decodeReplayRecording,
  encodeBase64,
  encodeReplayRecording,
  isReplayCompatible,
  validateReplayRecording,
} from "./replay-format.js";

// --- WP-10.2 (ReplayPlayer) begin -------------------------------------------
export type {
  ReplayPlayerOptions,
  ReplayStepEvent,
  ReplayStepListener,
} from "./replay-player.js";
export {
  DEFAULT_REPLAY_MAXIMUM_SUB_STEPS,
  ReplayPlayer,
} from "./replay-player.js";
// --- WP-10.2 (ReplayPlayer) end ---------------------------------------------

// --- BEGIN WP-10.3 debug-draw (packages/diagnostics/src/debug-draw.ts) ---
export type {
  CollectBodyOriginsOptions,
  CollectBodyVelocitiesOptions,
  CollectCentersOfMassOptions,
  CollectContactImpulsesOptions,
  CollectContactPointsOptions,
  DebugBodyAccess,
  DebugCenterOfMassAccess,
  DebugCollisionEventLike,
  DebugColor,
  DebugContactPoint,
  DebugDrawBufferOptions,
  DebugDrawStreams,
  DebugGeometrySink,
  DebugJointAccess,
  DebugPhysicsEventLike,
  SolverJointStatistics,
  SolverStatistics,
  StagedVisualization,
  Vector3Like,
} from "./debug-draw.js";
export {
  DEBUG_COLOR_FLOATS_PER_SEGMENT,
  DEBUG_DRAW_DEFAULT_COLORS,
  DEBUG_DRAW_STAGED,
  DEBUG_POSITION_FLOATS_PER_SEGMENT,
  DEBUG_SEGMENT_FLOATS,
  DEBUG_VERTEX_FLOATS,
  DEFAULT_DEBUG_BUFFER_CAPACITY,
  DebugDrawBuffer,
  applyDebugDrawStreams,
  collectBodyOrigins,
  collectBodyVelocities,
  collectCentersOfMass,
  collectContactImpulses,
  collectContactPoints,
  debugDrawStreams,
  solverJointStatistics,
} from "./debug-draw.js";
// --- END WP-10.3 debug-draw ---

// §83's leaked-resource development warning (A-4/A-5, 2026-08-07).
export type {
  AuditResourceLeaksOptions,
  LiveResourceCounts,
  ResourceLeakReport,
} from "./resource-audit.js";
export { NO_RESOURCE_LEAKS, auditResourceLeaks } from "./resource-audit.js";

export type {
  ValidationCatalogueOptions,
  ValidationCheckOptions,
  ValidationNodeLike,
  ValidationTransformLike,
} from "./validation.js";
export {
  COORDINATE_ENVELOPE,
  NEAR_ZERO_SCALE,
  UNSTABLE_SCALE_RATIO,
  assertFinite,
  assertNoSceneGraphCycle,
  validateSceneNode,
  validateSceneSubtree,
  warnCoordinateEnvelope,
  warnSingularScale,
  warnUnstableScale,
} from "./validation.js";

export {
  DEFAULT_PER_FRAME_ALLOCATION_THRESHOLD,
  beginFrameAllocationCheck,
  endFrameAllocationCheck,
  warnDetachedNodeListeners,
  warnDisposedResourceInUse,
  warnPerFrameAllocations,
  warnStalePhysicsHandle,
} from "./dev-warnings.js";

// §84 runtime statistics (A-1, 2026-08-07).
export type { ClockSource, FrameStats, RenderStatisticsLike } from "./stats.js";
export {
  copyFrameStats,
  createFrameStats,
  createMonotonicClock,
  monotonicNowSeconds,
  recordRenderStatistics,
  recordResourceMemory,
  recordSolverStatistics,
  resetFrameStats,
  solverStatistics,
} from "./stats.js";
