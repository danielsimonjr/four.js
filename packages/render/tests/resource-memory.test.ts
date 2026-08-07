import { describe, expect, it } from "vitest";

import { RenderTarget } from "../src/render-target.js";
import {
  liveRenderTargetCount,
  liveTextureCount,
  textureMemoryBytes,
} from "../src/resource-memory.js";
import { Texture } from "../src/texture.js";

describe("§83 texture and render-target resource accounting (A-5)", () => {
  // Deltas rather than absolutes: the totals are process-wide levels (§83),
  // never reset, so what any one test can assert is the change it caused.

  it("bills a texture four bytes per texel", () => {
    expect(new Texture({ width: 4, height: 8 }).byteLength).toBe(128);
  });

  it("bills a texture with no CPU-side bytes exactly the same", () => {
    // A source without `data` still makes the backend allocate zero-filled
    // storage of the full size, so billing it zero would under-report.
    const empty = new Texture({ width: 4, height: 4 });
    const filled = new Texture({
      width: 4,
      height: 4,
      data: new Uint8Array(64),
    });

    expect(empty.byteLength).toBe(filled.byteLength);
  });

  it("adds a texture to the bytes and to the texture count", () => {
    const bytes = textureMemoryBytes();
    const count = liveTextureCount();

    const texture = new Texture({ width: 16, height: 16 });

    expect(textureMemoryBytes() - bytes).toBe(texture.byteLength);
    expect(liveTextureCount() - count).toBe(1);
  });

  it("removes a disposed texture from both", () => {
    const bytes = textureMemoryBytes();
    const count = liveTextureCount();
    const texture = new Texture({ width: 16, height: 16 });

    texture.dispose();

    expect(textureMemoryBytes()).toBe(bytes);
    expect(liveTextureCount()).toBe(count);
    expect(texture.byteLength).toBe(0);
  });

  it("subtracts once for a double dispose (§83: idempotent and terminal)", () => {
    const bytes = textureMemoryBytes();
    const count = liveTextureCount();
    const texture = new Texture({ width: 8, height: 8 });

    texture.dispose();
    texture.dispose();

    expect(textureMemoryBytes()).toBe(bytes);
    expect(liveTextureCount()).toBe(count);
  });

  it("follows a source replacement by the difference", () => {
    const texture = new Texture({ width: 4, height: 4 });
    const bytes = textureMemoryBytes();

    texture.source = { width: 8, height: 8 };

    expect(texture.byteLength).toBe(256);
    expect(textureMemoryBytes() - bytes).toBe(192);
  });

  it("leaves the totals alone for an announced in-place edit", () => {
    const texture = new Texture({
      width: 2,
      height: 2,
      data: new Uint8Array(16),
    });
    const bytes = textureMemoryBytes();

    texture.data![0] = 255;
    texture.markDirty();

    expect(textureMemoryBytes()).toBe(bytes);
  });

  it("cannot be resurrected by a write into a disposed texture", () => {
    const texture = new Texture({ width: 4, height: 4 });
    texture.dispose();
    const bytes = textureMemoryBytes();
    const count = liveTextureCount();

    texture.source = { width: 64, height: 64 };

    expect(texture.byteLength).toBe(0);
    expect(textureMemoryBytes()).toBe(bytes);
    expect(liveTextureCount()).toBe(count);
  });

  it("bills a render target its colour and depth attachments", () => {
    // 4 bytes per texel of `rgba8`, plus 2 for the `DEPTH_COMPONENT16`
    // renderbuffer the WebGL 2 backend allocates.
    expect(new RenderTarget({ width: 16, height: 16 }).byteLength).toBe(1536);
  });

  it("bills a depth-less target its colour attachment only", () => {
    expect(
      new RenderTarget({ width: 16, height: 16, depth: false }).byteLength,
    ).toBe(1024);
  });

  it("counts targets separately but reports their bytes together", () => {
    const bytes = textureMemoryBytes();
    const textures = liveTextureCount();
    const targets = liveRenderTargetCount();

    const target = new RenderTarget({ width: 8, height: 8, depth: false });

    expect(textureMemoryBytes() - bytes).toBe(target.byteLength);
    expect(liveTextureCount()).toBe(textures);
    expect(liveRenderTargetCount() - targets).toBe(1);
  });

  it("follows a resize by the difference", () => {
    const target = new RenderTarget({ width: 8, height: 8, depth: false });
    const bytes = textureMemoryBytes();

    target.resize(16, 16);

    expect(target.byteLength).toBe(1024);
    expect(textureMemoryBytes() - bytes).toBe(768);
  });

  it("removes a disposed target from both", () => {
    const bytes = textureMemoryBytes();
    const targets = liveRenderTargetCount();
    const target = new RenderTarget({ width: 32, height: 32 });

    target.dispose();
    target.dispose();

    expect(textureMemoryBytes()).toBe(bytes);
    expect(liveRenderTargetCount()).toBe(targets);
    expect(target.byteLength).toBe(0);
  });

  it("never forgives a resource that is dropped without dispose (§83)", () => {
    // The "leaked textures" signal: a target re-created per resize instead of
    // resized keeps climbing, which is the mistake §83 asks to be warned about.
    const bytes = textureMemoryBytes();
    for (let size = 1; size <= 4; size += 1) {
      new RenderTarget({ width: size, height: size, depth: false });
    }

    expect(textureMemoryBytes() - bytes).toBe((1 + 4 + 9 + 16) * 4);
  });
});
