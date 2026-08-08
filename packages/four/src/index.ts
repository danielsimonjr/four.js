// The umbrella package (§98): one namespace per workspace package, plus the
// §45 composition root, which is the only API `four` owns rather than re-exports.
export * as core from "@four/core";
export * as math from "@four/math";
export * as scene from "@four/scene";
export * as geometry from "@four/geometry";
export * as materials from "@four/materials";
export * as assets from "@four/assets";
export * as motion from "@four/motion";
export * as input from "@four/input";
export * as serialization from "@four/serialization";
export * as diagnostics from "@four/diagnostics";
export * as particles from "@four/particles";
export * as text from "@four/text";
export * as render from "@four/render";
export * as animation from "@four/animation";
export * as physics from "@four/physics";
export * as renderWebgpu from "@four/render-webgpu";
export * as renderWebgl from "@four/render-webgl";
export * as renderCanvas from "@four/render-canvas";
export * as renderSvg from "@four/render-svg";
export * as ui from "@four/ui";
export * as physicsRapier from "@four/physics-rapier";
export * as physicsBox2d from "@four/physics-box2d";
export * as physicsSoft from "@four/physics-soft";

export type { ApplicationEventMap, ApplicationOptions } from "./application.js";
export { Application } from "./application.js";

// §79 support for the engine's own node classes and components (A-14, PH-17,
// and the drawing tier — A-16, 2026-08-07). It lives here rather than in
// `@four/serialization` for the reason that package's own header gives: the
// §3.1 matrix lets it see `core`/`math`/`scene` only, and the umbrella is the
// one place that may see `ui`, `render`, and `motion` too.
//
// Every `*_NODE_TYPE` the module writes is re-exported, so an application can
// name any type it may meet in a document (the six A-12 control names were
// missed when they shipped, 2026-08-07).
export type {
  SceneNodeTypeOptions,
  SceneNodeTypeSupport,
  SceneResourceCatalog,
  SceneSerializationSupport,
  UnknownResourcePolicy,
} from "./scene-serializers.js";
export {
  BUTTON_NODE_TYPE,
  CHECKBOX_NODE_TYPE,
  DIRECTIONAL_LIGHT_NODE_TYPE,
  IMAGE_NODE_TYPE,
  LABEL_NODE_TYPE,
  ORTHOGRAPHIC_CAMERA_NODE_TYPE,
  PANEL_NODE_TYPE,
  PERSPECTIVE_CAMERA_NODE_TYPE,
  PROGRESS_NODE_TYPE,
  RADIO_BUTTON_NODE_TYPE,
  RENDERABLE_NODE_TYPE,
  SLIDER_NODE_TYPE,
  SPRITE_NODE_TYPE,
  TOGGLE_NODE_TYPE,
  composeSceneNodeTypes,
  registerPhysicsSerializers,
  registerRenderSerializers,
  registerSceneNodeTypes,
  registerUISerializers,
  resourceCatalog,
  restoreNodeId,
} from "./scene-serializers.js";
