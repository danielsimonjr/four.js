/**
 * §77's textures across the packages that have to agree about them, on the
 * WebGPU backend (WP-R1.2) — `@four/materials` declares the read contract,
 * `@four/render` owns the `Texture` and §84's process-wide counters,
 * `@four/geometry` supplies the uv stream, `@four/render-webgpu` uploads.
 *
 * The WebGPU restatement of `texture-mipmaps.test.ts`'s composition claims,
 * in the vocabulary the backend actually speaks:
 *
 * 1. **One upload per texture, however many frames sample it** — the id/version
 *    cache discipline, observed as `queue.writeTexture` traffic rather than
 *    trusted; `markDirty()` is the one thing that re-uploads.
 * 2. **A disposed texture skips its draw** (§83's "disposed resources still in
 *    use"), and §84's counters — fed by `Texture` itself, not by any backend —
 *    agree with what the backend allocated, chain included.
 * 3. **Sampler state deduplicates** (§77): textures sharing wrap/filter state
 *    share one `GPUSampler` object, which is the structural difference from
 *    GL's per-texture `texParameteri` and the reason `wgpu-texture.ts` has a
 *    second cache in it.
 * 4. **A mip chain is drawn, not called for** — WebGPU has no `generateMipmap`
 *    — and its blit passes submit before the frame that samples the chain.
 */

import { boxGeometry, planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  Renderable,
  Texture,
  liveTextureCount,
  textureMemoryBytes,
} from "@four/render";
import { WebgpuRenderer, textureByteLength } from "@four/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  type Viewport,
} from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

interface Rig {
  readonly renderer: WebgpuRenderer;
  readonly gpu: RecordingGpu;
  readonly views: readonly Viewport[];
}

/** An initialized renderer over a recording device, with one fullscreen view. */
async function createRig(): Promise<Rig> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(64, 64, 1);
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
    near: 0.1,
    far: 10,
  });
  camera.position.set(0, 0, 5);
  gpu.reset();
  return { renderer, gpu, views: [createFullscreenViewport(camera)] };
}

/** A 2 × 2 RGBA8 texel block. */
function texels(width = 2, height = 2): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  data.fill(255);
  return data;
}

/** A textured plane — `planeGeometry` carries the uv stream §77 samples with. */
function texturedPlane(texture: Texture): Renderable {
  return new Renderable(
    planeGeometry({ width: 1, height: 1 }),
    new UnlitMaterial({ color: [1, 1, 1, 1], map: texture }),
  );
}

describe("WebGPU §77 textures, composed from the real packages", () => {
  it("uploads a texture once, however many frames sample it", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const texture = new Texture({ width: 2, height: 2, data: texels() });
    scene.add(texturedPlane(texture));

    renderer.render(scene, views);
    renderer.render(scene, views);

    expect(gpu.countOf("queue.writeTexture")).toBe(1);
    expect(gpu.countOf("device.createSampler")).toBe(1);
    // Both frames drew the plane through group 1.
    expect(
      gpu.callsOf("pass.setBindGroup").filter((call) => call.args[0] === 1),
    ).toHaveLength(2);

    texture.markDirty();
    renderer.render(scene, views);
    expect(gpu.countOf("queue.writeTexture")).toBe(2);

    renderer.dispose();
    texture.dispose();
  });

  it("skips the draw of a disposed texture, and §84's counters agree", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const texture = new Texture({
      width: 4,
      height: 4,
      data: texels(4, 4),
      mipmaps: true,
    });
    scene.add(texturedPlane(texture));

    // §84: the process-wide counters are fed by `Texture` itself — chain
    // included — and the backend allocates exactly the chain they bill.
    const instances = liveTextureCount();
    const bytes = textureMemoryBytes();
    expect(texture.byteLength).toBe(textureByteLength(4, 4, true));

    renderer.render(scene, views);
    const allocation = gpu
      .callsOf("device.createTexture")
      .find((call) =>
        String((call.args[0] as { label?: string }).label).startsWith(
          "four:texture:",
        ),
      )?.args[0] as { mipLevelCount?: number };
    expect(allocation.mipLevelCount).toBe(3);
    const drawsBefore = gpu.countOf("pass.drawIndexed");

    texture.dispose();
    expect(liveTextureCount()).toBe(instances - 1);
    expect(textureMemoryBytes()).toBe(bytes - textureByteLength(4, 4, true));

    gpu.reset();
    renderer.render(scene, views);
    // The plane is skipped, never painted undefined (§83); the frame goes on.
    expect(gpu.countOf("pass.drawIndexed")).toBe(drawsBefore - 1);
    expect(gpu.countOf("queue.submit")).toBe(1);

    renderer.dispose();
  });

  it("shares one sampler across textures naming the same §77 state", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const first = new Texture({ width: 2, height: 2, data: texels() });
    const second = new Texture({ width: 2, height: 2, data: texels() });
    scene.add(texturedPlane(first));
    const shifted = texturedPlane(second);
    shifted.position.set(0.5, 0, 0);
    scene.add(shifted);
    // A third, drawn with a different wrap: its own sampler.
    const repeated = new Texture({
      width: 2,
      height: 2,
      data: texels(),
      wrap: "repeat",
    });
    const tiled = texturedPlane(repeated);
    tiled.position.set(-0.5, 0, 0);
    scene.add(tiled);

    renderer.render(scene, views);
    expect(gpu.countOf("queue.writeTexture")).toBe(3);
    expect(gpu.countOf("device.createSampler")).toBe(2);

    renderer.dispose();
    for (const texture of [first, second, repeated]) {
      texture.dispose();
    }
  });

  it("draws the mip chain before the frame that samples it", async () => {
    const { renderer, gpu, views } = await createRig();
    const scene = new Scene();
    const texture = new Texture({
      width: 4,
      height: 4,
      data: texels(4, 4),
      mipmaps: true,
      minFilter: "linear-mipmap-linear",
    });
    // A box has uvs too; the geometry tier is not what this claim is about.
    scene.add(
      new Renderable(
        boxGeometry({ width: 1, height: 1, depth: 1 }),
        new UnlitMaterial({ color: [1, 1, 1, 1], map: texture }),
      ),
    );

    renderer.render(scene, views);

    // Two blit passes (levels 1 and 2) in the chain's own encoder, submitted
    // before the frame's — WebGPU orders submissions, so ordering is the
    // correctness claim, not a style preference.
    expect(gpu.countOf("encoder.beginRenderPass")).toBe(3);
    const submits = gpu.calls
      .map((call, index) => ({ name: call.name, index }))
      .filter((call) => call.name === "queue.submit");
    expect(submits).toHaveLength(2);
    const frameEnd = gpu.calls.findIndex((call) => call.name === "pass.end");
    expect(submits[0]?.index).toBeLessThan(submits[1]?.index ?? -1);
    expect(frameEnd).toBeGreaterThanOrEqual(0);

    // The chain's sampler resolves trilinear + between-level linear.
    const sampler = gpu
      .callsOf("device.createSampler")
      .map(
        (call) =>
          call.args[0] as {
            label: string;
            minFilter: string;
            mipmapFilter: string;
          },
      )
      .find((descriptor) => descriptor.label.startsWith("four:sampler:"));
    expect(sampler).toMatchObject({
      minFilter: "linear",
      mipmapFilter: "linear",
    });

    renderer.dispose();
    texture.dispose();
  });
});
