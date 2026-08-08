export const PACKAGE_NAME = "@four/scene";

export type { AuthorityNode, TransformAuthority } from "./authority.js";
export {
  DEFAULT_TRANSFORM_AUTHORITY,
  TRANSFORM_AUTHORITIES,
  warnAuthorityConflict,
} from "./authority.js";
export type {
  OrthographicCameraOptions,
  PerspectiveCameraOptions,
} from "./camera.js";
export { Camera, OrthographicCamera, PerspectiveCamera } from "./camera.js";
export { Group } from "./group.js";
export type { LayerMask, LayeredNode } from "./layers.js";
export {
  ALL_LAYERS,
  DEFAULT_LAYER,
  DEFAULT_LAYER_MASK,
  DEFAULT_LAYER_NAME,
  LAYER_COUNT,
  NO_LAYERS,
  applyLayers,
  assertLayerMask,
  defineLayer,
  isLayerMask,
  layerIndex,
  layerMask,
  layerMaskNames,
  layerName,
  layerNames,
  layersMatch,
  resetLayers,
} from "./layers.js";
export type { ColorRGB, DirectionalLightOptions } from "./light.js";
export { DirectionalLight } from "./light.js";
export type {
  PoseSnapshotSystem,
  SnapshotSystemOptions,
} from "./interpolation.js";
export {
  POSE_SNAPSHOT_PRIORITY,
  PoseBuffer,
  createSnapshotSystem,
} from "./interpolation.js";
export type {
  NodeEventMap,
  NodeHierarchyEvent,
  NodeOptions,
  NodeType,
} from "./node.js";
export { Node, restoreNodeId } from "./node.js";
export { PoseTarget } from "./pose-target.js";
export { Scene } from "./scene.js";
export { Transform } from "./transform.js";
export type { Viewport } from "./viewport.js";
export { createFullscreenViewport } from "./viewport.js";
export type { WorldTransformStats } from "./world-transforms.js";
export {
  resolveWorldTransform,
  resolveWorldTransforms,
} from "./world-transforms.js";
