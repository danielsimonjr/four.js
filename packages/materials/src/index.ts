export const PACKAGE_NAME = "@four/materials";

export type { LitMaterialOptions } from "./lit-material.js";
export { LitMaterial } from "./lit-material.js";
export type { BlendMode, MaterialOptions } from "./material.js";
export { Material } from "./material.js";
export type { NodeMaterialOptions } from "./node-material.js";
export { NodeMaterial } from "./node-material.js";
export type { ShaderOperand } from "./node-material-builder.js";
export {
  NodeMaterialBuilder,
  ShaderExpression,
  ShaderGraphBuilder,
  ShaderGraphOutput,
} from "./node-material-builder.js";
export type {
  ShaderAttributeName,
  ShaderBinaryOp,
  ShaderDomain,
  ShaderGraph,
  ShaderGraphAnalysis,
  ShaderNode,
  ShaderNodeId,
  ShaderReflection,
  ShaderTextureReflection,
  ShaderUnaryOp,
  ShaderUniformReflection,
  ShaderValueType,
} from "./shader-graph.js";
export {
  MAX_SHADER_GRAPH_NODES,
  MAX_SHADER_GRAPH_TEXTURES,
  SHADER_ATTRIBUTE_TYPES,
  SHADER_VALUE_COMPONENTS,
  analyzeShaderGraph,
  forEachShaderNodeReference,
  freezeShaderGraph,
} from "./shader-graph.js";
export type {
  SpriteMaterialOptions,
  SpriteTexture,
} from "./sprite-material.js";
export { SpriteMaterial } from "./sprite-material.js";
export type {
  StencilFunc,
  StencilOp,
  StencilStateOptions,
} from "./stencil-state.js";
export { MAX_STENCIL_VALUE, StencilState } from "./stencil-state.js";
export type { ColorRGB, StandardMaterialOptions } from "./standard-material.js";
export { StandardMaterial } from "./standard-material.js";
export type {
  MaterialTexture,
  MaterialTextureFilter,
  MaterialTextureMinFilter,
  MaterialTextureWrap,
} from "./texture.js";
export type { ColorRGBA, UnlitMaterialOptions } from "./unlit-material.js";
export { UnlitMaterial } from "./unlit-material.js";
