/**
 * `Button` (§73) — §72's synthesized `click` becoming one activation, plus the
 * focus and layout it inherits.
 */

import {
  ScenePointerEvent,
  buildPropagationPath,
  dispatchPointerEvent,
} from "@four/input";
import { Group, type Node } from "@four/scene";
import { buildGlyphAtlas } from "@four/text";
import { describe, expect, it } from "vitest";

import { Button } from "../src/button.js";
import { Label } from "../src/label.js";
import { focusedWidget, type WidgetActivateEvent } from "../src/widget.js";

/** Dispatches one §72 event at `target` through the real propagation path. */
function dispatch(
  type: "pointerdown" | "pointerup" | "click",
  target: Node,
): ScenePointerEvent {
  const event = new ScenePointerEvent({
    type,
    pointerId: 1,
    ndcX: 0,
    ndcY: 0,
    target,
  });
  dispatchPointerEvent(event, buildPropagationPath(target));
  return event;
}

/** A button plus the `uiactivate` events it emitted. */
function buttonWithLog(): { button: Button; log: WidgetActivateEvent[] } {
  const button = new Button({ width: 100, height: 30 });
  const log: WidgetActivateEvent[] = [];
  button.on("uiactivate", (event) => log.push(event));
  return { button, log };
}

describe("Button", () => {
  it("is focusable by default, unlike a bare panel", () => {
    expect(new Button().focusable).toBe(true);
    expect(new Button({ focusable: false }).focusable).toBe(false);
  });

  it("activates exactly once per click, carrying the pointer event", () => {
    const { button, log } = buttonWithLog();
    const click = dispatch("click", button);

    expect(log).toHaveLength(1);
    expect(log[0].widget).toBe(button);
    expect(log[0].source).toBe("pointer");
    expect(log[0].pointerEvent).toBe(click);
  });

  it("activates once for a click that bubbles from a child label (§72)", () => {
    const { button, log } = buttonWithLog();
    const label = new Label({ text: "Go", atlas: buildGlyphAtlas(), size: 12 });
    button.add(label);

    dispatch("click", label);
    expect(log).toHaveLength(1);
    expect(log[0].widget).toBe(button);
  });

  it("takes the focus on press and reports it to its scene root (§75)", () => {
    const root = new Group();
    const button = new Button();
    root.add(button);

    dispatch("pointerdown", button);
    expect(button.focused).toBe(true);
    expect(button.pressed).toBe(true);
    expect(focusedWidget(root)).toBe(button);

    dispatch("pointerup", button);
    expect(button.pressed).toBe(false);
    expect(button.focused).toBe(true);
  });

  it("activates programmatically, with no pointer event", () => {
    const { button, log } = buttonWithLog();
    expect(button.activate()).toBe(true);
    expect(log).toHaveLength(1);
    expect(log[0].source).toBe("programmatic");
    expect(log[0].pointerEvent).toBeNull();
  });

  it("refuses to activate when disabled, not enabled, or disposed", () => {
    const disabled = buttonWithLog();
    disabled.button.disabled = true;
    expect(disabled.button.activate()).toBe(false);
    dispatch("click", disabled.button);
    expect(disabled.log).toHaveLength(0);

    const off = buttonWithLog();
    off.button.enabled = false;
    expect(off.button.activate()).toBe(false);

    const gone = buttonWithLog();
    gone.button.dispose();
    expect(gone.button.activate()).toBe(false);
    dispatch("click", gone.button);
    expect(gone.log).toHaveLength(0);
  });

  it("keeps programmatic activation available to a non-interactive button", () => {
    const { button, log } = buttonWithLog();
    button.interactive = false;

    dispatch("click", button);
    expect(log).toHaveLength(0);

    // The staged keyboard layer drives exactly this call — see button.ts.
    expect(button.activate("programmatic")).toBe(true);
    expect(log).toHaveLength(1);
  });

  it("is a Panel, so it lays its own content out (§74)", () => {
    const atlas = buildGlyphAtlas();
    const button = new Button({
      padding: 4,
      layout: { type: "stack", gap: 6 },
    });
    const icon = new Label({ text: "*", atlas, size: 12 });
    const text = new Label({ text: "Go", atlas, size: 12 });
    button.add(icon, text);

    button.layout();

    expect(button.measuredWidth).toBe(32); // 6 + 6 gap + 12 + 8 padding
    expect(button.measuredHeight).toBe(20); // 12 + 8 padding
    expect([icon.layoutLeft, icon.layoutTop]).toEqual([4, 4]);
    expect([text.layoutLeft, text.layoutTop]).toEqual([16, 4]);
  });
});
