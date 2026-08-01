/**
 * The WebGL 2 surface this backend uses, and the one shader pair it draws with
 * (§61, §62, §120).
 *
 * Two things live here because they are the same decision seen from two sides:
 *
 * 1. **{@link WebglContext}** — a structural description of *exactly* the GL
 *    entry points this package calls, and nothing else.
 * 2. **{@link UnlitProgram}** — the MVP tier's only pipeline: positions in,
 *    `viewProjection * model * position` out, one uniform colour in the
 *    fragment stage (§57's `UnlitMaterial`, §120's "unlit colored geometry").
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
  /** `GL_DEPTH_BUFFER_BIT`, for {@link WebglContext.clear}. */
  DEPTH_BUFFER_BIT: 0x00000100,
  /** `GL_COLOR_BUFFER_BIT`, for {@link WebglContext.clear}. */
  COLOR_BUFFER_BIT: 0x00004000,
  /** `GL_LEQUAL` — the depth comparison this backend uses. */
  LEQUAL: 0x0203,
  /** `GL_CCW` — counter-clockwise front faces (§7a right-handed, Y-up). */
  CCW: 0x0901,
  /** `GL_CULL_FACE`, deliberately left disabled — see `webgl-renderer.ts`. */
  CULL_FACE: 0x0b44,
  /** `GL_DEPTH_TEST`. */
  DEPTH_TEST: 0x0b71,
  /** `GL_SCISSOR_TEST` — enabled for the lifetime of the renderer. */
  SCISSOR_TEST: 0x0c11,
  /** `GL_MAX_TEXTURE_SIZE`, the one §62 limit the MVP reports. */
  MAX_TEXTURE_SIZE: 0x0d33,
  /** `GL_UNSIGNED_SHORT` — index type of a `Uint16Array` index buffer. */
  UNSIGNED_SHORT: 0x1403,
  /** `GL_UNSIGNED_INT` — index type of a `Uint32Array` index buffer. */
  UNSIGNED_INT: 0x1405,
  /** `GL_FLOAT` — the position attribute's component type. */
  FLOAT: 0x1406,
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
 */
function compileStage(
  gl: WebglContext,
  type: number,
  source: string,
  stageName: string,
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
      `The unlit ${stageName} shader failed to compile (§61, §89).`,
      { context: { stage: stageName, log, source } },
    );
  }

  return shader;
}

/** Looks a uniform up, or throws — see {@link UnlitProgram.create}. */
function requireUniform(
  gl: WebglContext,
  program: GlProgramHandle,
  name: string,
): GlUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `The unlit program has no active uniform "${name}"; the linked program ` +
        "is not the one this backend wrote (§61).",
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
   * Throws a {@link FourError} carrying `SHADER_COMPILATION_FAILED` (§89) with
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
    const vertexShader = compileStage(
      gl,
      GL.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
      "vertex",
    );

    let fragmentShader: GlShader;
    try {
      fragmentShader = compileStage(
        gl,
        GL.FRAGMENT_SHADER,
        FRAGMENT_SHADER_SOURCE,
        "fragment",
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
          "WebGL 2 could not allocate the unlit program object (§61).",
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
          "The unlit program failed to link (§61, §89).",
          { context: { stage: "link", log } },
        );
      }

      try {
        return new UnlitProgram(
          gl,
          program,
          requireUniform(gl, program, "viewProjection"),
          requireUniform(gl, program, "model"),
          requireUniform(gl, program, "color"),
        );
      } catch (error: unknown) {
        gl.deleteProgram(program);
        throw error;
      }
    } finally {
      // Attached shaders are reference-counted by the program; deleting them
      // here frees the compiler-side objects and leaves the linked program
      // intact, which is the standard GL idiom.
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
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
