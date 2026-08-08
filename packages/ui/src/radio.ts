/**
 * `RadioButton` (§73's "radio control") and its group mechanism (2026-08-07,
 * A-12).
 *
 * ```ts
 * const quality = new Panel({ layout: { type: "stack", direction: "column", gap: 4 } });
 * for (const name of ["low", "medium", "high"]) {
 *   quality.add(new RadioButton({
 *     group: "quality",
 *     checked: name === "medium",
 *     accessibility: { role: "radio", label: name },
 *   }));
 * }
 * quality.on("uistatechange", () => render.quality = checkedRadio(quality, "quality")?.name);
 * ```
 *
 * ## The group is a name, resolved by a walk — not the parent, not an object
 *
 * A radio group is "at most one checked among these", and the question is what
 * "these" means. Three candidates were on the table:
 *
 * | mechanism | why not |
 * | --- | --- |
 * | **group by parent** — siblings form a group | a group's membership would be a *layout* fact. The moment a designer wraps each radio in a row panel to put a label beside it — which is what `Panel` exists for — every radio becomes an only child and the exclusivity silently disappears. Semantics that break when you add a container are not semantics. |
 * | **an explicit `RadioGroup` object or §6a component** | §6a components attach to a node and are keyed by class, so the group would live on some container node, and every radio would need a reference to it or an ancestor walk to find it. It also adds a component class with a `static typeName`, which §79 then has to serialize — real cost for a rule that is one string long. |
 * | **a group *name*, scoped to the tree** ✅ | what ships. |
 *
 * The name is {@link RadioButton.group}, and the scope is the **topmost node of
 * the tree the radio is in** — exactly the scope {@link focusedWidget} uses for
 * "one focused widget per scene root", so this package has one notion of "the
 * tree we are in" rather than two. Two groups nest by having different names;
 * two independent copies of the same UI nest by being separate trees, which is
 * what a detached panel already is.
 *
 * Membership is resolved by walking the tree at the instant a radio is checked
 * ({@link collectRadioGroup}), not by a registry. A registry would have to be
 * maintained across `add`, `remove`, `dispose`, and reparenting — four chances
 * to leak a dead radio or lose a live one — to save a walk that happens at
 * human rates over a handful of nodes. The walk prunes at `visible = false` and
 * `enabled = false` exactly as `collectPickables` and `collectFocusOrder` do,
 * so a hidden panel's radios are not part of anybody's group.
 *
 * ## Exclusivity is enforced on the transition, and only there
 *
 * Checking a radio — by click, by key, by `activate()`, or by assignment —
 * clears every other radio of its group first. Nothing is enforced at
 * construction or on `add`, which is deliberate: a §79 document that saved one
 * checked radio must reload as exactly that, and a rule that ran on attachment
 * would let the *order the tree was rebuilt in* decide which radio survives.
 * The cost is that an application which constructs two radios of one group both
 * `checked: true` gets two checked radios until one of them is checked again.
 * That is a bug in the caller, it is visible immediately, and the alternative
 * silently rewrites a restored document.
 *
 * ## Keyboard (§75)
 *
 * Arrow keys move **and** check within the group, wrapping at both ends —
 * Down/Right forward, Up/Left backward, which is the DOM's radio-group
 * behaviour and the one users have. Enter and Space check the focused radio
 * (inherited from `Button`); a checked radio re-activated stays checked, since
 * a radio group has no "off".
 *
 * Two deviations from the DOM, recorded rather than mimicked halfway:
 *
 * - **The group stays in the Tab order in full.** The DOM makes a radio group
 *   one tab stop by giving the unchecked members `tabindex="-1"`. That is a
 *   property of `accessibility.tabIndex`, which is data an application owns
 *   here (§75) — so the same result is one line per radio, and forcing it would
 *   mean this package writing into the record it promises is the author's.
 * - **Enter activates**, as it does on every control in this engine. The DOM
 *   reserves Enter for form submission, and there are no forms here.
 */

import type { SceneKeyEvent } from "@four/input";
import type { Node } from "@four/scene";

import { CheckableWidget, type CheckableWidgetOptions } from "./checkable.js";

/** Construction options for a {@link RadioButton}. */
export interface RadioButtonOptions extends CheckableWidgetOptions {
  /** {@link RadioButton.group}. Default `""`. */
  group?: string;
}

/** The topmost ancestor of `node` — `node` itself when it is a root. */
function scopeRootOf(node: Node): Node {
  let root: Node = node;
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    root = parent;
  }
  return root;
}

/** Whether a group walk includes `radio`. */
function isGroupMember(radio: RadioButton, group: string): boolean {
  return radio.group === group && !radio.disabled && !radio.disposed;
}

/** Depth-first fill of {@link collectRadioGroup}; returns the next free index. */
function collectInto(
  node: Node,
  group: string,
  out: RadioButton[],
  start: number,
): number {
  if (!node.visible || !node.enabled) {
    return start;
  }
  let count = start;
  if (node instanceof RadioButton && isGroupMember(node, group)) {
    out[count] = node;
    count += 1;
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    count = collectInto(children[i], group, out, count);
  }
  return count;
}

/**
 * Collects the members of one radio group under `root` into `out`, in **scene
 * order**, and returns it.
 *
 * A radio joins when its {@link RadioButton.group} matches, it is not disabled,
 * and it is not disposed; the walk prunes at any node that is `visible = false`
 * or `enabled = false`, so a hidden branch contributes nobody. Scene order —
 * not `tabIndex` order — because this is the order arrow keys move in and the
 * order a group reads in; a group whose keyboard order disagreed with its
 * visual order would be a worse bug than one that ignores an author's
 * `tabIndex`.
 *
 * Zero-alloc when `out` is supplied: it is overwritten and truncated.
 */
export function collectRadioGroup(
  root: Node,
  group: string,
  out: RadioButton[] = [],
): RadioButton[] {
  const count = collectInto(root, group, out, 0);
  out.length = count;
  return out;
}

/**
 * The checked member of `group` in `root`'s tree, or `null` — the question an
 * application actually asks a radio group.
 *
 * Takes any node of the tree, like {@link focusedWidget}: the walk starts at
 * the scope root, so `checkedRadio(anyRadio, "quality")` and
 * `checkedRadio(scene, "quality")` answer the same.
 */
export function checkedRadio(node: Node, group: string): RadioButton | null {
  const members = collectRadioGroup(scopeRootOf(node), group);
  for (let i = 0; i < members.length; i += 1) {
    if (members[i].checked) return members[i];
  }
  return null;
}

/** Whether `event` is an un-chorded arrow key this control acts on. */
function arrowStep(event: SceneKeyEvent): -1 | 0 | 1 {
  const modifiers = event.modifiers;
  if (modifiers.alt || modifiers.ctrl || modifiers.meta || modifiers.shift) {
    return 0;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowRight") return 1;
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") return -1;
  return 0;
}

/**
 * §73's radio control: a checkable widget that is exclusive within its group.
 *
 * See this module's header for the group mechanism, the exclusivity rule, and
 * the keyboard behaviour. Give it `accessibility: { role: "radio", label: … }`
 * (§75).
 */
export class RadioButton extends CheckableWidget {
  /**
   * The name of the group this radio belongs to; `""` by default, which is a
   * real group like any other — every radio in one tree that names no group is
   * mutually exclusive with the rest.
   *
   * A plain mutable field: moving a radio between groups is renaming it, and
   * doing so does not reconcile anything (the radio keeps whatever checkedness
   * it had, in its new group). Reconcile explicitly by checking the member that
   * should win.
   */
  group: string;

  constructor(options: RadioButtonOptions = {}) {
    super(options);
    this.group = options.group ?? "";
    this.addSubscription(
      this.on("keydown", (event) => {
        this.#handleArrow(event);
      }),
    );
  }

  /**
   * Checks this radio. Unlike a toggle's, a radio's activation is idempotent:
   * a group has no "none of the above" that clicking the checked member should
   * fall back to, so re-activating it leaves it checked (and emits no
   * `uistatechange`, since nothing changed) while still emitting `uiactivate`.
   */
  protected override willActivate(): void {
    this.checked = true;
  }

  /** Clears the rest of the group — see the header on why this is a transition. */
  protected override beforeChecked(): void {
    const members = collectRadioGroup(scopeRootOf(this), this.group);
    for (let i = 0; i < members.length; i += 1) {
      const member = members[i];
      if (member !== this) member.checked = false;
    }
  }

  /**
   * Moves the focus to the next or previous member of the group and checks it
   * (§75).
   *
   * Target-scoped like every other key listener in this package: an arrow aimed
   * at a focused descendant is that descendant's business. Auto-repeat is
   * honoured — holding an arrow walks the group, as holding Tab walks the
   * traversal — and the platform default is suppressed only when a move
   * actually happened, so an arrow that hit a one-member group still scrolls
   * the host.
   */
  #handleArrow(event: SceneKeyEvent): void {
    if (event.target !== this) return;
    const step = arrowStep(event);
    if (step === 0) return;

    const members = collectRadioGroup(scopeRootOf(this), this.group);
    const from = members.indexOf(this);
    if (from === -1 || members.length < 2) return;

    const next = members[(from + step + members.length) % members.length];
    next.focus();
    next.checked = true;
    event.preventDefault();
  }
}
