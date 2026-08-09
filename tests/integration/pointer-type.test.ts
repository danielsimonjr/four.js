/**
 * `pointerType` across packages (§72, §73 — A-9 remainder, 2026-08-09).
 *
 * The unit suite in `packages/input/tests/pointer-type.test.ts` proves the
 * field and the hover rule inside `@four/input`. This one proves the
 * consequence that made the gap worth closing: a `@four/ui` widget's hover
 * highlight is driven by `pointerenter`/`pointerleave`, so before the device
 * was known, **clicking a button with a mouse un-highlighted it** until the
 * next mouse move. It also pins the assignability property that decided the
 * field's type — a DOM-shaped event, whose `pointerType` is a bare `string`,
 * still satisfies `SurfacePointerEvent` with no adapter.
 */

import {
  PointerInput,
  type PointerSurface,
  type SurfacePointerEvent,
  type SurfacePointerListener,
  type SurfaceRect,
} from "@four/input";
import { OrthographicCamera } from "@four/scene";
import { Button, collectPickables } from "@four/ui";
import { describe, expect, it } from "vitest";

/** A surface with no DOM behind it, able to report a device per event. */
class FakeSurface implements PointerSurface {
  readonly listeners = new Map<string, SurfacePointerListener[]>();

  addEventListener(type: string, listener: SurfacePointerListener): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      this.listeners.set(type, [listener]);
    } else {
      existing.push(listener);
    }
  }

  removeEventListener(type: string, listener: SurfacePointerListener): void {
    const existing = this.listeners.get(type);
    const index = existing?.indexOf(listener) ?? -1;
    if (existing !== undefined && index !== -1) {
      existing.splice(index, 1);
    }
  }

  getBoundingClientRect(): SurfaceRect {
    return { left: 0, top: 0, width: 200, height: 200 };
  }

  fire(type: string, pointerType: string): void {
    // Dead centre of the surface, which is where the button sits.
    const event: SurfacePointerEvent = {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      pointerType,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

/** A centred button, laid out, plus the input driving it. */
function buttonUnderPointer(): {
  surface: FakeSurface;
  input: PointerInput;
  button: Button;
} {
  // Local hit area is (0, −height, 0) … (width, 0, 0), so this places the
  // 2 × 2 button symmetrically about the origin, five units down −Z.
  const button = new Button({ width: 2, height: 2 });
  button.transform.position.set(-1, 1, -5);
  button.layout();

  // The same camera the input package's own tests use: world [−2, 2]² at the
  // origin, looking down −Z, so NDC (0, 0) is the button's centre.
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
    near: 1,
    far: 21,
  });

  const candidates = collectPickables(button, []);
  const surface = new FakeSurface();
  const input = new PointerInput(surface, {
    camera,
    pickables: () => candidates,
  });
  return { surface, input, button };
}

describe("§72 pointerType and §73 hover state", () => {
  it("keeps a button highlighted across a mouse click", () => {
    const { surface, input, button } = buttonUnderPointer();

    surface.fire("pointermove", "mouse");
    expect(button.hovered).toBe(true);

    surface.fire("pointerdown", "mouse");
    surface.fire("pointerup", "mouse");

    // The bug this closed: the release used to fire `pointerleave`, so the
    // button dropped its hover highlight the instant it was clicked.
    expect(button.hovered).toBe(true);
    expect(input.getHovered(1)).toBe(button);
  });

  it("drops the highlight when a finger lifts, because the finger is gone", () => {
    const { surface, input, button } = buttonUnderPointer();

    surface.fire("pointermove", "touch");
    expect(button.hovered).toBe(true);

    surface.fire("pointerdown", "touch");
    surface.fire("pointerup", "touch");

    expect(button.hovered).toBe(false);
    expect(input.getHovered(1)).toBeNull();
    expect(input.trackedPointerCount).toBe(0);
  });

  it("keeps the pre-2026-08-09 behaviour for a source with no device", () => {
    const { surface, input, button } = buttonUnderPointer();

    surface.fire("pointermove", "");
    surface.fire("pointerdown", "");
    surface.fire("pointerup", "");

    expect(button.hovered).toBe(false);
    expect(input.trackedPointerCount).toBe(0);
  });

  it("accepts a DOM-shaped event whose pointerType is a bare string", () => {
    // `lib.dom` declares `PointerEvent.pointerType: string`. Narrowing the
    // seam's field to the three-device union would make this assignment fail —
    // which is why the narrowing happens inside `@four/input` instead.
    const domShaped: {
      clientX: number;
      clientY: number;
      pointerId: number;
      pointerType: string;
    } = { clientX: 100, clientY: 100, pointerId: 1, pointerType: "mouse" };
    const surfaceEvent: SurfacePointerEvent = domShaped;

    expect(surfaceEvent.pointerType).toBe("mouse");
  });
});
