import { isFourError } from "@four/core";
import { Node } from "@four/scene";
import { describe, expect, it } from "vitest";

import { AnimationClip } from "../src/clip.js";
import { ANY_STATE, AnimationController } from "../src/controller.js";
import { AnimationTrack } from "../src/track.js";
import { numberAdapter } from "../src/values.js";

class Widget extends Node {
  opacity = 1;
}

function expectInvalid(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(isFourError(thrown)).toBe(true);
  return thrown as Error;
}

function rampClip(
  name: string,
  path: string,
  start: number,
  end: number,
  events: { time: number; name: string }[] = [],
): AnimationClip {
  return new AnimationClip({
    name,
    tracks: [
      new AnimationTrack({
        path,
        adapter: numberAdapter,
        times: [0, 1],
        values: [start, end],
      }),
    ],
    events,
  });
}

function holdClip(name: string, value: number): AnimationClip {
  return new AnimationClip({
    name,
    tracks: [
      new AnimationTrack({
        path: "opacity",
        adapter: numberAdapter,
        times: [0],
        values: [value],
      }),
    ],
  });
}

describe("AnimationController — blend trees (PH-9)", () => {
  it("1D-lerps the two surrounding clips and clamps to the ends", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        loco: {
          kind: "blend1d",
          parameter: "speed",
          points: [
            { value: 0, clip: holdClip("idle", 0) },
            { value: 1, clip: holdClip("walk", 1) },
            { value: 5, clip: holdClip("run", 5) },
          ],
        },
      },
      parameters: { numbers: { speed: 0 } },
    }).play();

    expect(widget.opacity).toBe(0);

    controller.setNumber("speed", 0.5);
    controller.advance(0);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    controller.setNumber("speed", 3);
    controller.advance(0);
    expect(widget.opacity).toBeCloseTo(3, 12);

    controller.setNumber("speed", -2);
    controller.advance(0);
    expect(widget.opacity).toBe(0);

    controller.setNumber("speed", 9);
    controller.advance(0);
    expect(widget.opacity).toBe(5);
  });

  it("accepts a blend tree through AnimationStateOptions", () => {
    const widget = new Widget();
    new AnimationController({
      target: widget,
      states: {
        loco: {
          blendTree: {
            kind: "blend1d",
            parameter: "speed",
            points: [
              { value: 0, clip: holdClip("a", 2) },
              { value: 1, clip: holdClip("b", 4) },
            ],
          },
        },
      },
      parameters: { numbers: { speed: 0.25 } },
    }).play();

    expect(widget.opacity).toBeCloseTo(2.5, 12);
  });

  it("2D-blends the nearest three points by inverse distance", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: {
        aim: {
          kind: "blend2d",
          parameterX: "x",
          parameterY: "y",
          points: [
            { x: 0, y: 0, clip: holdClip("origin", 0) },
            { x: 1, y: 0, clip: holdClip("right", 10) },
            { x: 0, y: 1, clip: holdClip("up", 100) },
            { x: 8, y: 8, clip: holdClip("far", 1000) },
          ],
        },
      },
      parameters: { numbers: { x: 0.25, y: 0.25 } },
    }).play();

    // Nearest three: origin / right / up. Far point is excluded.
    expect(widget.opacity).toBeLessThan(200);
    expect(widget.opacity).toBeGreaterThan(0);

    controller.setNumber("x", 1);
    controller.setNumber("y", 0);
    controller.advance(0);
    expect(widget.opacity).toBe(10);
  });

  it("rejects an empty tree, a missing parameter, and clip+tree together", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: {
            bad: { kind: "blend1d", parameter: "speed", points: [] },
          },
          parameters: { numbers: { speed: 0 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: {
            bad: {
              kind: "blend1d",
              parameter: "speed",
              points: [{ value: 0, clip: holdClip("a", 1) }],
            },
          },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: {
            bad: {
              clip: holdClip("a", 1),
              blendTree: {
                kind: "blend1d",
                parameter: "speed",
                points: [{ value: 0, clip: holdClip("b", 2) }],
              },
            },
          },
          parameters: { numbers: { speed: 0 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { bad: { speed: 1 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: {
            bad: {
              kind: "blend1d",
              parameter: "speed",
              points: [{ value: Number.NaN, clip: holdClip("a", 1) }],
            },
          },
          parameters: { numbers: { speed: 0 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: {
            bad: {
              kind: "blend2d",
              parameterX: "x",
              parameterY: "y",
              points: [],
            },
          },
          parameters: { numbers: { x: 0, y: 0 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: {
            bad: {
              kind: "blend2d",
              parameterX: "x",
              parameterY: "missing",
              points: [{ x: 0, y: 0, clip: holdClip("a", 1) }],
            },
          },
          parameters: { numbers: { x: 0, y: 0 } },
        }),
    );
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: {
            bad: {
              kind: "blend2d",
              parameterX: "x",
              parameterY: "y",
              points: [
                { x: Number.POSITIVE_INFINITY, y: 0, clip: holdClip("a", 1) },
              ],
            },
          },
          parameters: { numbers: { x: 0, y: 0 } },
        }),
    );
  });

  it("exposes channel introspection for a layer stack", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      states: { idle: holdClip("idle", 0.3) },
    }).play();

    expect(controller.channelCount).toBe(1);
    expect(controller.channelPath(0)).toBe("opacity");
    expect(controller.channelAdapter(0)).toBe(numberAdapter);
    expect(controller.channelIndexOf("opacity")).toBe(0);
    expect(controller.channelIndexOf("nope")).toBe(-1);
    expect(controller.evaluatedChannel(0)).toBe(0.3);
    expectInvalid(() => controller.adoptByStack());
  });
});

describe("AnimationController — any-state transitions (PH-9)", () => {
  it("takes from: '*' from every state, in declaration order", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        idle: holdClip("idle", 0),
        walk: holdClip("walk", 1),
        fall: holdClip("fall", 2),
      },
      parameters: { triggers: ["trip"] },
      transitions: [
        {
          from: ANY_STATE,
          to: "fall",
          when: [{ parameter: "trip", is: "triggered" }],
        },
        { from: "idle", to: "walk" },
      ],
    }).play();

    controller.setTrigger("trip");
    controller.advance(0);
    expect(controller.currentState).toBe("fall");
  });

  it("does not self-transition on a wildcard unless allowSelf is set", () => {
    const blocked = new AnimationController({
      target: new Widget(),
      states: { idle: holdClip("idle", 0), walk: holdClip("walk", 1) },
      parameters: { booleans: { reset: true } },
      transitions: [
        { from: "*", to: "idle", when: [{ parameter: "reset", is: "true" }] },
      ],
      initialState: "idle",
    }).play();
    blocked.advance(0);
    expect(blocked.currentState).toBe("idle");

    const allowed = new AnimationController({
      target: new Widget(),
      states: { idle: holdClip("idle", 0) },
      parameters: { booleans: { reset: true } },
      transitions: [
        {
          from: "*",
          to: "idle",
          allowSelf: true,
          duration: 0.2,
          when: [{ parameter: "reset", is: "true" }],
        },
      ],
    }).play();
    allowed.advance(0);
    expect(allowed.currentState).toBe("idle");
    expect(allowed.transitioning).toBe(true);
  });

  it("rejects a state named '*'", () => {
    expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { "*": holdClip("star", 1) },
        }),
    );
  });
});

describe("AnimationController — clip events (PH-9)", () => {
  it("fires clip events on (from, to] crossings and unsubscribes", () => {
    const seen: string[] = [];
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        walk: rampClip("walk", "opacity", 0, 1, [
          { time: 0, name: "start" },
          { time: 0.5, name: "mid" },
        ]),
      },
    }).play();
    const off = controller.onClipEvent((event) => {
      seen.push(event.name);
    });

    controller.advance(0);
    expect(seen).toEqual(["start"]);
    controller.advance(0.5);
    expect(seen).toEqual(["start", "mid"]);
    off();
    controller.advance(0.5);
    expect(seen).toEqual(["start", "mid"]);
  });

  it("suppresses events when advance is called with seek: true", () => {
    const seen: string[] = [];
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        walk: rampClip("walk", "opacity", 0, 1, [{ time: 0.25, name: "tick" }]),
      },
    }).play();
    controller.onClipEvent((event) => {
      seen.push(event.name);
    });

    controller.advance(0.5, { seek: true });
    expect(seen).toEqual([]);
    controller.advance(0.5);
    expect(seen).toEqual([]);
  });

  it("fires events from a contributing blend-tree child", () => {
    const seen: string[] = [];
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        loco: {
          kind: "blend1d",
          parameter: "speed",
          points: [
            {
              value: 0,
              clip: rampClip("idle", "opacity", 0, 0, [
                { time: 0.2, name: "idle-tick" },
              ]),
            },
            {
              value: 1,
              clip: rampClip("walk", "opacity", 1, 1, [
                { time: 0.2, name: "walk-tick" },
              ]),
            },
          ],
        },
      },
      parameters: { numbers: { speed: 0 } },
    }).play();
    controller.onClipEvent((event) => {
      seen.push(event.name);
    });

    controller.advance(0.25);
    expect(seen).toEqual(["idle-tick"]);

    controller.setNumber("speed", 1);
    controller.advance(0.25);
    // Shared state clock is now 0.5; the walk clip's 0.2 marker is behind the
    // cursor, so only a later crossing would fire it. Re-enter via a new machine
    // at speed 1 to prove the child is eligible.
    expect(seen).toEqual(["idle-tick"]);

    const walking = new AnimationController({
      target: new Widget(),
      states: {
        loco: {
          kind: "blend1d",
          parameter: "speed",
          points: [
            {
              value: 0,
              clip: rampClip("idle", "opacity", 0, 0, [
                { time: 0.2, name: "idle-tick" },
              ]),
            },
            {
              value: 1,
              clip: rampClip("walk", "opacity", 1, 1, [
                { time: 0.2, name: "walk-tick" },
              ]),
            },
          ],
        },
      },
      parameters: { numbers: { speed: 1 } },
    }).play();
    const child: string[] = [];
    walking.onClipEvent((event) => {
      child.push(event.name);
    });
    walking.advance(0.25);
    expect(child).toEqual(["walk-tick"]);
  });

  it("re-arms events on a looping state and fires time-0 on a zero-length clip", () => {
    const looping: string[] = [];
    const loop = new AnimationController({
      target: new Widget(),
      states: {
        walk: rampClip("walk", "opacity", 0, 1, [{ time: 0.5, name: "step" }]),
      },
    }).play();
    loop.onClipEvent((event) => {
      looping.push(event.name);
    });
    loop.advance(1.6);
    expect(looping).toEqual(["step", "step"]);

    const held: string[] = [];
    const track = new AnimationTrack({
      path: "opacity",
      adapter: numberAdapter,
      times: [0],
      values: [1],
    });
    const zero = new AnimationController({
      target: new Widget(),
      states: {
        held: new AnimationClip({
          name: "held",
          tracks: [track],
          events: [{ time: 0, name: "now" }],
        }),
      },
    }).play();
    zero.onClipEvent((event) => {
      held.push(event.name);
    });
    zero.advance(0);
    expect(held).toEqual(["now"]);
  });
});

describe("AnimationController — when string sugar (PH-9)", () => {
  it("compiles restricted strings and keeps typed records working", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: {
        idle: holdClip("idle", 0),
        walk: holdClip("walk", 1),
        run: holdClip("run", 2),
      },
      parameters: { numbers: { speed: 0 }, booleans: { grounded: true } },
      transitions: [
        { from: "idle", to: "walk", when: "speed > 0.1" },
        {
          from: "walk",
          to: "run",
          when: ["speed >= 5", { parameter: "grounded", is: "true" }],
        },
      ],
    }).play();

    controller.setNumber("speed", 1);
    controller.advance(0);
    expect(controller.currentState).toBe("walk");

    controller.setNumber("speed", 6);
    controller.advance(0);
    expect(controller.currentState).toBe("run");
  });

  it("throws at construction on a parse failure", () => {
    const error = expectInvalid(
      () =>
        new AnimationController({
          target: new Widget(),
          states: { idle: holdClip("idle", 0) },
          parameters: { numbers: { speed: 0 } },
          transitions: [{ from: "idle", to: "idle", when: "speed && 1" }],
        }),
    );
    expect(error.message).toContain("restricted when-expression");
  });

  it("compiles a bare Boolean name", () => {
    const controller = new AnimationController({
      target: new Widget(),
      states: { idle: holdClip("idle", 0), walk: holdClip("walk", 1) },
      parameters: { booleans: { grounded: false } },
      transitions: [{ from: "idle", to: "walk", when: "grounded" }],
    }).play();

    controller.advance(0);
    expect(controller.currentState).toBe("idle");
    controller.setBoolean("grounded", true);
    controller.advance(0);
    expect(controller.currentState).toBe("walk");
  });
});

describe("AnimationController — liveInterrupt (PH-9)", () => {
  it("keeps sampling the previous source and dest instead of freezing", () => {
    const frozenWidget = new Widget();
    const frozen = new AnimationController({
      target: frozenWidget,
      states: {
        idle: holdClip("idle", 0),
        walk: new AnimationClip({
          name: "walk",
          tracks: [
            new AnimationTrack({
              path: "opacity",
              adapter: numberAdapter,
              times: [0, 2],
              values: [0, 2],
            }),
          ],
        }),
        run: holdClip("run", 10),
      },
      parameters: { numbers: { speed: 0 } },
      transitions: [
        {
          from: "idle",
          to: "walk",
          duration: 1,
          when: [{ parameter: "speed", is: "greater", value: 0.1 }],
        },
        {
          from: "walk",
          to: "run",
          duration: 1,
          when: [{ parameter: "speed", is: "greater", value: 5 }],
        },
      ],
    }).play();

    const liveWidget = new Widget();
    const live = new AnimationController({
      target: liveWidget,
      liveInterrupt: true,
      states: {
        idle: holdClip("idle", 0),
        walk: new AnimationClip({
          name: "walk",
          tracks: [
            new AnimationTrack({
              path: "opacity",
              adapter: numberAdapter,
              times: [0, 2],
              values: [0, 2],
            }),
          ],
        }),
        run: holdClip("run", 10),
      },
      parameters: { numbers: { speed: 0 } },
      transitions: [
        {
          from: "idle",
          to: "walk",
          duration: 1,
          when: [{ parameter: "speed", is: "greater", value: 0.1 }],
        },
        {
          from: "walk",
          to: "run",
          duration: 1,
          when: [{ parameter: "speed", is: "greater", value: 5 }],
        },
      ],
    }).play();

    for (const controller of [frozen, live]) {
      controller.setNumber("speed", 1);
      controller.advance(0);
      controller.advance(0.5);
    }
    expect(frozenWidget.opacity).toBeCloseTo(0.25, 12);
    expect(liveWidget.opacity).toBeCloseTo(0.25, 12);

    for (const controller of [frozen, live]) {
      controller.setNumber("speed", 9);
      controller.advance(0);
      controller.advance(0.5);
    }

    // Freeze captured 0.25; live keeps sampling walk (now at t=1 → 1) at the
    // interrupted weight 0.5: lerp(0, 1, 0.5) = 0.5, then lerp(0.5, 10, 0.5).
    expect(frozenWidget.opacity).toBeCloseTo(0.25 * 0.5 + 10 * 0.5, 12);
    expect(liveWidget.opacity).toBeCloseTo(0.5 * 0.5 + 10 * 0.5, 12);
    expect(live.previousState).toBe("walk");
    expect(frozen.previousState).toBeUndefined();
  });

  it("freezes a second interrupt so the mix stays one deep", () => {
    const widget = new Widget();
    const controller = new AnimationController({
      target: widget,
      liveInterrupt: true,
      states: {
        a: holdClip("a", 0),
        b: holdClip("b", 2),
        c: holdClip("c", 4),
        d: holdClip("d", 8),
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
    controller.setTrigger("toC");
    controller.advance(0);
    controller.advance(0.5);
    const mid = widget.opacity;
    controller.setTrigger("toD");
    controller.advance(0);
    expect(widget.opacity).toBeCloseTo(mid, 12);
    expect(controller.previousState).toBeUndefined();
  });
});
