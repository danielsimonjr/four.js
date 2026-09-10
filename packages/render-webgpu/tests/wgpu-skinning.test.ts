/**
 * RFC 0003's WebGPU skinned colour pair, tested at the seam: the registry
 * slot, the WGSL/layout helpers, and the lazily compiled pipelines plus
 * joint-palette uploader. Renderer-level draws live in
 * `webgpu-renderer.test.ts`; this file localises a failure to `wgpu-skinning.ts`
 * the way `wgpu-picking.test.ts` localises one to the id pass.
 */

import { MAX_SKINNING_JOINTS } from "@fourjs/render";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRecordingGpu } from "../../../tests/integration/helpers/recording-gpu.js";
import {
  DRAW_UNIFORM_BYTES,
  GPU_SHADER_STAGE,
  JOINTS_BUFFER_LAYOUT,
  JOINTS_SHADER_LOCATION,
  JOINT_PALETTE_BINDING,
  JOINT_PALETTE_BYTES,
  JOINT_PALETTE_FLOATS,
  WEIGHTS_BUFFER_LAYOUT,
  WEIGHTS_SHADER_LOCATION,
  clearRegisteredSkinningPipeline,
  createDrawBindGroupLayout,
  createJointPaletteBindGroupLayout,
  createLightsBindGroupLayout,
  createShadowLightsBindGroupLayout,
  createTextureBindGroupLayout,
  litFragmentStageWgsl,
  registerSkinningPipeline,
  resolveSkinningPipelineFactory,
  SKINNED_SHADOW_SHADER_SOURCE,
  SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS,
  skinnedLitShaderSource,
  skinnedLitVertexBufferLayouts,
  skinnedPaletteBindGroupIndex,
  skinnedUnlitShaderSource,
  skinnedUnlitVertexBufferLayouts,
  skinningWgsl,
  unlitFragmentStageWgsl,
  type GpuBindGroupLayout,
  type GpuDevice,
  type SkinningPipelineHost,
  type SkinnedPrograms,
  type WgpuSkinnedDrawDescriptor,
} from "../src/index.js";

function device(): {
  device: GpuDevice;
  gpu: ReturnType<typeof createRecordingGpu>;
} {
  const gpu = createRecordingGpu();
  return { device: gpu.device as GpuDevice, gpu };
}

function createHost(
  gpuDevice: GpuDevice,
  overrides: Partial<{
    device: GpuDevice | null;
    draw: GpuBindGroupLayout | null;
    texture: GpuBindGroupLayout | null;
    lights: GpuBindGroupLayout | null;
    shadowLights: GpuBindGroupLayout | null;
  }> = {},
): SkinningPipelineHost {
  const draw =
    overrides.draw === undefined
      ? createDrawBindGroupLayout(gpuDevice)
      : overrides.draw;
  const texture =
    overrides.texture === undefined
      ? createTextureBindGroupLayout(gpuDevice)
      : overrides.texture;
  const lights =
    overrides.lights === undefined
      ? createLightsBindGroupLayout(gpuDevice)
      : overrides.lights;
  const shadowLights =
    overrides.shadowLights === undefined
      ? createShadowLightsBindGroupLayout(gpuDevice)
      : overrides.shadowLights;
  const live = "device" in overrides ? overrides.device : gpuDevice;
  return {
    device: () => live ?? null,
    drawLayout: () => draw,
    textureLayout: () => texture,
    lightsLayout: () => lights,
    shadowLightsLayout: () => shadowLights,
  };
}

const UNLIT: WgpuSkinnedDrawDescriptor = {
  vertexColors: false,
  map: false,
  normals: false,
  shadow: false,
  blend: "none",
  depthTest: true,
  depthWrite: true,
  colorWrite: true,
  topology: "triangle-list",
  colorFormat: "bgra8unorm",
  depthFormat: "depth24plus",
  stencil: null,
};

function pair(
  gpuDevice: GpuDevice,
  host?: SkinningPipelineHost,
): SkinnedPrograms {
  registerSkinningPipeline();
  const factory = resolveSkinningPipelineFactory();
  if (factory === null) {
    throw new Error("expected a registered factory");
  }
  return factory.create(host ?? createHost(gpuDevice));
}

beforeEach(() => {
  clearRegisteredSkinningPipeline();
});

afterEach(() => {
  clearRegisteredSkinningPipeline();
});

describe("registerSkinningPipeline — the registry slot (RFC 0003)", () => {
  it("starts empty, fills on registration, and clears for tests", () => {
    expect(resolveSkinningPipelineFactory()).toBeNull();
    registerSkinningPipeline();
    expect(resolveSkinningPipelineFactory()).not.toBeNull();
    registerSkinningPipeline();
    expect(resolveSkinningPipelineFactory()).not.toBeNull();
    clearRegisteredSkinningPipeline();
    expect(resolveSkinningPipelineFactory()).toBeNull();
  });

  it("registration and create compile no pipeline (lazy compile)", () => {
    const { device: gpuDevice, gpu } = device();
    gpu.reset();
    const programs = pair(gpuDevice);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);
    expect(programs.paletteBindGroup()).toBeNull();
  });

  it("refuses create when the host has no device", () => {
    registerSkinningPipeline();
    const factory = resolveSkinningPipelineFactory();
    expect(() =>
      factory?.create({
        device: () => null,
        drawLayout: () => null,
        textureLayout: () => null,
        lightsLayout: () => null,
        shadowLightsLayout: () => null,
      }),
    ).toThrow(/no device/);
  });
});

describe("joint palette layout (RFC 0003)", () => {
  it("is 3072 bytes, already 256-aligned, and must not widen DrawUniforms", () => {
    expect(MAX_SKINNING_JOINTS).toBe(48);
    expect(JOINT_PALETTE_BYTES).toBe(3072);
    expect(JOINT_PALETTE_FLOATS).toBe(768);
    expect(JOINT_PALETTE_BYTES % 256).toBe(0);
    expect(DRAW_UNIFORM_BYTES).toBe(192);
  });

  it("occupies the slot after the family's existing groups", () => {
    expect(skinnedPaletteBindGroupIndex(false, false)).toBe(1);
    expect(skinnedPaletteBindGroupIndex(false, true)).toBe(2);
    expect(skinnedPaletteBindGroupIndex(true, false)).toBe(2);
    expect(skinnedPaletteBindGroupIndex(true, true)).toBe(3);
  });

  it("declares a vertex-only dynamically-offset uniform of minBindingSize 3072", () => {
    const { device: gpuDevice, gpu } = device();
    gpu.reset();
    const layout = createJointPaletteBindGroupLayout(gpuDevice);
    expect(layout).toBeDefined();
    const descriptor = gpu.callsOf("device.createBindGroupLayout")[0]
      ?.args[0] as {
      label?: string;
      entries: {
        binding: number;
        visibility: number;
        buffer: {
          type: string;
          hasDynamicOffset: boolean;
          minBindingSize: number;
        };
      }[];
    };
    expect(descriptor.label).toBe("fourJS:joint-palette");
    expect(descriptor.entries).toHaveLength(1);
    expect(descriptor.entries[0]?.binding).toBe(JOINT_PALETTE_BINDING);
    expect(descriptor.entries[0]?.visibility).toBe(GPU_SHADER_STAGE.VERTEX);
    expect(descriptor.entries[0]?.buffer).toEqual({
      type: "uniform",
      hasDynamicOffset: true,
      minBindingSize: JOINT_PALETTE_BYTES,
    });
  });
});

describe("skinned WGSL and vertex layouts", () => {
  it("places joints at location 4 and weights at 5, uint16x4 then float32x4", () => {
    expect(JOINTS_SHADER_LOCATION).toBe(4);
    expect(WEIGHTS_SHADER_LOCATION).toBe(5);
    expect(JOINTS_BUFFER_LAYOUT).toEqual({
      arrayStride: 8,
      stepMode: "vertex",
      attributes: [{ format: "uint16x4", offset: 0, shaderLocation: 4 }],
    });
    expect(WEIGHTS_BUFFER_LAYOUT).toEqual({
      arrayStride: 16,
      stepMode: "vertex",
      attributes: [{ format: "float32x4", offset: 0, shaderLocation: 5 }],
    });
  });

  it("appends joints then weights after each family's streams", () => {
    const unlit = skinnedUnlitVertexBufferLayouts(true, true);
    expect(unlit[unlit.length - 2]).toBe(JOINTS_BUFFER_LAYOUT);
    expect(unlit[unlit.length - 1]).toBe(WEIGHTS_BUFFER_LAYOUT);
    expect(unlit).toHaveLength(5);
    const lit = skinnedLitVertexBufferLayouts(true, true);
    expect(lit[lit.length - 2]).toBe(JOINTS_BUFFER_LAYOUT);
    expect(lit[lit.length - 1]).toBe(WEIGHTS_BUFFER_LAYOUT);
    expect(lit).toHaveLength(5);
  });

  it("splices the unlit/lit fragment helpers and the un-renormalised skinMatrix", () => {
    const unlit = skinnedUnlitShaderSource(false);
    expect(unlit).toContain(unlitFragmentStageWgsl(false));
    expect(unlit).toContain(skinningWgsl(1));
    expect(unlit).toContain("skinMatrix()");
    expect(unlit).not.toContain("normalize(weights");
    const unlitMapped = skinnedUnlitShaderSource(true, true);
    expect(unlitMapped).toContain(unlitFragmentStageWgsl(true));
    expect(unlitMapped).toContain(skinningWgsl(2));
    const lit = skinnedLitShaderSource(true, false);
    expect(lit).toContain(litFragmentStageWgsl(false, false));
    expect(lit).toContain("let skinned = draw.model * skinMatrix()");
    expect(lit).toContain("normalMatrix(skinned)");
    const litShadow = skinnedLitShaderSource(true, true, true);
    expect(litShadow).toContain(litFragmentStageWgsl(true, true));
    expect(litShadow).toContain(skinningWgsl(3));
    const litFlat = skinnedLitShaderSource(false, false);
    expect(litFlat).toContain("vec3<f32>(0.0, 0.0, 0.0)");
  });
});

describe("WgpuSkinnedProgramPair", () => {
  it("compiles lazily, reuses the pipeline, and packs the palette into a 3072-byte slot", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    gpu.reset();
    programs.prepare(gpuDevice, 1);
    expect(
      gpu
        .callsOf("device.createBuffer")
        .some(
          (call) =>
            (call.args[0] as { label?: string }).label ===
            "fourJS:joint-palette",
        ),
    ).toBe(true);
    const pipeline = programs.unlit.acquire(UNLIT);
    expect(pipeline).not.toBeNull();
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(programs.unlit.acquire(UNLIT)).toBe(pipeline);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);

    const palette = new Float32Array(32);
    palette[13] = 5;
    const offset = programs.packPalette(palette);
    expect(offset).toBe(0);
    expect(programs.paletteGroup(false, false)).toBe(1);
    gpu.reset();
    programs.upload(gpuDevice);
    const uploads = gpu.callsOf("queue.writeBuffer");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.args[4]).toBe(JOINT_PALETTE_FLOATS);
    const data = uploads[0]?.args[2] as number[];
    expect(data[13]).toBe(5);
    expect(data).toHaveLength(JOINT_PALETTE_FLOATS);
    expect(data.slice(16).every((value) => value === 0)).toBe(true);
  });

  it("compiles the skinned caster lazily on acquireShadow, not with the colour pair", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    gpu.reset();
    const first = programs.acquireShadow({
      topology: "triangle-list",
      colorFormat: "rgba8unorm",
      depthFormat: "depth32float",
    });
    expect(first).toBeTruthy();
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
    expect(gpu.countOf("device.createShaderModule")).toBe(1);
    expect(SKINNED_SHADOW_SHADER_SOURCE).toContain("skinMatrix(");
    expect(SKINNED_SHADOW_SHADER_SOURCE).toContain("jointMatrices");
    expect(SKINNED_SHADOW_VERTEX_BUFFER_LAYOUTS).toHaveLength(3);
    expect(
      programs.acquireShadow({
        topology: "triangle-list",
        colorFormat: "rgba8unorm",
        depthFormat: "depth32float",
      }),
    ).toBe(first);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(1);
  });

  it("grows the palette buffer before the pass and destroys the previous one", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    programs.prepare(gpuDevice, 1);
    gpu.reset();
    programs.prepare(gpuDevice, 3);
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    const created = gpu
      .callsOf("device.createBuffer")
      .map((call) => call.args[0] as { label?: string; size: number });
    expect(created[0]?.label).toBe("fourJS:joint-palette");
    expect(created[0]?.size).toBe(3 * JOINT_PALETTE_BYTES);
  });

  it("prepare(0) and a packed-less upload issue nothing", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    gpu.reset();
    programs.prepare(gpuDevice, 0);
    programs.upload(gpuDevice);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(gpu.countOf("queue.writeBuffer")).toBe(0);
  });

  it("clamps an over-long palette to one slot", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    programs.prepare(gpuDevice, 1);
    const long = new Float32Array(JOINT_PALETTE_FLOATS + 8);
    long[0] = 3;
    long[JOINT_PALETTE_FLOATS] = 9;
    programs.packPalette(long);
    gpu.reset();
    programs.upload(gpuDevice);
    const data = gpu.callsOf("queue.writeBuffer")[0]?.args[2] as number[];
    expect(data).toHaveLength(JOINT_PALETTE_FLOATS);
    expect(data[0]).toBe(3);
    expect(data).not.toContain(9);
  });

  it("shares a module across blends and a layout across depth writes", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    programs.unlit.acquire(UNLIT);
    programs.unlit.acquire({ ...UNLIT, blend: "normal" });
    expect(gpu.countOf("device.createShaderModule")).toBe(1);
    expect(gpu.countOf("device.createRenderPipeline")).toBe(2);
    programs.unlit.acquire({ ...UNLIT, depthWrite: false });
    expect(gpu.countOf("device.createPipelineLayout")).toBe(1);
  });

  it("compiles the lit family, including the shadow and map variants", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    expect(programs.lit.acquire({ ...UNLIT, normals: true })).not.toBeNull();
    expect(
      programs.lit.acquire({ ...UNLIT, normals: true, map: true }),
    ).not.toBeNull();
    expect(
      programs.lit.acquire({
        ...UNLIT,
        normals: true,
        map: true,
        shadow: true,
      }),
    ).not.toBeNull();
    expect(programs.paletteGroup(true, false)).toBe(2);
    expect(programs.paletteGroup(true, true)).toBe(3);
    const codes = gpu
      .callsOf("device.createShaderModule")
      .map((call) => (call.args[0] as { code: string }).code);
    expect(codes.some((code) => code.includes("shadowFactor"))).toBe(true);
    expect(codes.some((code) => code.includes("textureSample"))).toBe(true);
  });

  it("compiles vertex-colour unlit, colour-write-off, line-list, and stencil keys", () => {
    const { device: gpuDevice, gpu } = device();
    const programs = pair(gpuDevice);
    expect(
      programs.unlit.acquire({ ...UNLIT, vertexColors: true, map: true }),
    ).not.toBeNull();
    expect(
      programs.unlit.acquire({ ...UNLIT, colorWrite: false }),
    ).not.toBeNull();
    expect(
      programs.unlit.acquire({ ...UNLIT, topology: "line-list" }),
    ).not.toBeNull();
    expect(
      programs.unlit.acquire({ ...UNLIT, depthFormat: null }),
    ).not.toBeNull();
    const stencil = {
      func: "equal" as const,
      readMask: 0xff,
      writeMask: 0xff,
      failOp: "keep" as const,
      depthFailOp: "keep" as const,
      passOp: "replace" as const,
    };
    expect(programs.unlit.acquire({ ...UNLIT, stencil })).not.toBeNull();
    expect(
      programs.unlit.acquire({
        ...UNLIT,
        stencil: { ...stencil, func: "never" },
      }),
    ).not.toBeNull();
    const labels = gpu
      .callsOf("device.createRenderPipeline")
      .map((call) => String((call.args[0] as { label?: string }).label));
    expect(labels.some((label) => label.includes("|s:equal,"))).toBe(true);
    expect(labels.some((label) => label.includes("|s:never,"))).toBe(true);
    const colourOff = gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          call.args[0] as {
            fragment: { targets: { writeMask: number }[] };
          },
      )
      .find((descriptor) => descriptor.fragment.targets[0]?.writeMask === 0);
    expect(colourOff).toBeDefined();
  });

  it("answers null when a required layout is missing", () => {
    const { device: gpuDevice } = device();
    expect(
      pair(gpuDevice, createHost(gpuDevice, { draw: null })).unlit.acquire(
        UNLIT,
      ),
    ).toBeNull();
    expect(
      pair(gpuDevice, createHost(gpuDevice, { lights: null })).lit.acquire({
        ...UNLIT,
        normals: true,
      }),
    ).toBeNull();
    expect(
      pair(gpuDevice, createHost(gpuDevice, { texture: null })).unlit.acquire({
        ...UNLIT,
        map: true,
      }),
    ).toBeNull();
    expect(
      pair(
        gpuDevice,
        createHost(gpuDevice, { shadowLights: null }),
      ).lit.acquire({ ...UNLIT, normals: true, shadow: true }),
    ).toBeNull();
  });

  it("answers null once disposed or forgotten, and dispose is idempotent", () => {
    const { device: gpuDevice, gpu } = device();
    const live = pair(gpuDevice);
    live.prepare(gpuDevice, 1);
    live.unlit.acquire(UNLIT);
    gpu.reset();
    live.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    expect(live.unlit.acquire(UNLIT)).toBeNull();
    live.dispose();
    expect(gpu.countOf("buffer.destroy")).toBe(1);
    live.prepare(gpuDevice, 2);
    live.upload(gpuDevice);
    expect(gpu.countOf("device.createBuffer")).toBe(0);

    const lost = pair(gpuDevice);
    lost.prepare(gpuDevice, 1);
    gpu.reset();
    lost.forget();
    expect(gpu.countOf("buffer.destroy")).toBe(0);
    expect(lost.lit.acquire({ ...UNLIT, normals: true })).toBeNull();
  });

  it("refuses a new variant when the host's device drops out", () => {
    const { device: gpuDevice } = device();
    let current: GpuDevice | null = gpuDevice;
    const host: SkinningPipelineHost = {
      ...createHost(gpuDevice),
      device: () => current,
    };
    const programs = pair(gpuDevice, host);
    expect(programs.unlit.acquire(UNLIT)).not.toBeNull();
    current = null;
    expect(programs.unlit.acquire({ ...UNLIT, blend: "additive" })).toBeNull();
    expect(programs.unlit.acquire({ ...UNLIT, map: true })).toBeNull();
  });
});
