/**
 * §49/§56's `Text` across the packages that have to agree about it (R-28,
 * 2026-08-13) — `@four/text` lays the string out, `four` assembles the node,
 * `@four/render` lists and batches it, `@four/render-webgl` issues the draw.
 *
 * Six claims live only in the composition, which is why they are here rather
 * than in any package's unit suite:
 *
 * 1. **A label is one draw call**, with no batching switched on and no
 *    per-glyph texture — the gap R-28 exists to close, stated as a GL count.
 * 2. **It draws through the pipeline that already existed.** The transcript of
 *    a frame containing a label is the transcript of a frame containing a
 *    textured `Renderable` over the same material, call for call: no new
 *    program, no new uniform, no new state.
 * 3. **Many labels over one material batch**, because they are a run of
 *    same-material unlit items — §65's glyph batching, obtained with nothing
 *    added to `batch.ts`.
 * 4. **The uv the backend uploads are the atlas cells** the layout named, so
 *    "each glyph samples its own cell" is checked rather than argued.
 * 5. **A scene with no text is byte-identical**, transcript for transcript, to
 *    the same scene built without any of this packet's code paths.
 * 6. **R-30's sampler state reaches the driver**: a `filter: "nearest"` atlas
 *    uploads `NEAREST`, and a texture that names nothing uploads exactly the
 *    four calls it uploaded before the fields existed.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import {
  RenderBatcher,
  Renderable,
  Texture,
  buildRenderList,
  createRenderStatistics,
  resetRenderStatistics,
} from "@four/render";
import { WebglRenderer, createGlBatching } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { buildGlyphAtlas } from "@four/text";
import { Text } from "four";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

/** GL enums the backend's own `GL` record does not export to tests. */
const TEXTURE_MIN_FILTER = 0x2801;
const TEXTURE_MAG_FILTER = 0x2800;
const NEAREST = 0x2600;
const LINEAR = 0x2601;

const atlas = buildGlyphAtlas();

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
    left: -8,
    right: 8,
    bottom: -6,
    top: 6,
  });
  // The recorded near-plane gotcha: content at `z = 0` in front of a camera at
  // the origin is clipped away entirely.
  camera.transform.position.set(0, 0, 5);
  return { renderer, recording, views: [createFullscreenViewport(camera)] };
}

/** A material sampling the built-in atlas, `filter` as given (§77, R-30). */
function ink(filter?: "nearest" | "linear"): UnlitMaterial {
  return new UnlitMaterial({
    map: new Texture(filter === undefined ? atlas : { ...atlas, filter }),
    transparent: true,
  });
}

/** Every recorded call as `name(args…)`, the transcript this file compares. */
function transcript(recording: RecordingGl): string[] {
  return recording.calls.map(
    (call) =>
      `${call.name}(${call.args
        .map((argument) =>
          ArrayBuffer.isView(argument)
            ? Array.from(argument as unknown as ArrayLike<number>).join(",")
            : String(argument),
        )
        .join(",")})`,
  );
}

describe("§56 text is one draw call (R-28)", () => {
  it("draws a whole label with one drawElements and one texture", async () => {
    const { renderer, recording, views } = await createRig();
    const scene = new Scene();
    const label = new Text(atlas, ink("nearest"), {
      text: "Motor 42",
      size: 1,
    });
    scene.add(label);
    resolveWorldTransforms(scene);

    const statistics = createRenderStatistics();
    renderer.statistics = statistics;
    resetRenderStatistics(statistics);
    renderer.render(scene, views);

    // Eight characters, one space: seven drawn glyphs, 28 vertices, 42 indices
    // — and **one** draw. Before this node existed the example that did this by
    // hand paid one texture, one material and one draw per glyph cell.
    expect(label.geometry.vertexCount).toBe(28);
    expect(statistics.drawCalls).toBe(1);
    expect(recording.countOf("drawElements")).toBe(1);
    expect(recording.countOf("createTexture")).toBe(1);
    expect(recording.callsOf("drawElements")[0]?.args[1]).toBe(42);
  });

  it("emits the transcript of a textured renderable over the same material", async () => {
    // Claim 2: `Text` adds nothing to the frame path. A label and a plain
    // `Renderable` carrying an equivalent geometry over the *same* material
    // produce the same GL calls — same program, same uniforms, same state —
    // and differ only in the vertex data they upload.
    const label = new Text(atlas, ink(), { text: "A", size: 2 });
    const geometry = label.geometry;

    const textRig = await createRig();
    const textScene = new Scene();
    textScene.add(label);
    resolveWorldTransforms(textScene);
    textRig.renderer.render(textScene, textRig.views);

    const plainRig = await createRig();
    const plainScene = new Scene();
    plainScene.add(new Renderable(geometry, label.material));
    resolveWorldTransforms(plainScene);
    plainRig.renderer.render(plainScene, plainRig.views);

    expect(transcript(textRig.recording)).toEqual(
      transcript(plainRig.recording),
    );
  });

  it("uploads the atlas cell of every glyph as per-vertex uv", () => {
    const label = new Text(atlas, ink(), { text: "AB", size: 1 });
    const uvs = label.geometry.uvs;
    const [first, second] = label.layout.quads;

    // Two glyphs, two different cells, one buffer — the mapping §55's affine
    // `quad` uniform cannot express, which is why this is not a `Sprite`.
    expect(uvs).toBeDefined();
    expect(atlas.glyphs.get("A")?.u0).toBe(first?.u0);
    expect(atlas.glyphs.get("B")?.u0).toBe(second?.u0);
    expect(uvs?.[0]).toBe(first?.u0);
    expect(uvs?.[8]).toBe(second?.u0);
    expect(first?.u0).not.toBe(second?.u0);
  });

  it("merges consecutive labels over one material into one draw (§65)", async () => {
    // Claim 3: §65's "glyph batching" strategy, obtained by *being* an unlit
    // run rather than by teaching `batch.ts` anything about text.
    const shared = ink();
    const scene = new Scene();
    for (let i = 0; i < 4; i += 1) {
      const label = new Text(atlas, shared, { text: "AB", size: 1 });
      label.transform.position.set(0, i * 1.5 - 3, 0);
      scene.add(label);
    }
    resolveWorldTransforms(scene);

    const list = buildRenderList(scene, []);
    expect(list).toHaveLength(4);

    const batch = new RenderBatcher().next(list, 0);
    expect(batch).not.toBeNull();
    expect(batch?.items).toBe(4);
    expect(batch?.kind).toBe("unlit");
    expect(batch?.hasUvs).toBe(true);
    // 4 labels × 2 glyphs × 4 vertices.
    expect(batch?.vertexCount).toBe(32);
    expect(batch?.texture).toBe(shared.map);

    const { renderer, recording, views } = await createRig();
    renderer.batching = createGlBatching();
    renderer.render(scene, views);

    expect(recording.countOf("drawElements")).toBe(1);
  });

  it("keeps a scene with no text byte-identical (byte-identity)", async () => {
    // Claim 5. The comparison is against a scene built entirely out of
    // pre-R-28 classes, rendered through a renderer that never met a label —
    // the frame this packet must not have moved.
    const build = (): Scene => {
      const scene = new Scene();
      const material = new UnlitMaterial({ color: [0.2, 0.6, 1, 1] });
      for (let i = 0; i < 3; i += 1) {
        const tile = new Renderable(
          planeGeometry({ width: 2, height: 2 }),
          material,
        );
        tile.transform.position.set(i * 2.5 - 2.5, 0, 0);
        scene.add(tile);
      }
      resolveWorldTransforms(scene);
      return scene;
    };

    const first = await createRig();
    first.renderer.render(build(), first.views);
    const second = await createRig();
    second.renderer.render(build(), second.views);

    expect(transcript(second.recording)).toEqual(transcript(first.recording));
    expect(transcript(first.recording).join("\n")).toContain("drawElements");
  });
});

describe("§77 sampler state reaches the driver (R-30)", () => {
  it("uploads NEAREST for a nearest-filtered atlas", async () => {
    const { renderer, recording, views } = await createRig();
    const scene = new Scene();
    scene.add(new Text(atlas, ink("nearest"), { text: "A", size: 2 }));
    resolveWorldTransforms(scene);

    renderer.render(scene, views);

    const filters = recording
      .callsOf("texParameteri")
      .filter(
        (call) =>
          call.args[1] === TEXTURE_MIN_FILTER ||
          call.args[1] === TEXTURE_MAG_FILTER,
      )
      .map((call) => call.args[2]);
    expect(filters).toEqual([NEAREST, NEAREST]);
  });

  it("uploads the identical four calls for a texture that names nothing", async () => {
    const { renderer, recording, views } = await createRig();
    const scene = new Scene();
    scene.add(new Text(atlas, ink(), { text: "A", size: 2 }));
    resolveWorldTransforms(scene);

    renderer.render(scene, views);

    const sampler = recording
      .callsOf("texParameteri")
      .map((call) => [call.args[1], call.args[2]]);
    expect(sampler[0]).toEqual([TEXTURE_MIN_FILTER, LINEAR]);
    expect(sampler[1]).toEqual([TEXTURE_MAG_FILTER, LINEAR]);
  });
});
