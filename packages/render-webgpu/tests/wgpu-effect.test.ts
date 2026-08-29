/**
 * WP-R1.6's §70 effect pass: the WGSL builders, the (kind × format) pipeline
 * space through the lazy cache, `renderEffect`'s transcript, and the R-4
 * feedback refusal restated for a pass.
 *
 * Driven by the recording device double; the effect *descriptors* are the real
 * `@four/render` objects (`COPY_EFFECT` and friends), because the pass this
 * backend receives is exactly what `RenderGraph` forwards unchanged.
 */

import {
  COPY_EFFECT,
  OUTPUT_TRANSFORM_EFFECT,
  RenderTarget,
  createRenderStatistics,
  supportsScreenEffects,
  type EffectRenderPass,
  type ScreenEffect,
} from "@four/render";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "../../../tests/integration/helpers/recording-gpu.js";
import {
  EFFECT_PASS_VERTEX_COUNT,
  EFFECT_UNIFORM_BYTES,
  EFFECT_UNIFORM_WGSL,
  RENDER_TARGET_COLOR_FORMAT,
  WebgpuRenderer,
  WgpuPipelineCache,
  createDrawBindGroupLayout,
  createTextureBindGroupLayout,
  effectShaderSource,
  pipelineKey,
} from "../src/index.js";

interface Harness {
  readonly gpu: RecordingGpu;
  readonly renderer: WebgpuRenderer;
}

/** An initialized renderer over a fresh recording device, tape cleared. */
async function initialized(): Promise<Harness> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(128, 128, 1);
  gpu.reset();
  return { gpu, renderer };
}

/** Builds a §70 pass over `source`'s colour attachment. */
function effectPass(
  source: RenderTarget,
  effect: ScreenEffect,
  target?: RenderTarget | null,
): EffectRenderPass {
  return { kind: "effect", source: source.colorTexture, effect, target };
}

describe("effectShaderSource", () => {
  it("is a pure function of the kind — byte-identical across calls", () => {
    for (const kind of ["copy", "grade", "output-transform"] as const) {
      expect(effectShaderSource(kind)).toBe(effectShaderSource(kind));
    }
  });

  it("gives each kind its own module, and only the grade a uniform block", () => {
    const copy = effectShaderSource("copy");
    const grade = effectShaderSource("grade");
    const output = effectShaderSource("output-transform");
    expect(copy).not.toBe(grade);
    expect(grade).not.toBe(output);
    expect(grade).toContain(EFFECT_UNIFORM_WGSL);
    expect(copy).not.toContain("EffectUniforms");
    expect(output).not.toContain("EffectUniforms");
    // The copy is one sample and one return — the bit-exact blit, visibly.
    expect(copy).toContain(
      "return textureSample(sourceTexture, sourceSampler, input.uv);",
    );
    // The encode is the IEC 61966-2-1 pair of constants.
    expect(output).toContain("12.92");
    expect(output).toContain("0.0031308");
  });
});

describe("pipelineKey with the effect suffix", () => {
  it("appends |e: only when carried, keeping every landed key byte-identical", () => {
    const base = {
      kind: "unlit" as const,
      vertexColors: false,
      map: false,
      blend: "none" as const,
      depthTest: true,
      depthWrite: true,
      colorWrite: true,
      topology: "triangle-list" as const,
      colorFormat: "bgra8unorm",
      depthFormat: "depth24plus",
    };
    expect(pipelineKey(base)).toBe(
      "unlit|-|-|none|dt|dw|cw|triangle-list|bgra8unorm|depth24plus",
    );
    expect(
      pipelineKey({
        ...base,
        kind: "effect",
        map: true,
        depthTest: false,
        depthWrite: false,
        depthFormat: null,
        effect: "grade",
      }),
    ).toBe("effect|-|map|none|-|-|cw|triangle-list|bgra8unorm|-|e:grade");
  });
});

describe("WgpuPipelineCache effect layouts", () => {
  it("answers null for an effect descriptor when a provider is missing", () => {
    // The cache's documented contract: built without a provider for a layout
    // a descriptor needs, it answers null and the effect is skipped — the
    // same shape as a textured descriptor without a texture provider.
    const gpu = createRecordingGpu();
    const device = gpu.device;
    if (device === null) {
      throw new Error("recording device missing");
    }
    const drawLayout = createDrawBindGroupLayout(device);
    const bare = new WgpuPipelineCache(device, drawLayout);
    // No `effect` member at all: the kind defaults to the copy, exactly as
    // an absent `batch` member means "no interleaved stream".
    const descriptor = {
      kind: "effect" as const,
      vertexColors: false,
      map: true,
      blend: "none" as const,
      depthTest: false,
      depthWrite: false,
      colorWrite: true,
      topology: "triangle-list" as const,
      colorFormat: "bgra8unorm",
      depthFormat: null,
    };
    expect(bare.acquire(descriptor)).toBeNull();

    // A texture provider without an effect provider still cannot grade.
    const textureOnly = new WgpuPipelineCache(device, drawLayout, () =>
      createTextureBindGroupLayout(device),
    );
    expect(textureOnly.acquire({ ...descriptor, effect: "grade" })).toBeNull();
    // …but draws the uniform-free kinds through the source layout alone —
    // the carried `"copy"` and the absent member compile one shared module.
    expect(textureOnly.acquire(descriptor)).not.toBeNull();
    expect(
      textureOnly.acquire({ ...descriptor, effect: "copy" }),
    ).not.toBeNull();
    expect(textureOnly.moduleCount).toBe(1);
  });
});

describe("WebgpuRenderer.renderEffect", () => {
  it("is the §70 capability supportsScreenEffects detects", async () => {
    const { renderer } = await initialized();
    expect(supportsScreenEffects(renderer)).toBe(true);
    renderer.dispose();
  });

  it("draws a copy to the swap chain: one pass, one triangle, no uniforms", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });
    const statistics = createRenderStatistics();
    renderer.statistics = statistics;

    renderer.renderEffect(effectPass(source, COPY_EFFECT));

    expect(gpu.countOf("context.getCurrentTexture")).toBe(1);
    expect(gpu.countOf("queue.writeBuffer")).toBe(0);
    expect(gpu.callsOf("pass.draw")[0]?.args[0]).toBe(EFFECT_PASS_VERTEX_COUNT);
    expect(gpu.countOf("queue.submit")).toBe(1);
    const descriptor = gpu.callsOf("encoder.beginRenderPass")[0]?.args[0] as {
      label: string;
      colorAttachments: { loadOp: string }[];
      depthStencilAttachment?: unknown;
    };
    expect(descriptor.label).toBe("four:effect:copy");
    expect(descriptor.colorAttachments[0]?.loadOp).toBe("load");
    expect(descriptor.depthStencilAttachment).toBeUndefined();
    // The swap-chain pipeline bakes the swap-chain format.
    const pipeline = gpu.callsOf("device.createRenderPipeline")[0]?.args[0] as {
      label: string;
      fragment: { targets: { format: string }[] };
      vertex: { buffers: unknown[] };
    };
    expect(pipeline.fragment.targets[0]?.format).toBe("bgra8unorm");
    expect(pipeline.vertex.buffers).toEqual([]);
    expect(statistics.drawCalls).toBe(1);
    expect(statistics.triangles).toBe(1);

    // A second copy reuses the pipeline and the module.
    gpu.reset();
    renderer.renderEffect(effectPass(source, COPY_EFFECT));
    expect(gpu.countOf("device.createRenderPipeline")).toBe(0);
    expect(gpu.countOf("device.createShaderModule")).toBe(0);

    renderer.dispose();
    source.dispose();
  });

  it("compiles per (kind × format): one module, two pipelines across surfaces", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });
    const destination = new RenderTarget({ width: 16, height: 16 });

    renderer.renderEffect(effectPass(source, COPY_EFFECT));
    renderer.renderEffect(effectPass(source, COPY_EFFECT, destination));

    const pipelines = gpu.callsOf("device.createRenderPipeline").map(
      (call) =>
        call.args[0] as {
          label: string;
          fragment: { targets: { format: string }[] };
        },
    );
    expect(pipelines).toHaveLength(2);
    expect(pipelines.map((p) => p.fragment.targets[0]?.format)).toEqual([
      "bgra8unorm",
      RENDER_TARGET_COLOR_FORMAT,
    ]);
    expect(
      gpu
        .callsOf("device.createShaderModule")
        .filter(
          (call) =>
            (call.args[0] as { label: string }).label === "four:effect|copy",
        ),
    ).toHaveLength(1);
    // The off-screen copy attached the destination's view, not a swap chain.
    expect(gpu.countOf("context.getCurrentTexture")).toBe(1);

    renderer.dispose();
    source.dispose();
    destination.dispose();
  });

  it("uploads the grade's 16 bytes — coefficients then the written zero lane", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });

    renderer.renderEffect(
      effectPass(source, { kind: "grade", exposure: 1.5, saturation: 0.25 }),
    );

    const upload = gpu.callsOf("queue.writeBuffer")[0];
    expect(upload?.args[2]).toEqual([1.5, 1, 0.25, 0]);
    const allocation = gpu.callsOf("device.createBuffer")[0]?.args[0] as {
      label: string;
      size: number;
    };
    expect(allocation.label).toBe("four:effect-uniforms");
    expect(allocation.size).toBe(EFFECT_UNIFORM_BYTES);
    // Group 1 bound beside the source's group 0.
    expect(
      gpu.callsOf("pass.setBindGroup").map((call) => call.args[0]),
    ).toEqual([0, 1]);

    // A second grade reuses layout, buffer and group — one upload per call.
    gpu.reset();
    renderer.renderEffect(effectPass(source, { kind: "grade" }));
    expect(gpu.countOf("device.createBindGroupLayout")).toBe(0);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(gpu.callsOf("queue.writeBuffer")[0]?.args[2]).toEqual([1, 1, 1, 0]);

    renderer.dispose();
    source.dispose();
  });

  it("draws the output transform with no uniform traffic at all", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });

    renderer.renderEffect(effectPass(source, OUTPUT_TRANSFORM_EFFECT));

    expect(gpu.countOf("queue.writeBuffer")).toBe(0);
    expect(gpu.countOf("device.createBuffer")).toBe(0);
    expect(
      gpu.callsOf("pass.setBindGroup").map((call) => call.args[0]),
    ).toEqual([0]);
    expect(
      (
        gpu.callsOf("device.createShaderModule")[0]?.args[0] as {
          label: string;
        }
      ).label,
    ).toBe("four:effect|output-transform");

    renderer.dispose();
    source.dispose();
  });

  it("refuses the feedback loop: destination === source is skipped whole (R-4)", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });

    renderer.renderEffect(effectPass(source, COPY_EFFECT, source));

    expect(gpu.calls).toHaveLength(0);
    renderer.dispose();
    source.dispose();
  });

  it("skips a source that is not a render-target texture, and disposed surfaces (§83)", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });
    const destination = new RenderTarget({ width: 16, height: 16 });

    renderer.renderEffect({
      kind: "effect",
      source: { data: null } as unknown as EffectRenderPass["source"],
      effect: COPY_EFFECT,
    });
    expect(gpu.calls).toHaveLength(0);

    source.dispose();
    renderer.renderEffect(effectPass(source, COPY_EFFECT));
    expect(gpu.calls).toHaveLength(0);

    const live = new RenderTarget({ width: 16, height: 16 });
    destination.dispose();
    renderer.renderEffect(effectPass(live, COPY_EFFECT, destination));
    // The source resolved (allocation is legitimate) but the disposed
    // destination skipped the draw.
    expect(gpu.countOf("pass.draw")).toBe(0);
    expect(gpu.countOf("queue.submit")).toBe(0);

    renderer.dispose();
    live.dispose();
  });

  it("skips RFC 0001's graph kind — absent, never approximated", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });

    renderer.renderEffect(
      effectPass(source, { kind: "graph" } as unknown as ScreenEffect),
    );

    expect(gpu.calls).toHaveLength(0);
    renderer.dispose();
    source.dispose();
  });

  it("survives a reentrant dispose inside a grade coefficient accessor (§61)", async () => {
    // An effect descriptor is application data, and a structurally typed one
    // may compute its coefficients — so a getter can do anything, including
    // tearing the renderer down mid-call. The effect is skipped, nothing is
    // recorded after the teardown, and nothing throws.
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });
    const sabotage = {
      kind: "grade" as const,
      get exposure(): number {
        renderer.dispose();
        return 2;
      },
    };

    expect(() => {
      renderer.renderEffect(effectPass(source, sabotage));
    }).not.toThrow();
    expect(gpu.countOf("queue.submit")).toBe(0);
    expect(gpu.countOf("pass.draw")).toBe(0);
    source.dispose();
  });

  it("returns quietly while the device is lost, and throws once disposed (§61, §83)", async () => {
    const { gpu, renderer } = await initialized();
    const source = new RenderTarget({ width: 16, height: 16 });

    gpu.loseDevice();
    await Promise.resolve();
    gpu.reset();
    renderer.renderEffect(effectPass(source, COPY_EFFECT));
    expect(gpu.calls).toHaveLength(0);

    renderer.dispose();
    expect(() => {
      renderer.renderEffect(effectPass(source, COPY_EFFECT));
    }).toThrow(/disposed/);
    source.dispose();
  });
});
