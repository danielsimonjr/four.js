import { describe, expect, it } from "vitest";

import {
  DEFAULT_FIXED_DELTA_TIME,
  type ReadonlyTimeState,
} from "../src/clock.js";
import { Scheduler, type SchedulerCallback } from "../src/scheduler.js";
import {
  PRIORITY_ANIMATION_TARGETS,
  PRIORITY_COMMANDS,
  PRIORITY_CONSTRAINTS,
  PRIORITY_EVENT_DISPATCH,
  PRIORITY_FORCES,
  PRIORITY_INPUT,
  PRIORITY_KINEMATICS,
  PRIORITY_PHYSICS_SOLVE,
  PRIORITY_RENDER_INTERPOLATION,
  PRIORITY_SENSOR_UPDATE,
  PRIORITY_SNAPSHOT,
  SystemRegistry,
  type FixedUpdateContext,
  type SimulationContext,
  type SimulationSystem,
} from "../src/systems.js";

const FIXED = DEFAULT_FIXED_DELTA_TIME;

/** Shared call log: every system appends `<name>:<event>` so order is one flat list. */
type Log = string[];

/** A `SimulationSystem` that records its lifecycle and can run extra behaviour. */
class RecordingSystem implements SimulationSystem {
  priority: number;

  initializeCount = 0;

  disposeCount = 0;

  fixedUpdateCount = 0;

  /** Contexts seen by `fixedUpdate`, in order. */
  readonly contexts: FixedUpdateContext[] = [];

  /** The context `initialize` was given, if it ran. */
  simulationContext: SimulationContext | undefined;

  constructor(
    readonly name: string,
    priority: number,
    private readonly log: Log,
    private readonly behaviour?: (context: FixedUpdateContext) => void,
  ) {
    this.priority = priority;
  }

  initialize(context: SimulationContext): void {
    this.initializeCount += 1;
    this.simulationContext = context;
    this.log.push(`${this.name}:initialize`);
  }

  fixedUpdate(context: FixedUpdateContext): void {
    this.fixedUpdateCount += 1;
    this.contexts.push(context);
    this.log.push(`${this.name}:fixedUpdate`);
    this.behaviour?.(context);
  }

  dispose(): void {
    this.disposeCount += 1;
    this.log.push(`${this.name}:dispose`);
  }
}

/** Names in `fixedUpdate` order for one run. */
function runOrder(
  registry: SystemRegistry,
  log: Log,
  time: ReadonlyTimeState,
): string[] {
  log.length = 0;
  registry.runFixedStep(time);
  return log
    .filter((entry) => entry.endsWith(":fixedUpdate"))
    .map((entry) => entry.slice(0, entry.indexOf(":")));
}

/** A time record good enough for registry tests (the Scheduler supplies real ones below). */
function timeAt(simulationStep: number): ReadonlyTimeState {
  return {
    realTime: simulationStep * FIXED,
    renderTime: simulationStep * FIXED,
    simulationTime: simulationStep * FIXED,
    deltaTime: FIXED,
    unscaledDeltaTime: FIXED,
    fixedDeltaTime: FIXED,
    timeScale: 1,
    paused: false,
    interpolationAlpha: 0,
    frame: simulationStep,
    simulationStep,
    droppedTime: 0,
  };
}

describe("§39 priority constants", () => {
  it("publishes the eleven §39 steps in order, spaced by 100", () => {
    expect([
      PRIORITY_INPUT,
      PRIORITY_COMMANDS,
      PRIORITY_ANIMATION_TARGETS,
      PRIORITY_KINEMATICS,
      PRIORITY_FORCES,
      PRIORITY_PHYSICS_SOLVE,
      PRIORITY_CONSTRAINTS,
      PRIORITY_SENSOR_UPDATE,
      PRIORITY_EVENT_DISPATCH,
      PRIORITY_SNAPSHOT,
      PRIORITY_RENDER_INTERPOLATION,
    ]).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100]);
  });
});

describe("SystemRegistry ordering (§39)", () => {
  it("runs systems in ascending priority regardless of registration order", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const solve = new RecordingSystem("solve", PRIORITY_PHYSICS_SOLVE, log);
    const input = new RecordingSystem("input", PRIORITY_INPUT, log);
    const snapshot = new RecordingSystem("snapshot", PRIORITY_SNAPSHOT, log);
    const forces = new RecordingSystem("forces", PRIORITY_FORCES, log);
    registry.register(solve);
    registry.register(snapshot);
    registry.register(input);
    registry.register(forces);

    expect(runOrder(registry, log, timeAt(1))).toEqual([
      "input",
      "forces",
      "solve",
      "snapshot",
    ]);
  });

  it("keeps registration order among equal priorities (no sort instability)", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    // Interleave two priorities so a naive unstable sort would show up.
    const names: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      const name = `system${String(index)}`;
      names.push(name);
      registry.register(
        new RecordingSystem(
          name,
          index % 2 === 0 ? PRIORITY_FORCES : PRIORITY_INPUT,
          log,
        ),
      );
    }
    const expected = [
      ...names.filter((_, index) => index % 2 === 1),
      ...names.filter((_, index) => index % 2 === 0),
    ];

    expect(runOrder(registry, log, timeAt(1))).toEqual(expected);
  });

  it("inserts a later-registered system after equal-priority incumbents", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    registry.register(new RecordingSystem("first", PRIORITY_KINEMATICS, log));
    registry.register(new RecordingSystem("late-high", PRIORITY_SNAPSHOT, log));
    registry.register(new RecordingSystem("second", PRIORITY_KINEMATICS, log));

    expect(runOrder(registry, log, timeAt(1))).toEqual([
      "first",
      "second",
      "late-high",
    ]);
  });

  it("captures priority at registration; later mutation does not reorder", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const a = new RecordingSystem("a", PRIORITY_INPUT, log);
    const b = new RecordingSystem("b", PRIORITY_SNAPSHOT, log);
    registry.register(a);
    registry.register(b);
    a.priority = PRIORITY_RENDER_INTERPOLATION;

    expect(runOrder(registry, log, timeAt(1))).toEqual(["a", "b"]);

    // Re-registering applies the new priority.
    registry.unregister(a);
    registry.register(a);
    expect(runOrder(registry, log, timeAt(2))).toEqual(["b", "a"]);
  });

  it("is a no-op with no systems registered", () => {
    const registry = new SystemRegistry();
    expect(registry.size).toBe(0);
    expect(() => {
      registry.runFixedStep(timeAt(1));
    }).not.toThrow();
  });
});

describe("SystemRegistry registration lifecycle (§39)", () => {
  it("calls initialize exactly once, after insertion, with the registry", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const system = new RecordingSystem("only", PRIORITY_INPUT, log);
    registry.register(system);

    expect(system.initializeCount).toBe(1);
    expect(system.simulationContext?.registry).toBe(registry);
    expect(registry.has(system)).toBe(true);
    expect(registry.size).toBe(1);

    registry.runFixedStep(timeAt(1));
    registry.runFixedStep(timeAt(2));
    expect(system.initializeCount).toBe(1);
    expect(system.fixedUpdateCount).toBe(2);
  });

  it("disposes on unregister and stops running the system", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const system = new RecordingSystem("only", PRIORITY_INPUT, log);
    const unregister = registry.register(system);

    registry.runFixedStep(timeAt(1));
    unregister();

    expect(system.disposeCount).toBe(1);
    expect(registry.has(system)).toBe(false);
    expect(registry.size).toBe(0);

    registry.runFixedStep(timeAt(2));
    expect(system.fixedUpdateCount).toBe(1);
  });

  it("has an idempotent unregister function and a boolean unregister method", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const system = new RecordingSystem("only", PRIORITY_INPUT, log);
    const unregister = registry.register(system);

    unregister();
    unregister();
    expect(system.disposeCount).toBe(1);
    expect(registry.unregister(system)).toBe(false);
    expect(system.disposeCount).toBe(1);

    registry.register(system);
    expect(registry.unregister(system)).toBe(true);
    expect(system.disposeCount).toBe(2);
    expect(system.initializeCount).toBe(2);
  });

  it("rejects a duplicate registration and a non-finite priority", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const system = new RecordingSystem("only", PRIORITY_INPUT, log);
    registry.register(system);

    expect(() => registry.register(system)).toThrow(/already registered/u);
    expect(system.initializeCount).toBe(1);
    expect(registry.size).toBe(1);

    expect(() =>
      registry.register(new RecordingSystem("bad", Number.NaN, log)),
    ).toThrow(RangeError);
    expect(registry.size).toBe(1);
  });

  it("disposes every system in reverse registration order on registry dispose", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const first = new RecordingSystem("first", PRIORITY_INPUT, log);
    const second = new RecordingSystem("second", PRIORITY_SNAPSHOT, log);
    registry.register(first);
    registry.register(second);
    log.length = 0;

    registry.dispose();

    expect(log).toEqual(["second:dispose", "first:dispose"]);
    expect(registry.size).toBe(0);
    registry.runFixedStep(timeAt(1));
    expect(first.fixedUpdateCount).toBe(0);
    expect(second.fixedUpdateCount).toBe(0);
  });
});

describe("SystemRegistry snapshot semantics during a fixed step", () => {
  it("defers a system registered mid-step to the next fixed step", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    // Registers a *lower*-priority system, which would otherwise have run first.
    const late = new RecordingSystem("late", PRIORITY_INPUT, log);
    let registered = false;
    const registrar = new RecordingSystem(
      "registrar",
      PRIORITY_FORCES,
      log,
      () => {
        if (!registered) {
          registered = true;
          registry.register(late);
        }
      },
    );
    registry.register(registrar);
    registry.register(new RecordingSystem("tail", PRIORITY_SNAPSHOT, log));

    expect(runOrder(registry, log, timeAt(1))).toEqual(["registrar", "tail"]);
    expect(late.initializeCount).toBe(1);
    expect(late.fixedUpdateCount).toBe(0);

    expect(runOrder(registry, log, timeAt(2))).toEqual([
      "late",
      "registrar",
      "tail",
    ]);
  });

  it("skips a system unregistered mid-step by an earlier system, in the same step", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const victim = new RecordingSystem("victim", PRIORITY_SNAPSHOT, log);
    const killer = new RecordingSystem("killer", PRIORITY_INPUT, log, () => {
      registry.unregister(victim);
    });
    registry.register(killer);
    registry.register(victim);
    registry.register(new RecordingSystem("between", PRIORITY_FORCES, log));

    expect(runOrder(registry, log, timeAt(1))).toEqual(["killer", "between"]);
    expect(victim.fixedUpdateCount).toBe(0);
    expect(victim.disposeCount).toBe(1);
    expect(registry.size).toBe(2);
  });

  it("lets a system unregister itself mid-step without affecting the rest of the step", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const suicide: RecordingSystem = new RecordingSystem(
      "suicide",
      PRIORITY_INPUT,
      log,
      () => {
        registry.unregister(suicide);
      },
    );
    registry.register(suicide);
    registry.register(new RecordingSystem("tail", PRIORITY_SNAPSHOT, log));

    expect(runOrder(registry, log, timeAt(1))).toEqual(["suicide", "tail"]);
    expect(suicide.disposeCount).toBe(1);
    expect(runOrder(registry, log, timeAt(2))).toEqual(["tail"]);
    expect(suicide.fixedUpdateCount).toBe(1);
  });

  it("rejects a re-entrant runFixedStep and stays usable afterwards", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    let thrown: unknown;
    const reenter = new RecordingSystem(
      "reenter",
      PRIORITY_INPUT,
      log,
      (context) => {
        try {
          registry.runFixedStep(context.time);
        } catch (error) {
          thrown = error;
        }
      },
    );
    registry.register(reenter);
    registry.register(new RecordingSystem("tail", PRIORITY_SNAPSHOT, log));

    expect(runOrder(registry, log, timeAt(1))).toEqual(["reenter", "tail"]);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/re-enter/u);
    expect(runOrder(registry, log, timeAt(2))).toEqual(["reenter", "tail"]);
  });
});

describe("SystemRegistry failure policy", () => {
  it("propagates a throwing system, skips the rest of the step, and stays intact", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const failure = new Error("system exploded");
    let explode = true;
    const before = new RecordingSystem("before", PRIORITY_INPUT, log);
    const thrower = new RecordingSystem("thrower", PRIORITY_FORCES, log, () => {
      if (explode) {
        throw failure;
      }
    });
    const after = new RecordingSystem("after", PRIORITY_SNAPSHOT, log);
    registry.register(before);
    registry.register(thrower);
    registry.register(after);

    expect(() => {
      registry.runFixedStep(timeAt(1));
    }).toThrow(failure);
    expect(before.fixedUpdateCount).toBe(1);
    expect(thrower.fixedUpdateCount).toBe(1);
    expect(after.fixedUpdateCount).toBe(0);

    // Not corrupted: the registry still holds all three and runs them all.
    explode = false;
    expect(registry.size).toBe(3);
    expect(runOrder(registry, log, timeAt(2))).toEqual([
      "before",
      "thrower",
      "after",
    ]);
  });

  it("disposes everything even when a dispose throws, re-throwing the first failure", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const failure = new Error("dispose exploded");
    const bad = new RecordingSystem("bad", PRIORITY_FORCES, log);
    bad.dispose = () => {
      bad.disposeCount += 1;
      throw failure;
    };
    const good = new RecordingSystem("good", PRIORITY_INPUT, log);
    registry.register(good);
    registry.register(bad);

    expect(() => {
      registry.dispose();
    }).toThrow(failure);
    expect(good.disposeCount).toBe(1);
    expect(bad.disposeCount).toBe(1);
    expect(registry.size).toBe(0);
  });
});

describe("SystemRegistry.attachToScheduler (D5)", () => {
  it("drives systems from Scheduler.step with the per-step TimeState", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const steps: { step: number; time: number; alpha: number }[] = [];
    const recorder = new RecordingSystem(
      "recorder",
      PRIORITY_PHYSICS_SOLVE,
      log,
      (context) => {
        steps.push({
          step: context.time.simulationStep,
          time: context.time.simulationTime,
          alpha: context.time.interpolationAlpha,
        });
      },
    );
    const first = new RecordingSystem("first", PRIORITY_INPUT, log);
    registry.register(recorder);
    registry.register(first);

    const scheduler = new Scheduler();
    registry.attachToScheduler(scheduler);
    scheduler.step(3 * FIXED);

    expect(scheduler.fixedStepsLastFrame).toBe(3);
    expect(first.fixedUpdateCount).toBe(3);
    expect(recorder.fixedUpdateCount).toBe(3);
    expect(steps.map((entry) => entry.step)).toEqual([1, 2, 3]);
    for (const [index, entry] of steps.entries()) {
      expect(entry.time).toBeCloseTo((index + 1) * FIXED, 12);
      // Interpolation alpha is meaningless inside a fixed step (§42): it still
      // holds the previous frame's value, which is 0 on the first frame.
      expect(entry.alpha).toBe(0);
    }
    // Ordering holds inside the scheduler too.
    expect(log.filter((entry) => entry.endsWith(":fixedUpdate"))).toEqual([
      "first:fixedUpdate",
      "recorder:fixedUpdate",
      "first:fixedUpdate",
      "recorder:fixedUpdate",
      "first:fixedUpdate",
      "recorder:fixedUpdate",
    ]);
  });

  it("restores the previous callback on detach, and is idempotent", () => {
    const log: Log = [];
    const registry = new SystemRegistry();
    const system = new RecordingSystem("only", PRIORITY_INPUT, log);
    registry.register(system);

    const previousCalls: number[] = [];
    const previous: SchedulerCallback = (time) => {
      previousCalls.push(time.simulationStep);
    };
    const scheduler = new Scheduler({ onFixedStep: previous });

    const detach = registry.attachToScheduler(scheduler);
    scheduler.step(FIXED);
    expect(system.fixedUpdateCount).toBe(1);
    expect(previousCalls).toEqual([]);

    detach();
    detach();
    expect(scheduler.onFixedStep).toBe(previous);
    scheduler.step(FIXED);
    expect(system.fixedUpdateCount).toBe(1);
    expect(previousCalls).toEqual([2]);
  });

  it("restores `undefined` when there was no previous callback", () => {
    const registry = new SystemRegistry();
    const scheduler = new Scheduler();
    const detach = registry.attachToScheduler(scheduler);

    expect(scheduler.onFixedStep).toBeTypeOf("function");
    detach();
    expect(scheduler.onFixedStep).toBeUndefined();
  });

  it("does not clobber a callback installed after it", () => {
    const registry = new SystemRegistry();
    const scheduler = new Scheduler();
    const detach = registry.attachToScheduler(scheduler);
    const newer: SchedulerCallback = () => {
      /* no-op */
    };
    scheduler.onFixedStep = newer;

    detach();
    expect(scheduler.onFixedStep).toBe(newer);
  });
});
