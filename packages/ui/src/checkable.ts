/**
 * `Toggle` and `Checkbox` (§73), over the checkable base they share
 * (2026-08-07, A-12).
 *
 * ```ts
 * const mute = new Checkbox({
 *   width: 20,
 *   height: 20,
 *   checked: true,
 *   accessibility: { role: "checkbox", label: "Mute" },
 * });
 * mute.on("uistatechange", (event) => {
 *   if (event.previous.checked !== event.current.checked) audio.muted = mute.checked;
 * });
 * ```
 *
 * ## A checkable control is a button that does something to itself
 *
 * §72's `click`, §75's Enter and Space, focus, hover, press, and the refusal
 * rules for a disabled control are all `Button`'s already, and re-deriving any
 * of them here would be a second implementation that could disagree. So
 * {@link CheckableWidget} extends `Button` and adds exactly one thing: it
 * overrides {@link Button.willActivate} to flip its own checkedness, which runs
 * after the activation is accepted and before `uiactivate` is emitted. A
 * listener therefore reads the state the click produced, as in the DOM.
 *
 * ## Checkedness is a §75 state, not a value
 *
 * It rides {@link WidgetStateSnapshot.checked} and is published by
 * `uistatechange` — the same event, the same skin hook (`onStateChange`), and
 * the same no-change suppression as hover, press, focus, and disabled. There is
 * deliberately no separate `uicheckedchange`: a mirror that already listens for
 * state transitions must not have to learn a second event to hear the one
 * transition §75 names for a checkbox, and `previous.checked !== current.checked`
 * is the whole test.
 *
 * A widget that is not checkable answers `null` rather than `false` — see
 * {@link UIWidget.checked} for why.
 *
 * ## Why both classes exist
 *
 * §73 lists "toggle (switch)" and "checkbox" as separate controls, and their
 * engine state really is identical: one boolean, flipped by activation. What
 * differs is what the two *mean* — a switch applies immediately, a checkbox
 * states a choice — and therefore the §75 role an application assigns
 * (`"switch"` against `"checkbox"`) and what a skin draws (a sliding thumb
 * against a tick). A skin switches on the class, so the class identity is the
 * distinction, and collapsing them into one class with a `variant` string would
 * make every skin re-implement the switch this package already gives it for
 * free.
 *
 * Neither class fills in {@link WidgetAccessibility} for you. The record stays
 * exactly what the application authored (§75) — a control that silently
 * invented its own role would be the one place in this package where the
 * accessibility data has two authors.
 */

import { Button, type ButtonOptions } from "./button.js";

/** Construction options shared by the checkable controls. */
export interface CheckableWidgetOptions extends ButtonOptions {
  /** {@link CheckableWidget.checked}. Default `false`. */
  checked?: boolean;
}

/**
 * The state and the activation behaviour behind {@link Toggle},
 * {@link Checkbox}, and `RadioButton`.
 *
 * Abstract because "a checkable control" is not itself one of §73's controls:
 * every concrete class below names one that §73 does list. Exported so an
 * application can add its own (a tri-state checkbox, a segmented button) and so
 * a skin can narrow with `instanceof`.
 */
export abstract class CheckableWidget extends Button {
  #checked = false;

  constructor(options: CheckableWidgetOptions = {}) {
    super(options);
    // Assigned to the field rather than through the setter: a constructor has
    // no previous state to publish, no skin yet, and no peers to reconcile —
    // and a `RadioButton` restored from a §79 document must come back exactly
    // as it was saved (see `RadioButton` on why exclusivity is a transition).
    if (options.checked !== undefined) this.#checked = options.checked;
  }

  /** Whether this control is checked (§75). Never `null` for a checkable one. */
  override get checked(): boolean {
    return this.#checked;
  }

  /**
   * Sets the checkedness, emitting `uistatechange` when it actually changed.
   *
   * Programmatic and unconditional: unlike an activation it is refused by
   * nothing, because setting the state of a disabled control is how an
   * application restores one, and refusing it would silently desynchronize the
   * widget from the model it mirrors.
   */
  set checked(value: boolean) {
    if (value === this.#checked) return;
    if (value) this.beforeChecked();
    this.captureState();
    this.#checked = value;
    this.publishState();
  }

  /**
   * Runs immediately before this control becomes checked, whatever caused it —
   * a click, a key, or an assignment. A no-op here.
   *
   * `RadioButton` overrides it to clear its group, which is why it runs
   * *before* the flip: the peers are already off when this control's
   * `uistatechange` goes out, so a listener never sees two checked radios.
   */
  protected beforeChecked(): void {
    // Nothing to reconcile for an independent control.
  }

  /**
   * Flips the checkedness — the activation behaviour of an independent
   * checkable control (§72 click, §75 Enter/Space, or `activate()`).
   */
  protected override willActivate(): void {
    this.checked = !this.#checked;
  }
}

/** Construction options for a {@link Toggle}. */
export type ToggleOptions = CheckableWidgetOptions;

/**
 * §73's **toggle (switch)** — a control whose activation applies immediately.
 *
 * State-identical to {@link Checkbox}; see this module's header for why both
 * ship. Give it `accessibility: { role: "switch", label: … }` (§75).
 */
export class Toggle extends CheckableWidget {}

/** Construction options for a {@link Checkbox}. */
export type CheckboxOptions = CheckableWidgetOptions;

/**
 * §73's **checkbox** — a control that states a choice.
 *
 * State-identical to {@link Toggle}; see this module's header. Give it
 * `accessibility: { role: "checkbox", label: … }` (§75).
 *
 * There is no indeterminate ("mixed") state at this tier: it is a third value
 * with its own §75 vocabulary and its own activation rule (a click leaves
 * mixed and never returns to it), and inventing half of that would be worse
 * than not having it. A tri-state control subclasses {@link CheckableWidget}.
 */
export class Checkbox extends CheckableWidget {}
