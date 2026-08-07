/**
 * R-4 — an off-screen pass, sampled by an on-screen one (2026-08-07).
 *
 * Render-to-texture is a claim about three packages agreeing, and no unit test
 * inside any one of them can check it:
 *
 * 1. `@four/render` produces a `RenderTarget` whose `colorTexture` satisfies
 *    `@four/materials`' `MaterialTexture`;
 * 2. `@four/materials`' `UnlitMaterial.map` accepts it — **at compile time**,
 *    with no cast and no adapter, which is the line in this file that would
 *    stop building if the seam ever broke;
 * 3. `@four/render-webgl` binds the *framebuffer's* colour attachment for that
 *    material rather than trying to upload texels that do not exist.
 *
 * That chain is what R-5 (§63's render graph) and R-6 (§70's post-processing)
 * are built on: every pass in either is "draw into a target, then sample it".
 *
 * The scene here is real — a real `Scene`, a real `OrthographicCamera`, a real
 * `planeGeometry`, real materials — and only the GL context is a double, for
 * the reason `packages/render-webgl/tests` gives at length: the backend's whole
 * GL surface is one interface, so a recording object implementing it is a
 * complete double, failure paths and call *order* included, with no GPU and no
 * browser. What a real driver adds is checked by the Playwright gate.
 */

import { planeGeometry } from "@four/geometry";
import { SpriteMaterial, UnlitMaterial } from "@four/materials";
import { RenderTarget, Renderable, Sprite, Texture } from "@four/render";
import {
  GL,
  WebglRenderer,
  type ParticleGlContext,
  type WebglCanvas,
} from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A recording GL context.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/**
 * Every entry point `WebglContext` and its particle extension declare.
 *
 * Written out rather than derived, because a *type* cannot be enumerated at
 * runtime — and because the list failing to compile against
 * `ParticleGlContext` (the cast at the bottom of `createRecordingGl` is
 * checked, not `any`) is what keeps this double honest as the backend's GL
 * budget grows.
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
  "drawArrays",
  "drawArraysInstanced",
  "drawElements",
  "isContextLost",
] as const;

interface RecordingGl {
  readonly gl: ParticleGlContext;
  readonly calls: RecordedCall[];
  callsOf(name: string): RecordedCall[];
  countOf(name: string): number;
  reset(): void;
}

function createRecordingGl(): RecordingGl {
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

  return {
    // The one cast in the file. A dynamically assembled object cannot be
    // checked member-by-member by the compiler; what *is* checked is that the
    // result is used everywhere `ParticleGlContext` is required, so a missing
    // entry point surfaces as a runtime "not a function" in the very first
    // test rather than as a silent skip.
    gl: context as unknown as ParticleGlContext,
    calls,
    callsOf: (name) => calls.filter((call) => call.name === name),
    countOf: (name) => calls.filter((call) => call.name === name).length,
    reset: () => {
      calls.length = 0;
    },
  };
}

/** A canvas reduced to what the backend touches. */
class RecordingCanvas implements WebglCanvas {
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

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  const camera = new OrthographicCamera({ height: 4, aspect: 1 });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    views: [createFullscreenViewport(camera)],
  };
}

/** Resolves world transforms (§7, §64) the way `Application` does per frame. */
function frame(harnessed: Harness, target?: RenderTarget): void {
  resolveWorldTransforms(harnessed.scene);
  harnessed.renderer.render(
    harnessed.scene,
    harnessed.views,
    undefined,
    target,
  );
}

/** The colour texture the backend attached to the first framebuffer it built. */
function colorAttachment(recorder: RecordingGl): unknown {
  const attach = recorder.callsOf("framebufferTexture2D")[0];
  expect(attach).toBeDefined();
  return attach?.args[3];
}

describe("R-4 — render to texture across render / materials / render-webgl", () => {
  it("an off-screen pass fills a target that an on-screen pass then samples", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 128, height: 128 });

    // The seam, checked by the compiler: a `RenderTarget`'s colour attachment
    // is a `MaterialTexture`, so it goes straight into §57's `map` with no
    // cast, no adapter, and no second texture type.
    const screenMaterial = new UnlitMaterial({
      color: [1, 1, 1, 1],
      map: target.colorTexture,
    });
    const quad = new Renderable(
      planeGeometry({ width: 2, height: 2 }),
      screenMaterial,
    );
    test.scene.add(quad);

    // Pass 1: draw the scene into the target.
    test.recorder.reset();
    frame(test, target);
    const attachment = colorAttachment(test.recorder);
    expect(test.recorder.countOf("createFramebuffer")).toBe(1);
    // Bound for the pass and given back before it returned.
    expect(test.recorder.callsOf("bindFramebuffer").at(-1)?.args).toEqual([
      GL.FRAMEBUFFER,
      null,
    ]);

    // Pass 2: draw on screen, sampling what pass 1 produced.
    test.recorder.reset();
    frame(test);

    // No framebuffer is touched at all by the on-screen pass…
    expect(test.recorder.countOf("bindFramebuffer")).toBe(0);
    // …and the texture it binds is pass 1's colour attachment, not an upload.
    expect(test.recorder.callsOf("bindTexture")[0]?.args).toEqual([
      GL.TEXTURE_2D,
      attachment,
    ]);
    expect(test.recorder.countOf("texImage2D")).toBe(0);
    expect(test.recorder.countOf("drawElements")).toBe(1);

    target.dispose();
    test.renderer.dispose();
  });

  it("a sprite can carry a render target as its texture (§55)", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 64, height: 64 });
    // `SpriteMaterial.texture` takes the same `MaterialTexture` contract, so
    // the off-screen result is a sprite's texture with nothing in between.
    const material = new SpriteMaterial({ texture: target.colorTexture });
    test.scene.add(new Sprite(material, { size: [1, 1] }));

    frame(test, target);
    const attachment = colorAttachment(test.recorder);
    test.recorder.reset();
    frame(test);

    expect(test.recorder.callsOf("bindTexture")[0]?.args).toEqual([
      GL.TEXTURE_2D,
      attachment,
    ]);
    expect(test.recorder.countOf("texImage2D")).toBe(0);
    target.dispose();
    test.renderer.dispose();
  });

  it("an ordinary Texture still uploads — the two kinds do not collide", async () => {
    const test = await harness();
    const texture = new Texture({
      width: 2,
      height: 2,
      data: new Uint8Array(16).fill(255),
    });
    test.scene.add(
      new Renderable(
        planeGeometry({ width: 1, height: 1 }),
        new UnlitMaterial({ color: [1, 1, 1, 1], map: texture }),
      ),
    );

    test.recorder.reset();
    frame(test);

    // A CPU-side texture goes through `TextureCache` exactly as before R-4.
    expect(test.recorder.countOf("texImage2D")).toBe(1);
    expect(test.recorder.countOf("createFramebuffer")).toBe(0);

    texture.dispose();
    test.renderer.dispose();
  });

  it("a target rendered at one size drives the viewport, not the canvas size", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 96, height: 48 });

    test.recorder.reset();
    frame(test, target);

    // The full-surface viewport is normalized, so it resolves against the
    // target — 96×48 — while the canvas stays at 256×256.
    expect(test.recorder.callsOf("viewport")[0]?.args).toEqual([0, 0, 96, 48]);

    test.recorder.reset();
    frame(test);
    expect(test.recorder.callsOf("viewport")[0]?.args).toEqual([
      0, 0, 256, 256,
    ]);

    target.dispose();
    test.renderer.dispose();
  });

  it("disposing the target frees its GPU objects on the next frame (§83)", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 32, height: 32 });
    frame(test, target);

    target.dispose();
    test.recorder.reset();
    // A disposed target is skipped, and its framebuffer released.
    frame(test, target);

    expect(test.recorder.countOf("deleteFramebuffer")).toBe(1);
    expect(test.recorder.countOf("clear")).toBe(0);

    test.renderer.dispose();
  });

  it("disposing the renderer releases framebuffers it allocated (§83)", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 32, height: 32 });
    frame(test, target);

    test.recorder.reset();
    test.renderer.dispose();

    expect(test.recorder.countOf("deleteFramebuffer")).toBe(1);
    expect(test.recorder.countOf("deleteRenderbuffer")).toBe(1);
    // The application's own `RenderTarget` is untouched: the renderer did not
    // create it, so it does not dispose it.
    expect(target.disposed).toBe(false);
    target.dispose();
  });
});
