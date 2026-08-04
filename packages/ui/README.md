# @four/ui

Retained-mode UI at §113a's MVP tier. Part of [four.js](../../README.md).

Implements the MVP tier of §73–75 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 11. Widgets are scene nodes; **widgets do not draw themselves** — the dependency matrix gives this package `core`, `math`, `scene`, `input`, and `text` (no `render`, `materials`, or `geometry`), so a widget owns hierarchy, size, hit area, and state, and the application supplies the pixels through the `WidgetSkin` seam.

## What's here

- **`UIWidget`** — the base class: layout box, insets (`Insets` / `applyInsets`), state snapshots (`WidgetStateSnapshot`, `WidgetStateChangeEvent`), focus (`focusedWidget`, `UIFocusEvent`; one focused widget per scene root), accessibility data (`WidgetAccessibility` — carried, currently inert), and the `UI_LAYOUT_AUTHORITY` transform authority.
- **`Panel`** — container with `absolute`, `stack`, and `flex` layout (`PanelLayout`, `LayoutDirection` / `LayoutAlign` / `LayoutJustify`); §74's anchor mode ships as the per-child anchor/pivot/offset triple honored by absolute layout.
- **`Label`** — text measured with `@four/text`'s glyph atlas.
- **`Button`** — §72 click → `uiactivate` (`WidgetActivateEvent`); `activate()` is public so a keyboard layer can drive it.
- **`collectPickables`** — bridges a widget tree into `@four/input`'s §71 picking.
- **`UI_STAGED`** — the frozen, dated list of everything §73–75 names that is _not_ implemented; read it before assuming a control exists.

## Staged / not yet implemented (see `UI_STAGED` for reasons)

- §73 controls beyond panel/label/button (toggle, slider, text input, scroll view, lists, menus, …).
- §74 grid and constraint layout; percentage sizing, overflow, RTL.
- §75 hidden DOM accessibility mirror and keyboard navigation (focus itself ships; `@four/input` has no key source yet).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/ui`; publishes as `@danielsimonjr/fourjs-ui`.
