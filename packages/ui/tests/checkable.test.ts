/**
 * `Toggle` and `Checkbox` (§73, A-12) — activation flips checkedness, and
 * checkedness rides §75's state snapshot.
 */

import {
  SceneKeyEvent,
  ScenePointerEvent,
  buildPropagationPath,
  dispatchKeyEvent,
  dispatchPointerEvent,
} from "@four/input";
import { type Node } from "@four/scene";
import { describe, expect, it } from "vitest";

import { CheckableWidget, Checkbox, Toggle } from "../src/checkable.js";
import { Panel } from "../src/panel.js";
import {
  type WidgetActivateEvent,
  type WidgetSkin,
  type WidgetStateChangeEvent,
} from "../src/widget.js";

/** Dispatches one §72 pointer event at `target` through the real path. */
function dispatch(
  type: "pointerdown" | "pointerup" | "click",
  target: Node,
): void {
  dispatchPointerEvent(
    new ScenePointerEvent({ type, pointerId: 1, ndcX: 0, ndcY: 0, target }),
    buildPropagationPath(target),
  );
}

/** Dispatches one `keydown` at `target`. */
function pressKey(target: Node, key: string): SceneKeyEvent {
  const event = new SceneKeyEvent({
    type: "keydown",
    key,
    code: key,
    target,
  });
  dispatchKeyEvent(event, buildPropagationPath(target));
  return event;
}

describe("CheckableWidget (Toggle, Checkbox)", () => {
  it("starts unchecked, and reports checkedness in the §75 snapshot", () => {
    const toggle = new Toggle();

    expect(toggle.checked).toBe(false);
    expect(toggle.state.checked).toBe(false);
    // …unlike a widget that is not checkable at all, which answers `null`.
    expect(new Panel().checked).toBeNull();
    expect(new Checkbox({ checked: true }).checked).toBe(true);
  });

  it("is a Button, so it is focusable and lays out its content", () => {
    const toggle = new Toggle({ width: 40, height: 20, padding: 2 });
    expect(toggle.focusable).toBe(true);
    toggle.layout();
    expect(toggle.measuredWidth).toBe(40);
  });

  it("flips on click, on Enter, on Space, and on activate()", () => {
    const toggle = new Toggle();

    dispatch("click", toggle);
    expect(toggle.checked).toBe(true);

    pressKey(toggle, "Enter");
    expect(toggle.checked).toBe(false);

    pressKey(toggle, " ");
    expect(toggle.checked).toBe(true);

    expect(toggle.activate()).toBe(true);
    expect(toggle.checked).toBe(false);
  });

  it("has already flipped when the uiactivate listener runs (DOM order)", () => {
    const box = new Checkbox();
    const seen: (boolean | null)[] = [];
    box.on("uiactivate", (event: WidgetActivateEvent) =>
      seen.push(event.widget.checked),
    );

    dispatch("click", box);
    dispatch("click", box);

    expect(seen).toEqual([true, false]);
  });

  it("publishes the flip through uistatechange, with both snapshots", () => {
    const toggle = new Toggle();
    const events: WidgetStateChangeEvent[] = [];
    toggle.on("uistatechange", (event) => events.push(event));

    toggle.checked = true;

    expect(events).toHaveLength(1);
    expect(events[0].previous.checked).toBe(false);
    expect(events[0].current.checked).toBe(true);
    // Nothing else moved.
    expect(events[0].current.hovered).toBe(false);
    expect(events[0].current.focused).toBe(false);
  });

  it("emits nothing when assigned the value it already holds", () => {
    const toggle = new Toggle({ checked: true });
    const events: WidgetStateChangeEvent[] = [];
    toggle.on("uistatechange", (event) => events.push(event));

    toggle.checked = true;

    expect(events).toHaveLength(0);
  });

  it("tells the skin, through the state hook checkedness belongs to", () => {
    const seen: string[] = [];
    const skin: WidgetSkin = {
      onStateChange: () => seen.push("state"),
      onContentChange: () => seen.push("content"),
    };
    const toggle = new Toggle();
    toggle.skin = skin;
    seen.length = 0;

    toggle.checked = true;

    expect(seen).toEqual(["state"]);
  });

  it("refuses an activation it would refuse anyway, and changes nothing", () => {
    const disabled = new Toggle();
    disabled.disabled = true;
    expect(disabled.activate()).toBe(false);
    expect(disabled.checked).toBe(false);

    const off = new Toggle();
    off.enabled = false;
    dispatch("click", off);
    expect(off.checked).toBe(false);

    const gone = new Toggle();
    gone.dispose();
    pressKey(gone, "Enter");
    expect(gone.checked).toBe(false);
  });

  it("still takes a programmatic assignment while disabled", () => {
    // The state of a disabled control is how an application restores one;
    // refusing it would silently desynchronize the widget from its model.
    const box = new Checkbox();
    box.disabled = true;

    box.checked = true;

    expect(box.checked).toBe(true);
  });

  it("is subclassable — the base is what an application extends", () => {
    class TriState extends CheckableWidget {
      calls = 0;
      protected override beforeChecked(): void {
        this.calls += 1;
      }
    }
    const custom = new TriState();

    custom.checked = true;
    custom.checked = false;
    custom.checked = true;

    expect(custom.calls).toBe(2);
  });
});
