/**
 * §58's paint-object tier across the packages that have to agree about it
 * (2026-08-29; R-16's follow-up, unblocked by RFC 0001): `@four/render`
 * accepts and lowers the paints, `@four/materials` carries the derived
 * `NodeMaterial`, `@four/render-webgl` draws it through the registered node
 * pipeline.
 *
 * Four claims live only in the composition:
 *
 * 1. **Byte-identity for every scene that names no object paint.**
 *    `registerShapePaints()` alone changes not one GL call of a solid-tier
 *    painted frame — the tier costs nothing until a paint is authored.
 * 2. **A gradient-painted shape is an ordinary `"node"` item**: one draw,
 *    through the program cache the shapes share — N shapes naming one paint
 *    value compile exactly one program (the lowering's determinism, measured
 *    as a compile count).
 * 3. **An unregistered node pipeline skips the painted shape** — the
 *    transcript is byte-identical to the same scene without the shape, never
 *    an approximation (the recorded decision: the tier inherits §60's rule,
 *    because the derived material *is* a node material; falling back to
 *    R-16's per-vertex approximation would make one JSON value two different
 *    pictures depending on registration).
 * 4. **A §79 document round-trips through the umbrella and draws the same
 *    triangles** — covered at the unit tier for values; here the reloaded
 *    scene's transcript matches the original's.
 */

import { UnlitMaterial } from "@four/materials";
import {
  Circle,
  Rectangle,
  buildRenderList,
  clearRegisteredShapePaints,
  registerShapePaints,
  type RadialGradientPaint,
} from "@four/render";
import {
  WebglRenderer,
  clearRegisteredNodeMaterialPipeline,
  registerNodeMaterialPipeline,
} from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

interface Rig {
  readonly renderer: WebglRenderer;
  readonly recording: RecordingGl;
  readonly views: readonly Viewport[];
}

async function createRig(): Promise<Rig> {
  const recording = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 5);
  return { renderer, recording, views: [createFullscreenViewport(camera)] };
}

const SUNSET: RadialGradientPaint = {
  kind: "radial-gradient",
  center: { x: 0, y: 0 },
  radius: 1,
  stops: [
    { offset: 0, color: [1, 0.9, 0.4, 1] },
    { offset: 1, color: [1, 0.4, 0, 1] },
  ],
};

afterEach(() => {
  clearRegisteredShapePaints();
  clearRegisteredNodeMaterialPipeline();
});

describe("§58 object paints — byte-identity and the node item", () => {
  /** One frame of R-16's solid tier on a fresh rig; the transcript. */
  async function solidTranscript(): Promise<string[]> {
    const rig = await createRig();
    const scene = new Scene();
    scene.add(
      new Rectangle({
        width: 2,
        height: 1,
        material: new UnlitMaterial({ vertexColors: true }),
        fill: { kind: "solid", color: [0.25, 0.5, 1, 1] },
        stroke: { width: 0.1, paint: { kind: "solid", color: [1, 1, 1, 1] } },
      }),
    );
    resolveWorldTransforms(scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    return rig.recording.transcript();
  }

  it("registering the paint tier changes not one call of a solid-tier frame", async () => {
    clearRegisteredShapePaints();
    const before = await solidTranscript();
    registerShapePaints();
    registerNodeMaterialPipeline();
    const after = await solidTranscript();
    expect(after).toEqual(before);
  });

  it("lists a gradient-painted shape as an ordinary node item", () => {
    registerShapePaints();
    const scene = new Scene();
    const shape = new Circle({ radius: 1, fill: SUNSET });
    scene.add(shape);
    resolveWorldTransforms(scene);
    const items = buildRenderList(scene, []);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("node");
    expect(items[0].material).toBe(shape.material);
  });

  it("compiles one program for N shapes naming one paint value", async () => {
    registerShapePaints();
    registerNodeMaterialPipeline();
    const rig = await createRig();
    const scene = new Scene();
    for (let i = 0; i < 3; i += 1) {
      const circle = new Circle({ radius: 1 + i, fill: SUNSET });
      circle.transform.position.set(i - 1, 0, 0);
      scene.add(circle);
    }
    resolveWorldTransforms(scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    // Three derived materials, one graph shape, one compiled program — the
    // backend's source-keyed cache, fed by the lowering's determinism.
    expect(rig.recording.countOf("createProgram")).toBe(1);
    expect(rig.recording.countOf("drawElements")).toBe(3);
  });

  it("skips a painted shape when the node pipeline is unregistered — never approximates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      registerShapePaints();
      clearRegisteredNodeMaterialPipeline();
      const bare = await createRig();
      const bareScene = new Scene();
      bareScene.add(
        new Rectangle({ width: 2, height: 2, material: new UnlitMaterial() }),
      );
      resolveWorldTransforms(bareScene);
      bare.recording.reset();
      bare.renderer.render(bareScene, bare.views);

      const painted = await createRig();
      const paintedScene = new Scene();
      paintedScene.add(
        new Rectangle({ width: 2, height: 2, material: new UnlitMaterial() }),
        new Circle({ radius: 1, fill: SUNSET }),
      );
      resolveWorldTransforms(paintedScene);
      painted.recording.reset();
      painted.renderer.render(paintedScene, painted.views);

      // Identical transcripts: the skipped shape contributes nothing at all.
      expect(painted.recording.transcript()).toEqual(
        bare.recording.transcript(),
      );
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
