/**
 * The full-screen effect pipeline for the WebGL 2 backend — §70's blit and
 * colour grade, one program (R-6, 2026-08-07).
 *
 * The fifth and smallest of this backend's pipelines, and the only one that
 * draws **no geometry**: a full-screen triangle generated from `gl_VertexID`
 * with no vertex buffer, no vertex array, and no attributes at all. What it
 * samples is a render target's colour attachment, which `gl-render-target.ts`
 * already allocates and caches; what it writes is another target, or the
 * drawing buffer. `@four/render`'s `effect-pass.ts` owns the *policy* — which
 * of §70's ten effects this tier ships, and what each staged one is waiting on
 * — and this module owns the GL.
 *
 * ```ts
 * const program = EffectProgram.create(gl);
 * program.use();
 * program.setSampler(EFFECT_TEXTURE_UNIT);   // once per program lifetime
 * program.setGrade(1.2, 1, 0.8);             // or program.setCopy()
 * gl.drawArrays(GL.TRIANGLES, 0, EFFECT_VERTEX_COUNT);
 * ```
 *
 * ## Why a triangle and not a quad
 *
 * A single oversized triangle covers the viewport with no diagonal seam, no
 * index buffer, and no vertex data — the standard full-screen idiom. Deriving
 * its three corners from `gl_VertexID` rather than from a buffer is what keeps
 * this pipeline's cost at *one program*: no geometry to allocate, nothing to
 * evict on context loss beyond the program itself, and no interaction with
 * `gl-geometry.ts`'s vertex-array cache — so an application that never runs an
 * effect pays for this file exactly one compiled program at initialization and
 * not a byte of per-frame work.
 *
 * ## One program, one uniform switch (the R-19 argument, applied again)
 *
 * `useGrade` is a **uniform, not a `#define`d variant**, for the reason
 * `gl-program.ts`'s `FRAGMENT_SHADER_SOURCE` gives in full: a variant set means
 * another program compiled at initialization for every effect, or a lazy
 * compile inside a frame, which §61 forbids throwing from. And it buys the
 * property that matters here — the mirror starts at GL's own initial `0`, so a
 * **copy uploads nothing at all** beyond the one-time sampler, and with
 * `useGrade` off the fragment stage assigns the sampled texel to the output
 * with no arithmetic in between. That is what makes {@link CopyEffect} the
 * bit-exact blit its documentation promises.
 */

import type { Disposable } from "@four/core";

import {
  createLinkedProgram,
  requireUniform,
  type GlProgramHandle,
  type GlUniformLocation,
  type WebglContext,
} from "./gl-program.js";

/**
 * The texture unit an effect samples its source from.
 *
 * Unit 0, like every other pipeline in this tier — an effect binds exactly one
 * texture, and §77's multi-texture materials are what will need a unit
 * allocator. Naming it keeps the `activeTexture` call in `webgl-renderer.ts`
 * and the sampler upload here from drifting apart.
 */
export const EFFECT_TEXTURE_UNIT = 0;

/** Vertices in the full-screen triangle; see the module header. */
export const EFFECT_VERTEX_COUNT = 3;

/**
 * The full-screen-triangle vertex stage: three clip-space corners and their uv,
 * from `gl_VertexID` alone.
 *
 * ```text
 * id 0 -> uv (0, 0) -> clip (-1, -1)
 * id 1 -> uv (2, 0) -> clip ( 3, -1)
 * id 2 -> uv (0, 2) -> clip (-1,  3)
 * ```
 *
 * The triangle overhangs the viewport on two sides; the visible part of it is
 * the whole surface, with uv running `0..1` across exactly that part. `v = 0`
 * is the **bottom** edge — matching §7a's Y-up world, the sprite pipeline's
 * uv derivation, and the bottom-row-first texel order a render target's colour
 * attachment is allocated in — so a copy needs no flip anywhere and is an exact
 * identity rather than a mirror image.
 */
const EFFECT_VERTEX_SHADER_SOURCE = `#version 300 es
out vec2 vUv;

void main() {
  vUv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * The effect fragment stage: one texture sample, optionally graded (§70).
 *
 * With `useGrade` off, `fragColor` is the sampled texel with nothing done to
 * it — the bit-exact copy §70's blit and §63's on-screen debug view both need.
 * With it on, the three operations run in the order `ColorGradeEffect`
 * documents (exposure, then contrast about a linear `0.5` pivot, then
 * saturation towards the Rec. 709 linear luma), on straight, linear-light RGB
 * (§60a), and **alpha is carried through untouched** so an effect over a
 * transparent background composites afterwards exactly as its source would
 * have.
 *
 * Nothing is clamped here: `rgba8` saturates on write, and the float targets
 * R-4 staged will not — clamping in the shader would silently make the two
 * behave the same and hide the difference the format was chosen for.
 */
const EFFECT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D source;
uniform bool useGrade;
uniform vec3 grade;

in vec2 vUv;

out vec4 fragColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 texel = texture(source, vUv);
  if (useGrade) {
    vec3 color = texel.rgb * grade.x;
    color = (color - 0.5) * grade.y + 0.5;
    color = mix(vec3(dot(color, LUMA)), color, grade.z);
    texel = vec4(color, texel.a);
  }
  fragColor = texel;
}
`;

/** Scratch for the `grade` upload; one per module, exactly like `matrixScratch`. */
const gradeScratch = new Float32Array(3);

/**
 * §70's full-screen effect pipeline (R-6) — see the module header.
 *
 * Owns its GL program and nothing else: the texture it samples belongs to
 * `gl-render-target.ts`'s cache, and the renderer re-creates this program on
 * context restore exactly as it re-creates the other four (§61).
 */
export class EffectProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #sourceLocation: GlUniformLocation;

  readonly #useGradeLocation: GlUniformLocation;

  readonly #gradeLocation: GlUniformLocation;

  /**
   * CPU mirror of the grade switch and its coefficients, seeded with GL's own
   * initial values for a `bool` and a `vec3` uniform — `false` and
   * `(0, 0, 0)`. Because the mirror starts where GL starts, a chain of copies
   * issues no `uniform` call at all, and a steady-state graded chain issues one
   * per program lifetime rather than one per frame.
   *
   * Uniform values live in the program object, so the mirror stays accurate
   * across pipeline switches and frames; a context loss builds a new program
   * and therefore a new mirror.
   */
  #useGrade = false;

  readonly #grade = new Float32Array(3);

  /** Whether the sampler unit has been uploaded — see {@link setSampler}. */
  #samplerUploaded = false;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    sourceLocation: GlUniformLocation,
    useGradeLocation: GlUniformLocation,
    gradeLocation: GlUniformLocation,
  ) {
    this.#gl = gl;
    this.#program = program;
    this.#sourceLocation = sourceLocation;
    this.#useGradeLocation = useGradeLocation;
    this.#gradeLocation = gradeLocation;
  }

  /**
   * Compiles and links the effect program on `gl`.
   *
   * Fails exactly as `UnlitProgram.create` does — see it, and
   * `createLinkedProgram`, for the contract; the messages name `"effect"` and
   * the §89 code is the same `SHADER_COMPILATION_FAILED`.
   */
  static create(gl: WebglContext): EffectProgram {
    const program = createLinkedProgram(
      gl,
      "effect",
      EFFECT_VERTEX_SHADER_SOURCE,
      EFFECT_FRAGMENT_SHADER_SOURCE,
    );
    try {
      return new EffectProgram(
        gl,
        program,
        requireUniform(gl, program, "source", "effect"),
        requireUniform(gl, program, "useGrade", "effect"),
        requireUniform(gl, program, "grade", "effect"),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link EffectProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Points the `source` sampler at texture `unit`, **once per program
   * lifetime**.
   *
   * `glUniform1i` writes into the currently bound program, so this cannot
   * happen at creation time without putting the renderer's program state in two
   * places (the argument `SpriteProgram.setSampler` records). GL's initial
   * sampler value is already {@link EFFECT_TEXTURE_UNIT}, so the upload is belt
   * and braces — it costs one call in the lifetime of the program and nothing
   * per frame, which is what keeps a chain of copies free of uniform traffic.
   */
  setSampler(unit: number): void {
    if (this.#samplerUploaded) {
      return;
    }
    this.#gl.uniform1i(this.#sourceLocation, unit);
    this.#samplerUploaded = true;
  }

  /**
   * Selects the plain copy for the draw about to be issued — §70's blit.
   *
   * Issues a `uniform1i` only if a *grade* preceded it, so a program that has
   * only ever copied has never uploaded this uniform and the fragment stage
   * runs its no-arithmetic path.
   */
  setCopy(): void {
    if (this.#useGrade) {
      this.#gl.uniform1i(this.#useGradeLocation, 0);
      this.#useGrade = false;
    }
  }

  /**
   * Selects §70's colour grade with the three coefficients
   * `ColorGradeEffect` documents, in that order.
   *
   * Issues a GL call only where the draw changes something: the switch when it
   * was off, the coefficients when any of the three moved. A chain that grades
   * with the same numbers every frame therefore uploads them once.
   */
  setGrade(exposure: number, contrast: number, saturation: number): void {
    if (!this.#useGrade) {
      this.#gl.uniform1i(this.#useGradeLocation, 1);
      this.#useGrade = true;
    }
    const mirror = this.#grade;
    if (
      mirror[0] === exposure &&
      mirror[1] === contrast &&
      mirror[2] === saturation
    ) {
      return;
    }
    mirror[0] = exposure;
    mirror[1] = contrast;
    mirror[2] = saturation;
    gradeScratch[0] = exposure;
    gradeScratch[1] = contrast;
    gradeScratch[2] = saturation;
    this.#gl.uniform3fv(this.#gradeLocation, gradeScratch);
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — see `UnlitProgram.dispose`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}
