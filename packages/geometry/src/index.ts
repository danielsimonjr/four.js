export const PACKAGE_NAME = "@four/geometry";

export type {
  BufferGeometryOptions,
  GeometryBounds,
  GeometryDrawMode,
  GeometryIndexArray,
} from "./buffer-geometry.js";
export { BufferGeometry } from "./buffer-geometry.js";
export type {
  CapsuleGeometryOptions,
  ExtrudeGeometryOptions,
  HeightFieldGeometryOptions,
  LatheGeometryOptions,
  Point3D,
  SphereGeometryOptions,
  TaperedGeometryOptions,
  TorusGeometryOptions,
  TubeGeometryOptions,
} from "./primitives-3d.js";
export {
  capsuleGeometry,
  coneGeometry,
  cylinderGeometry,
  extrudeGeometry,
  heightFieldGeometry,
  latheGeometry,
  sphereGeometry,
  torusGeometry,
  tubeGeometry,
} from "./primitives-3d.js";
export type {
  BoxGeometryOptions,
  CircleGeometry2DOptions,
  PlaneGeometryOptions,
  PolygonGeometry2DOptions,
} from "./primitives.js";
export {
  boxGeometry,
  circleGeometry2D,
  planeGeometry,
  polygonGeometry2D,
} from "./primitives.js";
export { geometryMemoryBytes, liveGeometryCount } from "./resource-memory.js";
export type { Point2D, PolygonTessellator } from "./tessellation.js";
export { earClippingTessellator, triangulatePolygon } from "./tessellation.js";
