/**
 * `Slider` (§73, A-12) — the range arithmetic, §72's pointer drag through the
 * hit point, and §75's arrow/Home/End bindings.
 */

import {
  SceneKeyEvent,
  ScenePointerEvent,
  buildPropagationPath,
  dispatchKeyEvent,
  dispatchPointerEvent,
  type KeyModifiers,
} from "@four/input";
import { Vector3 } from "@four/math";
import { Group, type Node } from "@four/scene";
import { describe, expect, it } from "vitest";

import { Slider, type SliderOptions } from "../src/slider.js";
import type { WidgetSkin, WidgetValueChangeEvent } from "../src/widget.js";

/** A laid-out horizontal slider spanning `x ∈ [0, 100]`, `y ∈ [−20, 0]`. */
function track(options: SliderOptions = {}): Slider {
  const slider = new Slider({ width: 100, height: 20, ...options });
  slider.layout();
  return slider;
}

/** Dispatches a §72 pointer event carrying a world-space hit point. */
function point(
  slider: Node,
  type: "pointerdown" | "pointermove",
  x: number,
  y: number,
): void {
  dispatchPointerEvent(
    new ScenePointerEvent({
      type,
      pointerId: 1,
      ndcX: 0,
      ndcY: 0,
      target: slider,
      worldPoint: new Vector3(x, y, 0),
    }),
    buildPropagationPath(slider),
  );
}

/** Dispatches one `keydown` at `target`. */
function pressKey(
  target: Node,
  key: string,
  modifiers?: Partial<KeyModifiers>,
): SceneKeyEvent {
  const event = new SceneKeyEvent({
    type: "keydown",
    key,
    code: key,
    modifiers,
    target,
  });
  dispatchKeyEvent(event, buildPropagationPath(target));
  return event;
}

describe("Slider — range", () => {
  it("defaults to the unit range, starting at the minimum", () => {
    const slider = new Slider();
    expect([slider.min, slider.max, slider.step, slider.value]).toEqual([
      0, 1, 0, 0,
    ]);
    expect(slider.fraction).toBe(0);
    expect(slider.focusable).toBe(true);
    expect(slider.orientation).toBe("horizontal");
  });

  it("clamps and snaps an assigned value, and reports the fraction", () => {
    const slider = new Slider({ min: -20, max: 0, step: 0.5, value: -9.8 });

    expect(slider.value).toBe(-10);
    expect(slider.fraction).toBe(0.5);

    slider.value = 100;
    expect(slider.value).toBe(0);
    slider.value = -100;
    expect(slider.value).toBe(-20);
  });

  it("leaves the top unreachable when the step does not divide the range", () => {
    // The grid is anchored at `min` and the snap runs before the clamp, so
    // `[0, 10]` with `step: 3` is `0, 3, 6, 9` — the DOM's rule for
    // `<input type=range>`, and the honest reading of "these values are legal".
    const slider = new Slider({ min: 0, max: 10, step: 3 });

    slider.value = 9.6;
    expect(slider.value).toBe(9);
    slider.value = 100; // clamped to 10, snapped up to 12, stepped back to 9
    expect(slider.value).toBe(9);
    slider.value = -100;
    expect(slider.value).toBe(0);

    // …and `min` stays reachable even when one step is wider than the range.
    const wide = new Slider({ min: 0, max: 2, step: 3 });
    wide.value = 2;
    expect(wide.value).toBe(0);
  });

  it("emits uivaluechange only when the resolved value moved", () => {
    const slider = new Slider({ max: 10, step: 1 });
    const events: WidgetValueChangeEvent[] = [];
    slider.on("uivaluechange", (event) => events.push(event));

    slider.value = 3;
    slider.value = 3.2; // snaps back to 3 — a step is a step
    slider.value = 4;

    expect(events.map((event) => event.current)).toEqual([3, 4]);
    expect(events[1].previous).toBe(3);
    expect(events[0].widget).toBe(slider);
  });

  it("notifies the skin's content hook, not its state hook", () => {
    const seen: string[] = [];
    const slider = new Slider();
    slider.skin = {
      onStateChange: () => seen.push("state"),
      onContentChange: () => seen.push("content"),
    } satisfies WidgetSkin;
    seen.length = 0;

    slider.value = 0.5;

    expect(seen).toEqual(["content"]);
  });

  it("re-resolves the value when a bound or the step moves", () => {
    const slider = new Slider({ max: 10, value: 8 });
    slider.max = 5;
    expect(slider.value).toBe(5);

    const low = new Slider({ max: 10, value: 2 });
    low.min = 4;
    expect(low.value).toBe(4);
    expect(low.min).toBe(4);

    const stepped = new Slider({ max: 10, value: 7 });
    stepped.step = 5;
    expect(stepped.value).toBe(5);
    expect(stepped.step).toBe(5);
  });

  it("refuses bounds and values §85 says are not numbers", () => {
    expect(() => new Slider({ min: Number.NaN })).toThrow(RangeError);
    expect(() => new Slider({ max: Infinity })).toThrow(RangeError);
    expect(() => new Slider({ step: -1 })).toThrow(RangeError);
    expect(() => new Slider({ value: Number.NaN })).toThrow(RangeError);
    expect(() => new Slider({ min: 1, max: 0 })).toThrow(RangeError);

    const slider = new Slider();
    expect(() => (slider.value = Number.NaN)).toThrow(RangeError);
    expect(() => (slider.min = Number.NaN)).toThrow(RangeError);
    expect(() => (slider.max = Number.NaN)).toThrow(RangeError);
    expect(() => (slider.step = Number.NaN)).toThrow(RangeError);
    expect(() => (slider.step = -2)).toThrow(RangeError);
    expect(() => (slider.min = 2)).toThrow(RangeError); // above max
    expect(() => (slider.max = -1)).toThrow(RangeError); // below min
  });
});

describe("Slider — pointer (§72)", () => {
  it("jumps to a press and follows a drag inside the track", () => {
    const slider = track();

    point(slider, "pointerdown", 25, -10);
    expect(slider.value).toBe(0.25);
    expect(slider.pressed).toBe(true);

    point(slider, "pointermove", 80, -10);
    expect(slider.value).toBeCloseTo(0.8, 12);
  });

  it("ignores a move that is not part of a press", () => {
    const slider = track();
    point(slider, "pointermove", 80, -10);
    expect(slider.value).toBe(0);
  });

  it("reads the point through the widget's own world transform", () => {
    const parent = new Group();
    const slider = track();
    parent.add(slider);
    parent.transform.position.set(10, 0, 0);

    point(slider, "pointerdown", 60, -10); // 50 in the slider's local frame

    expect(slider.value).toBe(0.5);
  });

  it("ignores an event with no hit point — a captured pointer (documented)", () => {
    const slider = track();
    dispatchPointerEvent(
      new ScenePointerEvent({
        type: "pointerdown",
        pointerId: 1,
        ndcX: 0,
        ndcY: 0,
        target: slider,
      }),
      buildPropagationPath(slider),
    );

    expect(slider.value).toBe(0);
  });

  it("ignores a degenerate transform rather than producing NaN", () => {
    const slider = track();
    slider.transform.scale.set(0, 1, 1);

    point(slider, "pointerdown", 25, -10);

    expect(slider.value).toBe(0);
  });

  it("ignores a pointer it may not take: not interactive, disabled, or off", () => {
    const inert = track();
    inert.interactive = false;
    point(inert, "pointerdown", 50, -10);
    expect(inert.value).toBe(0);

    const disabled = track();
    disabled.disabled = true;
    point(disabled, "pointerdown", 50, -10);
    expect(disabled.value).toBe(0);

    const off = track();
    off.enabled = false;
    point(off, "pointerdown", 50, -10);
    expect(off.value).toBe(0);
  });

  it("does not react to a press on a child (§72 bubbling)", () => {
    const slider = track();
    const child = track();
    slider.add(child);

    point(child, "pointerdown", 50, -10);

    expect(slider.value).toBe(0);
    expect(child.value).toBe(0.5);
  });

  it("increases upward when vertical, the one flip against the y-down box", () => {
    const slider = track({ orientation: "vertical" });

    slider.setValueFromLocalPoint(0, 0); // the top edge
    expect(slider.value).toBe(1);

    slider.setValueFromLocalPoint(0, -20); // the bottom edge
    expect(slider.value).toBe(0);

    point(slider, "pointerdown", 10, -5);
    expect(slider.value).toBe(0.75);
  });

  it("ignores a position on a track with no length", () => {
    const slider = new Slider(); // never laid out: measured 0 × 0
    slider.setValueFromLocalPoint(50, -10);
    expect(slider.value).toBe(0);

    const vertical = new Slider({ orientation: "vertical" });
    vertical.setValueFromLocalPoint(50, -10);
    expect(vertical.value).toBe(0);
  });
});

describe("Slider — keyboard (§75)", () => {
  it("steps with the arrows and jumps with Home and End", () => {
    const slider = track({ min: 0, max: 10, step: 2, value: 4 });

    const up = pressKey(slider, "ArrowRight");
    expect(slider.value).toBe(6);
    expect(up.defaultPrevented).toBe(true);

    pressKey(slider, "ArrowUp");
    expect(slider.value).toBe(8);
    pressKey(slider, "ArrowLeft");
    expect(slider.value).toBe(6);
    pressKey(slider, "ArrowDown");
    expect(slider.value).toBe(4);

    pressKey(slider, "End");
    expect(slider.value).toBe(10);
    pressKey(slider, "Home");
    expect(slider.value).toBe(0);
  });

  it("moves a continuous slider by one percent of its range", () => {
    const slider = track({ min: 0, max: 200 });

    pressKey(slider, "ArrowRight");

    expect(slider.value).toBe(2);
  });

  it("claims the key at the end of the range, so a held arrow cannot scroll", () => {
    const slider = track({ value: 1 });
    const event = pressKey(slider, "ArrowRight");

    expect(slider.value).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores chords, other keys, and keys aimed at a descendant", () => {
    const slider = track({ max: 10, step: 1, value: 5 });

    for (const modifiers of [
      { alt: true },
      { ctrl: true },
      { meta: true },
      { shift: true },
    ]) {
      pressKey(slider, "ArrowRight", modifiers);
    }
    const other = pressKey(slider, "Escape");
    expect(slider.value).toBe(5);
    expect(other.defaultPrevented).toBe(false);

    const child = track();
    slider.add(child);
    pressKey(child, "ArrowRight");
    expect(slider.value).toBe(5);
  });

  it("refuses keys when disabled or not enabled", () => {
    const disabled = track({ max: 10, step: 1, value: 5 });
    disabled.disabled = true;
    expect(pressKey(disabled, "ArrowRight").defaultPrevented).toBe(false);
    expect(disabled.value).toBe(5);

    const off = track({ max: 10, step: 1, value: 5 });
    off.enabled = false;
    pressKey(off, "ArrowRight");
    expect(off.value).toBe(5);
  });

  it("stays keyboard-drivable when a pointer may not reach it", () => {
    // The same rule `Button` and the traversal follow: `interactive` governs
    // pointers, and a control the mouse cannot reach is the one a keyboard
    // user still needs.
    const slider = track({ max: 10, step: 1 });
    slider.interactive = false;

    pressKey(slider, "ArrowRight");

    expect(slider.value).toBe(1);
  });
});
