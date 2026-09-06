/**
 * Unit tests for render-target byte accounting (§83, §84; A-5 follow-up).
 *
 * The helpers quote what `@four/render-webgl`'s `gl-render-target.ts` allocates
 * so {@link RenderTarget.byteLength} stays aligned with §67's
 * `DEPTH24_STENCIL8`, R-18's samplable depth, and the staged float formats.
 */

import { describe, expect, it } from "vitest";

import {
  RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES,
  RENDER_TARGET_DEPTH_STENCIL_BYTES,
  RENDER_TARGET_DEPTH_TEXTURE_BYTES,
  RENDER_TARGET_RGBA16F_BYTES,
  RENDER_TARGET_RGBA32F_BYTES,
  RENDER_TARGET_RGBA8_BYTES,
  colorAttachmentBytesPerTexel,
  depthAttachmentBytesPerTexel,
  renderTargetByteLength,
} from "../src/render-target-bytes.js";

describe("render-target-bytes — colour attachments", () => {
  it("bills rgba8 at four bytes per texel", () => {
    expect(colorAttachmentBytesPerTexel("rgba8")).toBe(
      RENDER_TARGET_RGBA8_BYTES,
    );
    expect(RENDER_TARGET_RGBA8_BYTES).toBe(4);
  });

  it("records staged float format sizes for the §62 widening", () => {
    expect(RENDER_TARGET_RGBA16F_BYTES).toBe(8);
    expect(RENDER_TARGET_RGBA32F_BYTES).toBe(16);
  });
});

describe("render-target-bytes — depth attachments", () => {
  it("returns zero when depth is off", () => {
    expect(
      depthAttachmentBytesPerTexel({
        depth: false,
        depthTexture: false,
        stencil: false,
      }),
    ).toBe(0);
  });

  it("bills a plain renderbuffer at DEPTH_COMPONENT16 (two bytes)", () => {
    expect(
      depthAttachmentBytesPerTexel({
        depth: true,
        depthTexture: false,
        stencil: false,
      }),
    ).toBe(RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES);
    expect(RENDER_TARGET_DEPTH_RENDERBUFFER_BYTES).toBe(2);
  });

  it("bills a samplable depth texture at four bytes (DEPTH_COMPONENT24)", () => {
    expect(
      depthAttachmentBytesPerTexel({
        depth: true,
        depthTexture: true,
        stencil: false,
      }),
    ).toBe(RENDER_TARGET_DEPTH_TEXTURE_BYTES);
    expect(RENDER_TARGET_DEPTH_TEXTURE_BYTES).toBe(4);
  });

  it("bills a packed stencil attachment at four bytes (DEPTH24_STENCIL8)", () => {
    expect(
      depthAttachmentBytesPerTexel({
        depth: true,
        depthTexture: false,
        stencil: true,
      }),
    ).toBe(RENDER_TARGET_DEPTH_STENCIL_BYTES);
    expect(RENDER_TARGET_DEPTH_STENCIL_BYTES).toBe(4);
  });
});

describe("renderTargetByteLength — attachment matrix", () => {
  const size = 32 * 32;

  it("sums colour and depth bytes for every attachment combination", () => {
    expect(
      renderTargetByteLength(32, 32, "rgba8", true, false, false, false),
    ).toBe(size * (4 + 2));
    expect(
      renderTargetByteLength(32, 32, "rgba8", false, false, false, false),
    ).toBe(size * 4);
    expect(
      renderTargetByteLength(32, 32, "rgba8", true, true, false, false),
    ).toBe(size * (4 + 4));
    expect(
      renderTargetByteLength(32, 32, "rgba8", true, false, true, false),
    ).toBe(size * (4 + 4));
  });

  it("returns zero once disposed", () => {
    expect(
      renderTargetByteLength(512, 512, "rgba8", true, true, false, true),
    ).toBe(0);
  });
});
