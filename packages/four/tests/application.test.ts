import { afterEach, describe, expect, it, vi } from "vitest";

import { isFourError, resetDevWarnings } from "@four/core";
import { Quaternion, Vector3 } from "@four/math";
import {
  DEFAULT_FIXED_DELTA_TIME,
  DEFAULT_MAXIMUM_SUB_STEPS,
  PRIORITY_KINEMATICS,
  copyTimeState,
  type FixedUpdateContext,
  type ReadonlyTimeState,
  type SimulationSystem,
  type TimeState,
} from "@four/motion";
import { AssetManager } from "@four/assets";
import { BufferGeometry } from "@four/geometry";
import {
  NullRenderer,
  RendererRegistry,
  Texture,
  clearRegisteredRenderers,
  registerRenderer,
  type RendererBackend,
  type RendererCapabilities,
  type RendererCapabilityDeclaration,
  type RendererCapabilityShortfall,
  type RendererFallbackReport,
} from "@four/render";
import {
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  ScreenCamera,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";

import {
  Application,
  type ApplicationOptions,
  type SurfaceResize,
} from "../src/application.js";

const FIXED = DEFAULT_FIXED_DELTA_TIME;

/**
 * §10 dropped-time (and any other `devWarn`) must not leak to stderr from
 * tests that step past `maximumSubSteps`. Keys reset between tests so a
 * later suite can still assert the once-per-process warning.
 */
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

afterEach(() => {
  resetDevWarnings();
  warnSpy.mockClear();
});

/** A started application, ready to step. */
async function startedApplication(
  ...args: ConstructorParameters<typeof Application>
): Promise<Application> {
  const app = new Application(...args);
  await app.initialize();
  app.start();
  return app;
}

/** Records `<event>` names in emission order. */
function traceEvents(app: Application, log: string[]): void {
  app.on("fixedUpdate", () => log.push("fixedUpdate"));
  app.on("update", () => log.push("update"));
  app.on("render", () => log.push("render"));
}

/** A `SimulationSystem` that appends to a log and can run extra behaviour. */
class RecordingSystem implements SimulationSystem {
  priority: number;

  initializeCount = 0;

  disposeCount = 0;

  fixedUpdateCount = 0;

  constructor(
    private readonly label: string,
    private readonly log: string[],
    priority = PRIORITY_KINEMATICS,
    private readonly behaviour?: (context: FixedUpdateContext) => void,
  ) {
    this.priority = priority;
  }

  initialize(): void {
    this.initializeCount += 1;
  }

  fixedUpdate(context: FixedUpdateContext): void {
    this.fixedUpdateCount += 1;
    this.log.push(this.label);
    this.behaviour?.(context);
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

describe("Application — lifecycle (§45)", () => {
  it("starts uninitialized, not running, not paused, not disposed", () => {
    const app = new Application();
    expect(app.initialized).toBe(false);
    expect(app.running).toBe(false);
    expect(app.paused).toBe(false);
    expect(app.disposed).toBe(false);
  });

  it("owns a scene, a scheduler, and a system registry", () => {
    const app = new Application();
    expect(app.scene.children).toHaveLength(0);
    expect(app.systems.size).toBe(0);
    expect(app.scheduler.fixedDeltaTime).toBe(DEFAULT_FIXED_DELTA_TIME);
    expect(app.scheduler.maximumSubSteps).toBe(DEFAULT_MAXIMUM_SUB_STEPS);
    expect(app.time).toBe(app.scheduler.time);
  });

  it("maps the §45 option names onto the scheduler", () => {
    const app = new Application({ fixedTimeStep: 1 / 120, maximumSubSteps: 3 });
    expect(app.scheduler.fixedDeltaTime).toBe(1 / 120);
    expect(app.scheduler.maximumSubSteps).toBe(3);
  });

  it("initializes once, idempotently, for repeated and concurrent calls", async () => {
    const app = new Application();
    const first = app.initialize();
    const second = app.initialize();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(app.initialized).toBe(true);
    await app.initialize();
    expect(app.initialized).toBe(true);
  });

  it("throws FourError on start() before initialize()", () => {
    const app = new Application();
    expect(() => {
      app.start();
    }).toThrowError(/initialize/);
    try {
      app.start();
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      if (isFourError(error)) {
        expect(error.code).toBe("INVALID_APPLICATION_STATE");
        expect(error.context).toMatchObject({
          method: "start",
          initialized: false,
        });
      }
    }
    expect(app.running).toBe(false);
  });

  it("throws FourError on step() before initialize()", () => {
    const app = new Application();
    expect(() => {
      app.step(FIXED);
    }).toThrowError(/initialize/);
    expect(app.time.frame).toBe(0);
  });

  it("throws FourError on step() after initialize() but before start()", async () => {
    const app = new Application();
    await app.initialize();
    let caught: unknown;
    try {
      app.step(FIXED);
    } catch (error) {
      caught = error;
    }
    expect(isFourError(caught)).toBe(true);
    if (isFourError(caught)) {
      expect(caught.code).toBe("INVALID_APPLICATION_STATE");
      expect(caught.context).toMatchObject({
        method: "step",
        initialized: true,
        running: false,
        disposed: false,
      });
    }
    expect(app.time.frame).toBe(0);
  });

  it("steps once started, and stop() makes step() an error again", async () => {
    const app = await startedApplication();
    expect(app.running).toBe(true);
    app.step(FIXED);
    expect(app.time.frame).toBe(1);

    app.stop();
    expect(app.running).toBe(false);
    expect(() => {
      app.step(FIXED);
    }).toThrowError(/step/);
    expect(app.time.frame).toBe(1);

    // start() resumes with the loop state untouched.
    app.start();
    app.step(FIXED);
    expect(app.time.frame).toBe(2);
    expect(app.time.simulationStep).toBe(2);
  });

  it("treats repeated start()/stop() as no-ops", async () => {
    const app = await startedApplication();
    app.start();
    expect(app.running).toBe(true);
    app.stop();
    app.stop();
    expect(app.running).toBe(false);
  });

  it("rejects a re-entrant step()", async () => {
    const app = await startedApplication();
    let caught: unknown;
    app.on("update", () => {
      try {
        app.step(FIXED);
      } catch (error) {
        caught = error;
      }
    });
    app.step(FIXED);
    expect(isFourError(caught)).toBe(true);
    if (isFourError(caught)) {
      expect(caught.context).toMatchObject({ reentrant: true });
    }
    expect(app.time.frame).toBe(1);
  });

  it("propagates the scheduler's argument validation", async () => {
    const app = await startedApplication();
    expect(() => {
      app.step(-1);
    }).toThrowError(RangeError);
    // The re-entrancy guard is released even when the step throws.
    app.step(FIXED);
    expect(app.time.frame).toBe(1);
  });
});

describe("Application — main-loop events (§10, §6b)", () => {
  it("emits fixedUpdate ×N, then update, then render, for a ragged elapsed sequence", async () => {
    const app = await startedApplication();
    const log: string[] = [];
    traceEvents(app, log);

    // Ragged frames: no step, exactly one, two, and a long frame that hits the
    // substep clamp (5 × 1/60 = 0.0833…).
    app.step(FIXED / 4);
    expect(log).toEqual(["update", "render"]);

    log.length = 0;
    app.step(FIXED);
    expect(log).toEqual(["fixedUpdate", "update", "render"]);

    log.length = 0;
    app.step(FIXED * 2);
    expect(log).toEqual(["fixedUpdate", "fixedUpdate", "update", "render"]);

    log.length = 0;
    app.step(FIXED * 20);
    expect(log).toEqual([
      ...new Array<string>(DEFAULT_MAXIMUM_SUB_STEPS).fill("fixedUpdate"),
      "update",
      "render",
    ]);
    expect(app.time.droppedTime).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const first = String(warnSpy.mock.calls[0]?.[0]);
    expect(first).toMatch(
      /\[four\] §10 dropped .+s of simulation time this frame/,
    );
    expect(first).toContain(
      `${app.time.droppedTime.toFixed(4)}s and is not recovered`,
    );
    // A second long frame must not repeat the warning — once per process.
    app.step(FIXED * 20);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const afterSecond = app.time.droppedTime;
    // After a reset the next drop reports *this frame*, not the cumulative total.
    resetDevWarnings();
    warnSpy.mockClear();
    app.step(FIXED * 20);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const again = String(warnSpy.mock.calls[0]?.[0]);
    const thisFrame = app.time.droppedTime - afterSecond;
    expect(again).toContain(
      `${thisFrame.toFixed(4)}s of simulation time this frame`,
    );
    expect(again).not.toMatch(
      new RegExp(
        `dropped ${app.time.droppedTime.toFixed(4)}s of simulation time this frame`,
      ),
    );
  });

  it("passes the scheduler's live TimeState to every listener", async () => {
    const app = await startedApplication();
    const seen: ReadonlyTimeState[] = [];
    const snapshots: TimeState[] = [];
    app.on("fixedUpdate", (time) => {
      seen.push(time);
      snapshots.push(copyTimeState(time));
    });
    app.on("update", (time) => {
      seen.push(time);
      snapshots.push(copyTimeState(time));
    });
    app.on("render", (time) => {
      seen.push(time);
      snapshots.push(copyTimeState(time));
    });

    app.step(FIXED * 2);

    expect(seen).toHaveLength(4);
    for (const time of seen) {
      expect(time).toBe(app.scheduler.time);
    }
    // The two fixed steps describe the steps they produced …
    expect(snapshots[0].simulationStep).toBe(1);
    expect(snapshots[0].simulationTime).toBeCloseTo(FIXED, 12);
    expect(snapshots[1].simulationStep).toBe(2);
    // … and update/render see the frame's alpha and unscaled delta.
    expect(snapshots[2].frame).toBe(1);
    expect(snapshots[2].unscaledDeltaTime).toBe(FIXED * 2);
    expect(snapshots[2].interpolationAlpha).toBeGreaterThanOrEqual(0);
    expect(snapshots[2].interpolationAlpha).toBeLessThanOrEqual(1);
    expect(snapshots[3]).toEqual(snapshots[2]);
  });

  it("runs registered systems before the fixedUpdate listeners", async () => {
    const app = await startedApplication();
    const log: string[] = [];
    const early = new RecordingSystem("system:early", log, PRIORITY_KINEMATICS);
    const late = new RecordingSystem(
      "system:late",
      log,
      PRIORITY_KINEMATICS + 1,
    );
    app.systems.register(early);
    app.systems.register(late);
    app.on("fixedUpdate", () => log.push("listener"));
    app.on("update", () => log.push("update"));

    app.step(FIXED * 2);

    expect(log).toEqual([
      "system:early",
      "system:late",
      "listener",
      "system:early",
      "system:late",
      "listener",
      "update",
    ]);
    expect(early.initializeCount).toBe(1);
    expect(early.fixedUpdateCount).toBe(2);
  });

  it("delivers listeners in registration order and honours unsubscribe (§6b)", async () => {
    const app = await startedApplication();
    const log: string[] = [];
    app.on("update", () => log.push("first"));
    const off = app.on("update", () => log.push("second"));
    app.on("update", () => log.push("third"));

    app.step(FIXED);
    expect(log).toEqual(["first", "second", "third"]);

    off();
    log.length = 0;
    app.step(FIXED);
    expect(log).toEqual(["first", "third"]);
  });
});

describe("Application — world transforms (§7)", () => {
  it("resolves world transforms before the update event, with no manual resolve", async () => {
    const app = await startedApplication();
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    app.scene.add(parent);

    // A system mutates the transform inside the fixed step, exactly as
    // kinematics will (§39 step 4).
    app.systems.register(
      new RecordingSystem("mover", [], PRIORITY_KINEMATICS, () => {
        parent.transform.position.set(2, 3, 4);
      }),
    );

    let childTranslationAtUpdate: readonly number[] = [];
    app.on("update", () => {
      const e = child.transform.worldMatrix.elements;
      childTranslationAtUpdate = [e[12], e[13], e[14]];
    });

    app.step(FIXED);

    // Column-major translation column: the child inherited the parent's move
    // without the test ever calling resolveWorldTransforms.
    expect(childTranslationAtUpdate).toEqual([2, 3, 4]);
    expect(child.transform.worldVersion).toBeGreaterThan(0);

    // A frame that moves nothing recomputes nothing: the resolve inside the
    // application already brought the scene up to date.
    const stats = resolveWorldTransforms(app.scene);
    expect(stats.recomputed).toBe(0);
    expect(stats.visited).toBe(3);
  });

  it("resolves once per frame even when no fixed step runs", async () => {
    const app = await startedApplication();
    const node = new Group();
    app.scene.add(node);
    node.transform.position.set(1, 0, 0);

    app.step(FIXED / 10);

    expect(node.transform.worldMatrix.elements[12]).toBe(1);
  });
});

describe("Application — pause and resume (§10)", () => {
  it("proxies the scheduler's pause flag", async () => {
    const app = await startedApplication();
    expect(app.paused).toBe(false);

    app.pause();
    expect(app.paused).toBe(true);
    expect(app.scheduler.paused).toBe(true);

    app.resume();
    expect(app.paused).toBe(false);
    expect(app.scheduler.paused).toBe(false);
  });

  it("freezes simulation while paused but keeps update and render running", async () => {
    const app = await startedApplication();
    const log: string[] = [];
    traceEvents(app, log);

    app.pause();
    app.step(FIXED * 3);

    expect(log).toEqual(["update", "render"]);
    expect(app.time.simulationStep).toBe(0);
    expect(app.time.deltaTime).toBe(0);
    expect(app.time.unscaledDeltaTime).toBe(FIXED * 3);
    expect(app.time.timeScale).toBe(1);

    log.length = 0;
    app.resume();
    app.step(FIXED);
    expect(log).toEqual(["fixedUpdate", "update", "render"]);
    expect(app.time.simulationStep).toBe(1);
  });

  it("can be paused before start (§45 pause is a pure proxy)", () => {
    const app = new Application();
    app.pause();
    expect(app.paused).toBe(true);
  });
});

describe("Application — dispose (§45, §83)", () => {
  it("stops, disposes systems, removes listeners, and emits nothing afterwards", async () => {
    const app = await startedApplication();
    const log: string[] = [];
    traceEvents(app, log);
    const system = new RecordingSystem("system", log);
    app.systems.register(system);

    app.dispose();

    expect(app.disposed).toBe(true);
    expect(app.running).toBe(false);
    expect(system.disposeCount).toBe(1);
    expect(app.systems.size).toBe(0);
    expect(app.listenerCount("update")).toBe(0);

    // The scheduler is unwired: stepping it directly emits nothing.
    app.scheduler.step(FIXED);
    expect(log).toEqual([]);
    expect(system.fixedUpdateCount).toBe(0);
  });

  it("is idempotent and terminal", async () => {
    const app = await startedApplication();
    const system = new RecordingSystem("system", []);
    app.systems.register(system);

    app.dispose();
    app.dispose();
    expect(system.disposeCount).toBe(1);

    expect(() => {
      app.step(FIXED);
    }).toThrowError(/disposed/);
    expect(() => {
      app.start();
    }).toThrowError(/disposed/);
    expect(() => {
      void app.initialize();
    }).toThrowError(/disposed/);
  });

  it("reports a system's dispose failure but still removes listeners", async () => {
    const app = await startedApplication();
    app.on("update", () => {
      throw new Error("should never run");
    });
    const failing: SimulationSystem = {
      priority: PRIORITY_KINEMATICS,
      initialize: () => undefined,
      fixedUpdate: () => undefined,
      dispose: () => {
        throw new Error("system dispose failed");
      },
    };
    app.systems.register(failing);

    expect(() => {
      app.dispose();
    }).toThrowError(/system dispose failed/);
    expect(app.disposed).toBe(true);
    expect(app.listenerCount("update")).toBe(0);
  });
});

describe("Application — renderer integration (§45, §61, §43)", () => {
  /** An application wired to a recording backend, with one full-screen view. */
  async function renderedApplication(
    options: Omit<ApplicationOptions, "renderer"> = {},
  ): Promise<{
    app: Application;
    renderer: NullRenderer;
    view: Viewport;
  }> {
    const renderer = new NullRenderer();
    const camera = new PerspectiveCamera({ aspect: 1 });
    const view = createFullscreenViewport(camera);
    const app = new Application({ renderer, views: [view], ...options });
    app.scene.add(camera);
    await app.initialize();
    app.start();
    return { app, renderer, view };
  }

  it("is headless by default: no renderer, no views, no snapshot system", async () => {
    const app = await startedApplication();

    expect(app.renderer).toBeNull();
    expect(app.views).toEqual([]);
    expect(app.systems.size).toBe(0);
    expect(app.poses.size).toBe(0);

    // A frame still runs end to end; there is simply nothing to draw into.
    const log: string[] = [];
    traceEvents(app, log);
    app.step(FIXED);
    expect(log).toEqual(["fixedUpdate", "update", "render"]);
  });

  it("awaits renderer.initialize with the canvas, and only then is initialized", async () => {
    const renderer = new NullRenderer();
    const canvas = { id: "surface" };
    const app = new Application({ renderer, canvas });

    const pending = app.initialize();
    // Nothing has happened yet: §45's initialization is asynchronous, so the
    // backend is acquired on the microtask, not inside the call.
    expect(renderer.initializeCount).toBe(0);
    expect(app.initialized).toBe(false);

    await pending;

    expect(renderer.initializeCount).toBe(1);
    expect(renderer.lastInitializeOptions).toEqual({ canvas });
    expect(app.initialized).toBe(true);
  });

  it("initializes the backend exactly once for repeated calls", async () => {
    const renderer = new NullRenderer();
    const app = new Application({ renderer });

    await Promise.all([app.initialize(), app.initialize()]);
    await app.initialize();

    expect(renderer.initializeCount).toBe(1);
  });

  it("rejects, and refuses to start, when the backend cannot initialize", async () => {
    const failure = new Error("no GPU");
    const renderer = new NullRenderer();
    renderer.initialize = () => Promise.reject(failure);
    const app = new Application({ renderer });

    await expect(app.initialize()).rejects.toBe(failure);

    expect(app.initialized).toBe(false);
    expect(() => {
      app.start();
    }).toThrowError(/initialize/);
  });

  it("draws the scene, the views, and the §43 interpolation once per frame", async () => {
    const { app, renderer, view } = await renderedApplication();

    app.step(FIXED * 1.5);

    expect(renderer.renderCount).toBe(1);
    expect(renderer.lastRenderRoot).toBe(app.scene);
    // The array itself, not a copy: §61's contract is that a backend reads it
    // during the call.
    expect(renderer.lastViews).toBe(app.views);
    expect(renderer.lastViews).toEqual([view]);
    expect(renderer.lastInterpolation?.poseBuffer).toBe(app.poses);
    expect(renderer.lastInterpolation?.alpha).toBe(app.time.interpolationAlpha);
    expect(app.time.interpolationAlpha).toBeCloseTo(0.5, 12);

    app.step(FIXED);
    expect(renderer.renderCount).toBe(2);
  });

  it("reuses one interpolation record, rewriting only its alpha (D7)", async () => {
    const { app, renderer } = await renderedApplication();

    app.step(FIXED * 1.25);
    const first = renderer.lastInterpolation;
    const firstAlpha = first?.alpha;
    app.step(FIXED * 0.5);

    expect(renderer.lastInterpolation).toBe(first);
    expect(firstAlpha).toBeCloseTo(0.25, 12);
    expect(renderer.lastInterpolation?.alpha).toBeCloseTo(0.75, 12);
  });

  it("draws after the render listeners, so a listener can set the frame up", async () => {
    const { app, renderer, view } = await renderedApplication();
    const order: string[] = [];
    app.on("render", () => {
      order.push(`listener:${String(renderer.renderCount)}`);
      view.x = 0.25;
    });

    app.step(FIXED);

    expect(order).toEqual(["listener:0"]);
    expect(renderer.renderCount).toBe(1);
    // The listener's edit is in the frame that was drawn, not the next one.
    expect(renderer.lastViews?.[0].x).toBe(0.25);
  });

  it("draws nothing while the view list is empty (§61)", async () => {
    const { app, renderer } = await renderedApplication({ views: [] });

    app.step(FIXED);
    expect(renderer.renderCount).toBe(0);

    // Pushing a viewport is all it takes; nothing is re-initialized.
    const camera = new PerspectiveCamera({ aspect: 1 });
    app.views.push(createFullscreenViewport(camera));
    app.step(FIXED);
    expect(renderer.renderCount).toBe(1);
  });

  it("copies the views option, so the author's array is not the app's", () => {
    const camera = new PerspectiveCamera({ aspect: 1 });
    const authored = [createFullscreenViewport(camera)];
    const app = new Application({
      renderer: new NullRenderer(),
      views: authored,
    });

    authored.push(createFullscreenViewport(camera, "second"));

    expect(app.views).toHaveLength(1);
    expect(app.views).not.toBe(authored);
  });

  it("registers the §39 step-10 snapshot system and captures per fixed step", async () => {
    const { app } = await renderedApplication();
    const node = new Group();
    app.scene.add(node);
    app.poses.track(node);
    expect(app.systems.size).toBe(1);

    // A system (not a listener) moves the node, so the move happens before the
    // capture at PRIORITY_SNAPSHOT.
    app.systems.register(
      new RecordingSystem("mover", [], PRIORITY_KINEMATICS, () => {
        node.transform.position.x += 1;
      }),
    );
    app.step(FIXED);
    app.step(FIXED);

    const position = new Vector3();
    const rotation = new Quaternion();
    expect(app.poses.computeRenderPose(node, 0, position, rotation)).toBe(true);
    expect(position.x).toBe(1);
    app.poses.computeRenderPose(node, 1, position, rotation);
    expect(position.x).toBe(2);
    app.poses.computeRenderPose(node, 0.5, position, rotation);
    expect(position.x).toBe(1.5);
    // §43: the render pose is presentation-only.
    expect(node.transform.position.x).toBe(2);
  });

  it("tracks nothing on its own — interpolation is opt-in per node", async () => {
    const { app } = await renderedApplication();
    app.scene.add(new Group(), new Group());

    app.step(FIXED);

    expect(app.poses.size).toBe(0);
  });

  it("omits the interpolation argument when poseInterpolation is false", async () => {
    const { app, renderer } = await renderedApplication({
      poseInterpolation: false,
    });

    app.step(FIXED * 1.5);

    expect(renderer.renderCount).toBe(1);
    expect(renderer.lastInterpolation).toBeNull();
    expect(app.systems.size).toBe(0);
  });

  it("captures poses without a renderer when poseInterpolation is true", async () => {
    const app = new Application({ poseInterpolation: true });
    await app.initialize();
    app.start();
    const node = new Group();
    app.scene.add(node);
    app.poses.track(node);

    expect(app.renderer).toBeNull();
    expect(app.systems.size).toBe(1);

    node.transform.position.set(3, 0, 0);
    app.step(FIXED);

    const position = new Vector3();
    const rotation = new Quaternion();
    app.poses.computeRenderPose(node, 1, position, rotation);
    expect(position.x).toBe(3);
  });

  it("does not dispose the renderer it was lent (§83)", async () => {
    const { app, renderer } = await renderedApplication();
    app.step(FIXED);

    app.dispose();

    expect(app.disposed).toBe(true);
    expect(renderer.disposed).toBe(false);
    // Still usable, and no longer driven by the disposed application.
    expect(() => {
      renderer.render(app.scene, app.views);
    }).not.toThrow();
    expect(renderer.renderCount).toBe(2);
  });

  it("stops drawing once disposed", async () => {
    const { app, renderer } = await renderedApplication();
    app.dispose();

    app.scheduler.step(FIXED);

    expect(renderer.renderCount).toBe(0);
  });
});

describe("Application — determinism (§33)", () => {
  it("produces identical event traces for identical injected sequences", async () => {
    const elapsed = [
      FIXED / 3,
      FIXED,
      FIXED * 2.5,
      0,
      FIXED * 20,
      FIXED / 7,
      FIXED * 1.5,
    ];

    const run = async (): Promise<string[]> => {
      const app = await startedApplication();
      const trace: string[] = [];
      const record = (event: string) => (time: ReadonlyTimeState) => {
        trace.push(
          [
            event,
            time.frame,
            time.simulationStep,
            time.simulationTime.toFixed(9),
            time.realTime.toFixed(9),
            time.renderTime.toFixed(9),
            time.deltaTime.toFixed(9),
            time.unscaledDeltaTime.toFixed(9),
            time.interpolationAlpha.toFixed(9),
            time.droppedTime.toFixed(9),
          ].join("|"),
        );
      };
      app.on("fixedUpdate", record("fixedUpdate"));
      app.on("update", record("update"));
      app.on("render", record("render"));
      app.systems.register(
        new RecordingSystem("system", trace, PRIORITY_KINEMATICS, (context) => {
          trace.push(`system|${context.time.simulationStep.toString()}`);
        }),
      );
      for (const value of elapsed) {
        app.step(value);
      }
      app.dispose();
      return trace;
    };

    const first = await run();
    const second = await run();

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(elapsed.length * 2);
  });
});

/**
 * A-7 (2026-08-06): §45 lists eight lifecycle methods and seven shipped. The
 * eighth — `resize` — is where the surface size and the cameras that depend on
 * it are reconciled, which is the one part of a resize no renderer can do for
 * itself (§61: "a camera's `aspect` is the application's to set").
 */
describe("Application — resize (§45, §61, §47)", () => {
  it("records the size, and reports 0 × 0 at 1× before any resize", () => {
    const app = new Application();

    expect(app.width).toBe(0);
    expect(app.height).toBe(0);
    expect(app.resolution).toBe(1);

    app.resize(800, 600, 2);

    expect(app.width).toBe(800);
    expect(app.height).toBe(600);
    expect(app.resolution).toBe(2);
  });

  it("forwards to the renderer, resolution included", () => {
    const renderer = new NullRenderer();
    const app = new Application({ renderer });

    app.resize(1280, 720, 1.5);

    expect(renderer.resizeCount).toBe(1);
    expect(renderer.lastResize).toEqual({
      width: 1280,
      height: 720,
      resolution: 1.5,
    });
  });

  it("keeps the previous resolution when the argument is omitted", () => {
    const renderer = new NullRenderer();
    const app = new Application({ renderer });

    app.resize(800, 600, 3);
    app.resize(400, 300);

    expect(app.resolution).toBe(3);
    expect(renderer.lastResize).toEqual({
      width: 400,
      height: 300,
      resolution: 3,
    });
  });

  it("is a renderer no-op when headless, and still records the size", () => {
    const app = new Application();

    expect(() => {
      app.resize(640, 480);
    }).not.toThrow();
    expect(app.width).toBe(640);
    expect(app.height).toBe(480);
  });

  it("updates a full-surface perspective camera's aspect and projection", () => {
    const camera = new PerspectiveCamera({ fieldOfView: Math.PI / 3 });
    const app = new Application({ views: [createFullscreenViewport(camera)] });
    const before = camera.projectionMatrix.elements.slice();

    app.resize(1600, 800);

    expect(camera.aspect).toBe(2);
    expect([...camera.projectionMatrix.elements]).not.toEqual([...before]);
    // The inverse is rebuilt with it (§47), so unprojection stays consistent.
    expect(camera.inverseProjectionMatrix.elements[0]).toBeCloseTo(
      1 / camera.projectionMatrix.elements[0],
      12,
    );
  });

  it("leaves a partial viewport's camera alone", () => {
    const camera = new PerspectiveCamera({ aspect: 1 });
    const view: Viewport = {
      id: "inset",
      camera,
      x: 0,
      y: 0,
      width: 0.5,
      height: 1,
      normalized: true,
    };
    const app = new Application({ views: [view] });

    app.resize(1600, 800);

    expect(camera.aspect).toBe(1);
  });

  it("leaves a pixel-rectangle viewport's camera alone", () => {
    const camera = new PerspectiveCamera({ aspect: 1 });
    const app = new Application({
      views: [{ id: "fixed", camera, x: 0, y: 0, width: 1, height: 1 }],
    });

    app.resize(1600, 800);

    expect(camera.aspect).toBe(1);
  });

  it("feeds a full-surface ScreenCamera the surface size (R-37)", () => {
    const camera = new ScreenCamera();
    const app = new Application({ views: [createFullscreenViewport(camera)] });

    app.resize(1600, 800, 2);

    expect(camera.width).toBe(1600);
    expect(camera.height).toBe(800);
    expect(camera.resolution).toBe(2);
    // The projection was rebuilt with it: the right edge is now 1600 px.
    const e = camera.projectionMatrix.elements;
    expect(e[0] * 1600 + e[12]).toBeCloseTo(1, 12);
    // Logical units by default, so the 2× buffer did not double the rectangle.
    expect(camera.pixelWidth).toBe(1600);
  });

  it("counts device pixels for a physical-unit ScreenCamera (R-37)", () => {
    const camera = new ScreenCamera({ units: "physical" });
    const app = new Application({ views: [createFullscreenViewport(camera)] });

    app.resize(400, 300, 2);

    expect(camera.pixelWidth).toBe(800);
    const e = camera.projectionMatrix.elements;
    expect(e[0] * 800 + e[12]).toBeCloseTo(1, 12);
  });

  it("leaves a ScreenCamera in a partial viewport to its owner (R-37)", () => {
    const camera = new ScreenCamera({ width: 100, height: 100 });
    const app = new Application({
      views: [
        {
          id: "inset",
          camera,
          x: 0,
          y: 0,
          width: 0.5,
          height: 1,
          normalized: true,
        },
      ],
    });

    app.resize(1600, 800);

    expect(camera.width).toBe(100);
  });

  it("never pushes a degenerate size into a ScreenCamera (§85, R-37)", () => {
    const camera = new ScreenCamera({ width: 320, height: 240 });
    const app = new Application({ views: [createFullscreenViewport(camera)] });

    // `resize` returns before the camera loop for a `0 × 0` surface, so the
    // camera keeps a projection it can use rather than being handed a size it
    // would have to refuse.
    expect(() => {
      app.resize(0, 0);
    }).not.toThrow();
    expect(camera.width).toBe(320);
  });

  it("leaves an orthographic camera's extent alone", () => {
    const camera = new OrthographicCamera({
      left: -8,
      right: 8,
      bottom: -4.5,
      top: 4.5,
    });
    const app = new Application({ views: [createFullscreenViewport(camera)] });

    app.resize(1600, 800);

    expect(camera.left).toBe(-8);
    expect(camera.right).toBe(8);
  });

  it("touches no camera for a degenerate surface", () => {
    const camera = new PerspectiveCamera({ aspect: 1 });
    const renderer = new NullRenderer();
    const app = new Application({
      renderer,
      views: [createFullscreenViewport(camera)],
    });

    app.resize(0, 600);

    // The renderer is still told — a zero-width canvas is a real state — but a
    // projection is not written with an aspect of 0.
    expect(renderer.lastResize).toEqual({
      width: 0,
      height: 600,
      resolution: 1,
    });
    expect(camera.aspect).toBe(1);
  });

  it("updates every full-surface view, sharing a camera idempotently", () => {
    const camera = new PerspectiveCamera({ aspect: 1 });
    const second = new PerspectiveCamera({ aspect: 1 });
    const app = new Application({
      views: [
        createFullscreenViewport(camera, "main"),
        createFullscreenViewport(second, "overlay"),
        createFullscreenViewport(camera, "again"),
      ],
    });

    app.resize(1000, 250);

    expect(camera.aspect).toBe(4);
    expect(second.aspect).toBe(4);
  });

  it("applies the constructor's width, height and resolution", () => {
    const camera = new PerspectiveCamera({ aspect: 1 });
    const renderer = new NullRenderer();
    const app = new Application({
      renderer,
      width: 900,
      height: 300,
      resolution: 2,
      views: [createFullscreenViewport(camera)],
    });

    expect(app.width).toBe(900);
    expect(app.resolution).toBe(2);
    expect(renderer.lastResize).toEqual({
      width: 900,
      height: 300,
      resolution: 2,
    });
    expect(camera.aspect).toBe(3);
  });

  it("declares no size when only one dimension is supplied", () => {
    const renderer = new NullRenderer();
    const app = new Application({ renderer, width: 900, resolution: 2 });

    expect(app.width).toBe(0);
    expect(app.resolution).toBe(2);
    expect(renderer.resizeCount).toBe(0);
  });

  // 2026-08-07: the resolution-only constructor path never reached `resize`,
  // so a bad value was stored unchecked and forwarded to `renderer.resize` by
  // whatever `app.resize(w, h)` came next — an error reported at a call site
  // that had done nothing wrong.
  it("refuses a constructor resolution that is not a positive finite number", () => {
    for (const resolution of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => new Application({ renderer: new NullRenderer(), resolution }),
      ).toThrow(RangeError);
    }

    // …and the same value is still refused on the width/height path.
    expect(
      () =>
        new Application({
          renderer: new NullRenderer(),
          width: 100,
          height: 100,
          resolution: 0,
        }),
    ).toThrow(RangeError);
  });

  it("recomputes projections with the configured depth range (D8)", () => {
    const negativeOne = new PerspectiveCamera({ aspect: 1 });
    const zeroToOne = new PerspectiveCamera({ aspect: 1 });
    new Application({
      views: [createFullscreenViewport(negativeOne)],
    }).resize(1600, 800);
    new Application({
      depthRange: "zero-to-one",
      views: [createFullscreenViewport(zeroToOne)],
    }).resize(1600, 800);

    // The two conventions differ in the third column/row of the projection.
    expect(negativeOne.projectionMatrix.elements[10]).not.toBe(
      zeroToOne.projectionMatrix.elements[10],
    );
  });

  it("refuses arguments that are not a surface", () => {
    const app = new Application();

    expect(() => {
      app.resize(Number.NaN, 100);
    }).toThrow(RangeError);
    expect(() => {
      app.resize(100, -1);
    }).toThrow(RangeError);
    expect(() => {
      app.resize(100, 100, 0);
    }).toThrow(RangeError);
    expect(() => {
      app.resize(100, 100, Number.POSITIVE_INFINITY);
    }).toThrow(RangeError);
  });

  it("is legal before initialize and while stopped, and refused after dispose", async () => {
    const app = new Application({ renderer: new NullRenderer() });

    app.resize(100, 100);
    await app.initialize();
    app.start();
    app.stop();
    app.resize(200, 200);
    expect(app.width).toBe(200);

    app.dispose();
    let thrown: unknown;
    try {
      app.resize(300, 300);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });
});

// ---------------------------------------------------------------------------
// §84 runtime statistics (A-1, 2026-08-07).
// ---------------------------------------------------------------------------

/** A clock the test drives, in seconds (§7a). */
class TestClock {
  seconds = 0;

  /** Every reading handed out, in call order. */
  readonly readings: number[] = [];

  readonly now = (): number => {
    this.readings.push(this.seconds);
    return this.seconds;
  };

  /** Advances the clock, as a frame's work would. */
  advance(delta: number): void {
    this.seconds += delta;
  }
}

/**
 * A renderer that reports §84 draw counters — a `NullRenderer` that counts as
 * if it had drawn, which is the only way to assert the copy-back headlessly
 * (the real counting is `@four/render-webgl`'s own test).
 */
class CountingRenderer extends NullRenderer {
  /** Added to the assigned record on every `render` call. */
  drawsPerFrame = 3;

  override render(...args: Parameters<NullRenderer["render"]>): void {
    super.render(...args);
    const statistics = this.statistics;
    if (statistics !== null) {
      statistics.drawCalls += this.drawsPerFrame;
      statistics.triangles += this.drawsPerFrame * 2;
      statistics.instances += this.drawsPerFrame;
    }
  }
}

/** A backend that does not report statistics at all (§61's optional member). */
class UncountingRenderer extends NullRenderer {
  constructor() {
    super();
    // The capability is presence: a backend that cannot count omits the
    // member, and `Application` must then report "not measured" rather than a
    // confident zero.
    delete (this as { statistics?: unknown }).statistics;
  }
}

describe("Application — §84 statistics (A-1)", () => {
  it("has no statistics by default", async () => {
    const app = await startedApplication({ renderer: new NullRenderer() });
    app.step(FIXED);
    expect(app.stats).toBeNull();
  });

  it("never reads the clock while statistics are off", async () => {
    const clock = new TestClock();
    const app = await startedApplication({ now: clock.now });
    app.step(FIXED * 3);
    expect(clock.readings).toEqual([]);
  });

  it("never assigns the renderer's record while statistics are off", async () => {
    const renderer = new CountingRenderer();
    const app = await startedApplication({ renderer });
    app.step(FIXED);
    expect(renderer.statistics).toBeNull();
    expect(app.stats).toBeNull();
  });

  it("exposes §84's eleven counters once switched on", async () => {
    const app = await startedApplication({ stats: true });
    expect(Object.keys(app.stats ?? {})).toEqual([
      "cpuFrameTime",
      "gpuFrameTime",
      "simulationTime",
      "physicsStepTime",
      "drawCalls",
      "triangles",
      "instances",
      "activeBodies",
      "contacts",
      "textureMemory",
      "bufferMemory",
    ]);
  });

  it("measures cpuFrameTime in seconds across the whole step", async () => {
    const clock = new TestClock();
    const app = await startedApplication({ stats: true, now: clock.now });
    app.on("render", () => {
      clock.advance(0.004);
    });
    app.on("update", () => {
      clock.advance(0.002);
    });

    app.step(FIXED);

    expect(app.stats?.cpuFrameTime).toBeCloseTo(0.006, 12);
  });

  it("measures simulationTime as the seconds spent in the frame's fixed steps", async () => {
    const clock = new TestClock();
    const app = await startedApplication({ stats: true, now: clock.now });
    app.on("fixedUpdate", () => {
      clock.advance(0.001);
    });
    app.on("update", () => {
      clock.advance(0.5);
    });

    // Three fixed steps' worth of elapsed time, one `update`.
    app.step(FIXED * 3);

    expect(app.stats?.simulationTime).toBeCloseTo(0.003, 12);
    // …and the outer measurement still contains it plus the update's half
    // second, which is what makes the two numbers different quantities.
    expect(app.stats?.cpuFrameTime).toBeCloseTo(0.503, 12);
  });

  it("reports 0 simulation seconds for a frame that ran no fixed step", async () => {
    const app = await startedApplication({ stats: true });
    app.step(FIXED / 4);
    expect(app.stats?.simulationTime).toBe(0);
  });

  it("reads the backend's draw counters back after the frame", async () => {
    const renderer = new CountingRenderer();
    const app = await startedApplication({ renderer, stats: true });
    app.views.push(createFullscreenViewport(new PerspectiveCamera()));

    app.step(FIXED);

    expect(app.stats?.drawCalls).toBe(3);
    expect(app.stats?.triangles).toBe(6);
    expect(app.stats?.instances).toBe(3);
  });

  it("clears the backend's record between frames, so counters are per-frame", async () => {
    const renderer = new CountingRenderer();
    const app = await startedApplication({ renderer, stats: true });
    app.views.push(createFullscreenViewport(new PerspectiveCamera()));

    app.step(FIXED);
    app.step(FIXED);

    expect(renderer.renderCount).toBe(2);
    expect(app.stats?.drawCalls).toBe(3);
  });

  it("reports 0 draws for a frame the renderer was not asked to draw", async () => {
    // A counting backend with no viewport: `render` is never called, and
    // "counted; nothing was drawn" is 0 — not `NaN`, which would mean nobody
    // counted at all.
    const renderer = new CountingRenderer();
    const app = await startedApplication({ renderer, stats: true });

    app.step(FIXED);

    expect(renderer.renderCount).toBe(0);
    expect(app.stats?.drawCalls).toBe(0);
  });

  it("reports NaN for draws a headless application cannot have counted", async () => {
    const app = await startedApplication({ stats: true });
    app.step(FIXED);
    expect(app.stats?.drawCalls).toBeNaN();
    expect(app.stats?.triangles).toBeNaN();
    expect(app.stats?.instances).toBeNaN();
  });

  it("reports NaN for a backend that does not report statistics", async () => {
    const renderer = new UncountingRenderer();
    const app = await startedApplication({ renderer, stats: true });
    app.views.push(createFullscreenViewport(new PerspectiveCamera()));

    app.step(FIXED);

    expect(renderer.renderCount).toBe(1);
    expect(app.stats?.drawCalls).toBeNaN();
  });

  it("leaves every staged counter unmeasured, frame after frame", async () => {
    const renderer = new CountingRenderer();
    const app = await startedApplication({ renderer, stats: true });
    app.views.push(createFullscreenViewport(new PerspectiveCamera()));

    app.step(FIXED);
    app.step(FIXED);

    // The four §84 counters with no producer in this repository. They must read
    // "not measured", not 0 — see `FrameStats` for what each one waits on.
    // `textureMemory`/`bufferMemory` left this list when A-5 landed §83's
    // resource accounting (2026-08-07); they are asserted live below.
    expect(app.stats?.gpuFrameTime).toBeNaN();
    expect(app.stats?.physicsStepTime).toBeNaN();
    expect(app.stats?.activeBodies).toBeNaN();
    expect(app.stats?.contacts).toBeNaN();
  });

  it("reports §83's live-resource totals as the two memory counters (A-5)", async () => {
    const app = await startedApplication({ stats: true });

    app.step(FIXED);
    const textureBefore = app.stats?.textureMemory ?? Number.NaN;
    const bufferBefore = app.stats?.bufferMemory ?? Number.NaN;
    expect(textureBefore).not.toBeNaN();
    expect(bufferBefore).not.toBeNaN();

    // Process-wide totals, so the assertions are deltas: another test file in
    // the same worker may hold resources of its own (§83 — the numbers are
    // levels for the realm, not for this application).
    const geometry = new BufferGeometry({
      positions: new Float32Array(9),
    });
    const texture = new Texture({ width: 4, height: 4 });

    app.step(FIXED);
    expect((app.stats?.bufferMemory ?? 0) - bufferBefore).toBe(36);
    expect((app.stats?.textureMemory ?? 0) - textureBefore).toBe(64);

    geometry.dispose();
    texture.dispose();

    app.step(FIXED);
    expect(app.stats?.bufferMemory).toBe(bufferBefore);
    expect(app.stats?.textureMemory).toBe(textureBefore);
  });

  it("measures the memory counters with no renderer at all (A-5)", async () => {
    // Unlike the draw counters, these need no backend: a geometry a headless
    // application built is memory the engine holds whether or not it was drawn.
    const app = await startedApplication({ stats: true });

    app.step(FIXED);

    expect(app.stats?.drawCalls).toBeNaN();
    expect(app.stats?.bufferMemory).toBeGreaterThanOrEqual(0);
    expect(app.stats?.textureMemory).toBeGreaterThanOrEqual(0);
  });

  it("rewrites one record in place rather than allocating per frame", async () => {
    const app = await startedApplication({ stats: true });
    const stats = app.stats;
    app.step(FIXED);
    const first = stats?.cpuFrameTime;
    app.step(FIXED);
    expect(app.stats).toBe(stats);
    expect(typeof first).toBe("number");
  });

  it("describes the last completed frame, never a half-finished one", async () => {
    const clock = new TestClock();
    const app = await startedApplication({ stats: true, now: clock.now });
    app.step(FIXED);
    const measured = app.stats?.cpuFrameTime;
    app.on("update", () => {
      throw new Error("listener exploded");
    });

    expect(() => {
      app.step(FIXED);
    }).toThrow("listener exploded");

    // The throwing frame wrote nothing back: `cpuFrameTime` was reset to "not
    // measured" at the top of the step and never finished.
    expect(app.stats?.cpuFrameTime).toBeNaN();
    expect(typeof measured).toBe("number");
  });

  it("keeps the time a throwing fixed step really spent", async () => {
    const clock = new TestClock();
    const app = await startedApplication({ stats: true, now: clock.now });
    app.on("fixedUpdate", () => {
      clock.advance(0.002);
      throw new Error("system exploded");
    });

    expect(() => {
      app.step(FIXED);
    }).toThrow("system exploded");

    expect(app.stats?.simulationTime).toBeCloseTo(0.002, 12);
  });

  it("gives the renderer its statistics slot back on dispose (§83)", () => {
    const renderer = new CountingRenderer();
    const app = new Application({ renderer, stats: true });
    expect(renderer.statistics).not.toBeNull();

    app.dispose();

    expect(renderer.statistics).toBeNull();
  });

  it("leaves a slot it did not fill alone", () => {
    const renderer = new CountingRenderer();
    const app = new Application({ renderer, stats: true });
    const foreign = { drawCalls: 0, triangles: 0, instances: 0 };
    renderer.statistics = foreign;

    app.dispose();

    // A second application — or the author's own profiler — took the slot
    // after this one filled it; disposal must not steal it back.
    expect(renderer.statistics).toBe(foreign);
  });

  it("does not touch the renderer's slot when statistics are off", () => {
    const renderer = new CountingRenderer();
    const foreign = { drawCalls: 0, triangles: 0, instances: 0 };
    renderer.statistics = foreign;
    const app = new Application({ renderer });

    app.dispose();

    expect(renderer.statistics).toBe(foreign);
  });

  it("changes nothing about the frame it measures (§33)", async () => {
    // Determinism's own guard: two applications fed identical steps produce
    // identical event traces and identical scene state whether or not one of
    // them is being measured. A statistics option that moved a single number
    // would break every §92 determinism suite.
    const plain: string[] = [];
    const measured: string[] = [];
    const a = await startedApplication({ renderer: new NullRenderer() });
    const b = await startedApplication({
      renderer: new NullRenderer(),
      stats: true,
    });
    traceEvents(a, plain);
    traceEvents(b, measured);
    const node = new Group();
    a.scene.add(node);
    const other = new Group();
    b.scene.add(other);
    node.transform.position.set(1, 2, 3);
    other.transform.position.set(1, 2, 3);

    for (const elapsed of [FIXED * 2.5, FIXED / 3, FIXED * 7]) {
      a.step(elapsed);
      b.step(elapsed);
    }

    expect(measured).toEqual(plain);
    expect(copyTimeState(b.time)).toEqual(copyTimeState(a.time));
    expect(other.transform.worldMatrix.elements).toEqual(
      node.transform.worldMatrix.elements,
    );
  });
});

describe("Application — §45 renderer selection (R-2 / A-8)", () => {
  /**
   * A registry holding one backend under `backend`, whose renderer is a
   * `NullRenderer` reporting that backend — so §62's preference walk and the
   * application's wiring can both be asserted without a GPU.
   */
  function registryWith(
    backends: readonly {
      backend: RendererBackend;
      supported?: boolean;
      fail?: boolean;
    }[],
  ): { registry: RendererRegistry; built: NullRenderer[] } {
    const registry = new RendererRegistry();
    const built: NullRenderer[] = [];
    for (const entry of backends) {
      registry.register({
        backend: entry.backend,
        isSupported: () => entry.supported ?? true,
        create: () => {
          const renderer = new NullRenderer();
          (renderer as { capabilities: RendererCapabilities }).capabilities = {
            backend: entry.backend,
            maxTextureSize: 0,
          };
          if (entry.fail === true) {
            renderer.initialize = (): Promise<void> =>
              Promise.reject(new Error(`${entry.backend} refused`));
          }
          built.push(renderer);
          return renderer;
        },
      });
    }
    return { registry, built };
  }

  it("holds no renderer until initialize resolves the selection", async () => {
    const { registry } = registryWith([{ backend: "webgl2" }]);
    const app = new Application({
      renderer: "auto",
      rendererRegistry: registry,
    });
    expect(app.renderer).toBeNull();
    await app.initialize();
    expect(app.renderer?.capabilities.backend).toBe("webgl2");
  });

  it("resolves §62's preference order and forwards canvas and antialias", async () => {
    const canvas = {};
    const { registry } = registryWith([
      { backend: "webgl2" },
      { backend: "webgpu" },
    ]);
    const app = new Application({
      renderer: "auto",
      canvas,
      antialias: true,
      rendererRegistry: registry,
    });
    await app.initialize();
    const renderer = app.renderer as NullRenderer;
    expect(renderer.capabilities.backend).toBe("webgpu");
    expect(renderer.lastInitializeOptions).toMatchObject({
      canvas,
      antialias: true,
    });
    expect(renderer.initializeCount).toBe(1);
  });

  it("reports each backend `auto` passes over (§62's diagnostics event)", async () => {
    const { registry } = registryWith([
      { backend: "webgpu", fail: true },
      { backend: "webgl2" },
    ]);
    const reports: RendererFallbackReport[] = [];
    const app = new Application({
      renderer: "auto",
      rendererRegistry: registry,
      onRendererFallback: (report) => reports.push(report),
    });
    await app.initialize();
    expect(app.renderer?.capabilities.backend).toBe("webgl2");
    expect(reports).toHaveLength(1);
    expect(reports[0]?.backend).toBe("webgpu");
    expect(reports[0]?.reason).toBe("initialization-failed");
  });

  it("forwards §62's capability declaration and its shortfall report (WP-R1.9)", async () => {
    const { registry } = registryWith([
      { backend: "webgpu" },
      { backend: "webgl2" },
    ]);
    // The doubles report no `computeShaders` member at all — the tri-state's
    // "not taught to answer", which must not satisfy a requirement — so
    // `"auto"` skips webgpu and webgl2 alike and the selection exhausts;
    // requiring nothing but declaring the optional interest selects webgpu
    // and reports the shortfall instead.
    const fallbacks: RendererFallbackReport[] = [];
    const strict = new Application({
      renderer: "auto",
      rendererRegistry: registry,
      rendererCapabilities: { required: ["computeShaders"] },
      onRendererFallback: (report) => fallbacks.push(report),
    });
    let thrown: unknown;
    try {
      await strict.initialize();
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    expect(fallbacks.map((report) => report.reason)).toEqual([
      "missing-capability",
      "missing-capability",
    ]);

    const relaxed = registryWith([{ backend: "webgpu" }]);
    const shortfalls: RendererCapabilityShortfall[] = [];
    const app = new Application({
      renderer: "auto",
      rendererRegistry: relaxed.registry,
      rendererCapabilities: { optional: ["computeShaders"] },
      onRendererCapabilityShortfall: (report) => shortfalls.push(report),
    });
    await app.initialize();
    expect(app.renderer?.capabilities.backend).toBe("webgpu");
    expect(shortfalls).toEqual([
      {
        backend: "webgpu",
        capability: "computeShaders",
        answer: undefined,
        requirement: "optional",
      },
    ]);
  });

  it("rejects initialize for a malformed capability declaration (§85)", async () => {
    const { registry } = registryWith([{ backend: "webgl2" }]);
    const app = new Application({
      renderer: "auto",
      rendererRegistry: registry,
      rendererCapabilities: {
        required: ["bloom"],
      } as unknown as RendererCapabilityDeclaration,
    });
    await expect(app.initialize()).rejects.toThrow(RangeError);
    expect(app.initialized).toBe(false);
  });

  it("rejects initialize when the selection cannot be satisfied (§62, §89)", async () => {
    const { registry } = registryWith([{ backend: "webgl2" }]);
    const app = new Application({
      renderer: "webgpu",
      rendererRegistry: registry,
    });
    let thrown: unknown;
    try {
      await app.initialize();
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("RENDERER_INITIALIZATION_FAILED");
      expect(thrown.message).toContain('Registered: "webgl2"');
    }
    expect(app.initialized).toBe(false);
    expect(app.renderer).toBeNull();
  });

  it("draws through the resolved renderer, with §43 interpolation on by default", async () => {
    const { registry } = registryWith([{ backend: "webgl2" }]);
    const camera = new PerspectiveCamera({ aspect: 1 });
    const app = new Application({
      renderer: "auto",
      rendererRegistry: registry,
      views: [createFullscreenViewport(camera)],
    });
    await app.initialize();
    app.start();
    app.step(FIXED);
    const renderer = app.renderer as NullRenderer;
    expect(renderer.renderCount).toBe(1);
    expect(renderer.lastRenderRoot).toBe(app.scene);
    expect(renderer.lastInterpolation?.poseBuffer).toBe(app.poses);
  });

  it("replays a size declared before the backend existed", async () => {
    const { registry } = registryWith([{ backend: "webgl2" }]);
    const app = new Application({
      renderer: "auto",
      rendererRegistry: registry,
      width: 800,
      height: 400,
      resolution: 2,
    });
    // Nothing to forward to yet — the option was recorded, not dropped.
    await app.initialize();
    const renderer = app.renderer as NullRenderer;
    expect(renderer.lastResize).toEqual({
      width: 800,
      height: 400,
      resolution: 2,
    });
  });

  it("forwards a resize issued between construction and initialize", async () => {
    const { registry } = registryWith([{ backend: "webgl2" }]);
    const app = new Application({
      renderer: "auto",
      rendererRegistry: registry,
    });
    app.resize(640, 480, 1.5);
    await app.initialize();
    expect((app.renderer as NullRenderer).lastResize).toEqual({
      width: 640,
      height: 480,
      resolution: 1.5,
    });
  });

  it("lends §84 statistics to a renderer it only meets at initialize (A-1)", async () => {
    const { registry } = registryWith([{ backend: "webgl2" }]);
    const app = new Application({
      renderer: "auto",
      rendererRegistry: registry,
      stats: true,
    });
    await app.initialize();
    const renderer = app.renderer as NullRenderer;
    expect(renderer.statistics).not.toBeNull();
    app.dispose();
    // Returned on dispose, exactly as a constructed renderer's is (§83).
    expect(renderer.statistics).toBeNull();
  });

  it("stays headless for `false` and for an omitted option", async () => {
    for (const renderer of [undefined, false] as const) {
      const app = new Application({ renderer });
      await app.initialize();
      expect(app.renderer).toBeNull();
      expect(app.initialized).toBe(true);
    }
  });

  it("still takes an instance, and initializes it with the antialias option", async () => {
    const renderer = new NullRenderer();
    const app = new Application({ renderer, antialias: true, canvas: {} });
    expect(app.renderer).toBe(renderer);
    await app.initialize();
    expect(renderer.lastInitializeOptions?.antialias).toBe(true);
  });

  it("resolves against the shared registry when none is passed", async () => {
    registerRenderer({
      backend: "webgl2",
      isSupported: () => true,
      create: () => new NullRenderer(),
    });
    try {
      const app = new Application({ renderer: "auto" });
      await app.initialize();
      expect(app.renderer).toBeInstanceOf(NullRenderer);
    } finally {
      clearRegisteredRenderers();
    }
  });

  it("says nothing is registered when no backend opted in (§85)", async () => {
    const app = new Application({ renderer: "auto" });
    await expect(app.initialize()).rejects.toThrow(/no backend is registered/);
  });
});

describe("Application — §85 production build (A-4)", () => {
  /**
   * The §84 wiring above is what a production bundle drops. Proving that at the
   * *source* level means evaluating the other build: `DEV` is resolved once at
   * module load and has no setter (see `packages/core/src/dev.ts`), so the only
   * honest test is a fresh module graph with `__FOUR_DEV__` defined.
   *
   * That this actually removes the code from a bundle — rather than merely
   * skipping it at runtime — is `tests/integration/dev-build-mode.test.ts`,
   * which runs a real bundler. Two different claims, two different gates.
   */
  async function productionApplication(
    options: ApplicationOptions = {},
  ): Promise<Application> {
    vi.stubGlobal("__FOUR_DEV__", false);
    vi.resetModules();
    const module = await import("../src/application.js");
    const app = new module.Application(options);
    await app.initialize();
    app.start();
    return app;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("leaves app.stats null even when stats: true was asked for", async () => {
    const app = await productionApplication({ stats: true });
    app.step(FIXED);
    // The declared type is `FrameStats | null` in both builds — the option and
    // the member keep their shapes, so nothing here is a public-API change.
    expect(app.stats).toBeNull();
  });

  it("never reads the injected clock", async () => {
    const clock = new TestClock();
    const app = await productionApplication({ stats: true, now: clock.now });
    app.step(FIXED * 3);
    expect(clock.readings).toEqual([]);
  });

  it("never borrows the renderer's statistics record", async () => {
    const renderer = new CountingRenderer();
    const app = await productionApplication({ renderer, stats: true });
    app.step(FIXED);
    expect(renderer.statistics).toBeNull();
    app.dispose();
    expect(renderer.statistics).toBeNull();
  });

  it("runs the frame otherwise unchanged", async () => {
    // §33's rule for the flag: it may remove measurement, never change a
    // number. The loop still steps, still emits, still draws.
    const renderer = new CountingRenderer();
    const app = await productionApplication({ renderer });
    const log: string[] = [];
    app.on("fixedUpdate", () => log.push("fixedUpdate"));
    app.on("update", () => log.push("update"));
    app.on("render", () => log.push("render"));
    app.step(FIXED);
    expect(log).toEqual(["fixedUpdate", "update", "render"]);
    expect(app.time.simulationStep).toBe(1);
  });

  it("still steps the physics world, and measures nothing (A-6)", async () => {
    // The §33 rule applied to A-6's addition: the build flag removes the two
    // counters and not one solver call.
    const world = new FakeWorld();
    const app = await productionApplication({
      stats: true,
      physics: asWorld(world),
    });
    app.step(FIXED);
    expect(world.calls).toEqual(["initialize", "step", "dispatchEvents"]);
    expect(app.stats).toBeNull();
  });
});

/**
 * A `PhysicsWorld` double — the seven members the composition root actually
 * touches, and nothing else (A-6).
 *
 * A real `PhysicsWorld` needs a `PhysicsSolverAdapter`, and `@four/physics`'
 * own fake is a test fixture of that package rather than an exported one. What
 * is under test here is not the world: it is the *contract* this class has with
 * one — construct or accept, initialize once, step then dispatch per fixed
 * step, count bodies after the frame, dispose only what it built. Every member
 * below appears in that list, so the double is exactly the seam, and a change
 * to `PhysicsWorld` that broke the contract would fail the `as unknown as`
 * cast's neighbours in `src/application.ts` at compile time rather than here.
 */
class FakeWorld {
  initialized = false;

  disposed = false;

  /** Call log, in order, so the two passes' ordering is assertable (§39). */
  readonly calls: string[] = [];

  /** Deltas handed to `step`, in order. */
  readonly deltas: number[] = [];

  /** Seconds the clock advances inside each `step` — the solver's own cost. */
  stepCost = 0;

  /** Awake and sleeping body counts the §113 walk will find. */
  awake = 0;

  asleep = 0;

  colliders = 0;

  /** Contact points `countContacts` will report when implemented on the adapter. */
  contacts = Number.NaN;

  constructor(private readonly clock?: TestClock) {}

  /** The §113 `DebugBodyAccess` `solverStatistics` walks (`world.adapter`). */
  get adapter(): unknown {
    return {
      forEachBody: (visit: (handle: number, id: number) => void): void => {
        for (let i = 0; i < this.awake + this.asleep; i += 1) visit(i, i);
      },
      forEachCollider: (visit: (handle: number, id: number) => void): void => {
        for (let i = 0; i < this.colliders; i += 1) visit(i, i);
      },
      isBodySleeping: (handle: number): boolean => handle >= this.awake,
      ...(Number.isNaN(this.contacts)
        ? {}
        : { countContacts: (): number => this.contacts }),
    };
  }

  initialize(): Promise<void> {
    this.calls.push("initialize");
    this.initialized = true;
    return Promise.resolve();
  }

  step(delta: number): void {
    this.calls.push("step");
    this.deltas.push(delta);
    this.clock?.advance(this.stepCost);
  }

  dispatchEvents(): void {
    this.calls.push("dispatchEvents");
  }

  dispose(): void {
    this.calls.push("dispose");
    this.disposed = true;
  }
}

/** The double, typed as what the option takes. */
function asWorld(world: FakeWorld): NonNullable<ApplicationOptions["physics"]> {
  return world as unknown as NonNullable<ApplicationOptions["physics"]>;
}

describe("Application — §45 physics (A-6)", () => {
  it("has no world by default, and none for `false`", async () => {
    for (const physics of [undefined, false] as const) {
      const app = await startedApplication({ physics });
      app.step(FIXED);
      expect(app.physics).toBeNull();
    }
  });

  it("builds the world from the factory, handing it app.poses (§43)", () => {
    const world = new FakeWorld();
    let seen: unknown;
    const app = new Application({
      physics: (context) => {
        seen = context.poses;
        return asWorld(world) as never;
      },
    });
    // Synchronous, so the world is reachable before `initialize` — and it got
    // the buffer a world constructed before the application never could.
    expect(app.physics).toBe(world);
    expect(seen).toBe(app.poses);
  });

  it("initializes the world it built, once", async () => {
    const world = new FakeWorld();
    const app = new Application({ physics: () => asWorld(world) as never });
    expect(world.initialized).toBe(false);
    await app.initialize();
    await app.initialize();
    expect(world.calls.filter((call) => call === "initialize")).toEqual([
      "initialize",
    ]);
  });

  it("leaves an already-initialized instance alone", async () => {
    const world = new FakeWorld();
    world.initialized = true;
    const app = new Application({ physics: asWorld(world) });
    await app.initialize();
    expect(world.calls).toEqual([]);
  });

  it("initializes an instance that has not been initialized yet", async () => {
    const world = new FakeWorld();
    const app = new Application({ physics: asWorld(world) });
    await app.initialize();
    expect(world.initialized).toBe(true);
  });

  it("steps then dispatches, once per fixed step, at the scaled delta (§39)", async () => {
    const world = new FakeWorld();
    const app = await startedApplication({ physics: asWorld(world) });
    app.step(FIXED * 2);
    expect(world.calls).toEqual([
      "initialize",
      "step",
      "dispatchEvents",
      "step",
      "dispatchEvents",
    ]);
    expect(world.deltas).toEqual([FIXED, FIXED]);
  });

  it("runs the world before the fixedUpdate listeners (§39 order)", async () => {
    const world = new FakeWorld();
    const log: string[] = [];
    const app = await startedApplication({ physics: asWorld(world) });
    app.on("fixedUpdate", () => log.push("listener"));
    app.systems.register({
      priority: PRIORITY_KINEMATICS,
      initialize: () => undefined,
      fixedUpdate: () => log.push("kinematics"),
      dispose: () => undefined,
    });
    app.step(FIXED);
    // §39: kinematics (step 5) before physics solve (step 6), and an
    // application listener after the whole step.
    expect(log).toEqual(["kinematics", "listener"]);
    expect(world.calls).toContain("step");
  });

  it("disposes a world it built (§83)", async () => {
    const world = new FakeWorld();
    const app = await startedApplication({
      physics: () => asWorld(world) as never,
    });
    app.dispose();
    expect(world.disposed).toBe(true);
  });

  it("never disposes a world it was handed (§83)", async () => {
    const world = new FakeWorld();
    const app = await startedApplication({ physics: asWorld(world) });
    app.dispose();
    expect(world.disposed).toBe(false);
    expect(app.physics).toBe(world);
  });

  it("still removes its listeners when a system's dispose throws", async () => {
    const world = new FakeWorld();
    const app = await startedApplication({
      physics: () => asWorld(world) as never,
    });
    app.systems.register({
      priority: PRIORITY_KINEMATICS,
      initialize: () => undefined,
      fixedUpdate: () => undefined,
      dispose: () => {
        throw new Error("teardown");
      },
    });
    expect(() => {
      app.dispose();
    }).toThrow("teardown");
    // Both of the `finally` clauses still ran.
    expect(world.disposed).toBe(true);
    expect(app.listenerCount("update")).toBe(0);
  });
});

describe("Application — §84 physics counters (A-6)", () => {
  it("leaves physicsStepTime and activeBodies unmeasured with no world", async () => {
    const app = await startedApplication({ stats: true });
    app.step(FIXED);
    expect(app.stats?.physicsStepTime).toBeNaN();
    expect(app.stats?.activeBodies).toBeNaN();
  });

  it("measures physicsStepTime across the frame's fixed steps", async () => {
    const clock = new TestClock();
    const world = new FakeWorld(clock);
    world.stepCost = 0.002;
    const app = await startedApplication({
      stats: true,
      now: clock.now,
      physics: asWorld(world),
    });
    app.on("fixedUpdate", () => {
      clock.advance(0.01);
    });

    app.step(FIXED * 3);

    // The solve only: three steps at 2 ms, and none of the 10 ms per step the
    // listener spent — that share belongs to `simulationTime`.
    expect(app.stats?.physicsStepTime).toBeCloseTo(0.006, 12);
    expect(app.stats?.simulationTime).toBeCloseTo(0.036, 12);
  });

  it("keeps the frame's numbers to that frame", async () => {
    const clock = new TestClock();
    const world = new FakeWorld(clock);
    world.stepCost = 0.001;
    const app = await startedApplication({
      stats: true,
      now: clock.now,
      physics: asWorld(world),
    });
    app.step(FIXED);
    expect(app.stats?.physicsStepTime).toBeCloseTo(0.001, 12);
    // A frame with no fixed step measures a solve of zero seconds — it *was*
    // measured, and it really did no solving.
    app.step(FIXED / 4);
    expect(app.stats?.physicsStepTime).toBe(0);
  });

  it("reports §32's awake bodies after the frame", async () => {
    const world = new FakeWorld();
    world.awake = 4;
    world.asleep = 3;
    world.colliders = 9;
    const app = await startedApplication({
      stats: true,
      physics: asWorld(world),
    });
    app.step(FIXED);
    expect(app.stats?.activeBodies).toBe(4);
    // Reused record: a second frame with a changed population re-reads rather
    // than accumulating.
    world.awake = 1;
    app.step(FIXED);
    expect(app.stats?.activeBodies).toBe(1);
  });

  it("does not count a disposed world", async () => {
    const world = new FakeWorld();
    world.awake = 2;
    const app = await startedApplication({
      stats: true,
      physics: asWorld(world),
    });
    world.disposed = true;
    app.step(FIXED);
    expect(app.stats?.activeBodies).toBeNaN();
  });

  it("leaves contacts unmeasured when the adapter omits countContacts (§84)", async () => {
    const world = new FakeWorld();
    const app = await startedApplication({
      stats: true,
      physics: asWorld(world),
    });
    app.step(FIXED);
    expect(app.stats?.contacts).toBeNaN();
  });

  it("measures contacts when the adapter reports a manifold count (§84)", async () => {
    const world = new FakeWorld();
    world.contacts = 12;
    const app = await startedApplication({
      stats: true,
      physics: asWorld(world),
    });
    app.step(FIXED);
    expect(app.stats?.contacts).toBe(12);
  });
});

describe("Application — §45 autoResize (A-6)", () => {
  it("does not subscribe when no observer was given", () => {
    const app = new Application({});
    app.dispose();
    expect(app.width).toBe(0);
  });

  it("resizes from the host's report, and unsubscribes on dispose (§83)", async () => {
    let report: SurfaceResize | undefined;
    let unobserved = 0;
    const renderer = new NullRenderer();
    const app = await startedApplication({
      renderer,
      surfaceObserver: (onResize) => {
        report = onResize;
        return () => {
          unobserved += 1;
        };
      },
    });

    report?.(800, 400, 2);

    expect(app.width).toBe(800);
    expect(app.height).toBe(400);
    expect(app.resolution).toBe(2);
    expect(renderer.lastResize).toEqual({
      width: 800,
      height: 400,
      resolution: 2,
    });

    app.dispose();
    expect(unobserved).toBe(1);
  });

  it("drops a report that arrives after dispose", async () => {
    let report: SurfaceResize | undefined;
    const app = await startedApplication({
      surfaceObserver: (onResize) => {
        report = onResize;
        return () => undefined;
      },
    });
    app.dispose();
    // `resize` after dispose throws (§45); a queued host notification must not
    // be the thing that throws it, inside the host's own callback.
    expect(() => report?.(640, 480)).not.toThrow();
    expect(app.width).toBe(0);
  });

  it("validates the host's numbers like any other resize (§85)", async () => {
    let report: SurfaceResize | undefined;
    await startedApplication({
      surfaceObserver: (onResize) => {
        report = onResize;
        return () => undefined;
      },
    });
    expect(() => report?.(Number.NaN, 400)).toThrow(RangeError);
  });

  it("refuses autoResize with no observer to subscribe to", () => {
    expect(() => new Application({ autoResize: true })).toThrow(
      /surfaceObserver/,
    );
    try {
      new Application({ autoResize: true });
    } catch (error) {
      expect(isFourError(error)).toBe(true);
    }
  });

  it("leaves an observer unsubscribed when autoResize is off", async () => {
    let subscribed = 0;
    const app = await startedApplication({
      autoResize: false,
      surfaceObserver: () => {
        subscribed += 1;
        return () => undefined;
      },
    });
    expect(subscribed).toBe(0);
    app.dispose();
  });

  it("lets the host's first report win over the declared size", async () => {
    let report: SurfaceResize | undefined;
    const app = await startedApplication({
      width: 100,
      height: 50,
      surfaceObserver: (onResize) => {
        report = onResize;
        return () => undefined;
      },
    });
    expect(app.width).toBe(100);
    report?.(300, 150);
    expect(app.width).toBe(300);
    // No resolution reported: the one in force is kept, as with `resize(w, h)`.
    expect(app.resolution).toBe(1);
  });
});

describe("Application — §45/§75 reducedMotion (A-6, A-13)", () => {
  it("defaults to auto, and auto with no source is false", () => {
    expect(new Application({}).reducedMotion).toBe(false);
  });

  it("follows the platform preference under auto", () => {
    let prefers = false;
    const app = new Application({ reducedMotionSource: () => prefers });
    expect(app.reducedMotion).toBe(false);
    // Re-read every time: a user who turns the setting on mid-session is
    // honoured without this class subscribing to anything.
    prefers = true;
    expect(app.reducedMotion).toBe(true);
  });

  it("overrides the platform outright when given a boolean", () => {
    let asked = 0;
    const source = (): boolean => {
      asked += 1;
      return true;
    };
    expect(
      new Application({ reducedMotion: false, reducedMotionSource: source })
        .reducedMotion,
    ).toBe(false);
    expect(
      new Application({ reducedMotion: true, reducedMotionSource: source })
        .reducedMotion,
    ).toBe(true);
    expect(asked).toBe(0);
  });

  it("reads back auto's resolved answer, not the option", () => {
    const app = new Application({
      reducedMotion: "auto",
      reducedMotionSource: () => true,
    });
    expect(app.reducedMotion).toBe(true);
  });
});

describe("Application — §45/§76 assets (A-6)", () => {
  it("is null when none was given", () => {
    expect(new Application({}).assets).toBeNull();
  });

  it("publishes the manager it was handed, and never disposes it (§83)", () => {
    const manager = new AssetManager();
    const app = new Application({ assets: manager });
    expect(app.assets).toBe(manager);
    app.dispose();
    // `AssetManager.dispose` clears its cache; the application must not have
    // called it — ownership follows construction.
    expect(app.assets).toBe(manager);
  });
});
