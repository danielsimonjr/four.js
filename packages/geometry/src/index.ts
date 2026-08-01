export const PACKAGE_NAME = "@four/geometry";

export type {
  BufferGeometryOptions,
  GeometryBounds,
  GeometryDrawMode,
  GeometryIndexArray,
} from "./buffer-geometry.js";
export { BufferGeometry } from "./buffer-geometry.js";
export type {
  BoxGeometryOptions,
  CircleGeometry2DOptions,
  PlaneGeometryOptions,
} from "./primitives.js";
export { boxGeometry, circleGeometry2D, planeGeometry } from "./primitives.js";
