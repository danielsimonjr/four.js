/**
 * `CanvasViewWidget` (§73's "canvas view"; RFC 0004, accepted 2026-08-21) — a
 * box, a device-pixel backing size, and a content revision. The application
 * draws here; the widget never does.
 *
 * ```ts
 * const view = new CanvasViewWidget({ width: 200, height: 120, resolution: 2 });
 * view.skin = canvasSkin;        // the app's skin owns the §77a texture
 * root.layout();                 // view.pixelWidth === 400, pixelHeight === 240
 * view.invalidate();             // "repaint me" → contentVersion + onContentChange
 * ```
 *
 * ## The recorded blocker was wrong, and this class is the correction
 *
 * `UI_STAGED` said the canvas view "needs the immediate-mode drawing surface
 * the dependency matrix keeps out of this package". Read against what this
 * package already ships, the premise does not hold: **the widget does not
 * draw, and never should** (RFC 0004 §2b). `ImageWidget` established the split
 * — the widget owns the box, the intrinsic size, and the logical identity of
 * its content; the {@link WidgetSkin} owns the texture, the material, and the
 * quad, because the skin is application code that can see `@four/render` while
 * this package cannot. A canvas view is `ImageWidget` with two differences:
 * its content has no logical key (the application paints it), and its content
 * changes (so it must say when). Both are expressible with what `@four/ui`
 * has, so this class names no texture type, adds no dependency, and would
 * compile against nothing §77a provides — an application could even pair it
 * with a hand-rolled repaint recipe (RFC 0004 Q4, adopted).
 *
 * **No new skin hook.** A repaint request is content with no layout and no
 * state transition, which is precisely {@link WidgetSkin.onContentChange}'s
 * A-12 category. The skin holds the §77a canvas texture, repaints, and calls its
 * `update()`; {@link WidgetSkin.onLayout} already says when
 * {@link CanvasViewWidget.pixelWidth}/{@link CanvasViewWidget.pixelHeight}
 * changed, which is when the skin constructs a **replacement** texture — §77a
 * forbids in-place resize (the `R-30` gate), so a resized panel means a new
 * surface, and the widget's job is only to make that moment visible.
 *
 * ## §79 and §33
 *
 * The widget's document (`ui:canvas-view`) carries its box and its
 * {@link CanvasViewWidget.resolution}, and nothing else — **painted pixels are
 * never serialized** (§77a's display-only rule; a painted surface has no §79
 * key and its bytes are produced by code), and
 * {@link CanvasViewWidget.contentVersion} is transient repaint state, not
 * authored scene state.
 */

import { requireFinite } from "./numbers.js";
import { UIWidget, type UIWidgetOptions } from "./widget.js";

/** Construction options for a {@link CanvasViewWidget}. */
export interface CanvasViewWidgetOptions extends UIWidgetOptions {
  /** {@link CanvasViewWidget.resolution}. Default `1`. */
  resolution?: number;
}

/**
 * Throws unless `value` is a finite number `> 0` (§85) — a backing-surface
 * scale of zero would make every laid-out view a 0 × 0 texture, silently.
 */
function requirePositive(name: string, value: number): number {
  requireFinite("CanvasViewWidget", name, value);
  if (value <= 0) {
    throw new RangeError(
      `CanvasViewWidget: ${name} must be > 0; got ${String(value)} (§85).`,
    );
  }
  return value;
}

export class CanvasViewWidget extends UIWidget {
  // Deliberately no `static typeName`: that key is §6a's *component* key and
  // the umbrella's completeness test enumerates it (the `Bone` precedent,
  // RFC 0003's recorded deviation — restated here against RFC 0004 §2b's
  // sketch, which predates it). The §79 identity is the node type
  // `"ui:canvas-view"`, registered by the umbrella's `registerUISerializers`.

  #resolution = 1;

  #contentVersion = 0;

  constructor(options: CanvasViewWidgetOptions = {}) {
    super(options);
    if (options.resolution !== undefined) {
      this.#resolution = requirePositive("resolution", options.resolution);
    }
  }

  /**
   * Device-pixel scale for the backing surface (§74's device-pixel scaling).
   *
   * **Supplied, never discovered** — this package cannot see §45's
   * `resolution`, exactly as `ImageWidget.naturalWidth` is supplied rather
   * than loaded; the application reads its renderer's resolution and writes it
   * here. Assigning a new value changes
   * {@link CanvasViewWidget.pixelWidth}/{@link CanvasViewWidget.pixelHeight},
   * so it counts as a repaint request: it bumps
   * {@link CanvasViewWidget.contentVersion} and notifies the skin.
   *
   * @throws RangeError if not finite or not `> 0` (§85)
   */
  get resolution(): number {
    return this.#resolution;
  }

  set resolution(value: number) {
    const next = requirePositive("resolution", value);
    if (next === this.#resolution) return;
    this.#resolution = next;
    this.invalidate();
  }

  /**
   * Backing-surface width in texels: `round(measuredWidth * resolution)`.
   *
   * `0` until a layout pass has run — a view nobody laid out has no backing
   * yet, and a skin waits for the first {@link WidgetSkin.onLayout} before
   * constructing a texture (a §77a surface requires a size ≥ 1).
   */
  get pixelWidth(): number {
    return Math.round(this.measuredWidth * this.#resolution);
  }

  /** Backing-surface height in texels: `round(measuredHeight * resolution)`. */
  get pixelHeight(): number {
    return Math.round(this.measuredHeight * this.#resolution);
  }

  /**
   * Announce that the content should be repainted: bumps
   * {@link CanvasViewWidget.contentVersion} and fires the skin's existing
   * {@link WidgetSkin.onContentChange} hook. Call it from whatever knows the
   * picture changed — never from a fixed step (§77a's §33 rule: the repaint it
   * requests is display work in §9's render or real time domain).
   *
   * Public where `notifyContentChange` is protected, because a canvas view's
   * content is the one thing the *application* knows better than the widget
   * does — there is no setter to hang the announcement on.
   */
  invalidate(): void {
    this.#contentVersion += 1;
    this.notifyContentChange();
  }

  /**
   * Monotonic revision of the painted content; the skin compares it against
   * the last version it drew to decide whether to repaint. Transient — not
   * part of the §79 document.
   */
  get contentVersion(): number {
    return this.#contentVersion;
  }

  // There is deliberately no `measureIntrinsic` override: a canvas view has no
  // intrinsic content size — the application paints to fill whatever box §74
  // resolves — so the base class's 0 × 0 is already the honest answer, and a
  // view without an explicit `width`/`height` measures nothing, exactly like a
  // sourceless ImageWidget.
}
