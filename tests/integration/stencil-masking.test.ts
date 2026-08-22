/**
 * R-7 — §67's stencil substrate, across the three packages that have to agree
 * on it (2026-08-11).
 *
 * §67 asks for six clipping mechanisms; this packet lands the one the other
 * five are built on — a **stencil test** a material can declare, a buffer for
 * it to read and write, and the composition that turns the two into a mask.
 * No unit test inside one package can check that agreement: `@four/materials`
 * owns `StencilState` and its refusals, `@four/render` owns the surface that
 * carries the buffer, and `@four/render-webgl` is the only place any of it
 * becomes GL.
 *
 * Four claims:
 *
 * 1. **A scene that names no stencil is byte-identical.** The whole feature is
 *    gated on a mirror seeded at GL's own initial values plus one `undefined`
 *    check per draw, so a frame drawn into a plain render target emits the GL
 *    sequence recorded before `stencil` existed, call for call — including the
 *    `clear` mask, which is where a stencil buffer nobody asked for would show
 *    up first. `FRAME_BEFORE_R7` below is a recording, not a wish.
 * 2. **The composition works**: a mask pass writes the buffer without writing
 *    colour, the pass after it tests against what the mask wrote without
 *    writing the buffer, and a plain material after *both* puts the test back.
 *    Three materials, five stencil calls, and not one of them redundant.
 * 3. **A stencilled surface is allocated and cleared as one.** `stencil: true`
 *    turns the target's depth renderbuffer into a packed `DEPTH24_STENCIL8` on
 *    `DEPTH_STENCIL_ATTACHMENT`, and every view clear then carries
 *    `STENCIL_BUFFER_BIT` — because a mask that survived into the next frame is
 *    the §33 defect, not a feature.
 * 4. **The contradictions are refused, not resolved** (§85): a stencil with no
 *    depth, a stencil beside R-18's samplable depth texture, a reference value
 *    an 8-bit buffer cannot hold, a comparison nobody named.
 *
 * The pixel half — that a mask composed this way actually *cuts a hole* on a
 * real driver — is `tests/browser/stencil.spec.ts`, on ANGLE/SwiftShader.
 */

import { planeGeometry } from "@four/geometry";
import { StencilState, UnlitMaterial } from "@four/materials";
import { RenderTarget, Renderable } from "@four/render";
import { GL, WebglRenderer } from "@four/render-webgl";
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

interface Harness {
  readonly recorder: RecordingGl;
  readonly renderer: WebglRenderer;
  readonly scene: Scene;
  readonly views: Viewport[];
}

/** A renderer over a recording context, plus an empty scene and one full view. */
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
    views: [createFullscreenViewport(camera)],
  };
}

/**
 * A transcript with GPU handles renamed to `kind#n` in first-seen order — the
 * aliasing `render-effects.test.ts` introduced and `multi-light.test.ts`
 * repeats; see either for why raw serials cannot be compared across builds
 * while the relative order of a frame's own handles can.
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
      const kind = /"kind":"([A-Za-z]+)"/.exec(handle)?.[1] ?? "handle";
      const index = counts.get(kind) ?? 0;
      counts.set(kind, index + 1);
      const name = `${kind}#${String(index)}`;
      alias.set(handle, name);
      return name;
    }),
  );
}

/**
 * The scene `FRAME_BEFORE_R7` was recorded from: two plain unlit draws into an
 * **off-screen** target that asks for depth and nothing else.
 *
 * Off-screen deliberately, and that is the point of recording a new transcript
 * rather than resting on `multi-light.test.ts`'s. The on-screen frame path is
 * already guarded by three recorded transcripts that this packet leaves
 * untouched; what R-7 newly reaches is the *allocation* of a target's depth
 * attachment and the composition of a view's clear mask, and both of those are
 * only exercised by a frame that draws into a target.
 */
function offscreenScene(test: Harness): RenderTarget {
  const target = new RenderTarget({ width: 64, height: 64 });
  const left = new Renderable(
    planeGeometry(),
    new UnlitMaterial({ color: [1, 0, 0, 1] }),
  );
  left.transform.position.set(-1, 0, 0);
  const right = new Renderable(
    planeGeometry(),
    new UnlitMaterial({ color: [0, 0, 1, 1] }),
  );
  right.transform.position.set(1, 0, 0);
  test.scene.add(left);
  test.scene.add(right);
  return target;
}

/**
 * The GL a steady-state off-screen frame of {@link offscreenScene} emitted on
 * **2026-08-11**, at the last build before §67's stencil state existed —
 * recorded by reverting `material.ts`, `renderer.ts`, `render-target.ts`,
 * `gl-program.ts`, `gl-render-target.ts` and `webgl-renderer.ts` to their
 * pre-R-7 revisions and running this file's first test against the result
 * (MEMORY's rule: a transcript is recorded on the reverted build, never
 * hand-copied from a neighbouring packet).
 *
 * Do not "fix" a failure here by re-recording. This list is the regression
 * guard for every pixel golden and every browser gate: a change to it is a
 * change to what a frame that uses no stencil draws.
 *
 * The caveat `standard-material.test.ts` states applies here too — the double
 * records typed-array arguments by reference and this backend uploads through
 * shared scratch, so the numbers inside `[...]` are the scratch's final
 * contents rather than each call's own. This is a proof about the *sequence*.
 */
const FRAME_BEFORE_R7: readonly string[] = [
  "bindFramebuffer(36160, createFramebuffer#0)",
  "useProgram(createProgram#0)",
  "scissor(0, 0, 64, 64)",
  "viewport(0, 0, 64, 64)",
  "clearDepth(1)",
  "clear(256)",
  "uniformMatrix4fv(getUniformLocation#0, false, [1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,1])",
  "uniformMatrix4fv(getUniformLocation#1, false, [1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,1])",
  "uniform4fv(getUniformLocation#2, [0,0,1,1])",
  "bindVertexArray(createVertexArray#0)",
  "drawElements(4, 6, 5123, 0)",
  "uniformMatrix4fv(getUniformLocation#1, false, [1,0,0,0,0,1,0,0,0,0,1,0,1,0,0,1])",
  "uniform4fv(getUniformLocation#2, [0,0,1,1])",
  "bindVertexArray(createVertexArray#1)",
  "drawElements(4, 6, 5123, 0)",
  "bindVertexArray(null)",
  "bindFramebuffer(36160, null)",
];

describe("R-7 — a scene that names no stencil is byte-identical (§67)", () => {
  it("emits the GL sequence recorded before Material.stencil existed", async () => {
    const test = await harness();
    const target = offscreenScene(test);

    // Warm every cache — programs, geometry buffers, the framebuffer — so the
    // comparison is about a steady-state frame, as it was when the expected
    // transcript was recorded.
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views, undefined, target);
    test.renderer.render(test.scene, test.views, undefined, target);

    test.recorder.reset();
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views, undefined, target);

    expect(aliasHandles(test.recorder.transcript())).toEqual(FRAME_BEFORE_R7);
  });

  it("issues no stencil entry point at all in that frame", async () => {
    // The coarser, name-level form of the same claim, stated separately because
    // it is the one a reader can check without reading a transcript: three GL
    // entry points exist for the stencil, and a frame that names none of it
    // calls none of them — not even to put something back.
    const test = await harness();
    const target = offscreenScene(test);
    resolveWorldTransforms(test.scene);
    test.renderer.render(test.scene, test.views, undefined, target);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views, undefined, target);

    expect(test.recorder.countOf("stencilFunc")).toBe(0);
    expect(test.recorder.countOf("stencilOp")).toBe(0);
    expect(test.recorder.countOf("stencilMask")).toBe(0);
    for (const call of test.recorder.callsOf("enable")) {
      expect(call.args[0]).not.toBe(GL.STENCIL_TEST);
    }
    for (const call of test.recorder.callsOf("disable")) {
      expect(call.args[0]).not.toBe(GL.STENCIL_TEST);
    }
  });
});

// ---------------------------------------------------------------------------
// The composition §67 is for: write a mask, draw inside it, leave.
// ---------------------------------------------------------------------------

/**
 * Every stencil-relevant call of a frame, as a comparable line, with the draws
 * kept so the *interleaving* is visible: a mask that is written after the draw
 * it is supposed to mask would pass a per-call assertion and fail this one.
 */
function stencilTrace(recorder: RecordingGl): string[] {
  const lines: string[] = [];
  for (const call of recorder.calls) {
    if (call.name === "enable" || call.name === "disable") {
      if (call.args[0] === GL.STENCIL_TEST) {
        lines.push(`${call.name}(STENCIL_TEST)`);
      }
      continue;
    }
    if (call.name.startsWith("stencil")) {
      lines.push(`${call.name}(${call.args.map(String).join(", ")})`);
      continue;
    }
    if (call.name === "colorMask") {
      lines.push(`colorMask(${String(call.args[0])})`);
      continue;
    }
    if (call.name === "drawElements") {
      lines.push("draw");
    }
  }
  return lines;
}

describe("R-7 — the mask composition (§67)", () => {
  it("writes the mask, tests against it, and puts the test back", async () => {
    const test = await harness();

    // Pass 1: punch the mask. No colour, no depth write — a mask occluded by
    // what it masks would punch a hole in itself.
    const mask = new Renderable(
      planeGeometry(),
      new UnlitMaterial({
        color: [0, 0, 0, 0],
        colorWrite: false,
        depthWrite: false,
        stencil: new StencilState({
          func: "always",
          ref: 1,
          passOp: "replace",
        }),
      }),
    );
    // Pass 2: draw only where the mask wrote 1, and write nothing back.
    const inside = new Renderable(
      planeGeometry(),
      new UnlitMaterial({
        color: [0.9, 0.3, 0.2, 1],
        stencil: new StencilState({ func: "equal", ref: 1, writeMask: 0 }),
      }),
    );
    // Pass 3: an ordinary material, which must find the stencil test gone.
    const plain = new Renderable(
      planeGeometry(),
      new UnlitMaterial({ color: [0.2, 0.4, 0.95, 1] }),
    );
    test.scene.add(mask);
    test.scene.add(inside);
    test.scene.add(plain);
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views);
    test.recorder.reset();
    test.renderer.render(test.scene, test.views);

    expect(stencilTrace(test.recorder)).toEqual([
      // The mask pass: colour off, the test on, `always`/1, replace-on-pass.
      // No `stencilMask` — the write mask is already all bits.
      "colorMask(false)",
      "enable(STENCIL_TEST)",
      `stencilFunc(${String(GL.ALWAYS)}, 1, 255)`,
      `stencilOp(${String(GL.KEEP)}, ${String(GL.KEEP)}, ${String(GL.REPLACE)})`,
      "draw",
      // The masked pass: colour back on, the comparison changes, the ops go
      // back to keep-everything, and the write mask closes. Three calls,
      // because all three groups moved.
      "colorMask(true)",
      `stencilFunc(${String(GL.EQUAL)}, 1, 255)`,
      `stencilOp(${String(GL.KEEP)}, ${String(GL.KEEP)}, ${String(GL.KEEP)})`,
      "stencilMask(0)",
      "draw",
      // The plain pass: one `disable`, and nothing else — with the test off,
      // GL performs no stencil write either, so the func and op state is left
      // where it is rather than restored call by call.
      "disable(STENCIL_TEST)",
      "draw",
      // The frame's exit envelope (F13/F15's rule, extended by R-7): the write
      // mask a material closed is reopened, or the next frame's `clear` would
      // be masked by it.
      "stencilMask(255)",
    ]);
  });

  it("reopens the write mask before a view's clear, not only at frame end", async () => {
    // The trap this guards is specific and silent: `clear(STENCIL_BUFFER_BIT)`
    // is masked by the stencil write mask, so a frame whose *last* material
    // closed the mask would clear nothing the next time round and the mask
    // would leak across frames. Two views make it visible inside one frame.
    const test = await harness();
    const target = new RenderTarget({ width: 64, height: 64, stencil: true });
    test.scene.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({
          stencil: new StencilState({ func: "equal", ref: 1, writeMask: 0 }),
        }),
      ),
    );
    resolveWorldTransforms(test.scene);
    const camera = test.views[0].camera;
    const views = [
      createFullscreenViewport(camera),
      createFullscreenViewport(camera),
    ];

    test.renderer.render(test.scene, views, undefined, target);
    test.recorder.reset();
    test.renderer.render(test.scene, views, undefined, target);

    // Every `clear` in the frame carries the stencil bit, and every one of them
    // is preceded by a `stencilMask(255)` with no `stencilMask(0)` in between.
    let openMask = true;
    let clears = 0;
    for (const call of test.recorder.calls) {
      if (call.name === "stencilMask") {
        openMask = call.args[0] === 0xff;
      }
      if (call.name === "clear") {
        clears += 1;
        expect(Number(call.args[0]) & GL.STENCIL_BUFFER_BIT).toBe(
          GL.STENCIL_BUFFER_BIT,
        );
        expect(openMask).toBe(true);
      }
    }
    expect(clears).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The buffer: allocation, and the clear that keeps it from leaking.
// ---------------------------------------------------------------------------

describe("R-7 — the stencil buffer (§67, §61)", () => {
  it("allocates a target's stencil as packed depth-stencil on one attachment", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 64, height: 64, stencil: true });
    test.scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views, undefined, target);

    const storage = test.recorder.callsOf("renderbufferStorage");
    expect(storage).toHaveLength(1);
    expect(storage[0].args[1]).toBe(GL.DEPTH24_STENCIL8);
    const attach = test.recorder.callsOf("framebufferRenderbuffer");
    expect(attach).toHaveLength(1);
    expect(attach[0].args[1]).toBe(GL.DEPTH_STENCIL_ATTACHMENT);
  });

  it("leaves a target with no stencil on the plain 16-bit depth renderbuffer", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 64, height: 64 });
    test.scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
    resolveWorldTransforms(test.scene);

    test.renderer.render(test.scene, test.views, undefined, target);

    expect(test.recorder.callsOf("renderbufferStorage")[0].args[1]).toBe(
      GL.DEPTH_COMPONENT16,
    );
    expect(test.recorder.callsOf("framebufferRenderbuffer")[0].args[1]).toBe(
      GL.DEPTH_ATTACHMENT,
    );
    // And its clear is the one it always was — no stencil bit for a buffer
    // that is not there (§61: a backend does not clear what it did not
    // allocate).
    for (const call of test.recorder.callsOf("clear")) {
      expect(Number(call.args[0]) & GL.STENCIL_BUFFER_BIT).toBe(0);
    }
  });

  it("reports the packed attachment's cost (§83, §84)", () => {
    const plain = new RenderTarget({ width: 512, height: 512 });
    const masked = new RenderTarget({ width: 512, height: 512, stencil: true });
    // 4 colour + 2 depth against 4 colour + 4 packed depth-stencil.
    expect(plain.byteLength).toBe(512 * 512 * 6);
    expect(masked.byteLength).toBe(512 * 512 * 8);
    plain.dispose();
    masked.dispose();
  });
});

// ---------------------------------------------------------------------------
// §85: the refusals.
// ---------------------------------------------------------------------------

describe("R-7 — refused, not resolved (§85)", () => {
  it("refuses a stencil with no depth to pack it into", () => {
    expect(
      () =>
        new RenderTarget({ width: 8, height: 8, depth: false, stencil: true }),
    ).toThrow(/stencil requires depth/);
  });

  it("refuses a stencil beside R-18's samplable depth texture", () => {
    expect(
      () =>
        new RenderTarget({
          width: 8,
          height: 8,
          stencil: true,
          depthTexture: true,
        }),
    ).toThrow(/mutually exclusive/);
  });

  it("refuses a reference value an 8-bit stencil buffer cannot hold", () => {
    expect(() => new StencilState({ ref: 256 })).toThrow(/integer in 0…255/);
    expect(() => new StencilState({ ref: 1.5 })).toThrow(/integer in 0…255/);
    expect(() => new StencilState({ writeMask: -1 })).toThrow(
      /integer in 0…255/,
    );
  });

  it("refuses a comparison or an operation nobody named, on assignment too", () => {
    const state = new StencilState();
    expect(() => {
      state.func = "sometimes" as unknown as typeof state.func;
    }).toThrow(/func must be one of/);
    expect(() => {
      state.passOp = "explode" as unknown as typeof state.passOp;
    }).toThrow(/passOp must be one of/);
    // And the rejected write left the previous value in place.
    expect(state.func).toBe("always");
    expect(state.passOp).toBe("keep");
  });

  it("keeps the record a caller built, and nothing else can be built (§57)", () => {
    // `StencilState` is nominal — its fields are private — so an object
    // literal is not assignable to `Material.stencil` and the constructor
    // above is the only way in. That is the F14 rule met by the type system
    // rather than by an accessor, and it is what lets `@four/materials` import
    // the class type-only so a scene that never masks does not carry it.
    const material = new UnlitMaterial();
    expect(material.stencil).toBeUndefined();

    material.stencil = new StencilState({ func: "equal", ref: 3 });
    expect(material.stencil.func).toBe("equal");
    expect(material.stencil.ref).toBe(3);
    expect(material.stencil.readMask).toBe(255);
    expect(material.version).toBe(0);
  });
});
