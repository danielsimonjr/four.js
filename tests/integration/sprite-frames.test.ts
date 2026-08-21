/**
 * R-29 — §55's `frame` sub-rectangle, end to end across `render` and
 * `render-webgl` (2026-08-08).
 *
 * A frame is one fact spread over two packages and a shader: `@four/render`'s
 * `Sprite` owns and validates it, `@four/render`'s render list snapshots it
 * onto the draw, and `@four/render-webgl` resolves it into the `quad` uniform
 * the vertex stage already had. No unit test inside either package can check
 * that agreement, which is what this file is for.
 *
 * Four claims:
 *
 * 1. **A frame costs a frameless sprite nothing.** A sprite whose frame is the
 *    whole texture — `(0, 0, width, height)`, the identity — emits the GL
 *    sequence byte-identical to the same sprite with no frame at all. That is
 *    the numeric half of the byte-identity argument; the structural half is
 *    that the two take *different branches* in `webgl-renderer.ts` and still
 *    agree, so the frame path is exercised rather than skipped.
 *
 *    This is the **tenth run** of the recorded-sequence method (R-4, R-5, R-6,
 *    F13, A-1, R-13, R-15, R-38, and the R-6/R-13 re-runs). Unlike those, R-29
 *    needed no newly pinned baseline: `standard-material.test.ts`'s
 *    `FRAME_BEFORE_R13` was recorded at commit `e0ddd3b` from a scene that
 *    **contains a blended sprite**, and it is still asserted verbatim, so the
 *    genuine before/after comparison for a frameless sprite already exists and
 *    is a gate. What a pinned transcript cannot express is the A/B between two
 *    live scenes, and that is what this file adds.
 *
 * 2. **The "cut the cell into its own texture" workaround is discharged.**
 *    Every example that draws text does what `examples/first-2d-scene`
 *    documented and the flagships inherited: copy each atlas cell into a
 *    standalone `Texture` and give it a `SpriteMaterial` of its own, because a
 *    sprite mapped its whole texture across its whole quad. Both spellings are
 *    built here, side by side, and asserted to draw *the same uv rectangles* —
 *    so the replacement is provably equivalent — for one texture upload and one
 *    GPU texture instead of one per cell.
 *
 * 3. **§85 refuses, it does not clamp.** A frame outside its texture throws at
 *    the write, against the real `@four/render` `Texture` satisfying
 *    `@four/materials`' contract — the seam a unit test with a hand-written
 *    double cannot exercise.
 *
 * 4. **A frame changes no geometry.** Stepping a sprite through an atlas
 *    re-uploads nothing: no `bufferData`, no `bufferSubData`, no
 *    `texImage2D` — only the four floats of a uniform that was already being
 *    uploaded once per draw. This is what makes a frame the right carrier for
 *    §55's animation clips and §86's glyph batching, and it is asserted rather
 *    than asserted-in-prose.
 *
 * The scenes are real and only the GL context is a double, for the reason
 * `render-graph.test.ts` gives at length.
 */

import { SpriteMaterial } from "@four/materials";
import {
  Sprite,
  Texture,
  buildRenderList,
  isSpriteItem,
  type RenderItem,
} from "@four/render";
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
  type RecordingGl,
} from "./helpers/recording-gl.js";

// ---------------------------------------------------------------------------
// Harness — the same shape `standard-material.test.ts` uses.
// ---------------------------------------------------------------------------

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  readonly views: Viewport[];
}

async function harness(): Promise<Harness> {
  const recorder = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recorder.gl) });
  renderer.resize(256, 256);

  const scene = new Scene();
  // §87 (R-8, 2026-08-09; tests typecheck gate, 2026-08-21): this said
  // `{ height: 6, aspect: 1 }` — two fields `OrthographicCameraOptions` does
  // not have, so the object was accepted and every property ignored, leaving
  // the default unit box `[-1, 1]²`. The box below is the 6 × 6 view the
  // harness always meant.
  const camera = new OrthographicCamera({
    left: -3,
    right: 3,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 8);
  scene.add(camera);

  return {
    recorder,
    renderer,
    scene,
    camera,
    views: [createFullscreenViewport(camera)],
  };
}

/**
 * A transcript with GPU handles renamed to `kind#n` in first-seen order — the
 * aliasing `render-effects.test.ts` introduced, copied for the reason it gives:
 * two builds mint different serials, and only the relative order is comparable.
 */
function aliasHandles(transcript: readonly string[]): string[] {
  const alias = new Map<string, string>();
  const counts = new Map<string, number>();
  return transcript.map((line) =>
    line.replace(/\{"kind":"[A-Za-z]+","serial":\d+\}/g, (handle) => {
      const existing = alias.get(handle);
      if (existing !== undefined) {
        return existing;
      }
      const kind = (JSON.parse(handle) as { kind: string }).kind;
      const index = counts.get(kind) ?? 0;
      counts.set(kind, index + 1);
      const name = `${kind}#${String(index)}`;
      alias.set(handle, name);
      return name;
    }),
  );
}

/** The atlas: 8 × 4 texels, four 4 × 2 cells, each a flat colour. */
const ATLAS_WIDTH = 8;
const ATLAS_HEIGHT = 4;
const CELL_WIDTH = 4;
const CELL_HEIGHT = 2;

/**
 * Builds the atlas. Row 0 is `v = 0` — the **bottom** row — per
 * `MaterialTexture.data`, which is also why §55 frames are measured from the
 * bottom-left texel.
 */
function atlasTexture(): Texture {
  const data = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  for (let y = 0; y < ATLAS_HEIGHT; y += 1) {
    for (let x = 0; x < ATLAS_WIDTH; x += 1) {
      const cell = (y < CELL_HEIGHT ? 0 : 2) + (x < CELL_WIDTH ? 0 : 1);
      const at = (y * ATLAS_WIDTH + x) * 4;
      data[at] = cell * 60;
      data[at + 1] = 255 - cell * 60;
      data[at + 2] = 128;
      data[at + 3] = 255;
    }
  }
  return new Texture({ width: ATLAS_WIDTH, height: ATLAS_HEIGHT, data });
}

/**
 * Copies one cell out of `source` into a standalone texture — the workaround
 * the examples carry, reproduced verbatim enough to be a fair comparison.
 */
function cutCell(source: Texture, x: number, y: number): Texture {
  const from = source.data;
  if (from === null) {
    throw new Error("the atlas fixture always carries texels");
  }
  const data = new Uint8Array(CELL_WIDTH * CELL_HEIGHT * 4);
  for (let row = 0; row < CELL_HEIGHT; row += 1) {
    const start = ((y + row) * ATLAS_WIDTH + x) * 4;
    data.set(
      from.subarray(start, start + CELL_WIDTH * 4),
      row * CELL_WIDTH * 4,
    );
  }
  return new Texture({ width: CELL_WIDTH, height: CELL_HEIGHT, data });
}

/** The sprite quad every scene here draws: 2 × 1 world units, bottom-left anchored. */
const QUAD = { width: 2, height: 1, anchor: { x: 0, y: 0 } } as const;

/**
 * Starts copying every `vec4` uniform upload out of the backend's shared
 * scratch buffer, and returns the growing list of `quad` uploads as
 * `[minX, minY, width, height]`.
 *
 * Two things make this necessary rather than fussy. The recorder keeps typed
 * arguments **by reference**, and every upload in this backend goes through one
 * scratch buffer (plan D7), so reading the recorded arguments afterwards yields
 * the scratch's *final* contents for every call — the caveat
 * `standard-material.test.ts` states at length, and the reason a pinned
 * transcript here is a claim about the sequence rather than the values. So the
 * copy has to happen at call time, and it is done by wrapping this file's own
 * context rather than by teaching the shared helper to snapshot: the four
 * transcripts pinned in sibling files record the scratch's final contents, and
 * changing that would rewrite four landed gates to make one new test prettier.
 *
 * The sprite program uploads exactly two `vec4`s per draw, `quad` then `tint`,
 * and these scenes contain nothing but sprites — so the even-indexed uploads
 * are the quads. Install before rendering.
 */
function captureQuads(recorder: RecordingGl): number[][] {
  const uploads: number[][] = [];
  const context = recorder.gl as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const inner = context.uniform4fv;
  context.uniform4fv = (...args: unknown[]): unknown => {
    uploads.push(Array.from(args[1] as Float32Array));
    return inner(...args);
  };
  return uploads;
}

/** The even-indexed half of {@link captureQuads}' tape — see it. */
function quadsOf(uploads: readonly number[][]): number[][] {
  return uploads.filter((_, index) => index % 2 === 0);
}

/** Where the quad's corner `(x, y)` lands in uv, given a `quad` upload. */
function uvAt(quad: number[], x: number, y: number): [number, number] {
  return [(x - quad[0]) / quad[2], (y - quad[1]) / quad[3]];
}

// ---------------------------------------------------------------------------
// Claim 1 — the identity frame is free.
// ---------------------------------------------------------------------------

describe("R-29 — a frame costs a frameless sprite nothing (§55)", () => {
  async function transcriptOf(frame: boolean): Promise<string[]> {
    const test = await harness();
    const texture = atlasTexture();
    const node = new Sprite(new SpriteMaterial({ texture }), QUAD);
    if (frame) {
      node.setFrame(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
    }
    test.scene.add(node);

    // Warm every cache — program, geometry buffers, texture, sampler — so the
    // comparison is about a steady-state frame.
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.renderer.render(test.scene, test.views);

    test.recorder.reset();
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    return aliasHandles(test.recorder.transcript());
  }

  it("emits the identical GL sequence for the identity frame and for none", async () => {
    const [framed, frameless] = await Promise.all([
      transcriptOf(true),
      transcriptOf(false),
    ]);

    // Not `toEqual` on a truncated view: the whole steady-state frame, call for
    // call, argument for argument.
    expect(framed).toEqual(frameless);
    // …and it really is a frame, not an empty transcript compared with itself.
    expect(
      frameless.filter((line) => line.startsWith("drawElements")),
    ).toHaveLength(1);
  });

  it("uploads the identical quad rectangle, not merely the same call", async () => {
    // The transcript above records typed arrays by reference, so equality there
    // is a claim about the *sequence*. This is the claim about the values.
    const framedTest = await harness();
    const framedUploads = captureQuads(framedTest.recorder);
    const framed = new Sprite(
      new SpriteMaterial({ texture: atlasTexture() }),
      QUAD,
    );
    framed.setFrame(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
    framedTest.scene.add(framed);
    resolveWorldTransforms(framedTest.scene);
    framedTest.renderer.render(framedTest.scene, framedTest.views);

    const plainTest = await harness();
    const plainUploads = captureQuads(plainTest.recorder);
    plainTest.scene.add(
      new Sprite(new SpriteMaterial({ texture: atlasTexture() }), QUAD),
    );
    resolveWorldTransforms(plainTest.scene);
    plainTest.renderer.render(plainTest.scene, plainTest.views);

    expect(quadsOf(framedUploads)).toEqual([[0, 0, 2, 1]]);
    expect(quadsOf(framedUploads)).toEqual(quadsOf(plainUploads));
    // `Object.is` rather than `===`, because a `-0` here would hash differently
    // in a §33 checksum while comparing equal — the hazard `Sprite`'s quad
    // rebuild already guards against.
    for (const value of quadsOf(framedUploads)[0]) {
      expect(Object.is(value, -0)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Claim 2 — the cut-a-cell workaround is discharged.
// ---------------------------------------------------------------------------

describe("R-29 — four atlas cells, one texture (§55, §86)", () => {
  /** The four cells' bottom-left corners in texels, in draw order. */
  const CELLS: readonly (readonly [number, number])[] = [
    [0, 0],
    [CELL_WIDTH, 0],
    [0, CELL_HEIGHT],
    [CELL_WIDTH, CELL_HEIGHT],
  ];

  it("draws every cell through one GL texture and one upload", async () => {
    const test = await harness();
    const material = new SpriteMaterial({ texture: atlasTexture() });
    for (const [x, y] of CELLS) {
      test.scene.add(
        new Sprite(material, QUAD).setFrame(x, y, CELL_WIDTH, CELL_HEIGHT),
      );
    }

    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    expect(test.recorder.countOf("drawElements")).toBe(4);
    expect(test.recorder.countOf("createTexture")).toBe(1);
    expect(test.recorder.countOf("texImage2D")).toBe(1);
  });

  it("maps each cell onto the uv rectangle the workaround produced", async () => {
    // The old way: one texture and one material per cell, each mapped 0…1.
    const source = atlasTexture();
    const before = await harness();
    const beforeUploads = captureQuads(before.recorder);
    for (const [x, y] of CELLS) {
      before.scene.add(
        new Sprite(
          new SpriteMaterial({ texture: cutCell(source, x, y) }),
          QUAD,
        ),
      );
    }
    resolveWorldTransforms(before.scene);
    before.renderer.render(before.scene, before.views);

    // The new way: one texture, one material, four frames.
    const after = await harness();
    const afterUploads = captureQuads(after.recorder);
    const shared = new SpriteMaterial({ texture: atlasTexture() });
    for (const [x, y] of CELLS) {
      after.scene.add(
        new Sprite(shared, QUAD).setFrame(x, y, CELL_WIDTH, CELL_HEIGHT),
      );
    }
    resolveWorldTransforms(after.scene);
    after.renderer.render(after.scene, after.views);

    // Each cut cell maps its own texture across 0…1; each frame maps the same
    // *texels* of the shared atlas. Compare in atlas texels, which is the one
    // space both spellings can be expressed in.
    const cut = quadsOf(beforeUploads).map((quad) => {
      const [u0, v0] = uvAt(quad, 0, 0);
      const [u1, v1] = uvAt(quad, QUAD.width, QUAD.height);
      return [
        u0 * CELL_WIDTH,
        v0 * CELL_HEIGHT,
        u1 * CELL_WIDTH,
        v1 * CELL_HEIGHT,
      ];
    });
    const framed = quadsOf(afterUploads).map((quad, index) => {
      const [u0, v0] = uvAt(quad, 0, 0);
      const [u1, v1] = uvAt(quad, QUAD.width, QUAD.height);
      const [x, y] = CELLS[index];
      return [
        u0 * ATLAS_WIDTH - x,
        v0 * ATLAS_HEIGHT - y,
        u1 * ATLAS_WIDTH - x,
        v1 * ATLAS_HEIGHT - y,
      ];
    });

    expect(framed).toEqual(cut);
    // The four uploads themselves, so the derivation is pinned and not only its
    // consequence: a 2 × 1 quad showing a 4 × 2 cell of an 8 × 4 atlas maps the
    // whole atlas onto a 4 × 2 local rectangle, shifted left by half a quad per
    // column and down by a whole quad per row.
    expect(quadsOf(afterUploads)).toEqual([
      [0, 0, 4, 2],
      [-2, 0, 4, 2],
      [0, -1, 4, 2],
      [-2, -1, 4, 2],
    ]);
    // And the saving, as a number: four uploads become one.
    expect(before.recorder.countOf("texImage2D")).toBe(4);
    expect(after.recorder.countOf("texImage2D")).toBe(1);
  });

  it("puts the frame on the item by reference, and clears it on reuse", async () => {
    const test = await harness();
    const material = new SpriteMaterial({ texture: atlasTexture() });
    const framed = new Sprite(material, QUAD).setFrame(4, 2, 4, 2);
    const plain = new Sprite(material, QUAD);
    test.scene.add(framed, plain);
    resolveWorldTransforms(test.scene);

    const out: RenderItem[] = [];
    const list = buildRenderList(test.scene, out);

    expect(list.filter(isSpriteItem).map((item) => item.frame)).toEqual([
      framed.frame,
      null,
    ]);
    expect(list.filter(isSpriteItem)[0].frame).toBe(framed.frame);
  });
});

// ---------------------------------------------------------------------------
// Claims 3 and 4 — validation across the seam, and no re-upload.
// ---------------------------------------------------------------------------

describe("R-29 — §85 refuses a frame outside its texture", () => {
  it("throws against a real Texture rather than clamping into range", () => {
    const sprite = new Sprite(
      new SpriteMaterial({ texture: atlasTexture() }),
      QUAD,
    );

    expect(() => sprite.setFrame(6, 0, 4, 2)).toThrow(RangeError);
    expect(() => sprite.setFrame(6, 0, 4, 2)).toThrow(/8 × 4 texture/);
    // Refused, therefore unset — not silently narrowed to (6, 0, 2, 2).
    expect(sprite.frame).toBeNull();
  });
});

describe("R-29 — stepping a frame re-uploads nothing (§55, §86)", () => {
  it("changes four uniform floats and touches no buffer or texture", async () => {
    const test = await harness();
    const node = new Sprite(
      new SpriteMaterial({ texture: atlasTexture() }),
      QUAD,
    ).setFrame(0, 0, CELL_WIDTH, CELL_HEIGHT);
    test.scene.add(node);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);
    test.renderer.render(test.scene, test.views);

    test.recorder.reset();
    const uploads = captureQuads(test.recorder);
    node.setFrame(CELL_WIDTH, CELL_HEIGHT, CELL_WIDTH, CELL_HEIGHT);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views);

    expect(test.recorder.countOf("bufferData")).toBe(0);
    expect(test.recorder.countOf("bufferSubData")).toBe(0);
    expect(test.recorder.countOf("texImage2D")).toBe(0);
    // The quad moved, which is the whole of the change.
    expect(quadsOf(uploads)).toEqual([[-2, -1, 4, 2]]);
  });
});
