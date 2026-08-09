/**
 * `pointerType` end to end (§72, A-9 remainder, 2026-08-09): the platform's
 * device string, narrowed once, carried on every scene pointer event, and read
 * by the one rule that needs it — a mouse keeps its hover across its own
 * release, a finger does not.
 *
 * Driven without a DOM, like `pointer.test.ts`: the surface is a fake and every
 * expectation follows from the camera's projection.
 */

import { Vector3 } from "@four/math";
import { Group, OrthographicCamera, type Node } from "@four/scene";
import { describe, expect, it, vi } from "vitest";

import type { Pickable } from "../src/pick.js";
import {
  ScenePointerEvent,
  type PointerDeviceType,
  type ScenePointerEventType,
} from "../src/pointer-events.js";
import {
  PointerInput,
  type PointerSurface,
  type SurfacePointerEvent,
  type SurfacePointerListener,
  type SurfaceRect,
} from "../src/pointer-input.js";

/** A surface with no DOM behind it, able to report a device per event. */
class FakeSurface implements PointerSurface {
  readonly rect: SurfaceRect = { left: 20, top: 10, width: 200, height: 100 };

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
    return this.rect;
  }

  fire(
    type: string,
    clientX: number,
    clientY: number,
    options: { pointerId?: number; pointerType?: string } = {},
  ): void {
    const event: SurfacePointerEvent = {
      clientX,
      clientY,
      pointerId: options.pointerId ?? 1,
      pointerType: options.pointerType,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

/** Orthographic camera showing world `[-2, 2]²` at the origin, looking down −Z. */
function orthoCamera(): OrthographicCamera {
  return new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
    near: 1,
    far: 21,
  });
}

/** A unit box centred at `(x, y, −5)` — in front of the camera's near plane. */
function boxAt(x: number, y: number): Pickable {
  const node = new Group();
  node.transform.position.set(x, y, -5);
  return {
    node,
    boundsMin: new Vector3(-0.5, -0.5, -0.5),
    boundsMax: new Vector3(0.5, 0.5, 0.5),
  };
}

/** Client X for an NDC X, given {@link FakeSurface}'s rect. */
function clientXOf(ndcX: number): number {
  return 20 + ((ndcX + 1) / 2) * 200;
}

/** Client Y for an NDC Y, given {@link FakeSurface}'s rect. */
function clientYOf(ndcY: number): number {
  return 10 + ((1 - ndcY) / 2) * 100;
}

function harness(pickables: readonly Pickable[]): {
  surface: FakeSurface;
  input: PointerInput;
} {
  const surface = new FakeSurface();
  const input = new PointerInput(surface, {
    camera: orthoCamera(),
    pickables: () => pickables,
  });
  return { surface, input };
}

/** Records every scene pointer event a node sees, in order. */
function recordAll(node: Node): ScenePointerEvent[] {
  const seen: ScenePointerEvent[] = [];
  const types: ScenePointerEventType[] = [
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointercancel",
    "click",
    "pointerenter",
    "pointerleave",
  ];
  for (const type of types) {
    node.on(type, (event) => seen.push(event));
  }
  return seen;
}

// --- narrowing --------------------------------------------------------------

describe("pointerType narrowing (§72)", () => {
  it.each<PointerDeviceType>(["mouse", "pen", "touch"])(
    "carries %s onto every event it produces",
    (pointerType) => {
      const box = boxAt(0, 0);
      const { surface } = harness([box]);
      const seen = recordAll(box.node);

      surface.fire("pointerdown", clientXOf(0), clientYOf(0), { pointerType });
      // Inside the click tolerance, so the release still synthesizes a click.
      surface.fire("pointermove", clientXOf(0.01), clientYOf(0), {
        pointerType,
      });
      surface.fire("pointerup", clientXOf(0.01), clientYOf(0), { pointerType });

      expect(seen.map((event) => event.type)).toEqual([
        "pointerenter",
        "pointerdown",
        "pointermove",
        "pointerup",
        "click",
        ...(pointerType === "mouse" ? [] : ["pointerleave"]),
      ]);
      for (const event of seen) {
        expect(event.pointerType).toBe(pointerType);
      }
    },
  );

  it("reports an unrecognized device as unknown rather than refusing it", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const seen = recordAll(box.node);

    // The Pointer Events specification permits vendor values and "" — neither
    // may throw, and neither may masquerade as one of the three.
    surface.fire("pointerdown", clientXOf(0), clientYOf(0), {
      pointerType: "eraser",
    });
    surface.fire("pointerup", clientXOf(0), clientYOf(0), { pointerType: "" });

    expect(seen).not.toHaveLength(0);
    for (const event of seen) {
      expect(event.pointerType).toBeUndefined();
    }
    // Unknown is treated as non-persistent: exactly the pre-2026-08-09 teardown.
    expect(input.trackedPointerCount).toBe(0);
  });

  it("leaves it absent when the source reports no device at all", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const seen = recordAll(box.node);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    expect(seen[0].pointerType).toBeUndefined();
    expect(seen[0]).toBeInstanceOf(ScenePointerEvent);
  });

  it("carries the device on events synthesized while captured", () => {
    const box = boxAt(0, 0);
    const other = boxAt(1.5, 0);
    const { surface, input } = harness([box, other]);
    const seen = recordAll(box.node);
    input.setPointerCapture(box.node, 4);

    surface.fire("pointermove", clientXOf(0.75), clientYOf(0), {
      pointerId: 4,
      pointerType: "pen",
    });

    // Captured: the target is the capturing node whatever the ray touched, and
    // the device travels with it.
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe("pointermove");
    expect(seen[0].pointerType).toBe("pen");
  });

  it("is settable by hand on a ScenePointerEvent", () => {
    const event = new ScenePointerEvent({
      type: "pointerdown",
      pointerId: 1,
      pointerType: "touch",
      ndcX: 0,
      ndcY: 0,
      target: null,
    });

    expect(event.pointerType).toBe("touch");
  });
});

// --- the hover rule ---------------------------------------------------------

describe("a mouse keeps its hover across its own release (A-9)", () => {
  it("fires no leave for a mouse click, and no second enter afterwards", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const enter = vi.fn();
    const leave = vi.fn();
    box.node.on("pointerenter", enter);
    box.node.on("pointerleave", leave);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), {
      pointerType: "mouse",
    });
    surface.fire("pointerup", clientXOf(0), clientYOf(0), {
      pointerType: "mouse",
    });
    surface.fire("pointermove", clientXOf(0), clientYOf(0), {
      pointerType: "mouse",
    });

    expect(enter).toHaveBeenCalledTimes(1);
    expect(leave).not.toHaveBeenCalled();
    expect(input.getHovered(1)).toBe(box.node);
    expect(input.trackedPointerCount).toBe(1);
  });

  it("still fires the leave for a touch release", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const leave = vi.fn();
    box.node.on("pointerleave", leave);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), {
      pointerType: "touch",
    });
    surface.fire("pointerup", clientXOf(0), clientYOf(0), {
      pointerType: "touch",
    });

    expect(leave).toHaveBeenCalledTimes(1);
    expect(input.getHovered(1)).toBeNull();
    expect(input.trackedPointerCount).toBe(0);
  });

  it("forgets a mouse that was hovering nothing", () => {
    const box = boxAt(1.5, 0);
    const { surface, input } = harness([box]);

    surface.fire("pointerdown", clientXOf(-0.75), clientYOf(0), {
      pointerType: "mouse",
    });
    surface.fire("pointerup", clientXOf(-0.75), clientYOf(0), {
      pointerType: "mouse",
    });

    // The retained entry exists only to hold a live hover; with none, the
    // pointer is forgotten exactly as any other is.
    expect(input.trackedPointerCount).toBe(0);
  });

  it("forgets a mouse whose pointer the system cancelled", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const leave = vi.fn();
    box.node.on("pointerleave", leave);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), {
      pointerType: "mouse",
    });
    surface.fire("pointercancel", clientXOf(0), clientYOf(0), {
      pointerType: "mouse",
    });

    expect(leave).toHaveBeenCalledTimes(1);
    expect(input.trackedPointerCount).toBe(0);
    expect(input.getHovered(1)).toBeNull();
  });

  it("undoes the gesture it retains the entry for", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);
    const clicks: string[] = [];
    left.node.on("click", () => clicks.push("left"));
    right.node.on("click", () => clicks.push("right"));

    surface.fire("pointerdown", clientXOf(-0.75), clientYOf(0), {
      pointerType: "mouse",
    });
    input.setPointerCapture(left.node, 1);
    surface.fire("pointerup", clientXOf(-0.75), clientYOf(0), {
      pointerType: "mouse",
    });

    // Capture and press are gone even though the entry stayed…
    expect(input.getPointerCapture(1)).toBeNull();
    expect(input.getHovered(1)).toBe(left.node);
    expect(clicks).toEqual(["left"]);

    // …so the next gesture is a new one, and hover still tracks the pointer.
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0), {
      pointerType: "mouse",
    });
    expect(input.getHovered(1)).toBe(right.node);
    surface.fire("pointerdown", clientXOf(0.75), clientYOf(0), {
      pointerType: "mouse",
    });
    surface.fire("pointerup", clientXOf(0.75), clientYOf(0), {
      pointerType: "mouse",
    });
    expect(clicks).toEqual(["left", "right"]);
  });

  it("leaves the retained node when the mouse moves off it", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const leave = vi.fn();
    box.node.on("pointerleave", leave);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), {
      pointerType: "mouse",
    });
    surface.fire("pointerup", clientXOf(0), clientYOf(0), {
      pointerType: "mouse",
    });
    surface.fire("pointermove", clientXOf(0.9), clientYOf(0), {
      pointerType: "mouse",
    });

    expect(leave).toHaveBeenCalledTimes(1);
    expect(input.getHovered(1)).toBeNull();
  });

  it("stays bounded across 10 000 mouse clicks (§83)", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const x = clientXOf(0);
    const y = clientYOf(0);

    // A mouse's pointerId is stable and reused, so retention costs one entry
    // for the life of the surface — never one per gesture.
    for (let i = 0; i < 10_000; i += 1) {
      surface.fire("pointerdown", x, y, { pointerType: "mouse" });
      surface.fire("pointerup", x, y, { pointerType: "mouse" });
      expect(input.trackedPointerCount).toBe(1);
    }

    input.dispose();
    expect(input.trackedPointerCount).toBe(0);
  });

  it("keeps two mice independent", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);

    surface.fire("pointerdown", clientXOf(-0.75), clientYOf(0), {
      pointerId: 1,
      pointerType: "mouse",
    });
    surface.fire("pointerdown", clientXOf(0.75), clientYOf(0), {
      pointerId: 2,
      pointerType: "touch",
    });
    surface.fire("pointerup", clientXOf(0.75), clientYOf(0), {
      pointerId: 2,
      pointerType: "touch",
    });
    surface.fire("pointerup", clientXOf(-0.75), clientYOf(0), {
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(input.getHovered(1)).toBe(left.node);
    expect(input.getHovered(2)).toBeNull();
    expect(input.trackedPointerCount).toBe(1);
  });
});
