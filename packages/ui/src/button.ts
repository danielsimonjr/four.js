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
 * ## Keyboard activation (staged, 2026-08-02, P11-3)
 *
 * §75 requires keyboard navigation and activation, and `@four/input` ships **no
 * keyboard source at all** — §72 lists keyboard events and none are
 * implemented, so there is nothing here to listen to and inventing key codes in
 * a UI package would be guessing at an input API that does not exist yet. What
 * ships instead is the half that is real: {@link Button.activate} is public and
 * takes its source, so the packet that adds a keyboard layer calls
 * `button.activate("programmatic")` on Enter or Space and every existing
 * listener works unchanged. Focus — the other half of keyboard activation —
 * already works (see `UIWidget.focus`). Recorded in `UI_STAGED`.
 */

import type { ScenePointerEvent } from "@four/input";

import { Panel, type PanelOptions } from "./panel.js";
import type { WidgetActivationSource } from "./widget.js";

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
  }

  /**
   * Emits `uiactivate` and returns whether it fired.
   *
   * Refused — returning `false`, emitting nothing — when the button is
   * disposed, {@link UIWidget.disabled}, or `enabled = false`. `interactive` is
   * deliberately **not** checked: it governs whether *pointers* reach the
   * widget, and a programmatic activation is not a pointer (the click listener
   * checks it before calling in).
   *
   * Public so a future keyboard layer can drive it — see this module's header.
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
