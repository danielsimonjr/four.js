/**
 * §67 rectangular scissor clipping — a per-draw axis-aligned rectangle in
 * drawing-buffer pixels, cheaper than a stencil mask and only for that case.
 *
 * The view already sets a scissor from `view.rect`. A per-item rectangle
 * **intersects** that view rect; after the draw the backend restores the view
 * rect. Default-off: a scene that never names a scissor issues the same
 * scissor calls it issued before this module existed.
 *
 * Coordinates match §48 / §7a: origin at the **bottom-left**, +Y up. A
 * backend whose native rectangle is top-left (WebGPU) flips on the way in,
 * exactly as it already flips the view rect.
 */

/** Axis-aligned rectangle in drawing-buffer pixels (bottom-left, +Y up). */
export interface ScissorRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Whether two optional scissors are the same rectangle.
 *
 * `undefined` and `null` both mean "no per-item scissor" — the R-23 optional
 * field move. Identity is accepted first so a snapshotted node rectangle
 * compares in one load; value equality covers two independently written
 * records with the same numbers so a batch run is not split by accident.
 */
export function scissorsEqual(
  left: ScissorRect | null | undefined,
  right: ScissorRect | null | undefined,
): boolean {
  const a = left ?? null;
  const b = right ?? null;
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/**
 * Intersection of the view scissor and a per-item scissor, extents clamped
 * at zero. Empty means the item cannot contribute a pixel in this view.
 */
export function intersectScissor(
  view: ScissorRect,
  item: ScissorRect,
): ScissorRect {
  const x = Math.max(view.x, item.x);
  const y = Math.max(view.y, item.y);
  const right = Math.min(view.x + view.width, item.x + item.width);
  const top = Math.min(view.y + view.height, item.y + item.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, top - y),
  };
}
