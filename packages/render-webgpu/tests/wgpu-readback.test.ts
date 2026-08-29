/**
 * WP-R1.6's `readPixels`: the 256-byte row alignment, the padding strip, the
 * §7a bottom-to-top row flip, the buffer's lifecycle on the tape, and the
 * renderer method's rejection contract.
 *
 * The recording double's `getMappedRange` hands back the deterministic
 * `i % 251` byte pattern precisely so the repack is assertable *exactly*:
 * a prime period can never align with the 256-byte padded rows, so a strip or
 * flip mistake changes the expected bytes rather than hiding in zeroes. What
 * the pattern cannot prove — that the copied bytes are the rendered picture —
 * is `tests/browser/webgpu/webgpu-effects.spec.ts`'s claim on a real adapter.
 */

import { isFourError, type FourError } from "@four/core";
import { RenderTarget } from "@four/render";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  READBACK_ROW_ALIGNMENT,
  WebgpuRenderer,
  readTexturePixels,
  readbackBytesPerRow,
  type Gpu,
  type GpuDevice,
} from "../src/index.js";

/** Awaits a rejection and returns the `FourError` it carried. */
async function rejection(promise: Promise<unknown>): Promise<FourError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the promise to reject");
}

describe("readbackBytesPerRow", () => {
  it("is the smallest 256-byte multiple that holds the row", () => {
    expect(readbackBytesPerRow(1)).toBe(READBACK_ROW_ALIGNMENT);
    expect(readbackBytesPerRow(64)).toBe(256);
    expect(readbackBytesPerRow(65)).toBe(512);
    expect(readbackBytesPerRow(128)).toBe(512);
    expect(readbackBytesPerRow(129)).toBe(768);
  });
});

describe("readTexturePixels", () => {
  it("copies with aligned rows, strips the padding, and flips to §7a order", async () => {
    const gpu = createRecordingGpu();
    const device = gpu.device as GpuDevice;
    const texture = device.createTexture({
      size: [3, 2],
      format: "rgba8unorm",
      usage: 0,
    });
    gpu.reset();

    const pixels = await readTexturePixels(device, texture, 3, 2);

    expect(pixels).not.toBeNull();
    const bytes = Array.from(new Uint8Array(pixels as ArrayBuffer));
    // The double's mapped range is byte i = i % 251 over the 512-byte padded
    // buffer. Row 0 of the result is the *bottom* image row — the copy's row
    // 1, at offset 256 — and row 1 is the copy's row 0.
    const expected: number[] = [];
    for (let index = 256; index < 268; index += 1) {
      expected.push(index % 251);
    }
    for (let index = 0; index < 12; index += 1) {
      expected.push(index);
    }
    expect(bytes).toEqual(expected);

    // The staging buffer: created mappable, copied into with aligned rows,
    // mapped for reading, unmapped, destroyed.
    const allocation = gpu.callsOf("device.createBuffer")[0]?.args[0] as {
      label: string;
      size: number;
      usage: number;
    };
    expect(allocation.label).toBe("four:readback");
    expect(allocation.size).toBe(512);
    expect(allocation.usage).toBe(
      GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
    );
    const copy = gpu.callsOf("encoder.copyTextureToBuffer")[0];
    expect(copy?.args[1]).toMatchObject({ bytesPerRow: 256, rowsPerImage: 2 });
    expect(copy?.args[2]).toEqual([3, 2]);
    expect(gpu.callsOf("buffer.mapAsync")[0]?.args[1]).toBe(GPU_MAP_MODE.READ);
    const names = gpu.calls.map((call) => call.name);
    expect(names.indexOf("queue.submit")).toBeLessThan(
      names.indexOf("buffer.mapAsync"),
    );
    expect(names.indexOf("buffer.unmap")).toBeLessThan(
      names.indexOf("buffer.destroy"),
    );
  });

  it("resolves null on an encoder without copyTextureToBuffer — presence is the capability", async () => {
    const gpu = createRecordingGpu();
    const raw = gpu.device as GpuDevice;
    const stripped: GpuDevice = {
      ...raw,
      createCommandEncoder: (descriptor) => {
        const encoder = raw.createCommandEncoder(descriptor);
        return {
          beginRenderPass: encoder.beginRenderPass.bind(encoder),
          finish: encoder.finish.bind(encoder),
        };
      },
    };
    const texture = raw.createTexture({
      size: [2, 2],
      format: "rgba8unorm",
      usage: 0,
    });
    gpu.reset();

    expect(await readTexturePixels(stripped, texture, 2, 2)).toBeNull();
    // Nothing was allocated for a copy that cannot be recorded.
    expect(gpu.countOf("device.createBuffer")).toBe(0);
  });

  it("resolves null — and destroys the buffer — on a buffer that cannot map", async () => {
    const gpu = createRecordingGpu();
    const raw = gpu.device as GpuDevice;
    const stripped: GpuDevice = {
      ...raw,
      createBuffer: (descriptor) => {
        const buffer = raw.createBuffer(descriptor);
        return { destroy: () => buffer.destroy() };
      },
    };
    const texture = raw.createTexture({
      size: [2, 2],
      format: "rgba8unorm",
      usage: 0,
    });
    gpu.reset();

    expect(await readTexturePixels(stripped, texture, 2, 2)).toBeNull();
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(gpu.countOf("encoder.copyTextureToBuffer")).toBe(0);
  });
});

describe("WebgpuRenderer.readPixels", () => {
  it("reads a target back as width * height * 4 tightly packed bytes", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    const target = new RenderTarget({ width: 4, height: 4 });

    // Never rendered into: the allocation is zero-filled and reading it back
    // is defined — the same answer sampling such a target gives. (Here the
    // double's pattern stands in for the zeroes; the *size* is the claim.)
    const pixels = await renderer.readPixels(target);
    expect(pixels.byteLength).toBe(4 * 4 * 4);
    // One target allocation served both the read and any later draw.
    expect(
      gpu
        .callsOf("device.createTexture")
        .filter((call) =>
          String((call.args[0] as { label?: string }).label).startsWith(
            "four:render-target:",
          ),
        ),
    ).toHaveLength(1);

    renderer.dispose();
    target.dispose();
  });

  it("rejects with INVALID_APPLICATION_STATE before initialize and after dispose", async () => {
    const uninitialized = new WebgpuRenderer();
    const target = new RenderTarget({ width: 2, height: 2 });
    expect((await rejection(uninitialized.readPixels(target))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );

    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    renderer.dispose();
    expect((await rejection(renderer.readPixels(target))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    target.dispose();
  });

  it("rejects with DEVICE_LOST while lost, and for a disposed target with §83's state code", async () => {
    const gpu = createRecordingGpu();
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu.gpu, async () => {
      await renderer.initialize({ canvas: gpu.canvas });
    });
    const disposedTarget = new RenderTarget({ width: 2, height: 2 });
    disposedTarget.dispose();
    expect((await rejection(renderer.readPixels(disposedTarget))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );

    gpu.loseDevice();
    await Promise.resolve();
    const target = new RenderTarget({ width: 2, height: 2 });
    expect((await rejection(renderer.readPixels(target))).code).toBe(
      "DEVICE_LOST",
    );
    renderer.dispose();
    target.dispose();
  });

  it("rejects with UNSUPPORTED_GPU_FEATURE on a device surface without the entry points", async () => {
    const base = createRecordingGpu();
    const raw = base.device as GpuDevice;
    const stripped: GpuDevice = {
      ...raw,
      createCommandEncoder: (descriptor) => {
        const encoder = raw.createCommandEncoder(descriptor);
        return {
          beginRenderPass: encoder.beginRenderPass.bind(encoder),
          finish: encoder.finish.bind(encoder),
        };
      },
    };
    const gpu: Gpu = {
      requestAdapter: () =>
        Promise.resolve({
          requestDevice: () => Promise.resolve(stripped),
        }),
    };
    const renderer = new WebgpuRenderer();
    await withHostGpu(gpu, async () => {
      await renderer.initialize({ canvas: base.canvas });
    });
    const target = new RenderTarget({ width: 2, height: 2 });

    expect((await rejection(renderer.readPixels(target))).code).toBe(
      "UNSUPPORTED_GPU_FEATURE",
    );
    renderer.dispose();
    target.dispose();
  });
});
