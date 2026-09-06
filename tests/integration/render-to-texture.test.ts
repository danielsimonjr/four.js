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
import { GL, WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

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
  // §87 (R-8, 2026-08-09; tests typecheck gate, 2026-08-21): this said
  // `{ height: 4, aspect: 1 }` — two fields `OrthographicCameraOptions` does
  // not have, so the object was accepted and every property ignored, leaving
  // the default unit box `[-1, 1]²`. The box below is the 4 × 4 view the
  // harness always meant.
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
  });
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
    // Tests typecheck gate (2026-08-21): this said `{ size: [1, 1] }`, a field
    // `SpriteOptions` does not have — silently ignored, so the sprite took the
    // default `width`/`height` of 1. Spelled as the two fields that exist, the
    // sprite is the same 1 × 1 quad it has always been.
    test.scene.add(new Sprite(material, { width: 1, height: 1 }));

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
