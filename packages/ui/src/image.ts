/**
 * `ImageWidget` (§73's "image") — a box, a source key, and an intrinsic size
 * (2026-08-07, A-12).
 *
 * ```ts
 * const avatar = new ImageWidget({
 *   source: "textures/avatar.png",     // a §79 logical key, not a Texture
 *   naturalWidth: 64,
 *   naturalHeight: 64,
 * });
 * avatar.skin = textureSkin;           // resolves the key and draws the quad
 * ```
 *
 * ## What honesty allows this class to be
 *
 * §73 lists an image control, and the temptation is a widget that owns a
 * texture. It cannot: the frozen dependency matrix (plan §3.1) gives this
 * package no `render`, no `materials`, and no `assets`, so `Texture` is a type
 * it may not name and image *decoding* is not something it can do. What is left
 * is exactly what the {@link WidgetSkin} seam was drawn for, and it is not
 * nothing:
 *
 * | this widget owns | the skin owns |
 * | --- | --- |
 * | the box (§74), and the intrinsic size that comes from the source's natural size | the texture, the material, the quad |
 * | the **logical key** of the image (§79 references resources by key, never inline) | resolving that key through `@four/assets` |
 * | telling the skin when either changed | what "fit", "cover", and tinting mean |
 *
 * That is the same split `Label` already ships under: a label measures text it
 * cannot draw. An image widget measures an image it cannot draw. Both are
 * genuinely useful — a layout that reserves the right space for a picture
 * before the picture arrives is most of what an image control does in a UI —
 * and neither pretends to more.
 *
 * ## Natural size, and why the widget does not learn it by itself
 *
 * {@link ImageWidget.naturalWidth} and {@link ImageWidget.naturalHeight} are
 * supplied, not discovered: discovering them means loading the image, which is
 * `@four/assets`' job and this package's forbidden import. An application that
 * has loaded the texture writes both, the layout picks them up as §74's
 * "intrinsic text/image size", and until then the widget measures `0 × 0` —
 * the same honest answer a `Label` with no atlas gives. Give the widget an
 * explicit `width`/`height` and the question does not arise.
 *
 * ## The name
 *
 * `ImageWidget`, not `Image`, because `Image` is a global constructor in every
 * browser and `import { Image } from "@four/ui"` would shadow it in the very
 * files most likely to want both — the ones that load a picture and put it in a
 * UI. §73's name survives in the §79 document type (`ui:image`) and in the
 * documentation; the class carries the suffix so nothing has to be renamed at
 * the call site to keep the platform's `Image` reachable.
 */

import type { Vector2 } from "@four/math";

import { requireNonNegative } from "./numbers.js";
import { UIWidget, type UIWidgetOptions } from "./widget.js";

/** Construction options for an {@link ImageWidget}. */
export interface ImageWidgetOptions extends UIWidgetOptions {
  /** {@link ImageWidget.source}. Default `null`. */
  source?: string | null;
  /** {@link ImageWidget.naturalWidth}. Default `0`. */
  naturalWidth?: number;
  /** {@link ImageWidget.naturalHeight}. Default `0`. */
  naturalHeight?: number;
}

export class ImageWidget extends UIWidget {
  #source: string | null = null;
  #naturalWidth = 0;
  #naturalHeight = 0;

  constructor(options: ImageWidgetOptions = {}) {
    super(options);
    // A picture is inert data, like a label's text: not a pointer target unless
    // the application says so, so an image inside a button cannot steal the
    // hit.
    if (options.interactive === undefined) this.interactive = false;
    if (options.source !== undefined) this.#source = options.source;
    if (options.naturalWidth !== undefined) {
      this.#naturalWidth = requireNonNegative(
        "ImageWidget",
        "naturalWidth",
        options.naturalWidth,
      );
    }
    if (options.naturalHeight !== undefined) {
      this.#naturalHeight = requireNonNegative(
        "ImageWidget",
        "naturalHeight",
        options.naturalHeight,
      );
    }
  }

  /**
   * The logical key of the image to draw, or `null` for none (§79).
   *
   * A string, deliberately: it is what a §79 document can carry and what
   * `@four/assets` resolves. Assigning notifies the skin — the widget's box did
   * not move, so this is not a layout — and nothing else; swapping the picture
   * for one of a different size means writing the natural size too.
   */
  get source(): string | null {
    return this.#source;
  }

  set source(value: string | null) {
    if (value === this.#source) return;
    this.#source = value;
    this.notifyContentChange();
  }

  /**
   * The source image's own width in layout units — §74's intrinsic image size.
   *
   * @throws RangeError if not finite or negative (§85).
   */
  get naturalWidth(): number {
    return this.#naturalWidth;
  }

  set naturalWidth(value: number) {
    const next = requireNonNegative("ImageWidget", "naturalWidth", value);
    if (next === this.#naturalWidth) return;
    this.#naturalWidth = next;
    this.notifyContentChange();
  }

  /**
   * The source image's own height in layout units.
   *
   * @throws RangeError if not finite or negative (§85).
   */
  get naturalHeight(): number {
    return this.#naturalHeight;
  }

  set naturalHeight(value: number) {
    const next = requireNonNegative("ImageWidget", "naturalHeight", value);
    if (next === this.#naturalHeight) return;
    this.#naturalHeight = next;
    this.notifyContentChange();
  }

  /**
   * The natural size (§74 intrinsic size) — `(0, 0)` until one is supplied.
   *
   * Note that this is the *unscaled* size: a widget given an explicit `width`
   * and `height` uses those instead, and how the picture is fitted into a box
   * that does not match its aspect ratio is the skin's decision, not a field
   * here (see the header).
   */
  override measureIntrinsic(out: Vector2): void {
    out.set(this.#naturalWidth, this.#naturalHeight);
  }
}
