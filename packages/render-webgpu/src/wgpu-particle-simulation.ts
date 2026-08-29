/**
 * `WgpuParticleSimulation` — the device side of §36's `simulation: "gpu"`
 * (gap row R-31's residue, wired 2026-08-29): the implementor of
 * `@four/particles`' structural `ParticleGpuSimulation` contract, over
 * WP-R1.8's §82 compute tier.
 *
 * ## What lives here, and what does not
 *
 * This class owns the device residency: flat x,y,z position and velocity
 * storage buffers in the pool's own layout (which is exactly what
 * `PARTICLE_INTEGRATOR_SHADER_SOURCE` reads), the 32-byte params block, and
 * the three verbs the emitter calls per fixed step — `integrate` (one
 * dispatch of the WP-R1.8 kernel), `writeSpawn` (CPU spawn state entering
 * residency), and `moveSlot` (the device mirror of the pool's swap-remove).
 * Everything §33-bearing — RNG, bursts, ageing, expiry, ramps — stays in
 * `@four/particles`; `types.ts` there owns the division-of-labour argument
 * and the §33/§34 posture (display-tier motion; no golden checksums a GPU
 * pool; no snapshot surface).
 *
 * ## The position buffer is also a vertex buffer (decision, R-31 wiring)
 *
 * `positions` is allocated `STORAGE | VERTEX | COPY_DST | COPY_SRC` — one
 * usage bit more than `createComputeBuffer`'s trio — because the §36 draw
 * binds it **directly as the per-instance position stream**
 * (`PARTICLE_GPU_VERTEX_BUFFER_LAYOUTS` in `wgpu-particles.ts`): the whole
 * point of GPU residency is that integrated positions are drawn from where
 * they were computed, never read back per frame and never copied into the
 * interleaved instance buffer (a strided scatter `copyBufferToBuffer`
 * cannot express). The renderer finds this simulation at draw time by the
 * emitting node's id ({@link WgpuParticleSimulation.systemId}) — the same
 * key `WgpuParticleCache` already uses — so no render-item field and no
 * `@four/render` change was needed. Both buffers are wrapped as
 * {@link WgpuComputeBuffer} so the §82 readback path (`readComputeBuffer`)
 * serves them verbatim — which is how the browser spec reads an integrated
 * step back exactly, and how a diagnostic can inspect a live system.
 *
 * ## `moveSlot` goes through a 24-byte scratch
 *
 * WebGPU forbids a `copyBufferToBuffer` whose source and destination are the
 * same buffer, and a kill's move is intra-buffer — so each move is four
 * recorded copies via a persistent scratch (position → scratch@0 → slot;
 * velocity → scratch@12 → slot), one encoder, one submit. Copies execute in
 * submission order, which is the emitter's compaction order, so chained
 * moves within one step resolve exactly as the CPU channels do. Deaths per
 * step are bounded by the pool and typically few; batching many moves into
 * one encoder is a possible refinement, recorded here, not built — the
 * honest cost today is one small submit per death.
 *
 * ## Presence is the capability (§62, §82)
 *
 * Creation — `WebgpuRenderer.createParticleSimulation` — refuses with
 * `UNSUPPORTED_GPU_FEATURE` on a device surface lacking the compute entry
 * points or `copyBufferToBuffer` (probed up front, so the failure names
 * itself at authoring time rather than mid-simulation). WebGL 2 never grows
 * the factory at all, which is how a §36 GPU emitter is structurally
 * impossible to wire to a backend that cannot run it; §62's
 * `computeShaders` capability is how an application asks first.
 */

import { FourError } from "@four/core";

import {
  GPU_BUFFER_USAGE,
  type GpuBuffer,
  type GpuDevice,
} from "./webgpu-device.js";
import {
  PARTICLE_INTEGRATOR_SHADER_SOURCE,
  PARTICLE_SIMULATION_PARAMS_FLOATS,
  WgpuComputeBuffer,
  WgpuComputeCache,
  createComputeBuffer,
  particleIntegratorWorkgroups,
  writeComputeBuffer,
  writeParticleSimulationParams,
} from "./wgpu-compute.js";

/** Bytes per particle in each flat x,y,z lane buffer (3 × f32). */
export const PARTICLE_SIMULATION_VECTOR_BYTES = 12;

/** Bytes of the intra-buffer move scratch: one position + one velocity. */
export const PARTICLE_SIMULATION_SCRATCH_BYTES = 24;

/** Options of `WebgpuRenderer.createParticleSimulation`. */
export interface WgpuParticleSimulationOptions {
  /**
   * The emitting node's stable id (`ParticleDrawable.id`) — the key the
   * renderer's draw path joins on, exactly as `WgpuParticleCache` keys the
   * instance buffer. One simulation per system id.
   */
  readonly systemId: string;

  /**
   * Pool capacity in particles — must equal the emitter's, and
   * `bindGpuSimulation` re-checks the pairing from the other side. A
   * positive safe integer.
   */
  readonly capacity: number;

  /** Diagnostic name, echoed on buffer and pass labels. */
  readonly label?: string;
}

/** Throws `INVALID_APPLICATION_STATE` for a call this module refuses. */
function refuse(message: string, context: Record<string, unknown>): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/** Throws `UNSUPPORTED_GPU_FEATURE` for an absent device entry point. */
function unsupported(message: string): never {
  throw new FourError("UNSUPPORTED_GPU_FEATURE", message);
}

/**
 * The device residency of one `simulation: "gpu"` particle system — see the
 * module header. Created by `WebgpuRenderer.createParticleSimulation`;
 * **the caller owns it and disposes it** (§83, the `createPickingService`
 * ownership rule), and its buffers die with the device either way (a
 * destroyed device makes `destroy()` a defined no-op).
 */
export class WgpuParticleSimulation {
  /** `@four/particles`' structural brand — a literal `true`. */
  readonly isParticleGpuSimulation = true;

  /** The emitting node's id this simulation is registered under. */
  readonly systemId: string;

  /** Slots the device buffers hold. */
  readonly capacity: number;

  /**
   * Flat x,y,z position lanes, `capacity × 12` bytes — the buffer the §36
   * draw binds as the per-instance position stream (module header), and a
   * readable §82 buffer (`readComputeBuffer`) for diagnostics and tests.
   */
  readonly positions: WgpuComputeBuffer;

  /** Flat x,y,z velocity lanes, `capacity × 12` bytes. Readable likewise. */
  readonly velocities: WgpuComputeBuffer;

  /** The integrator's 32-byte params block (`writeParticleSimulationParams`). */
  readonly #params: WgpuComputeBuffer;

  /** The intra-buffer move scratch (module header). */
  readonly #scratch: GpuBuffer;

  readonly #device: GpuDevice;
  readonly #compute: WgpuComputeCache;
  readonly #label: string;
  readonly #onDispose: (() => void) | undefined;

  /** Params staging, rewritten whole per integrate (§33's no-history rule). */
  readonly #paramsStaging = new Float32Array(PARTICLE_SIMULATION_PARAMS_FLOATS);

  /** Spawn staging — reused; `queue.writeBuffer` copies at call time. */
  readonly #spawnStaging = new Float32Array(3);

  #disposed = false;

  /**
   * Internal — obtain instances through
   * `WebgpuRenderer.createParticleSimulation`, which supplies the device,
   * the shared compute cache, and the registry unhook.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` for a capacity that is not
   * a positive safe integer; `UNSUPPORTED_GPU_FEATURE` when the device
   * surface lacks the compute entry points or `copyBufferToBuffer` — probed
   * here, up front, so the refusal lands at authoring time (§85).
   */
  constructor(
    device: GpuDevice,
    compute: WgpuComputeCache,
    options: WgpuParticleSimulationOptions,
    onDispose?: () => void,
  ) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity <= 0) {
      refuse(
        "createParticleSimulation needs a positive safe-integer capacity " +
          "(§36) — the emitter's own maxParticles.",
        { capacity: options.capacity, systemId: options.systemId },
      );
    }
    if (device.createComputePipeline === undefined) {
      unsupported(
        "This device surface does not implement the §82 compute entry " +
          "points, so §36's GPU particle simulation cannot run here — ask " +
          "§62's `computeShaders` capability before creating one.",
      );
    }
    // Probe the copy entry point now rather than at the first death: the
    // encoder is recorded nowhere and dropped, and the refusal names itself
    // where the simulation is authored (§85).
    const probe = device.createCommandEncoder({
      label: "four:particle-sim:probe",
    });
    if (probe.copyBufferToBuffer === undefined) {
      unsupported(
        "This device surface does not implement copyBufferToBuffer, which " +
          "§36's GPU particle simulation needs to mirror pool compaction.",
      );
    }

    this.#device = device;
    this.#compute = compute;
    this.systemId = options.systemId;
    this.capacity = options.capacity;
    this.#label = options.label ?? `four:particle-sim:${options.systemId}`;
    this.#onDispose = onDispose;

    const laneBytes = options.capacity * PARTICLE_SIMULATION_VECTOR_BYTES;
    // Positions carry VERTEX on top of createComputeBuffer's trio — the one
    // recorded deviation (module header): the draw binds this allocation as
    // the per-instance position stream.
    this.positions = new WgpuComputeBuffer(
      device.createBuffer({
        label: `${this.#label}:positions`,
        size: laneBytes,
        usage:
          GPU_BUFFER_USAGE.STORAGE |
          GPU_BUFFER_USAGE.VERTEX |
          GPU_BUFFER_USAGE.COPY_DST |
          GPU_BUFFER_USAGE.COPY_SRC,
      }),
      laneBytes,
    );
    this.velocities = createComputeBuffer(device, {
      label: `${this.#label}:velocities`,
      size: laneBytes,
    });
    this.#params = createComputeBuffer(device, {
      label: `${this.#label}:params`,
      size: PARTICLE_SIMULATION_PARAMS_FLOATS * 4,
    });
    this.#scratch = device.createBuffer({
      label: `${this.#label}:scratch`,
      size: PARTICLE_SIMULATION_SCRATCH_BYTES,
      usage: GPU_BUFFER_USAGE.COPY_SRC | GPU_BUFFER_USAGE.COPY_DST,
    });
  }

  /** Whether {@link WgpuParticleSimulation.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * One integrator dispatch over the first `count` slots — params packed
   * whole (`count` as f32, the WP-R1.8 precedent), then the WP-R1.8 kernel
   * at `particleIntegratorWorkgroups(count)`.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` after dispose, or for a
   * count outside `(0, capacity]` — the emitter never sends zero, and a
   * count beyond the buffers would integrate garbage lanes.
   */
  integrate(
    count: number,
    deltaSeconds: number,
    gravityX: number,
    gravityY: number,
    gravityZ: number,
  ): void {
    this.#requireLive("integrate");
    if (!Number.isSafeInteger(count) || count <= 0 || count > this.capacity) {
      refuse(
        "integrate's count must be a positive safe integer within the " +
          "simulation's capacity (§36).",
        { count, capacity: this.capacity },
      );
    }
    writeParticleSimulationParams(
      this.#paramsStaging,
      deltaSeconds,
      count,
      gravityX,
      gravityY,
      gravityZ,
    );
    writeComputeBuffer(this.#device, this.#params, this.#paramsStaging);
    const dispatched = this.#compute.dispatch({
      label: this.#label,
      shader: PARTICLE_INTEGRATOR_SHADER_SOURCE,
      workgroups: particleIntegratorWorkgroups(count),
      bindings: [
        { buffer: this.#params, access: "read-only" },
        this.positions,
        this.velocities,
      ],
    });
    if (!dispatched) {
      // Unreachable through the constructor's probe on a stable surface;
      // kept because the cache reports honestly and swallowing `false`
      // here would be the silent no-op §85 forbids.
      unsupported(
        "The device surface lost its §82 compute entry points after this " +
          "simulation was created.",
      );
    }
  }

  /**
   * Writes one spawned particle's position and velocity into slot `index` —
   * two 12-byte `writeBuffer`s from a reused staging triple (`writeBuffer`
   * copies at call time, so reuse is safe).
   *
   * @throws FourError `INVALID_APPLICATION_STATE` after dispose or for an
   * index outside `[0, capacity)`.
   */
  writeSpawn(
    index: number,
    positionX: number,
    positionY: number,
    positionZ: number,
    velocityX: number,
    velocityY: number,
    velocityZ: number,
  ): void {
    this.#requireLive("writeSpawn");
    this.#requireSlot("writeSpawn", index);
    const staging = this.#spawnStaging;
    const offset = index * PARTICLE_SIMULATION_VECTOR_BYTES;
    staging[0] = positionX;
    staging[1] = positionY;
    staging[2] = positionZ;
    writeComputeBuffer(this.#device, this.positions, staging, offset);
    staging[0] = velocityX;
    staging[1] = velocityY;
    staging[2] = velocityZ;
    writeComputeBuffer(this.#device, this.velocities, staging, offset);
  }

  /**
   * Copies slot `from`'s position and velocity over slot `to` — four
   * recorded copies through the scratch (module header), one submit.
   *
   * @throws FourError `INVALID_APPLICATION_STATE` after dispose, for an
   * index outside `[0, capacity)`, or for `from === to` (the emitter never
   * sends it, and a self-move is a call-contract violation worth naming).
   */
  moveSlot(from: number, to: number): void {
    this.#requireLive("moveSlot");
    this.#requireSlot("moveSlot", from);
    this.#requireSlot("moveSlot", to);
    if (from === to) {
      refuse(
        "moveSlot's source and destination are the same slot — the " +
          "emitter's compaction never sends this (§36; types.ts contract).",
        { from, to },
      );
    }
    const device = this.#device;
    const encoder = device.createCommandEncoder({
      label: `${this.#label}:move`,
    });
    if (encoder.copyBufferToBuffer === undefined) {
      // The constructor probed this member; a surface that answers
      // differently per encoder is broken, and the honest response is the
      // capability error, not a skipped move.
      unsupported(
        "The device surface lost copyBufferToBuffer after this simulation " +
          "was created.",
      );
    }
    const sourceOffset = from * PARTICLE_SIMULATION_VECTOR_BYTES;
    const targetOffset = to * PARTICLE_SIMULATION_VECTOR_BYTES;
    const bytes = PARTICLE_SIMULATION_VECTOR_BYTES;
    const boundCopy = encoder.copyBufferToBuffer.bind(encoder);
    boundCopy(this.positions.buffer, sourceOffset, this.#scratch, 0, bytes);
    boundCopy(this.#scratch, 0, this.positions.buffer, targetOffset, bytes);
    boundCopy(
      this.velocities.buffer,
      sourceOffset,
      this.#scratch,
      bytes,
      bytes,
    );
    boundCopy(
      this.#scratch,
      bytes,
      this.velocities.buffer,
      targetOffset,
      bytes,
    );
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Releases the four allocations (§83). Idempotent, safe after device
   * loss (`destroy()` on an invalidated buffer is a defined no-op), and
   * unhooks this simulation from the renderer's draw-time registry so a
   * later frame falls back to the CPU instance stream rather than binding
   * a destroyed buffer.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.positions.dispose();
    this.velocities.dispose();
    this.#params.dispose();
    this.#scratch.destroy();
    this.#onDispose?.();
  }

  /** The lifecycle gate every verb runs first (§83). */
  #requireLive(method: string): void {
    if (this.#disposed) {
      refuse(`${method} was called on a disposed particle simulation (§83).`, {
        systemId: this.systemId,
      });
    }
  }

  /** Slot-range gate shared by `writeSpawn` and `moveSlot`. */
  #requireSlot(method: string, index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.capacity) {
      refuse(`${method} was given a slot outside [0, capacity) (§36).`, {
        index,
        capacity: this.capacity,
      });
    }
  }
}
