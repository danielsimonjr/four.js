/**
 * The batched particle pipeline for the WebGL 2 backend (§36, §64 stage 6,
 * §112; plan P9-3).
 *
 * One particle system is **one draw call**: `drawArraysInstanced` over the six
 * vertices of `@four/render`'s shared unit quad, with `count` instances fed from
 * a per-system dynamic vertex buffer that is re-uploaded once per frame. That is
 * what makes §112's "≥100 000 simple particles … rendered at interactive rates"
 * a question about fill rate rather than about draw-call overhead: the CPU cost
 * of drawing a system is a `bufferSubData` of `count × 32` bytes plus five GL
 * calls, whatever `count` is.
 *
 * Three things live here, for the same reason `gl-program.ts` holds three:
 *
 * 1. **{@link ParticleGlContext}** — the WebGL 2 entry points *only* the
 *    particle path calls, layered on `WebglContext` (see "Why the context type
 *    is extended here" below).
 * 2. **{@link ParticleProgram}** — the pipeline: a screen-aligned quad
 *    billboarded in view space, coloured per instance, blended with straight
 *    alpha.
 * 3. **{@link ParticleBatchCache}** — one vertex array plus one dynamic
 *    instance buffer per particle system, keyed by the emitting node's id,
 *    invalidated and rebuilt exactly like `gl-geometry.ts`'s records.
 *
 * ## Points versus instanced quads (decision, WP-9.3)
 *
 * The cheaper-looking option is `gl.POINTS` with `gl_PointSize`: one vertex per
 * particle, no corner attribute, no instancing. It is **not** used, because the
 * largest point a rasterizer will draw is an implementation-defined limit
 * (`ALIASED_POINT_SIZE_RANGE`) that the specification does not floor at any
 * useful value, and a size past it is **silently clamped** rather than
 * reported — a particle that renders at the authored size on the developer's
 * GPU and at a different one on the user's, which is precisely the class of
 * defect a per-backend visual baseline (§92) cannot catch.
 *
 * **This packet did not measure that limit on SwiftShader**, the software
 * rasterizer the project's browser gate runs against: no browser run was in
 * scope for WP-9.3. That is the honest reason to avoid the mechanism rather
 * than to bet on it (reported to the orchestrator). Instanced quads have no
 * such cap, size correctly under any projection, and cost one extra 72-byte
 * vertex buffer for the entire application.
 *
 * `drawArraysInstanced` and `vertexAttribDivisor` are **core WebGL 2** — the
 * functionality WebGL 1 had to reach for `ANGLE_instanced_arrays` to get — so no
 * extension is queried and none can be missing: a context that lacks them is not
 * a WebGL 2 context, which is precisely what `webgl-renderer.ts`'s structural
 * check already rejects.
 *
 * ## Why the context type is extended here, not in `gl-program.ts`
 *
 * `WebglContext` is that module's written-down GL budget, and the particle path
 * needs three entry points outside it: `bufferSubData`, `vertexAttribDivisor`,
 * and `drawArraysInstanced`. They belong in `WebglContext` — but `gl-program.ts`
 * is outside this packet's file set (plan §1 rule 11: touch only your packet's
 * files), so they are declared as an **extension interface** the renderer
 * narrows to once, at initialization, through the same structural check that
 * accepts the context in the first place. The effect on a caller is nil: a real
 * `WebGL2RenderingContext` satisfies both, and the test fake implements both.
 * **Folding {@link ParticleGlContext} back into `WebglContext` is a mechanical
 * follow-up** (reported to the orchestrator).
 *
 * The same rule explains the small amount of duplication below:
 * `gl-program.ts`'s `compileStage`, `createLinkedProgram`, `requireUniform`, and
 * matrix scratch are module-private, so this module carries its own. Hoisting
 * them into a shared helper is part of the same follow-up.
 *
 * ## Blending (§66, decision WP-9.3)
 *
 * Particles are transparent by construction — §36's colour ramp exists to fade
 * them out — so the particle pass runs with `GL_BLEND` **enabled**, and the
 * renderer turns it off again when the run ends, exactly as it does for sprites.
 * The blend *function* is the one this backend fixes once at initialization:
 * `SRC_ALPHA` / `ONE_MINUS_SRC_ALPHA`, i.e. **straight (non-premultiplied)
 * alpha**, which is §66's stated policy for every colour this tier touches. The
 * per-instance RGBA is therefore used exactly as `@four/particles` authored it,
 * with no premultiply step anywhere.
 *
 * Two consequences, stated rather than hidden:
 *
 * - **Additive particles are staged.** Additive (`ONE`/`ONE`) is the other look
 *   §36 implies, and it needs per-material blend state from §57's `Material`
 *   base; a global switch here would apply to sprites too.
 * - **Depth writing stays on**, as it does for sprites, so overlapping systems
 *   composite in render-list order (layer, then `renderOrder`, then scene
 *   order). §66's transparency sorting is deferred with the same material state.
 *   Turning depth *writes* off for the particle pass would need `depthMask`,
 *   which is not in this backend's GL budget.
 */

import { FourError, type Disposable } from "@four/core";
import type { Matrix4 } from "@four/math";
import {
  PARTICLE_COLOR_OFFSET,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_POSITION_OFFSET,
  PARTICLE_SIZE_OFFSET,
  type ParticleRenderItem,
} from "@four/render";

import {
  GL,
  POSITION_ATTRIBUTE_LOCATION,
  type GlBuffer,
  type GlProgramHandle,
  type GlShader,
  type GlUniformLocation,
  type GlVertexArray,
  type WebglContext,
} from "./gl-program.js";

/**
 * The WebGL 2 / OpenGL ES 3.0 enumerants only the particle path uses. See
 * `gl-program.ts`'s header for why these are literals rather than reads off the
 * context.
 */
export const PARTICLE_GL = {
  /**
   * `GL_DYNAMIC_DRAW` — the usage hint for a buffer written once per frame and
   * drawn from once per frame, which is exactly the instance stream. Everything
   * else this backend uploads is `STATIC_DRAW`.
   */
  DYNAMIC_DRAW: 0x88e8,
} as const;

/**
 * Vertex attribute slots the particle pipeline binds, all fixed by
 * `layout(location = …)` in the vertex shader — the rule
 * {@link POSITION_ATTRIBUTE_LOCATION} already establishes, so no
 * `getAttribLocation` and no per-program vertex array.
 *
 * Slot 0 is the shared corner quad, three floats per vertex, advancing per
 * vertex (divisor 0); slots 1–3 are the interleaved instance stream, advancing
 * once per particle (divisor 1).
 */
export const PARTICLE_ATTRIBUTE_LOCATIONS = {
  /** Unit-quad corner offset, from the shared geometry. Same slot as every other pipeline. */
  corner: POSITION_ATTRIBUTE_LOCATION,
  /** Particle centre in the node's local space (`vec3`). */
  instancePosition: 1,
  /** Current size in world units (`float`). */
  instanceSize: 2,
  /** Current straight-alpha RGBA (`vec4`). */
  instanceColor: 3,
} as const;

/** Bytes per instance — `@four/render`'s interleaved stride. */
const INSTANCE_STRIDE_BYTES =
  PARTICLE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

/**
 * The GL 2 entry points the particle path adds to `WebglContext` — see the
 * module header for why they are declared here.
 *
 * A real `WebGL2RenderingContext` satisfies this interface structurally, as it
 * does `WebglContext`.
 */
export interface ParticleGlContext extends WebglContext {
  /**
   * The **five-argument** form: source offset and length are in *elements* of
   * `data`, not bytes.
   *
   * Deliberately not the three-argument form (plan D7): uploading
   * `data.subarray(0, n)` would allocate a typed-array view every frame, which
   * is precisely the per-frame allocation the particle path exists to avoid.
   */
  bufferSubData(
    target: number,
    dstByteOffset: number,
    data: ArrayBufferView,
    srcOffset: number,
    length: number,
  ): void;

  /** Sets an attribute's instance divisor: 0 per vertex, 1 per instance. */
  vertexAttribDivisor(index: number, divisor: number): void;

  /** Draws `instanceCount` copies of `count` vertices starting at `first`. */
  drawArraysInstanced(
    mode: number,
    first: number,
    count: number,
    instanceCount: number,
  ): void;
}

/**
 * The particle vertex stage: a screen-aligned quad, sized in world units.
 *
 * ```text
 * centre_view = view · model · vec4(instancePosition, 1)
 * corner_view = centre_view.xy + corner.xy · instanceSize
 * gl_Position = projection · vec4(corner_view, …)
 * ```
 *
 * Offsetting in **view space** — after the view transform, before the
 * projection — is what makes the quad face the camera without a per-system
 * billboard matrix and without the camera appearing in the render item (§55's
 * `billboardMode` is deferred for exactly the reason this pipeline sidesteps:
 * a per-view model transform would need a per-view render list). `view` and
 * `projection` arrive as **separate** uniforms rather than the premultiplied
 * `viewProjection` the other two pipelines take, because the offset has to
 * happen between them.
 *
 * `instanceSize` is the quad's edge length in world units, so a particle of size
 * `s` spans `s` units across at any depth under a perspective projection —
 * *not* a constant number of pixels. The node's own scale does **not** scale it
 * (the size never passes through `model`'s linear part); that is a documented
 * limitation, and the fix is §36's `sizeMode`, which the MVP tier does not have.
 */
const PARTICLE_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 corner;
layout(location = 1) in vec3 instancePosition;
layout(location = 2) in float instanceSize;
layout(location = 3) in vec4 instanceColor;

uniform mat4 projection;
uniform mat4 view;
uniform mat4 model;

out vec4 vColor;

void main() {
  vec4 center = view * model * vec4(instancePosition, 1.0);
  center.xy += corner.xy * instanceSize;
  gl_Position = projection * center;
  vColor = instanceColor;
}
`;

/**
 * The particle fragment stage: the interpolated per-instance colour, unchanged.
 *
 * **A solid, opaque-edged square** (decision, WP-9.3). Round particles need
 * either a `discard` on the corner's radius — a branch in the fragment stage of
 * the one draw that is meant to scale to 100 000 instances — or the §55 texture
 * path, which is where soft, textured, and animated particles belong and which
 * this tier deliberately does not reach for (§36's sprite/mesh particle modes
 * are staged with it). A flat quad is the honest MVP: it draws exactly what the
 * simulation says, and nothing about the pipeline changes when a texture and a
 * uv are added to the instance stream later.
 *
 * Straight (non-premultiplied) alpha, matching §66 and every other colour this
 * backend touches.
 */
const PARTICLE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec4 vColor;

out vec4 fragColor;

void main() {
  fragColor = vColor;
}
`;

/**
 * Scratch for matrix uploads — one buffer for this module, reused by every
 * upload. See `gl-program.ts`'s `matrixScratch` for the argument; this is the
 * duplicate the module header names.
 */
const matrixScratch = new Float32Array(16);

/** Compiles one shader stage, or throws. Mirrors `gl-program.ts`'s helper. */
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
      `The particle ${stageName} shader failed to compile (§61, §89).`,
      { context: { stage: stageName, log, source } },
    );
  }

  return shader;
}

/** Looks a uniform up, or throws. Mirrors `gl-program.ts`'s helper. */
function requireUniform(
  gl: WebglContext,
  program: GlProgramHandle,
  name: string,
): GlUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) {
    throw new FourError(
      "SHADER_COMPILATION_FAILED",
      `The particle program has no active uniform "${name}"; the linked ` +
        "program is not the one this backend wrote (§61).",
      { context: { uniform: name } },
    );
  }
  return location;
}

/**
 * The instanced particle pipeline (§36) — this backend's third and last program
 * in the §112 tier.
 *
 * ```ts
 * const program = ParticleProgram.create(gl);
 * program.use();
 * program.setProjection(camera.projectionMatrix);   // once per viewport
 * program.setView(camera.viewMatrix);               // once per viewport
 * program.setModel(item.worldMatrix);               // once per system
 * ```
 *
 * Owns its GL objects and nothing else; the renderer re-creates it on context
 * restore exactly as it re-creates the other two (§61).
 */
export class ParticleProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #projectionLocation: GlUniformLocation;

  readonly #viewLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    projectionLocation: GlUniformLocation,
    viewLocation: GlUniformLocation,
    modelLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#projectionLocation = projectionLocation;
    this.#viewLocation = viewLocation;
    this.#modelLocation = modelLocation;
  }

  /**
   * Compiles and links the particle program on `gl`.
   *
   * Throws a {@link @four/core!FourError | FourError} carrying `SHADER_COMPILATION_FAILED` (§89) with
   * the driver's info log in `context.log` when a stage fails to compile, when
   * linking fails, when GL refuses to allocate an object, or when a uniform this
   * backend wrote is missing from the linked program — the contract
   * `UnlitProgram.create` and `SpriteProgram.create` state, with `"particle"` in
   * the message. Shader objects are deleted on every path.
   */
  static create(gl: WebglContext): ParticleProgram {
    const vertexShader = compileStage(
      gl,
      GL.VERTEX_SHADER,
      PARTICLE_VERTEX_SHADER_SOURCE,
      "vertex",
    );

    let fragmentShader: GlShader;
    try {
      fragmentShader = compileStage(
        gl,
        GL.FRAGMENT_SHADER,
        PARTICLE_FRAGMENT_SHADER_SOURCE,
        "fragment",
      );
    } catch (error: unknown) {
      gl.deleteShader(vertexShader);
      throw error;
    }

    let program: GlProgramHandle;
    try {
      const created = gl.createProgram();
      if (created === null) {
        throw new FourError(
          "SHADER_COMPILATION_FAILED",
          "WebGL 2 could not allocate the particle program object (§61).",
          { context: { stage: "link" } },
        );
      }
      program = created;

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, GL.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) ?? "";
        gl.deleteProgram(program);
        throw new FourError(
          "SHADER_COMPILATION_FAILED",
          "The particle program failed to link (§61, §89).",
          { context: { stage: "link", log } },
        );
      }
    } finally {
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
    }

    try {
      return new ParticleProgram(
        gl,
        program,
        requireUniform(gl, program, "projection"),
        requireUniform(gl, program, "view"),
        requireUniform(gl, program, "model"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link ParticleProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Uploads the camera's projection. Column-major, so `transpose` is false —
   * the engine's `Matrix4` layout is already GL's (§7b).
   */
  setProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#projectionLocation, false, matrixScratch);
  }

  /** Uploads the camera's view matrix. See {@link ParticleProgram.setProjection}. */
  setView(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#viewLocation, false, matrixScratch);
  }

  /** Uploads one particle system's world matrix. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — after a loss every handle is already
   * invalid and the renderer drops its reference instead (§61).
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}

/** Everything one particle system needs at draw time. */
export interface ParticleBatchRecord {
  /** Vertex array holding the corner attribute and the three instance attributes. */
  readonly vertexArray: GlVertexArray;

  /** The dynamic buffer the instance stream is uploaded into. */
  readonly instanceBuffer: GlBuffer;

  /**
   * The shared quad's position buffer this vertex array was built against.
   *
   * Recorded so the cache can tell a *stale* vertex array from a live one: the
   * geometry cache deletes and re-creates its buffers whenever the quad's
   * version advances or a context is restored, and a vertex array still
   * referencing the old buffer would draw from freed storage.
   */
  readonly cornerBuffer: GlBuffer;

  /** Floats the instance buffer was allocated for — the system's capacity × 8. */
  readonly capacityFloats: number;
}

/**
 * Per-context store of particle vertex arrays and instance buffers (§61, §64
 * stage 7).
 *
 * One cache belongs to one GL context, like `GeometryCache` and `TextureCache`:
 * the renderer builds it during `initialize` and builds a *new* one on context
 * restore, since every handle the old one held died with the context.
 *
 * ```ts
 * const record = cache.acquire(item, geometryRecord.positionBuffer);
 * if (record !== null) {
 *   cache.upload(record, item);
 *   gl.bindVertexArray(record.vertexArray);
 *   gl.drawArraysInstanced(mode, 0, 6, item.count);
 * }
 * ```
 *
 * ## Eviction (decision, WP-9.3 — the policy `gl-geometry.ts` sets)
 *
 * Records are keyed by the emitting node's id and rebuilt lazily, on the next
 * `acquire`, whenever the instance array's capacity or the shared corner buffer
 * has changed. There is no background sweep and no finalization hook, so a
 * particle system removed from the scene and never submitted again keeps its
 * vertex array until the renderer is disposed — the same documented leak window
 * `GeometryCache` carries, for the same reasons (§83 puts resource ownership on
 * whoever created the object; a renderer that is done with a scene disposes).
 */
export class ParticleBatchCache {
  readonly #gl: ParticleGlContext;

  /** Records by `ParticleRenderItem.id`. */
  readonly #records = new Map<string, ParticleBatchRecord>();

  #disposed = false;

  constructor(gl: ParticleGlContext) {
    this.#gl = gl;
  }

  /** Number of particle systems currently holding GPU buffers (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link ParticleBatchCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the vertex array for `item`, creating it on first use and
   * re-creating it when the system's capacity or the shared `cornerBuffer` has
   * changed.
   *
   * Returns `null` — and creates no entry — when the system has no capacity at
   * all or when GL refuses to allocate an object. **Never throws**: this runs
   * inside `Renderer.render`, where §61 forbids it (see `GeometryCache.acquire`
   * for the whole argument).
   */
  acquire(
    item: ParticleRenderItem,
    cornerBuffer: GlBuffer,
  ): ParticleBatchRecord | null {
    const capacityFloats = item.instances.length;
    const existing = this.#records.get(item.id);
    if (existing !== undefined) {
      if (
        existing.capacityFloats === capacityFloats &&
        existing.cornerBuffer === cornerBuffer
      ) {
        return existing;
      }
      this.#deleteRecord(existing);
      this.#records.delete(item.id);
    }

    if (capacityFloats === 0) {
      return null;
    }

    const record = this.#create(item.instances, cornerBuffer);
    if (record === null) {
      return null;
    }
    this.#records.set(item.id, record);
    return record;
  }

  /**
   * Uploads `item`'s live instances into `record`'s buffer — the frame's only
   * particle traffic, `count × 32` bytes.
   *
   * The five-argument `bufferSubData` is what keeps this allocation-free: the
   * three-argument form would need `instances.subarray(0, n)`, i.e. a fresh
   * typed-array view per system per frame (plan D7).
   *
   * A zero-particle system is not uploaded at all: an empty range is a GL call
   * that moves no bytes, and the caller skips the draw anyway.
   */
  upload(record: ParticleBatchRecord, item: ParticleRenderItem): void {
    const floats = item.count * PARTICLE_INSTANCE_FLOATS;
    if (floats === 0) {
      return;
    }
    const gl = this.#gl;
    gl.bindBuffer(GL.ARRAY_BUFFER, record.instanceBuffer);
    gl.bufferSubData(GL.ARRAY_BUFFER, 0, item.instances, 0, floats);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);
  }

  /**
   * Drops every record **without touching the context** — the context-loss path
   * (§61). The handles are already invalid.
   */
  forget(): void {
    this.#records.clear();
  }

  /**
   * Deletes every vertex array and buffer this cache created (§83). Idempotent,
   * and valid only on a live context — the renderer calls
   * {@link ParticleBatchCache.forget} instead when the context is lost.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      this.#deleteRecord(record);
    }
    this.#records.clear();
  }

  /**
   * Builds one vertex array: the shared quad on attribute slot 0 with divisor 0,
   * and the interleaved instance stream on slots 1–3 with divisor 1.
   *
   * The instance buffer is allocated at the system's **full capacity** with
   * `DYNAMIC_DRAW`, once, so a frame never resizes it — the driver keeps one
   * storage allocation and every frame overwrites its live prefix.
   *
   * `ARRAY_BUFFER` is cleared after the vertex array is unbound: the attribute
   * bindings are captured by `vertexAttribPointer` into the vertex array, but
   * the `ARRAY_BUFFER` binding itself is global state this method must not
   * leave dirty (the ordering rule `gl-geometry.ts` documents).
   */
  #create(
    instances: Float32Array,
    cornerBuffer: GlBuffer,
  ): ParticleBatchRecord | null {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) {
      return null;
    }
    const instanceBuffer = gl.createBuffer();
    if (instanceBuffer === null) {
      gl.deleteVertexArray(vertexArray);
      return null;
    }

    const locations = PARTICLE_ATTRIBUTE_LOCATIONS;
    gl.bindVertexArray(vertexArray);

    gl.bindBuffer(GL.ARRAY_BUFFER, cornerBuffer);
    gl.enableVertexAttribArray(locations.corner);
    gl.vertexAttribPointer(locations.corner, 3, GL.FLOAT, false, 0, 0);

    gl.bindBuffer(GL.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(GL.ARRAY_BUFFER, instances, PARTICLE_GL.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(locations.instancePosition);
    gl.vertexAttribPointer(
      locations.instancePosition,
      3,
      GL.FLOAT,
      false,
      INSTANCE_STRIDE_BYTES,
      PARTICLE_POSITION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(locations.instancePosition, 1);

    gl.enableVertexAttribArray(locations.instanceSize);
    gl.vertexAttribPointer(
      locations.instanceSize,
      1,
      GL.FLOAT,
      false,
      INSTANCE_STRIDE_BYTES,
      PARTICLE_SIZE_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(locations.instanceSize, 1);

    gl.enableVertexAttribArray(locations.instanceColor);
    gl.vertexAttribPointer(
      locations.instanceColor,
      4,
      GL.FLOAT,
      false,
      INSTANCE_STRIDE_BYTES,
      PARTICLE_COLOR_OFFSET * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(locations.instanceColor, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(GL.ARRAY_BUFFER, null);

    return {
      vertexArray,
      instanceBuffer,
      cornerBuffer,
      capacityFloats: instances.length,
    };
  }

  /** Deletes one record's GL objects. Live context only. */
  #deleteRecord(record: ParticleBatchRecord): void {
    const gl = this.#gl;
    gl.deleteVertexArray(record.vertexArray);
    gl.deleteBuffer(record.instanceBuffer);
  }
}
