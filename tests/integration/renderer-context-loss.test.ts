/**
 * §92's *"renderer context loss and restore"* integration category (A-24,
 * 2026-08-08).
 *
 * §61 makes device loss "a first-class event, not an error case" and §92 names
 * the integration test that checks it. The seam for the cheap half was built
 * with the interface — `packages/render/src/renderer.ts` says of
 * `NullRenderer.events` that it is *"exactly the §92 integration test's cheap
 * half"* — and then went unused for four months. This file is that test, in
 * both halves.
 *
 * What no unit suite can say, and this one does:
 *
 * 1. **A lost context costs frames and nothing else.** An `Application` whose
 *    renderer loses its context keeps stepping: the fixed-step clock, the
 *    §12 kinematics and the scene graph advance to *bit-identical* positions
 *    against a control run that never lost anything. The loss is invisible
 *    above the renderer, which is the whole content of "not an error case".
 * 2. **The application-side seam works.** An app that stops drawing on
 *    `contextlost` and resumes on `contextrestored` — §61's own documented
 *    wiring — does so through a real `Application`, over `NullRenderer.events`.
 * 3. **Recovery is exact, through the real stack.** With a real `Scene`, real
 *    `planeGeometry`, real materials, a real `RenderTarget` and a real
 *    `RenderGraph`, the frame after the restore issues the same GL calls in
 *    the same order against handles used in the same pattern as the frame
 *    before the loss — and not one handle from before the loss is ever touched
 *    again.
 * 4. **§84's counters agree.** A frame the loss skipped counts zero draws, and
 *    the first frame after the restore counts them all again (A-1 meets §61).
 *
 * Only the GL context is a double, for the reason `packages/render-webgl/tests`
 * gives at length: the backend's whole GL surface is one interface, so a
 * recording object implementing it is complete — call order and failure paths
 * included — with no GPU and no browser. The events are delivered by
 * {@link LosableCanvas}, which is `RecordingCanvas` plus the listener list that
 * file declines to keep. The real-driver half, where a real Chromium really
 * loses a real ANGLE context, is `tests/browser/context-loss.spec.ts`.
 *
 * ## On comparing transcripts here
 *
 * `createRecordingGl` records argument *references*, and the backend uploads
 * uniforms out of one shared scratch buffer (plan D7), so a typed array in the
 * tape reads as whatever it held last. {@link shapedTranscript} therefore
 * compares every call name, every scalar argument, and the *pattern* of GPU
 * handles (each handle stands for the index of its first appearance, since
 * across a loss the objects are necessarily different — that is the point),
 * and reduces a typed array to its length. The byte-exact per-upload
 * comparison lives in `packages/render-webgl/tests`, whose double copies.
 */

import { planeGeometry } from "@four/geometry";
import { UnlitMaterial } from "@four/materials";
import { Vector3 } from "@four/math";
import {
  CircularTrajectory,
  KinematicController,
  KinematicSystem,
} from "@four/motion";
import {
  NullRenderer,
  RenderGraph,
  RenderTarget,
  Renderable,
  type Renderer,
} from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
} from "@four/scene";
import { Application } from "four/application";
import { describe, expect, it } from "vitest";

import { LosableCanvas } from "./helpers/losable-canvas.js";
import {
  createRecordingGl,
  type RecordedCall,
} from "./helpers/recording-gl.js";

/** One fixed step in seconds (§7a, §10; Appendix A's 1/60). */
const FIXED = 1 / 60;

/**
 * A transcript that survives being compared across a context loss; see the
 * module header for what it does and does not compare.
 */
function shapedTranscript(calls: readonly RecordedCall[]): string[] {
  const identifiers = new Map<object, string>();
  const describe = (value: unknown): string => {
    if (ArrayBuffer.isView(value)) {
      return `<buffer:${String(value.byteLength)}>`;
    }
    if (typeof value === "object" && value !== null) {
      let identifier = identifiers.get(value);
      if (identifier === undefined) {
        identifier = `#${String(identifiers.size)}`;
        identifiers.set(value, identifier);
      }
      return identifier;
    }
    return JSON.stringify(value) ?? String(value);
  };
  return calls.map(
    (call) => `${call.name}(${call.args.map(describe).join(", ")})`,
  );
}

/** Every GPU handle the recorded calls mention — see the unit suite's twin. */
function glHandles(calls: readonly RecordedCall[]): Set<object> {
  const handles = new Set<object>();
  for (const call of calls) {
    for (const argument of call.args) {
      if (
        typeof argument === "object" &&
        argument !== null &&
        !ArrayBuffer.isView(argument)
      ) {
        handles.add(argument);
      }
    }
  }
  return handles;
}

interface Harness {
  readonly recorder: ReturnType<typeof createRecordingGl>;
  readonly canvas: LosableCanvas;
  readonly renderer: WebglRenderer;
  readonly app: Application;
  /** The §12 orbiter, whose position is the "simulation kept running" probe. */
  readonly orbiter: Renderable;
}

/**
 * A started application drawing one static quad and one orbiting quad through
 * the WebGL 2 backend over a recording context.
 *
 * The orbiter is driven by §12's `CircularTrajectory` under a `KinematicSystem`
 * — a *prescribed* path, evaluated once per fixed step — so its position after
 * N steps is a pure function of N with no clock and no `Math.random` anywhere
 * (§33). That is what makes the control comparison below exact rather than
 * approximate.
 */
async function harness(options: { stats?: boolean } = {}): Promise<Harness> {
  const recorder = createRecordingGl();
  const canvas = new LosableCanvas(recorder.gl);
  const renderer = new WebglRenderer();
  const app = new Application({
    renderer,
    canvas,
    fixedTimeStep: FIXED,
    stats: options.stats,
    width: 256,
    height: 256,
  });

  // §87 (R-8, 2026-08-09): this said `{ height: 8, aspect: 1 }` — two fields
  // `OrthographicCameraOptions` does not have, silently ignored, leaving the
  // default unit box `[-1, 1]²`. The orbiter circles at radius 2, so it was off
  // screen for most of every orbit and the two-draw assertions below counted a
  // draw that produced no pixels. See `frame-statistics.test.ts` for the same
  // fixture bug and the reason it survived so long.
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -4,
    top: 4,
  });
  camera.transform.position.set(0, 0, 5);
  app.scene.add(camera);
  app.views.push(createFullscreenViewport(camera));

  const ground = new Renderable(
    planeGeometry({ width: 6, height: 1 }),
    new UnlitMaterial({ color: [0.1, 0.13, 0.19, 1] }),
  );
  ground.transform.position.set(0, -2, -1);
  app.scene.add(ground);

  const orbiter = new Renderable(
    planeGeometry({ width: 1, height: 1 }),
    new UnlitMaterial({ color: [1, 0.45, 0.2, 1] }),
  );
  orbiter.transformAuthority = "kinematic";
  orbiter.addComponent(new KinematicController()).followPath(
    new CircularTrajectory({
      center: new Vector3(0, 0, 0),
      radius: 2,
      angularVelocity: Math.PI / 2,
    }),
    { loop: true },
  );
  const kinematics = new KinematicSystem();
  app.systems.register(kinematics);
  kinematics.track(orbiter);
  app.scene.add(orbiter);

  await app.initialize();
  app.start();
  return { recorder, canvas, renderer, app, orbiter };
}

/** The orbiter's local position, as three plain numbers. */
function position(test: Harness): [number, number, number] {
  const { x, y, z } = test.orbiter.transform.position;
  return [x, y, z];
}

describe("§61 context loss and restore — the application half (§92)", () => {
  it("keeps the simulation running while the renderer has no context", async () => {
    const lost = await harness();
    const control = await harness();

    // Six frames each; the lost run spends the middle four without a context.
    lost.app.step(FIXED);
    control.app.step(FIXED);
    expect(lost.canvas.loseContext()).toBe(true);
    lost.recorder.reset();
    for (let frame = 0; frame < 4; frame += 1) {
      lost.app.step(FIXED);
      control.app.step(FIXED);
    }
    const lostFrameCalls = lost.recorder.calls.length;
    lost.canvas.restoreContext();
    lost.recorder.reset();
    lost.app.step(FIXED);
    control.app.step(FIXED);

    // Not one GL call escaped while the context was gone — §61's "skip the
    // frame and return", asserted against the tape rather than against a flag.
    expect(lostFrameCalls).toBe(0);
    // And the simulation above it never noticed: same steps, same trajectory,
    // same position, to the bit (§33).
    expect(position(lost)).toEqual(position(control));
    expect(position(lost)[0]).not.toBe(2);
    // The frame after the restore draws both quads again.
    expect(lost.recorder.countOf("drawElements")).toBe(2);
  });

  it("carries §61's events to an application that pauses and resumes drawing", async () => {
    // The `NullRenderer.events` seam, used for the job it was built for: §61
    // documents `renderer.events.on("contextlost", …)` as the application's
    // hook, and this is an application really using it. A null renderer is the
    // right double here precisely because it draws nothing — what is being
    // checked is the *wiring*, not the pixels.
    const renderer: Renderer = new NullRenderer();
    const app = new Application({ renderer, fixedTimeStep: FIXED });
    // §87 (R-8, 2026-08-09; tests typecheck gate, 2026-08-21): this said
    // `{ height: 4, aspect: 1 }` — two fields `OrthographicCameraOptions` does
    // not have, so the object was accepted and every property ignored, leaving
    // the default unit box `[-1, 1]²`. The box below is the 4 × 4 view the
    // harness always meant.
    const camera = new OrthographicCamera({
      left: -2,
      right: 2,
      bottom: -2,
      top: 2,
    });
    app.scene.add(camera);
    const view = createFullscreenViewport(camera);
    app.views.push(view);

    const seen: string[] = [];
    renderer.events.on("contextlost", (event) => {
      seen.push("contextlost");
      expect(event.renderer).toBe(renderer);
      // An application's own policy: stop drawing until the device is back.
      app.views.length = 0;
    });
    renderer.events.on("contextrestored", (event) => {
      seen.push("contextrestored");
      expect(event.renderer).toBe(renderer);
      app.views.push(view);
    });

    await app.initialize();
    app.start();
    app.step(FIXED);
    const drawnBefore = (renderer as NullRenderer).renderCount;

    renderer.events.emit("contextlost", { renderer });
    app.step(FIXED);
    app.step(FIXED);
    const drawnWhileLost = (renderer as NullRenderer).renderCount;

    renderer.events.emit("contextrestored", { renderer });
    app.step(FIXED);

    expect(seen).toEqual(["contextlost", "contextrestored"]);
    expect(drawnBefore).toBe(1);
    // §45's `#draw` returns early with no viewport, so the application's own
    // pause really is a pause — and the frames still ran.
    expect(drawnWhileLost).toBe(1);
    expect((renderer as NullRenderer).renderCount).toBe(2);

    app.dispose();
    renderer.dispose();
    // §83: teardown retains no listener, so the seam leaks nothing either.
    expect(renderer.events.listenerCount("contextlost")).toBe(0);
  });

  it("counts no draw for a frame the loss skipped, and counts them all after (A-1)", async () => {
    const test = await harness({ stats: true });

    test.app.step(FIXED);
    const before = test.app.stats?.drawCalls;
    test.canvas.loseContext();
    test.app.step(FIXED);
    const whileLost = test.app.stats?.drawCalls;
    test.canvas.restoreContext();
    test.app.step(FIXED);

    expect(before).toBe(2);
    // §84 counts *submitted* draws; a skipped frame submitted none.
    expect(whileLost).toBe(0);
    expect(test.app.stats?.drawCalls).toBe(2);
  });
});

describe("§61 context loss and restore — the backend half (§92)", () => {
  it("draws the frame after the restore exactly as it drew it before the loss", async () => {
    const test = await harness();
    // The application's *first* frame: every vertex array, buffer and uniform
    // location this scene needs is created inside it.
    test.recorder.reset();
    test.app.step(FIXED);
    const before = shapedTranscript(test.recorder.calls);

    test.canvas.loseContext();
    test.canvas.restoreContext();
    test.recorder.reset();
    test.app.step(FIXED);

    // The frame after a restore *is* a first frame again — same calls, same
    // order, same scalar arguments, handles used in the same pattern. A
    // restore that rebuilt a pipeline differently, skipped a re-upload, or
    // left the §57 state mirror out of step with the fresh context shows up
    // here and in no other assertion.
    expect(shapedTranscript(test.recorder.calls)).toEqual(before);
    expect(before.length).toBeGreaterThan(20);

    // And that it *is* a first frame is itself the claim: a renderer that
    // never lost its context draws the second frame with far fewer calls,
    // because its caches still hold everything the first frame uploaded.
    const control = await harness();
    control.app.step(FIXED);
    control.recorder.reset();
    control.app.step(FIXED);
    expect(control.recorder.calls.length).toBeLessThan(
      test.recorder.calls.length,
    );
  });

  it("never touches a handle from before the loss again", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 32, height: 32 });
    const offscreen = new Scene();
    offscreen.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [1, 0, 0, 1] }),
      ),
    );
    const graph = new RenderGraph();
    graph.addPass("offscreen", {
      root: offscreen,
      views: [createFullscreenViewport(new OrthographicCamera(), "offscreen")],
      target,
    });

    test.app.step(FIXED);
    graph.execute(test.renderer);
    const dead = glHandles(test.recorder.calls);

    test.canvas.loseContext();
    test.canvas.restoreContext();
    test.recorder.reset();
    test.app.step(FIXED);
    graph.execute(test.renderer);

    // Programs, shaders, buffers, vertex arrays, textures, framebuffers,
    // renderbuffers and uniform locations alike: every one of them died with
    // the context, and reusing any is the class of bug this suite exists to
    // catch — a cache that kept a record, a field that was not nulled, a
    // uniform location resolved against a dead program.
    expect(dead.size).toBeGreaterThan(20);
    expect(
      [...glHandles(test.recorder.calls)].filter((handle) => dead.has(handle)),
    ).toEqual([]);
    // And the off-screen pass really did run again: §61's "re-creates
    // engine-owned GPU resources … render targets", done by the pass that asks
    // for one (R-4).
    expect(test.recorder.countOf("createFramebuffer")).toBe(1);
    expect(test.recorder.countOf("deleteFramebuffer")).toBe(0);
  });

  it("re-allocates a render graph's target at the size it has after the loss", async () => {
    const test = await harness();
    const target = new RenderTarget({ width: 32, height: 32 });
    const offscreen = new Scene();
    offscreen.add(
      new Renderable(
        planeGeometry(),
        new UnlitMaterial({ color: [0, 1, 0, 1] }),
      ),
    );
    const graph = new RenderGraph();
    graph.addPass("offscreen", {
      root: offscreen,
      views: [createFullscreenViewport(new OrthographicCamera(), "offscreen")],
      target,
    });
    graph.execute(test.renderer);

    test.canvas.loseContext();
    // A resize while there is no context to allocate into: the record the
    // version bump would have invalidated is already gone, so the allocation
    // that comes back has to read the current size and not a cached one.
    target.resize(64, 16);
    test.canvas.restoreContext();
    test.recorder.reset();
    graph.execute(test.renderer);

    expect(test.recorder.countOf("createFramebuffer")).toBe(1);
    expect(test.recorder.callsOf("texImage2D")[0]?.args.slice(3, 5)).toEqual([
      64, 16,
    ]);
    expect(test.recorder.callsOf("viewport")[0]?.args).toEqual([0, 0, 64, 16]);
  });

  it("survives loss, restore, loss, restore — and disposal while lost (§83)", async () => {
    const test = await harness();
    const cycle: string[] = [];
    test.renderer.events.on("contextlost", () => cycle.push("lost"));
    test.renderer.events.on("contextrestored", () => cycle.push("restored"));

    test.app.step(FIXED);
    test.canvas.loseContext();
    test.canvas.restoreContext();
    test.app.step(FIXED);
    test.canvas.loseContext();
    test.canvas.restoreContext();
    test.recorder.reset();
    test.app.step(FIXED);
    const recovered = test.recorder.countOf("drawElements");

    test.canvas.loseContext();
    test.recorder.reset();
    test.app.dispose();
    test.renderer.dispose();

    expect(cycle).toEqual(["lost", "restored", "lost", "restored", "lost"]);
    expect(recovered).toBe(2);
    // §61 rule 4: `dispose()` during a lost context must succeed — and delete
    // nothing, since every handle it would delete is already invalid.
    expect(test.recorder.calls).toEqual([]);
    expect(test.canvas.listenerCount("webglcontextlost")).toBe(0);
    expect(test.canvas.listenerCount("webglcontextrestored")).toBe(0);
  });
});
