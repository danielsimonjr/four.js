/**
 * The lazy, descriptor-keyed render-pipeline cache (§4.2 of the R-1 plan).
 *
 * ## Why a cache, and why lazy
 *
 * A GL program is an object you mutate: bind it, set uniforms, draw. A
 * `GPURenderPipeline` is **immutable and combinatorial** — its identity
 * includes the target format, the depth-stencil state, the blend state, the
 * primitive topology and the vertex layout. The WebGL backend's seven programs
 * therefore do not become seven objects here; they become a cache keyed by the
 * tuple of everything a pipeline bakes in.
 *
 * The cache is **lazy by rule, not by taste**. R-6's recorded pipeline-cost law
 * — *"a fifth compiled-at-init pipeline costs 0.75 kB gzip in every example
 * bundle … nothing reachable from a class method tree-shakes"* — is about
 * bundle cost, and it lands with more force here because the combinatorial
 * space is larger: a variant per (kind × vertex colours × blend × depth ×
 * colour write × topology × format) compiled at `initialize` would be dozens of
 * pipelines, nearly all of them for draws the scene never issues. So:
 * **pipelines are created on first use, never in `initialize()`** — a deliberate
 * departure from the GL backend's compile-at-init, for a measured reason rather
 * than an aesthetic one.
 *
 * That departure has one consequence worth stating plainly, because it looks
 * like a §61 violation and is not: pipeline *creation* now happens inside
 * `render`. WebGPU's `createRenderPipeline` does not throw for a shader that
 * fails to compile — it surfaces the failure asynchronously through the
 * device's error scopes and yields a pipeline that draws nothing — so the frame
 * neither throws nor unwinds, which is exactly what §61 requires of `render`.
 * A frame that cannot get a pipeline skips the draw, the same way a frame that
 * cannot get a geometry record skips it.
 *
 * ## Keys are canonical strings
 *
 * §33's hazard, recorded in the R-1 plan (§5): a `Map` keyed by a descriptor
 * *object* has iteration order determined by allocation identity, and two
 * structurally identical descriptors miss each other. Both are fixed by keying
 * on a **canonical string built in a fixed field order** — the key is a total,
 * deterministic function of the descriptor, so the same frame always produces
 * the same key sequence and the cache's iteration order is insertion order over
 * a value type. {@link pipelineKey} is that function, and it is exported so a
 * test can assert the key rather than infer it from a cache hit.
 */

import {
  type GpuBindGroupLayout,
  type GpuBlendState,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuRenderPipeline,
  type GpuShaderModule,
} from "./webgpu-device.js";
import {
  CLEAR_SHADER_SOURCE,
  FRAGMENT_ENTRY_POINT,
  VERTEX_ENTRY_POINT,
  unlitShaderSource,
  unlitVertexBufferLayouts,
} from "./wgpu-unlit.js";

/**
 * §57's four blend modes as WebGPU blend states, plus `"none"` for an opaque
 * draw.
 *
 * The factor pairs are the exact WebGPU spellings of `BLEND_FUNCTIONS` in
 * `webgl-renderer.ts` — `"src-alpha"` is `SRC_ALPHA`, and so on down the table.
 * Alpha is blended with the same pair as colour, matching the GL backend, whose
 * single `blendFunc` applies to both channel groups.
 */
const BLEND_STATES: Readonly<Record<string, GpuBlendState>> = Object.freeze({
  normal: blendState("src-alpha", "one-minus-src-alpha"),
  additive: blendState("src-alpha", "one"),
  multiply: blendState("dst", "zero"),
  screen: blendState("one", "one-minus-src"),
});

function blendState(srcFactor: string, dstFactor: string): GpuBlendState {
  const component = Object.freeze({
    srcFactor,
    dstFactor,
    operation: "add",
  });
  return Object.freeze({ color: component, alpha: component });
}

/** All four colour channels writable (`GPUColorWrite.ALL`). */
const COLOR_WRITE_ALL = 0xf;

/** Which family of shader a pipeline belongs to. */
export type WgpuPipelineKind = "unlit" | "clear";

/**
 * Everything a `GPURenderPipeline` bakes in — the cache's key material.
 *
 * A plain readonly record rather than a class: it is a value, it is built once
 * per draw on the stack, and {@link pipelineKey} is a pure function of it.
 */
export interface WgpuPipelineDescriptor {
  /** Which shader family (and so which WGSL module). */
  readonly kind: WgpuPipelineKind;
  /** Whether the variant reads the per-vertex colour stream (§53, §60a). */
  readonly vertexColors: boolean;
  /** §57's blend mode, or `"none"` for an opaque draw. */
  readonly blend: "none" | "normal" | "additive" | "multiply" | "screen";
  /** §57's `depthTest` — `"always"` when off, `"less"` when on (GL's default). */
  readonly depthTest: boolean;
  /** §57's `depthWrite`. */
  readonly depthWrite: boolean;
  /** §57's `colorWrite`, all four channels together as §57 declares it. */
  readonly colorWrite: boolean;
  /** §53's draw mode. */
  readonly topology: "triangle-list" | "line-list";
  /** The colour attachment's texel format — the swap chain's, in this tier. */
  readonly colorFormat: string;
  /** The depth attachment's format, or `null` for a pass with no depth. */
  readonly depthFormat: string | null;
}

/**
 * The canonical cache key for a descriptor: every field, in a fixed order,
 * separated by a character no field value contains.
 *
 * Fixed order and total coverage are both load-bearing. Fixed order makes the
 * key a deterministic function of the value (§33). Total coverage makes a cache
 * hit *mean* something: a field left out of the key is a pipeline reused with
 * the wrong state baked in, which is the failure mode this function exists to
 * make impossible — so a new field on {@link WgpuPipelineDescriptor} is a
 * compile error here until it is added below.
 */
export function pipelineKey(descriptor: WgpuPipelineDescriptor): string {
  return [
    descriptor.kind,
    descriptor.vertexColors ? "vc" : "-",
    descriptor.blend,
    descriptor.depthTest ? "dt" : "-",
    descriptor.depthWrite ? "dw" : "-",
    descriptor.colorWrite ? "cw" : "-",
    descriptor.topology,
    descriptor.colorFormat,
    descriptor.depthFormat ?? "-",
  ].join("|");
}

/**
 * Per-device store of compiled pipelines, WGSL modules and the shared pipeline
 * layout.
 *
 * Owned by the renderer, dropped whole on device loss (§61's "re-create
 * engine-owned GPU resources" — a lost device's pipelines are already invalid,
 * and there is nothing to release on a device that no longer exists).
 */
export class WgpuPipelineCache {
  readonly #device: GpuDevice;

  readonly #layout: GpuPipelineLayout;

  /** Pipelines by {@link pipelineKey}. Insertion-ordered, string-keyed (§33). */
  readonly #pipelines = new Map<string, GpuRenderPipeline>();

  /**
   * WGSL modules by variant key (`"unlit"`, `"unlit|vc"`, `"clear"`).
   *
   * A second cache, one level below the pipelines, because a module is shared
   * by every pipeline of its variant: the flat unlit shader is compiled once
   * however many blend and depth combinations draw with it.
   */
  readonly #modules = new Map<string, GpuShaderModule>();

  #disposed = false;

  constructor(device: GpuDevice, bindGroupLayout: GpuBindGroupLayout) {
    this.#device = device;
    this.#layout = device.createPipelineLayout({
      label: "four:pipeline-layout",
      bindGroupLayouts: [bindGroupLayout],
    });
  }

  /** How many distinct pipelines have been created. Diagnostics and tests. */
  get size(): number {
    return this.#pipelines.size;
  }

  /** How many WGSL modules have been compiled. Diagnostics and tests. */
  get moduleCount(): number {
    return this.#modules.size;
  }

  /** Whether {@link WgpuPipelineCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the pipeline for `descriptor`, creating it on first use.
   *
   * Returns `null` — and caches nothing — once disposed, so a draw racing
   * teardown skips rather than resurrecting the cache. Never throws: this runs
   * inside `Renderer.render` (see the module header).
   */
  acquire(descriptor: WgpuPipelineDescriptor): GpuRenderPipeline | null {
    if (this.#disposed) {
      return null;
    }
    const key = pipelineKey(descriptor);
    const existing = this.#pipelines.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const pipeline = this.#create(descriptor, key);
    this.#pipelines.set(key, pipeline);
    return pipeline;
  }

  /**
   * Drops every pipeline and module.
   *
   * Nothing is destroyed: WebGPU pipelines and shader modules have no
   * `destroy()` — they are released when the last reference to them and to the
   * device goes away — so dropping the maps *is* the release (§83). Idempotent.
   */
  dispose(): void {
    this.#disposed = true;
    this.#pipelines.clear();
    this.#modules.clear();
  }

  #module(kind: WgpuPipelineKind, vertexColors: boolean): GpuShaderModule {
    const key =
      kind === "clear" ? "clear" : vertexColors ? "unlit|vc" : "unlit";
    const existing = this.#modules.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const module = this.#device.createShaderModule({
      label: `four:${key}`,
      code:
        kind === "clear"
          ? CLEAR_SHADER_SOURCE
          : unlitShaderSource(vertexColors),
    });
    this.#modules.set(key, module);
    return module;
  }

  #create(descriptor: WgpuPipelineDescriptor, key: string): GpuRenderPipeline {
    const module = this.#module(descriptor.kind, descriptor.vertexColors);
    const blend =
      descriptor.blend === "none" ? undefined : BLEND_STATES[descriptor.blend];
    return this.#device.createRenderPipeline({
      label: `four:${key}`,
      layout: this.#layout,
      vertex: {
        module,
        entryPoint: VERTEX_ENTRY_POINT,
        // The clear pipeline reads no vertex buffers at all: its triangle is
        // generated from `@builtin(vertex_index)`, so there is nothing to bind
        // and nothing to upload.
        buffers:
          descriptor.kind === "clear"
            ? []
            : unlitVertexBufferLayouts(descriptor.vertexColors),
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
      primitive: {
        topology: descriptor.topology,
        // Winding and culling are left at WebGPU's defaults (`ccw`, no cull),
        // matching the GL backend, which keeps `CULL_FACE` disabled. The
        // recorded note applies to both backends at once: enabling culling is a
        // decision about the *projection's* winding mirror, and it must be
        // taken for both backends in one change or a scene renders differently
        // per backend (§62's tiers exist to prevent exactly that).
      },
      ...(descriptor.depthFormat === null
        ? {}
        : {
            depthStencil: {
              format: descriptor.depthFormat,
              depthWriteEnabled: descriptor.depthWrite,
              // §57's `depthTest: false` is "draw regardless of what is in
              // front", which is `"always"` — not a missing depth state: the
              // draw may still *write* depth, and a pipeline with no
              // depth-stencil state at all could not, while also being invalid
              // against a pass that has a depth attachment.
              depthCompare: descriptor.depthTest ? "less" : "always",
            },
          }),
    });
  }
}
