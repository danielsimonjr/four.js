/**
 * The batched particle pipeline for the WebGPU backend (§36, §64 stage 6,
 * WP-R1.8) — the port of `gl-particles.ts`'s instanced billboard draw.
 *
 * One particle system is **one draw call**: `draw(6, count)` over the six
 * vertices of `@four/render`'s shared unit quad, with `count` instances fed
 * from a per-system vertex buffer re-uploaded once per frame. The §112 scaling
 * argument is `gl-particles.ts`'s, unchanged: the CPU cost of drawing a system
 * is one `queue.writeBuffer` of `count × 32` bytes plus a handful of pass
 * commands, whatever `count` is.
 *
 * ## What ports straight across, and what evaporates
 *
 * The *contract* is `@four/render`'s `particles.ts`, byte for byte: the same
 * interleaved 8-float instance stream, the same view-space billboard (offset
 * between `view` and `projection`), the same flat opaque-edged quad, the same
 * straight-alpha `"normal"` blend a material-less item cannot override, the
 * same depth-test/depth-write defaults (§57's, with no material to say
 * otherwise). The GL module's **vertex array object does not port** — WebGPU
 * records attribute layouts into the pipeline (`PARTICLE_VERTEX_BUFFER_LAYOUTS`
 * below) and binds raw buffers per draw, so the GL cache's stale-VAO
 * bookkeeping (`cornerBuffer` recorded per record, rebuilt when the shared
 * quad's buffer moves) has nothing to guard here: the corner stream is bound
 * fresh every draw from the geometry cache's current record. That is why
 * {@link WgpuParticleRecord} is two fields where `ParticleBatchRecord` is four.
 *
 * ## The uniform block: three matrices, a third group-0 layout
 *
 * The billboard offset happens **between** the view and the projection, so this
 * pipeline needs the two matrices separately rather than the premultiplied
 * `viewProjection` every other family reads — plus the system's `model`. That
 * is 192 bytes, more than `DrawUniforms`' 144, and the resolution is the §55
 * sprite decision verbatim: a **separate group-0 layout over the same strided
 * uniform buffer** (`wgpu-sprite.ts` carries the whole byte-transcript
 * argument — widening the shared block would move `minBindingSize` in every
 * landed initialization transcript). The 256-byte stride's spare bytes were
 * already allocated; a particle block reads 48 more of them, and 192 is still
 * inside the stride. The layout is `VERTEX`-only: the fragment stage reads
 * nothing but the interpolated instance colour.
 *
 * ## Upload cadence — a stated deviation from GL
 *
 * The GL path re-uploads the instance stream once per **view** (uniform uploads
 * are ambient there and the upload rides beside them). Here the stream is
 * uploaded once per **frame** ({@link WgpuParticleCache.upload} keeps the
 * frame ordinal on the record): `updateParticleInstances` runs once per
 * `buildRenderList`, i.e. once per `render` call, so the bytes cannot differ
 * between views — and `queue.writeBuffer` executes in queue order, so a second
 * upload between two recorded draws would overwrite the first *before either
 * draw executes* (`wgpu-batch.ts`'s recorded hazard). Identical bytes make
 * that harmless; uploading once makes it impossible.
 *
 * ## Attribute locations
 *
 * Slot 0 is the shared corner quad (`POSITION_BUFFER_LAYOUT`, location 0);
 * slot 1 is the interleaved instance stream, `stepMode: "instance"`, at
 * locations 1–3 — mirroring GL's `PARTICLE_ATTRIBUTE_LOCATIONS` table.
 * Locations 1 and 2 mean colour and uv in the *unlit* family; a shader
 * location is a name **per family** (`wgpu-unlit.ts`'s rule), and this family
 * has exactly one module, so the numbers cannot collide with anything.
 */

import {
  PARTICLE_COLOR_OFFSET,
  PARTICLE_INSTANCE_FLOATS,
  PARTICLE_POSITION_OFFSET,
  PARTICLE_ROTATION_OFFSET,
  PARTICLE_SIZE_OFFSET,
  PARTICLE_SOFTNESS_OFFSET,
  PARTICLE_WIDE_INSTANCE_FLOATS,
  type ParticleRenderItem,
} from "@four/render";

import {
  GPU_BUFFER_USAGE,
  GPU_SHADER_STAGE,
  type GpuBindGroupLayout,
  type GpuBuffer,
  type GpuDevice,
  type GpuVertexBufferLayout,
} from "./webgpu-device.js";
import {
  FRAGMENT_ENTRY_POINT,
  POSITION_BUFFER_LAYOUT,
  VERTEX_ENTRY_POINT,
} from "./wgpu-unlit.js";

/** Byte offset of `ParticleUniforms.projection`. */
export const PARTICLE_PROJECTION_OFFSET = 0;

/** Byte offset of `ParticleUniforms.view`. */
export const PARTICLE_VIEW_OFFSET = 64;

/** Byte offset of `ParticleUniforms.model`. */
export const PARTICLE_MODEL_OFFSET = 128;

/**
 * Size of the `ParticleUniforms` block in bytes — three `mat4x4<f32>`.
 *
 * The binding size, not the 256-byte stride (`DRAW_UNIFORM_BYTES`'
 * distinction): both bindings read the same strided buffer, and only the
 * sizes differ. A particle block fills its whole binding, so no spare byte
 * inside it is ever uploaded unwritten.
 */
export const PARTICLE_UNIFORM_BYTES = 192;

/** Bytes per instance — `@four/render`'s interleaved 8-float stride. */
export const PARTICLE_INSTANCE_STRIDE_BYTES =
  PARTICLE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

/**
 * The particle draw's group-0 layout: binding 0, a dynamically-offset uniform
 * buffer of {@link PARTICLE_UNIFORM_BYTES}, visible to the **vertex stage
 * only** — the fragment stage reads the interpolated instance colour and no
 * uniform at all, so declaring fragment visibility would reserve a slot
 * nothing reads (`createTextureBindGroupLayout`'s per-stage-limit argument).
 *
 * Created lazily by the renderer's first particle draw — the sprite layout's
 * lifecycle, third block size over one buffer — so a particle-less
 * application records the identical initialization transcript.
 */
export function createParticleBindGroupLayout(
  device: GpuDevice,
): GpuBindGroupLayout {
  return device.createBindGroupLayout({
    label: "four:particle-uniforms",
    entries: [
      {
        binding: 0,
        visibility: GPU_SHADER_STAGE.VERTEX,
        buffer: {
          type: "uniform",
          hasDynamicOffset: true,
          minBindingSize: PARTICLE_UNIFORM_BYTES,
        },
      },
    ],
  });
}

/**
 * The WGSL declaration of the block above — `DRAW_UNIFORM_WGSL`'s discipline:
 * the layout the pipeline declares and the layout the shader reads live side
 * by side in one module, so they cannot drift.
 */
export const PARTICLE_UNIFORM_WGSL = `struct ParticleUniforms {
  projection : mat4x4<f32>,
  view : mat4x4<f32>,
  model : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> draw : ParticleUniforms;`;

/**
 * Vertex layout of the interleaved instance stream: `@four/render`'s 32-byte
 * stride, advancing **once per instance**, carrying the particle's centre
 * (`vec3`, location 1), current world-unit size (`f32`, location 2) and
 * current straight-alpha RGBA (`vec4`, location 3) — GL's
 * `PARTICLE_ATTRIBUTE_LOCATIONS` and `vertexAttribPointer` table as one
 * declared object.
 */
export const PARTICLE_INSTANCE_BUFFER_LAYOUT: GpuVertexBufferLayout =
  Object.freeze({
    arrayStride: PARTICLE_INSTANCE_STRIDE_BYTES,
    stepMode: "instance",
    attributes: Object.freeze([
      Object.freeze({
        format: "float32x3",
        offset: PARTICLE_POSITION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 1,
      }),
      Object.freeze({
        format: "float32",
        offset: PARTICLE_SIZE_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 2,
      }),
      Object.freeze({
        format: "float32x4",
        offset: PARTICLE_COLOR_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 3,
      }),
    ]),
  });

/**
 * The particle pipeline's two vertex buffers, in slot order: the shared corner
 * quad per vertex, then the instance stream per instance.
 */
export const PARTICLE_VERTEX_BUFFER_LAYOUTS: readonly GpuVertexBufferLayout[] =
  Object.freeze([POSITION_BUFFER_LAYOUT, PARTICLE_INSTANCE_BUFFER_LAYOUT]);

/**
 * Vertex layout of a **GPU-simulated** system's position stream (§36
 * `simulation: "gpu"`, R-31 wiring): the simulation's flat x,y,z storage
 * buffer — `wgpu-particle-simulation.ts`'s `positions`, allocated with
 * `VERTEX` for exactly this bind — read per instance at the same
 * `@location(1)` the interleaved stream feeds, 12-byte stride.
 *
 * Same shader module, different plumbing: the WGSL above never changes,
 * because a location is a name and this layout merely re-sources it — which
 * is what makes the GPU variant one pipeline-cache entry
 * (`gpuInstances: true`, `wgpu-pipeline-cache.ts`) and zero new WGSL.
 */
export const PARTICLE_GPU_POSITION_BUFFER_LAYOUT: GpuVertexBufferLayout =
  Object.freeze({
    arrayStride: 12,
    stepMode: "instance",
    attributes: Object.freeze([
      Object.freeze({
        format: "float32x3",
        offset: 0,
        shaderLocation: 1,
      }),
    ]),
  });

/**
 * Vertex layout of the CPU half of a GPU-simulated draw: the **same**
 * interleaved 32-byte instance stream, minus the position attribute — size
 * and colour are ramp values, functions of CPU-side age, and keep riding the
 * per-frame repack; the stale position lanes in that stream stride past
 * unread (`@four/particles`' `updateParticleInstances` documents the lanes).
 */
export const PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT: GpuVertexBufferLayout =
  Object.freeze({
    arrayStride: PARTICLE_INSTANCE_STRIDE_BYTES,
    stepMode: "instance",
    attributes: Object.freeze([
      Object.freeze({
        format: "float32",
        offset: PARTICLE_SIZE_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 2,
      }),
      Object.freeze({
        format: "float32x4",
        offset: PARTICLE_COLOR_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 3,
      }),
    ]),
  });

/**
 * The GPU-simulated particle pipeline's three vertex buffers, in slot order:
 * the shared corner quad, the simulation's position storage buffer, then the
 * interleaved stream for size and colour.
 */
export const PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS: readonly GpuVertexBufferLayout[] =
  Object.freeze([
    POSITION_BUFFER_LAYOUT,
    PARTICLE_GPU_POSITION_BUFFER_LAYOUT,
    PARTICLE_GPU_INSTANCE_BUFFER_LAYOUT,
  ]);

/**
 * The particle WGSL module — the GL vertex/fragment pair, translated.
 *
 * One variant, like the sprite's: a particle always carries its colour in the
 * instance stream and never samples (§36's sprite/mesh particle modes are
 * staged with the §55 texture path, exactly as recorded in `gl-particles.ts`),
 * so this is a constant rather than a generator.
 *
 * The billboard is GL's, verbatim: the centre transforms through
 * `view · model`, the corner offset lands in **view space** scaled by the
 * per-instance size, and only then does the projection apply — which is what
 * makes the quad face the camera with no per-system billboard matrix. The
 * depth remap is `wgpu-unlit.ts`'s, applied after the projection with the
 * same one multiply-add. The fragment stage is the interpolated instance
 * colour, unchanged — a solid, opaque-edged square, the honest §36 MVP.
 */
/** Bytes per instance of the R-32 wide stream (rotation + softness). */
export const PARTICLE_WIDE_INSTANCE_STRIDE_BYTES =
  PARTICLE_WIDE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;

/**
 * Wide instance layout (R-32): the 8-float stream plus rotation and softness.
 * Default emitters never use this table.
 */
export const PARTICLE_WIDE_INSTANCE_BUFFER_LAYOUT: GpuVertexBufferLayout =
  Object.freeze({
    arrayStride: PARTICLE_WIDE_INSTANCE_STRIDE_BYTES,
    stepMode: "instance",
    attributes: Object.freeze([
      Object.freeze({
        format: "float32x3",
        offset: PARTICLE_POSITION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 1,
      }),
      Object.freeze({
        format: "float32",
        offset: PARTICLE_SIZE_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 2,
      }),
      Object.freeze({
        format: "float32x4",
        offset: PARTICLE_COLOR_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 3,
      }),
      Object.freeze({
        format: "float32",
        offset: PARTICLE_ROTATION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 4,
      }),
      Object.freeze({
        format: "float32",
        offset: PARTICLE_SOFTNESS_OFFSET * Float32Array.BYTES_PER_ELEMENT,
        shaderLocation: 5,
      }),
    ]),
  });

/**
 * R-32 appearance WGSL — textured / rotated / soft. Not the default pipeline
 * (`PARTICLE_SHADER_SOURCE` stays the 8-float flat quad). Soft fade samples
 * a bound scene-depth texture when `hasSceneDepth` is set; otherwise
 * `saturate(1 − |viewZ| · softness)`.
 */
export const PARTICLE_APPEARANCE_SHADER_SOURCE = `${PARTICLE_UNIFORM_WGSL}

struct AppearanceUniforms {
  useMap : f32,
  hasSceneDepth : f32,
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(1) var<uniform> appearance : AppearanceUniforms;
@group(1) @binding(0) var mapTexture : texture_2d<f32>;
@group(1) @binding(1) var mapSampler : sampler;
@group(1) @binding(2) var sceneDepth : texture_2d<f32>;

struct AppearanceVertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
  @location(1) uv : vec2<f32>,
  @location(2) softness : f32,
  @location(3) viewZ : f32,
};

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(0) corner : vec3<f32>,
  @location(1) instancePosition : vec3<f32>,
  @location(2) instanceSize : f32,
  @location(3) instanceColor : vec4<f32>,
  @location(4) instanceRotation : f32,
  @location(5) instanceSoftness : f32,
) -> AppearanceVertexOutput {
  var output : AppearanceVertexOutput;
  var center = draw.view * draw.model * vec4<f32>(instancePosition, 1.0);
  let c = cos(instanceRotation);
  let s = sin(instanceRotation);
  let rx = corner.x * c - corner.y * s;
  let ry = corner.x * s + corner.y * c;
  center.x = center.x + rx * instanceSize;
  center.y = center.y + ry * instanceSize;
  let clip = draw.projection * center;
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  output.color = instanceColor;
  output.uv = vec2<f32>(corner.x + 0.5, corner.y + 0.5);
  output.softness = instanceSoftness;
  output.viewZ = center.z;
  return output;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : AppearanceVertexOutput) -> @location(0) vec4<f32> {
  var color = input.color;
  if (appearance.useMap > 0.5) {
    color = color * textureSample(mapTexture, mapSampler, input.uv);
  }
  var fade = 1.0;
  if (input.softness > 0.0) {
    if (appearance.hasSceneDepth > 0.5) {
      let sceneZ = textureSample(sceneDepth, mapSampler, input.position.xy).r;
      fade = clamp(abs(sceneZ - input.position.z) / max(input.softness, 1e-5), 0.0, 1.0);
    } else {
      fade = clamp(1.0 - abs(input.viewZ) * input.softness, 0.0, 1.0);
    }
  }
  color.a = color.a * fade;
  return color;
}
`;

export const PARTICLE_SHADER_SOURCE = `${PARTICLE_UNIFORM_WGSL}

struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@vertex
fn ${VERTEX_ENTRY_POINT}(
  @location(0) corner : vec3<f32>,
  @location(1) instancePosition : vec3<f32>,
  @location(2) instanceSize : f32,
  @location(3) instanceColor : vec4<f32>,
) -> VertexOutput {
  var output : VertexOutput;
  var center = draw.view * draw.model * vec4<f32>(instancePosition, 1.0);
  center.x = center.x + corner.x * instanceSize;
  center.y = center.y + corner.y * instanceSize;
  let clip = draw.projection * center;
  // WebGL clip depth [-w, w] onto WebGPU's [0, w]; see wgpu-unlit.ts.
  output.position = vec4<f32>(clip.x, clip.y, (clip.z + clip.w) * 0.5, clip.w);
  output.color = instanceColor;
  return output;
}

@fragment
fn ${FRAGMENT_ENTRY_POINT}(input : VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`;

/** Everything one particle system needs at draw time. */
export interface WgpuParticleRecord {
  /** The per-system instance buffer, allocated at the system's full capacity. */
  readonly buffer: GpuBuffer;

  /** Floats the buffer was allocated for — the system's capacity × 8. */
  readonly capacityFloats: number;

  /**
   * The renderer frame ordinal of the last upload — the once-per-frame gate
   * (see the module header on the cadence deviation from GL). `0` on a fresh
   * record; the renderer's ordinal starts at 1.
   */
  uploadedFrame: number;
}

/**
 * Per-device store of particle instance buffers, keyed by the emitting node's
 * id (§61, §64 stage 7) — `ParticleBatchCache`'s contract minus the vertex
 * arrays WebGPU does not have.
 *
 * One cache belongs to one device, like `WgpuGeometryCache`: built at
 * initialization (which allocates nothing), `forget()` on device loss,
 * `dispose()` with the renderer. The eviction policy is the GL cache's,
 * verbatim: records rebuild lazily on the next `acquire` when the capacity
 * changes, and a system removed from the scene keeps its buffer until the
 * renderer is disposed — the same documented leak window `GeometryCache`
 * carries, for §83's creator-owns reasons.
 */
export class WgpuParticleCache {
  readonly #device: GpuDevice;

  /** Records by `ParticleRenderItem.id`. */
  readonly #records = new Map<string, WgpuParticleRecord>();

  #disposed = false;

  constructor(device: GpuDevice) {
    this.#device = device;
  }

  /** Number of particle systems currently holding GPU buffers (§83, §84). */
  get size(): number {
    return this.#records.size;
  }

  /** Whether {@link WgpuParticleCache.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Returns the instance buffer for `item`, creating it on first use and
   * re-creating it when the system's capacity has changed.
   *
   * Returns `null` — and creates no entry — when the system has no capacity
   * at all, and once disposed (a draw racing teardown skips rather than
   * resurrecting the cache — the reentrant-dispose family's rule). **Never
   * throws**: this runs inside `Renderer.render`, where §61 forbids it.
   */
  acquire(item: ParticleRenderItem): WgpuParticleRecord | null {
    if (this.#disposed) {
      return null;
    }
    const capacityFloats = item.instances.length;
    const existing = this.#records.get(item.id);
    if (existing !== undefined) {
      if (existing.capacityFloats === capacityFloats) {
        return existing;
      }
      existing.buffer.destroy();
      this.#records.delete(item.id);
    }

    if (capacityFloats === 0) {
      return null;
    }

    const buffer = this.#device.createBuffer({
      label: `four:particles:${item.id}`,
      size: capacityFloats * Float32Array.BYTES_PER_ELEMENT,
      usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
    });
    const record: WgpuParticleRecord = {
      buffer,
      capacityFloats,
      uploadedFrame: 0,
    };
    this.#records.set(item.id, record);
    return record;
  }

  /**
   * Uploads `item`'s live instances into `record`'s buffer — the frame's only
   * particle traffic, `count × 32` bytes — unless `frame` already did (the
   * once-per-frame cadence; the module header owns the argument).
   *
   * The five-argument `writeBuffer` form is what keeps this allocation-free:
   * `dataOffset` and `size` are in *elements* of `item.instances`, so no
   * `subarray` view is created per system per frame (plan D7 — the GL
   * module's `bufferSubData` decision, one API over).
   *
   * The caller has already skipped a zero-count system (`item.count === 0`
   * skips the draw before the cache is consulted, as GL's arm does), so the
   * range here is always non-empty.
   */
  upload(
    record: WgpuParticleRecord,
    item: ParticleRenderItem,
    frame: number,
  ): void {
    if (record.uploadedFrame === frame) {
      return;
    }
    this.#device.queue.writeBuffer(
      record.buffer,
      0,
      item.instances,
      0,
      item.count * (item.instanceFloats ?? PARTICLE_INSTANCE_FLOATS),
    );
    record.uploadedFrame = frame;
  }

  /**
   * Drops every record **without destroying anything** — the device-loss path
   * (§61). The allocations belong to a device that no longer exists.
   */
  forget(): void {
    this.#records.clear();
  }

  /** Destroys every instance buffer and marks the cache disposed (§83). Idempotent. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const record of this.#records.values()) {
      record.buffer.destroy();
    }
    this.#records.clear();
  }
}
