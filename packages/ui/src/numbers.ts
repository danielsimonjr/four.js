/**
 * Numeric guards and range arithmetic shared by the §73 controls that carry a
 * value (2026-08-07, A-12).
 *
 * Package-internal: nothing here is exported from `index.ts`. It exists because
 * `Slider` and `ProgressIndicator` resolve a value into a range in exactly the
 * same way, and two copies of a clamp-then-snap rule is two chances for a
 * slider and a progress bar to disagree about what `value` means.
 *
 * The validation style is `Label`'s (§85): a `RangeError` naming the owner, the
 * field, and the value, thrown at the assignment rather than absorbed. A UI
 * control given `NaN` for a bound has no defensible behaviour — every later
 * comparison would silently answer `false` — so the error is raised where the
 * mistake is.
 */

/** Throws unless `value` is a finite number. Returns it. */
export function requireFinite(
  owner: string,
  name: string,
  value: number,
): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `${owner}: ${name} must be a finite number; got ${String(value)} (§85).`,
    );
  }
  return value;
}

/** Throws unless `value` is a finite number `>= 0`. Returns it. */
export function requireNonNegative(
  owner: string,
  name: string,
  value: number,
): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${owner}: ${name} must be a finite number >= 0; ` +
        `got ${String(value)} (§85).`,
    );
  }
  return value;
}

/**
 * `value` clamped into `[min, max]` and, when `step > 0`, snapped onto the grid
 * `min + n · step`.
 *
 * The order is clamp, snap, and then **step back down** if the snap rounded up
 * past the maximum — because the answer must be a legal value, and the two
 * naive orders each produce one that is not:
 *
 * | order | `[0, 10]`, `step: 3`, value 100 |
 * | --- | --- |
 * | snap then clamp | 99 → **10**, which is not on the grid the author declared |
 * | clamp then snap | 10 → **12**, which is outside the range |
 * | clamp, snap, step back ✅ | 10 → 12 → **9** |
 *
 * A step that does not divide the range therefore leaves the top of that range
 * **unreachable**: the grid of `[0, 10]` with `step: 3` is `0, 3, 6, 9`, and
 * dragging to the far end reports 9. That is exactly what
 * `<input type=range min=0 max=10 step=3>` does, and it is the honest reading
 * of a step — the author said which values are legal, and 10 is not one of
 * them. An author who wants the end reachable picks a step that divides the
 * range.
 *
 * Stepping back down can never undershoot: the grid is anchored at `min`, so
 * the smallest snapped value is `min` itself and only a value of `min + k·step`
 * with `k >= 1` is ever stepped back. A step wider than the whole range
 * therefore collapses to `min`, which is the one legal value such a control
 * has.
 */
export function resolveValue(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  let resolved = value;
  if (resolved > max) resolved = max;
  if (resolved < min) resolved = min;
  if (step > 0) {
    resolved = min + Math.round((resolved - min) / step) * step;
    if (resolved > max) resolved -= step;
  }
  return resolved;
}

/**
 * Where `value` sits in `[min, max]`, as a fraction in `[0, 1]` — the one
 * number a skin needs to draw a track, a fill, or a handle.
 *
 * An empty range (`max === min`) answers `0` rather than dividing: a control
 * whose bounds coincide has one value, and it is at the start.
 */
export function fractionOf(value: number, min: number, max: number): number {
  const span = max - min;
  return span > 0 ? (value - min) / span : 0;
}
