import { FourError } from "@fourjs/core";
import type { ShaderUniformReflection } from "@fourjs/render";
import type { GlBuffer, GlProgramHandle, WebglContext } from "./gl-program.js";

const UNIFORM_BUFFER = 0x8a11;
const DYNAMIC_DRAW = 0x88e8;
/** Reserved node-material block binding; unrelated fixed programs use no UBOs. */
const BLOCK_BINDING = 0;

/**
 * Opt-in std140 transport. Scalars and vectors occupy one vec4 lane; matrices
 * occupy four, matching the WebGPU node transport and avoiding vec3 packing
 * ambiguities. A material draw uploads the entire block once.
 */
export class GlNodeUniformBlock {
  readonly byteLength: number;
  readonly #gl: WebglContext;
  readonly #buffer: GlBuffer;
  readonly #data: Float32Array;
  readonly #slots = new Map<
    string,
    { offset: number; type: ShaderUniformReflection["type"] }
  >();

  constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    uniforms: readonly ShaderUniformReflection[],
  ) {
    if (
      gl.getUniformBlockIndex === undefined ||
      gl.uniformBlockBinding === undefined ||
      gl.bindBufferBase === undefined
    ) {
      throw new FourError(
        "SHADER_COMPILATION_FAILED",
        "Node std140 transport requires WebGL 2 uniform-block entry points.",
      );
    }
    const block = gl.getUniformBlockIndex(program, "FourNodeUniforms");
    if (block === 0xffffffff) {
      throw new FourError(
        "SHADER_COMPILATION_FAILED",
        "Node std140 uniform block is missing from the linked program.",
      );
    }
    let floats = 0;
    for (const uniform of uniforms) {
      this.#slots.set(uniform.name, { offset: floats, type: uniform.type });
      floats += uniform.type === "mat3" || uniform.type === "mat4" ? 16 : 4;
    }
    this.#data = new Float32Array(floats);
    this.byteLength = this.#data.byteLength;
    const buffer = gl.createBuffer();
    if (buffer === null)
      throw new FourError(
        "SHADER_COMPILATION_FAILED",
        "Failed to allocate node std140 uniform buffer.",
      );
    this.#gl = gl;
    this.#buffer = buffer;
    try {
      gl.uniformBlockBinding(program, block, BLOCK_BINDING);
      this.upload();
    } catch (error: unknown) {
      gl.deleteBuffer(buffer);
      throw error;
    }
  }

  /** Writes a logical value to its padded lane; unknown names are ignored. */
  set(name: string, value: ArrayLike<number>): boolean {
    const slot = this.#slots.get(name);
    if (slot === undefined) return false;
    const { offset, type } = slot;
    if (type === "mat3") {
      for (let column = 0; column < 3; column += 1) {
        for (let row = 0; row < 3; row += 1) {
          this.#data[offset + column * 4 + row] = value[column * 3 + row];
        }
      }
      this.#data[offset + 15] = 1;
    } else {
      const count =
        type === "float"
          ? 1
          : type === "vec2"
            ? 2
            : type === "vec3"
              ? 3
              : type === "vec4"
                ? 4
                : 16;
      for (let index = 0; index < count; index += 1)
        this.#data[offset + index] = value[index];
    }
    return true;
  }

  /** Bind explicitly on every use: another node program may own binding 0. */
  bind(): void {
    this.#gl.bindBufferBase!(UNIFORM_BUFFER, BLOCK_BINDING, this.#buffer);
  }

  upload(): void {
    this.#gl.bindBuffer(UNIFORM_BUFFER, this.#buffer);
    this.#gl.bufferData(UNIFORM_BUFFER, this.#data, DYNAMIC_DRAW);
    this.bind();
  }

  dispose(): void {
    this.#gl.deleteBuffer(this.#buffer);
  }
}
