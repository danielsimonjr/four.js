import { isFourError } from "@four/core";
import { Vector3 } from "@four/math";
import { Group, Node } from "@four/scene";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { AnimationSystem } from "../src/animation-system.js";
import { AnimationClip } from "../src/clip.js";
import {
  AnimationController,
  type AnimationTransition,
  type TransitionCondition,
} from "../src/controller.js";
import { AnimationMixer } from "../src/mixer.js";
import { AnimationTrack } from "../src/track.js";
import { animate } from "../src/tween.js";
import {
  booleanAdapter,
  colorAdapter,
  discreteAdapterFor,
  numberAdapter,
  vector3Adapter,
  type ColorRGBA,
} from "../src/values.js";

/** A node carrying properties outside its transform, as `mixer.test.ts` uses. */
class Widget extends Node {
  opacity = 1;
  visible = true;
  tint: ColorRGBA = [0, 0, 0, 1];
  label = "idle";
}

/** Asserts that `run` throws the §89 error every malformed controller reports. */
function expectInvalid(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(isFourError(thrown)).toBe(true);
  const error = thrown as { code: string } & Error;
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

/** Silences and records `console.warn` for one test. */
function spyOnWarn(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

/**
 * A one-second scalar ramp on `path` from `start` to `end`, so a sample at `t`
 * seconds is `start + (end - start) * t` and every expectation below is
 * hand-computable.
 */
function ramp(
  path: string,
  start: number,
  end: number,
): AnimationTrack<number> {
  return new AnimationTrack({
    path,
    adapter: numberAdapter,
    times: [0, 1],
    values: [start, end],
  });
}

/** A one-track clip over `path`, ramping `start` → `end` across one second. */
function rampClip(
  name: string,
  path: string,
  start: number,
  end: number,
): AnimationClip {
  return new AnimationClip({ name, tracks: [ramp(path, start, end)] });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AnimationController — states and posing (§18)", () => {
  it("poses the initial state at time 0 on play", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: rampClip("idle", "opacity", 0.25, 0.75),
        walk: rampClip("walk", "opacity", 1, 2),
      },
    });

    expect(controller.state).toBe("idle");
    expect(controller.currentState).toBe("idle");
    expect(widget.opacity).toBe(1);

    controller.play();

    expect(controller.state).toBe("running");
    expect(controller.finished).toBe(false);
    expect(controller.target).toBe(widget);
    expect(widget.opacity).toBe(0.25);
  });

  it("accepts the clip shorthand and the options record for a state", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        fast: { clip: rampClip("fast", "opacity", 0, 1), speed: 2 },
        plain: rampClip("plain", "opacity", 0, 1),
      },
    }).play();

    controller.advance(0.25);

    // speed 2: a quarter-second step is half a second of clip time.
    expect(widget.opacity).toBeCloseTo(0.5, 12);
    expect(controller.stateTime).toBeCloseTo(0.5, 12);
    expect(controller.stateLocalTime).toBeCloseTo(0.5, 12);
  });

  it("loops a state forever by default and holds the last pose on a finite loop", () => {
    const widget = new Widget();
    const looping = new AnimationController({
      target: widget,
      states: { spin: rampClip("spin", "opacity", 0, 1) },
    }).play();
    const once = new AnimationController({
      target: new Widget(),
      states: { spin: { clip: rampClip("spin", "opacity", 0, 1), loop: 1 } },
    }).play();

    looping.advance(1.5);
    once.advance(1.5);

    expect(widget.opacity).toBeCloseTo(0.5, 12);
    expect(once.stateTime).toBe(1);
    expect(once.stateLocalTime).toBe(1);
    // A second overrun neither advances the clock nor moves the pose.
    once.advance(5);
    expect(once.stateTime).toBe(1);
  });

  it("treats a zero-length clip as a constant pose", () => {
    const widget = new Widget();
    const track = new AnimationTrack({
      path: "opacity",
      adapter: numberAdapter,
      times: [0],
      values: [0.5],
    });
    const controller = new AnimationController({
      target: widget,
      states: { held: new AnimationClip({ name: "held", tracks: [track] }) },
    }).play();

    controller.advance(3);

    expect(widget.opacity).toBe(0.5);
    expect(controller.stateLocalTime).toBe(0);
  });

  it("holds a channel at its baseline in a state that does not animate it", () => {
    const widget = new Widget();
    widget.opacity = 0.4;
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: new AnimationClip({ name: "idle", tracks: [] }),
        blink: rampClip("blink", "opacity", 1, 1),
      },
      parameters: { booleans: { go: false } },
      transitions: [
        { from: "idle", to: "blink", when: [{ parameter: "go", is: "true" }] },
      ],
    }).play();

    widget.opacity = 0.9;
    controller.advance(0.1);
    expect(widget.opacity).toBe(0.4);

    controller.setBoolean("go", true);
    controller.advance(0.1);
    expect(widget.opacity).toBe(1);
  });

  it("starts in a declared initialState rather than the first key", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
      },
      initialState: "walk",
    }).play();

    expect(controller.currentState).toBe("walk");
    expect(widget.opacity).toBe(1);
  });

  it("shares one channel between states and takes the last track on a path", () => {
    const widget = new Widget();
    const clip = new AnimationClip({
      name: "double",
      tracks: [ramp("opacity", 0, 0), ramp("opacity", 0.5, 0.5)],
    });
    new AnimationController({
      target: widget,
      states: { a: clip, b: rampClip("b", "opacity", 1, 1) },
    }).play();

    expect(widget.opacity).toBe(0.5);
  });
});

describe("AnimationController — transitions (§18)", () => {
  it("takes a numeric-condition transition and reports the switch", () => {
    const widget = new Widget();
    const changes: [string, string][] = [];
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
      },
      parameters: { numbers: { speed: 0 } },
      transitions: [
        {
          from: "idle",
          to: "walk",
          when: [{ parameter: "speed", is: "greater", value: 0.1 }],
        },
      ],
      onStateChange: (to, from) => changes.push([to, from]),
    }).play();

    controller.advance(0.1);
    expect(controller.currentState).toBe("idle");
    expect(changes).toEqual([]);

    controller.setNumber("speed", 5);
    controller.advance(0.1);

    expect(controller.currentState).toBe("walk");
    expect(controller.transitioning).toBe(false);
    expect(controller.transitionWeight).toBe(1);
    expect(controller.stateTime).toBe(0);
    expect(widget.opacity).toBe(1);
    expect(changes).toEqual([["walk", "idle"]]);
  });

  it("cross-fades over a transition duration in seconds (§7a)", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
      },
      parameters: { booleans: { moving: false } },
      transitions: [
        {
          from: "idle",
          to: "walk",
          duration: 0.4,
          when: [{ parameter: "moving", is: "true" }],
        },
      ],
    }).play();

    controller.setBoolean("moving", true);
    controller.advance(0.1);
    // The transition fires on this step and poses at weight 0.
    expect(controller.transitioning).toBe(true);
    expect(controller.previousState).toBe("idle");
    expect(controller.transitionWeight).toBe(0);
    expect(widget.opacity).toBe(0);

    controller.advance(0.1);
    expect(controller.transitionWeight).toBeCloseTo(0.25, 12);
    expect(widget.opacity).toBeCloseTo(0.25, 12);

    controller.advance(0.1);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    controller.advance(0.2);
    expect(controller.transitioning).toBe(false);
    expect(controller.previousState).toBeUndefined();
    expect(widget.opacity).toBe(1);
  });

  it("fades a channel only the destination animates from the baseline", () => {
    const widget = new Widget();
    widget.opacity = 0.2;
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: new AnimationClip({ name: "idle", tracks: [] }),
        walk: rampClip("walk", "opacity", 1, 1),
      },
      parameters: { triggers: ["go"] },
      transitions: [
        {
          from: "idle",
          to: "walk",
          duration: 1,
          when: [{ parameter: "go", is: "triggered" }],
        },
      ],
    }).play();

    controller.setTrigger("go");
    controller.advance(0);
    expect(widget.opacity).toBe(0.2);

    controller.advance(0.5);
    expect(widget.opacity).toBeCloseTo(0.6, 12);
  });

  it("gates a transition on exit time in seconds, with no conditions at all", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        attack: { clip: rampClip("attack", "opacity", 0, 1), loop: 1 },
        idle: rampClip("idle", "opacity", 0.5, 0.5),
      },
      transitions: [{ from: "attack", to: "idle", exitTime: 0.8 }],
    }).play();

    controller.advance(0.5);
    expect(controller.currentState).toBe("attack");
    controller.advance(0.2);
    expect(controller.currentState).toBe("attack");
    controller.advance(0.2);
    expect(controller.currentState).toBe("idle");
  });

  it("scans candidates in declaration order and fires the first eligible one", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
        run: rampClip("run", "opacity", 2, 2),
      },
      parameters: { numbers: { speed: 0 } },
      transitions: [
        {
          from: "idle",
          to: "walk",
          when: [{ parameter: "speed", is: "greater", value: 0.1 }],
        },
        {
          from: "idle",
          to: "run",
          when: [{ parameter: "speed", is: "greater", value: 5 }],
        },
      ],
    }).play();

    controller.setNumber("speed", 9);
    controller.advance(0.1);

    expect(controller.currentState).toBe("walk");
  });

  it("requires every condition of a transition to hold", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
      },
      parameters: { numbers: { speed: 0 }, booleans: { grounded: false } },
      transitions: [
        {
          from: "idle",
          to: "walk",
          when: [
            { parameter: "speed", is: "greater", value: 0.1 },
            { parameter: "grounded", is: "true" },
          ],
        },
      ],
    }).play();

    controller.setNumber("speed", 5);
    controller.advance(0.1);
    expect(controller.currentState).toBe("idle");

    controller.setBoolean("grounded", true);
    controller.advance(0.1);
    expect(controller.currentState).toBe("walk");
  });

  it("ignores transitions that leave a state the machine is not in", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
      },
      transitions: [{ from: "walk", to: "idle" }],
    }).play();

    controller.advance(1);
    expect(controller.currentState).toBe("idle");
  });

  it("cross-fades a state with itself without the two clocks aliasing", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: { loop: { clip: rampClip("loop", "opacity", 0, 1), loop: 1 } },
      parameters: { triggers: ["restart"] },
      transitions: [
        {
          from: "loop",
          to: "loop",
          duration: 1,
          when: [{ parameter: "restart", is: "triggered" }],
        },
      ],
    }).play();

    controller.advance(1);
    expect(widget.opacity).toBe(1);

    controller.setTrigger("restart");
    controller.advance(0);
    expect(controller.previousState).toBe("loop");
    expect(widget.opacity).toBe(1);

    // Source held at its final pose (1), destination replaying from 0.5.
    controller.advance(0.5);
    expect(widget.opacity).toBeCloseTo(1 * 0.5 + 0.5 * 0.5, 12);
  });
});

describe("AnimationController — parameters and triggers (§18)", () => {
  it("evaluates every numeric comparison", () => {
    const comparisons: [TransitionCondition["is"], number, boolean][] = [
      ["greater", 3, false],
      ["greater", 1, true],
      ["greaterOrEqual", 2, true],
      ["greaterOrEqual", 3, false],
      ["less", 3, true],
      ["less", 1, false],
      ["lessOrEqual", 2, true],
      ["lessOrEqual", 1, false],
      ["equal", 2, true],
      ["equal", 3, false],
      ["notEqual", 3, true],
      ["notEqual", 2, false],
    ];

    for (const [is, value, expected] of comparisons) {
      const controller = new AnimationController({
        target: new Widget(),
        states: {
          idle: rampClip("idle", "opacity", 0, 0),
          walk: rampClip("walk", "opacity", 1, 1),
        },
        parameters: { numbers: { speed: 2 } },
        transitions: [
          {
            from: "idle",
            to: "walk",
            when: [{ parameter: "speed", is, value }],
          },
        ],
      }).play();
      controller.advance(0.1);
      expect([is, value, controller.currentState === "walk"]).toEqual([
        is,
        value,
        expected,
      ]);
    }
  });

  it("tests a Boolean parameter in both directions", () => {
    const build = (is: "true" | "false"): AnimationController =>
      new AnimationController({
        target: new Widget(),
        states: {
          idle: rampClip("idle", "opacity", 0, 0),
          walk: rampClip("walk", "opacity", 1, 1),
        },
        parameters: { booleans: { grounded: false } },
        transitions: [
          { from: "idle", to: "walk", when: [{ parameter: "grounded", is }] },
        ],
      }).play();

    const whenFalse = build("false");
    whenFalse.advance(0.1);
    expect(whenFalse.currentState).toBe("walk");

    const stillFalse = build("false");
    stillFalse.setBoolean("grounded", true);
    stillFalse.advance(0.1);
    expect(stillFalse.currentState).toBe("idle");

    const whenTrue = build("true");
    whenTrue.advance(0.1);
    expect(whenTrue.currentState).toBe("idle");
    expect(whenTrue.getBoolean("grounded")).toBe(false);
    whenTrue.setBoolean("grounded", true);
    whenTrue.advance(0.1);
    expect(whenTrue.currentState).toBe("walk");
  });

  it("latches a trigger until a transition consumes it", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        jump: rampClip("jump", "opacity", 1, 1),
        land: rampClip("land", "opacity", 2, 2),
      },
      parameters: { triggers: ["jump"] },
      transitions: [
        {
          from: "idle",
          to: "jump",
          exitTime: 1,
          when: [{ parameter: "jump", is: "triggered" }],
        },
        { from: "jump", to: "land" },
      ],
    }).play();

    expect(controller.isTriggerSet("jump")).toBe(false);
    controller.setTrigger("jump");
    // Raised well before the exit-time gate opens: the latch survives.
    controller.advance(0.5);
    expect(controller.currentState).toBe("idle");
    expect(controller.isTriggerSet("jump")).toBe(true);

    controller.advance(0.5);
    expect(controller.currentState).toBe("jump");
    expect(controller.isTriggerSet("jump")).toBe(false);
  });

  it("lowers a trigger on request without any transition firing", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        jump: rampClip("jump", "opacity", 1, 1),
      },
      parameters: { triggers: ["jump"] },
      transitions: [
        {
          from: "idle",
          to: "jump",
          when: [{ parameter: "jump", is: "triggered" }],
        },
      ],
    }).play();

    controller.setTrigger("jump");
    expect(controller.resetTrigger("jump")).toBe(controller);
    controller.advance(0.1);

    expect(controller.currentState).toBe("idle");
  });

  it("reads and writes declared parameters, and rejects everything else", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: { idle: rampClip("idle", "opacity", 0, 0) },
      parameters: {
        numbers: { speed: 1.5 },
        booleans: { grounded: true },
        triggers: ["jump"],
      },
    });

    expect(controller.getNumber("speed")).toBe(1.5);
    expect(controller.getBoolean("grounded")).toBe(true);
    expect(controller.isTriggerSet("jump")).toBe(false);
    expect(controller.setNumber("speed", 4)).toBe(controller);
    expect(controller.getNumber("speed")).toBe(4);

    expectInvalid(() => controller.setNumber("nope", 1));
    expectInvalid(() => controller.getNumber("nope"));
    expectInvalid(() => controller.setBoolean("nope", true));
    expectInvalid(() => controller.getBoolean("nope"));
    expectInvalid(() => controller.setTrigger("nope"));
    expectInvalid(() => controller.resetTrigger("nope"));
    expectInvalid(() => controller.isTriggerSet("nope"));
    expectInvalid(() => controller.setNumber("speed", Number.NaN));
  });
});

describe("AnimationController — interruption (§18)", () => {
  /** idle → walk (slow fade) → run, with `run` reachable from `walk`. */
  function buildChain(interruptible: boolean): {
    controller: AnimationController;
    widget: Widget;
  } {
    const widget = new Widget();
    const transitions: AnimationTransition[] = [
      {
        from: "idle",
        to: "walk",
        duration: 1,
        interruptible,
        when: [{ parameter: "speed", is: "greater", value: 0.1 }],
      },
      {
        from: "walk",
        to: "run",
        duration: 1,
        when: [{ parameter: "speed", is: "greater", value: 5 }],
      },
    ];
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
        run: rampClip("run", "opacity", 2, 2),
      },
      parameters: { numbers: { speed: 0 } },
      transitions,
    }).play();
    return { controller, widget };
  }

  it("freezes the blended pose when a cross-fade is interrupted", () => {
    const { controller, widget } = buildChain(true);

    controller.setNumber("speed", 1);
    controller.advance(0);
    controller.advance(0.5);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    controller.setNumber("speed", 9);
    controller.advance(0);
    expect(controller.currentState).toBe("run");
    // The source is a frozen pose, not a state.
    expect(controller.previousState).toBeUndefined();
    expect(controller.transitioning).toBe(true);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    controller.advance(0.5);
    expect(widget.opacity).toBeCloseTo(0.5 * 0.5 + 2 * 0.5, 12);

    controller.advance(0.5);
    expect(widget.opacity).toBe(2);
  });

  it("freezes again when a frozen cross-fade is itself interrupted", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        a: rampClip("a", "opacity", 0, 0),
        b: rampClip("b", "opacity", 1, 1),
        c: rampClip("c", "opacity", 2, 2),
        d: rampClip("d", "opacity", 4, 4),
      },
      parameters: { triggers: ["toB", "toC", "toD"] },
      transitions: [
        {
          from: "a",
          to: "b",
          duration: 1,
          when: [{ parameter: "toB", is: "triggered" }],
        },
        {
          from: "b",
          to: "c",
          duration: 1,
          when: [{ parameter: "toC", is: "triggered" }],
        },
        {
          from: "c",
          to: "d",
          duration: 1,
          when: [{ parameter: "toD", is: "triggered" }],
        },
      ],
    }).play();

    controller.setTrigger("toB");
    controller.advance(0);
    controller.advance(0.5);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    controller.setTrigger("toC");
    controller.advance(0);
    controller.advance(0.5);
    // frozen 0.5 → c (2) at weight 0.5.
    expect(widget.opacity).toBeCloseTo(1.25, 12);

    controller.setTrigger("toD");
    controller.advance(0);
    expect(widget.opacity).toBeCloseTo(1.25, 12);
    controller.advance(1);
    expect(widget.opacity).toBe(4);
  });

  it("suppresses every transition while an uninterruptible fade runs", () => {
    const { controller, widget } = buildChain(false);

    controller.setNumber("speed", 9);
    controller.advance(0);
    expect(controller.currentState).toBe("walk");

    controller.advance(0.5);
    expect(controller.currentState).toBe("walk");
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    controller.advance(0.4);
    expect(controller.currentState).toBe("walk");
    expect(widget.opacity).toBeCloseTo(0.9, 12);

    // The step that completes the fade also re-opens the scan: completion runs
    // before evaluation inside one `advance`.
    controller.advance(0.1);
    expect(controller.currentState).toBe("run");
    expect(controller.transitionWeight).toBe(0);
  });
});

describe("AnimationController — playback controls", () => {
  it("pauses, resumes, and stops", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: { idle: rampClip("idle", "opacity", 0, 1) },
    }).play();

    controller.advance(0.5);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    controller.pause();
    expect(controller.state).toBe("paused");
    controller.advance(0.5);
    expect(widget.opacity).toBeCloseTo(0.5, 12);
    // resume() is the only way back; pause() on a paused controller is a no-op.
    controller.pause();
    controller.resume();
    controller.resume();
    expect(controller.state).toBe("running");

    controller.advance(0.25);
    expect(widget.opacity).toBeCloseTo(0.75, 12);

    controller.stop();
    expect(controller.state).toBe("stopped");
    controller.advance(0.25);
    expect(widget.opacity).toBeCloseTo(0.75, 12);
  });

  it("scales both clocks with the machine speed", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        idle: rampClip("idle", "opacity", 0, 0),
        walk: rampClip("walk", "opacity", 1, 1),
      },
      speed: 2,
      parameters: { booleans: { moving: true } },
      transitions: [
        {
          from: "idle",
          to: "walk",
          duration: 1,
          when: [{ parameter: "moving", is: "true" }],
        },
      ],
    }).play();

    expect(controller.playbackSpeed).toBe(2);
    controller.advance(0);
    controller.advance(0.25);
    expect(controller.transitionWeight).toBeCloseTo(0.5, 12);
    expect(controller.speed(1)).toBe(controller);
    expect(controller.playbackSpeed).toBe(1);
  });

  it("is a no-op to play twice, and to stop before playing", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: { idle: rampClip("idle", "opacity", 0, 1) },
    });

    expect(controller.stop()).toBe(controller);
    expect(controller.state).toBe("idle");

    controller.play();
    controller.advance(0.5);
    controller.play();
    expect(controller.stateTime).toBeCloseTo(0.5, 12);
  });

  it("advances under AnimationSystem and is never auto-untracked", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: { idle: rampClip("idle", "opacity", 0, 1) },
    }).play();
    const system = new AnimationSystem();
    system.track(controller);

    const context = {
      time: { fixedDeltaTime: 0.5 },
    } as unknown as Parameters<AnimationSystem["fixedUpdate"]>[0];
    system.fixedUpdate(context);
    expect(widget.opacity).toBeCloseTo(0.5, 12);
    expect(system.has(controller)).toBe(true);

    controller.stop();
    system.fixedUpdate(context);
    expect(system.has(controller)).toBe(false);
  });

  it("rejects a negative or non-finite delta (§7a)", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: { idle: rampClip("idle", "opacity", 0, 1) },
    }).play();

    expectInvalid(() => controller.advance(-0.1));
    expectInvalid(() => controller.advance(Number.NaN));
  });
});

describe("AnimationController — value kinds and bindings (§16, §17)", () => {
  it("blends vector, colour, Boolean, and discrete channels", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        a: new AnimationClip({
          name: "a",
          tracks: [
            new AnimationTrack({
              path: "transform.position",
              adapter: vector3Adapter,
              times: [0],
              values: [new Vector3(0, 0, 0)],
            }),
            new AnimationTrack({
              path: "tint",
              adapter: colorAdapter,
              times: [0],
              values: [[0, 0, 0, 1] as ColorRGBA],
            }),
            new AnimationTrack({
              path: "visible",
              adapter: booleanAdapter,
              times: [0],
              values: [false],
            }),
            new AnimationTrack({
              path: "label",
              adapter: discreteAdapterFor<string>(),
              times: [0],
              values: ["idle"],
            }),
          ],
        }),
        b: new AnimationClip({
          name: "b",
          tracks: [
            new AnimationTrack({
              path: "transform.position",
              adapter: vector3Adapter,
              times: [0],
              values: [new Vector3(10, 0, 0)],
            }),
            new AnimationTrack({
              path: "tint",
              adapter: colorAdapter,
              times: [0],
              values: [[1, 1, 1, 1] as ColorRGBA],
            }),
            new AnimationTrack({
              path: "visible",
              adapter: booleanAdapter,
              times: [0],
              values: [true],
            }),
            new AnimationTrack({
              path: "label",
              adapter: discreteAdapterFor<string>(),
              times: [0],
              values: ["walk"],
            }),
          ],
        }),
      },
      parameters: { triggers: ["go"] },
      transitions: [
        {
          from: "a",
          to: "b",
          duration: 1,
          when: [{ parameter: "go", is: "triggered" }],
        },
      ],
    });
    widget.transformAuthority = "animation";
    controller.play();

    const position = widget.transform.position;
    expect(position.x).toBe(0);
    expect(widget.label).toBe("idle");

    controller.setTrigger("go");
    controller.advance(0);
    controller.advance(0.5);

    // The vector and colour mix; the step kinds hold the source until t = 1.
    expect(widget.transform.position).toBe(position);
    expect(position.x).toBeCloseTo(5, 12);
    expect(widget.tint).toEqual([0.5, 0.5, 0.5, 1]);
    expect(widget.visible).toBe(false);
    expect(widget.label).toBe("idle");

    controller.advance(0.5);
    expect(widget.visible).toBe(true);
    expect(widget.label).toBe("walk");
  });

  it("re-fires the owner's change hook for primitive writes (plan D3)", () => {
    const widget = new Widget();
    widget.transformAuthority = "animation";
    const controller = new AnimationController({
      target: widget,
      states: {
        slide: new AnimationClip({
          name: "slide",
          tracks: [
            new AnimationTrack({
              path: "transform.position.x",
              adapter: numberAdapter,
              times: [0, 1],
              values: [0, 10],
            }),
          ],
        }),
      },
    }).play();
    const version = widget.transform.version;

    controller.advance(0.5);

    expect(widget.transform.position.x).toBeCloseTo(5, 12);
    expect(widget.transform.version).toBe(version + 1);
  });

  it("rejects a channel whose property cannot hold its value kind", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        bad: new AnimationClip({
          name: "bad",
          tracks: [
            new AnimationTrack({
              path: "opacity",
              adapter: vector3Adapter,
              times: [0],
              values: [new Vector3(1, 2, 3)],
            }),
          ],
        }),
      },
    });

    const error = expectInvalid(() => controller.play());
    expect(error.message).toContain("vector3 channel");
  });

  it("reports a property of no known type", () => {
    const target = { slot: null as unknown };
    const controller = new AnimationController({
      target,
      states: {
        bad: new AnimationClip({
          name: "bad",
          tracks: [
            new AnimationTrack({
              path: "slot",
              adapter: numberAdapter,
              times: [0],
              values: [1],
            }),
          ],
        }),
      },
    });

    const error = expectInvalid(() => controller.play());
    expect(error.message).toContain("no known type");
  });
});

describe("AnimationController — authority (§42) and the §16 claim registry", () => {
  it("refuses every transform write when another system owns the node", () => {
    const warn = spyOnWarn();
    const node = new Group();
    node.transformAuthority = "physics";
    const controller = new AnimationController({
      target: node,
      states: {
        push: new AnimationClip({
          name: "push",
          tracks: [
            new AnimationTrack({
              path: "transform.position",
              adapter: vector3Adapter,
              times: [0, 1],
              values: [new Vector3(0, 0, 0), new Vector3(0, 10, 0)],
            }),
          ],
        }),
      },
    }).play();

    controller.advance(0.5);
    expect(node.transform.position.y).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);

    node.transformAuthority = "animation";
    controller.advance(0.25);
    expect(node.transform.position.y).toBeCloseTo(7.5, 12);
  });

  it("gates on a declared authority node when the target is not one", () => {
    const warn = spyOnWarn();
    const node = new Group();
    node.transformAuthority = "manual";
    const controller = new AnimationController({
      target: node.transform,
      authority: node,
      states: {
        push: new AnimationClip({
          name: "push",
          tracks: [
            new AnimationTrack({
              path: "position",
              adapter: vector3Adapter,
              times: [0, 1],
              values: [new Vector3(0, 0, 0), new Vector3(0, 10, 0)],
            }),
          ],
        }),
      },
    }).play();

    controller.advance(0.5);
    expect(node.transform.position.y).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it("loses a channel to a later writer and stops writing it (§16)", () => {
    const warn = spyOnWarn();
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: { idle: rampClip("idle", "opacity", 0, 1) },
    }).play();

    animate(widget).to({ opacity: 0.9 }, 1).play();
    expect(warn).toHaveBeenCalledTimes(1);

    controller.advance(0.5);
    expect(widget.opacity).toBe(0);
  });

  it("releases its claims on stop so a mixer takes them uncontested", () => {
    const warn = spyOnWarn();
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: { idle: rampClip("idle", "opacity", 0, 1) },
    }).play();

    controller.stop();
    new AnimationMixer(widget).play(rampClip("m", "opacity", 0.25, 0.25));

    expect(warn).not.toHaveBeenCalled();
    expect(widget.opacity).toBe(0.25);
  });
});

describe("AnimationController — validation (§18, §89)", () => {
  const clip = rampClip("idle", "opacity", 0, 1);

  it("rejects an empty state set", () => {
    expectInvalid(
      () => new AnimationController({ target: new Widget(), states: {} }),
    );
  });

  it("rejects an unknown initial state", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          initialState: "nope",
        }),
    );
  });

  it("rejects out-of-range state options", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: { clip, speed: 0 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: { clip, loop: 0 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: { clip, loop: 1.5 } },
        }),
    );
  });

  it("rejects an out-of-range machine speed", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          speed: Number.POSITIVE_INFINITY,
        }),
    );
  });

  it("rejects transitions naming undeclared states", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          transitions: [{ from: "nope", to: "idle" }],
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          transitions: [{ from: "idle", to: "nope" }],
        }),
    );
  });

  it("rejects out-of-range transition times (§7a)", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          transitions: [{ from: "idle", to: "idle", duration: -1 }],
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          transitions: [{ from: "idle", to: "idle", exitTime: Number.NaN }],
        }),
    );
  });

  it("rejects a condition on an undeclared or mis-kinded parameter", () => {
    const kinds: TransitionCondition[] = [
      { parameter: "speed", is: "greater", value: 1 },
      { parameter: "grounded", is: "true" },
      { parameter: "jump", is: "triggered" },
    ];
    for (const condition of kinds) {
      expectInvalid(
        () =>
          new AnimationController({
            target: new Widget(),
            states: { idle: clip },
            transitions: [{ from: "idle", to: "idle", when: [condition] }],
          }),
      );
    }

    // Declared, but as the wrong kind.
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          parameters: { numbers: { speed: 0 } },
          transitions: [
            {
              from: "idle",
              to: "idle",
              when: [{ parameter: "speed", is: "true" }],
            },
          ],
        }),
    );
  });

  it("rejects a parameter name declared in two kinds", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          parameters: { numbers: { x: 1 }, booleans: { x: true } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: clip },
          parameters: { booleans: { x: true }, triggers: ["x"] },
        }),
    );
  });

  it("rejects two states disagreeing on a channel's value kind", () => {
    const scalar = rampClip("scalar", "opacity", 0, 1);
    const vector = new AnimationClip({
      name: "vector",
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: vector3Adapter,
          times: [0],
          values: [new Vector3(1, 1, 1)],
        }),
      ],
    });

    const error = expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { a: scalar, b: vector },
        }),
    );
    expect(error.message).toContain("one value kind per property");
  });
});

describe("AnimationController — determinism (§33)", () => {
  it("reproduces the same pose sequence from the same inputs", () => {
    const run = (): number[] => {
      const widget = new Widget();
      const controller = new AnimationController({
        target: widget,
        states: {
          idle: rampClip("idle", "opacity", 0, 0.5),
          walk: rampClip("walk", "opacity", 1, 2),
          run: rampClip("run", "opacity", 3, 4),
        },
        parameters: { numbers: { speed: 0 }, triggers: ["boost"] },
        transitions: [
          {
            from: "idle",
            to: "walk",
            duration: 0.3,
            when: [{ parameter: "speed", is: "greater", value: 0.1 }],
          },
          {
            from: "walk",
            to: "run",
            duration: 0.25,
            when: [{ parameter: "boost", is: "triggered" }],
          },
          {
            from: "run",
            to: "idle",
            exitTime: 0.5,
            when: [{ parameter: "speed", is: "lessOrEqual", value: 0.1 }],
          },
        ],
      }).play();

      const samples: number[] = [];
      for (let step = 1; step <= 120; step += 1) {
        if (step === 10) {
          controller.setNumber("speed", 4);
        }
        if (step === 40) {
          controller.setTrigger("boost");
        }
        if (step === 90) {
          controller.setNumber("speed", 0);
        }
        controller.advance(1 / 60);
        samples.push(widget.opacity);
      }
      return samples;
    };

    const first = run();
    const second = run();

    expect(second).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(50);
  });
});
