export const PACKAGE_NAME = "@four/input";

export type { DragListener, DragManagerOptions } from "./drag.js";
export { DragManager } from "./drag.js";
export type { PickHit, Pickable } from "./pick.js";
export { createPickRay, pick } from "./pick.js";
export type {
  PropagatingPointerEventType,
  ScenePointerEventInit,
  ScenePointerEventType,
} from "./pointer-events.js";
export {
  CAPTURE_KEY_PREFIX,
  ScenePointerEvent,
  buildPropagationPath,
  dispatchPointerEvent,
} from "./pointer-events.js";
export type {
  PointerInputOptions,
  PointerSurface,
  SurfacePointerEvent,
  SurfacePointerListener,
  SurfaceRect,
} from "./pointer-input.js";
export { DEFAULT_CLICK_MOVE_THRESHOLD, PointerInput } from "./pointer-input.js";
