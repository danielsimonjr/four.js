/**
 * R-23 — §50's shape nodes reaching a real backend (2026-08-09).
 *
 * The shape family lives in `@four/render` and the geometry it is made of
 * lives in `@four/geometry`; what makes the packet worth having is a claim
 * about three packages agreeing, and no unit test inside any one of them can
 * check it:
 *
 * 1. **A shape is a `Renderable`, all the way down to the GL calls.** The
 *    packet deliberately adds no `RenderItemKind` and no backend pipeline: a
 *    shape carries a `SurfaceMaterial` and draws through the flat-colour
 *    program every ordinary renderable already used. The strong form of that
 *    claim is that the backend **cannot tell the difference** — a scene of
 *    shapes emits the identical GL call sequence as a scene of plain
 *    `Renderable`s holding the same geometry — and that is asserted here call
 *    for call. It is also the byte-identity argument for the packet: the frame
 *    path was not edited, and the sequence proves nothing new joined it.
 * 2. **A parameter write costs exactly one re-upload.** A shape rebuilds its
 *    fill in place and keeps the geometry id, so the backend's `GeometryCache`
 *    replaces the entry it already has rather than leaking the old one behind a
 *    new id. That is an assertion about the *cache*, which only exists in the
 *    backend, about an *id*, which only the shape controls.
 * 3. **A shape's fill is real geometry.** The triangles reach `drawElements`
 *    with the counts §52's tessellator produced.
 *
 * The scene is real — a real `Scene`, a real `OrthographicCamera`, real shapes,
 * real materials — and only the GL context is a double, for the reason
 * `packages/render-webgl/tests` gives at length: the backend's whole GL surface
 * is one interface, so a recording object implementing it is a complete double,
 * call order included. What a real driver adds is checked by the Playwright
 * gate.
 */

import { UnlitMaterial } from "@four/materials";
import {
  Circle,
  PathShape,
  Rectangle,
  Renderable,
  Ring,
  Star,
  buildRenderList,
  type RenderItem,
  type Shape2D,
} from "@four/render";
import { Path } from "@four/geometry";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordedCall,
  type RecordingGl,
} from "./helpers/recording-gl.js";

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  const camera = new OrthographicCamera({ height: 8, aspect: 1 });
  camera.transform.position.set(0, 0, 5);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    views: [createFullscreenViewport(camera)],
  };
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

/** A GL transcript as call names, with the handle serials that shift removed. */
function names(calls: readonly RecordedCall[]): string[] {
  return calls.map((call) => call.name);
}

/** The `(mode, count, type, offset)` of every indexed draw, in order. */
function draws(calls: readonly RecordedCall[]): unknown[][] {
  return calls
    .filter((call) => call.name === "drawElements")
    .map((call) => [...call.args]);
}

describe("R-23 — §50 shapes draw through the pipeline that already existed", () => {
  it("generates ordinary unlit render items, with no new item kind", () => {
    const material = new UnlitMaterial({ color: [1, 0.2, 0.1, 1] });
    const scene = new Scene();
    for (const shape of shapes(material)) scene.add(shape);
    resolveWorldTransforms(scene);

    const list: RenderItem[] = [];
    buildRenderList(scene, list);
    expect(list).toHaveLength(5);
    for (const item of list) {
      expect(item.kind).toBe("unlit");
      expect(item.material).toBe(material);
      expect(item.geometry.vertexCount).toBeGreaterThan(2);
      expect(item.geometry.indices).toBeDefined();
    }
  });

  it("is indistinguishable from a plain Renderable at the GL boundary", async () => {
    // The packet's byte-identity argument, made mechanically rather than
    // asserted: two scenes that differ only in the *class* of their nodes emit
    // the same calls in the same order with the same draw counts. Nothing in
    // the frame path learned about shapes, because there was nothing to learn.
    const shaped = await harness();
    const shapeMaterial = new UnlitMaterial({ color: [1, 0.2, 0.1, 1] });
    const family = shapes(shapeMaterial);
    for (const shape of family) shaped.scene.add(shape);
    resolveWorldTransforms(shaped.scene);
    shaped.recorder.calls.length = 0;
    shaped.renderer.render(shaped.scene, shaped.views);

    const plain = await harness();
    const plainMaterial = new UnlitMaterial({ color: [1, 0.2, 0.1, 1] });
    for (const shape of family) {
      plain.scene.add(new Renderable(shape.geometry, plainMaterial));
    }
    resolveWorldTransforms(plain.scene);
    plain.recorder.calls.length = 0;
    plain.renderer.render(plain.scene, plain.views);

    expect(names(shaped.recorder.calls)).toEqual(names(plain.recorder.calls));
    expect(draws(shaped.recorder.calls)).toEqual(draws(plain.recorder.calls));
    expect(draws(shaped.recorder.calls)).toHaveLength(5);
  });

  it("re-uploads in place when a parameter changes, keeping the geometry id", async () => {
    const test = await harness();
    const circle = new Circle({
      radius: 1,
      tolerance: 0.05,
      material: new UnlitMaterial(),
    });
    test.scene.add(circle);
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views);
    const id = circle.geometry.id;
    const firstDraw = draws(test.recorder.calls);
    expect(firstDraw).toHaveLength(1);

    // A steady frame uploads nothing: the cache entry is current.
    test.recorder.calls.length = 0;
    test.renderer.render(test.scene, test.views);
    expect(
      test.recorder.calls.filter((call) => call.name === "bufferData"),
    ).toHaveLength(0);

    // A parameter write re-uploads the one geometry, and **replaces** its
    // cache entry rather than adding a second one: the id is a cache key, so a
    // rebuild that minted a new geometry would create buffers without ever
    // deleting the old ones. Equal creates and deletes is what says it did not.
    circle.radius = 3;
    test.recorder.calls.length = 0;
    test.renderer.render(test.scene, test.views);
    expect(circle.geometry.id).toBe(id);
    const created = test.recorder.calls.filter(
      (call) => call.name === "createBuffer",
    ).length;
    const deleted = test.recorder.calls.filter(
      (call) => call.name === "deleteBuffer",
    ).length;
    expect(
      test.recorder.calls.filter((call) => call.name === "bufferData").length,
    ).toBeGreaterThan(0);
    expect(created).toBe(deleted);
    expect(created).toBeGreaterThan(0);
    expect(draws(test.recorder.calls)[0][1]).toBeGreaterThan(
      firstDraw[0][1] as number,
    );
  });

  it("draws exactly the triangles §52's tessellator produced", async () => {
    const test = await harness();
    const family = shapes(new UnlitMaterial());
    for (const shape of family) test.scene.add(shape);
    resolveWorldTransforms(test.scene);
    test.recorder.calls.length = 0;
    test.renderer.render(test.scene, test.views);

    const counts = draws(test.recorder.calls).map((args) => args[1]);
    expect(counts).toEqual(family.map((shape) => shape.geometry.drawCount));
    // Every count is a whole number of triangles, and a ring's is the annulus,
    // not the disc: bridging its hole costs the extra vertices §52 documents.
    for (const count of counts) expect((count as number) % 3).toBe(0);
  });

  it("skips a disposed shape rather than drawing an empty one", async () => {
    const test = await harness();
    const circle = new Circle({ material: new UnlitMaterial() });
    test.scene.add(circle);
    resolveWorldTransforms(test.scene);
    circle.dispose();

    test.recorder.calls.length = 0;
    test.renderer.render(test.scene, test.views);
    expect(draws(test.recorder.calls)).toHaveLength(0);
  });
});
