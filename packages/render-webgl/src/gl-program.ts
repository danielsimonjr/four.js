/**
 * The WebGL 2 surface this backend uses, and the pipelines it draws with
 * (§61, §62, §120, §106a).
 *
 * Three things live here because they are the same decision seen from three
 * sides:
 *
 * 1. **{@link WebglContext}** — a structural description of *exactly* the GL
 *    entry points this package calls, and nothing else.
 * 2. **{@link UnlitProgram}** — the MVP tier's first pipeline: positions in,
 *    `viewProjection * model * position` out, one uniform colour in the
 *    fragment stage (§57's `UnlitMaterial`, §120's "unlit colored geometry").
 * 3. **{@link SpriteProgram}** — §55's textured quad: the same vertex arrays,
 *    a uv derived from the quad's local rectangle, one texture sample times a
 *    tint (WP-3a.3). Both pipelines bind the position stream at the same fixed
 *    attribute location, so `gl-geometry.ts`'s vertex arrays serve both.
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
import type { Matrix4 } from "@four/math";

/**
 * The WebGL 2 / OpenGL ES 3.0 enumerants this package uses, by their normative
 * values. See the module header for why these are literals.
 */
export const GL = {
  /** `GL_LINES` — two vertices per primitive. */
  LINES: 0x0001,
  /** `GL_TRIANGLES` — three vertices per primitive. */
  TRIANGLES: 0x0004,
  /** `GL_SRC_ALPHA` — source factor of the straight-alpha blend (§66). */
  SRC_ALPHA: 0x0302,
  /** `GL_ONE_MINUS_SRC_ALPHA` — destination factor of the same blend. */
  ONE_MINUS_SRC_ALPHA: 0x0303,
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
  /** `GL_BLEND` — enabled around sprite draws only; see `webgl-renderer.ts`. */
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
 * The MVP vertex stage: object space → clip space, nothing else.
 *
 * `viewProjection` is `projection * view` and is uploaded once per viewport;
 * `model` is the render item's world matrix and changes per draw. Splitting
 * them (rather than uploading one pre-multiplied MVP) keeps the per-draw upload
 * to one matrix and matches how §64's render items are already shaped.
 */
const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;

uniform mat4 viewProjection;
uniform mat4 model;

void main() {
  gl_Position = viewProjection * model * vec4(position, 1.0);
}
`;

/**
 * The MVP fragment stage: one flat colour (§57 `UnlitMaterial`).
 *
 * `highp` because GLSL ES 3.00 requires fragment-stage `highp` support (unlike
 * ES 1.00, where `mediump` was the portable floor), and because the colour is
 * written straight to the framebuffer — there is nothing to gain from a lower
 * precision here. Straight (non-premultiplied) alpha, linear-light components,
 * matching `Viewport.clearColor` and §60a.
 */
const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 color;

out vec4 fragColor;

void main() {
  fragColor = color;
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
 * Scratch for matrix uploads.
 *
 * `Matrix4.elements` is a `Float64Array` (the engine computes in doubles);
 * `uniformMatrix4fv` wants 32-bit floats. One module-level buffer, reused by
 * every upload of every program, keeps the per-draw cost to a 16-element
 * `set()` and allocates nothing per frame (plan D7). Safe to share because
 * uploads are synchronous: the data is consumed by the GL call before the next
 * `set()` can happen.
 */
const matrixScratch = new Float32Array(16);

/** Scratch for {@link UnlitProgram.setColor}; see {@link matrixScratch}. */
const colorScratch = new Float32Array(4);

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
 * {@link UnlitProgram.create} and {@link SpriteProgram.create} that is identical
 * for every pipeline.
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
function createLinkedProgram(
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
function requireUniform(
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

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    viewProjectionLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
    colorLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#viewProjectionLocation = viewProjectionLocation;
    this.#modelLocation = modelLocation;
    this.#colorLocation = colorLocation;
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
   * Uploads a straight-alpha, linear-light RGBA colour (§57, §60a). Accepts the
   * material's own live array; the values are copied into scratch, so the
   * material keeps ownership of its array.
   */
  setColor(color: readonly [number, number, number, number]): void {
    colorScratch[0] = color[0];
    colorScratch[1] = color[1];
    colorScratch[2] = color[2];
    colorScratch[3] = color[3];
    this.#gl.uniform4fv(this.#colorLocation, colorScratch);
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
   * Uploads a straight-alpha RGBA tint (§55, §66). Accepts the material's own
   * live array; the values are copied into scratch, so the material keeps
   * ownership of its array.
   */
  setTint(tint: readonly [number, number, number, number]): void {
    colorScratch[0] = tint[0];
    colorScratch[1] = tint[1];
    colorScratch[2] = tint[2];
    colorScratch[3] = tint[3];
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
