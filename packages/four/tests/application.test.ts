import { describe, expect, it } from "vitest";

import { isFourError } from "@four/core";
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
import { NullRenderer } from "@four/render";
import {
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";

import { Application, type ApplicationOptions } from "../src/application.js";

const FIXED = DEFAULT_FIXED_DELTA_TIME;

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

    // The five §84 counters with no producer in this repository. They must read
    // "not measured", not 0 — see `FrameStats` for what each one waits on.
    expect(app.stats?.gpuFrameTime).toBeNaN();
    expect(app.stats?.physicsStepTime).toBeNaN();
    expect(app.stats?.activeBodies).toBeNaN();
    expect(app.stats?.contacts).toBeNaN();
    expect(app.stats?.textureMemory).toBeNaN();
    expect(app.stats?.bufferMemory).toBeNaN();
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
