import { describe, expect, it } from "vitest";

import { isFourError } from "@four/core";
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
import { Group, resolveWorldTransforms } from "@four/scene";

import { Application } from "../src/application.js";

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
