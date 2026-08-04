# @four/input

Input, pointer events, and picking. Part of [four.js](../../README.md).

Implements §71 and the MVP subset of §72 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 3a (§106a).

## What's here

- **Picking (§71)** — `pick` / `createPickRay` over the `Pickable` contract (ray vs. AABB and oriented-box tests, Y-up NDC), returning `PickHit` records.
- **Pointer events (§72 subset)** — `ScenePointerEvent` with DOM-mirroring propagation (`buildPropagationPath`, `dispatchPointerEvent`; capture → target → bubble) and pointer capture on the four propagating event types (`CAPTURE_KEY_PREFIX`). Node event types are added to `@four/scene`'s `NodeEventMap` via declaration merging.
- **`PointerInput`** — the DOM pointer source over a `PointerSurface`, with click-vs-drag disambiguation (`DEFAULT_CLICK_MOVE_THRESHOLD`).
- **`DragManager`** — world-delta drag handoff to application callbacks. This package never writes transforms; the application performs the §42 authority handover itself.

## Staged / not yet implemented

- Keyboard and gamepad sources — this package currently has no key source at all (which is why `@four/ui`'s keyboard navigation is also staged).
- The full §72 event list beyond the propagating pointer subset.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/input`; publishes as `@danielsimonjr/fourjs-input`.
