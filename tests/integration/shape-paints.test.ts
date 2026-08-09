/**
 * R-16 — §58's paints and strokes reaching a real backend (2026-08-09).
 *
 * `R-23`'s sibling file (`shape-rendering.test.ts`) proved that a *filled*
 * shape is indistinguishable from a plain `Renderable` at the GL boundary.
 * §58 adds a second colour and a second set of triangles to the same node, and
 * the claim this packet makes is that neither of them reached the frame path:
 *
 * 1. **A stroked, painted shape is still one `"unlit"` item and one draw.**
 *    The fill and the band share a geometry, and their two colours travel as
 *    §53's per-vertex colour stream through the uniform switch `R-19` already
 *    built. No `RenderItemKind`, no pipeline, no branch.
 * 2. **A shape that names no paint issues no additional GL call.** The
 *    `useVertexColors` uniform sits at GL's initial `0` and the backend mirrors
 *    it on the CPU, so §58's arrival is invisible to every scene authored
 *    before it — the mirror-at-GL-initial-`0` property, sixth confirmation.
 * 3. **The colour stream reaches attribute location 3**, the one `R-19` fixed,
 *    with four floats per vertex.
 * 4. **A painted scene survives §79 through the umbrella**, materials catalog
 *    and all, and draws the same triangles after the round trip.
 *
 * Only the GL context is a double, for `shape-rendering.test.ts`'s reason.
 */

import { UnlitMaterial } from "@four/materials";
import {
  Circle,
  Line,
  Polyline,
  Rectangle,
  Renderable,
  Star,
  buildRenderList,
  type RenderItem,
  type Shape2D,
  type SolidPaint,
} from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { registerSceneNodeTypes, resourceCatalog } from "four";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@four/serialization";
import { Group } from "@four/scene";
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

const BLUE: SolidPaint = { kind: "solid", color: [0.25, 0.5, 1, 1] };
const WHITE: SolidPaint = { kind: "solid", color: [1, 1, 1, 1] };

const names = (calls: readonly RecordedCall[]): string[] =>
  calls.map((call) => call.name);

const draws = (calls: readonly RecordedCall[]): unknown[][] =>
  calls
    .filter((call) => call.name === "drawElements")
    .map((call) => [...call.args]);

describe("R-16 — §58 paints draw through the pipeline that already existed", () => {
  it("keeps a stroked, painted shape one unlit item with one draw", async () => {
    const material = new UnlitMaterial({ vertexColors: true });
    const shapes: Shape2D[] = [
      new Rectangle({
        width: 3,
        height: 2,
        radius: 0.3,
        material,
        fill: BLUE,
        stroke: { width: 0.1, paint: WHITE, lineJoin: "round" },
      }),
      new Star({
        points: 5,
        innerRadius: 0.4,
        outerRadius: 1,
        material,
        fill: BLUE,
        stroke: { width: 0.05, paint: WHITE, dash: [0.2, 0.1] },
      }),
      new Line({
        start: { x: -2, y: -2 },
        end: { x: 2, y: -2 },
        material,
        stroke: { width: 0.08, paint: WHITE, lineCap: "round" },
      }),
      new Polyline({
        points: [
          { x: -2, y: 2 },
          { x: 0, y: 3 },
          { x: 2, y: 2 },
        ],
        material,
        stroke: { width: 0.08, paint: BLUE, lineJoin: "bevel" },
      }),
    ];

    const list: RenderItem[] = [];
    const scene = new Scene();
    for (const shape of shapes) scene.add(shape);
    resolveWorldTransforms(scene);
    buildRenderList(scene, list);
    expect(list).toHaveLength(4);
    for (const item of list) {
      expect(item.kind).toBe("unlit");
      expect(item.material).toBe(material);
    }

    const test = await harness();
    for (const shape of shapes) test.scene.add(shape);
    resolveWorldTransforms(test.scene);
    test.recorder.calls.length = 0;
    test.renderer.render(test.scene, test.views);
    // One draw per node: the fill's triangles and the band's are one indexed
    // range, which is what makes §49's staged `material: Material[]` unneeded
    // at this tier.
    expect(draws(test.recorder.calls)).toHaveLength(4);
  });

  it("is still indistinguishable from a plain Renderable over the same geometry", async () => {
    const material = new UnlitMaterial({ vertexColors: true });
    const shape = new Rectangle({
      width: 3,
      height: 2,
      material,
      fill: BLUE,
      stroke: { width: 0.2, paint: WHITE },
    });

    const shaped = await harness();
    shaped.scene.add(shape);
    resolveWorldTransforms(shaped.scene);
    shaped.recorder.calls.length = 0;
    shaped.renderer.render(shaped.scene, shaped.views);

    const plain = await harness();
    plain.scene.add(new Renderable(shape.geometry, material));
    resolveWorldTransforms(plain.scene);
    plain.recorder.calls.length = 0;
    plain.renderer.render(plain.scene, plain.views);

    expect(names(shaped.recorder.calls)).toEqual(names(plain.recorder.calls));
    expect(draws(shaped.recorder.calls)).toEqual(draws(plain.recorder.calls));
  });

  it("issues no extra GL call for a shape that names no paint", async () => {
    // The mirror-at-GL-initial-0 property, applied to §58: `useVertexColors`
    // starts at 0 on both sides, and a stroke without a paint never moves it —
    // so adding a *band* to a scene costs triangles and nothing else.
    const unpainted = await harness();
    const plainMaterial = new UnlitMaterial();
    unpainted.scene.add(
      new Circle({ radius: 1, tolerance: 0.05, material: plainMaterial }),
    );
    resolveWorldTransforms(unpainted.scene);
    unpainted.recorder.calls.length = 0;
    unpainted.renderer.render(unpainted.scene, unpainted.views);

    const stroked = await harness();
    stroked.scene.add(
      new Circle({
        radius: 1,
        tolerance: 0.05,
        material: plainMaterial,
        stroke: { width: 0.1 },
      }),
    );
    resolveWorldTransforms(stroked.scene);
    stroked.recorder.calls.length = 0;
    stroked.renderer.render(stroked.scene, stroked.views);

    expect(names(stroked.recorder.calls)).toEqual(
      names(unpainted.recorder.calls),
    );
    // Neither uploads a colour buffer, and neither touches the feature switch.
    for (const test of [unpainted, stroked]) {
      expect(
        test.recorder.calls.filter(
          (call) =>
            call.name === "enableVertexAttribArray" && call.args[0] === 3,
        ),
      ).toHaveLength(0);
    }
  });

  it("streams the paints through attribute 3, four floats per vertex", async () => {
    const test = await harness();
    const shape = new Rectangle({
      width: 3,
      height: 2,
      material: new UnlitMaterial({ vertexColors: true }),
      fill: BLUE,
      stroke: { width: 0.2, paint: WHITE },
    });
    test.scene.add(shape);
    resolveWorldTransforms(test.scene);
    test.recorder.calls.length = 0;
    test.renderer.render(test.scene, test.views);

    const colorAttribute = test.recorder.calls.filter(
      (call) => call.name === "vertexAttribPointer" && call.args[0] === 3,
    );
    expect(colorAttribute).toHaveLength(1);
    expect(colorAttribute[0].args[1]).toBe(4);
    expect(
      test.recorder.calls.filter(
        (call) => call.name === "enableVertexAttribArray" && call.args[0] === 3,
      ),
    ).toHaveLength(1);
    expect(shape.geometry.colors).toHaveLength(
      (shape.geometry.positions.length / 3) * 4,
    );
  });

  it("round-trips a painted, stroked scene through §79 and draws the same triangles", () => {
    const material = new UnlitMaterial({ vertexColors: true });
    const io = registerSceneNodeTypes({
      materials: resourceCatalog([["material/ink", material]]),
    });
    const root = new Group();
    root.add(
      new Rectangle({
        width: 3,
        height: 2,
        radius: 0.25,
        material,
        fill: { kind: "solid", color: [0.25, 0.5, 1, 0.5], opacity: 0.5 },
        stroke: {
          width: 0.1,
          paint: WHITE,
          alignment: "outside",
          lineJoin: "round",
          dash: [0.5, 0.25],
        },
      }),
    );
    root.add(
      new Line({
        start: { x: -1, y: 0 },
        end: { x: 1, y: 0 },
        material,
        stroke: { width: 0.05, paint: BLUE, lineCap: "round" },
      }),
    );

    const text = encodeSceneDocument(
      serializeScene(root, io.components, io.write),
    );
    const reloaded = instantiateScene(
      decodeSceneDocument(text),
      io.components,
      io.read,
    );
    expect(
      encodeSceneDocument(serializeScene(reloaded, io.components, io.write)),
    ).toBe(text);

    const before = root.children as Shape2D[];
    const after = reloaded.children as Shape2D[];
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < after.length; i += 1) {
      expect(Array.from(after[i].geometry.positions)).toEqual(
        Array.from(before[i].geometry.positions),
      );
      expect(Array.from(after[i].geometry.colors ?? [])).toEqual(
        Array.from(before[i].geometry.colors ?? []),
      );
      expect(Array.from(after[i].geometry.indices ?? [])).toEqual(
        Array.from(before[i].geometry.indices ?? []),
      );
    }
  });
});
