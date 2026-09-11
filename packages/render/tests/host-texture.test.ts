import { describe, expect, it, vi } from "vitest";
import {
  ImageBitmapTexture,
  VideoTexture,
  type ImageReadSurface,
  type VideoTextureSource,
} from "../src/host-texture.js";
function surface() {
  const context = {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn(
      (_x: number, _y: number, width: number, height: number) => ({
        data: Uint8Array.from({ length: width * height * 4 }, (_, i) => i + 1),
      }),
    ),
  };
  const target: ImageReadSurface = {
    width: 1,
    height: 1,
    getContext: () => context,
  };
  return { target, context };
}
describe("host bitmap and video textures", () => {
  it("copies bottom-first bitmap pixels and defaults to sRGB", () => {
    const { target, context } = surface(),
      bitmap = { width: 1, height: 2, close: vi.fn() };
    const t = new ImageBitmapTexture(bitmap, { surface: target });
    expect(Array.from(t.data!)).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
    expect(t.colorSpace).toBe("srgb");
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(target.height).toBe(2);
    t.dispose();
    expect(bitmap.close).not.toHaveBeenCalled();
  });
  it("validates before touching surfaces and propagates canvas/security failures", () => {
    const { target, context } = surface();
    for (const maximumBytes of [0, NaN, 3])
      expect(
        () =>
          new ImageBitmapTexture(
            { width: 1, height: 1 },
            { surface: target, maximumBytes },
          ),
      ).toThrow();
    for (const width of [Infinity, -1])
      expect(
        () => new ImageBitmapTexture({ width, height: 1 }, { surface: target }),
      ).toThrow();
    expect(context.drawImage).not.toHaveBeenCalled();
    context.getImageData.mockReturnValueOnce({ data: new Uint8Array(3) });
    expect(
      () =>
        new ImageBitmapTexture({ width: 1, height: 1 }, { surface: target }),
    ).toThrow("byte count");
    context.drawImage.mockImplementationOnce(() => {
      throw new Error("tainted");
    });
    expect(
      () =>
        new ImageBitmapTexture({ width: 1, height: 1 }, { surface: target }),
    ).toThrow("tainted");
    target.getContext = () => null;
    expect(
      () =>
        new ImageBitmapTexture({ width: 1, height: 1 }, { surface: target }),
    ).toThrow("readable");
  });
  it("polls fallback time, waits for metadata and validates resized video frames", () => {
    const { target, context } = surface(),
      video = { videoWidth: 0, videoHeight: 0, currentTime: 0, readyState: 0 };
    const t = new VideoTexture(video, {
      surface: target,
      maximumBytes: 16,
      role: "data",
    });
    expect(t.update()).toBe(false);
    expect(t.data).toBeNull();
    Object.assign(video, { videoWidth: 1, videoHeight: 2, readyState: 2 });
    expect(t.update()).toBe(true);
    expect(t.colorSpace).toBe("linear");
    const bytes = t.data;
    expect(t.update()).toBe(false);
    video.currentTime = 1;
    expect(t.update()).toBe(true);
    expect(t.data).toBe(bytes);
    expect(t.getDirtyRegion(1)).toMatchObject({
      x: 0,
      y: 0,
      width: 1,
      height: 2,
    });
    t.invalidate();
    expect(t.update()).toBe(true);
    video.videoWidth = 2;
    expect(t.update()).toBe(true);
    expect(t.data).not.toBe(bytes);
    const version = t.version;
    video.videoWidth = 3;
    expect(() => t.update()).toThrow("maximumBytes");
    expect(t.version).toBe(version);
    expect(target.width).toBe(2);
    expect(context.drawImage).toHaveBeenCalledTimes(4);
    t.dispose();
    t.dispose();
    expect(() => t.update()).toThrow("disposed");
  });
  it("uses frame notifications, cancels on dispose, and ignores late callbacks", () => {
    const { target } = surface();
    let callback: (() => void) | undefined;
    const request = vi.fn((cb: () => void) => {
        callback = cb;
        return 7;
      }),
      cancel = vi.fn();
    const video: VideoTextureSource = {
      videoWidth: 1,
      videoHeight: 1,
      currentTime: 0,
      readyState: 2,
      requestVideoFrameCallback: request,
      cancelVideoFrameCallback: cancel,
    };
    const t = new VideoTexture(video, { surface: target });
    expect(t.update()).toBe(true);
    expect(t.update()).toBe(false);
    callback!();
    expect(t.update()).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    t.dispose();
    callback!();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("supports callback providers without cancellation", () => {
    const { target } = surface(),
      video = {
        videoWidth: 1,
        videoHeight: 1,
        currentTime: 0,
        readyState: 2,
        requestVideoFrameCallback: () => 1,
      };
    const t = new VideoTexture(video, {
      surface: target,
      maximumBytes: Infinity,
    });
    t.dispose();
  });
});
