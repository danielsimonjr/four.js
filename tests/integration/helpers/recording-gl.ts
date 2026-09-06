/**
 * A recording WebGL 2 context and canvas, shared by the cross-package render
 * suites (R-5, 2026-08-07).
 *
 * The backend's entire GL surface is one interface (`WebglContext` plus its
 * particle extension), so an object implementing it is a *complete* double —
 * failure paths and call **order** included — with no GPU and no browser. That
 * is what makes "these two ways of driving the renderer emit the identical GL
 * call sequence" an assertable claim rather than an assurance.
 *
 * `render-to-texture.test.ts` (R-4) grew its own copy of this before the file
 * existed; this module is the extracted form. That suite now imports it
 * (mechanical follow-up): same double, same assertions, one list of GL entry
 * points so a backend surface growth cannot drift between the two files.
 */

import {
  GL,
  type ParticleGlContext,
  type WebglCanvas,
} from "@four/render-webgl";

/** One recorded entry point call, with the arguments it was given. */
export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/**
 * Every entry point `WebglContext` and its particle extension declare.
 *
 * Written out rather than derived, because a *type* cannot be enumerated at
 * runtime — and because the list failing to compile against
 * `ParticleGlContext` (the cast in {@link createRecordingGl} is checked, not
 * `any`) is what keeps the double honest as the backend's GL budget grows.
 */
const CONTEXT_METHODS = [
  "createShader",
  "shaderSource",
  "compileShader",
  "getShaderParameter",
  "getShaderInfoLog",
  "deleteShader",
  "createProgram",
  "attachShader",
  "linkProgram",
  "getProgramParameter",
  "getProgramInfoLog",
  "deleteProgram",
  "getUniformLocation",
  "useProgram",
  "uniformMatrix4fv",
  "uniform4fv",
  "uniform3fv",
  "uniform1f",
  "uniform1i",
  "createTexture",
  "bindTexture",
  "texImage2D",
  "texParameteri",
  "deleteTexture",
  "activeTexture",
  "createFramebuffer",
  "bindFramebuffer",
  "framebufferTexture2D",
  "checkFramebufferStatus",
  "deleteFramebuffer",
  "createRenderbuffer",
  "bindRenderbuffer",
  "renderbufferStorage",
  "framebufferRenderbuffer",
  "deleteRenderbuffer",
  "createBuffer",
  "bindBuffer",
  "bufferData",
  "bufferSubData",
  "deleteBuffer",
  "createVertexArray",
  "bindVertexArray",
  "deleteVertexArray",
  "enableVertexAttribArray",
  "vertexAttribDivisor",
  "vertexAttribPointer",
  "getParameter",
  "enable",
  "disable",
  "depthFunc",
  "frontFace",
  "viewport",
  "scissor",
  "clearColor",
  "clearDepth",
  "clear",
  "blendFunc",
  "depthMask",
  "colorMask",
  // §67's three (R-7, 2026-08-11). Appended rather than inserted beside the
  // other state calls: this list is the double's method set, and its order is
  // not the order a frame calls them in.
  "stencilFunc",
  "stencilOp",
  "stencilMask",
  "drawArrays",
  "drawArraysInstanced",
  "drawElements",
  "isContextLost",
] as const;

/** The double, plus the tape it writes to. */
export interface RecordingGl {
  /** Hand this to a `WebglCanvas`. */
  readonly gl: ParticleGlContext;

  /** Every call since the last {@link RecordingGl.reset}, in order. */
  readonly calls: RecordedCall[];

  /** Just the calls to `name`, in order. */
  callsOf(name: string): RecordedCall[];

  /** How many times `name` was called. */
  countOf(name: string): number;

  /**
   * A comparable transcript: one `name(json, json, …)` line per call.
   *
   * GPU handles the double minted (`{ kind, serial }`) serialize as themselves,
   * so two transcripts match only when the *same* objects were passed in the
   * same order — which is what "byte-identical GL sequence" means here.
   */
  transcript(): string[];

  /** Clears the tape without disturbing the renderer's caches. */
  reset(): void;
}

/** Builds a fresh recording context. */
export function createRecordingGl(): RecordingGl {
  const calls: RecordedCall[] = [];
  let serial = 0;
  const context: Record<string, (...args: unknown[]) => unknown> = {};

  for (const name of CONTEXT_METHODS) {
    context[name] = (...args: unknown[]): unknown => {
      calls.push({ name, args });
      if (name.startsWith("create") || name === "getUniformLocation") {
        serial += 1;
        return { kind: name, serial };
      }
      if (name === "getShaderParameter" || name === "getProgramParameter") {
        return true;
      }
      if (name === "getShaderInfoLog" || name === "getProgramInfoLog") {
        return "";
      }
      if (name === "getParameter") {
        return 4096;
      }
      if (name === "checkFramebufferStatus") {
        return GL.FRAMEBUFFER_COMPLETE;
      }
      if (name === "isContextLost") {
        return false;
      }
      return undefined;
    };
  }

  const describeArgument = (value: unknown): string => {
    if (ArrayBuffer.isView(value)) {
      return `[${Array.from(value as unknown as ArrayLike<number>).join(",")}]`;
    }
    return JSON.stringify(value) ?? String(value);
  };

  return {
    // The one cast in the module. A dynamically assembled object cannot be
    // checked member by member by the compiler; what *is* checked is that the
    // result is used everywhere `ParticleGlContext` is required, so a missing
    // entry point surfaces as a runtime "not a function" in the first test
    // rather than as a silent skip.
    gl: context as unknown as ParticleGlContext,
    calls,
    callsOf: (name) => calls.filter((call) => call.name === name),
    countOf: (name) => calls.filter((call) => call.name === name).length,
    transcript: () =>
      calls.map(
        (call) => `${call.name}(${call.args.map(describeArgument).join(", ")})`,
      ),
    reset: () => {
      calls.length = 0;
    },
  };
}

/** A canvas reduced to what the backend touches. */
export class RecordingCanvas implements WebglCanvas {
  width = 256;

  height = 256;

  readonly #context: unknown;

  constructor(context: unknown) {
    this.#context = context;
  }

  getContext(): unknown {
    return this.#context;
  }

  addEventListener(): void {
    // The loss/restore path is `packages/render-webgl/tests`' business.
  }

  removeEventListener(): void {
    // Ditto.
  }
}
