/**
 * `CanvasViewWidget` (§73, §77a; RFC 0004) — the skin-drawn canvas view: a
 * box, a supplied device-pixel backing size, and a content revision. The
 * widget names no texture type; that absence is the design (RFC 0004 §2b).
 */

import { describe, expect, it } from "vitest";

import { CanvasViewWidget } from "../src/canvas-view.js";
import type { WidgetSkin } from "../src/widget.js";

describe("CanvasViewWidget", () => {
  it("measures nothing intrinsically — the application paints to fill the box", () => {
    const view = new CanvasViewWidget();
    view.layout();
    expect(view.measuredWidth).toBe(0);
    expect(view.measuredHeight).toBe(0);
    expect(view.pixelWidth).toBe(0); // no backing until §74 gives it a box
  });

  it("derives the backing size from the layout box and the resolution, rounded", () => {
    const view = new CanvasViewWidget({
      width: 200.4,
      height: 120,
      resolution: 1.5,
    });
    view.layout();
    expect(view.resolution).toBe(1.5);
    expect(view.pixelWidth).toBe(Math.round(200.4 * 1.5)); // 301
    expect(view.pixelHeight).toBe(180);
  });

  it("defaults resolution to 1 — supplied, never discovered (§45's is invisible here)", () => {
    const view = new CanvasViewWidget({ width: 64, height: 32 });
    view.layout();
    expect(view.resolution).toBe(1);
    expect(view.pixelWidth).toBe(64);
    expect(view.pixelHeight).toBe(32);
  });

  it("refuses a resolution that is not a finite positive number (§85)", () => {
    for (const resolution of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new CanvasViewWidget({ resolution })).toThrow(RangeError);
    }
    const view = new CanvasViewWidget();
    expect(() => {
      view.resolution = 0;
    }).toThrow(/resolution must be > 0/);
    expect(view.resolution).toBe(1); // the refused write changed nothing
  });

  it("invalidate() bumps contentVersion and fires the skin's onContentChange", () => {
    const view = new CanvasViewWidget({ width: 10, height: 10 });
    const notified: number[] = [];
    const skin: WidgetSkin = {
      onContentChange: (widget) => {
        notified.push((widget as CanvasViewWidget).contentVersion);
      },
    };
    view.skin = skin;
    expect(view.contentVersion).toBe(0);

    view.invalidate();
    view.invalidate();

    // The version is bumped BEFORE the hook, so a skin that repaints inside
    // the hook records the revision it just drew.
    expect(notified).toEqual([1, 2]);
    expect(view.contentVersion).toBe(2);
  });

  it("a resolution change is a repaint request; an unchanged write is nothing", () => {
    const view = new CanvasViewWidget({ width: 10, height: 10 });
    view.layout(); // pixelWidth reads the *measured* size, so lay out first
    let changes = 0;
    view.skin = {
      onContentChange: () => {
        changes += 1;
      },
    };

    view.resolution = 2; // pixel size moved → the skin must rebuild
    expect(view.contentVersion).toBe(1);
    expect(changes).toBe(1);
    expect(view.pixelWidth).toBe(20);

    view.resolution = 2; // self-assignment: no version, no notification
    expect(view.contentVersion).toBe(1);
    expect(changes).toBe(1);
  });

  it("works with no skin at all — invalidate is still a cheap version bump", () => {
    const view = new CanvasViewWidget();
    view.invalidate();
    expect(view.contentVersion).toBe(1);
  });
});
