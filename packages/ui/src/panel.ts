/**
 * `Panel` (§73) and the layout engine (§74) — the container widget, and the
 * three layout modes this MVP resolves.
 *
 * ```ts
 * const panel = new Panel({
 *   layout: { type: "flex", direction: "column", gap: 12, padding: 20 },
 * });
 * ```
 *
 * That is §74's example verbatim, and it is why the modes here are named the way
 * §74 names them rather than being renamed to something narrower: what ships is
 * a real subset of flex (single line, growth, justification, cross alignment),
 * not a different algorithm wearing flex's label. What does **not** ship —
 * wrapping, shrink factors, grid, and constraints — is listed with dates in
 * `UI_STAGED`.
 *
 * ## The three modes
 *
 * | mode         | children are placed by                                   |
 * | ------------ | -------------------------------------------------------- |
 * | `"absolute"` | their own `anchor`, `pivot`, and `offset` (§74 absolute + anchor) |
 * | `"stack"`    | packing along one axis, with `gap` (§74 stack)            |
 * | `"flex"`     | the same packing, plus `grow` and `justify` (§74 flex)    |
 *
 * `"stack"` is `"flex"` with growth switched off; both are listed by §74, and
 * one is genuinely simpler to reason about than the other, so both are spelled.
 *
 * ## Two passes
 *
 * `measure()` runs bottom-up: children first, then this panel's intrinsic size
 * from what they reported. `arrange()` runs top-down: this panel's content box
 * is known, so each child gets a position — and, under `grow` or
 * `align: "stretch"`, a revised size — before arranging its own children. That
 * is the ordering every retained layout engine uses, and it is why an intrinsic
 * size can never depend on a position.
 *
 * The one place it bends is absolute mode: a child's anchor resolves against the
 * parent's content box, and an auto-sized parent's content box is derived from
 * its children — a cycle. It is cut by **measuring absolute children as if every
 * anchor were `(0, 0)`** (extent = `offset + size`), so an auto-sized absolute
 * panel fits the top-left-anchored layout of its children and the anchors then
 * resolve against that size. Give the panel an explicit `width`/`height` and the
 * question does not arise. (Decision, WP-11.3.)
 *
 * ## Coordinates
 *
 * Everything below is in the top-left-origin, y-down frame described in
 * `widget.ts`: `main` runs left→right for a row and top→bottom for a column, and
 * the single negation into Y-up world space happens in
 * `UIWidget.applyLayout`.
 *
 * ## Allocation
 *
 * None. Three index loops over `children`, all arithmetic in locals.
 */

import type { Vector2 } from "@four/math";

import {
  UIWidget,
  applyInsets,
  type InsetsInit,
  type UIWidgetOptions,
} from "./widget.js";

/** §74's layout modes, restricted to the three this tier resolves. */
export type LayoutType = "absolute" | "stack" | "flex";

/** Main axis of a stack or flex container. */
export type LayoutDirection = "row" | "column";

/**
 * How leftover main-axis space is distributed between children (§74 flex).
 * Applied only when there **is** leftover space; an overflowing line always
 * packs from the start.
 */
export type LayoutJustify = "start" | "center" | "end" | "space-between";

/**
 * How children are placed on the cross axis. `"stretch"` resizes each child to
 * the content box's cross extent minus that child's margins, then clamps it by
 * the child's own min/max.
 */
export type LayoutAlign = "start" | "center" | "end" | "stretch";

/** §74's `layout` record. Every field is optional and keeps its current value. */
export interface PanelLayout {
  /** {@link Panel.layoutType}. */
  type?: LayoutType;
  /** {@link Panel.direction}. */
  direction?: LayoutDirection;
  /** {@link Panel.gap}. */
  gap?: number;
  /** Written into `UIWidget.padding` — §74's example puts padding here. */
  padding?: InsetsInit;
  /** {@link Panel.justify}. */
  justify?: LayoutJustify;
  /** {@link Panel.align}. */
  align?: LayoutAlign;
}

/** Construction options for a {@link Panel}. */
export interface PanelOptions extends UIWidgetOptions {
  /** Layout configuration, in §74's shape. */
  layout?: PanelLayout;
}

/**
 * A container widget (§73) that lays its widget children out (§74).
 *
 * Non-widget children — a skin's quads, a `Group`, anything else — are left
 * exactly where they are: layout is a contract between widgets, and a skin's
 * nodes are positioned by the skin.
 *
 * Children with `enabled = false` are excluded from layout entirely and occupy
 * no space (the DOM's `display: none`); `visible = false` still reserves space
 * (`visibility: hidden`).
 */
export class Panel extends UIWidget {
  /** Which of §74's modes places this panel's children. Default `"absolute"`. */
  layoutType: LayoutType = "absolute";

  /** Main axis for stack and flex. Default `"row"`. */
  direction: LayoutDirection = "row";

  /** Space **between** adjacent children, in layout units. Default `0`. */
  gap = 0;

  /** Main-axis distribution of leftover space. Default `"start"`. */
  justify: LayoutJustify = "start";

  /** Cross-axis placement. Default `"start"`. */
  align: LayoutAlign = "start";

  constructor(options: PanelOptions = {}) {
    super(options);
    if (options.layout !== undefined) {
      this.setLayout(options.layout);
    }
  }

  /**
   * Applies a §74 layout record. Omitted fields keep their current value, so
   * `panel.setLayout({ gap: 4 })` changes only the gap. Returns `this`.
   */
  setLayout(layout: PanelLayout): this {
    if (layout.type !== undefined) this.layoutType = layout.type;
    if (layout.direction !== undefined) this.direction = layout.direction;
    if (layout.gap !== undefined) this.gap = layout.gap;
    if (layout.padding !== undefined) applyInsets(this.padding, layout.padding);
    if (layout.justify !== undefined) this.justify = layout.justify;
    if (layout.align !== undefined) this.align = layout.align;
    return this;
  }

  /**
   * The size this panel needs to hold its children, plus its padding — §74's
   * intrinsic sizing, used whenever `width`/`height` is `null`.
   */
  override measureIntrinsic(out: Vector2): void {
    if (this.layoutType === "absolute") {
      this.#measureAbsolute(out);
      return;
    }
    this.#measureLinear(out);
  }

  /** Places every enabled widget child, then lets each arrange its own. */
  override arrange(): void {
    if (this.layoutType === "absolute") {
      this.#arrangeAbsolute();
      return;
    }
    this.#arrangeLinear();
  }

  // --- absolute (§74 absolute + anchor) --------------------------------------

  #measureAbsolute(out: Vector2): void {
    let width = 0;
    let height = 0;
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof UIWidget) || !child.enabled) continue;
      const right = child.offset.x + child.measuredWidth;
      const bottom = child.offset.y + child.measuredHeight;
      if (right > width) width = right;
      if (bottom > height) height = bottom;
    }
    out.set(width + this.padding.horizontal, height + this.padding.vertical);
  }

  #arrangeAbsolute(): void {
    const contentWidth = this.contentWidth;
    const contentHeight = this.contentHeight;
    const originLeft = this.padding.left;
    const originTop = this.padding.top;
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof UIWidget) || !child.enabled) continue;
      const left =
        originLeft +
        child.anchor.x * contentWidth -
        child.pivot.x * child.measuredWidth +
        child.offset.x;
      const top =
        originTop +
        child.anchor.y * contentHeight -
        child.pivot.y * child.measuredHeight +
        child.offset.y;
      child.applyLayout(left, top);
    }
  }

  // --- stack and flex (§74) ---------------------------------------------------

  #measureLinear(out: Vector2): void {
    const row = this.direction === "row";
    let main = 0;
    let cross = 0;
    let count = 0;
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof UIWidget) || !child.enabled) continue;
      const outerWidth = child.measuredWidth + child.margin.horizontal;
      const outerHeight = child.measuredHeight + child.margin.vertical;
      main += row ? outerWidth : outerHeight;
      const outerCross = row ? outerHeight : outerWidth;
      if (outerCross > cross) cross = outerCross;
      count += 1;
    }
    if (count > 1) {
      main += this.gap * (count - 1);
    }
    out.set(
      (row ? main : cross) + this.padding.horizontal,
      (row ? cross : main) + this.padding.vertical,
    );
  }

  #arrangeLinear(): void {
    const row = this.direction === "row";
    const children = this.children;

    let count = 0;
    let totalGrow = 0;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof UIWidget) || !child.enabled) continue;
      count += 1;
      if (child.grow > 0) totalGrow += child.grow;
    }
    if (count === 0) return;

    const contentMain = row ? this.contentWidth : this.contentHeight;
    const contentCross = row ? this.contentHeight : this.contentWidth;
    const gapTotal = this.gap * (count - 1);

    let free = contentMain - gapTotal - this.#totalOuterMain(row);

    // §74 flex growth. A child clamped by its own `maxWidth`/`maxHeight` cannot
    // absorb its share, so the leftover is re-derived from the sizes the
    // children actually took rather than assumed to be zero — otherwise a
    // `justify` would silently ignore space that is genuinely still free.
    if (this.layoutType === "flex" && free > 0 && totalGrow > 0) {
      const share = free / totalGrow;
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (!(child instanceof UIWidget) || !child.enabled || child.grow <= 0) {
          continue;
        }
        const extra = share * child.grow;
        if (row) {
          child.setMeasuredSize(
            child.measuredWidth + extra,
            child.measuredHeight,
          );
        } else {
          child.setMeasuredSize(
            child.measuredWidth,
            child.measuredHeight + extra,
          );
        }
      }
      free = contentMain - gapTotal - this.#totalOuterMain(row);
    }

    let cursor = row ? this.padding.left : this.padding.top;
    const crossStart = row ? this.padding.top : this.padding.left;
    let spacing = this.gap;
    if (free > 0) {
      if (this.justify === "center") {
        cursor += free / 2;
      } else if (this.justify === "end") {
        cursor += free;
      } else if (this.justify === "space-between" && count > 1) {
        spacing += free / (count - 1);
      }
    }

    const align = this.align;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof UIWidget) || !child.enabled) continue;
      const margin = child.margin;

      if (align === "stretch") {
        const target =
          contentCross - (row ? margin.vertical : margin.horizontal);
        if (row) {
          child.setMeasuredSize(child.measuredWidth, target);
        } else {
          child.setMeasuredSize(target, child.measuredHeight);
        }
      }

      const outerMain = row
        ? child.measuredWidth + margin.horizontal
        : child.measuredHeight + margin.vertical;
      const outerCross = row
        ? child.measuredHeight + margin.vertical
        : child.measuredWidth + margin.horizontal;

      let cross = crossStart;
      if (align === "center") {
        cross += (contentCross - outerCross) / 2;
      } else if (align === "end") {
        cross += contentCross - outerCross;
      }

      const mainPosition = cursor + (row ? margin.left : margin.top);
      const crossPosition = cross + (row ? margin.top : margin.left);
      if (row) {
        child.applyLayout(mainPosition, crossPosition);
      } else {
        child.applyLayout(crossPosition, mainPosition);
      }

      cursor += outerMain + spacing;
    }
  }

  /** Sum of the children's outer main-axis extents, excluding gaps. */
  #totalOuterMain(row: boolean): number {
    let total = 0;
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof UIWidget) || !child.enabled) continue;
      total += row
        ? child.measuredWidth + child.margin.horizontal
        : child.measuredHeight + child.margin.vertical;
    }
    return total;
  }
}
