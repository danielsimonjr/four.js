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
  assertReplayCompatible,
  cloneJsonValue,
  decodeBase64,
  decodeReplayRecording,
  encodeBase64,
  encodeReplayRecording,
  isReplayCompatible,
  validateReplayRecording,
} from "./replay-format.js";
