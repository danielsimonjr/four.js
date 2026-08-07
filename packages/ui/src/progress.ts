/**
 * `ProgressIndicator` (§73) — a value shown, never edited (2026-08-07, A-12).
 *
 * ```ts
 * const loading = new ProgressIndicator({ width: 240, height: 6, max: assets.total });
 * assets.on("progress", (done) => { loading.value = done; });
 * loading.skin = barSkin;                 // reads `loading.fraction`
 * ```
 *
 * ## Why it is not a `Slider` with the interaction removed
 *
 * They share arithmetic and nothing else. A slider is a control: it takes
 * focus, reads pointers and keys, has a step grid because a user has to be able
 * to land on a value, and refuses input when disabled. A progress indicator is
 * an **output**: §73 lists it beside the controls, but nothing about it is
 * driven by the user, so it is not focusable, not interactive (a pointer passes
 * straight through it to whatever is behind, exactly as it does through a
 * `Label`), and has no step — a load that is 37.2% done is 37.2% done.
 *
 * Sharing a base class would give every progress bar a focus path and a key
 * listener that must then be disabled, which is more code and more surface than
 * the two lines of range arithmetic they actually share (`numbers.ts`).
 *
 * ## Indeterminate
 *
 * {@link ProgressIndicator.indeterminate} says "something is happening, and the
 * fraction is meaningless" — the state §73's progress indicator needs for work
 * with no known total, and §75's `aria-valuenow`-less spinner. The widget keeps
 * carrying its value while indeterminate (setting the flag loses nothing) and
 * the skin decides what to draw; nothing here animates, because nothing in this
 * package has a clock (see `UI_STAGED` on the same blocker for tooltips).
 */

import { fractionOf, requireFinite } from "./numbers.js";
import { Panel, type PanelOptions } from "./panel.js";

/** Construction options for a {@link ProgressIndicator}. */
export interface ProgressIndicatorOptions extends PanelOptions {
  /** {@link ProgressIndicator.min}. Default `0`. */
  min?: number;
  /** {@link ProgressIndicator.max}. Default `1`. */
  max?: number;
  /** {@link ProgressIndicator.value}. Default the minimum. */
  value?: number;
  /** {@link ProgressIndicator.indeterminate}. Default `false`. */
  indeterminate?: boolean;
}

export class ProgressIndicator extends Panel {
  #min = 0;
  #max = 1;
  #value = 0;
  #indeterminate = false;

  constructor(options: ProgressIndicatorOptions = {}) {
    super(options);
    // Output, not input: a pointer passes through unless the application says
    // otherwise, and nothing here takes focus. (`Label`'s rule, for `Label`'s
    // reason.)
    if (options.interactive === undefined) this.interactive = false;
    if (options.min !== undefined) {
      this.#min = requireFinite("ProgressIndicator", "min", options.min);
    }
    if (options.max !== undefined) {
      this.#max = requireFinite("ProgressIndicator", "max", options.max);
    }
    if (this.#max < this.#min) {
      throw new RangeError(
        `ProgressIndicator: max (${String(this.#max)}) must be >= min ` +
          `(${String(this.#min)}) (§85).`,
      );
    }
    this.#value = this.#clamp(
      options.value !== undefined
        ? requireFinite("ProgressIndicator", "value", options.value)
        : this.#min,
    );
    if (options.indeterminate !== undefined) {
      this.#indeterminate = options.indeterminate;
    }
  }

  /** Lower bound of the range — the value at which nothing is done. */
  get min(): number {
    return this.#min;
  }

  /** @throws RangeError if not finite or greater than {@link ProgressIndicator.max} (§85). */
  set min(value: number) {
    requireFinite("ProgressIndicator", "min", value);
    if (value > this.#max) {
      throw new RangeError(
        `ProgressIndicator: min (${String(value)}) must be <= max ` +
          `(${String(this.#max)}) (§85).`,
      );
    }
    this.#min = value;
    this.value = this.#value;
  }

  /** Upper bound — the value at which the work is complete. */
  get max(): number {
    return this.#max;
  }

  /** @throws RangeError if not finite or less than {@link ProgressIndicator.min} (§85). */
  set max(value: number) {
    requireFinite("ProgressIndicator", "max", value);
    if (value < this.#min) {
      throw new RangeError(
        `ProgressIndicator: max (${String(value)}) must be >= min ` +
          `(${String(this.#min)}) (§85).`,
      );
    }
    this.#max = value;
    this.value = this.#value;
  }

  /**
   * How much is done, clamped into `[min, max]`. Emits `uivaluechange` and
   * notifies the skin when the clamped value actually changed.
   *
   * @throws RangeError if not finite (§85).
   */
  get value(): number {
    return this.#value;
  }

  set value(next: number) {
    requireFinite("ProgressIndicator", "value", next);
    const clamped = this.#clamp(next);
    if (clamped === this.#value) return;
    const previous = this.#value;
    this.#value = clamped;
    this.notifyContentChange();
    this.emit("uivaluechange", { widget: this, previous, current: clamped });
  }

  /**
   * Whether the fraction is meaningless — work is happening with no known
   * total. Notifies the skin on change; emits no `uivaluechange`, because the
   * value did not change.
   */
  get indeterminate(): boolean {
    return this.#indeterminate;
  }

  set indeterminate(value: boolean) {
    if (value === this.#indeterminate) return;
    this.#indeterminate = value;
    this.notifyContentChange();
  }

  /**
   * How far along the work is, in `[0, 1]` — what a skin fills a bar to. `0`
   * for an empty range, and **still answered while
   * {@link ProgressIndicator.indeterminate}**: the flag says the number means
   * nothing, and a skin that draws a spinner ignores it, but zeroing it here
   * would destroy the last known progress of a task that goes indeterminate
   * halfway through.
   */
  get fraction(): number {
    return fractionOf(this.#value, this.#min, this.#max);
  }

  /** `value` clamped into the range. There is no step grid — see the header. */
  #clamp(value: number): number {
    if (value > this.#max) return this.#max;
    if (value < this.#min) return this.#min;
    return value;
  }
}
