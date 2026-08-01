import { isFourError } from "@four/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { Group, Node } from "@four/scene";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { cubicOut } from "../src/easing.js";
import { Tween, animate, tween } from "../src/tween.js";
import type { ColorRGBA } from "../src/values.js";

/** A concrete node with a non-transform numeric property to animate. */
class Widget extends Node {
  opacity = 1;
}

/** Asserts that `run` throws a FourError carrying `code`, and returns it. */
function expectFourError(run: () => unknown, code: string): Error {
  let caught: unknown;
  try {
    run();
  } catch (error: unknown) {
    caught = error;
  }
  expect(isFourError(caught)).toBe(true);
  const error = caught as { code: string } & Error;
  expect(error.code).toBe(code);
  return error;
}

/** Silences and records `console.warn` for one test. */
function spyOnWarn(): MockInstance<typeof console.warn> {
  return vi.spyOn(console, "warn").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// §15 shape
// ---------------------------------------------------------------------------

describe("animate — §15 builder", () => {
  it("returns the same tween from every builder and playback method", () => {
    const node = new Group();
    const target = { x: 0, y: 0 };
    const subject = animate(target);

    expect(subject).toBeInstanceOf(Tween);
    expect(subject.target).toBe(target);
    expect(subject.state).toBe("idle");
    expect(subject.to({ x: 1 }, 1)).toBe(subject);
    expect(subject.from({ x: 0 })).toBe(subject);
    expect(subject.ease("cubic-out")).toBe(subject);
    expect(subject.delay(0)).toBe(subject);
    expect(subject.repeat(0)).toBe(subject);
    expect(subject.yoyo(false)).toBe(subject);
    expect(subject.speed(1)).toBe(subject);
    expect(subject.authority(node)).toBe(subject);
    expect(subject.onComplete(() => undefined)).toBe(subject);
    expect(subject.play()).toBe(subject);
    expect(subject.advance(0)).toBe(subject);
    expect(subject.pause()).toBe(subject);
    expect(subject.resume()).toBe(subject);
    expect(subject.seek(0)).toBe(subject);
    expect(subject.stop()).toBe(subject);
  });

  it('animates a real scene node\'s transform under "animation" authority', () => {
    const node = new Group();
    node.transformAuthority = "animation";

    const subject = animate(node.transform.position)
      .to({ x: 10, y: 5 }, 1.0)
      .ease("cubic-out")
      .authority(node)
      .play();

    expect(subject.state).toBe("running");
    expect(node.transform.position.x).toBe(0);

    subject.advance(0.5);
    const eased = cubicOut(0.5);
    expect(node.transform.position.x).toBeCloseTo(eased * 10, 12);
    expect(node.transform.position.y).toBeCloseTo(eased * 5, 12);
    expect(node.transform.position.z).toBe(0);
  });

  it("re-fires the transform change hook that a direct field write bypasses", () => {
    const node = new Group();
    node.transformAuthority = "animation";
    const before = node.transform.version;

    animate(node.transform.position)
      .to({ x: 10 }, 1)
      .authority(node)
      .play()
      .advance(0.5);

    expect(node.transform.version).toBeGreaterThan(before);
  });

  it("exposes duration, total duration, local time and progress", () => {
    const subject = animate({ x: 0 }).to({ x: 1 }, 2).delay(0.5).repeat(1);

    expect(subject.duration).toBe(2);
    expect(subject.totalDuration).toBe(4.5);

    subject.play().advance(1.5);
    expect(subject.localTime).toBe(1.5);
    expect(subject.progress).toBeCloseTo(0.5, 12);
  });

  it("reports the delay as the total duration of a zero-duration tween", () => {
    const target = { x: 0 };
    const subject = animate(target)
      .to({ x: 7 }, 0)
      .delay(0.25)
      .repeat(Infinity)
      .play();

    expect(subject.totalDuration).toBe(0.25);
    expect(target.x).toBe(0);

    subject.advance(0.3);
    expect(target.x).toBe(7);
    expect(subject.finished).toBe(true);
  });
});

describe("tween — §16 one-shot form", () => {
  it("builds an unplayed tween equivalent to animate().to()", () => {
    const target = { x: 0 };
    const subject = tween(target, { x: 5 }, 0.8);

    expect(subject).toBeInstanceOf(Tween);
    expect(subject.state).toBe("idle");
    expect(subject.duration).toBe(0.8);
    expect(target.x).toBe(0);

    subject.play().advance(0.4);
    expect(target.x).toBeCloseTo(2.5, 12);
  });
});

// ---------------------------------------------------------------------------
// Pure evaluation (§16)
// ---------------------------------------------------------------------------

describe("Tween — evaluation is a pure function of local time (§16)", () => {
  it("writes identical values for repeated seeks to the same time", () => {
    const target = { x: 0, y: 0 };
    const subject = animate(target).to({ x: 10, y: -4 }, 2).ease("cubic-out");
    subject.play();

    subject.seek(0.7);
    const first = { x: target.x, y: target.y };
    subject.seek(1.9);
    subject.seek(0.7);

    expect(target.x).toBe(first.x);
    expect(target.y).toBe(first.y);
  });

  it("scrubs backwards and forwards without accumulating error", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 100 }, 1).ease("sine-in-out");
    subject.play();

    subject.seek(0.5);
    const midpoint = target.x;
    for (const time of [0.9, 0.1, 0.75, 0.25, 0.5]) {
      subject.seek(time);
    }

    expect(target.x).toBe(midpoint);
  });

  it("lands exactly on the end value at t = duration", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).ease("cubic-out").play();

    subject.advance(0.6);
    expect(target.x).not.toBe(10);
    subject.advance(0.6);

    expect(subject.localTime).toBe(1);
    expect(target.x).toBe(10);
    expect(subject.finished).toBe(true);
    expect(subject.state).toBe("finished");
  });

  it("interpolates vector, quaternion and color properties through their adapters", () => {
    const target = {
      position: new Vector3(0, 0, 0),
      rotation: new Quaternion(0, 0, 0, 1),
      tint: [0, 0, 0, 1] as ColorRGBA,
    };
    const end = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    );
    const subject = animate(target)
      .to(
        {
          position: new Vector3(10, 20, 30),
          rotation: end,
          tint: [1, 0.5, 0.25, 0] as ColorRGBA,
        },
        1,
      )
      .play();

    subject.advance(0.5);
    expect(target.position.x).toBeCloseTo(5, 12);
    expect(target.position.z).toBeCloseTo(15, 12);
    expect(target.tint[0]).toBeCloseTo(0.5, 12);
    expect(target.tint[3]).toBeCloseTo(0.5, 12);
    expect(target.rotation.y).toBeGreaterThan(0);

    subject.advance(0.5);
    expect(target.position.x).toBe(10);
    expect(target.rotation.y).toBe(end.y);
  });

  it("keeps the caller's end objects out of its own state", () => {
    const target = { position: new Vector3(0, 0, 0) };
    const end = new Vector3(10, 0, 0);
    const subject = animate(target).to({ position: end }, 1).play();

    end.set(999, 999, 999);
    subject.advance(1);

    expect(target.position.x).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Timing model
// ---------------------------------------------------------------------------

describe("Tween — timing model", () => {
  it("holds the start pose through the delay", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).delay(0.5).play();

    expect(subject.totalDuration).toBe(1.5);
    subject.advance(0.25);
    expect(target.x).toBe(0);

    subject.advance(0.5);
    expect(subject.localTime).toBeCloseTo(0.75, 12);
    expect(target.x).toBeCloseTo(2.5, 12);
  });

  it("scales the advance delta by speed", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).speed(2).play();

    subject.advance(0.25);
    expect(subject.localTime).toBe(0.5);
    expect(target.x).toBeCloseTo(5, 12);
  });

  it("folds local time into cycles for repeat", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).repeat(1).play();

    expect(subject.totalDuration).toBe(2);
    subject.seek(1.5);
    expect(target.x).toBeCloseTo(5, 12);
    subject.seek(2);
    expect(target.x).toBe(10);
  });

  it("reflects odd cycles when yoyo is enabled", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).repeat(3).yoyo().play();

    subject.seek(0.5);
    expect(target.x).toBeCloseTo(5, 12);
    subject.seek(1.5);
    expect(target.x).toBeCloseTo(5, 12);
    subject.seek(1.75);
    expect(target.x).toBeCloseTo(2.5, 12);
    subject.seek(2.25);
    expect(target.x).toBeCloseTo(2.5, 12);
    subject.advance(1.75);
    expect(subject.localTime).toBe(4);
    expect(target.x).toBe(0);
    expect(subject.finished).toBe(true);
  });

  it("never finishes with an infinite repeat", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).repeat(Infinity).play();

    expect(subject.totalDuration).toBe(Infinity);
    for (let index = 0; index < 1000; index += 1) {
      subject.advance(0.1);
    }

    expect(subject.finished).toBe(false);
    expect(subject.state).toBe("running");
    expect(subject.localTime).toBeCloseTo(100, 6);
    subject.seek(1e6 + 0.5);
    expect(subject.finished).toBe(false);
    expect(target.x).toBeCloseTo(5, 6);
  });

  it("captures explicit start values from from() and applies them at play", () => {
    const target = { x: 0, y: 0 };
    const subject = animate(target)
      .from({ x: 5 })
      .to({ x: 10, y: 4 }, 1)
      .play();

    expect(target.x).toBe(5);
    expect(target.y).toBe(0);

    subject.advance(0.5);
    expect(target.x).toBeCloseTo(7.5, 12);
    expect(target.y).toBeCloseTo(2, 12);
  });

  it("accepts a bare easing function", () => {
    const target = { x: 0 };
    animate(target)
      .to({ x: 10 }, 1)
      .ease((t) => t * t)
      .play()
      .advance(0.5);

    expect(target.x).toBeCloseTo(2.5, 12);
  });
});

// ---------------------------------------------------------------------------
// Playback controls
// ---------------------------------------------------------------------------

describe("Tween — playback controls", () => {
  it("pauses, resumes, and ignores advances while paused", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).play();

    subject.advance(0.25).pause();
    expect(subject.state).toBe("paused");
    subject.advance(0.5);
    expect(subject.localTime).toBe(0.25);

    subject.resume().advance(0.25);
    expect(subject.state).toBe("running");
    expect(subject.localTime).toBe(0.5);
  });

  it("treats pause, resume, play and advance as no-ops in the wrong state", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1);

    expect(subject.pause().state).toBe("idle");
    expect(subject.resume().state).toBe("idle");
    expect(subject.advance(1).localTime).toBe(0);
    expect(subject.stop().state).toBe("idle");

    subject.play();
    expect(subject.play().localTime).toBe(0);
    subject.advance(1);
    expect(subject.state).toBe("finished");
    expect(subject.advance(1).localTime).toBe(1);
  });

  it("stops without rewinding the animated values", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).play();

    subject.advance(0.5).stop();
    expect(subject.state).toBe("stopped");
    expect(target.x).toBeCloseTo(5, 12);

    subject.advance(0.5).seek(1);
    expect(target.x).toBeCloseTo(5, 12);
  });

  it("fires onComplete exactly once, after the final write", () => {
    const target = { x: 0 };
    const seen: number[] = [];
    const subject = animate(target)
      .to({ x: 10 }, 1)
      .onComplete(() => {
        seen.push(target.x);
      })
      .play();

    subject.advance(0.5);
    expect(seen).toEqual([]);
    subject.advance(0.5);
    expect(seen).toEqual([10]);
    subject.advance(1);
    subject.seek(0.2);
    subject.advance(1);
    expect(seen).toEqual([10]);
  });

  it("suppresses onComplete on seek without consuming the crossing (§16)", () => {
    const target = { x: 0 };
    const complete = vi.fn();
    const subject = animate(target)
      .to({ x: 10 }, 1)
      .onComplete(complete)
      .play();

    subject.seek(2);
    expect(target.x).toBe(10);
    expect(subject.finished).toBe(false);
    expect(subject.state).toBe("running");
    expect(complete).not.toHaveBeenCalled();

    subject.advance(0);
    expect(subject.finished).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("still evaluates a finished tween when scrubbed, without resuming it", () => {
    const target = { x: 0 };
    const subject = animate(target).to({ x: 10 }, 1).play();

    subject.advance(2);
    expect(subject.finished).toBe(true);

    subject.seek(0.5);
    expect(target.x).toBeCloseTo(5, 12);
    expect(subject.finished).toBe(true);
    expect(subject.state).toBe("finished");
    expect(subject.advance(0.1).localTime).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// §16 conflicts
// ---------------------------------------------------------------------------

describe("Tween — last-started-wins on a shared property (§16)", () => {
  it("warns, revokes only the contested property, and leaves the rest running", () => {
    const target = { x: 0, y: 0 };
    const first = animate(target).to({ x: 10, y: 10 }, 1).play();
    const warn = spyOnWarn();

    const second = animate(target).to({ x: -10 }, 1).play();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("last-started tween wins");

    second.advance(0.5);
    expect(target.x).toBeCloseTo(-5, 12);

    first.advance(0.5);
    expect(target.x).toBeCloseTo(-5, 12);
    expect(target.y).toBeCloseTo(5, 12);
  });

  it("keys claims by the resolved property, not by the authored path", () => {
    const node = new Group();
    node.transformAuthority = "animation";
    animate(node).to({ "transform.position.x": 10 }, 1).play();
    const warn = spyOnWarn();

    animate(node.transform.position).to({ x: -10 }, 1).authority(node).play();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("releases claims on stop so a later tween takes over silently", () => {
    const target = { x: 0 };
    animate(target).to({ x: 10 }, 1).play().stop();
    const warn = spyOnWarn();

    const second = animate(target).to({ x: 5 }, 1).play();
    expect(warn).not.toHaveBeenCalled();

    second.advance(0.5);
    expect(target.x).toBeCloseTo(2.5, 12);
  });

  it("releases claims on completion so a later tween takes over silently", () => {
    const target = { x: 0 };
    animate(target).to({ x: 10 }, 1).play().advance(1);
    const warn = spyOnWarn();

    animate(target).to({ x: 20 }, 1).play();
    expect(warn).not.toHaveBeenCalled();
  });

  it("effectively stops a tween that loses every property", () => {
    const target = { x: 0 };
    const first = animate(target).to({ x: 10 }, 1).play();
    spyOnWarn();
    animate(target).to({ x: 100 }, 1).play();

    first.advance(1);
    expect(target.x).toBe(0);
    expect(first.finished).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §42 authority
// ---------------------------------------------------------------------------

describe("Tween — transform authority (§42)", () => {
  it("infers the node when the target is a Node and gates transform writes only", () => {
    const widget = new Widget();
    const warn = spyOnWarn();
    const subject = animate(widget)
      .to({ "transform.position.x": 10, opacity: 0 }, 1)
      .play();

    subject.advance(0.5);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('A "animation" system');
    expect(widget.transform.position.x).toBe(0);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    subject.advance(0.25);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(widget.transform.position.x).toBe(0);

    widget.transformAuthority = "animation";
    subject.advance(0.25);
    expect(widget.transform.position.x).toBe(10);
    expect(widget.opacity).toBe(0);
  });

  it("skips the whole transform write rather than a partial pose", () => {
    const widget = new Widget();
    spyOnWarn();
    animate(widget)
      .to({ "transform.position.x": 10, "transform.scale.y": 4 }, 1)
      .play()
      .advance(0.5);

    expect(widget.transform.position.x).toBe(0);
    expect(widget.transform.scale.y).toBe(1);
  });

  it("cannot infer a node from a bare math target and says so by animating", () => {
    const node = new Group();
    const warn = spyOnWarn();

    animate(node.transform.position).to({ x: 10 }, 1).play().advance(1);

    expect(node.transformAuthority).toBe("manual");
    expect(warn).not.toHaveBeenCalled();
    expect(node.transform.position.x).toBe(10);
  });

  it("is inert when the declared node owns none of the animated properties", () => {
    const node = new Group();
    const target = { x: 0 };
    const warn = spyOnWarn();

    animate(target).to({ x: 10 }, 1).authority(node).play().advance(1);

    expect(warn).not.toHaveBeenCalled();
    expect(target.x).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Allocation (§7b)
// ---------------------------------------------------------------------------

describe("Tween — allocation discipline (§7b)", () => {
  it("allocates no math objects on the advance path after play", () => {
    const target = { position: new Vector3(0, 0, 0), value: 0 };
    const subject = animate(target)
      .to({ position: new Vector3(10, 0, 0), value: 5 }, 10)
      .ease("cubic-out")
      .play();

    resetConstructionCount();
    for (let index = 0; index < 1000; index += 1) {
      subject.advance(0.001);
    }
    subject.seek(4);

    expect(constructionCount()).toBe(0);
    expect(target.position.x).toBeGreaterThan(0);
    expect(target.value).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Misconfiguration
// ---------------------------------------------------------------------------

describe("Tween — misconfiguration", () => {
  it("rejects configuration after play", () => {
    const subject = animate({ x: 0 }).to({ x: 1 }, 1).play();
    const error = expectFourError(
      () => subject.ease("linear"),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("cannot be called after play()");
  });

  it("rejects a second to()", () => {
    const subject = animate({ x: 0 }).to({ x: 1 }, 1);
    expectFourError(() => subject.to({ x: 2 }, 1), "INVALID_APPLICATION_STATE");
  });

  it("rejects non-second durations, delays, deltas and seek times", () => {
    expectFourError(
      () => animate({ x: 0 }).to({ x: 1 }, -1),
      "INVALID_APPLICATION_STATE",
    );
    expectFourError(
      () => animate({ x: 0 }).to({ x: 1 }, Number.NaN),
      "INVALID_APPLICATION_STATE",
    );
    expectFourError(
      () => animate({ x: 0 }).delay(-0.5),
      "INVALID_APPLICATION_STATE",
    );
    const played = animate({ x: 0 }).to({ x: 1 }, 1).play();
    expectFourError(() => played.advance(-1), "INVALID_APPLICATION_STATE");
    expectFourError(() => played.seek(-1), "INVALID_APPLICATION_STATE");
  });

  it("rejects repeat counts that are not non-negative integers or Infinity", () => {
    expectFourError(
      () => animate({ x: 0 }).repeat(1.5),
      "INVALID_APPLICATION_STATE",
    );
    expectFourError(
      () => animate({ x: 0 }).repeat(-1),
      "INVALID_APPLICATION_STATE",
    );
  });

  it("rejects non-positive and non-finite speeds", () => {
    const error = expectFourError(
      () => animate({ x: 0 }).speed(0),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("Timeline");
    expectFourError(
      () => animate({ x: 0 }).speed(Number.POSITIVE_INFINITY),
      "INVALID_APPLICATION_STATE",
    );
  });

  it("rejects play() without to()", () => {
    expectFourError(
      () => animate({ x: 0 }).play(),
      "INVALID_APPLICATION_STATE",
    );
  });

  it("rejects a from() path that to() does not animate", () => {
    const subject = animate({ x: 0, y: 0 }).to({ x: 1 }, 1).from({ y: 2 });
    const error = expectFourError(
      () => subject.play(),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain('"y"');
  });

  it("rejects end and start values whose type does not match the property", () => {
    const mismatched = animate({ x: 0 }).to({ x: new Vector3(1, 2, 3) }, 1);
    expectFourError(() => mismatched.play(), "INVALID_APPLICATION_STATE");

    const undetectable = animate({ x: 0 }).to(
      { x: "ten" as unknown as number },
      1,
    );
    const error = expectFourError(
      () => undetectable.play(),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("unrecognized type");

    const badStart = animate({ x: 0 })
      .to({ x: 1 }, 1)
      .from({ x: new Vector3(0, 0, 0) });
    expectFourError(() => badStart.play(), "INVALID_APPLICATION_STATE");
  });

  it("rejects seek() before play()", () => {
    const error = expectFourError(
      () => animate({ x: 0 }).to({ x: 1 }, 1).seek(0.5),
      "INVALID_APPLICATION_STATE",
    );
    expect(error.message).toContain("requires Tween.play()");
  });
});
