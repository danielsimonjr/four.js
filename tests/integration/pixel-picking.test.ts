/**
 * §71's pixel/GPU-id picking across the packages that have to agree about it
 * (RFC 0005, 2026-08-28): `@four/render` owns the seam and the §33 table
 * rules, `@four/render-webgl` the registered id pass and read-back,
 * `@four/input` the render-free `PickProvider` shape, `@four/four` the
 * adapter between the last two.
 *
 * Three claims live only in the composition:
 *
 * 1. **Byte-identity for scenes that never pick — the RFC's acceptance
 *    gate.** Registering the pipeline changes no GL transcript; creating a
 *    service changes no GL transcript; and — the strong half — a frame drawn
 *    *after* an id pass is byte-identical to the same frame on a rig that
 *    never picked, because the pass restores every piece of state it borrows
 *    to the renderer's between-frames baseline.
 * 2. **The full stack resolves a texel to a node id**: a real `WebglRenderer`
 *    on a recording context, real `Scene`/`Renderable`s, one id pass, one
 *    read-back (simulated at the `readPixels` seam — pixels themselves are
 *    the browser gate's evidence, `tests/browser/picking.spec.ts`), and the
 *    id decodes through the traversal-ordered table into `Node.id` — reaching
 *    a pointer handler through `@four/four`'s `createPickProvider` without
 *    `@four/input` ever naming a render type.
 * 3. **§33's table obligations across a scene edit**: the table is rebuilt
 *    per pass in traversal order, so the same node can carry a different
 *    texel value after the scene changes while the *result* — a stable
 *    `Node.id` string — never shifts identity.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  Renderable,
  decodePickId,
  encodePickId,
  supportsPicking,
  type PickingService,
} from "@four/render";
import {
  GL,
  WebglRenderer,
  clearRegisteredPickingPipeline,
  registerPickingPipeline,
} from "@four/render-webgl";
import { createPickProvider } from "four";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { afterEach, describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

interface Rig {
  readonly renderer: WebglRenderer;
  readonly recording: RecordingGl;
  readonly view: Viewport;
  readonly views: readonly Viewport[];
}

/** The pick a test stages: what the simulated read-back will answer. */
interface ReadbackSeam {
  /** Set the texel the next `readPixels` reports, as RGBA bytes. */
  set(texel: readonly number[]): void;
  /** Arguments of every simulated read, in order. */
  readonly reads: (readonly unknown[])[];
}

/**
 * Extends the shared recording double with the optional `readPixels` entry
 * point (presence is the capability — the double predates the member), and
 * returns the seam a test stages texels through.
 *
 * Extension happens here, in this suite, rather than in `recording-gl.ts`:
 * the helper is a landed gate other suites' transcripts depend on, and the
 * read-back group is exactly the kind of optional member whose *absence*
 * elsewhere keeps proving the presence-is-the-capability contract.
 */
function attachReadback(recording: RecordingGl): ReadbackSeam {
  let texel: readonly number[] = [0, 0, 0, 0];
  const reads: (readonly unknown[])[] = [];
  const target = recording.gl as unknown as Record<string, unknown>;
  target.readPixels = (...args: unknown[]): void => {
    reads.push(args);
    const into = args[6];
    if (ArrayBuffer.isView(into)) {
      (into as Uint8Array).set(texel);
    }
  };
  return {
    set(next) {
      texel = next;
    },
    reads,
  };
}

async function createRig(): Promise<Rig> {
  const recording = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
  renderer.resize(64, 48);
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 5);
  const view = createFullscreenViewport(camera);
  return { renderer, recording, view, views: [view] };
}

/** A named quad — real geometry, real material, real node. */
function quad(name: string, renderOrder = 0): Renderable {
  const node = new Renderable(
    planeGeometry({ width: 2, height: 2 }),
    new UnlitMaterial(),
    {
      renderOrder,
    },
  );
  node.name = name;
  return node;
}

/** One small scene: two overlapping quads and one bystander. */
function createScene(): {
  scene: Scene;
  below: Renderable;
  above: Renderable;
  aside: Renderable;
} {
  const scene = new Scene();
  const below = quad("below", 0);
  const above = quad("above", 1);
  const aside = quad("aside", 0);
  aside.transform.position.set(3, 0, 0);
  scene.add(below);
  scene.add(above);
  scene.add(aside);
  resolveWorldTransforms(scene);
  return { scene, below, above, aside };
}

/** The RGBA bytes a draw of table index `index` writes. */
function texelOf(index: number): number[] {
  const encoded = new Float32Array(4);
  encodePickId(index, encoded);
  return Array.from(encoded, (component) => Math.round(component * 255));
}

afterEach(() => {
  clearRegisteredPickingPipeline();
});

describe("byte-identity for scenes that never pick (RFC 0005's acceptance gate)", () => {
  /** One frame of the scene on a fresh rig; the transcript. */
  async function frameTranscript(
    prepare?: (rig: Rig, scene: Scene) => void,
  ): Promise<string[]> {
    const rig = await createRig();
    const { scene } = createScene();
    prepare?.(rig, scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    return rig.recording.transcript();
  }

  it("registration alone changes no GL transcript", async () => {
    const unregistered = await frameTranscript();
    const registered = await frameTranscript(() => {
      registerPickingPipeline();
    });
    expect(registered).toEqual(unregistered);
  });

  it("creating a service issues no GL call at all", async () => {
    registerPickingPipeline();
    const rig = await createRig();
    rig.recording.reset();
    rig.renderer.createPickingService();
    expect(rig.recording.calls).toHaveLength(0);
  });

  it("a frame drawn after an id pass is byte-identical to one that never picked", async () => {
    // Arm A: frame, frame — the never-picking rig's second frame.
    const rigA = await createRig();
    const sceneA = createScene().scene;
    rigA.renderer.render(sceneA, rigA.views);
    rigA.recording.reset();
    rigA.renderer.render(sceneA, rigA.views);
    const neverPicked = rigA.recording.transcript();

    // Arm B: frame, id pass, frame — the picking rig's next frame must not
    // carry one borrowed bit of GL state.
    registerPickingPipeline();
    const rigB = await createRig();
    const { scene: sceneB } = createScene();
    const service = rigB.renderer.createPickingService();
    rigB.renderer.render(sceneB, rigB.views);
    service.update(sceneB, rigB.view);
    rigB.recording.reset();
    rigB.renderer.render(sceneB, rigB.views);
    const afterPicking = rigB.recording.transcript();

    expect(afterPicking).toEqual(neverPicked);
  });
});

describe("the id pass and read-back, end to end", () => {
  async function pickingRig(): Promise<{
    rig: Rig;
    service: PickingService;
    seam: ReadbackSeam;
  }> {
    registerPickingPipeline();
    const rig = await createRig();
    expect(supportsPicking(rig.renderer)).toBe(true);
    const service = rig.renderer.createPickingService();
    const seam = attachReadback(rig.recording);
    return { rig, service, seam };
  }

  it("draws the frame's items with traversal-table ids, in the frame's order", async () => {
    const { rig, service } = await pickingRig();
    const { scene } = createScene();
    service.update(scene, rig.view);

    // §66's order draws `below` and `aside` (renderOrder 0, scene order)
    // before `above` (renderOrder 1); the ids stay the traversal table's.
    // The shared recording double retains typed-array references (its
    // documented behaviour), so per-draw values are pinned by the package
    // unit suite (`gl-picking.test.ts`, which snapshots); what the
    // composition asserts is the *shape*: one id upload per draw, all into
    // the `pickId` uniform, the last one being the last-drawn item's
    // (`above`, table index 1 → value 2).
    const pickIdLocation = rig.recording
      .callsOf("getUniformLocation")
      .find((call) => call.args[1] === "pickId")?.args;
    expect(pickIdLocation).toBeDefined();
    const uploads = rig.recording
      .callsOf("uniform4fv")
      .map((call) => Array.from(call.args[1] as Float32Array));
    expect(uploads).toHaveLength(3);
    const lastUpload = new Float32Array(4);
    encodePickId(1, lastUpload);
    expect(uploads[2]).toEqual(Array.from(lastUpload));
    // `planeGeometry` is indexed, so the id pass issues indexed draws — the
    // same primitive path the frame uses.
    expect(rig.recording.countOf("drawElements")).toBe(3);
    // The pass leaves the default framebuffer bound and its own unbound.
    const binds = rig.recording.callsOf("bindFramebuffer");
    expect(binds[binds.length - 1].args[1]).toBeNull();
  });

  it("resolves a staged texel to the node the table names, through the PickProvider seam", async () => {
    const { rig, service, seam } = await pickingRig();
    const { scene, below, above, aside } = createScene();
    service.update(scene, rig.view);

    // §72's shape: the adapter closes over the service and the viewport, and
    // the pointer handler sees two numbers in, a node id out.
    const provider = createPickProvider(service, rig.view);

    seam.set(texelOf(1));
    await expect(provider.pick(0, 0)).resolves.toBe(above.id);
    seam.set(texelOf(0));
    await expect(provider.pick(0, 0)).resolves.toBe(below.id);
    seam.set(texelOf(2));
    await expect(provider.pick(0.75, 0)).resolves.toBe(aside.id);
    // The clear colour is "nothing there".
    seam.set([0, 0, 0, 0]);
    await expect(provider.pick(-0.9, -0.9)).resolves.toBeUndefined();

    // The reads named the pixels the NDC mapped to, in the 64×48 surface.
    expect(seam.reads[0].slice(0, 4)).toEqual([32, 24, 1, 1]);
    expect(seam.reads[2].slice(0, 4)).toEqual([56, 24, 1, 1]);
    expect(seam.reads[3].slice(0, 4)).toEqual([3, 2, 1, 1]);
    expect(seam.reads[0][4]).toBe(GL.RGBA);
    expect(seam.reads[0][5]).toBe(GL.UNSIGNED_BYTE);
  });

  it("rebuilds the table per pass: indices shift under a scene edit, identities never do (§33)", async () => {
    const { rig, service, seam } = await pickingRig();
    const { scene, below, above } = createScene();
    service.update(scene, rig.view);
    seam.set(texelOf(1));
    const first = await service.pick({ viewport: rig.view, ndcX: 0, ndcY: 0 });
    expect(first.nodeId).toBe(above.id);
    expect(first.frame).toBe(1);

    // Hide the first quad: `above` moves up one table slot on the next pass.
    below.visible = false;
    resolveWorldTransforms(scene);
    service.update(scene, rig.view);
    seam.set(texelOf(0));
    const second = await service.pick({
      viewport: rig.view,
      ndcX: 0,
      ndcY: 0,
    });
    expect(second.nodeId).toBe(above.id);
    expect(second.frame).toBe(2);
    // The encode/decode pair is exact through the byte round-trip.
    expect(decodePickId(new Uint8Array(texelOf(1)))).toBe(2);
  });

  it("disposes through the renderer's shared caches (§83)", async () => {
    const { rig, service } = await pickingRig();
    const { scene } = createScene();
    service.update(scene, rig.view);
    rig.recording.reset();
    service.dispose();
    expect(rig.recording.countOf("deleteProgram")).toBe(1);
    expect(rig.recording.countOf("deleteFramebuffer")).toBe(1);
    // Terminal: the next update refuses rather than drawing into nothing.
    expect(() => {
      service.update(scene, rig.view);
    }).toThrowError(/disposed/);
  });
});
