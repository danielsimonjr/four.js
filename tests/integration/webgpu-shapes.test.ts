/**
 * §50 shapes and §53/§58 vertex colours on the WebGPU backend (WP-R1.4,
 * 2026-08-28) — the WebGPU restatement of the recorded GL claims:
 *
 * - `shape-rendering.test.ts` (R-23): *a scene of shapes emits the identical
 *   GL transcript as a scene of plain `Renderable`s over the same geometries*.
 * - `shape-paints.test.ts` (R-16): *a stroked, painted shape is one `"unlit"`
 *   item and one draw, its two colours travelling as §53's per-vertex colour
 *   stream*.
 *
 * Restated here as **command-transcript identity** against the recording
 * device (`recording-gpu.ts`), which is the per-backend form §33 allows — a
 * GL transcript and a WebGPU transcript are lists in different languages, so
 * the cross-backend claim is never transcript identity; it is the
 * render-list consumption contract, asserted below in the only vocabulary
 * both backends share (draw counts and model matrices, the
 * `render-list-consumption.test.ts` technique applied to tessellated
 * shapes).
 *
 * This is deliberately a test-only packet. The unlit tier's variant plumbing
 * (WP-R1.1/R1.2) already covers every §50/§58 draw — `useVertexColors` is a
 * lazy pipeline variant whose vertex layout carries the colour stream at
 * slot 1 and omits it otherwise — so if any assertion here had needed new
 * backend code, the unlit pipeline was wrong. None did.
 *
 * The file also pins RFC 0003's residue on this backend: a **skinned** item
 * (`"skinned-unlit"`) has no WebGPU pipeline at this tier, and the recorded
 * absence rule applies — skipped before its geometry uploads, never drawn in
 * bind pose, invisible in the transcript.
 */

import { Path, planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  Circle,
  Mesh,
  PathShape,
  Rectangle,
  Renderable,
  Ring,
  Star,
  buildRenderList,
  type RenderItem,
  type Shape2D,
  type SolidPaint,
} from "@four/render";
import {
  WebglRenderer,
  clearRegisteredSkinningPipeline,
  registerSkinningPipeline,
} from "@four/render-webgl";
import { WebgpuRenderer } from "@four/render-webgpu";
import {
  Bone,
  OrthographicCamera,
  Scene,
  Skeleton,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { afterEach, describe, expect, it } from "vitest";

import { RecordingCanvas, createRecordingGl } from "./helpers/recording-gl.js";
import {
  createRecordingGpu,
  withHostGpu,
  type RecordingGpu,
} from "./helpers/recording-gpu.js";

interface Rig {
  readonly renderer: WebgpuRenderer;
  readonly gpu: RecordingGpu;
  readonly scene: Scene;
  readonly views: readonly Viewport[];
}

/** The 8 × 8 orthographic view the GL shape harnesses use, on WebGPU. */
async function createRig(): Promise<Rig> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  const scene = new Scene();
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);
  gpu.reset();
  return { renderer, gpu, scene, views: [createFullscreenViewport(camera)] };
}

/** One shape of each structural kind: convex, holed, concave, multi-region. */
function shapes(material: UnlitMaterial): Shape2D[] {
  const glyph = new Path()
    .moveTo(-2, -2)
    .lineTo(2, -2)
    .lineTo(2, 2)
    .lineTo(-2, 2)
    .close()
    .moveTo(-1, -1)
    .lineTo(-1, 1)
    .lineTo(1, 1)
    .lineTo(1, -1)
    .close();
  return [
    new Circle({ radius: 1.5, tolerance: 0.02, material }),
    new Rectangle({ width: 3, height: 2, radius: 0.4, material }),
    new Ring({ innerRadius: 0.5, outerRadius: 1, tolerance: 0.02, material }),
    new Star({ points: 5, innerRadius: 0.4, outerRadius: 1, material }),
    new PathShape({ path: glyph, material }),
  ];
}

const BLUE: SolidPaint = { kind: "solid", color: [0.25, 0.5, 1, 1] };
const WHITE: SolidPaint = { kind: "solid", color: [1, 1, 1, 1] };

/** A transcript reduced to call names — the GL harnesses' `names`, verbatim. */
function names(gpu: RecordingGpu): string[] {
  return gpu.calls.map((call) => call.name);
}

/** The index count of every `drawIndexed`, in order. */
function indexedDraws(gpu: RecordingGpu): number[] {
  return gpu.callsOf("pass.drawIndexed").map((call) => call.args[0] as number);
}

/** The labels of every pipeline the tape compiled. */
function pipelineLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createRenderPipeline")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

/** The labels of every WGSL module the tape compiled. */
function moduleLabels(gpu: RecordingGpu): string[] {
  return gpu
    .callsOf("device.createShaderModule")
    .map((call) => String((call.args[0] as { label?: string }).label));
}

describe("WP-R1.4 — §50 shapes draw through the pipeline that already existed", () => {
  it("is indistinguishable from a plain Renderable at the device boundary", async () => {
    // R-23's byte-identity claim in its WebGPU form, made mechanically: two
    // scenes that differ only in the *class* of their nodes record the
    // identical command transcript — call for call, argument for argument,
    // handle serial for handle serial, uniform byte for uniform byte. The
    // whole tape, not a projection of it: nothing in the frame path learned
    // about shapes, because there was nothing to learn.
    const shaped = await createRig();
    const family = shapes(new UnlitMaterial({ color: [1, 0.2, 0.1, 1] }));
    for (const shape of family) shaped.scene.add(shape);
    resolveWorldTransforms(shaped.scene);
    shaped.renderer.render(shaped.scene, shaped.views);

    const plain = await createRig();
    const plainMaterial = new UnlitMaterial({ color: [1, 0.2, 0.1, 1] });
    for (const shape of family) {
      plain.scene.add(new Renderable(shape.geometry, plainMaterial));
    }
    resolveWorldTransforms(plain.scene);
    plain.renderer.render(plain.scene, plain.views);

    expect(shaped.gpu.transcript()).toEqual(plain.gpu.transcript());
    expect(indexedDraws(shaped.gpu)).toHaveLength(5);
  });

  it("draws exactly the triangles §52's tessellator produced", async () => {
    const test = await createRig();
    const family = shapes(new UnlitMaterial());
    for (const shape of family) test.scene.add(shape);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    const counts = indexedDraws(test.gpu);
    expect(counts).toEqual(family.map((shape) => shape.geometry.drawCount));
    for (const count of counts) expect(count % 3).toBe(0);
  });

  it("re-uploads in place when a parameter changes, keeping the geometry id", async () => {
    const test = await createRig();
    const circle = new Circle({
      radius: 1,
      tolerance: 0.05,
      material: new UnlitMaterial(),
    });
    test.scene.add(circle);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    const id = circle.geometry.id;
    const firstDraw = indexedDraws(test.gpu);
    expect(firstDraw).toHaveLength(1);

    // A steady frame allocates nothing and uploads only the frame's one
    // uniform block write.
    test.gpu.reset();
    test.renderer.render(test.scene, test.views);
    expect(test.gpu.countOf("device.createBuffer")).toBe(0);
    expect(test.gpu.countOf("queue.writeBuffer")).toBe(1);

    // A parameter write rebuilds the fill in place — same id, so the cache
    // *replaces* its record rather than leaking the old buffers behind a new
    // key. Equal creates and destroys is what says it did not.
    circle.radius = 3;
    test.gpu.reset();
    test.renderer.render(test.scene, test.views);
    expect(circle.geometry.id).toBe(id);
    const created = test.gpu.countOf("device.createBuffer");
    const destroyed = test.gpu.countOf("buffer.destroy");
    expect(created).toBeGreaterThan(0);
    expect(created).toBe(destroyed);
    expect(indexedDraws(test.gpu)[0]).toBeGreaterThan(firstDraw[0]);
  });
});

describe("WP-R1.4 — §58 paints ride the vertex-colour variant", () => {
  it("keeps a stroked, painted shape one item, one draw, one vc pipeline", async () => {
    const material = new UnlitMaterial({ vertexColors: true });
    const shape = new Rectangle({
      width: 3,
      height: 2,
      radius: 0.3,
      material,
      fill: BLUE,
      stroke: { width: 0.1, paint: WHITE, lineJoin: "round" },
    });

    const list: RenderItem[] = [];
    const bare = new Scene();
    bare.add(shape);
    resolveWorldTransforms(bare);
    buildRenderList(bare, list);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("unlit");

    const test = await createRig();
    test.scene.add(shape);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    // The fill's triangles and the band's are one indexed range through one
    // vertex-coloured unlit pipeline — R-19's uniform switch became a
    // *variant* on this backend (`wgpu-unlit.ts`), so the flat module is
    // never even compiled for a frame that only paints.
    expect(indexedDraws(test.gpu)).toEqual([shape.geometry.drawCount]);
    expect(moduleLabels(test.gpu)).toContain("four:unlit|vc");
    expect(
      pipelineLabels(test.gpu).some((label) =>
        label.startsWith("four:unlit|vc|"),
      ),
    ).toBe(true);
  });

  it("streams the paints through vertex slot 1, four floats per vertex", async () => {
    const test = await createRig();
    const shape = new Rectangle({
      width: 3,
      height: 2,
      material: new UnlitMaterial({ vertexColors: true }),
      fill: BLUE,
      stroke: { width: 0.2, paint: WHITE },
    });
    test.scene.add(shape);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    // The vc pipeline's vertex layout: position at slot 0, then the colour
    // stream — 16-byte stride, one `float32x4` at shader location 1
    // (`COLOR_SHADER_LOCATION`). Slot index is positional; the location is a
    // name (`wgpu-unlit.ts`).
    const pipelineCall = test.gpu
      .callsOf("device.createRenderPipeline")
      .find((call) =>
        String((call.args[0] as { label?: string }).label).startsWith(
          "four:unlit|vc|",
        ),
      );
    expect(pipelineCall).toBeDefined();
    const descriptor = pipelineCall?.args[0] as {
      vertex: {
        buffers: readonly {
          arrayStride: number;
          attributes: readonly {
            format: string;
            shaderLocation: number;
          }[];
        }[];
      };
    };
    expect(descriptor.vertex.buffers).toHaveLength(2);
    expect(descriptor.vertex.buffers[1].arrayStride).toBe(16);
    expect(descriptor.vertex.buffers[1].attributes[0].format).toBe("float32x4");
    expect(descriptor.vertex.buffers[1].attributes[0].shaderLocation).toBe(1);

    // The colour stream binds at slot 1 and its bytes reach the device
    // verbatim — §52's fill colours then §58's band colours, one buffer.
    expect(
      test.gpu
        .callsOf("pass.setVertexBuffer")
        .filter((call) => call.args[0] === 1),
    ).toHaveLength(1);
    const colors = Array.from(shape.geometry.colors ?? []);
    expect(colors).toHaveLength((shape.geometry.positions.length / 3) * 4);
    expect(
      test.gpu
        .callsOf("queue.writeBuffer")
        .some(
          (call) =>
            Array.isArray(call.args[2]) &&
            (call.args[2] as number[]).length === colors.length &&
            (call.args[2] as number[]).every(
              (value, index) => value === colors[index],
            ),
        ),
    ).toBe(true);
  });

  it("records the flat call sequence for a shape that names no paint", async () => {
    // R-16's "no extra GL call" claim in WebGPU vocabulary: a stroke without
    // a paint adds triangles and nothing else — same call names in the same
    // order, no vertex-colour module, no second vertex stream. (The counts
    // differ, because the band is real geometry; the *shape* of the frame
    // does not.)
    const stroked = await createRig();
    stroked.scene.add(
      new Circle({
        radius: 1,
        tolerance: 0.05,
        material: new UnlitMaterial(),
        stroke: { width: 0.1 },
      }),
    );
    resolveWorldTransforms(stroked.scene);
    stroked.renderer.render(stroked.scene, stroked.views);

    const unpainted = await createRig();
    unpainted.scene.add(
      new Circle({
        radius: 1,
        tolerance: 0.05,
        material: new UnlitMaterial(),
      }),
    );
    resolveWorldTransforms(unpainted.scene);
    unpainted.renderer.render(unpainted.scene, unpainted.views);

    expect(names(stroked.gpu)).toEqual(names(unpainted.gpu));
    for (const test of [stroked, unpainted]) {
      expect(moduleLabels(test.gpu)).not.toContain("four:unlit|vc");
      for (const call of test.gpu.callsOf("pass.setVertexBuffer")) {
        expect(call.args[0]).toBe(0);
      }
    }
  });
});

/** One submitted draw, in the only vocabulary both backends share. */
interface DrawRecord {
  readonly count: number;
  readonly model: readonly number[];
}

/** Rounds so a `Float64Array` and a `Float32Array` of one matrix compare equal. */
function round(values: ArrayLike<number>, offset = 0): number[] {
  const out: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    out.push(Number((values[offset + index] ?? 0).toFixed(5)));
  }
  return out;
}

/**
 * What the WebGL backend actually submitted — the
 * `render-list-consumption.test.ts` technique: model matrices are snapshotted
 * **at call time** through a thin wrapper, because the GL backend uploads them
 * out of a module-level scratch array the tape would otherwise retain by
 * reference.
 */
function webglDraws(scene: Scene, views: readonly Viewport[]): DrawRecord[] {
  const recording = createRecordingGl();
  const source = recording.gl as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const draws: DrawRecord[] = [];
  let model: number[] | null = null;
  const wrapper: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of Object.keys(source)) {
    wrapper[name] = (...args: unknown[]): unknown => {
      if (name === "uniformMatrix4fv" && ArrayBuffer.isView(args[2])) {
        model = round(args[2] as unknown as ArrayLike<number>);
      } else if (name === "drawArrays" && model !== null) {
        draws.push({ count: args[2] as number, model });
      } else if (name === "drawElements" && model !== null) {
        draws.push({ count: args[1] as number, model });
      }
      return source[name]?.(...args);
    };
  }

  const canvas = new RecordingCanvas(wrapper);
  const renderer = new WebglRenderer();
  void renderer.initialize({ canvas });
  renderer.resize(256, 256, 1);
  draws.length = 0;
  renderer.render(scene, views);
  renderer.dispose();
  return draws;
}

/** What the WebGPU backend actually submitted, read back off the tape. */
async function webgpuDraws(
  scene: Scene,
  views: readonly Viewport[],
): Promise<DrawRecord[]> {
  const gpu = createRecordingGpu();
  const renderer = new WebgpuRenderer();
  await withHostGpu(gpu.gpu, async () => {
    await renderer.initialize({ canvas: gpu.canvas });
  });
  renderer.resize(256, 256, 1);
  gpu.reset();
  renderer.render(scene, views);

  const uploads = gpu.callsOf("queue.writeBuffer");
  const uniforms = uploads[uploads.length - 1]?.args[2] as number[];
  const strideFloats = 64;
  const modelOffsetFloats = 16;

  const draws: DrawRecord[] = [];
  let block = 0;
  let boundGeometry = false;
  for (const call of gpu.calls) {
    if (call.name === "pass.setBindGroup") {
      block = (call.args[2] as number[])[0] / (strideFloats * 4);
      continue;
    }
    if (call.name === "pass.setVertexBuffer") {
      boundGeometry = true;
      continue;
    }
    if (call.name === "pass.draw" || call.name === "pass.drawIndexed") {
      // A draw with no vertex buffer bound since the last one is this
      // backend's own scissored clear triangle, not a scene item.
      if (boundGeometry) {
        draws.push({
          count: call.args[0] as number,
          model: round(uniforms, block * strideFloats + modelOffsetFloats),
        });
      }
      boundGeometry = false;
    }
  }
  renderer.dispose();
  return draws;
}

describe("WP-R1.4 — the render-list consumption contract holds for shapes", () => {
  it("hands WebGL 2 and WebGPU the identical shape draw sequence, kind for kind", async () => {
    // A shape scene chosen so §66's sort keys all do something: two opaque
    // fills, a painted vc rectangle, a transparent star and an explicitly
    // ordered ring. Both backends must consume every item — same draws, same
    // order, same transforms — because both consume the *same* `RenderItem[]`
    // and neither re-sorts privately (§33, §61).
    const scene = new Scene();
    const opaque = new UnlitMaterial({ color: [1, 0.3, 0.2, 1] });
    const painted = new UnlitMaterial({ vertexColors: true });
    const glass = new UnlitMaterial({
      color: [0.2, 0.4, 1, 0.5],
      transparent: true,
    });

    const circle = new Circle({
      radius: 1.2,
      tolerance: 0.02,
      material: opaque,
    });
    circle.transform.position.set(-1.5, 0, 0);
    const rectangle = new Rectangle({
      width: 2,
      height: 1.2,
      radius: 0.2,
      material: painted,
      fill: BLUE,
      stroke: { width: 0.1, paint: WHITE },
    });
    rectangle.transform.position.set(1.5, 0, -1);
    const star = new Star({
      points: 5,
      innerRadius: 0.4,
      outerRadius: 1,
      material: glass,
    });
    star.transform.position.set(0, 1, -1.5);
    const ring = new Ring({
      innerRadius: 0.5,
      outerRadius: 1,
      tolerance: 0.02,
      material: opaque,
    });
    ring.renderOrder = -1;
    ring.transform.position.set(0, -2, 0);
    scene.add(circle);
    scene.add(rectangle);
    scene.add(star);
    scene.add(ring);

    const camera = new OrthographicCamera({
      left: -4,
      right: 4,
      bottom: -4,
      top: 4,
    });
    camera.transform.position.set(0, 0, 5);
    scene.add(camera);
    resolveWorldTransforms(scene);
    const views = [createFullscreenViewport(camera)];

    // Every shape is an ordinary `"unlit"` item — no WebGPU-specific kind.
    const frame = buildRenderList(scene, []);
    expect(frame.map((item) => item.kind)).toEqual([
      "unlit",
      "unlit",
      "unlit",
      "unlit",
    ]);

    const gl = webglDraws(scene, views);
    const gpu = await webgpuDraws(scene, views);
    expect(gl).toHaveLength(4);
    expect(gpu).toEqual(gl);
  });
});

describe("WP-R1.4 — RFC 0003 skinned items follow the recorded absence rule", () => {
  afterEach(() => {
    clearRegisteredSkinningPipeline();
  });

  /** A plane whose four vertices all follow joint 0 with full weight. */
  function skinnedPlaneGeometry(): ReturnType<typeof planeGeometry> {
    const geometry = planeGeometry({ width: 2, height: 2 });
    const vertexCount = geometry.vertexCount;
    geometry.joints = new Uint16Array(vertexCount * 4);
    const weights = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i += 1) {
      weights[i * 4] = 1;
    }
    geometry.weights = weights;
    return geometry;
  }

  /** A one-bone skinned mesh, its bone parented under it. */
  function skinnedMesh(material: UnlitMaterial): Mesh<UnlitMaterial> {
    const mesh = new Mesh(skinnedPlaneGeometry(), material);
    const bone = new Bone();
    mesh.add(bone);
    mesh.skeleton = new Skeleton([bone]);
    return mesh;
  }

  it("skips a skinned mesh transcript-invisibly — no upload, no draw, no throw", async () => {
    // The WP-9.1 rule, applied to a pipeline this backend does not have: a
    // `"skinned-unlit"` item is skipped *before* its geometry uploads, so a
    // scene with a skinned mesh records the byte-identical transcript of the
    // same scene without it — absent, never approximated in bind pose.
    const shared = planeGeometry({ width: 2, height: 2 });

    const withSkin = await createRig();
    withSkin.scene.add(
      new Renderable(shared, new UnlitMaterial({ color: [1, 0.2, 0.1, 1] })),
    );
    const mesh = skinnedMesh(new UnlitMaterial({ color: [0.2, 1, 0.1, 1] }));
    withSkin.scene.add(mesh);
    resolveWorldTransforms(withSkin.scene);

    // The list carries the skinned item — the *builder* did its job; the
    // backend is what declines it.
    const frame = buildRenderList(withSkin.scene, []);
    expect(frame.map((item) => item.kind).sort()).toEqual([
      "skinned-unlit",
      "unlit",
    ]);

    withSkin.renderer.render(withSkin.scene, withSkin.views);

    const without = await createRig();
    without.scene.add(
      new Renderable(shared, new UnlitMaterial({ color: [1, 0.2, 0.1, 1] })),
    );
    resolveWorldTransforms(without.scene);
    without.renderer.render(without.scene, without.views);

    expect(withSkin.gpu.transcript()).toEqual(without.gpu.transcript());
    // Nothing of the skinned geometry reached the device: no buffer label
    // carries its id.
    for (const call of withSkin.gpu.callsOf("device.createBuffer")) {
      expect(String((call.args[0] as { label?: string }).label)).not.toContain(
        mesh.geometry.id,
      );
    }
  });

  it("is skipped on WebGPU while the registered GL pipeline draws it", async () => {
    // The honest asymmetry, pinned rather than papered over: §54 skinning is
    // closed on WebGL 2 (RFC 0003's lazily registered pipeline) and *absent*
    // on WebGPU until a joint-palette pipeline exists. One scene, two
    // backends: GL submits both draws, WebGPU submits exactly the unskinned
    // one — with the same model matrix GL used for it.
    registerSkinningPipeline();
    const scene = new Scene();
    const plain = new Renderable(
      planeGeometry({ width: 2, height: 2 }),
      new UnlitMaterial({ color: [1, 0.2, 0.1, 1] }),
    );
    plain.transform.position.set(-1, 0, 0);
    scene.add(plain);
    scene.add(skinnedMesh(new UnlitMaterial({ color: [0.2, 1, 0.1, 1] })));
    const camera = new OrthographicCamera({
      left: -4,
      right: 4,
      bottom: -4,
      top: 4,
    });
    camera.transform.position.set(0, 0, 5);
    scene.add(camera);
    resolveWorldTransforms(scene);
    const views = [createFullscreenViewport(camera)];

    const gl = webglDraws(scene, views);
    const gpu = await webgpuDraws(scene, views);
    expect(gl).toHaveLength(2);
    expect(gpu).toHaveLength(1);
    expect(gl).toContainEqual(gpu[0]);
  });
});
