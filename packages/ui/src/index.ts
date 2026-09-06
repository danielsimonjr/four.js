/**
 * `@four/ui` — retained-mode UI at §113a's MVP tier (§73–§75).
 *
 * Ten controls over one base class: {@link Panel} (container + §74 layout),
 * {@link Label} (text measured with `@four/text`), {@link Button} (§72 click →
 * activation), the three checkables — {@link Toggle}, {@link Checkbox}, and
 * {@link RadioButton} (exclusive by group name) — {@link Slider} (pointer drag
 * + §75 arrow keys), {@link ProgressIndicator}, {@link ImageWidget}, and
 * {@link CanvasViewWidget} (§77a's skin-drawn canvas view; RFC 0004,
 * 2026-08-29), plus §75's keyboard navigation over all of them
 * ({@link installKeyboardTraversal}, {@link keyboardFocusTarget}) and the
 * opt-in hidden DOM accessibility mirror ({@link installAccessibilityMirror}).
 * Everything else §73–§75 names is staged with a dated note in
 * {@link UI_STAGED} — read that array before assuming a control exists.
 *
 * ```ts
 * const root = new Panel({ layout: { type: "flex", direction: "column", gap: 12, padding: 20 } });
 * const start = new Button({ height: 40, accessibility: { role: "button", label: "Start" } });
 * start.add(new Label({ text: "Start", atlas: buildGlyphAtlas(), size: 16 }));
 * root.add(start);
 * root.layout();
 *
 * const candidates: Pickable[] = [];
 * const input = new PointerInput(canvas, {
 *   camera,
 *   pickables: () => collectPickables(root, candidates),   // §71
 * });
 * new KeyboardInput(window, { focusTarget: keyboardFocusTarget(root) });  // §75
 * installKeyboardTraversal(root);                                         // Tab
 * installAccessibilityMirror(root, { document });                         // §75
 * start.on("uiactivate", () => simulation.start());   // click, Enter, or Space
 * ```
 *
 * **Widgets do not draw themselves.** The frozen dependency matrix gives this
 * package `core`, `math`, `scene`, `input`, and `text` — no `render`, no
 * `materials`, no `geometry` — so a widget owns hierarchy, size, hit area, and
 * state, and the application supplies the pixels through a {@link WidgetSkin}.
 * `widget.ts`'s header is the full argument.
 */

export const PACKAGE_NAME = "@four/ui";

// §81's UI-control token (RFC 0002): declared here; `@four/four`'s
// `plugins.ts` re-exports the same object.
export { UI_CONTROLS } from "./capabilities.js";
export type { UIControlConstructor } from "./control-registry.js";
export { UIControlRegistry } from "./control-registry.js";

export type {
  AccessibilityMirror,
  AccessibilityMirrorOptions,
  AccessibilityMirrorRoot,
  DocumentLike,
  ElementLike,
  ElementStyleLike,
} from "./accessibility.js";
export {
  accessibilityElementId,
  installAccessibilityMirror,
  prefersReducedMotion,
} from "./accessibility.js";
export type { ButtonOptions } from "./button.js";
export { Button } from "./button.js";
export type { CanvasViewWidgetOptions } from "./canvas-view.js";
export { CanvasViewWidget } from "./canvas-view.js";
export type {
  CheckableWidgetOptions,
  CheckboxOptions,
  ToggleOptions,
} from "./checkable.js";
export { CheckableWidget, Checkbox, Toggle } from "./checkable.js";
export type { ImageWidgetOptions } from "./image.js";
export { ImageWidget } from "./image.js";
export type { KeyboardTraversalOptions } from "./keyboard.js";
export {
  collectFocusOrder,
  installKeyboardTraversal,
  keyboardFocusTarget,
} from "./keyboard.js";
export type { LabelOptions } from "./label.js";
export { Label } from "./label.js";
export type {
  LayoutAlign,
  LayoutDirection,
  LayoutJustify,
  LayoutType,
  PanelLayout,
  PanelOptions,
} from "./panel.js";
export { Panel } from "./panel.js";
export type { ProgressIndicatorOptions } from "./progress.js";
export { ProgressIndicator } from "./progress.js";
export type { RadioButtonOptions } from "./radio.js";
export { RadioButton, checkedRadio, collectRadioGroup } from "./radio.js";
export type { SliderOptions, SliderOrientation } from "./slider.js";
export { Slider } from "./slider.js";
export type {
  AccessibilitySync,
  InsetsInit,
  UIFocusEvent,
  UIWidgetOptions,
  WidgetAccessibility,
  WidgetActivateEvent,
  WidgetActivationSource,
  WidgetSkin,
  WidgetStateChangeEvent,
  WidgetStateSnapshot,
  WidgetValueChangeEvent,
} from "./widget.js";
export {
  Insets,
  UIWidget,
  UI_LAYOUT_AUTHORITY,
  UI_STAGED,
  applyInsets,
  collectPickables,
  focusedWidget,
  isUIWidget,
  registerAccessibilitySync,
} from "./widget.js";
