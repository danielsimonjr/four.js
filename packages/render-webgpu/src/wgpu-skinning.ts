/**
 * The skinned colour pipelines (§54, §62; RFC 0003) — a skinned variant of
 * the unlit family and of the lit family, reached only through
 * {@link registerSkinningPipeline}.
 *
 * ## Skinning is a separate pipeline, not a uniform switch (RFC 0003 §5)
 *
 * A `useSkinning` uniform would add four joint fetches, four weight fetches,
 * four `mat4` reads, and a weighted sum to the **vertex stage of every draw
 * in the scene**. So the skinned draws compile their own pipelines, and
 * byte-identity for skinless scenes is preserved the lazy way:
 *
 * - **nothing here is reachable from `WebgpuRenderer`** — the renderer
 *   imports only the registry slot (`wgpu-skinning-registry.ts`), and this
 *   module links into a bundle only when the application calls
 *   {@link registerSkinningPipeline};
 * - **pipelines compile on the first skinned draw of each variant, never
 *   at initialize**, so a scene with no skinned mesh issues the
 *   byte-identical GPU sequence it always did;
 * - a factory failure inside the frame is caught by the renderer (§61
 *   forbids throwing there), warned once, and skinning is off for that
 *   device. A bind pose is never drawn.
 * - the §69 caster compiles on {@link SkinnedPrograms.acquireShadow}, never
 *   with the colour pair and never at initialize. The RFC 0005 id pass
 *   lives in `wgpu-picking.ts` and imports only `wgpu-skinning-shared.ts`.
 *
 * ## The palette, and why it is not in `DrawUniforms`
 *
 * The palette is `uniform mat4 jointMatrices[MAX_SKINNING_JOINTS]` — 48
 * joints, `@fourjs/render`'s declared constant. 48 × 64 = 3072 bytes, which
 * will not fit in the 256-byte `DrawUniforms` stride, and widening that
 * block would move every landed unskinned transcript (Playwright harnesses
 * bind their own layouts against `DRAW_UNIFORM_BYTES === 192`). So the
 * palette is a **separate bind group**: one uniform buffer of 3072-byte
 * slots, bound at a dynamic offset per skinned draw, uploaded once per
 * frame after the pass — the draw uniforms' shape, one buffer later.
 *
 * Fragment stages are {@link unlitFragmentStageWgsl} and
 * {@link litFragmentStageWgsl} verbatim, so the two families cannot drift.
 *
 * Classes here are deliberately **not** named `SkinnedUnlitProgram`,
 * `SkinnedLitProgram`, or `SkinnedShadowProgram` — WebGL already owns
 * those (`graph:duplicates`). The public opt-in is
 * {@link registerSkinningPipeline}.
 */

import {
  GPU_BUFFER_USAGE,
  type GpuBindGroup,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuRenderPipeline,
  type GpuShaderModule,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import { DRAW_UNIFORM_WGSL, MAP_BINDING_WGSL } from "./wgpu-bindings.js";
import {
  LIGHT_UNIFORM_WGSL,
  PUNCTUAL_LIGHT_WGSL,
  SHADED_MAP_BINDING_WGSL,
} from "./wgpu-lights.js";
import {
  NORMAL_MATRIX_WGSL,
  litFragmentStageWgsl,
  shadedVertexBufferLayouts,
} from "./wgpu-lit.js";
import { blendStateFor, stencilStateFor } from "./wgpu-pipeline-cache.js";
import {
  RENDER_TARGET_COLOR_FORMAT,
  RENDER_TARGET_DEPTH_TEXTURE_FORMAT,
} from "./wgpu-render-target.js";
import {
  SHADOW_FACTOR_WGSL,
  SHADOW_LIGHT_UNIFORM_WGSL,
} from "./wgpu-shadow.js";
import {
  setSkinningPipelineFactory,
  type SkinnedLitPipeline,
  type SkinnedPrograms,
  type SkinnedUnlitPipeline,
  type SkinningPipelineHost,
  type WgpuSkinnedDrawDescriptor,
} from "./wgpu-skinning-registry.js";
import {
  createJointPaletteBindGroupLayout,
  JOINTS_BUFFER_LAYOUT,
  JOINTS_SHADER_LOCATION,
  JOINT_PALETTE_BINDING,
  JOINT_PALETTE_BYTES,
  JOINT_PALETTE_FLOATS,
  WEIGHTS_BUFFER_LAYOUT,
  WEIGHTS_SHADER_LOCATION,
  skinnedPaletteBindGroupIndex,
  skinningWgsl,
} from "./wgpu-skinning-shared.js";
import {
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
  POSITION_SHADER_LOCATION,
  VERTEX_ENTRY_POINT,
  unlitFragmentStageWgsl,
  unlitVertexBufferLayouts,
} from "./wgpu-unlit.js";

export {
  JOINTS_BUFFER_LAYOUT,
  JOINTS_SHADER_LOCATION,
  JOINT_PALETTE_BINDING,
  JOINT_PALETTE_BYTES,
  JOINT_PALETTE_FLOATS,
  WEIGHTS_BUFFER_LAYOUT,
  WEIGHTS_SHADER_LOCATION,
  createJointPaletteBindGroupLayout,
  skinnedPaletteBindGroupIndex,
  skinningWgsl,
} from "./wgpu-skinning-shared.js";

/** All four colour channels writable (`GPUColorWrite.ALL`). */
const COLOR_WRITE_ALL = 0xf;

/**
 * Vertex layouts for a skinned unlit pipeline, **in slot order**: the
 * unlit family's streams, then joints, then weights. Shader locations stay
 * 4 and 5 regardless of how many streams precede them.
 */
export function skinnedUnlitVertexBufferLayouts(
  vertexColors: boolean,
  map: boolean,
): readonly GpuVertexBufferLayout[] {
  return [
    ...unlitVertexBufferLayouts(vertexColors, map),
    JOINTS_BUFFER_LAYOUT,
    WEIGHTS_BUFFER_LAYOUT,
  ];
}

/**
 * Vertex layouts for a skinned lit pipeline, **in slot order**: the shaded
 * family's streams, then joints, then weights.
 */
export function skinnedLitVertexBufferLayouts(
  normals: boolean,
  map: boolean,
): readonly GpuVertexBufferLayout[] {
  return [
    ...shadedVertexBufferLayouts(normals, map),
    JOINTS_BUFFER_LAYOUT,
    WEIGHTS_BUFFER_LAYOUT,
  ];
}

function skinnedInfluenceInputs(): string {
  return `
  @location(${String(JOINTS_SHADER_LOCATION)}) joints : vec4<u32>,
  @location(${String(WEIGHTS_SHADER_LOCATION)}) weights : vec4<f32>,`;
}

/**
 * The skinned unlit WGSL module for one variant. The fragment stage is
 * {@link unlitFragmentStageWgsl} verbatim.
 */
export function skinnedUnlitShaderSource(
  vertexColors: boolean,
  map = false,
): string {
  const paletteGroup = skinnedPaletteBindGroupIndex(false, map);
  let input = `  @location(0) position : vec3<f32>,`;
  if (vertexColors) {
    input += `
  @location(1) vertexColor : vec4<f32>,`;
  }
  if (map) {
    input += `
  @location(2) uv : vec2<f32>,`;
  }
  input += skinnedInfluenceInputs();
  const color = vertexColors ? "draw.color * vertexColor" : "draw.color";
  return `${DRAW_UNIFORM_WGSL}

${skinningWgsl(paletteGroup)}${map ? `\n\n${MAP_BINDING_WGSL}` : ""}

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,${
    map
      ? `
  @location(1) uv : vec2<f32>,`
      : ""
  }
};

@vertex
fn ${VERTEX_ENTRY_POINT}(
${input}
) -> VertexOutput {
  var output : VertexOutput;
  let clip = draw.viewProjection * draw.model * (skinMatrix() * vec4<f32>(position, 1.0));
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  output.color = ${color};${
    map
      ? `
  output.uv = uv;`
      : ""
  }
  return output;
}

${unlitFragmentStageWgsl(map)}`;
}

/**
 * The skinned lit WGSL module for one variant. The fragment stage is
 * {@link litFragmentStageWgsl} verbatim. The vertex stage composes
 * `model * skinMatrix()` and transforms normals with the inverse-transpose
 * of that 3×3 — GL's skinned lit vertex, restated, because the CPU
 * `normalMatrix` is the **model**'s and the skin varies per vertex.
 */
export function skinnedLitShaderSource(
  normals: boolean,
  map: boolean,
  shadow = false,
): string {
  const paletteGroup = skinnedPaletteBindGroupIndex(true, map);
  let input = `  @location(0) position : vec3<f32>,`;
  if (normals) {
    input += `
  @location(3) normal : vec3<f32>,`;
  }
  if (map) {
    input += `
  @location(2) uv : vec2<f32>,`;
  }
  input += skinnedInfluenceInputs();
  return `${DRAW_UNIFORM_WGSL}

${skinningWgsl(paletteGroup)}

${shadow ? SHADOW_LIGHT_UNIFORM_WGSL : LIGHT_UNIFORM_WGSL}${
    map
      ? `

${SHADED_MAP_BINDING_WGSL}`
      : ""
  }
${normals ? `\n${NORMAL_MATRIX_WGSL}\n` : ""}
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) normal : vec3<f32>,
  @location(1) worldPosition : vec3<f32>,${
    map
      ? `
  @location(2) uv : vec2<f32>,`
      : ""
  }
};

@vertex
fn ${VERTEX_ENTRY_POINT}(
${input}
) -> VertexOutput {
  var output : VertexOutput;
  let skinned = draw.model * skinMatrix();
  let world = skinned * vec4<f32>(position, 1.0);
  output.worldPosition = world.xyz;
  output.normal = ${
    normals ? "normalMatrix(skinned) * normal" : "vec3<f32>(0.0, 0.0, 0.0)"
  };${
    map
      ? `
  output.uv = uv;`
      : ""
  }
  let clip = draw.viewProjection * world;
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  return output;
}

${PUNCTUAL_LIGHT_WGSL}${
    shadow
      ? `

${SHADOW_FACTOR_WGSL}`
      : ""
  }

${litFragmentStageWgsl(map, shadow)}`;
}

/**
 * The depth-only skinned caster module — `SHADOW_SHADER_SOURCE`'s
 * vertex product with the position run through `skinMatrix()` first, so a
 * `castShadow` skinned mesh writes its **deformed** silhouette rather than
 * the bind pose. Palette is group 1 after `DrawUniforms`. Not named
 * `SkinnedShadowProgram` (`graph:duplicates`).
 */
export function skinnedShadowShaderSource(): string {
  return `${DRAW_UNIFORM_WGSL}

${skinningWgsl(1)}

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(${String(POSITION_SHADER_LOCATION)}) position : vec3<f32>,
  @location(${String(JOINTS_SHADER_LOCATION)}) joints : vec4<u32>,
  @location(${String(WEIGHTS_SHADER_LOCATION)}) weights : vec4<f32>,
) -> @builtin(position) vec4<f32> {
  let world = draw.model * (skinMatrix() * vec4<f32>(position, 1.0));
  let clip = draw.viewProjection * world;
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  return vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
`;
}

function descriptorKey(
  family: "unlit" | "lit",
  descriptor: WgpuSkinnedDrawDescriptor,
): string {
  let key = [
    family,
    descriptor.vertexColors ? "vc" : "-",
    descriptor.map ? "map" : "-",
    descriptor.normals ? "n" : "-",
    descriptor.shadow ? "sh" : "-",
    descriptor.blend,
    descriptor.depthTest ? "dt" : "-",
    descriptor.depthWrite ? "dw" : "-",
    descriptor.colorWrite ? "cw" : "-",
    descriptor.topology,
    descriptor.colorFormat,
    descriptor.depthFormat ?? "-",
  ].join("|");
  const stencil = descriptor.stencil;
  if (stencil !== null) {
    key +=
      `|s:${stencil.func},${String(stencil.readMask)},` +
      `${String(stencil.writeMask)},${stencil.failOp},` +
      `${stencil.depthFailOp},${stencil.passOp}`;
  }
  return key;
}

/**
 * The compiled colour pair. Named off the WebGL program classes on
 * purpose (`graph:duplicates`).
 */
class WgpuSkinnedProgramPair implements SkinnedPrograms {
  readonly unlit: SkinnedUnlitPipeline;

  readonly lit: SkinnedLitPipeline;

  readonly #host: SkinningPipelineHost;

  readonly #paletteLayout: GpuBindGroupLayout;

  readonly #pipelines = new Map<string, GpuRenderPipeline>();

  readonly #modules = new Map<string, GpuShaderModule>();

  readonly #pipelineLayouts = new Map<string, GpuPipelineLayout>();

  readonly #shadowPipelines = new Map<string, GpuRenderPipeline>();

  #shadowModule: GpuShaderModule | null = null;

  #shadowLayout: GpuPipelineLayout | null = null;

  #shadowFailed = false;

  #paletteBuffer: GpuBuffer | null = null;

  #paletteBindGroup: GpuBindGroup | null = null;

  #paletteStaging = new Float32Array(0);

  #paletteCapacity = 0;

  #packed = 0;

  #disposed = false;

  constructor(host: SkinningPipelineHost, paletteLayout: GpuBindGroupLayout) {
    this.#host = host;
    this.#paletteLayout = paletteLayout;
    this.unlit = {
      acquire: (descriptor) => this.#acquire("unlit", descriptor),
    };
    this.lit = {
      acquire: (descriptor) => this.#acquire("lit", descriptor),
    };
  }

  paletteGroup(lit: boolean, map: boolean): number {
    return skinnedPaletteBindGroupIndex(lit, map);
  }

  prepare(device: GpuDevice, draws: number): void {
    this.#packed = 0;
    if (this.#disposed || draws <= 0) {
      return;
    }
    if (draws <= this.#paletteCapacity) {
      return;
    }
    const capacity = Math.max(draws, this.#paletteCapacity * 2, 1);
    this.#paletteBuffer?.destroy();
    const buffer = device.createBuffer({
      label: "fourJS:joint-palette",
      size: capacity * JOINT_PALETTE_BYTES,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    this.#paletteBuffer = buffer;
    this.#paletteStaging = new Float32Array(capacity * JOINT_PALETTE_FLOATS);
    this.#paletteCapacity = capacity;
    this.#paletteBindGroup = device.createBindGroup({
      label: "fourJS:joint-palette",
      layout: this.#paletteLayout,
      entries: [
        {
          binding: JOINT_PALETTE_BINDING,
          resource: { buffer, offset: 0, size: JOINT_PALETTE_BYTES },
        },
      ],
    });
  }

  packPalette(palette: Float32Array): number {
    const slot = this.#packed;
    const base = slot * JOINT_PALETTE_FLOATS;
    const staging = this.#paletteStaging;
    const limit = Math.min(palette.length, JOINT_PALETTE_FLOATS);
    for (let index = 0; index < JOINT_PALETTE_FLOATS; index += 1) {
      staging[base + index] = index < limit ? palette[index] : 0;
    }
    this.#packed = slot + 1;
    return slot * JOINT_PALETTE_BYTES;
  }

  paletteBindGroup(): GpuBindGroup | null {
    return this.#paletteBindGroup;
  }

  /**
   * Compiles the skinned caster on first call for `topology` and returns it.
   * Subsequent calls reuse the compiled pipeline. Throws on compile failure
   * (and on a later retry after a failure) so the renderer can latch and
   * skip — never a bind-pose shadow.
   */
  acquireShadow(
    topology: "triangle-list" | "line-list" = "triangle-list",
  ): GpuRenderPipeline {
    if (this.#disposed) {
      throw new Error("skinned-shadow: pair is disposed");
    }
    const existing = this.#shadowPipelines.get(topology);
    if (existing !== undefined) {
      return existing;
    }
    if (this.#shadowFailed) {
      throw new Error("skinned-shadow previously failed to compile");
    }
    try {
      const pipeline = this.#compileShadow(topology);
      this.#shadowPipelines.set(topology, pipeline);
      return pipeline;
    } catch (error: unknown) {
      this.#shadowFailed = true;
      throw error;
    }
  }

  upload(device: GpuDevice): void {
    const buffer = this.#paletteBuffer;
    if (buffer === null || this.#packed === 0 || this.#disposed) {
      return;
    }
    device.queue.writeBuffer(
      buffer,
      0,
      this.#paletteStaging,
      0,
      this.#packed * JOINT_PALETTE_FLOATS,
    );
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#paletteBuffer?.destroy();
    this.#forgetState();
  }

  forget(): void {
    this.#disposed = true;
    this.#forgetState();
  }

  #forgetState(): void {
    this.#pipelines.clear();
    this.#modules.clear();
    this.#pipelineLayouts.clear();
    this.#shadowPipelines.clear();
    this.#shadowModule = null;
    this.#shadowLayout = null;
    this.#shadowFailed = false;
    this.#paletteBuffer = null;
    this.#paletteBindGroup = null;
    this.#paletteStaging = new Float32Array(0);
    this.#paletteCapacity = 0;
    this.#packed = 0;
  }

  #compileShadow(
    topology: "triangle-list" | "line-list",
  ): GpuRenderPipeline {
    const draw = this.#host.drawLayout();
    const device = this.#host.device();
    if (draw === null || device === null) {
      throw new Error("skinned-shadow: no device or draw layout");
    }
    let layout = this.#shadowLayout;
    if (layout === null) {
      layout = device.createPipelineLayout({
        label: "fourJS:pipeline-layout:skinned:shadow",
        bindGroupLayouts: [draw, this.#paletteLayout],
      });
      this.#shadowLayout = layout;
    }
    let module = this.#shadowModule;
    if (module === null) {
      module = device.createShaderModule({
        label: "fourJS:skinned-shadow",
        code: skinnedShadowShaderSource(),
      });
      this.#shadowModule = module;
    }
    return device.createRenderPipeline({
      label: `fourJS:skinned-shadow|${topology}`,
      layout,
      vertex: {
        module,
        entryPoint: VERTEX_ENTRY_POINT,
        buffers: [
          POSITION_BUFFER_LAYOUT,
          JOINTS_BUFFER_LAYOUT,
          WEIGHTS_BUFFER_LAYOUT,
        ],
      },
      fragment: {
        module,
        entryPoint: FRAGMENT_ENTRY_POINT,
        targets: [
          {
            format: RENDER_TARGET_COLOR_FORMAT,
            writeMask: COLOR_WRITE_ALL,
          },
        ],
      },
      primitive: { topology },
      depthStencil: {
        format: RENDER_TARGET_DEPTH_TEXTURE_FORMAT,
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
  }

  #acquire(
    family: "unlit" | "lit",
    descriptor: WgpuSkinnedDrawDescriptor,
  ): GpuRenderPipeline | null {
    if (this.#disposed) {
      return null;
    }
    const key = descriptorKey(family, descriptor);
    const existing = this.#pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const layout = this.#layoutFor(family, descriptor);
    if (layout === null) {
      return null;
    }
    const device = this.#host.device();
    if (device === null) {
      return null;
    }
    const module = this.#module(family, descriptor, device);
    const blend = blendStateFor(descriptor.blend);
    const pipeline = device.createRenderPipeline({
      label: `fourJS:skinned-${key}`,
      layout,
      vertex: {
        module,
        entryPoint: VERTEX_ENTRY_POINT,
        buffers:
          family === "unlit"
            ? skinnedUnlitVertexBufferLayouts(
                descriptor.vertexColors,
                descriptor.map,
              )
            : skinnedLitVertexBufferLayouts(descriptor.normals, descriptor.map),
      },
      fragment: {
        module,
        entryPoint: FRAGMENT_ENTRY_POINT,
        targets: [
          {
            format: descriptor.colorFormat,
            ...(blend === undefined ? {} : { blend }),
            writeMask: descriptor.colorWrite ? COLOR_WRITE_ALL : 0,
          },
        ],
      },
      primitive: { topology: descriptor.topology },
      ...(descriptor.depthFormat === null
        ? {}
        : {
            depthStencil: {
              format: descriptor.depthFormat,
              depthWriteEnabled: descriptor.depthWrite,
              depthCompare: descriptor.depthTest ? "less" : "always",
              ...stencilStateFor(descriptor.stencil),
            },
          }),
    });
    this.#pipelines.set(key, pipeline);
    return pipeline;
  }

  #module(
    family: "unlit" | "lit",
    descriptor: WgpuSkinnedDrawDescriptor,
    device: GpuDevice,
  ): GpuShaderModule {
    const moduleKey =
      family === "unlit"
        ? `unlit${descriptor.vertexColors ? "|vc" : ""}${descriptor.map ? "|map" : ""}`
        : `lit${descriptor.normals ? "|n" : ""}${descriptor.map ? "|map" : ""}${descriptor.shadow ? "|sh" : ""}`;
    const existing = this.#modules.get(moduleKey);
    if (existing !== undefined) {
      return existing;
    }
    const module = device.createShaderModule({
      label: `fourJS:skinned-${moduleKey}`,
      code:
        family === "unlit"
          ? skinnedUnlitShaderSource(descriptor.vertexColors, descriptor.map)
          : skinnedLitShaderSource(
              descriptor.normals,
              descriptor.map,
              descriptor.shadow,
            ),
    });
    this.#modules.set(moduleKey, module);
    return module;
  }

  #layoutFor(
    family: "unlit" | "lit",
    descriptor: WgpuSkinnedDrawDescriptor,
  ): GpuPipelineLayout | null {
    const draw = this.#host.drawLayout();
    if (draw === null) {
      return null;
    }
    const groups: GpuBindGroupLayout[] = [draw];
    if (family === "lit") {
      const lights = descriptor.shadow
        ? this.#host.shadowLightsLayout()
        : this.#host.lightsLayout();
      if (lights === null) {
        return null;
      }
      groups.push(lights);
    }
    if (descriptor.map) {
      const texture = this.#host.textureLayout();
      if (texture === null) {
        return null;
      }
      groups.push(texture);
    }
    groups.push(this.#paletteLayout);
    const layoutKey = `${family}|${descriptor.map ? "map" : "-"}|${descriptor.shadow ? "sh" : "-"}`;
    const existing = this.#pipelineLayouts.get(layoutKey);
    if (existing !== undefined) {
      return existing;
    }
    const device = this.#host.device();
    if (device === null) {
      return null;
    }
    const created = device.createPipelineLayout({
      label: `fourJS:pipeline-layout:skinned:${layoutKey}`,
      bindGroupLayouts: groups,
    });
    this.#pipelineLayouts.set(layoutKey, created);
    return created;
  }
}

/**
 * Opts this process's `WebgpuRenderer`s into GPU skinning (§54, §62; RFC 0003).
 *
 * ```ts
 * import { registerSkinningPipeline } from "@fourjs/render-webgpu";
 * registerSkinningPipeline();          // once, at application setup
 * ```
 *
 * Calling it is what links this module — the two skinned colour pipelines
 * and the palette uploader — into the bundle; a build that never calls it
 * carries none of it. The colour pair still compiles **lazily, on each
 * renderer's first skinned colour draw**, never here and never at renderer
 * initialize, so registration alone changes no GPU transcript. Idempotent;
 * calling it twice re-installs the same factory.
 *
 * The §69 caster compiles on {@link SkinnedPrograms.acquireShadow}, never
 * with the colour pair and never at initialize. The RFC 0005 id pass lives
 * in `wgpu-picking.ts` and imports only `wgpu-skinning-shared.ts`.
 */
export function registerSkinningPipeline(): void {
  setSkinningPipelineFactory({
    create(host: SkinningPipelineHost): SkinnedPrograms {
      const device = host.device();
      if (device === null) {
        throw new Error("skinning pipeline: no device");
      }
      return new WgpuSkinnedProgramPair(
        host,
        createJointPaletteBindGroupLayout(device),
      );
    },
  });
}
