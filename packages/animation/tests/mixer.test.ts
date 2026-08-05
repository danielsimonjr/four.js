import { isFourError } from "@four/core";
import {
  Quaternion,
  Vector3,
  constructionCount,
  resetConstructionCount,
} from "@four/math";
import { Group, Node } from "@four/scene";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { AnimationClip, type AnimationEvent } from "../src/clip.js";
import { AnimationMixer } from "../src/mixer.js";
import { Timeline, type TimelineChild } from "../src/timeline.js";
import { AnimationTrack, type AnimationTrackLike } from "../src/track.js";
import { animate } from "../src/tween.js";
import {
  booleanAdapter,
  colorAdapter,
  discreteAdapterFor,
  numberAdapter,
  quaternionAdapter,
  vector3Adapter,
  type ColorRGBA,
} from "../src/values.js";

/** A node carrying one property of every §17 track type outside its transform. */
class Widget extends Node {
  opacity = 1;
  visible = true;
  tint: ColorRGBA = [0, 0, 0, 1];
  label = "idle";
  inner = { value: 0 };
}

/** Asserts that `run` throws the §89 error every malformed mixer reports. */
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

/** A quaternion of `angle` radians about +Y (§7a: radians, Y-up). */
function yaw(angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle);
}

/** Component-wise quaternion comparison (`Quaternion` has no `equalsApprox`). */
function expectQuaternion(actual: Quaternion, expected: Quaternion): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
  expect(actual.z).toBeCloseTo(expected.z, 12);
  expect(actual.w).toBeCloseTo(expected.w, 12);
}

/**
 * §17's track set on one clip: scalar, vector, quaternion, color, and Boolean,
 * every one of them a one-second ramp so a sample at `t` is hand-computable.
 */
function trackSetClip(events?: readonly AnimationEvent[]): AnimationClip {
  const tracks: AnimationTrackLike[] = [
    new AnimationTrack({
      path: "opacity",
      adapter: numberAdapter,
      times: [0, 1],
      values: [1, 0],
    }),
    new AnimationTrack({
      path: "transform.position",
      adapter: vector3Adapter,
      times: [0, 1],
      values: [new Vector3(0, 0, 0), new Vector3(10, 20, 30)],
    }),
    new AnimationTrack({
      path: "transform.rotation",
      adapter: quaternionAdapter,
      times: [0, 1],
      values: [new Quaternion(), yaw(Math.PI / 2)],
    }),
    new AnimationTrack({
      path: "tint",
      adapter: colorAdapter,
      times: [0, 1],
      values: [[0, 0, 0, 1] as ColorRGBA, [1, 0.5, 0.25, 0] as ColorRGBA],
    }),
    new AnimationTrack({
      path: "visible",
      adapter: booleanAdapter,
      times: [0, 1],
      values: [true, false],
    }),
  ];
  return new AnimationClip({ name: "ramp", tracks, events, duration: 1 });
}

/** A widget that owns its transform under the §42 `"animation"` authority. */
function animatedWidget(): Widget {
  const widget = new Widget();
  widget.transformAuthority = "animation";
  return widget;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// §17 playback
// ---------------------------------------------------------------------------

describe("AnimationMixer — clip playback (§17)", () => {
  it("writes every §17 track type at a hand-computed mid-clip sample", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());

    mixer.advance(0.4);

    // scalar: 1 + (0 - 1) * 0.4
    expect(widget.opacity).toBeCloseTo(0.6, 12);
    // vector: componentwise lerp
    expect(
      widget.transform.position.equalsApprox(new Vector3(4, 8, 12), 1e-12),
    ).toBe(true);
    // quaternion: slerp along one axis is angle interpolation
    expectQuaternion(widget.transform.rotation, yaw(0.4 * (Math.PI / 2)));
    // color: componentwise, alpha like any other component (P4-2)
    expect(widget.tint[0]).toBeCloseTo(0.4, 12);
    expect(widget.tint[1]).toBeCloseTo(0.2, 12);
    expect(widget.tint[2]).toBeCloseTo(0.1, 12);
    expect(widget.tint[3]).toBeCloseTo(0.6, 12);
    // boolean: step semantics hold the left key until the right one is reached
    expect(widget.visible).toBe(true);
  });

  it("writes the clip's time-0 pose at play, before any advance", () => {
    const widget = animatedWidget();
    widget.opacity = 0.123;

    const mixer = new AnimationMixer(widget).play(trackSetClip());

    expect(mixer.state).toBe("running");
    expect(mixer.localTime).toBe(0);
    expect(widget.opacity).toBe(1);
    expect(widget.transform.position.equalsApprox(new Vector3())).toBe(true);
  });

  it("lands on the last keyframe and finishes exactly at the duration", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());

    mixer.advance(0.75);
    expect(mixer.finished).toBe(false);
    mixer.advance(0.75);

    expect(mixer.state).toBe("finished");
    expect(mixer.finished).toBe(true);
    expect(mixer.elapsedTime).toBe(1);
    expect(widget.opacity).toBe(0);
    expect(widget.visible).toBe(false);
    expect(
      widget.transform.position.equalsApprox(new Vector3(10, 20, 30), 1e-12),
    ).toBe(true);
  });

  it("evaluates purely: seeking twice to one time writes identical values", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());

    mixer.seek(0.7);
    const first = widget.opacity;
    mixer.advance(0.2);
    mixer.seek(0.7);

    expect(widget.opacity).toBe(first);
    expect(mixer.localTime).toBe(0.7);
  });

  it("samples discrete tracks by step and binds them to any property", () => {
    const widget = new Widget();
    const clip = new AnimationClip({
      name: "states",
      tracks: [
        new AnimationTrack({
          path: "label",
          adapter: discreteAdapterFor<string>(),
          times: [0, 0.5, 1],
          values: ["idle", "walk", "run"],
          interpolation: "step",
        }),
      ],
    });
    const mixer = new AnimationMixer(widget).play(clip);

    expect(widget.label).toBe("idle");
    mixer.advance(0.5);
    expect(widget.label).toBe("walk");
    mixer.advance(0.5);
    expect(widget.label).toBe("run");
  });

  it("applies two tracks on one property in clip order, with a §16 warning", () => {
    const widget = new Widget();
    const clip = new AnimationClip({
      name: "contested",
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 1],
        }),
        new AnimationTrack({
          path: "opacity",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, -1],
        }),
      ],
    });
    const warn = spyOnWarn();

    new AnimationMixer(widget).play(clip).advance(0.5);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(widget.opacity).toBeCloseTo(-0.5, 12);
  });
});

// ---------------------------------------------------------------------------
// §16 bindings
// ---------------------------------------------------------------------------

describe("AnimationMixer — bindings resolved once (§16)", () => {
  it("keeps writing the object the path resolved to at play", () => {
    const widget = new Widget();
    const original = widget.inner;
    const clip = new AnimationClip({
      name: "inner",
      tracks: [
        new AnimationTrack({
          path: "inner.value",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 10],
        }),
      ],
    });
    const mixer = new AnimationMixer(widget).play(clip);

    widget.inner = { value: -1 };
    mixer.advance(0.5);

    expect(original.value).toBeCloseTo(5, 12);
    expect(widget.inner.value).toBe(-1);
  });

  it("rejects a track whose value kind the bound property cannot hold", () => {
    const widget = new Widget();
    const clip = new AnimationClip({
      name: "mismatch",
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: vector3Adapter,
          times: [0, 1],
          values: [new Vector3(), new Vector3(1, 0, 0)],
        }),
      ],
    });

    const error = expectInvalid(() => new AnimationMixer(widget).play(clip));
    expect(error.message).toContain("vector3 track");
    expect(error.message).toContain("a number");
  });

  it("rejects a track bound to a property of no detectable type", () => {
    const target = { handle: null };
    const clip = new AnimationClip({
      name: "untyped",
      tracks: [
        new AnimationTrack({
          path: "handle",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 1],
        }),
      ],
    });

    const error = expectInvalid(() => new AnimationMixer(target).play(clip));
    expect(error.message).toContain("no known type");
  });

  it("propagates the binding error for a path that does not resolve", () => {
    const widget = new Widget();
    const clip = new AnimationClip({
      name: "missing",
      tracks: [
        new AnimationTrack({
          path: "nope",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 1],
        }),
      ],
    });

    expectInvalid(() => new AnimationMixer(widget).play(clip));
  });

  it("re-fires the owner's change hook for primitive writes (plan D3)", () => {
    const widget = animatedWidget();
    const clip = new AnimationClip({
      name: "x",
      tracks: [
        new AnimationTrack({
          path: "transform.position.x",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 10],
        }),
      ],
    });
    const mixer = new AnimationMixer(widget).play(clip);
    const version = widget.transform.version;

    mixer.advance(0.5);

    expect(widget.transform.position.x).toBeCloseTo(5, 12);
    expect(widget.transform.version).toBe(version + 1);
  });
});

// ---------------------------------------------------------------------------
// §16 events
// ---------------------------------------------------------------------------

describe("AnimationMixer — clip events (§16 crossing semantics)", () => {
  const events: readonly AnimationEvent[] = [
    { time: 0, name: "start" },
    { time: 0.5, name: "middle", payload: 7 },
    { time: 1, name: "end" },
  ];

  /** Plays the track-set clip with its three events, recording each firing. */
  function scenario(replayOnSeek = false): {
    mixer: AnimationMixer;
    fired: string[];
    indices: number[];
  } {
    const widget = animatedWidget();
    const fired: string[] = [];
    const indices: number[] = [];
    const mixer = new AnimationMixer(widget).play(trackSetClip(events), {
      replayOnSeek,
      onEvent: (event, index) => {
        fired.push(event.name);
        indices.push(index);
      },
    });
    return { mixer, fired, indices };
  }

  it("fires nothing at play and fires the time-0 event on the first advance", () => {
    const { mixer, fired, indices } = scenario();
    expect(fired).toEqual([]);

    mixer.advance(0);
    expect(fired).toEqual(["start"]);
    expect(indices).toEqual([0]);
  });

  it("does not re-fire the time-0 event after a zero-delta advance (2026-08-05)", () => {
    // Same defect class as Timeline's: the no-move branch re-armed the
    // crossing cursor on a zero-delta advance at position 0, so the next
    // forward step fired the time-0 event a second time.
    const { mixer, fired } = scenario();
    mixer.advance(0);
    expect(fired).toEqual(["start"]);
    mixer.advance(0);
    mixer.advance(0.05);
    expect(fired).toEqual(["start"]);
  });

  it("fires each event exactly once per forward crossing", () => {
    const { mixer, fired } = scenario();

    for (let step = 0; step < 10; step += 1) {
      mixer.advance(0.125);
    }

    expect(fired).toEqual(["start", "middle", "end"]);
    expect(mixer.finished).toBe(true);
  });

  it("delivers the authored payload and index", () => {
    const widget = animatedWidget();
    const seen: AnimationEvent[] = [];
    new AnimationMixer(widget)
      .play(trackSetClip(events), {
        onEvent: (event) => {
          seen.push(event);
        },
      })
      .advance(0.6);

    expect(seen.map((event) => event.name)).toEqual(["start", "middle"]);
    expect(seen[1].payload).toBe(7);
  });

  it("re-arms events on every loop iteration", () => {
    const widget = animatedWidget();
    const fired: string[] = [];
    const mixer = new AnimationMixer(widget).play(trackSetClip(events), {
      loop: 3,
      onEvent: (event) => {
        fired.push(event.name);
      },
    });

    // One delta spanning all three iterations: each fires its own markers.
    mixer.advance(3);

    expect(fired).toEqual([
      "start",
      "middle",
      "end",
      "start",
      "middle",
      "end",
      "start",
      "middle",
      "end",
    ]);
    expect(mixer.finished).toBe(true);
    expect(mixer.iteration).toBe(2);
    expect(mixer.localTime).toBe(1);
  });

  it("suppresses events on seek by default and re-arms on a backward seek", () => {
    const { mixer, fired } = scenario();

    mixer.seek(0.75);
    expect(fired).toEqual([]);

    mixer.seek(0);
    mixer.advance(0.75);
    expect(fired).toEqual(["start", "middle"]);
  });

  it("fires forward-crossed events on seek under replayOnSeek (§16 opt-in)", () => {
    const { mixer, fired } = scenario(true);

    mixer.seek(0.75);
    expect(fired).toEqual(["start", "middle"]);

    // Backward is never a crossing (§16); it re-arms only what it rewound past,
    // so seeking forward again re-fires "middle" (0.5) but not "start" (0).
    mixer.seek(0.25);
    expect(fired).toEqual(["start", "middle"]);
    mixer.seek(0.75);
    expect(fired).toEqual(["start", "middle", "middle"]);

    // Rewinding all the way re-arms the time-0 event too.
    mixer.seek(0);
    mixer.seek(0.75);
    expect(fired).toEqual(["start", "middle", "middle", "start", "middle"]);
  });

  it("fires nothing from a seek on a stopped mixer", () => {
    const { mixer, fired } = scenario(true);
    mixer.stop();

    mixer.seek(1);

    expect(fired).toEqual([]);
  });

  it("needs no listener to cross events", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip(events));

    expect(() => mixer.advance(1)).not.toThrow();
    expect(mixer.finished).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §107 playback controls
// ---------------------------------------------------------------------------

describe("AnimationMixer — playback controls (§107)", () => {
  it("pauses, resumes, and ignores both in every other state", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());

    expect(mixer.pause().state).toBe("paused");
    mixer.advance(0.5);
    expect(widget.opacity).toBe(1);
    expect(mixer.localTime).toBe(0);

    expect(mixer.resume().state).toBe("running");
    mixer.advance(0.5);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    // Idempotent in the states they do not apply to.
    expect(mixer.resume().state).toBe("running");
    expect(mixer.pause().pause().state).toBe("paused");
  });

  it("scales the advance delta by speed", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip(), {
      speed: 2,
    });

    expect(mixer.playbackSpeed).toBe(2);
    mixer.advance(0.25);

    expect(mixer.elapsedTime).toBeCloseTo(0.5, 12);
    expect(widget.opacity).toBeCloseTo(0.5, 12);
    expect(mixer.speed(0.5)).toBe(mixer);
    expect(mixer.playbackSpeed).toBe(0.5);
  });

  it("loops a clip a total number of times", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip(), { loop: 2 });

    expect(mixer.loopCount).toBe(2);
    expect(mixer.duration).toBe(1);
    expect(mixer.totalDuration).toBe(2);

    mixer.advance(1.25);
    expect(mixer.iteration).toBe(1);
    expect(mixer.localTime).toBeCloseTo(0.25, 12);
    expect(widget.opacity).toBeCloseTo(0.75, 12);
    expect(mixer.finished).toBe(false);

    mixer.advance(1);
    expect(mixer.finished).toBe(true);
    expect(mixer.elapsedTime).toBe(2);
  });

  it("never finishes under loop(Infinity)", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip(), {
      loop: Infinity,
    });

    expect(mixer.totalDuration).toBe(Infinity);
    mixer.advance(100.5);

    expect(mixer.finished).toBe(false);
    expect(mixer.iteration).toBe(100);
    expect(mixer.localTime).toBeCloseTo(0.5, 12);
  });

  it("stops, freezing values and releasing the §16 claims", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());
    mixer.advance(0.5);
    const frozen = widget.opacity;

    mixer.stop();
    mixer.advance(0.5);
    mixer.seek(1);
    expect(widget.opacity).toBe(frozen);
    expect(mixer.state).toBe("stopped");

    // The properties are free again: a later writer claims them silently.
    const warn = spyOnWarn();
    animate(widget).to({ opacity: 0.25 }, 1).play().advance(1);
    expect(warn).not.toHaveBeenCalled();
    expect(widget.opacity).toBe(0.25);
  });

  it("releases its claims when it finishes but can still be scrubbed", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());
    mixer.advance(1);

    const warn = spyOnWarn();
    animate(widget).to({ opacity: 1 }, 1).play();
    expect(warn).not.toHaveBeenCalled();

    mixer.seek(0.5);
    expect(widget.opacity).toBeCloseTo(0.5, 12);
    expect(mixer.state).toBe("finished");
  });

  it("clamps a seek to the total duration and keeps playback state", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip(), { loop: 2 });
    mixer.pause();

    mixer.seek(99);

    expect(mixer.elapsedTime).toBe(2);
    expect(mixer.state).toBe("paused");
    expect(mixer.finished).toBe(false);
    expect(widget.opacity).toBe(0);
  });

  it("reports its introspection surface before it is played", () => {
    const widget = new Widget();
    const mixer = new AnimationMixer(widget);

    expect(mixer.target).toBe(widget);
    expect(mixer.clip).toBeUndefined();
    expect(mixer.state).toBe("idle");
    expect(mixer.duration).toBe(0);
    expect(mixer.totalDuration).toBe(0);
    expect(mixer.localTime).toBe(0);
    expect(mixer.elapsedTime).toBe(0);
    expect(mixer.iteration).toBe(0);
    expect(mixer.finished).toBe(false);
    expect(mixer.loopCount).toBe(1);
    expect(mixer.playbackSpeed).toBe(1);

    // Stopping an idle mixer is a no-op: it holds no claims to release.
    expect(mixer.stop()).toBe(mixer);
    expect(mixer.state).toBe("idle");
  });

  it("finishes a zero-length clip on its first advance", () => {
    const widget = new Widget();
    const clip = new AnimationClip({
      name: "instant",
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: numberAdapter,
          times: [0],
          values: [0.5],
        }),
      ],
    });
    const mixer = new AnimationMixer(widget).play(clip, { loop: Infinity });

    expect(mixer.totalDuration).toBe(0);
    mixer.advance(1 / 60);

    expect(mixer.finished).toBe(true);
    expect(mixer.iteration).toBe(0);
    expect(widget.opacity).toBe(0.5);
  });

  it("is a no-op to advance when it is not running", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());
    mixer.advance(1);

    expect(mixer.advance(1)).toBe(mixer);
    expect(mixer.elapsedTime).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// prepare / TimelineChild
// ---------------------------------------------------------------------------

describe("AnimationMixer — prepare and Timeline (§16)", () => {
  it("satisfies TimelineChild once armed", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).prepare(trackSetClip());
    const child: TimelineChild = mixer;

    expect(child.state).toBe("idle");
    expect(child.totalDuration).toBe(1);
    expect(mixer.clip?.name).toBe("ramp");
  });

  it("is driven by a timeline that owns its playback", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).prepare(trackSetClip());
    const timeline = new Timeline().at(0.5, mixer);

    timeline.play();
    expect(mixer.state).toBe("running");
    expect(widget.opacity).toBe(1);

    timeline.advance(1);
    expect(widget.opacity).toBeCloseTo(0.5, 12);

    timeline.advance(0.5);
    expect(widget.opacity).toBe(0);
    expect(timeline.finished).toBe(true);
  });

  it("carries its loop count into the window a timeline gives it", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).prepare(trackSetClip(), {
      loop: 2,
    });
    const timeline = new Timeline().at(0, mixer);

    expect(timeline.duration).toBe(2);
    timeline.play();
    timeline.advance(1.5);

    // Elapsed 1.5 of 2 → second iteration, half way through the clip.
    expect(mixer.iteration).toBe(1);
    expect(widget.opacity).toBeCloseTo(0.5, 12);
  });

  it("rejects preparing after play and playing without a clip", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget);

    expectInvalid(() => mixer.play());
    expectInvalid(() => mixer.play(undefined, { loop: 2 }));

    mixer.play(trackSetClip());
    expectInvalid(() => mixer.prepare(trackSetClip()));
  });

  it("is a no-op to replay a mixer that is already playing", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget).play(trackSetClip());
    mixer.advance(0.5);

    mixer.play(trackSetClip());

    expect(mixer.elapsedTime).toBeCloseTo(0.5, 12);
  });
});

// ---------------------------------------------------------------------------
// §42 authority
// ---------------------------------------------------------------------------

describe("AnimationMixer — transform authority (§42)", () => {
  it("skips every transform write while the node is owned by another authority", () => {
    const widget = new Widget(); // defaults to "manual"
    const warn = spyOnWarn();
    const mixer = new AnimationMixer(widget).play(trackSetClip());

    mixer.advance(0.5);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('A "animation" system');
    expect(widget.transform.position.equalsApprox(new Vector3())).toBe(true);
    expectQuaternion(widget.transform.rotation, new Quaternion());
    // Non-transform tracks are unaffected.
    expect(widget.opacity).toBeCloseTo(0.5, 12);
    expect(widget.tint[0]).toBeCloseTo(0.5, 12);

    // Deduplicated per node per writer, then honoured the moment it is granted.
    mixer.advance(0.25);
    expect(warn).toHaveBeenCalledTimes(1);

    widget.transformAuthority = "animation";
    mixer.advance(0.25);
    expect(
      widget.transform.position.equalsApprox(new Vector3(10, 20, 30), 1e-12),
    ).toBe(true);
  });

  it("takes the authority node from the option when the target is not a node", () => {
    const node = new Group();
    const clip = new AnimationClip({
      name: "position",
      tracks: [
        new AnimationTrack({
          path: "x",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 10],
        }),
      ],
    });
    const warn = spyOnWarn();
    const mixer = new AnimationMixer(node.transform.position).play(clip, {
      authority: node,
    });

    mixer.advance(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(node.transform.position.x).toBe(0);

    node.transformAuthority = "animation";
    mixer.seek(1);
    expect(node.transform.position.x).toBe(10);
  });

  it("cannot infer a node from a bare math target and says so by animating", () => {
    const node = new Group();
    const clip = new AnimationClip({
      name: "position",
      tracks: [
        new AnimationTrack({
          path: "x",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 10],
        }),
      ],
    });
    const warn = spyOnWarn();

    new AnimationMixer(node.transform.position).play(clip).advance(1);

    expect(warn).not.toHaveBeenCalled();
    expect(node.transform.position.x).toBe(10);
  });

  it("is inert when the declared node owns none of the animated properties", () => {
    const node = new Group();
    const target = { opacity: 1 };
    const clip = new AnimationClip({
      name: "opacity",
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: numberAdapter,
          times: [0, 1],
          values: [1, 0],
        }),
      ],
    });
    const warn = spyOnWarn();

    new AnimationMixer(target).play(clip, { authority: node }).advance(1);

    expect(warn).not.toHaveBeenCalled();
    expect(target.opacity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §16 conflicts with tweens
// ---------------------------------------------------------------------------

describe("AnimationMixer — shares the §16 conflict registry with tweens", () => {
  /** A one-property clip on `opacity`, for two-writer conflicts. */
  function opacityClip(to: number): AnimationClip {
    return new AnimationClip({
      name: "opacity",
      tracks: [
        new AnimationTrack({
          path: "opacity",
          adapter: numberAdapter,
          times: [0, 1],
          values: [1, to],
        }),
      ],
    });
  }

  it("takes a property from an earlier tween, last-started wins", () => {
    const widget = new Widget();
    const tween = animate(widget).to({ opacity: 0 }, 1).play();
    const warn = spyOnWarn();

    const mixer = new AnimationMixer(widget).play(opacityClip(0.5));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("last-started tween wins");
    expect(String(warn.mock.calls[0][0])).toContain("clip mixer");

    mixer.advance(1);
    expect(widget.opacity).toBe(0.5);
    tween.advance(1);
    expect(widget.opacity).toBe(0.5);
  });

  it("loses a property to a tween started after it", () => {
    const widget = new Widget();
    const mixer = new AnimationMixer(widget).play(opacityClip(0));
    const warn = spyOnWarn();

    const tween = animate(widget).to({ opacity: 0.25 }, 1).play();

    expect(warn).toHaveBeenCalledTimes(1);
    mixer.advance(1);
    expect(widget.opacity).toBe(1);
    tween.advance(1);
    expect(widget.opacity).toBe(0.25);
  });

  it("does not warn when two mixers animate different properties", () => {
    const widget = new Widget();
    const warn = spyOnWarn();

    new AnimationMixer(widget).play(opacityClip(0));
    new AnimationMixer(widget).play(
      new AnimationClip({
        name: "tint",
        tracks: [
          new AnimationTrack({
            path: "tint",
            adapter: colorAdapter,
            times: [0, 1],
            values: [[0, 0, 0, 1] as ColorRGBA, [1, 1, 1, 1] as ColorRGBA],
          }),
        ],
      }),
    );

    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Validation and allocation
// ---------------------------------------------------------------------------

describe("AnimationMixer — validation (§7a) and allocation (§7b)", () => {
  it("rejects non-second, negative, and out-of-range arguments", () => {
    const widget = animatedWidget();
    const mixer = new AnimationMixer(widget);

    expectInvalid(() => mixer.seek(0.5)); // never played
    mixer.play(trackSetClip());

    expectInvalid(() => mixer.advance(-1));
    expectInvalid(() => mixer.advance(Number.NaN));
    expectInvalid(() => mixer.seek(-0.001));
    expectInvalid(() => mixer.speed(0));
    expectInvalid(() => mixer.speed(Infinity));
    expectInvalid(() => mixer.loop(0));
    expectInvalid(() => mixer.loop(1.5));
  });

  it("allocates nothing on the advance path after play", () => {
    const widget = animatedWidget();
    const events: readonly AnimationEvent[] = [
      { time: 0.25, name: "a" },
      { time: 0.75, name: "b" },
    ];
    let fired = 0;
    const mixer = new AnimationMixer(widget).play(trackSetClip(events), {
      loop: Infinity,
      onEvent: () => {
        fired += 1;
      },
    });

    resetConstructionCount();
    for (let step = 0; step < 240; step += 1) {
      mixer.advance(1 / 60);
    }
    mixer.seek(0.5);

    expect(constructionCount()).toBe(0);
    expect(fired).toBe(8);
    expect(widget.opacity).toBeCloseTo(0.5, 12);
  });
});
