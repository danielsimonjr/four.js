import { isFourError } from "@four/core";
import { Vector3 } from "@four/math";
import { Group, Node } from "@four/scene";
import { describe, expect, it, vi } from "vitest";

import { AnimationClip } from "../src/clip.js";
import { AnimationController } from "../src/controller.js";
import { AnimationLayerStack } from "../src/layer-stack.js";
import { AnimationMixer } from "../src/mixer.js";
import { AnimationTrack } from "../src/track.js";
import { animate } from "../src/tween.js";
import {
  discreteAdapterFor,
  numberAdapter,
  vector3Adapter,
} from "../src/values.js";

class Widget extends Node {
  opacity = 0;
  extra = 0;
}

function expectInvalid(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(isFourError(error)).toBe(true);
    return;
  }
  expect.fail("expected FourError");
}

function hold(path: string, value: number): AnimationClip {
  return new AnimationClip({
    name: path,
    tracks: [
      new AnimationTrack({
        path,
        adapter: numberAdapter,
        times: [0],
        values: [value],
      }),
    ],
  });
}

describe("AnimationLayerStack", () => {
  it("replaces with the first layer and adds subsequent additive layers", () => {
    const widget = new Widget();
    const base = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 2) },
    });
    const overlay = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 4) },
    });
    const stack = new AnimationLayerStack({
      target: widget,
      layers: [
        { controller: base },
        { controller: overlay, weight: 0.5, additive: true },
      ],
    }).play();

    expect(widget.opacity).toBeCloseTo(2 + 4 * 0.5, 12);
    expect(stack.state).toBe("running");
    expect(stack.finished).toBe(false);
    expect(stack.layerCount).toBe(2);
    expect(stack.layerWeight(1)).toBe(0.5);
  });

  it("lerps a subsequent non-additive layer over the pose so far", () => {
    const widget = new Widget();
    const base = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 0) },
    });
    const overlay = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 10) },
    });
    new AnimationLayerStack({
      target: widget,
      layers: [{ controller: base }, { controller: overlay, weight: 0.25 }],
    }).play();

    expect(widget.opacity).toBeCloseTo(2.5, 12);
  });

  it("unions channels so a later layer can introduce a new property", () => {
    const widget = new Widget();
    const base = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 3) },
    });
    const overlay = new AnimationController({
      target: widget,
      states: { pose: hold("extra", 7) },
    });
    new AnimationLayerStack({
      target: widget,
      layers: [{ controller: base }, { controller: overlay, additive: true }],
    }).play();

    expect(widget.opacity).toBe(3);
    expect(widget.extra).toBe(7);
  });

  it("holds one claim per channel so inner controllers do not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const widget = new Widget();
    const base = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 1) },
    });
    const overlay = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 2) },
    });
    const stack = new AnimationLayerStack({
      target: widget,
      layers: [
        { controller: base },
        { controller: overlay, weight: 1, additive: true },
      ],
    }).play();

    expect(warn).not.toHaveBeenCalled();

    const later = animate(widget).to({ opacity: 0.1 }, 1).play();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("animation layer stack");

    later.stop();
    stack.stop();
    warn.mockClear();
    new AnimationMixer(widget).play(hold("opacity", 0.4));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("advances children and applies a live weight change", () => {
    const widget = new Widget();
    const base = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 1) },
    });
    const overlay = new AnimationController({
      target: widget,
      states: {
        pose: new AnimationClip({
          name: "ramp",
          tracks: [
            new AnimationTrack({
              path: "opacity",
              adapter: numberAdapter,
              times: [0, 1],
              values: [0, 10],
            }),
          ],
        }),
      },
    });
    const stack = new AnimationLayerStack({
      target: widget,
      layers: [
        { controller: base },
        { controller: overlay, weight: 1, additive: true },
      ],
    }).play();

    stack.advance(0.5);
    expect(widget.opacity).toBeCloseTo(1 + 5, 12);

    stack.setLayerWeight(1, 0);
    stack.advance(0);
    expect(widget.opacity).toBeCloseTo(1, 12);
  });

  it("pauses, resumes, and rejects malformed construction", () => {
    const widget = new Widget();
    const base = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 1) },
    });
    const stack = new AnimationLayerStack({
      target: widget,
      layers: [{ controller: base }],
    }).play();

    stack.pause();
    expect(stack.state).toBe("paused");
    widget.opacity = 0;
    stack.advance(0.1);
    expect(widget.opacity).toBe(0);
    stack.resume();
    stack.advance(0);
    expect(widget.opacity).toBe(1);

    expectInvalid(
      () => new AnimationLayerStack({ target: widget, layers: [] }),
    );
    expectInvalid(
      () =>
        new AnimationLayerStack({
          target: widget,
          layers: [{ controller: base, weight: Number.NaN }],
        }),
    );
    const other = new Widget();
    const foreign = new AnimationController({
      target: other,
      states: { pose: hold("opacity", 1) },
    });
    expectInvalid(
      () =>
        new AnimationLayerStack({
          target: widget,
          layers: [{ controller: foreign }],
        }),
    );
    expectInvalid(() => stack.setLayerWeight(9, 1));
  });

  it("adds a vector overlay through ValueAdapter.add", () => {
    const node = new Group();
    node.transformAuthority = "animation";
    const base = new AnimationController({
      target: node,
      states: {
        pose: new AnimationClip({
          name: "base",
          tracks: [
            new AnimationTrack({
              path: "transform.position",
              adapter: vector3Adapter,
              times: [0],
              values: [new Vector3(1, 2, 3)],
            }),
          ],
        }),
      },
    });
    const overlay = new AnimationController({
      target: node,
      states: {
        pose: new AnimationClip({
          name: "add",
          tracks: [
            new AnimationTrack({
              path: "transform.position",
              adapter: vector3Adapter,
              times: [0],
              values: [new Vector3(10, 0, 0)],
            }),
          ],
        }),
      },
    });
    new AnimationLayerStack({
      target: node,
      layers: [
        { controller: base },
        { controller: overlay, weight: 0.5, additive: true },
      ],
    }).play();

    expect(node.transform.position.x).toBeCloseTo(6, 12);
    expect(node.transform.position.y).toBeCloseTo(2, 12);
  });

  it("ignores additive on the first layer and is a no-op to play twice", () => {
    const widget = new Widget();
    const base = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 4) },
    });
    const stack = new AnimationLayerStack({
      target: widget,
      layers: [{ controller: base, additive: true, weight: 0.1 }],
    }).play();
    expect(widget.opacity).toBe(4);
    expect(stack.play()).toBe(stack);
    expect(stack.target).toBe(widget);
    expect(stack.stop()).toBe(stack);
    expect(stack.state).toBe("stopped");
    const idleTarget = new Widget();
    expect(
      new AnimationLayerStack({
        target: idleTarget,
        layers: [
          {
            controller: new AnimationController({
              target: idleTarget,
              states: { pose: hold("opacity", 1) },
            }),
          },
        ],
      }).stop().state,
    ).toBe("idle");
  });

  it("rejects mixed kinds, a bind mismatch, and a non-finite live weight", () => {
    const widget = new Widget();
    const numbers = new AnimationController({
      target: widget,
      states: { pose: hold("opacity", 1) },
    });
    const discrete = new AnimationController({
      target: widget,
      states: {
        pose: new AnimationClip({
          name: "label",
          tracks: [
            new AnimationTrack({
              path: "opacity",
              adapter: discreteAdapterFor<string>(),
              times: [0],
              values: ["x"],
            }),
          ],
        }),
      },
    });
    expectInvalid(() =>
      new AnimationLayerStack({
        target: widget,
        layers: [{ controller: numbers }, { controller: discrete }],
      }).play(),
    );

    const mistyped = new Widget();
    const bad = new AnimationController({
      target: mistyped,
      states: {
        pose: new AnimationClip({
          name: "vec",
          tracks: [
            new AnimationTrack({
              path: "opacity",
              adapter: vector3Adapter,
              times: [0],
              values: [new Vector3(1, 0, 0)],
            }),
          ],
        }),
      },
    });
    expectInvalid(() =>
      new AnimationLayerStack({
        target: mistyped,
        layers: [{ controller: bad }],
      }).play(),
    );

    const live = new Widget();
    const stack = new AnimationLayerStack({
      target: live,
      layers: [
        {
          controller: new AnimationController({
            target: live,
            states: { pose: hold("opacity", 1) },
          }),
        },
      ],
    }).play();
    expectInvalid(() => stack.setLayerWeight(0, Number.NaN));
    expectInvalid(() => stack.advance(-1));
  });

  it("refuses transform writes when another system owns the node", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const node = new Group();
    node.transformAuthority = "physics";
    const base = new AnimationController({
      target: node,
      states: {
        pose: new AnimationClip({
          name: "base",
          tracks: [
            new AnimationTrack({
              path: "transform.position",
              adapter: vector3Adapter,
              times: [0],
              values: [new Vector3(0, 4, 0)],
            }),
          ],
        }),
      },
    });
    new AnimationLayerStack({
      target: node,
      layers: [{ controller: base }],
    }).play();
    expect(node.transform.position.y).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
