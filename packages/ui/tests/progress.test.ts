/**
 * `ProgressIndicator` (§73, A-12) — an output: a clamped value, a fraction for
 * the skin, and no interaction at all.
 */

import { ScenePointerEvent, buildPropagationPath } from "@four/input";
import { dispatchPointerEvent } from "@four/input";
import { describe, expect, it } from "vitest";

import { ProgressIndicator } from "../src/progress.js";
import { collectPickables } from "../src/widget.js";
import type { WidgetSkin, WidgetValueChangeEvent } from "../src/widget.js";

describe("ProgressIndicator", () => {
  it("is an output — not interactive, not focusable, out of the pick list", () => {
    const bar = new ProgressIndicator({ width: 100, height: 4 });
    bar.layout();

    expect(bar.interactive).toBe(false);
    expect(bar.focusable).toBe(false);
    expect(collectPickables(bar)).toEqual([]);
    // …unless the application says otherwise.
    expect(new ProgressIndicator({ interactive: true }).interactive).toBe(true);
  });

  it("defaults to the unit range at zero", () => {
    const bar = new ProgressIndicator();
    expect([bar.min, bar.max, bar.value]).toEqual([0, 1, 0]);
    expect(bar.fraction).toBe(0);
    expect(bar.indeterminate).toBe(false);
  });

  it("clamps the value into the range and reports the fraction", () => {
    const bar = new ProgressIndicator({ max: 200, value: 50 });

    expect(bar.fraction).toBe(0.25);

    bar.value = 500;
    expect(bar.value).toBe(200);
    expect(bar.fraction).toBe(1);
    bar.value = -1;
    expect(bar.value).toBe(0);
  });

  it("has no step grid — a load that is 37.2% done is 37.2% done", () => {
    const bar = new ProgressIndicator({ max: 1000, value: 372 });
    expect(bar.fraction).toBeCloseTo(0.372, 12);
  });

  it("emits uivaluechange and notifies the skin when the value moves", () => {
    const bar = new ProgressIndicator({ max: 10 });
    const events: WidgetValueChangeEvent[] = [];
    const seen: string[] = [];
    bar.on("uivaluechange", (event) => events.push(event));
    bar.skin = {
      onContentChange: () => seen.push("content"),
      onStateChange: () => seen.push("state"),
    } satisfies WidgetSkin;
    seen.length = 0;

    bar.value = 4;
    bar.value = 4; // no change, no event
    bar.value = 20; // clamps to 10

    expect(events.map((event) => event.current)).toEqual([4, 10]);
    expect(events[1].previous).toBe(4);
    expect(seen).toEqual(["content", "content"]);
  });

  it("re-clamps when a bound moves", () => {
    const bar = new ProgressIndicator({ max: 10, value: 8 });
    bar.max = 5;
    expect(bar.value).toBe(5);

    const low = new ProgressIndicator({ max: 10, value: 2 });
    low.min = 4;
    expect([low.min, low.value]).toEqual([4, 4]);
  });

  it("takes an indeterminate start from its options", () => {
    expect(new ProgressIndicator({ indeterminate: true }).indeterminate).toBe(
      true,
    );
  });

  it("carries its value across an indeterminate spell", () => {
    const bar = new ProgressIndicator({ max: 10, value: 3 });
    const seen: string[] = [];
    bar.skin = {
      onContentChange: () => seen.push("content"),
    } satisfies WidgetSkin;
    seen.length = 0;

    bar.indeterminate = true;
    bar.indeterminate = true; // idempotent

    expect(bar.indeterminate).toBe(true);
    expect(seen).toEqual(["content"]);
    // The last known progress survives — a skin drawing a spinner ignores it.
    expect(bar.fraction).toBeCloseTo(0.3, 12);

    bar.indeterminate = false;
    expect(seen).toHaveLength(2);
  });

  it("answers a zero fraction for an empty range rather than dividing", () => {
    const bar = new ProgressIndicator({ min: 5, max: 5, value: 5 });
    expect(bar.fraction).toBe(0);
  });

  it("refuses bounds and values §85 says are not numbers", () => {
    expect(() => new ProgressIndicator({ min: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => new ProgressIndicator({ max: Infinity })).toThrow(RangeError);
    expect(() => new ProgressIndicator({ value: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() => new ProgressIndicator({ min: 1, max: 0 })).toThrow(RangeError);

    const bar = new ProgressIndicator();
    expect(() => (bar.value = Number.NaN)).toThrow(RangeError);
    expect(() => (bar.min = Number.NaN)).toThrow(RangeError);
    expect(() => (bar.max = Number.NaN)).toThrow(RangeError);
    expect(() => (bar.min = 2)).toThrow(RangeError); // above max
    expect(() => (bar.max = -1)).toThrow(RangeError); // below min
  });

  it("is a Panel, so it can hold a label of its own", () => {
    const bar = new ProgressIndicator({
      padding: 2,
      layout: { type: "stack" },
    });
    const caption = new ProgressIndicator({ width: 10, height: 6 });
    bar.add(caption);
    bar.layout();

    expect(bar.measuredWidth).toBe(14);
    expect([caption.layoutLeft, caption.layoutTop]).toEqual([2, 2]);
  });

  it("passes a pointer straight through, having no hit area in the walk", () => {
    const bar = new ProgressIndicator({ width: 20, height: 4 });
    bar.layout();
    let seen = 0;
    bar.on("pointerdown", () => (seen += 1));

    // It still *receives* a dispatched event — being non-interactive keeps it
    // out of the candidate list, it does not deafen the node (§72).
    dispatchPointerEvent(
      new ScenePointerEvent({
        type: "pointerdown",
        pointerId: 1,
        ndcX: 0,
        ndcY: 0,
        target: bar,
      }),
      buildPropagationPath(bar),
    );

    expect(seen).toBe(1);
    expect(bar.pressed).toBe(false);
  });
});
