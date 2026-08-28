/**
 * `readPixels`' mechanism: `copyTextureToBuffer` + `mapAsync` (WP-R1.6; §61,
 * §92, RFC 0005).
 *
 * This is the probe-verified path the R-1 plan names (§3.3.5), and it is the
 * evidence RFC 0005's asynchronous-forever commitment is right rather than
 * merely argued: WebGPU has **no synchronous readback at all** — a texture's
 * bytes reach the CPU only through a copy recorded on the queue and a map that
 * resolves when the GPU is done — so a `readPixels` that pretended to be
 * synchronous could not be implemented here honestly. §61's own sketch already
 * concedes the point (`readPixels?(…): Promise<ArrayBuffer>`), and
 * `WebgpuRenderer.readPixels` implements exactly that sketch's whole-target
 * form; the `region` parameter waits for `Rectangle2` in `@four/math` (RFC
 * 0005's named prerequisite, not landed), and shipping the whole-target form
 * rather than inventing a rectangle type is the plan's explicit instruction.
 *
 * ## The 256-byte row (§62's alignment, owned here)
 *
 * `copyTextureToBuffer` requires `bytesPerRow` to be a multiple of 256
 * (WebGPU's `COPY_BYTES_PER_ROW_ALIGNMENT`), so a 100-texel-wide target's
 * 400-byte rows are copied 512 bytes apart and the buffer holds padding no
 * texel wrote. {@link readbackBytesPerRow} is that arithmetic, and the repack
 * below strips the padding while copying out of the mapped range — which has
 * to be copied regardless, because `unmap` detaches the `ArrayBuffer` the map
 * handed out.
 *
 * ## Row order: bottom-to-top, by decision
 *
 * §61's sketch says nothing about row order, so the first implementation gets
 * to fix it, and fixes it to **§7a's convention: row 0 of the result is the
 * bottom row of the image**, rows ascending upward. That is the order GL's
 * `readPixels` produces natively, so the byte layout is already the one the
 * WebGL backend will return when it lands the member — the cross-backend
 * agreement is decided here once instead of discovered as a flip later.
 * WebGPU's copy emits rows top-first (its framebuffer origin is top-left), so
 * the repack loop writes them in reverse; the flip rides the padding strip
 * this function performs anyway and costs no extra pass.
 */

import {
  GPU_BUFFER_USAGE,
  GPU_MAP_MODE,
  type GpuDevice,
  type GpuTexture,
} from "./webgpu-device.js";

/**
 * WebGPU's `COPY_BYTES_PER_ROW_ALIGNMENT`: what `copyTextureToBuffer`'s
 * `bytesPerRow` must be a multiple of. A normative constant, written out for
 * the reason every `GPU_*` table in `webgpu-device.ts` is.
 */
export const READBACK_ROW_ALIGNMENT = 256;

/** Bytes per texel of the one colour format this tier reads back (rgba8). */
const BYTES_PER_TEXEL = 4;

/**
 * The aligned `bytesPerRow` for a `width`-texel row of rgba8 texels — the
 * smallest multiple of {@link READBACK_ROW_ALIGNMENT} that holds the row.
 */
export function readbackBytesPerRow(width: number): number {
  return (
    Math.ceil((width * BYTES_PER_TEXEL) / READBACK_ROW_ALIGNMENT) *
    READBACK_ROW_ALIGNMENT
  );
}

/**
 * Copies `texture`'s texels into a tightly packed RGBA8 `ArrayBuffer` — rows
 * bottom-to-top (module header), `width * height * 4` bytes.
 *
 * Resolves `null` when the device surface does not carry the readback entry
 * points (`copyTextureToBuffer`, `mapAsync` — optional members whose presence
 * is the capability); the caller turns that into `UNSUPPORTED_GPU_FEATURE`.
 * The staging buffer is created per call and destroyed before resolving: a
 * whole-target readback is a diagnostic-tier operation (§92's visual tier,
 * RFC 0005's fallback path), and pooling a buffer that is mapped across an
 * `await` would trade a transient allocation for a reentrancy hazard.
 */
export async function readTexturePixels(
  device: GpuDevice,
  texture: GpuTexture,
  width: number,
  height: number,
): Promise<ArrayBuffer | null> {
  const encoder = device.createCommandEncoder({ label: "four:readback" });
  if (encoder.copyTextureToBuffer === undefined) {
    return null;
  }
  const bytesPerRow = readbackBytesPerRow(width);
  const buffer = device.createBuffer({
    label: "four:readback",
    size: bytesPerRow * height,
    usage: GPU_BUFFER_USAGE.COPY_DST | GPU_BUFFER_USAGE.MAP_READ,
  });
  if (
    buffer.mapAsync === undefined ||
    buffer.getMappedRange === undefined ||
    buffer.unmap === undefined
  ) {
    buffer.destroy();
    return null;
  }

  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: height },
    [width, height],
  );
  device.queue.submit([encoder.finish()]);

  await buffer.mapAsync(GPU_MAP_MODE.READ);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const rowBytes = width * BYTES_PER_TEXEL;
  const packed = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const source = row * bytesPerRow;
    // Top-first copy rows written bottom-first into the result — the §7a
    // order the module header fixes.
    packed.set(
      mapped.subarray(source, source + rowBytes),
      (height - 1 - row) * rowBytes,
    );
  }
  buffer.unmap();
  buffer.destroy();
  return packed.buffer;
}
