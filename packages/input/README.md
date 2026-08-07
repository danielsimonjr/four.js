# @four/input

Input, pointer events, and picking. Part of [four.js](../../README.md).

Implements §71 and the MVP subset of §72 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 3a (§106a), with the keyboard source added 2026-08-07 (gap A-10).

## What's here

- **Picking (§71)** — `pick` / `createPickRay` over the `Pickable` contract (ray vs. AABB and oriented-box tests, Y-up NDC), returning `PickHit` records.
- **Propagation (§72, §6b)** — `SceneInputEvent` (target + `stopPropagation`), `buildPropagationPath`, and `dispatchThreePhase`: the DOM-mirroring capture → target → bubble walk every input event shares, with capture-phase listener keys under `CAPTURE_KEY_PREFIX`. Node event types are added to `@four/scene`'s `NodeEventMap` via declaration merging.
- **Pointer events (§72 subset)** — `ScenePointerEvent` and `dispatchPointerEvent`, plus pointer capture.
- **Key events (§72)** — `SceneKeyEvent` (`key`, `code`, grouped `modifiers`, `repeat`, `preventDefault`) and `dispatchKeyEvent`, over the same three phases.
- **`PointerInput`** — the DOM pointer source over a `PointerSurface`, with click-vs-drag disambiguation (`DEFAULT_CLICK_MOVE_THRESHOLD`).
- **`KeyboardInput`** — the DOM key source over a `KeySurface` (`window`, `document`, or any duck-typed pair of listener methods), routing `keydown`/`keyup` to the node an injected `focusTarget()` resolver names. Focus itself belongs to `@four/ui` (§75); this package never imports it.
- **`DragManager`** — world-delta drag handoff to application callbacks. This package never writes transforms; the application performs the §42 authority handover itself.

## Staged / not yet implemented

- Wheel/trackpad, gamepad, and XR sources; the synthesized `double-click`, `pinch`, and `rotate` gestures; node-level `focus`/`blur` as *input* events; `keypress` (deprecated in the DOM — see `key-events.ts`).
- Picking strategies beyond bounding volumes (§71).

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/input`; publishes as `@danielsimonjr/fourjs-input`.
