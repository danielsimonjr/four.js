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

import type { RenderItemStencil } from "@four/render";

import {
  type GpuBindGroupLayout,
  type GpuBlendState,
  type GpuDevice,
  type GpuPipelineLayout,
  type GpuRenderPipeline,
  type GpuShaderModule,
  type GpuStencilFaceState,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import { batchVertexBufferLayout } from "./wgpu-batch.js";
import { SPRITE_SHADER_SOURCE } from "./wgpu-sprite.js";
import {
  CLEAR_SHADER_SOURCE,
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
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

/**
 * §57's stencil comparisons as WebGPU compare functions — the exact spellings
 * of `webgl-renderer.ts`'s `STENCIL_FUNCS`, minus the GL enum indirection.
 */
const STENCIL_COMPARES: Readonly<Record<RenderItemStencil["func"], string>> =
  Object.freeze({
    never: "never",
    less: "less",
    equal: "equal",
    lequal: "less-equal",
    greater: "greater",
    notequal: "not-equal",
    gequal: "greater-equal",
    always: "always",
  });

/**
 * §57's stencil operations as WebGPU operations. The two saturating forms are
 * the renames worth reading twice: WebGPU spells GL's saturating
 * `INCR`/`DECR` as `-clamp`, and the wrap forms keep their names.
 */
const STENCIL_OPERATIONS: Readonly<
  Record<RenderItemStencil["passOp"], string>
> = Object.freeze({
  keep: "keep",
  zero: "zero",
  replace: "replace",
  increment: "increment-clamp",
  "increment-wrap": "increment-wrap",
  decrement: "decrement-clamp",
  "decrement-wrap": "decrement-wrap",
  invert: "invert",
});

/**
 * Which family of shader a pipeline belongs to.
 *
 * `"sprite"` is §55's quad pipeline (`wgpu-sprite.ts`); `"batch"` is §65's
 * merged draw, which compiles from the **unlit** WGSL modules over the
 * planner's interleaved vertex layout — a key family of its own because the
 * vertex layout is baked into the pipeline here, not a shader family of its
 * own (`wgpu-batch.ts`).
 */
export type WgpuPipelineKind = "unlit" | "clear" | "sprite" | "batch";

/**
 * §67's stencil state as a pipeline bakes it (WP-R1.3) — §57's record minus
 * `ref`, which is a **pass command** on WebGPU (`setStencilReference`) and so
 * stays out of pipeline identity: a mask writing bit 4 and one writing bit 1
 * share a pipeline and differ by one recorded pass command.
 *
 * Field values are the engine's §57 spellings, mapped to WebGPU's at creation
 * (the module-private `STENCIL_COMPARES` and `STENCIL_OPERATIONS` tables); the
 * renderer builds the record with §57's documented defaults applied, so two draws
 * under one clip record always produce one key.
 */
export interface WgpuStencilDescriptor {
  /** The comparison, `(ref & readMask) OP (stored & readMask)`. */
  readonly func: RenderItemStencil["func"];
  /** The bits the test looks at. */
  readonly readMask: number;
  /** The bits a write may change; `0` for a read-only test. */
  readonly writeMask: number;
  /** Stored on stencil-test failure. */
  readonly failOp: RenderItemStencil["failOp"];
  /** Stored when the stencil test passes and the depth test fails. */
  readonly depthFailOp: RenderItemStencil["depthFailOp"];
  /** Stored when both tests pass. */
  readonly passOp: RenderItemStencil["passOp"];
}

/**
 * What a `kind: "batch"` pipeline's one interleaved vertex buffer *contains*
 * (`wgpu-batch.ts`): the stride and offsets. What the variant *reads* is the
 * descriptor's own `map`/`vertexColors`, which may name fewer streams — see
 * {@link batchVertexBufferLayout}.
 */
export interface WgpuBatchStream {
  /** Whether the stream interleaves §55/§77's uv floats. */
  readonly uvs: boolean;
  /** Whether the stream interleaves §53's colour floats. */
  readonly colors: boolean;
}

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
  /**
   * Whether the variant samples §57's `map` — and therefore reads the uv
   * stream and binds group 1 (§77, WP-R1.2).
   *
   * A pipeline field rather than a uniform, for the reason `wgpu-unlit.ts`
   * gives at length: the cache is lazy, so a variant nothing draws is never
   * created, which inverts R-19's measured argument for the WebGL backend.
   */
  readonly map: boolean;
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
  /**
   * §67's stencil state, or absent/`null` for the overwhelmingly common draw
   * that tests nothing — every draw of every scene that predates §67, whose
   * key and whose `createRenderPipeline` descriptor are unchanged to the byte
   * (see {@link pipelineKey}). Requires a stencil-capable `depthFormat`.
   */
  readonly stencil?: WgpuStencilDescriptor | null;
  /**
   * The interleaved stream of a `kind: "batch"` pipeline; absent/`null` for
   * every other kind.
   */
  readonly batch?: WgpuBatchStream | null;
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
 *
 * The two **optional** fields (§67's `stencil`, §65's `batch`) append a
 * prefixed segment only when present. That is still a total, injective
 * function — absence appends nothing, and no required field's value can spell
 * `|s:` or `|b:` — and it is what keeps every pre-WP-R1.3 key, and therefore
 * every `four:<key>` pipeline label already recorded in landed transcripts,
 * byte-identical for a descriptor that does not carry them.
 */
export function pipelineKey(descriptor: WgpuPipelineDescriptor): string {
  let key = [
    descriptor.kind,
    descriptor.vertexColors ? "vc" : "-",
    descriptor.map ? "map" : "-",
    descriptor.blend,
    descriptor.depthTest ? "dt" : "-",
    descriptor.depthWrite ? "dw" : "-",
    descriptor.colorWrite ? "cw" : "-",
    descriptor.topology,
    descriptor.colorFormat,
    descriptor.depthFormat ?? "-",
  ].join("|");
  const stencil = descriptor.stencil ?? null;
  if (stencil !== null) {
    key +=
      `|s:${stencil.func},${String(stencil.readMask)},` +
      `${String(stencil.writeMask)},${stencil.failOp},` +
      `${stencil.depthFailOp},${stencil.passOp}`;
  }
  const batch = descriptor.batch ?? null;
  if (batch !== null) {
    key += `|b:${batch.uvs ? "uv" : "-"},${batch.colors ? "col" : "-"}`;
  }
  return key;
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

  /** Group 0's layout, retained so a textured pipeline layout can name it too. */
  readonly #drawLayout: GpuBindGroupLayout;

  /**
   * Group 1's layout, reached only when a textured pipeline is first created.
   *
   * A provider rather than a layout, because the object has to be **the same
   * one** the texture cache creates its bind groups against and because
   * creating it eagerly would put a `createBindGroupLayout` into the
   * initialization transcript of every application, textured or not (R-30b's
   * lazy-query law). `undefined` for a cache built without one: such a cache
   * answers `null` for a textured descriptor, which skips the draw the way
   * every other unsatisfiable request in this backend is skipped.
   */
  readonly #textureLayout: (() => GpuBindGroupLayout) | undefined;

  /** The two-group pipeline layout, built with the first textured pipeline. */
  #texturedPipelineLayout: GpuPipelineLayout | null = null;

  /**
   * The sprite draw's group-0 layout, reached only when a sprite pipeline is
   * first created — a provider for `#textureLayout`'s two reasons: it must be
   * **the same object** the renderer binds its sprite uniform block against,
   * and creating it eagerly would put a `createBindGroupLayout` into every
   * application's initialization transcript (`wgpu-sprite.ts`). `undefined`
   * for a cache built without one: such a cache answers `null` for a sprite
   * descriptor, which skips the draw.
   */
  readonly #spriteLayout: (() => GpuBindGroupLayout) | undefined;

  /** The sprite pipeline layout, built with the first sprite pipeline. */
  #spritePipelineLayout: GpuPipelineLayout | null = null;

  /** Pipelines by {@link pipelineKey}. Insertion-ordered, string-keyed (§33). */
  readonly #pipelines = new Map<string, GpuRenderPipeline>();

  /**
   * WGSL modules by variant key (`"unlit"`, `"unlit|vc"`, `"unlit|map"`,
   * `"unlit|vc|map"`, `"clear"`).
   *
   * A second cache, one level below the pipelines, because a module is shared
   * by every pipeline of its variant: the flat unlit shader is compiled once
   * however many blend and depth combinations draw with it.
   */
  readonly #modules = new Map<string, GpuShaderModule>();

  #disposed = false;

  constructor(
    device: GpuDevice,
    bindGroupLayout: GpuBindGroupLayout,
    textureLayout?: () => GpuBindGroupLayout,
    spriteLayout?: () => GpuBindGroupLayout,
  ) {
    this.#device = device;
    this.#textureLayout = textureLayout;
    this.#spriteLayout = spriteLayout;
    this.#drawLayout = bindGroupLayout;
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
    const layout = this.#layoutFor(descriptor);
    if (layout === null) {
      return null;
    }
    const pipeline = this.#create(descriptor, key, layout);
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
    this.#texturedPipelineLayout = null;
    this.#spritePipelineLayout = null;
  }

  /**
   * The pipeline layout `descriptor` needs: group 0 alone; group 0 and
   * group 1 for a variant that samples; or the sprite block's own group 0
   * plus group 1 for the sprite family (`wgpu-sprite.ts`).
   *
   * `null` when a pipeline is asked of a cache that was given no provider for
   * a layout it needs — see {@link WgpuPipelineCache}'s fields.
   */
  #layoutFor(descriptor: WgpuPipelineDescriptor): GpuPipelineLayout | null {
    if (descriptor.kind === "sprite") {
      const sprite = this.#spriteLayout;
      const texture = this.#textureLayout;
      if (sprite === undefined || texture === undefined) {
        return null;
      }
      this.#spritePipelineLayout ??= this.#device.createPipelineLayout({
        label: "four:pipeline-layout:sprite",
        bindGroupLayouts: [sprite(), texture()],
      });
      return this.#spritePipelineLayout;
    }
    if (!descriptor.map) {
      return this.#layout;
    }
    const provider = this.#textureLayout;
    if (provider === undefined) {
      return null;
    }
    this.#texturedPipelineLayout ??= this.#device.createPipelineLayout({
      label: "four:pipeline-layout:map",
      bindGroupLayouts: [this.#drawLayout, provider()],
    });
    return this.#texturedPipelineLayout;
  }

  /**
   * The WGSL module `kind` compiles from. `"batch"` deliberately maps onto the
   * **unlit** module keys: a batch draws through the unlit shader family
   * (`wgpu-batch.ts`), so a frame mixing batched and unbatched unlit draws of
   * one variant compiles that variant's module exactly once.
   */
  #module(
    kind: WgpuPipelineKind,
    vertexColors: boolean,
    map: boolean,
  ): GpuShaderModule {
    const key =
      kind === "clear"
        ? "clear"
        : kind === "sprite"
          ? "sprite"
          : `unlit${vertexColors ? "|vc" : ""}${map ? "|map" : ""}`;
    const existing = this.#modules.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const module = this.#device.createShaderModule({
      label: `four:${key}`,
      code:
        kind === "clear"
          ? CLEAR_SHADER_SOURCE
          : kind === "sprite"
            ? SPRITE_SHADER_SOURCE
            : unlitShaderSource(vertexColors, map),
    });
    this.#modules.set(key, module);
    return module;
  }

  /**
   * The vertex-buffer layouts `descriptor`'s pipeline reads: none for the
   * clear (its triangle is generated from the vertex index), position alone
   * for a sprite (uv is derived from the quad uniform), the planner's one
   * interleaved buffer for a batch, and the positional stream list for the
   * unlit family.
   */
  #vertexBuffers(
    descriptor: WgpuPipelineDescriptor,
  ): readonly GpuVertexBufferLayout[] {
    if (descriptor.kind === "clear") {
      return [];
    }
    if (descriptor.kind === "sprite") {
      return [POSITION_BUFFER_LAYOUT];
    }
    const batch = descriptor.batch ?? null;
    if (batch !== null) {
      return [
        batchVertexBufferLayout(
          batch.uvs,
          batch.colors,
          descriptor.map,
          descriptor.vertexColors,
        ),
      ];
    }
    return unlitVertexBufferLayouts(descriptor.vertexColors, descriptor.map);
  }

  #create(
    descriptor: WgpuPipelineDescriptor,
    key: string,
    layout: GpuPipelineLayout,
  ): GpuRenderPipeline {
    const module = this.#module(
      descriptor.kind,
      descriptor.vertexColors,
      descriptor.map,
    );
    const blend =
      descriptor.blend === "none" ? undefined : BLEND_STATES[descriptor.blend];
    return this.#device.createRenderPipeline({
      label: `four:${key}`,
      layout,
      vertex: {
        module,
        entryPoint: VERTEX_ENTRY_POINT,
        buffers: this.#vertexBuffers(descriptor),
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
              // §67's test and operations (WP-R1.3), spread only when the
              // descriptor carries them: WebGPU's defaults for the four
              // members are exactly "test always, change nothing", so a
              // stencil-free pipeline over a stencil-capable format omits
              // them — and a clipless frame's descriptors are then unchanged
              // to the byte from what WP-R1.1 recorded.
              ...this.#stencilState(descriptor.stencil ?? null),
            },
          }),
    });
  }

  /** The four stencil members of `depthStencil`, or nothing (see `#create`). */
  #stencilState(stencil: WgpuStencilDescriptor | null): {
    stencilFront?: GpuStencilFaceState;
    stencilBack?: GpuStencilFaceState;
    stencilReadMask?: number;
    stencilWriteMask?: number;
  } {
    if (stencil === null) {
      return {};
    }
    // One state for both faces: GL's stencil calls are two-sided and culling
    // is disabled on both backends (`GpuStencilFaceState`'s note).
    const face: GpuStencilFaceState = {
      compare: STENCIL_COMPARES[stencil.func],
      failOp: STENCIL_OPERATIONS[stencil.failOp],
      depthFailOp: STENCIL_OPERATIONS[stencil.depthFailOp],
      passOp: STENCIL_OPERATIONS[stencil.passOp],
    };
    return {
      stencilFront: face,
      stencilBack: face,
      stencilReadMask: stencil.readMask,
      stencilWriteMask: stencil.writeMask,
    };
  }
}
