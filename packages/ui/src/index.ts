/**
 * `@four/ui` — retained-mode UI at §113a's MVP tier (§73–§75).
 *
 * Three controls over one base class: {@link Panel} (container + §74 layout),
 * {@link Label} (text measured with `@four/text`), and {@link Button} (§72
 * click → activation). Everything else §73–§75 names is staged with a dated
 * note in {@link UI_STAGED} — read that array before assuming a control exists.
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
 * start.on("uiactivate", () => simulation.start());
 * ```
 *
 * **Widgets do not draw themselves.** The frozen dependency matrix gives this
 * package `core`, `math`, `scene`, `input`, and `text` — no `render`, no
 * `materials`, no `geometry` — so a widget owns hierarchy, size, hit area, and
 * state, and the application supplies the pixels through a {@link WidgetSkin}.
 * `widget.ts`'s header is the full argument.
 */

export const PACKAGE_NAME = "@four/ui";

export type { ButtonOptions } from "./button.js";
export { Button } from "./button.js";
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
export type {
  InsetsInit,
  UIFocusEvent,
  UIWidgetOptions,
  WidgetAccessibility,
  WidgetActivateEvent,
  WidgetActivationSource,
  WidgetSkin,
  WidgetStateChangeEvent,
  WidgetStateSnapshot,
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
} from "./widget.js";
