export const PACKAGE_NAME = "@four/math";

export { constructionCount, resetConstructionCount } from "./alloc-counter.js";
export type { ColorRGB, ColorRGBA, ColorSpace } from "./color.js";
export {
  linearToSrgb,
  linearToSrgbRGB,
  linearToSrgbRGBA,
  parseColor,
  parseColorRGB,
  srgbToLinear,
  srgbToLinearRGB,
  srgbToLinearRGBA,
} from "./color.js";
export { Frustum } from "./frustum.js";
export { Matrix3 } from "./matrix3.js";
export { Matrix4 } from "./matrix4.js";
export type { DepthRange } from "./matrix4.js";
export { Quaternion } from "./quaternion.js";
export { Rectangle2 } from "./rectangle2.js";
export { Vector2 } from "./vector2.js";
export { Vector3 } from "./vector3.js";
export { Vector4 } from "./vector4.js";
