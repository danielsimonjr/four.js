/**
 * §75's keyboard navigation (A-13): the Tab traversal order, the resolver that
 * feeds `@four/input`'s key source, and the focus walk itself.
 *
 * Key events are synthesized exactly as the pointer suites synthesize theirs —
 * a real {@link SceneKeyEvent} pushed through `dispatchKeyEvent` along a real
 * propagation path — so the traversal is exercised against §72's dispatch
 * rather than against a stand-in for it.
 */

import {
  SceneKeyEvent,
  buildPropagationPath,
  dispatchKeyEvent,
  type KeyModifiers,
} from "@four/input";
import { Group, type Node } from "@four/scene";
import { describe, expect, it } from "vitest";

import { Button } from "../src/button.js";
import {
  collectFocusOrder,
  installKeyboardTraversal,
  keyboardFocusTarget,
} from "../src/keyboard.js";
import { Panel } from "../src/panel.js";
import { UIWidget, focusedWidget } from "../src/widget.js";

/** A concrete widget for the traversal's own tests. */
class TestWidget extends UIWidget {}

/**
 * Dispatches one key event at the tree's current key target — the resolver's
 * answer, which is what `KeyboardInput` would have used — and returns it.
 */
function press(
  root: Node,
  key: string,
  modifiers: Partial<KeyModifiers> = {},
  repeat = false,
): SceneKeyEvent {
  const target = keyboardFocusTarget(root)();
  const event = new SceneKeyEvent({
    type: "keydown",
    key,
    code: key,
    modifiers,
    repeat,
    target,
  });
  if (target !== null) {
    dispatchKeyEvent(event, buildPropagationPath(target));
  }
  return event;
}

/** A root panel with `count` focusable buttons, named `b0`, `b1`, … */
function tree(count: number): { root: Panel; buttons: Button[] } {
  const root = new Panel({ interactive: false });
  const buttons: Button[] = [];
  for (let i = 0; i < count; i += 1) {
    const button = new Button({ width: 10, height: 10 });
    button.name = `b${String(i)}`;
    root.add(button);
    buttons.push(button);
  }
  return { root, buttons };
}

/** The name of whatever holds `root`'s focus, or `"none"`. */
function focusName(root: Node): string {
  return focusedWidget(root)?.name ?? "none";
}

describe("collectFocusOrder (§75)", () => {
  it("collects focusable widgets in scene order", () => {
    const { root, buttons } = tree(3);

    expect(collectFocusOrder(root)).toEqual(buttons);
  });

  it("skips widgets that are not focusable", () => {
    const { root, buttons } = tree(2);
    const panel = new Panel();
    root.add(panel);

    expect(collectFocusOrder(root)).toEqual(buttons);
  });

  it("skips disabled, disposed, and disconnected widgets", () => {
    const { root, buttons } = tree(4);
    buttons[1].disabled = true;
    buttons[2].enabled = false;
    buttons[3].dispose();

    expect(collectFocusOrder(root)).toEqual([buttons[0]]);
  });

  it("prunes an invisible or disabled subtree entirely", () => {
    const root = new Panel({ interactive: false });
    const hidden = new Group();
    const hiddenButton = new Button();
    hidden.add(hiddenButton);
    hidden.visible = false;
    const off = new Group();
    off.add(new Button());
    off.enabled = false;
    const visible = new Button();
    root.add(hidden);
    root.add(off);
    root.add(visible);

    expect(collectFocusOrder(root)).toEqual([visible]);
  });

  it("walks through non-widget nodes", () => {
    const root = new Panel({ interactive: false });
    const group = new Group();
    const nested = new Button();
    group.add(nested);
    root.add(group);

    expect(collectFocusOrder(root)).toEqual([nested]);
  });

  it("includes a widget that pointers cannot reach", () => {
    const { root } = tree(0);
    const button = new Button({ interactive: false });
    root.add(button);

    expect(collectFocusOrder(root)).toEqual([button]);
  });

  it("sorts by tabIndex, breaking ties by scene order", () => {
    const { root, buttons } = tree(4);
    buttons[0].accessibility = { tabIndex: 3 };
    buttons[1].accessibility = { tabIndex: 1 };
    buttons[2].accessibility = { role: "button" }; // no tabIndex → 0
    // buttons[3] has no accessibility record at all → also 0

    expect(collectFocusOrder(root)).toEqual([
      buttons[2],
      buttons[3],
      buttons[1],
      buttons[0],
    ]);
  });

  it("excludes a negative tabIndex without making the widget unfocusable", () => {
    const { root, buttons } = tree(2);
    buttons[0].accessibility = { tabIndex: -1 };

    expect(collectFocusOrder(root)).toEqual([buttons[1]]);

    buttons[0].focus();
    expect(buttons[0].focused).toBe(true);
  });

  it("overwrites and truncates a supplied array", () => {
    const { root, buttons } = tree(1);
    const out: UIWidget[] = [new TestWidget(), new TestWidget()];

    expect(collectFocusOrder(root, out)).toBe(out);
    expect(out).toEqual(buttons);
  });
});

describe("keyboardFocusTarget (§75)", () => {
  it("answers the focused widget once there is one", () => {
    const { root, buttons } = tree(2);
    const resolve = keyboardFocusTarget(root);

    expect(resolve()).toBe(root);

    buttons[1].focus();
    expect(resolve()).toBe(buttons[1]);
  });

  it("falls back to the root so the first keystroke is deliverable", () => {
    const { root } = tree(1);

    expect(keyboardFocusTarget(root)()).toBe(root);
  });
});

describe("installKeyboardTraversal (§75)", () => {
  it("focuses the first widget when nothing is focused yet", () => {
    const { root } = tree(3);
    installKeyboardTraversal(root);

    const event = press(root, "Tab");

    expect(focusName(root)).toBe("b0");
    expect(event.defaultPrevented).toBe(true);
  });

  it("walks forward and wraps at the end", () => {
    const { root } = tree(3);
    installKeyboardTraversal(root);

    press(root, "Tab");
    press(root, "Tab");
    expect(focusName(root)).toBe("b1");
    press(root, "Tab");
    expect(focusName(root)).toBe("b2");
    press(root, "Tab");
    expect(focusName(root)).toBe("b0");
  });

  it("walks backward with Shift, entering at the last widget", () => {
    const { root } = tree(3);
    installKeyboardTraversal(root);

    press(root, "Tab", { shift: true });
    expect(focusName(root)).toBe("b2");
    press(root, "Tab", { shift: true });
    expect(focusName(root)).toBe("b1");
  });

  it("wraps backward past the first widget", () => {
    const { root, buttons } = tree(3);
    installKeyboardTraversal(root);
    buttons[0].focus();

    press(root, "Tab", { shift: true });

    expect(focusName(root)).toBe("b2");
  });

  it("keeps exactly one focused widget per scene root", () => {
    const { root, buttons } = tree(3);
    installKeyboardTraversal(root);

    press(root, "Tab");
    press(root, "Tab");

    expect(buttons.filter((button) => button.focused)).toEqual([buttons[1]]);
  });

  it("honours the tabIndex order rather than the scene order", () => {
    const { root, buttons } = tree(3);
    buttons[0].accessibility = { tabIndex: 2 };
    buttons[1].accessibility = { tabIndex: 1 };
    buttons[2].accessibility = { tabIndex: 0 };
    installKeyboardTraversal(root);

    press(root, "Tab");
    expect(focusName(root)).toBe("b2");
    press(root, "Tab");
    expect(focusName(root)).toBe("b1");
    press(root, "Tab");
    expect(focusName(root)).toBe("b0");
  });

  it("re-reads the order on every keystroke", () => {
    const { root, buttons } = tree(3);
    installKeyboardTraversal(root);

    press(root, "Tab");
    buttons[1].disabled = true;
    press(root, "Tab");

    expect(focusName(root)).toBe("b2");
  });

  it("re-enters at the start when the focused widget has left the order", () => {
    const { root, buttons } = tree(3);
    installKeyboardTraversal(root);
    buttons[2].focus();
    // Still focused, no longer traversable — the one case where a focused
    // widget is not in the order.
    buttons[2].visible = false;

    press(root, "Tab");

    expect(focusName(root)).toBe("b0");
  });

  it("honours auto-repeat, so holding Tab keeps walking", () => {
    const { root } = tree(3);
    installKeyboardTraversal(root);

    press(root, "Tab");
    press(root, "Tab", {}, true);

    expect(focusName(root)).toBe("b1");
  });

  it("ignores every key that is not Tab", () => {
    const { root } = tree(3);
    installKeyboardTraversal(root);

    const event = press(root, "ArrowRight");

    expect(focusName(root)).toBe("none");
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores a Tab chorded with Alt, Control, or Meta", () => {
    const { root } = tree(3);
    installKeyboardTraversal(root);

    for (const modifiers of [{ alt: true }, { ctrl: true }, { meta: true }]) {
      const event = press(root, "Tab", modifiers);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(focusName(root)).toBe("none");
  });

  it("does nothing when there is nothing to focus", () => {
    const root = new Panel({ interactive: false });
    installKeyboardTraversal(root);

    const event = press(root, "Tab");

    expect(focusName(root)).toBe("none");
    expect(event.defaultPrevented).toBe(false);
  });

  it("blurs and yields the key at the end when wrapping is off", () => {
    const { root, buttons } = tree(2);
    installKeyboardTraversal(root, { wrap: false });
    buttons[1].focus();

    const event = press(root, "Tab");

    expect(focusName(root)).toBe("none");
    expect(event.defaultPrevented).toBe(false);
  });

  it("blurs and yields the key at the start when walking backward without wrap", () => {
    const { root, buttons } = tree(2);
    installKeyboardTraversal(root, { wrap: false });
    buttons[0].focus();

    const event = press(root, "Tab", { shift: true });

    expect(focusName(root)).toBe("none");
    expect(event.defaultPrevented).toBe(false);
  });

  // 2026-08-07: the exit used to last exactly one keystroke. The next Tab
  // arrived at the root with nothing focused, was read as "enter the tree", and
  // put the focus straight back on b0 *with* preventDefault — so the host never
  // saw a Tab and the documented "the focus leaves the widget tree" was false.
  it("keeps the focus out for the keystroke after it leaves (wrap: false)", () => {
    const { root, buttons } = tree(2);
    installKeyboardTraversal(root, { wrap: false });
    buttons[1].focus();

    const leaving = press(root, "Tab");
    expect(focusName(root)).toBe("none");
    expect(leaving.defaultPrevented).toBe(false);

    const outside = press(root, "Tab");
    expect(focusName(root)).toBe("none");
    expect(outside.defaultPrevented).toBe(false);

    // The third keystroke is an ordinary "enter the tree" again: a user tabbing
    // back into an embedded panel arrives at its first widget.
    const returning = press(root, "Tab");
    expect(focusName(root)).toBe("b0");
    expect(returning.defaultPrevented).toBe(true);
  });

  it("re-enters at the last widget when the return keystroke is Shift-Tab", () => {
    const { root, buttons } = tree(2);
    installKeyboardTraversal(root, { wrap: false });
    buttons[0].focus();

    press(root, "Tab", { shift: true }); // leaves at the start
    press(root, "Tab", { shift: true }); // belongs to the host
    expect(focusName(root)).toBe("none");

    press(root, "Tab", { shift: true });
    expect(focusName(root)).toBe("b1");
  });

  it("forgets the exit as soon as something is focused again", () => {
    const { root, buttons } = tree(2);
    installKeyboardTraversal(root, { wrap: false });
    buttons[1].focus();

    press(root, "Tab"); // leaves the tree
    buttons[0].focus(); // …and the application puts the focus back

    const event = press(root, "Tab");

    expect(focusName(root)).toBe("b1");
    expect(event.defaultPrevented).toBe(true);
  });

  it("still traverses inside the tree when wrapping is off", () => {
    const { root, buttons } = tree(2);
    installKeyboardTraversal(root, { wrap: false });
    buttons[0].focus();

    press(root, "Tab");

    expect(focusName(root)).toBe("b1");
  });

  // The `enabled` prune is the *walk's*, not `isTabbable`'s (2026-08-07): the
  // per-widget term was dead because `collectInto` never descends into a
  // disabled subtree, and this pins the behaviour the remaining rule provides.
  it("skips a disabled subtree, including the disabled node itself", () => {
    const { root, buttons } = tree(2);
    const nested = new Button({ name: "nested", focusable: true });
    buttons[0].add(nested);
    buttons[0].enabled = false;

    expect(collectFocusOrder(root).map((widget) => widget.name)).toEqual([
      "b1",
    ]);

    installKeyboardTraversal(root);
    press(root, "Tab");
    expect(focusName(root)).toBe("b1");
  });

  it("stops traversing once unsubscribed", () => {
    const { root } = tree(2);
    const stop = installKeyboardTraversal(root);

    stop();
    press(root, "Tab");

    expect(focusName(root)).toBe("none");
  });

  it("hears a keystroke delivered to a focused descendant", () => {
    const { root, buttons } = tree(2);
    installKeyboardTraversal(root);
    buttons[0].focus();

    // The event targets the button, not the root, and reaches the traversal
    // listener by bubbling (§72).
    const event = press(root, "Tab");

    expect(event.target).toBe(buttons[0]);
    expect(focusName(root)).toBe("b1");
  });
});
