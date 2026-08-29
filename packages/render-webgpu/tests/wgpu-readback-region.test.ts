/**
 * §61's `readPixels` region form (2026-08-29; `Rectangle2` landed, RFC 0005's
 * recorded prerequisite cleared). WP-R1.6's whole-target suite
 * (`wgpu-readback.test.ts`) is untouched next door — this file owns what the
 * region added: the §7a bottom-origin → WebGPU top-first `origin` conversion,
 * the region-sized alignment arithmetic riding the same strip-and-flip
 * machinery, the shared §85 refusals, and the tape-level proof that a
 * whole-target call still records no `origin` member at all (which is what
 * keeps the landed transcripts byte-identical).
 */

import { Rectangle2 } from "@four/math";
import { RenderTarget } from "@four/render";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  WebgpuRenderer,
  readTexturePixels,
  type GpuDevice,
} from "../src/index.js";

describe("readTexturePixels — region form", () => {
  it("copies only the region, converting §7a's bottom origin to WebGPU's top-first origin", async () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const texture = device.createTexture({
      size: [4, 4],
      format: "rgba8unorm",
      usage: 0,
    });
    gpu.reset();

    // §7a: (x=1, y=1) from the bottom-left, 2 × 2 texels. In WebGPU's
    // top-first space that rectangle starts at row 4 - 1 - 2 = 1.
    const pixels = await readTexturePixels(
      device,
      texture,
      4,
      4,
      new Rectangle2(1, 1, 2, 2),
    );

    expect(pixels).not.toBeNull();
    const bytes = Array.from(new Uint8Array(pixels as ArrayBuffer));
    // The double's mapped range is byte i = i % 251 over the 512-byte padded
    // buffer (2 rows × 256). Row 0 of the result is the *bottom* region row —
    // the copy's row 1, at offset 256 — and row 1 is the copy's row 0; each
    // packed row is 2 texels × 4 bytes.
    const expected: number[] = [];
    for (let index = 256; index < 264; index += 1) {
      expected.push(index % 251);
    }
    for (let index = 0; index < 8; index += 1) {
      expected.push(index);
    }
    expect(bytes).toEqual(expected);

    // The copy names the region and nothing more: origin in top-first
    // coordinates, region-sized rows and extent, a region-sized staging
    // buffer (one 256-byte row per region row).
    const copy = gpu.callsOf("encoder.copyTextureToBuffer")[0];
    expect(copy?.args[0]).toMatchObject({ origin: [1, 1] });
    expect(copy?.args[1]).toMatchObject({ bytesPerRow: 256, rowsPerImage: 2 });
    expect(copy?.args[2]).toEqual([2, 2]);
    const allocation = gpu.callsOf("device.createBuffer")[0]?.args[0] as {
      size: number;
    };
    expect(allocation.size).toBe(512);
  });

  it("records no origin member at all for a whole-target read — WP-R1.6's tape, byte-identical", async () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const texture = device.createTexture({
      size: [3, 2],
      format: "rgba8unorm",
      usage: 0,
    });
    gpu.reset();

    await readTexturePixels(device, texture, 3, 2);

    const source = gpu.callsOf("encoder.copyTextureToBuffer")[0]
      ?.args[0] as object;
    expect(Object.keys(source)).toEqual(["texture"]);
  });
});

describe("WebgpuRenderer.readPixels — region form", () => {
  it("reads a region back as region.width * region.height * 4 tightly packed bytes", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    const target = new RenderTarget({ width: 8, height: 4 });

    const pixels = await renderer.readPixels(
      target,
      new Rectangle2(2, 1, 3, 2),
    );
    expect(pixels.byteLength).toBe(3 * 2 * 4);
    const copy = gpu.callsOf("encoder.copyTextureToBuffer")[0];
    expect(copy?.args[0]).toMatchObject({ origin: [2, 1] });
    expect(copy?.args[2]).toEqual([3, 2]);

    renderer.dispose();
    target.dispose();
  });

  it("rejects a malformed region with the shared §85 RangeError, before any copy", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    const target = new RenderTarget({ width: 4, height: 4 });
    gpu.reset();

    await expect(
      renderer.readPixels(target, new Rectangle2(0, 0, 5, 1)),
    ).rejects.toThrow(/does not lie inside the 4 × 4 target/);
    await expect(
      renderer.readPixels(target, new Rectangle2(0, 0.5, 1, 1)),
    ).rejects.toThrow(/region y must be an integer/);
    await expect(
      renderer.readPixels(target, new Rectangle2(0, 0, 1, 0)),
    ).rejects.toThrow(/non-empty/);
    expect(gpu.countOf("encoder.copyTextureToBuffer")).toBe(0);

    renderer.dispose();
    target.dispose();
  });
});
