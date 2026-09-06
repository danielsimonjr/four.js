# @four/ui

Retained-mode UI at §113a's MVP tier. Part of [four.js](../../README.md).

Implements the MVP tier of §73–75 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 11. Widgets are scene nodes; **widgets do not draw themselves** — the dependency matrix gives this package `core`, `math`, `scene`, `input`, and `text` (no `render`, `materials`, or `geometry`), so a widget owns hierarchy, size, hit area, and state, and the application supplies the pixels through the `WidgetSkin` seam.

## What's here

- **`UIWidget`** — the base class: layout box, insets (`Insets` / `applyInsets`), state snapshots (`WidgetStateSnapshot`, `WidgetStateChangeEvent`), focus (`focusedWidget`, `UIFocusEvent`; one focused widget per scene root), accessibility data (`WidgetAccessibility` — `tabIndex` drives the traversal; `role`/`label`/`description` are projected by the DOM mirror), convenience `label` / `role` accessors, and the `UI_LAYOUT_AUTHORITY` transform authority.
- **`Panel`** — container with `absolute`, `stack`, and `flex` layout (`PanelLayout`, `LayoutDirection` / `LayoutAlign` / `LayoutJustify`); §74's anchor mode ships as the per-child anchor/pivot/offset triple honored by absolute layout.
- **`Label`** — text measured with `@four/text`'s glyph atlas.
- **`Button`** — §72 click → `uiactivate` (`WidgetActivateEvent`), and §75's Enter/Space activation on the focused button (`source: "keyboard"`); `activate()` stays public for programmatic use, and `willActivate()` is the hook a control whose activation _means_ something overrides.
- **`Toggle` / `Checkbox` / `RadioButton`** (2026-08-07, A-12) — checkable controls over `CheckableWidget`: activation flips (or, for a radio, sets) `checked`, which rides `WidgetStateSnapshot.checked` and `uistatechange`. A radio group is a **name** (`group`), scoped to the tree and resolved by a walk (`collectRadioGroup`, `checkedRadio`); arrow keys move and check within it.
- **`Slider`** (A-12) — a range (`min`/`max`/`step`) and a `value` with `fraction` for the skin; §72 press-and-drag through the hit point (transformed by the widget's own world matrix) and §75 arrow/Home/End keys. Emits `uivaluechange`.
- **`ProgressIndicator`** (A-12) — an output, not a control: clamped `value`, `fraction`, `indeterminate`; not interactive, not focusable.
- **`ImageWidget`** (A-12) — a box, a §79 logical `source` key, and a supplied natural size that becomes §74's intrinsic image size. Named with the suffix because `Image` is a browser global; its document type is `ui:image`.
- **`CanvasViewWidget`** (RFC 0004, 2026-08-29) — §73's canvas view, skin-drawn: the widget owns its box, a supplied device-pixel `resolution` (so `pixelWidth`/`pixelHeight` name the backing size in texels), and a monotonic `contentVersion` bumped by `invalidate()`; the `WidgetSkin` owns the §77a `CanvasTexture` and repaints through `onContentChange`. Document type `ui:canvas-view` — box and resolution only, painted pixels are never serialized (§77a).
- **`collectPickables`** — bridges a widget tree into `@four/input`'s §71 picking.
- **Keyboard navigation (§75)** — `installKeyboardTraversal` (Tab / Shift-Tab over the widget tree), `collectFocusOrder` (scene order, sorted by `accessibility.tabIndex`; negative opts out), and `keyboardFocusTarget` — the resolver `@four/input`'s `KeyboardInput` takes, which is how keys reach the focused widget without `input` ever depending on `ui`.
- **Hidden DOM accessibility mirror (§75)** — `installAccessibilityMirror` (opt-in; duck-typed `DocumentLike` so tests inject a fake and browsers pass `window.document`). Projects `role`, `aria-label`, `aria-disabled` / `disabled`, `tabIndex`, and slider/progress `aria-value*`. High contrast writes `data-high-contrast`; `fontScale` writes `font-size` on the mirror, not the canvas; `reducedMotion` is accepted (`prefersReducedMotion()` is the hook for widgets that later animate). `mirror.dispose()` removes the container. Tree-shakes when unused.
- **`WidgetSkin`** — five optional hooks: `onAttach`, `onLayout`, `onStateChange` (any §75 flag, checkedness included), `onContentChange` (a value, an `indeterminate` flag, an image source — content with no layout or state transition), `onDetach`.
- **`UI_STAGED`** — the frozen, dated list of everything §73–75 names that is _not_ implemented; read it before assuming a control exists.

## Staged / not yet implemented (see `UI_STAGED` for reasons)

- §73 controls that are genuinely blocked: text input (§56 selection/caret), scroll view and virtual list (§74 overflow + §67 clipping), embedded 3D viewport (§48 nested surface), menu and tooltip (a per-frame update hook no widget has — a hover delay needs §9 time, which the §10 loop owns), and list (a selection model plus the same overflow). Ten of the sixteen ship as of 2026-08-29 (RFC 0004, when the canvas view landed — its old blocker note, "immediate-mode drawing this package may not import", was wrong: the widget never draws, the skin does).
- §74 grid and constraint layout; percentage sizing, overflow, RTL.
- §75 reduced motion is accepted by the DOM mirror; menu and tooltip (the widgets that will animate) still wait on a per-frame update hook. Keyboard navigation and activation **shipped** 2026-08-07 (gap A-13); the hidden DOM mirror, screen-reader updates, high-contrast hook, and scalable text **shipped** 2026-09-06 (A-13 remainder).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/ui`; publishes as `@danielsimonjr/fourjs-ui`.
