/**
 * §36 `simulation: "gpu"` end to end on the WebGPU backend (R-31 wiring,
 * 2026-08-29) — the real `@four/particles` emitter bound to a real
 * `WgpuParticleSimulation`, drawn by `WebgpuRenderer` from the simulation's
 * own position buffer.
 *
 * The recording device proves the *plumbing*: the emitter's per-step calls
 * become dispatches, spawn writes and scratch copies on the tape; the draw
 * binds three vertex buffers — corner quad, the simulation's positions, the
 * CPU ramp stream — through the `|gi:y` pipeline variant; and, the packet's
 * byte-identity obligation, a CPU-simulated scene's frame tape is unchanged
 * by the mere existence of a registered simulation. What the tape cannot
 * prove — that integrated positions land where the draw reads them — is
 * `tests/browser/webgpu/webgpu-gpu-particles.spec.ts`'s claim on a real
 * adapter.
 *
 * The Q3 promotion's cross-package claims ride here too: `supportsCompute`
 * tells the backends apart, and `Four.ComputePass`'s named map reaches a
 * dispatch in insertion order.
 */

import { Vector3 } from "@four/math";
import { ParticleEmitter, ParticleRenderable } from "@four/particles";
import { PARTICLE_INSTANCE_FLOATS, supportsCompute } from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  WebgpuRenderer,
  type WgpuParticleSimulation,
} from "@four/render-webgpu";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { isFourError } from "@four/core";
import { ComputePass } from "four";
import { describe, expect, it } from "vitest";

import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

const DT = 1 / 60;

/** Live particles the burst below leaves in the pool. */
const BURST_COUNT = 5;

interface Fountain {
  readonly scene: Scene;
  readonly renderable: ParticleRenderable;
  readonly emitter: ParticleEmitter;
  readonly views: readonly Viewport[];
}

/** The webgpu-particles.test.ts fountain, switchable to GPU simulation. */
function fountain(simulation: "cpu" | "gpu"): Fountain {
  const emitter = new ParticleEmitter({
    maxParticles: 16,
    seed: 42,
    simulation,
    emissionRate: 0,
    bursts: [{ time: 0, count: BURST_COUNT }],
    lifetime: { min: 10, max: 10 },
    initialSpeed: { min: 1, max: 1 },
    direction: new Vector3(0, 1, 0),
    spreadAngle: 0.4,
    size: { start: 0.5, end: 0.1 },
    color: {
      start: { r: 1, g: 0.5, b: 0.25, a: 1 },
      end: { r: 0, g: 0, b: 1, a: 0 },
    },
  });

  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);
  const renderable = new ParticleRenderable(emitter);
  scene.add(renderable);
  resolveWorldTransforms(scene);
  return {
    scene,
    renderable,
    emitter,
    views: [createFullscreenViewport(camera)],
  };
}

/** An initialized WebGPU renderer over a fresh recording device. */
async function webgpuRig(): Promise<{
  gpu: RecordingGpu;
  renderer: WebgpuRenderer;
}> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  return { gpu, renderer };
}

/**
 * Renumbers a transcript's handle serials by order of first appearance —
 * alpha-equivalence for tapes. Two transcripts equal under this map made
 * the identical calls with the identically *structured* objects; only the
 * global mint counter differed (here: the subject's unrelated simulation
 * minted four buffers between frames, shifting every later serial).
 */
function normalized(transcript: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return transcript.map((line) =>
    line.replace(/"serial":(\d+)/g, (_match, serial: string) => {
      let index = seen.get(serial);
      if (index === undefined) {
        index = seen.size;
        seen.set(serial, index);
      }
      return `"serial":${String(index)}`;
    }),
  );
}

/** Registers and binds a simulation for `fountain`'s renderable. */
function bind(renderer: WebgpuRenderer, rig: Fountain): WgpuParticleSimulation {
  const simulation = renderer.createParticleSimulation({
    systemId: rig.renderable.id,
    capacity: rig.emitter.pool.capacity,
  });
  rig.emitter.bindGpuSimulation(simulation);
  return simulation;
}

describe("GPU-simulated particles, wired end to end (§36, R-31)", () => {
  it("steps become dispatches and spawn writes on the device tape", async () => {
    const { gpu, renderer } = await webgpuRig();
    const rig = fountain("gpu");
    const simulation = bind(renderer, rig);
    gpu.reset();

    rig.emitter.step(DT, 0); // burst: five writeSpawn pairs, no integrate
    expect(gpu.countOf("computePass.dispatchWorkgroups")).toBe(0);
    expect(
      gpu
        .callsOf("queue.writeBuffer")
        .filter((call) => call.args[0] === simulation.positions.buffer),
    ).toHaveLength(BURST_COUNT);

    gpu.reset();
    rig.emitter.step(DT, DT); // one integrator dispatch over the five
    expect(gpu.countOf("computePass.dispatchWorkgroups")).toBe(1);
    expect(gpu.callsOf("computePass.dispatchWorkgroups")[0]?.args).toEqual([
      1, 1, 1,
    ]);
    renderer.dispose();
    simulation.dispose();
  });

  it("draws from the simulation's position buffer through the |gi:y variant", async () => {
    const { gpu, renderer } = await webgpuRig();
    const rig = fountain("gpu");
    const simulation = bind(renderer, rig);
    rig.emitter.step(DT, 0);
    gpu.reset();

    renderer.render(rig.scene, rig.views);

    // One instanced draw of the five, exactly as the CPU path submits.
    const draws = gpu.callsOf("pass.draw");
    expect(draws).toHaveLength(2); // clear + system
    expect(draws[1]?.args.slice(0, 2)).toEqual([6, BURST_COUNT]);

    // Three vertex buffers: corner quad, the simulation's positions, the
    // interleaved CPU stream demoted to ramp duty.
    const binds = gpu.callsOf("pass.setVertexBuffer");
    expect(binds).toHaveLength(3);
    expect(binds.map((call) => call.args[0])).toEqual([0, 1, 2]);
    expect(binds[1]?.args[1]).toBe(simulation.positions.buffer);
    expect(binds[1]?.args[1]).not.toBe(binds[2]?.args[1]);

    // The pipeline is the GPU-instance variant — key segment `|gi:y` — with
    // the three-buffer vertex layout baked in.
    const pipelines = gpu
      .callsOf("device.createRenderPipeline")
      .map(
        (call) =>
          call.args[0] as {
            label?: string;
            vertex: { buffers: readonly unknown[] };
          },
      )
      .filter((descriptor) => descriptor.label?.includes("particles") === true);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.label).toContain("|gi:y");
    expect(pipelines[0]?.vertex.buffers).toHaveLength(3);

    // The ramp stream still uploads once per frame — size and colour are
    // CPU truth; only positions changed residency.
    const floats = BURST_COUNT * PARTICLE_INSTANCE_FLOATS;
    expect(
      gpu
        .callsOf("queue.writeBuffer")
        .filter((call) => call.args[4] === floats),
    ).toHaveLength(1);
    renderer.dispose();
    simulation.dispose();
  });

  it("falls back to the CPU stream once the simulation is disposed", async () => {
    const { gpu, renderer } = await webgpuRig();
    const rig = fountain("gpu");
    const simulation = bind(renderer, rig);
    rig.emitter.step(DT, 0);
    simulation.dispose();
    gpu.reset();

    renderer.render(rig.scene, rig.views);
    // Two vertex buffers — the landed CPU-path draw; no destroyed buffer is
    // ever bound.
    expect(gpu.callsOf("pass.setVertexBuffer")).toHaveLength(2);
    renderer.dispose();
  });

  it("keeps a CPU-simulated frame byte-identical beside a registered simulation", async () => {
    // Control: a CPU fountain, warmed up, second frame taped.
    const control = await webgpuRig();
    const controlScene = fountain("cpu");
    controlScene.emitter.step(DT, 0);
    control.renderer.render(controlScene.scene, controlScene.views);
    control.gpu.reset();
    control.renderer.render(controlScene.scene, controlScene.views);
    const controlTape = control.gpu.transcript();

    // Subject: the identical scene and warmup, plus an *unrelated* GPU
    // simulation registered between the frames.
    const subject = await webgpuRig();
    const subjectScene = fountain("cpu");
    subjectScene.emitter.step(DT, 0);
    subject.renderer.render(subjectScene.scene, subjectScene.views);
    const simulation = subject.renderer.createParticleSimulation({
      systemId: "some-other-system",
      capacity: 8,
    });
    subject.gpu.reset();
    subject.renderer.render(subjectScene.scene, subjectScene.views);

    // Equal under serial renumbering (see `normalized`): the simulation's
    // four buffer mints shifted the global handle counter between frames,
    // and that counter is the *only* thing they may shift — every call,
    // argument, and object structure must match.
    expect(normalized(subject.gpu.transcript())).toEqual(
      normalized(controlTape),
    );
    control.renderer.dispose();
    subject.renderer.dispose();
    simulation.dispose();
  });

  it("refuses a duplicate system id, and unhooks on dispose", async () => {
    const { renderer } = await webgpuRig();
    const rig = fountain("gpu");
    const simulation = bind(renderer, rig);
    try {
      renderer.createParticleSimulation({
        systemId: rig.renderable.id,
        capacity: 16,
      });
      throw new Error("expected a duplicate-id refusal");
    } catch (error: unknown) {
      if (!isFourError(error)) {
        throw error;
      }
      expect(error.code).toBe("INVALID_APPLICATION_STATE");
    }
    simulation.dispose();
    // The registry slot is free again once the owner disposed the first.
    const second = renderer.createParticleSimulation({
      systemId: rig.renderable.id,
      capacity: 16,
    });
    expect(second.disposed).toBe(false);
    renderer.dispose();
    second.dispose();
  });
});

describe("the Q3 promotion across the backends (§82)", () => {
  it("supportsCompute tells the backends apart", async () => {
    const { renderer } = await webgpuRig();
    expect(supportsCompute(renderer)).toBe(true);
    expect(supportsCompute(new WebglRenderer())).toBe(false);
    renderer.dispose();
  });

  it("Four.ComputePass's named map dispatches in insertion order", async () => {
    const { gpu, renderer } = await webgpuRig();
    const parameters = renderer.createComputeBuffer({ size: 32 });
    const positions = renderer.createComputeBuffer({ size: 96 });
    const velocities = renderer.createComputeBuffer({ size: 96 });
    gpu.reset();

    const pass = new ComputePass({
      label: "named",
      shader: "@compute fn computeMain() {}",
      workgroups: [2, 1, 1],
      bindings: {
        parameters: { buffer: parameters, access: "read-only" },
        positions,
        velocities,
      },
    });
    if (!supportsCompute(renderer)) {
      throw new Error("the WebGPU backend declares compute");
    }
    renderer.compute(pass);

    // Read-only params first, then the two read-write lanes — the map's
    // insertion order became @binding(0..2), and the layout pattern "rww".
    const group = gpu
      .callsOf("device.createBindGroup")
      .map(
        (call) =>
          call.args[0] as {
            label?: string;
            entries: readonly {
              binding: number;
              resource: { buffer: unknown };
            }[];
          },
      )
      .find((descriptor) => descriptor.label === "four:compute:named");
    expect(group?.entries.map((entry) => entry.binding)).toEqual([0, 1, 2]);
    expect(group?.entries[0]?.resource.buffer).toBe(parameters.buffer);
    expect(group?.entries[1]?.resource.buffer).toBe(positions.buffer);
    expect(group?.entries[2]?.resource.buffer).toBe(velocities.buffer);
    const layout = gpu
      .callsOf("device.createBindGroupLayout")
      .map((call) => call.args[0] as { label?: string })
      .find((descriptor) => descriptor.label?.startsWith("four:compute:"));
    expect(layout?.label).toBe("four:compute:rww");
    renderer.dispose();
    parameters.dispose();
    positions.dispose();
    velocities.dispose();
  });
});
