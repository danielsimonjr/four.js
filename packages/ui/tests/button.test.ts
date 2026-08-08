/**
 * `Button` (§73) — §72's synthesized `click` becoming one activation, plus the
 * focus and layout it inherits.
 */

import {
  SceneKeyEvent,
  ScenePointerEvent,
  buildPropagationPath,
  dispatchKeyEvent,
  dispatchPointerEvent,
  type KeyModifiers,
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

/**
 * Dispatches one `keydown` at `target` through the real propagation path — what
 * `KeyboardInput` does with the focused node's keystroke.
 */
function pressKey(
  target: Node,
  key: string,
  options: {
    code?: string;
    modifiers?: Partial<KeyModifiers>;
    repeat?: boolean;
  } = {},
): SceneKeyEvent {
  const event = new SceneKeyEvent({
    type: "keydown",
    key,
    code: options.code ?? key,
    modifiers: options.modifiers,
    repeat: options.repeat,
    target,
  });
  dispatchKeyEvent(event, buildPropagationPath(target));
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

    expect(button.activate("programmatic")).toBe(true);
    expect(log).toHaveLength(1);
  });

  it("activates on Enter and on Space, reporting the keyboard as the source (§75)", () => {
    for (const key of ["Enter", " "]) {
      const { button, log } = buttonWithLog();

      const event = pressKey(button, key);

      expect(log).toHaveLength(1);
      expect(log[0].source).toBe("keyboard");
      expect(log[0].pointerEvent).toBeNull();
      // The host must not also scroll the page on Space.
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("activates on the space bar's physical key whatever it produces", () => {
    const { button, log } = buttonWithLog();

    pressKey(button, "Unidentified", { code: "Space" });

    expect(log).toHaveLength(1);
  });

  it("ignores every other key", () => {
    const { button, log } = buttonWithLog();

    const event = pressKey(button, "a");
    pressKey(button, "Tab");
    pressKey(button, "Escape");

    expect(log).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores auto-repeat, so one held key is one activation", () => {
    const { button, log } = buttonWithLog();

    pressKey(button, "Enter");
    pressKey(button, "Enter", { repeat: true });
    pressKey(button, "Enter", { repeat: true });

    expect(log).toHaveLength(1);
  });

  it("ignores a chord, but not Shift", () => {
    const { button, log } = buttonWithLog();

    for (const modifiers of [{ alt: true }, { ctrl: true }, { meta: true }]) {
      pressKey(button, "Enter", { modifiers });
    }
    expect(log).toHaveLength(0);

    pressKey(button, "Enter", { modifiers: { shift: true } });
    expect(log).toHaveLength(1);
  });

  it("does not activate on a key aimed at a focused descendant", () => {
    const { button, log } = buttonWithLog();
    const inner = new Button({ width: 10, height: 10 });
    button.add(inner);
    const innerLog: WidgetActivateEvent[] = [];
    inner.on("uiactivate", (event) => innerLog.push(event));

    // The event targets the inner button and bubbles to the outer one (§72).
    pressKey(inner, "Enter");

    expect(innerLog).toHaveLength(1);
    expect(log).toHaveLength(0);
  });

  it("keeps keyboard activation available to a non-interactive button", () => {
    const { button, log } = buttonWithLog();
    button.interactive = false;

    pressKey(button, "Enter");

    expect(log).toHaveLength(1);
    expect(log[0].source).toBe("keyboard");
  });

  it("refuses a keyboard activation when disabled, not enabled, or disposed", () => {
    const disabled = buttonWithLog();
    disabled.button.disabled = true;
    pressKey(disabled.button, "Enter");
    expect(disabled.log).toHaveLength(0);

    const off = buttonWithLog();
    off.button.enabled = false;
    pressKey(off.button, "Enter");
    expect(off.log).toHaveLength(0);

    const gone = buttonWithLog();
    gone.button.dispose();
    pressKey(gone.button, "Enter");
    expect(gone.log).toHaveLength(0);
  });

  // 2026-08-07: the default was suppressed *before* `activate` was consulted,
  // so a refused button still ate the host's keystroke — a control that does
  // nothing must not swallow the Space that would have scrolled the page.
  it("suppresses the platform default exactly when it consumed the key", () => {
    const { button } = buttonWithLog();
    expect(pressKey(button, " ").defaultPrevented).toBe(true);

    const disabled = buttonWithLog();
    disabled.button.disabled = true;
    const refused = pressKey(disabled.button, " ");
    expect(refused.defaultPrevented).toBe(false);
    expect(disabled.log).toHaveLength(0);

    const off = buttonWithLog();
    off.button.enabled = false;
    expect(pressKey(off.button, "Enter").defaultPrevented).toBe(false);

    const gone = buttonWithLog();
    gone.button.dispose();
    expect(pressKey(gone.button, "Enter").defaultPrevented).toBe(false);
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
