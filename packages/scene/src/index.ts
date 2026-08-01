export const PACKAGE_NAME = "@four/scene";

export type { TransformAuthority } from "./authority.js";
export {
  DEFAULT_TRANSFORM_AUTHORITY,
  TRANSFORM_AUTHORITIES,
  warnAuthorityConflict,
} from "./authority.js";
export { Group } from "./group.js";
export type {
  PoseSnapshotSystem,
  SnapshotSystemOptions,
} from "./interpolation.js";
export {
  POSE_SNAPSHOT_PRIORITY,
  PoseBuffer,
  createSnapshotSystem,
} from "./interpolation.js";
export type { NodeEventMap, NodeHierarchyEvent, NodeType } from "./node.js";
export { Node } from "./node.js";
export { Scene } from "./scene.js";
export { Transform } from "./transform.js";
export type { WorldTransformStats } from "./world-transforms.js";
export {
  resolveWorldTransform,
  resolveWorldTransforms,
} from "./world-transforms.js";
