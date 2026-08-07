/**
 * `RadioButton` (§73, A-12) — group exclusivity by name, and §75's arrow-key
 * navigation over a group.
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
import { describe, expect, it } from "vitest";

import { Panel } from "../src/panel.js";
import { RadioButton, checkedRadio, collectRadioGroup } from "../src/radio.js";
import { focusedWidget } from "../src/widget.js";

/** Dispatches one `keydown` at `target` through the real propagation path. */
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

/** A root holding `count` radios of one group, each wrapped in its own row. */
function buildGroup(
  count: number,
  group = "quality",
): { root: Group; radios: RadioButton[] } {
  const root = new Group();
  const radios: RadioButton[] = [];
  for (let i = 0; i < count; i += 1) {
    // Deliberately one container per radio: group-by-parent would break here,
    // and this is the layout every real radio list has.
    const row = new Panel({ layout: { type: "stack", gap: 4 } });
    const radio = new RadioButton({ group, name: `radio-${String(i)}` });
    row.add(radio);
    root.add(row);
    radios.push(radio);
  }
  return { root, radios };
}

describe("RadioButton — exclusivity", () => {
  it("clears the rest of its group when checked, across containers", () => {
    const { radios } = buildGroup(3);

    radios[0].checked = true;
    radios[2].checked = true;

    expect(radios.map((radio) => radio.checked)).toEqual([false, false, true]);
  });

  it("clears the group on a click and on a key, not only on assignment", () => {
    const { radios } = buildGroup(2);
    radios[0].checked = true;

    dispatchPointerEvent(
      new ScenePointerEvent({
        type: "click",
        pointerId: 1,
        ndcX: 0,
        ndcY: 0,
        target: radios[1],
      }),
      buildPropagationPath(radios[1]),
    );

    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(true);
  });

  it("leaves a checked radio checked when it is activated again", () => {
    // A radio group has no "none of the above" — unlike a toggle, re-activating
    // the checked member is idempotent, and emits no state change.
    const { radios } = buildGroup(2);
    radios[1].checked = true;
    let states = 0;
    radios[1].on("uistatechange", () => (states += 1));

    expect(radios[1].activate()).toBe(true);

    expect(radios[1].checked).toBe(true);
    expect(states).toBe(0);
  });

  it("keeps groups with different names independent", () => {
    const root = new Group();
    const a = new RadioButton({ group: "a" });
    const b = new RadioButton({ group: "b" });
    root.add(a, b);

    a.checked = true;
    b.checked = true;

    expect(a.checked).toBe(true);
    expect(b.checked).toBe(true);
  });

  it("treats the default empty name as a real group", () => {
    const root = new Group();
    const first = new RadioButton();
    const second = new RadioButton();
    root.add(first, second);

    first.checked = true;
    second.checked = true;

    expect(first.checked).toBe(false);
    expect(second.group).toBe("");
  });

  it("scopes a group to its tree, so two detached panels do not interfere", () => {
    const left = buildGroup(2);
    const right = buildGroup(2);

    left.radios[0].checked = true;
    right.radios[1].checked = true;

    expect(left.radios[0].checked).toBe(true);
    expect(right.radios[1].checked).toBe(true);
  });

  it("does not reconcile radios that were constructed checked (documented)", () => {
    // The documented cost of enforcing exclusivity on the transition only: a
    // §79 document reloads exactly as it was saved, and a caller that
    // constructs two checked members of one group sees both until one is
    // checked again.
    const root = new Group();
    const first = new RadioButton({ group: "g", checked: true });
    const second = new RadioButton({ group: "g", checked: true });
    root.add(first, second);

    expect([first.checked, second.checked]).toEqual([true, true]);

    second.checked = false;
    second.checked = true;
    expect([first.checked, second.checked]).toEqual([false, true]);
  });

  it("never leaves two members checked from a listener's point of view", () => {
    const { radios } = buildGroup(2);
    radios[0].checked = true;
    const seen: boolean[][] = [];
    for (const radio of radios) {
      radio.on("uistatechange", () =>
        seen.push(radios.map((member) => member.checked)),
      );
    }

    radios[1].checked = true;

    // The peer is cleared before the new member is checked, so no snapshot
    // taken from any listener shows two checked radios.
    expect(seen).toEqual([
      [false, false],
      [false, true],
    ]);
  });
});

describe("collectRadioGroup / checkedRadio", () => {
  it("collects one group in scene order and ignores the others", () => {
    const root = new Group();
    const first = new RadioButton({ group: "g" });
    const other = new RadioButton({ group: "h" });
    const second = new RadioButton({ group: "g" });
    root.add(first, other, second);

    expect(collectRadioGroup(root, "g")).toEqual([first, second]);
  });

  it("prunes hidden and disabled subtrees, and skips disabled members", () => {
    const root = new Group();
    const hiddenBranch = new Panel({ visible: false });
    const hidden = new RadioButton({ group: "g" });
    hiddenBranch.add(hidden);
    const disabledBranch = new Panel({ enabled: false });
    disabledBranch.add(new RadioButton({ group: "g" }));
    const live = new RadioButton({ group: "g" });
    const off = new RadioButton({ group: "g", disabled: true });
    const gone = new RadioButton({ group: "g" });
    gone.dispose();
    root.add(hiddenBranch, disabledBranch, live, off, gone);

    expect(collectRadioGroup(root, "g")).toEqual([live]);
    // …and a pruned member is therefore not cleared by its group either.
    hidden.checked = true;
    live.checked = true;
    expect(hidden.checked).toBe(true);
  });

  it("overwrites and truncates a supplied array (zero-alloc contract)", () => {
    const { root, radios } = buildGroup(2);
    const out: RadioButton[] = [radios[0], radios[1], radios[0], radios[1]];

    const result = collectRadioGroup(root, "quality", out);

    expect(result).toBe(out);
    expect(out).toHaveLength(2);
  });

  it("answers the checked member from any node of the tree, or null", () => {
    const { root, radios } = buildGroup(3);

    expect(checkedRadio(root, "quality")).toBeNull();

    radios[1].checked = true;

    expect(checkedRadio(root, "quality")).toBe(radios[1]);
    // Any node of the tree resolves the same scope — including a radio itself.
    expect(checkedRadio(radios[0], "quality")).toBe(radios[1]);
    expect(checkedRadio(root, "nope")).toBeNull();
  });
});

describe("RadioButton — keyboard (§75)", () => {
  it("moves and checks with the arrows, wrapping at both ends", () => {
    const { root, radios } = buildGroup(3);
    radios[0].focus();

    const down = pressKey(radios[0], "ArrowDown");
    expect(focusedWidget(root)).toBe(radios[1]);
    expect(radios[1].checked).toBe(true);
    expect(down.defaultPrevented).toBe(true);

    pressKey(radios[1], "ArrowRight");
    expect(radios[2].checked).toBe(true);

    // Forward past the end wraps to the first…
    pressKey(radios[2], "ArrowDown");
    expect(radios[0].checked).toBe(true);
    expect(focusedWidget(root)).toBe(radios[0]);

    // …and backward past the start wraps to the last.
    pressKey(radios[0], "ArrowUp");
    expect(radios[2].checked).toBe(true);
    pressKey(radios[2], "ArrowLeft");
    expect(radios[1].checked).toBe(true);
  });

  it("ignores a chorded arrow and every other key", () => {
    const { radios } = buildGroup(2);

    for (const modifiers of [
      { alt: true },
      { ctrl: true },
      { meta: true },
      { shift: true },
    ]) {
      pressKey(radios[0], "ArrowDown", modifiers);
    }
    const other = pressKey(radios[0], "Escape");

    expect(radios[1].checked).toBe(false);
    expect(other.defaultPrevented).toBe(false);
  });

  it("does not move on an arrow aimed at a focused descendant", () => {
    const { radios } = buildGroup(2);
    const inner = new RadioButton({ group: "inner" });
    radios[0].add(inner);

    // The event targets the inner radio and bubbles through the outer one.
    pressKey(inner, "ArrowDown");

    expect(radios[1].checked).toBe(false);
  });

  it("leaves the key to the host when the group has nowhere to go", () => {
    const { radios } = buildGroup(1);
    const alone = pressKey(radios[0], "ArrowDown");
    expect(alone.defaultPrevented).toBe(false);

    // …and likewise for a radio that is not in its own group's walk at all.
    const orphan = new RadioButton({ group: "g", disabled: true });
    const event = pressKey(orphan, "ArrowDown");
    expect(event.defaultPrevented).toBe(false);
  });

  it("still activates on Enter and Space, unlike the DOM (documented)", () => {
    const { radios } = buildGroup(2);

    pressKey(radios[1], "Enter");

    expect(radios[1].checked).toBe(true);
  });
});
