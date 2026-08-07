/**
 * The WebGL 2 surface this backend uses, and the pipelines it draws with
 * (§61, §62, §120, §106a).
 *
 * Four things live here because they are the same decision seen from four
 * sides:
 *
 * 1. **{@link WebglContext}** — a structural description of *exactly* the GL
 *    entry points this package calls, and nothing else.
 * 2. **{@link UnlitProgram}** — the MVP tier's first pipeline: positions in,
 *    `viewProjection * model * position` out, one uniform colour in the
 *    fragment stage (§57's `UnlitMaterial`, §120's "unlit colored geometry"),
 *    times an optional texture sample and an optional per-vertex colour, both
 *    selected by a uniform switch (R-19, 2026-08-07).
 * 3. **{@link SpriteProgram}** — §55's textured quad: the same vertex arrays,
 *    a uv derived from the quad's local rectangle, one texture sample times a
 *    tint (WP-3a.3). Both pipelines bind the position stream at the same fixed
 *    attribute location, so `gl-geometry.ts`'s vertex arrays serve both.
 * 4. **{@link LitProgram}** — §68's Lambert-lit surface (§120 "lighting",
 *    2026-08-04): positions plus the optional normal stream at a second fixed
 *    location, one directional light plus the scene ambient term as uniforms.
 *    The same vertex arrays again — a geometry without normals binds nothing
 *    at the normal slot and shades from its ambient term alone.
 *
 * ## Why a hand-written context type instead of `WebGL2RenderingContext`
 *
 * `WebGL2RenderingContext` is a `lib.dom` type. `@four/render` already refuses
 * to name DOM types (its `RendererOptions.canvas` is `unknown` for exactly this
 * reason), and this package keeps the same discipline one level down: nothing
 * here needs `lib.dom`, so nothing here pulls it in, and the package
 * type-checks and unit-tests under plain Node with no DOM lib and no jsdom.
 *
 * The cost is that the interface has to be maintained by hand; the benefit is
 * that it *is* the package's GL budget, written down. Every method on
 * {@link WebglContext} is called somewhere in this package, and a call that
 * needs a new entry point has to add it here first — which is what makes the
 * hand-rolled fake in the unit tests a complete, honest double rather than a
 * partial stub that happens to work. A real `WebGL2RenderingContext` satisfies
 * this interface structurally, so the browser path (WP-3.8) needs no adapter.
 *
 * ## Why the enum values are constants here, not reads off the context
 *
 * {@link GL} spells the numeric values out. They are normative in OpenGL ES 3.0
 * and WebGL 2 — `GL_TRIANGLES` is `0x0004` in every implementation that exists
 * — so reading them back off the context buys nothing but forces every fake and
 * every mock to carry twenty-odd constant properties in addition to its methods
 * (decision, WP-3.5). Keeping the interface to methods is what keeps the test
 * double small enough to be read in one sitting.
 */

import { FourError, type Disposable } from "@four/core";
import type { Matrix4, Vector3 } from "@four/math";

/**
 * The WebGL 2 / OpenGL ES 3.0 enumerants this package uses, by their normative
 * values. See the module header for why these are literals.
 */
export const GL = {
  /** `GL_LINES` — two vertices per primitive. */
  LINES: 0x0001,
  /** `GL_TRIANGLES` — three vertices per primitive. */
  TRIANGLES: 0x0004,
  /** `GL_ZERO` — destination factor of the `"multiply"` blend mode (§57). */
  ZERO: 0,
  /** `GL_ONE` — destination factor of `"additive"`, source of `"screen"`. */
  ONE: 1,
  /** `GL_SRC_COLOR`; declared for completeness of the blend-factor set. */
  SRC_COLOR: 0x0300,
  /** `GL_ONE_MINUS_SRC_COLOR` — destination factor of `"screen"`. */
  ONE_MINUS_SRC_COLOR: 0x0301,
  /** `GL_SRC_ALPHA` — source factor of the straight-alpha blend (§66). */
  SRC_ALPHA: 0x0302,
  /** `GL_ONE_MINUS_SRC_ALPHA` — destination factor of the same blend. */
  ONE_MINUS_SRC_ALPHA: 0x0303,
  /** `GL_DST_COLOR` — source factor of the `"multiply"` blend mode. */
  DST_COLOR: 0x0306,
  /** `GL_DEPTH_BUFFER_BIT`, for {@link WebglContext.clear}. */
  DEPTH_BUFFER_BIT: 0x00000100,
  /** `GL_COLOR_BUFFER_BIT`, for {@link WebglContext.clear}. */
  COLOR_BUFFER_BIT: 0x00004000,
  /** `GL_LEQUAL` — the depth comparison this backend uses. */
  LEQUAL: 0x0203,
  /** `GL_TEXTURE_MAG_FILTER`. */
  TEXTURE_MAG_FILTER: 0x2800,
  /** `GL_TEXTURE_MIN_FILTER`. */
  TEXTURE_MIN_FILTER: 0x2801,
  /** `GL_TEXTURE_WRAP_S`. */
  TEXTURE_WRAP_S: 0x2802,
  /** `GL_TEXTURE_WRAP_T`. */
  TEXTURE_WRAP_T: 0x2803,
  /** `GL_LINEAR` — bilinear sampling; the MVP tier has no mipmaps (§77). */
  LINEAR: 0x2601,
  /** `GL_CCW` — counter-clockwise front faces (§7a right-handed, Y-up). */
  CCW: 0x0901,
  /** `GL_CULL_FACE`, deliberately left disabled — see `webgl-renderer.ts`. */
  CULL_FACE: 0x0b44,
  /** `GL_DEPTH_TEST`. */
  DEPTH_TEST: 0x0b71,
  /** `GL_BLEND` — enabled around sprite and particle passes; see `webgl-renderer.ts`. */
  BLEND: 0x0be2,
  /** `GL_SCISSOR_TEST` — enabled for the lifetime of the renderer. */
  SCISSOR_TEST: 0x0c11,
  /** `GL_TEXTURE_2D` — the one texture target this tier binds (§77). */
  TEXTURE_2D: 0x0de1,
  /** `GL_MAX_TEXTURE_SIZE`, the one §62 limit the MVP reports. */
  MAX_TEXTURE_SIZE: 0x0d33,
  /** `GL_UNSIGNED_BYTE` — the RGBA8 texel component type. */
  UNSIGNED_BYTE: 0x1401,
  /** `GL_UNSIGNED_SHORT` — index type of a `Uint16Array` index buffer. */
  UNSIGNED_SHORT: 0x1403,
  /** `GL_UNSIGNED_INT` — index type of a `Uint32Array` index buffer. */
  UNSIGNED_INT: 0x1405,
  /** `GL_FLOAT` — the position attribute's component type. */
  FLOAT: 0x1406,
  /** `GL_RGBA` — the texel upload format. */
  RGBA: 0x1908,
  /** `GL_CLAMP_TO_EDGE` — the wrap mode of every MVP-tier texture (§77). */
  CLAMP_TO_EDGE: 0x812f,
  /** `GL_TEXTURE0` — the one texture unit the sprite pipeline samples from. */
  TEXTURE0: 0x84c0,
  /** `GL_RGBA8` — the sized internal format of an MVP-tier texture. */
  RGBA8: 0x8058,
  /** `GL_ARRAY_BUFFER` — vertex attribute storage. */
  ARRAY_BUFFER: 0x8892,
  /** `GL_ELEMENT_ARRAY_BUFFER` — index storage; part of vertex-array state. */
  ELEMENT_ARRAY_BUFFER: 0x8893,
  /** `GL_STATIC_DRAW` — the only usage hint this tier uploads with. */
  STATIC_DRAW: 0x88e4,
  /** `GL_FRAGMENT_SHADER`. */
  FRAGMENT_SHADER: 0x8b30,
  /** `GL_VERTEX_SHADER`. */
  VERTEX_SHADER: 0x8b31,
  /** `GL_COMPILE_STATUS`. */
  COMPILE_STATUS: 0x8b81,
  /** `GL_LINK_STATUS`. */
  LINK_STATUS: 0x8b82,
} as const;

/** Opaque `WebGLShader` handle. */
export type GlShader = object;

/** Opaque `WebGLProgram` handle. */
export type GlProgramHandle = object;

/** Opaque `WebGLBuffer` handle. */
export type GlBuffer = object;

/** Opaque `WebGLVertexArrayObject` handle. */
export type GlVertexArray = object;

/** Opaque `WebGLUniformLocation` handle. */
export type GlUniformLocation = object;

/** Opaque `WebGLTexture` handle. */
export type GlTexture = object;

/**
 * The GL 2 entry points this package calls — the whole of them.
 *
 * Grouped by the module that uses each group, because that grouping is the
 * package's internal layering: shaders and uniforms here, buffers and vertex
 * arrays in `gl-geometry.ts`, per-frame state and draws in
 * `webgl-renderer.ts`.
 *
 * Return types are narrowed relative to the WebIDL where the WebGL 2
 * specification pins the answer for the specific enumerant this package passes
 * — `getShaderParameter(shader, COMPILE_STATUS)` is a `GLboolean`, so it is
 * typed `boolean` — and left `unknown` where it does not
 * ({@link WebglContext.getParameter}), so the caller has to narrow.
 */
export interface WebglContext {
  // --- Shaders and programs (this module) ---

  createShader(type: number): GlShader | null;
  shaderSource(shader: GlShader, source: string): void;
  compileShader(shader: GlShader): void;
  getShaderParameter(shader: GlShader, pname: number): boolean;
  getShaderInfoLog(shader: GlShader): string | null;
  deleteShader(shader: GlShader): void;

  createProgram(): GlProgramHandle | null;
  attachShader(program: GlProgramHandle, shader: GlShader): void;
  linkProgram(program: GlProgramHandle): void;
  getProgramParameter(program: GlProgramHandle, pname: number): boolean;
  getProgramInfoLog(program: GlProgramHandle): string | null;
  deleteProgram(program: GlProgramHandle): void;

  getUniformLocation(
    program: GlProgramHandle,
    name: string,
  ): GlUniformLocation | null;
  useProgram(program: GlProgramHandle | null): void;
  uniformMatrix4fv(
    location: GlUniformLocation,
    transpose: boolean,
    data: Float32Array,
  ): void;
  uniform4fv(location: GlUniformLocation, data: Float32Array): void;
  uniform3fv(location: GlUniformLocation, data: Float32Array): void;
  uniform1i(location: GlUniformLocation, value: number): void;

  // --- Textures (`gl-texture.ts`) ---

  createTexture(): GlTexture | null;
  bindTexture(target: number, texture: GlTexture | null): void;
  /**
   * The nine-argument, explicitly sized form — the only one this tier calls.
   * `pixels` is `null` for a texture with no CPU-side data, which allocates
   * zero-filled storage (§77).
   */
  texImage2D(
    target: number,
    level: number,
    internalFormat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: ArrayBufferView | null,
  ): void;
  texParameteri(target: number, pname: number, param: number): void;
  deleteTexture(texture: GlTexture): void;
  activeTexture(unit: number): void;

  // --- Buffers and vertex arrays (`gl-geometry.ts`) ---

  createBuffer(): GlBuffer | null;
  bindBuffer(target: number, buffer: GlBuffer | null): void;
  bufferData(target: number, data: ArrayBufferView, usage: number): void;
  deleteBuffer(buffer: GlBuffer): void;

  createVertexArray(): GlVertexArray | null;
  bindVertexArray(array: GlVertexArray | null): void;
  deleteVertexArray(array: GlVertexArray): void;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void;

  // --- Per-frame state and draws (`webgl-renderer.ts`) ---

  getParameter(pname: number): unknown;
  enable(capability: number): void;
  disable(capability: number): void;
  depthFunc(func: number): void;
  frontFace(mode: number): void;
  viewport(x: number, y: number, width: number, height: number): void;
  scissor(x: number, y: number, width: number, height: number): void;
  clearColor(red: number, green: number, blue: number, alpha: number): void;
  clearDepth(depth: number): void;
  clear(mask: number): void;
  blendFunc(sourceFactor: number, destinationFactor: number): void;
  /**
   * Enables or disables writing to the depth buffer (§57's `depthWrite`).
   *
   * Separate from `enable(DEPTH_TEST)`, which is what §57's `depthTest`
   * controls: the usual transparent surface *tests* depth and does not *write*
   * it, and only two GL entry points can say that.
   */
  depthMask(enabled: boolean): void;
  /**
   * Enables or disables writing each colour channel (§57's `colorWrite`).
   *
   * Per-channel in GL; this tier only ever sets all four together, because §57
   * declares one boolean. A per-channel mask is what a later `colorWrite`
   * carrying a channel set would drive.
   */
  colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void;
  drawArrays(mode: number, first: number, count: number): void;
  drawElements(mode: number, count: number, type: number, offset: number): void;
  isContextLost(): boolean;
}

/**
 * Vertex attribute slot the position stream is bound to.
 *
 * Fixed by `layout(location = 0)` in the vertex shader rather than looked up
 * with `getAttribLocation` (decision, WP-3.5). GLSL ES 3.00 supports explicit
 * attribute locations, so the location is a property of the *source*, not of a
 * particular link; that removes one query from initialization, removes one
 * method from {@link WebglContext}, and — more usefully — makes vertex arrays
 * built by `gl-geometry.ts` independent of any program, which is what will let
 * a second pipeline reuse them unchanged.
 */
export const POSITION_ATTRIBUTE_LOCATION = 0;

/**
 * Vertex attribute slot the optional normal stream is bound to (§53, §68) —
 * fixed by `layout(location = 1)` exactly as the position slot is, and for the
 * same reasons. Location 1 collides with nothing: the particle pipeline's
 * instance attributes live in its own vertex arrays (attribute bindings are
 * VAO state), and `gl-geometry.ts`'s arrays bind this slot only when the
 * geometry carries normals. A program that does not declare the slot (unlit,
 * sprite) simply ignores an enabled stream; the lit program run over a
 * geometry that never enabled it reads GL's constant default `(0, 0, 0, 1)`,
 * which the lit fragment stage treats as "no normal — ambient only".
 */
export const NORMAL_ATTRIBUTE_LOCATION = 1;

/**
 * Vertex attribute slot the optional uv stream is bound to (§53, §55; R-19,
 * 2026-08-07) — fixed by `layout(location = 2)`, exactly as the position and
 * normal slots are.
 *
 * Location 2 collides with nothing: the particle pipeline's instance
 * attributes live in *its own* vertex arrays and attribute bindings are VAO
 * state, so the same number means different things in two arrays that are never
 * bound at the same time. A geometry without uvs enables nothing here and a
 * textured draw of it reads GL's constant default `(0, 0, 0, 1)`, i.e. samples
 * the texel at the texture's origin for every fragment.
 */
export const UV_ATTRIBUTE_LOCATION = 2;

/**
 * Vertex attribute slot the optional per-vertex colour stream is bound to
 * (§53, §60a; R-19). Four floats — straight RGBA — at `layout(location = 3)`,
 * for the same reasons as the three slots above.
 *
 * A geometry without colors reads GL's constant default `(0, 0, 0, 1)`, so a
 * `vertexColors` material drawn over one renders black; that is the documented
 * behaviour on `UnlitMaterial.vertexColors`, chosen because a visible mistake
 * beats a silently ignored flag.
 */
export const COLOR_ATTRIBUTE_LOCATION = 3;

/**
 * The texture unit the `map` sampler of the unlit and lit pipelines reads from.
 *
 * Unit 0, permanently, and the same unit the sprite pipeline uses: this tier
 * binds exactly one texture per draw, and §77's multi-texture materials
 * (normal maps, masks, atlases plus data maps) are what will need a unit
 * allocator. Naming the constant keeps the `activeTexture` call in
 * `webgl-renderer.ts` and the sampler upload here from drifting apart.
 */
export const MAP_TEXTURE_UNIT = 0;

/**
 * The MVP vertex stage: object space → clip space, plus the two optional
 * streams the fragment stage may multiply by.
 *
 * `viewProjection` is `projection * view` and is uploaded once per viewport;
 * `model` is the render item's world matrix and changes per draw. Splitting
 * them (rather than uploading one pre-multiplied MVP) keeps the per-draw upload
 * to one matrix and matches how §64's render items are already shaped.
 *
 * `uv` and `vertexColor` were added by R-19 (2026-08-07). `gl_Position` is
 * computed from exactly the same expression as before, so a scene that uses
 * neither rasterizes identically — which is what the pixel goldens check.
 */
const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec4 vertexColor;

uniform mat4 viewProjection;
uniform mat4 model;

out vec2 vUv;
out vec4 vColor;

void main() {
  vUv = uv;
  vColor = vertexColor;
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The MVP fragment stage: one flat colour (§57 `UnlitMaterial`), optionally
 * multiplied by a texture sample and by the interpolated vertex colour.
 *
 * `highp` because GLSL ES 3.00 requires fragment-stage `highp` support (unlike
 * ES 1.00, where `mediump` was the portable floor), and because the colour is
 * written straight to the framebuffer — there is nothing to gain from a lower
 * precision here. Straight (non-premultiplied) alpha, linear-light components,
 * matching `Viewport.clearColor` and §60a.
 *
 * ## One program, two uniform switches (decision, R-19)
 *
 * `useMap` and `useVertexColors` are **uniforms, not `#define`d variants**. A
 * variant set would mean two more programs to compile at initialization (or a
 * lazy compile inside `render`, which §61 forbids throwing from), two more sets
 * of uniform locations to keep, and a pipeline switch between a textured and an
 * untextured draw. The switch costs one uniform branch per fragment on a
 * pipeline that does nothing else, and — the property that mattered — **a
 * material that names neither feature issues no additional GL call at all**:
 * both uniforms sit at GL's initial `0`, the backend mirrors that on the CPU,
 * and it uploads only when a draw actually changes them.
 *
 * With both off, `fragColor` is assigned `color` with no arithmetic in between,
 * so the frame is bit-identical to the one this shader drew before R-19.
 */
const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 color;
uniform sampler2D map;
uniform bool useMap;
uniform bool useVertexColors;

in vec2 vUv;
in vec4 vColor;

out vec4 fragColor;

void main() {
  vec4 result = color;
  if (useVertexColors) {
    result *= vColor;
  }
  if (useMap) {
    result *= texture(map, vUv);
  }
  fragColor = result;
}
`;

/**
 * The sprite vertex stage: object space → clip space, plus the uv the fragment
 * stage samples with (§55).
 *
 * ## Why uv is computed, not read from an attribute
 *
 * §53's `BufferGeometry` carries positions and indices and nothing else — there
 * is no uv stream to bind, and introducing one is the packet that adds the
 * standard attribute set, not this one. A sprite's quad is a rectangle in the XY
 * plane, so its uv is an exact affine function of its position:
 *
 * ```text
 * uv = (position.xy - quad.xy) / quad.zw
 * ```
 *
 * where `quad` is `(minX, minY, width, height)` of the quad in **local** space —
 * which is precisely the geometry's own local bounds, already computed and
 * cached against its version by `BufferGeometry.computeBounds()`. The mapping is
 * exact for every anchor and every size, costs one `vec4` upload per draw
 * instead of a second vertex buffer per sprite, and lets the sprite pipeline
 * reuse the vertex arrays `gl-geometry.ts` already builds — the position stream
 * is bound to the same fixed `layout(location = 0)` slot, so one geometry cache
 * serves both pipelines (decision, WP-3a.3).
 *
 * `v = 0` is the quad's **bottom** edge, matching §7a's Y-up world and the
 * bottom-row-first texel order `@four/render`'s `TextureSource` documents; no
 * flip is needed anywhere in this backend.
 */
const SPRITE_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 viewProjection;
uniform mat4 model;
uniform vec4 quad;

out vec2 vUv;

void main() {
  vUv = (position.xy - quad.xy) / quad.zw;
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The sprite fragment stage: one texture sample, multiplied by a tint (§55).
 *
 * Both sides are **straight (non-premultiplied) alpha** — §66 requires the
 * engine to state its policy, and the MVP tier commits to straight, matching
 * `UnlitMaterial.color`, `SpriteMaterial.tint`, and `Viewport.clearColor`. The
 * multiply is therefore componentwise, and the blend equation that consumes it
 * is `SRC_ALPHA`/`ONE_MINUS_SRC_ALPHA` (see `webgl-renderer.ts`).
 *
 * No alpha test and no discard: §66 lists alpha test and alpha-to-coverage as
 * requirements, and both are material state that §57's `Material` base has to
 * carry before a shader can branch on it.
 */
const SPRITE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D map;
uniform vec4 tint;

in vec2 vUv;

out vec4 fragColor;

void main() {
  fragColor = texture(map, vUv) * tint;
}
`;

/**
 * The lit vertex stage (§68): object space → clip space, plus the world-space
 * normal the fragment stage shades with.
 *
 * The normal is transformed by the **inverse transpose** of the model
 * matrix's upper 3×3 — the standard fix for non-uniform scale, under which
 * the plain 3×3 would bend normals off their surfaces. GLSL ES 3.00 has
 * `inverse()` and `transpose()` built in, so the matrix is derived in the
 * shader per vertex rather than uploaded per draw; staged with a dated note
 * (2026-08-04): when `@four/math`'s `Matrix3` grows a normal-matrix utility,
 * hoisting this to a per-draw uniform saves the per-vertex inversion. MVP
 * vertex counts make the difference unmeasurable, and the shader route needs
 * no new upload path or math surface today.
 */
const LIT_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;

uniform mat4 viewProjection;
uniform mat4 model;

out vec3 vNormal;
out vec2 vUv;

void main() {
  vNormal = transpose(inverse(mat3(model))) * normal;
  vUv = uv;
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The lit fragment stage (§57 `LitMaterial`, §68, §60a): Lambert diffuse under
 * one directional light, plus the scene ambient term.
 *
 * ```text
 * fragColor.rgb = color.rgb * (ambientLight + lightColor * max(dot(N, -L), 0))
 * fragColor.a   = color.a
 * ```
 *
 * - `lightDirection` is the **direction the light travels** (world space,
 *   unit), so the surface term is `dot(N, -L)`; `lightColor` arrives
 *   premultiplied by intensity (`SceneLights.directionalColor`), and a
 *   no-light frame uploads black, which zeroes the Lambert term — one shader,
 *   no variants.
 * - The interpolated normal is re-normalized, guarded against zero length: a
 *   geometry with no normal stream reads the attribute default `(0, 0, 0, 1)`,
 *   whose xyz would turn `normalize()` into NaN — the guard turns it into
 *   "ambient only" instead, the documented shading of a normal-less lit draw.
 * - Lambert is one-sided: a face lit from behind gets `dot ≤ 0`, i.e. ambient
 *   only. With back-face culling off (see `webgl-renderer.ts`) that is the
 *   physically honest look for a plane's back.
 * - Straight alpha, linear-light arithmetic on plain 0…1 numbers; §60a's
 *   transfer functions and tone mapping are a later packet, as everywhere.
 * - `useMap` multiplies the **base colour**, before the lighting term, so a
 *   texture is an albedo and the lights shade it (R-19). Off, the expression
 *   below reduces to exactly the one this shader carried before, uniform switch
 *   and all — see `FRAGMENT_SHADER_SOURCE` for why a uniform, not a variant.
 */
const LIT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 color;
uniform sampler2D map;
uniform bool useMap;
uniform vec3 ambientLight;
uniform vec3 lightDirection;
uniform vec3 lightColor;

in vec3 vNormal;
in vec2 vUv;

out vec4 fragColor;

void main() {
  float len = length(vNormal);
  float diffuse = len > 0.0
    ? max(dot(vNormal / len, -lightDirection), 0.0)
    : 0.0;
  vec4 base = color;
  if (useMap) {
    base *= texture(map, vUv);
  }
  fragColor = vec4(base.rgb * (ambientLight + lightColor * diffuse), base.a);
}
`;

/**
 * Scratch for matrix uploads.
 *
 * `Matrix4.elements` is a `Float64Array` (the engine computes in doubles);
 * `uniformMatrix4fv` wants 32-bit floats. One module-level buffer, reused by
 * every upload of every program — including `gl-particles.ts`'s, which imports
 * it — keeps the per-draw cost to a 16-element `set()` and allocates nothing
 * per frame (plan D7). Safe to share because uploads are synchronous: the data
 * is consumed by the GL call before the next `set()` can happen.
 */
export const matrixScratch = new Float32Array(16);

/** Scratch for {@link UnlitProgram.setColor}; see {@link matrixScratch}. */
const colorScratch = new Float32Array(4);

/** Scratch for the lit pipeline's `vec3` uploads; see {@link matrixScratch}. */
const vec3Scratch = new Float32Array(3);

/**
 * Compiles one shader stage, or throws.
 *
 * The info log travels in the {@link FourError} `context` rather than in the
 * message: §89's codes are for machines, the log is for a human, and putting a
 * multi-line driver log inside an exception message makes both harder to read.
 *
 * `label` names the pipeline in the message only — the code and the `context`
 * fields are identical for every program, so a caller matching on §89's code
 * does not have to care which pipeline failed, and a human reading the message
 * immediately does.
 */
function compileStage(
  gl: WebglContext,
  type: number,
  source: string,
  stageName: string,
  label: string,
): GlShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `WebGL 2 could not allocate the ${stageName} shader object (§61).`,
      { context: { stage: stageName } },
    );
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, GL.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `The ${label} ${stageName} shader failed to compile (§61, §89).`,
      { context: { stage: stageName, log, source } },
    );
  }

  return shader;
}

/**
 * Compiles both stages and links them into a program, or throws — the half of
 * every pipeline's `create` ({@link UnlitProgram}, {@link SpriteProgram},
 * {@link LitProgram}, and `gl-particles.ts`'s `ParticleProgram`) that is
 * identical for all of them.
 *
 * Throws a {@link FourError} carrying `SHADER_COMPILATION_FAILED` (§89) with the
 * driver's info log in `context.log` when a stage fails to compile, when linking
 * fails, or when GL refuses to allocate an object. One failure code covers
 * compile *and* link because §89 defines one, and because the two are one
 * operation from a caller's point of view: the program either exists or it does
 * not. `context.stage` says which half failed.
 *
 * Shader objects are deleted on every path — successful or not — because they
 * are only needed until the link completes. Attached shaders are
 * reference-counted by the program, so deleting them frees the compiler-side
 * objects and leaves the linked program intact, which is the standard GL idiom.
 */
export function createLinkedProgram(
  gl: WebglContext,
  label: string,
  vertexSource: string,
  fragmentSource: string,
): GlProgramHandle {
  const vertexShader = compileStage(
    gl,
    GL.VERTEX_SHADER,
    vertexSource,
    "vertex",
    label,
  );

  let fragmentShader: GlShader;
  try {
    fragmentShader = compileStage(
      gl,
      GL.FRAGMENT_SHADER,
      fragmentSource,
      "fragment",
      label,
    );
  } catch (error: unknown) {
    gl.deleteShader(vertexShader);
    throw error;
  }

  try {
    const program = gl.createProgram();
    if (program === null) {
      throw new FourError(
        "SHADER_COMPILATION_FAILED",
        `WebGL 2 could not allocate the ${label} program object (§61).`,
        { context: { stage: "link" } },
      );
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, GL.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "";
      gl.deleteProgram(program);
      throw new FourError(
        "SHADER_COMPILATION_FAILED",
        `The ${label} program failed to link (§61, §89).`,
        { context: { stage: "link", log } },
      );
    }

    return program;
  } finally {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }
}

/** Looks a uniform up, or throws — see {@link UnlitProgram.create}. */
export function requireUniform(
  gl: WebglContext,
  program: GlProgramHandle,
  name: string,
  label: string,
): GlUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `The ${label} program has no active uniform "${name}"; the linked ` +
        "program is not the one this backend wrote (§61).",
      { context: { uniform: name } },
    );
  }
  return location;
}

/**
 * The single pipeline the MVP tier draws with (§120): unlit, flat-coloured,
 * position-only geometry.
 *
 * ```ts
 * const program = UnlitProgram.create(gl);
 * program.use();
 * program.setViewProjection(viewProjection);   // once per viewport
 * program.setModel(item.worldMatrix);          // once per draw
 * program.setColor(item.material.color);
 * program.setFeatures(hasMap, material.vertexColors);
 * ```
 *
 * Owns its GL objects and nothing else. It is **not** re-created on context
 * loss by itself: the renderer drops its reference when the context goes away
 * and calls {@link UnlitProgram.create} again on restore (§61's "re-creates
 * engine-owned GPU resources"), because only the renderer knows which context
 * is the live one.
 */
export class UnlitProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #colorLocation: GlUniformLocation;

  readonly #mapLocation: GlUniformLocation;

  readonly #useMapLocation: GlUniformLocation;

  readonly #useVertexColorsLocation: GlUniformLocation;

  /**
   * CPU mirror of the two feature uniforms, seeded with GL's own initial value
   * for an `int`/`bool` uniform — `0`, i.e. both off. Because the mirror starts
   * where GL starts, a frame that never enables a feature never issues a
   * `uniform1i`, which is the whole point (see `FRAGMENT_SHADER_SOURCE`).
   *
   * Uniform values live in the program object, so the mirror stays accurate
   * across pipeline switches, views, and frames; a context loss builds a new
   * program and therefore a new mirror.
   */
  #useMap = false;

  #useVertexColors = false;

  /** Whether the sampler unit has been uploaded — see {@link setFeatures}. */
  #samplerUploaded = false;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    colorLocation: GlUniformLocation,
    mapLocation: GlUniformLocation,
    useMapLocation: GlUniformLocation,
    useVertexColorsLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#colorLocation = colorLocation;
    this.#mapLocation = mapLocation;
    this.#useMapLocation = useMapLocation;
    this.#useVertexColorsLocation = useVertexColorsLocation;
  }

  /**
   * Compiles and links the unlit program on `gl`.
   *
   * Throws a {@link @four/core!FourError | FourError} carrying `SHADER_COMPILATION_FAILED` (§89) with
   * the driver's info log in `context.log` when any stage fails to compile,
   * when linking fails, when GL refuses to allocate an object, or when a
   * uniform this backend wrote is missing from the linked program. Shader
   * objects are deleted on every path — successful or not — because they are
   * only needed until the link completes.
   *
   * A single failure code covers compile *and* link because §89 defines one,
   * and because the two are one operation from a caller's point of view: the
   * program either exists or it does not. `context.stage` says which half
   * failed.
   */
  static create(gl: WebglContext): UnlitProgram {
    const program = createLinkedProgram(
      gl,
      "unlit",
      VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new UnlitProgram(
        gl,
        program,
        requireUniform(gl, program, "viewProjection", "unlit"),
        requireUniform(gl, program, "model", "unlit"),
        requireUniform(gl, program, "color", "unlit"),
        requireUniform(gl, program, "map", "unlit"),
        requireUniform(gl, program, "useMap", "unlit"),
        requireUniform(gl, program, "useVertexColors", "unlit"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link UnlitProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call once per frame, before any upload. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Uploads `projection * view` for the viewport being drawn. Column-major, so
   * `transpose` is false — the engine's `Matrix4` layout is already GL's (§7b).
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one render item's world matrix. See {@link setViewProjection}. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Uploads a straight-alpha, linear-light RGBA colour (§57, §60a), scaled by
   * the material's `opacity`. Accepts the material's own live array; the values
   * are copied into scratch, so the material keeps ownership of its array.
   *
   * `opacity` multiplies **alpha only** — §57 makes it a uniform transparency
   * over whatever alpha the colour already carries — and defaults to `1`, at
   * which `alpha × 1` is `alpha` bit for bit, so a material that never touches
   * opacity uploads exactly what it did before the field existed.
   */
  setColor(
    color: readonly [number, number, number, number],
    opacity = 1,
  ): void {
    colorScratch[0] = color[0];
    colorScratch[1] = color[1];
    colorScratch[2] = color[2];
    colorScratch[3] = color[3] * opacity;
    this.#gl.uniform4fv(this.#colorLocation, colorScratch);
  }

  /**
   * Selects the two optional multipliers for the draw about to be issued
   * (§53's `uvs`/`colors`, §57's `map`, R-19): whether to sample the bound
   * texture, and whether to multiply by the geometry's per-vertex colour.
   *
   * ```ts
   * program.setFeatures(material.map !== null, material.vertexColors);
   * ```
   *
   * **Issues a GL call only where the draw changes something.** The mirror
   * starts at GL's own initial `0`/`0`, so a scene whose materials name neither
   * feature calls this once per draw and uploads nothing — the compatibility
   * guarantee `applyMaterialState` makes for §57's render state, made again
   * here for the same reason and checked the same way.
   *
   * The `map` sampler's texture unit is uploaded lazily, the first time this
   * program is asked for a textured draw: `glUniform1i` writes into the
   * *currently bound* program, and a sampler upload at creation time would put
   * the renderer's program state in two places (the argument
   * `SpriteProgram.setSampler` records). GL's initial sampler value is already
   * {@link MAP_TEXTURE_UNIT}, so the upload is belt and braces — it costs one
   * call in the lifetime of a program that ever draws a texture, and nothing at
   * all in one that does not.
   */
  setFeatures(useMap: boolean, useVertexColors: boolean): void {
    if (useMap !== this.#useMap) {
      if (useMap && !this.#samplerUploaded) {
        this.#gl.uniform1i(this.#mapLocation, MAP_TEXTURE_UNIT);
        this.#samplerUploaded = true;
      }
      this.#gl.uniform1i(this.#useMapLocation, useMap ? 1 : 0);
      this.#useMap = useMap;
    }
    if (useVertexColors !== this.#useVertexColors) {
      this.#gl.uniform1i(
        this.#useVertexColorsLocation,
        useVertexColors ? 1 : 0,
      );
      this.#useVertexColors = useVertexColors;
    }
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context.** After a context loss every handle is
   * already invalid and the renderer drops its reference instead of disposing
   * — see the class documentation.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/**
 * The textured-quad pipeline (§55) — the backend's second and last program in
 * the §106a tier.
 *
 * ```ts
 * const program = SpriteProgram.create(gl);
 * program.use();
 * program.setSampler(0);                        // once per activation
 * program.setViewProjection(viewProjection);    // once per viewport
 * program.setModel(item.worldMatrix);           // once per draw
 * program.setQuad(minX, minY, width, height);   // the quad's local rect
 * program.setTint(item.material.tint);
 * ```
 *
 * It shares `gl-geometry.ts`'s vertex arrays with {@link UnlitProgram}: both
 * declare the position stream at the fixed
 * {@link POSITION_ATTRIBUTE_LOCATION}, which is what "a second pipeline reuses
 * these vertex arrays unchanged" in that module's header was written for. See
 * `SPRITE_VERTEX_SHADER_SOURCE` for why there is no uv attribute.
 *
 * Owns its GL objects and nothing else — the texture it samples belongs to
 * `gl-texture.ts`'s cache, and the renderer re-creates this program on context
 * restore exactly as it re-creates the unlit one (§61).
 */
export class SpriteProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #quadLocation: GlUniformLocation;

  readonly #tintLocation: GlUniformLocation;

  readonly #samplerLocation: GlUniformLocation;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    quadLocation: GlUniformLocation,
    tintLocation: GlUniformLocation,
    samplerLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#quadLocation = quadLocation;
    this.#tintLocation = tintLocation;
    this.#samplerLocation = samplerLocation;
  }

  /**
   * Compiles and links the sprite program on `gl`.
   *
   * Fails exactly as {@link UnlitProgram.create} does — see it, and
   * `createLinkedProgram`, for the contract; the messages name `"sprite"` instead
   * of `"unlit"` and the §89 code is the same.
   */
  static create(gl: WebglContext): SpriteProgram {
    const program = createLinkedProgram(
      gl,
      "sprite",
      SPRITE_VERTEX_SHADER_SOURCE,
      SPRITE_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new SpriteProgram(
        gl,
        program,
        requireUniform(gl, program, "viewProjection", "sprite"),
        requireUniform(gl, program, "model", "sprite"),
        requireUniform(gl, program, "quad", "sprite"),
        requireUniform(gl, program, "tint", "sprite"),
        requireUniform(gl, program, "map", "sprite"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link SpriteProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Points the `map` sampler at texture `unit`.
   *
   * Uploaded whenever the pipeline becomes current rather than once at creation:
   * `glUniform*` writes into the *currently bound* program, and binding one at
   * creation time would leave the renderer's program state to be guessed at from
   * two places instead of one (decision, WP-3a.3). One `uniform1i` per pipeline
   * switch is not a cost worth optimizing.
   */
  setSampler(unit: number): void {
    this.#gl.uniform1i(this.#samplerLocation, unit);
  }

  /**
   * Uploads `projection * view` for the viewport being drawn. Column-major, so
   * `transpose` is false — the engine's `Matrix4` layout is already GL's (§7b).
   *
   * Uniform values live in the program object, so one upload per viewport holds
   * for every sprite drawn into it, even if the unlit pipeline draws in between.
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one render item's world matrix. See {@link setViewProjection}. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Uploads the quad's local rectangle — `(minX, minY, width, height)` — from
   * which the vertex stage derives uv. See
   * `SPRITE_VERTEX_SHADER_SOURCE`.
   */
  setQuad(minX: number, minY: number, width: number, height: number): void {
    colorScratch[0] = minX;
    colorScratch[1] = minY;
    colorScratch[2] = width;
    colorScratch[3] = height;
    this.#gl.uniform4fv(this.#quadLocation, colorScratch);
  }

  /**
   * Uploads a straight-alpha RGBA tint (§55, §66) scaled by the material's
   * `opacity` — see `UnlitProgram.setColor` for the multiply and why the
   * default reproduces the previous upload exactly. Accepts the material's own
   * live array; the values are copied into scratch, so the material keeps
   * ownership of its array.
   */
  setTint(tint: readonly [number, number, number, number], opacity = 1): void {
    colorScratch[0] = tint[0];
    colorScratch[1] = tint[1];
    colorScratch[2] = tint[2];
    colorScratch[3] = tint[3] * opacity;
    this.#gl.uniform4fv(this.#tintLocation, colorScratch);
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — see {@link UnlitProgram.dispose}.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/**
 * The Lambert-lit pipeline (§57 `LitMaterial`, §68, §120 "lighting") — added
 * by the lighting packet, 2026-08-04.
 *
 * ```ts
 * const program = LitProgram.create(gl);
 * program.use();
 * program.setViewProjection(viewProjection);          // once per viewport
 * program.setAmbientLight(lights.ambientColor);       // once per viewport
 * program.setDirectionalLight(
 *   lights.direction,                                 // once per viewport
 *   lights.directionalColor,
 * );
 * program.setModel(item.worldMatrix);                 // once per draw
 * program.setColor(item.material.color);
 * ```
 *
 * It shares `gl-geometry.ts`'s vertex arrays with the other pipelines: the
 * position stream sits at the fixed {@link POSITION_ATTRIBUTE_LOCATION} and
 * the normal stream — when the geometry has one — at the fixed
 * {@link NORMAL_ATTRIBUTE_LOCATION}, so one geometry cache serves all four
 * programs. Light uniforms are per *frame* state uploaded per viewport (they
 * live in the program object, exactly like the view-projection): one
 * directional light plus the scene ambient, the §120 tier — multi-light,
 * shadows (§69), and tone mapping (§60a) are staged where `@four/scene`'s
 * `light.ts` records.
 *
 * Owns its GL objects and nothing else; the renderer re-creates it on context
 * restore exactly as it re-creates the unlit one (§61).
 */
export class LitProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #colorLocation: GlUniformLocation;

  readonly #ambientLightLocation: GlUniformLocation;

  readonly #lightDirectionLocation: GlUniformLocation;

  readonly #lightColorLocation: GlUniformLocation;

  readonly #mapLocation: GlUniformLocation;

  readonly #useMapLocation: GlUniformLocation;

  /** CPU mirror of `useMap`; see `UnlitProgram`'s for the contract. */
  #useMap = false;

  #samplerUploaded = false;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    colorLocation: GlUniformLocation,
    ambientLightLocation: GlUniformLocation,
    lightDirectionLocation: GlUniformLocation,
    lightColorLocation: GlUniformLocation,
    mapLocation: GlUniformLocation,
    useMapLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#colorLocation = colorLocation;
    this.#ambientLightLocation = ambientLightLocation;
    this.#lightDirectionLocation = lightDirectionLocation;
    this.#lightColorLocation = lightColorLocation;
    this.#mapLocation = mapLocation;
    this.#useMapLocation = useMapLocation;
  }

  /**
   * Compiles and links the lit program on `gl`.
   *
   * Fails exactly as {@link UnlitProgram.create} does — see it for the
   * contract; the messages name `"lit"` and the §89 code is the same.
   */
  static create(gl: WebglContext): LitProgram {
    const program = createLinkedProgram(
      gl,
      "lit",
      LIT_VERTEX_SHADER_SOURCE,
      LIT_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new LitProgram(
        gl,
        program,
        requireUniform(gl, program, "viewProjection", "lit"),
        requireUniform(gl, program, "model", "lit"),
        requireUniform(gl, program, "color", "lit"),
        requireUniform(gl, program, "ambientLight", "lit"),
        requireUniform(gl, program, "lightDirection", "lit"),
        requireUniform(gl, program, "lightColor", "lit"),
        requireUniform(gl, program, "map", "lit"),
        requireUniform(gl, program, "useMap", "lit"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link LitProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Uploads `projection * view` for the viewport being drawn. Column-major, so
   * `transpose` is false — the engine's `Matrix4` layout is already GL's (§7b).
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one render item's world matrix. See {@link setViewProjection}. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Uploads a straight-alpha, linear-light RGBA colour (§57, §60a) — the
   * material's base color, scaled by its `opacity` exactly as
   * `UnlitProgram.setColor` does. Accepts the material's own live array; the
   * values are copied into scratch, so the material keeps ownership of its
   * array.
   */
  setColor(
    color: readonly [number, number, number, number],
    opacity = 1,
  ): void {
    colorScratch[0] = color[0];
    colorScratch[1] = color[1];
    colorScratch[2] = color[2];
    colorScratch[3] = color[3] * opacity;
    this.#gl.uniform4fv(this.#colorLocation, colorScratch);
  }

  /**
   * Uploads the scene ambient term (§68), straight RGB. Accepts the
   * `SceneLights` record's own live array — copied into scratch, as every
   * upload here is.
   */
  setAmbientLight(color: readonly [number, number, number]): void {
    vec3Scratch[0] = color[0];
    vec3Scratch[1] = color[1];
    vec3Scratch[2] = color[2];
    this.#gl.uniform3fv(this.#ambientLightLocation, vec3Scratch);
  }

  /**
   * Uploads the directional light (§68): the world-space unit vector the
   * light **travels along** (`SceneLights.direction` — the fragment stage
   * negates it for the surface term) and its color premultiplied by intensity
   * (`SceneLights.directionalColor`). A frame with no directional light
   * uploads black, which zeroes the Lambert term — see the fragment source.
   */
  setDirectionalLight(
    direction: Vector3,
    color: readonly [number, number, number],
  ): void {
    vec3Scratch[0] = direction.x;
    vec3Scratch[1] = direction.y;
    vec3Scratch[2] = direction.z;
    this.#gl.uniform3fv(this.#lightDirectionLocation, vec3Scratch);
    vec3Scratch[0] = color[0];
    vec3Scratch[1] = color[1];
    vec3Scratch[2] = color[2];
    this.#gl.uniform3fv(this.#lightColorLocation, vec3Scratch);
  }

  /**
   * Selects whether this draw samples the bound albedo texture (§57's `map`,
   * R-19). Identical in contract to `UnlitProgram.setFeatures` — mirrored on
   * the CPU, uploaded only on change, sampler unit uploaded lazily — minus the
   * vertex-colour switch, which §57 puts on `UnlitMaterial` alone.
   */
  setFeatures(useMap: boolean): void {
    if (useMap === this.#useMap) {
      return;
    }
    if (useMap && !this.#samplerUploaded) {
      this.#gl.uniform1i(this.#mapLocation, MAP_TEXTURE_UNIT);
      this.#samplerUploaded = true;
    }
    this.#gl.uniform1i(this.#useMapLocation, useMap ? 1 : 0);
    this.#useMap = useMap;
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — see {@link UnlitProgram.dispose}.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}
