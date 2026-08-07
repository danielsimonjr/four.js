export const PACKAGE_NAME = "@four/diagnostics";

export type { Checksum } from "./checksum.js";
export { createChecksum, hashFloats } from "./checksum.js";

export type {
  ReplayRecorderOptions,
  ReplaySnapshot,
  ReplayTarget,
} from "./recorder.js";
export { ReplayRecorder } from "./recorder.js";

export type {
  JsonValue,
  ReplayAdapterIdentity,
  ReplayFrameRecord,
  ReplayInputRecord,
  ReplayRecording,
  ReplaySnapshotRecord,
} from "./replay-format.js";
export {
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
  DebugJointAccess,
  DebugPhysicsEventLike,
  SolverJointStatistics,
  SolverStatistics,
  StagedVisualization,
  Vector3Like,
} from "./debug-draw.js";
export {
  DEBUG_DRAW_DEFAULT_COLORS,
  DEBUG_DRAW_STAGED,
  DEBUG_POSITION_FLOATS_PER_SEGMENT,
  DEBUG_SEGMENT_FLOATS,
  DEBUG_VERTEX_FLOATS,
  DEFAULT_DEBUG_BUFFER_CAPACITY,
  DebugDrawBuffer,
  collectBodyOrigins,
  collectBodyVelocities,
  collectCentersOfMass,
  collectContactImpulses,
  collectContactPoints,
  solverJointStatistics,
  solverStatistics,
} from "./debug-draw.js";
// --- END WP-10.3 debug-draw ---
