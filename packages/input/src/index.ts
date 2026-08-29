export const PACKAGE_NAME = "@four/input";

export type { DragListener, DragManagerOptions } from "./drag.js";
export { DragManager } from "./drag.js";
export type {
  KeyDefaultSuppressor,
  KeyModifiers,
  SceneKeyEventInit,
  SceneKeyEventType,
} from "./key-events.js";
export { SceneKeyEvent, dispatchKeyEvent } from "./key-events.js";
export type {
  KeySurface,
  KeyboardInputOptions,
  SurfaceKeyEvent,
  SurfaceKeyListener,
} from "./keyboard-input.js";
export { KeyboardInput } from "./keyboard-input.js";
export type {
  PickHit,
  Pickable,
  PickableAlphaMask,
  PickProvider,
} from "./pick.js";
export { createPickRay, pick } from "./pick.js";
export type {
  PointerDeviceType,
  PropagatingPointerEventType,
  ScenePointerEventInit,
  ScenePointerEventType,
} from "./pointer-events.js";
export {
  CAPTURE_KEY_PREFIX,
  ScenePointerEvent,
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
export {
  SceneInputEvent,
  buildPropagationPath,
  dispatchThreePhase,
} from "./propagation.js";
