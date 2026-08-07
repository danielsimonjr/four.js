/**
 * `Button` (§73) — the one control in this MVP that *does* something: a §72
 * click becomes an activation.
 *
 * ```ts
 * const start = new Button({
 *   width: 160,
 *   height: 40,
 *   padding: 8,
 *   accessibility: { role: "button", label: "Start simulation", tabIndex: 0 },
 * });
 * start.add(new Label({ text: "Start", atlas, size: 16 }));
 * start.on("uiactivate", (event) => {
 *   simulation.start();          // event.source is "pointer" or "programmatic"
 * });
 * ```
 *
 * ## Why it is a `Panel`
 *
 * A button's content is a small layout — a label, sometimes an icon beside it —
 * and §74's flex/stack modes are exactly the arrangement that wants. Extending
 * `Panel` gives that for free and costs nothing: a button with one child and no
 * layout configured is an absolute container with one absolutely placed child,
 * which is what a plain button is. Hover, press, and focus come from `UIWidget`
 * and are not re-implemented here; this class adds activation and nothing else.
 *
 * A button is {@link UIWidget.focusable} by default (a panel is not) — it is a
 * control, and §75 asks for focus management over controls.
 *
 * ## Activation is exactly one event per click
 *
 * The `click` @four/input synthesizes is already the right predicate: a press
 * and a release on the same node with no drag between them (§72). So this class
 * listens for it once and emits `uiactivate` once — it does not re-derive the
 * gesture from `pointerdown`/`pointerup`, which would double-fire and would
 * disagree with the pointer source about what a drag is.
 *
 * A click that arrives on a child of the button bubbles up to it (§72's
 * Capture → Target → Bubble), so a click on the label inside a button activates
 * the button — once, because the event travels one path.
 *
 * ## Keyboard activation (2026-08-07, A-13)
 *
 * §75's other activation path, staged from 2026-08-02 until `@four/input`
 * gained the key source (A-10) that was its only blocker: **Enter or Space on
 * the focused button emits the same `uiactivate`**, with
 * `source: "keyboard"`. It is one listener, next to the click listener it
 * mirrors, and it goes through the same public {@link Button.activate} the
 * staging note promised a keyboard layer would call.
 *
 * Four decisions in it, each the DOM's:
 *
 * - **`event.target === this`.** Key events bubble (§72), so an ancestor button
 *   must not activate on a keystroke aimed at a focused descendant — the same
 *   target-scoping `UIWidget` applies to `pointerdown`/`pointerup`. Since
 *   `KeyboardInput` routes to the focused node, "the target" *is* "the focused
 *   control" in every ordinary wiring.
 * - **Repeats are ignored.** Holding Enter fires a stream of `keydown`s with
 *   `repeat: true`; a button that activated on each would fire dozens of times
 *   for one press, against this class's "exactly one event per activation
 *   gesture" contract. Traversal honours repeats (holding Tab keeps walking);
 *   activation does not.
 * - **Chords are ignored.** Control-Enter, Alt-Space, and Command-Enter mean
 *   something to the host or the application, not to a button. Shift is not in
 *   that list: Shift-Enter still activates, as it does on a DOM button.
 * - **The default is suppressed when — and only when — the keystroke was
 *   consumed**, so Space does not also scroll the host page after it activated
 *   a button, and *does* scroll it when the button refused (2026-08-07: the
 *   suppression used to run before {@link Button.activate} and therefore also
 *   swallowed the key for a disabled or disposed button, which emits nothing;
 *   a control that does nothing must not eat the host's key).
 *
 * Both keys act on `keydown`. The DOM distinguishes them (Enter activates on
 * key-down, Space on key-up, so a Space can be aborted by dragging off), and
 * this MVP does not: the abort gesture needs a pressed-by-keyboard state that
 * nothing else here has, and firing both on the same edge is the honest simple
 * version. Recorded as the deviation it is rather than mimicked halfway.
 */

import type { ScenePointerEvent, SceneKeyEvent } from "@four/input";

import { Panel, type PanelOptions } from "./panel.js";
import type { WidgetActivationSource } from "./widget.js";

/**
 * Whether `event` is a §75 activation keystroke: Enter or Space, un-chorded and
 * not auto-repeated.
 *
 * Space is matched on `key === " "` (its character) *and* on `code ===
 * "Space"` (its physical key), because a keyboard layout that puts something
 * else on the space bar is still a space bar, and because a source that
 * normalizes only one of the two fields should not silently lose the key.
 */
function isActivationKey(event: SceneKeyEvent): boolean {
  if (event.repeat) {
    return false;
  }
  const modifiers = event.modifiers;
  if (modifiers.alt || modifiers.ctrl || modifiers.meta) {
    return false;
  }
  return event.key === "Enter" || event.key === " " || event.code === "Space";
}

/** Construction options for a {@link Button}. */
export type ButtonOptions = PanelOptions;

export class Button extends Panel {
  constructor(options: ButtonOptions = {}) {
    super(options);
    // A control takes focus on press unless the application says otherwise.
    if (options.focusable === undefined) this.focusable = true;

    this.addSubscription(
      this.on("click", (event) => {
        if (!this.interactive) return;
        this.activate("pointer", event);
      }),
    );
    // §75's keyboard activation — see this module's header for each guard.
    // `interactive` is not consulted: it governs pointers, and a control the
    // mouse cannot reach is exactly the one a keyboard user still needs.
    this.addSubscription(
      this.on("keydown", (event) => {
        if (event.target !== this || !isActivationKey(event)) return;
        // Suppress the platform default exactly when the keystroke was
        // consumed — `activate` returns false for a disabled, disposed, or
        // disabled-by-`enabled` button, which emitted nothing.
        if (this.activate("keyboard")) event.preventDefault();
      }),
    );
  }

  /**
   * Emits `uiactivate` and returns whether it fired.
   *
   * Refused — returning `false`, emitting nothing — when the button is
   * disposed, {@link UIWidget.disabled}, or `enabled = false`. `interactive` is
   * deliberately **not** checked: it governs whether *pointers* reach the
   * widget, and neither a keyboard nor a programmatic activation is a pointer
   * (the click listener checks it before calling in).
   *
   * Public, and it stayed public: the keyboard layer this module's header
   * describes calls it with `"keyboard"`, and an application drives it with the
   * default `"programmatic"` — one path, one event, three sources.
   */
  activate(
    source: WidgetActivationSource = "programmatic",
    pointerEvent: ScenePointerEvent | null = null,
  ): boolean {
    if (this.disposed || this.disabled || !this.enabled) return false;
    this.emit("uiactivate", { widget: this, source, pointerEvent });
    return true;
  }
}
