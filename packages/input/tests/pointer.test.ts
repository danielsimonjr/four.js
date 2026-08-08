/**
 * Pointer input, propagation, and dragging (§72) — driven entirely without a
 * DOM: a fake surface records the listeners `PointerInput` registers and feeds
 * it synthetic `{ clientX, clientY, pointerId }` events, and every expectation
 * is derived by hand from the camera's projection.
 */

import { Vector3 } from "@four/math";
import {
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  type Node,
} from "@four/scene";
import { describe, expect, it, vi } from "vitest";

import { DragManager } from "../src/drag.js";
import type { Pickable } from "../src/pick.js";
import {
  ScenePointerEvent,
  buildPropagationPath,
  dispatchPointerEvent,
} from "../src/pointer-events.js";
import {
  PointerInput,
  type PointerInputOptions,
  type PointerSurface,
  type SurfacePointerEvent,
  type SurfacePointerListener,
  type SurfaceRect,
} from "../src/pointer-input.js";

/**
 * A surface with no DOM behind it: it records what was subscribed and lets a
 * test fire events at it.
 */
class FakeSurface implements PointerSurface {
  rect: SurfaceRect = { left: 20, top: 10, width: 200, height: 100 };

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
    if (existing === undefined) {
      return;
    }
    const index = existing.indexOf(listener);
    if (index !== -1) {
      existing.splice(index, 1);
    }
  }

  getBoundingClientRect(): SurfaceRect {
    return this.rect;
  }

  /** Total live registrations, for the dispose test. */
  get listenerCount(): number {
    let count = 0;
    for (const listeners of this.listeners.values()) {
      count += listeners.length;
    }
    return count;
  }

  fire(type: string, clientX: number, clientY: number, pointerId = 1): void {
    const event: SurfacePointerEvent = { clientX, clientY, pointerId };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

/**
 * Orthographic camera showing world `[-2, 2]²` at the origin, looking down −Z.
 * Its pick rays are `origin = (2·ndcX, 2·ndcY, -1)`, `direction = (0, 0, -1)`,
 * so world X is exactly twice NDC X — every expectation below follows from
 * that.
 */
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

/**
 * A unit box centred at `(x, y, z)`. `z = -5` puts it in front of the ortho
 * camera's near plane (which sits at `z = -1`).
 */
function boxAt(x: number, y: number, z = -5, half = 0.5): Pickable {
  const node = new Group();
  node.transform.position.set(x, y, z);
  return {
    node,
    boundsMin: new Vector3(-half, -half, -half),
    boundsMax: new Vector3(half, half, half),
  };
}

/** Client X for an NDC X, given {@link FakeSurface}'s default rect. */
function clientXOf(ndcX: number): number {
  return 20 + ((ndcX + 1) / 2) * 200;
}

/** Client Y for an NDC Y, given {@link FakeSurface}'s default rect. */
function clientYOf(ndcY: number): number {
  return 10 + ((1 - ndcY) / 2) * 100;
}

interface Harness {
  surface: FakeSurface;
  input: PointerInput;
  pickables: Pickable[];
}

function harness(
  pickables: Pickable[] = [],
  options: Partial<PointerInputOptions> = {},
): Harness {
  const surface = new FakeSurface();
  const input = new PointerInput(surface, {
    camera: options.camera ?? orthoCamera(),
    pickables: options.pickables ?? ((): readonly Pickable[] => pickables),
    ...(options.clickMoveThreshold === undefined
      ? {}
      : { clickMoveThreshold: options.clickMoveThreshold }),
  });
  return { surface, input, pickables };
}

describe("PointerInput — coordinate normalization", () => {
  it("converts client pixels to NDC through the rect, flipping Y", () => {
    const { input } = harness();
    const out: [number, number] = [0, 0];

    // Centre of the 200×100 rect at (20, 10).
    input.toNdc(120, 60, out);
    expect(out).toEqual([0, 0]);

    // Top-left corner: NDC (-1, +1) — client Y grows down, NDC Y grows up.
    input.toNdc(20, 10, out);
    expect(out).toEqual([-1, 1]);

    // Bottom-right corner: NDC (+1, -1).
    input.toNdc(220, 110, out);
    expect(out).toEqual([1, -1]);

    // A quarter across and a quarter down.
    input.toNdc(70, 35, out);
    expect(out[0]).toBeCloseTo(-0.5, 12);
    expect(out[1]).toBeCloseTo(0.5, 12);
  });

  it("reads the rect fresh, so a moved or resized surface still maps", () => {
    const { surface, input } = harness();
    surface.rect = { left: -30, top: 5, width: 400, height: 200 };
    const out: [number, number] = [0, 0];
    input.toNdc(-30, 5, out);
    expect(out).toEqual([-1, 1]);
    input.toNdc(170, 105, out);
    expect(out).toEqual([0, 0]);
  });

  it("returns the centre for a degenerate rect instead of dividing by zero", () => {
    const { surface, input } = harness();
    surface.rect = { left: 0, top: 0, width: 0, height: 0 };
    const out: [number, number] = [3, 4];
    input.toNdc(100, 100, out);
    expect(out).toEqual([0, 0]);
  });

  it("carries the NDC of the platform event into the scene event", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const seen: ScenePointerEvent[] = [];
    box.node.on("pointerdown", (event) => {
      seen.push(event);
    });

    surface.fire("pointerdown", clientXOf(0.1), clientYOf(-0.2));

    expect(seen).toHaveLength(1);
    expect(seen[0].ndcX).toBeCloseTo(0.1, 12);
    expect(seen[0].ndcY).toBeCloseTo(-0.2, 12);
    expect(seen[0].pointerId).toBe(1);
    expect(seen[0].type).toBe("pointerdown");
  });
});

describe("PointerInput — target resolution", () => {
  it("targets the box the ray hits", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface } = harness([left, right]);
    const hitLeft = vi.fn();
    const hitRight = vi.fn();
    left.node.on("pointerdown", hitLeft);
    right.node.on("pointerdown", hitRight);

    // World x = 2·ndcX, so NDC −0.75 is world −1.5: the left box.
    surface.fire("pointerdown", clientXOf(-0.75), clientYOf(0));
    expect(hitLeft).toHaveBeenCalledTimes(1);
    expect(hitRight).not.toHaveBeenCalled();

    surface.fire("pointerdown", clientXOf(0.75), clientYOf(0));
    expect(hitRight).toHaveBeenCalledTimes(1);
  });

  it("targets the nearest of two overlapping boxes", () => {
    const far = boxAt(0, 0, -8);
    const near = boxAt(0, 0, -3);
    const { surface } = harness([far, near]);
    const seen: Node[] = [];
    far.node.on("pointerdown", () => seen.push(far.node));
    near.node.on("pointerdown", () => seen.push(near.node));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    expect(seen).toEqual([near.node]);
  });

  it("dispatches nothing when the ray misses everything", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const listener = vi.fn();
    box.node.on("pointerdown", listener);

    // World x = 1.8 — outside the box's [-0.5, 0.5].
    surface.fire("pointerdown", clientXOf(0.9), clientYOf(0));

    expect(listener).not.toHaveBeenCalled();
  });

  it("reports the world-space hit point", () => {
    const box = boxAt(0, 0, -5);
    const { surface } = harness([box]);
    let point: Vector3 | undefined;
    box.node.on("pointerdown", (event) => {
      point = event.worldPoint;
    });

    surface.fire("pointerdown", clientXOf(0.1), clientYOf(0.2));

    expect(point).toBeDefined();
    // Entry face of the box: z = -4.5; x and y are 2·NDC.
    expect(point?.x).toBeCloseTo(0.2, 12);
    expect(point?.y).toBeCloseTo(0.4, 12);
    expect(point?.z).toBeCloseTo(-4.5, 12);
  });

  it("re-reads the candidate list on every event", () => {
    const box = boxAt(0, 0);
    const pickables: Pickable[] = [];
    const { surface } = harness(pickables);
    const listener = vi.fn();
    box.node.on("pointerdown", listener);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    expect(listener).not.toHaveBeenCalled();

    pickables.push(box);
    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("dispatchPointerEvent — capture, target, bubble (§72)", () => {
  /** root → middle → leaf, with the leaf as the pick target. */
  function hierarchy(): { root: Group; middle: Group; leaf: Pickable } {
    const root = new Group();
    const middle = new Group();
    const leaf = boxAt(0, 0);
    root.add(middle);
    middle.add(leaf.node);
    return { root, middle, leaf };
  }

  it("builds a root-first propagation path", () => {
    const { root, middle, leaf } = hierarchy();
    expect(buildPropagationPath(leaf.node)).toEqual([root, middle, leaf.node]);
    expect(buildPropagationPath(root)).toEqual([root]);
  });

  it("reuses the out array and truncates it", () => {
    const { root, middle, leaf } = hierarchy();
    const out: Node[] = [leaf.node, leaf.node, leaf.node, leaf.node];
    expect(buildPropagationPath(middle, out)).toBe(out);
    expect(out).toEqual([root, middle]);
  });

  it("descends root-first then bubbles target-first", () => {
    const { root, middle, leaf } = hierarchy();
    const { surface } = harness([leaf]);
    const order: string[] = [];
    root.on("capture:pointerdown", () => order.push("capture:root"));
    middle.on("capture:pointerdown", () => order.push("capture:middle"));
    leaf.node.on("capture:pointerdown", () => order.push("capture:leaf"));
    root.on("pointerdown", () => order.push("bubble:root"));
    middle.on("pointerdown", () => order.push("bubble:middle"));
    leaf.node.on("pointerdown", () => order.push("bubble:leaf"));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    expect(order).toEqual([
      "capture:root",
      "capture:middle",
      "capture:leaf",
      "bubble:leaf",
      "bubble:middle",
      "bubble:root",
    ]);
  });

  it("keeps registration order within one node and one phase (§6b)", () => {
    const { leaf } = hierarchy();
    const { surface } = harness([leaf]);
    const order: string[] = [];
    leaf.node.on("pointerdown", () => order.push("first"));
    leaf.node.on("pointerdown", () => order.push("second"));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    expect(order).toEqual(["first", "second"]);
  });

  it("truncates the bubble phase at the node that stopped propagation", () => {
    const { root, middle, leaf } = hierarchy();
    const { surface } = harness([leaf]);
    const order: string[] = [];
    root.on("pointerdown", () => order.push("bubble:root"));
    middle.on("pointerdown", (event) => {
      order.push("bubble:middle");
      event.stopPropagation();
    });
    middle.on("pointerdown", () => order.push("bubble:middle-sibling"));
    leaf.node.on("pointerdown", () => order.push("bubble:leaf"));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    // The stopping node's remaining listeners still run (stopPropagation, not
    // stopImmediatePropagation); its ancestor never sees the event.
    expect(order).toEqual([
      "bubble:leaf",
      "bubble:middle",
      "bubble:middle-sibling",
    ]);
  });

  it("stops the descent, so the target never sees a captured event", () => {
    const { root, middle, leaf } = hierarchy();
    const { surface } = harness([leaf]);
    const order: string[] = [];
    root.on("capture:pointerdown", (event) => {
      order.push("capture:root");
      event.stopPropagation();
    });
    middle.on("capture:pointerdown", () => order.push("capture:middle"));
    leaf.node.on("capture:pointerdown", () => order.push("capture:leaf"));
    leaf.node.on("pointerdown", () => order.push("bubble:leaf"));
    root.on("pointerdown", () => order.push("bubble:root"));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    expect(order).toEqual(["capture:root"]);
  });

  it("reports the hit node as target at every node on the path", () => {
    const { root, middle, leaf } = hierarchy();
    const { surface } = harness([leaf]);
    const targets: (Node | null)[] = [];
    root.on("pointerdown", (event) => targets.push(event.target));
    middle.on("capture:pointerdown", (event) => targets.push(event.target));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    expect(targets).toEqual([leaf.node, leaf.node]);
  });

  it("dispatches nothing along an empty path", () => {
    const event = new ScenePointerEvent({
      type: "pointerdown",
      pointerId: 1,
      ndcX: 0,
      ndcY: 0,
      target: null,
    });
    expect(() => {
      dispatchPointerEvent(event, []);
    }).not.toThrow();
    expect(event.propagationStopped).toBe(false);
  });
});

describe("PointerInput — click synthesis", () => {
  it("synthesizes a click from a press and release on one node", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const order: string[] = [];
    box.node.on("pointerdown", () => order.push("down"));
    box.node.on("pointerup", () => order.push("up"));
    box.node.on("click", () => order.push("click"));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    surface.fire("pointerup", clientXOf(0), clientYOf(0));

    expect(order).toEqual(["down", "up", "click"]);
  });

  it("propagates the click like any other pointer event", () => {
    const root = new Group();
    const box = boxAt(0, 0);
    root.add(box.node);
    const { surface } = harness([box]);
    const order: string[] = [];
    root.on("capture:click", () => order.push("capture:root"));
    root.on("click", () => order.push("bubble:root"));
    box.node.on("click", () => order.push("bubble:leaf"));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    surface.fire("pointerup", clientXOf(0), clientYOf(0));

    expect(order).toEqual(["capture:root", "bubble:leaf", "bubble:root"]);
  });

  it("still clicks when the pointer wobbles inside the tolerance", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const click = vi.fn();
    box.node.on("click", click);

    // 1 client px is 0.01 NDC here — inside the 0.02 default.
    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    surface.fire("pointermove", clientXOf(0) + 1, clientYOf(0));
    surface.fire("pointerup", clientXOf(0) + 1, clientYOf(0));

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("cancels the click once the pointer moves past the tolerance", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const click = vi.fn();
    const up = vi.fn();
    box.node.on("click", click);
    box.node.on("pointerup", up);

    // 5 client px is 0.05 NDC — outside the tolerance. The release lands back
    // where the press did, and it is still not a click.
    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    surface.fire("pointermove", clientXOf(0) + 5, clientYOf(0));
    surface.fire("pointerup", clientXOf(0), clientYOf(0));

    expect(up).toHaveBeenCalledTimes(1);
    expect(click).not.toHaveBeenCalled();
  });

  it("honours a custom tolerance", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box], { clickMoveThreshold: 0.001 });
    const click = vi.fn();
    box.node.on("click", click);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    surface.fire("pointermove", clientXOf(0) + 1, clientYOf(0));
    surface.fire("pointerup", clientXOf(0) + 1, clientYOf(0));

    expect(click).not.toHaveBeenCalled();
  });

  it("does not click when the release lands on another node", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface } = harness([left, right]);
    const leftClick = vi.fn();
    const rightClick = vi.fn();
    left.node.on("click", leftClick);
    right.node.on("click", rightClick);

    surface.fire("pointerdown", clientXOf(-0.75), clientYOf(0));
    surface.fire("pointerup", clientXOf(0.75), clientYOf(0));

    expect(leftClick).not.toHaveBeenCalled();
    expect(rightClick).not.toHaveBeenCalled();
  });

  it("does not click when the press hit nothing", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const click = vi.fn();
    box.node.on("click", click);

    surface.fire("pointerdown", clientXOf(0.9), clientYOf(0));
    surface.fire("pointerup", clientXOf(0), clientYOf(0));

    expect(click).not.toHaveBeenCalled();
  });

  it("tracks presses per pointer id", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface } = harness([left, right]);
    const leftClick = vi.fn();
    const rightClick = vi.fn();
    left.node.on("click", leftClick);
    right.node.on("click", rightClick);

    surface.fire("pointerdown", clientXOf(-0.75), clientYOf(0), 1);
    surface.fire("pointerdown", clientXOf(0.75), clientYOf(0), 2);
    surface.fire("pointerup", clientXOf(0.75), clientYOf(0), 2);
    surface.fire("pointerup", clientXOf(-0.75), clientYOf(0), 1);

    expect(leftClick).toHaveBeenCalledTimes(1);
    expect(rightClick).toHaveBeenCalledTimes(1);
  });
});

describe("PointerInput — enter and leave", () => {
  it("fires enter on the newly hovered node", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const enter = vi.fn();
    box.node.on("pointerenter", enter);

    surface.fire("pointermove", clientXOf(0.9), clientYOf(0));
    expect(enter).not.toHaveBeenCalled();
    expect(input.getHovered(1)).toBeNull();

    surface.fire("pointermove", clientXOf(0), clientYOf(0));
    expect(enter).toHaveBeenCalledTimes(1);
    expect(input.getHovered(1)).toBe(box.node);

    // Staying on the same node does not re-enter.
    surface.fire("pointermove", clientXOf(0.05), clientYOf(0));
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it("leaves the old node before entering the new one, and both before the move", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface } = harness([left, right]);
    const order: string[] = [];
    left.node.on("pointerenter", () => order.push("enter:left"));
    left.node.on("pointerleave", () => order.push("leave:left"));
    right.node.on("pointerenter", () => order.push("enter:right"));
    left.node.on("pointermove", () => order.push("move:left"));
    right.node.on("pointermove", () => order.push("move:right"));

    surface.fire("pointermove", clientXOf(-0.75), clientYOf(0));
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0));

    expect(order).toEqual([
      "enter:left",
      "move:left",
      "leave:left",
      "enter:right",
      "move:right",
    ]);
  });

  it("leaves when the pointer moves off everything", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const leave = vi.fn();
    box.node.on("pointerleave", leave);

    surface.fire("pointermove", clientXOf(0), clientYOf(0));
    surface.fire("pointermove", clientXOf(0.9), clientYOf(0));

    expect(leave).toHaveBeenCalledTimes(1);
    expect(input.getHovered(1)).toBeNull();
  });

  it("updates hover on a press as well as a move", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const enter = vi.fn();
    box.node.on("pointerenter", enter);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    expect(enter).toHaveBeenCalledTimes(1);
    expect(input.getHovered(1)).toBe(box.node);
  });

  it("does not propagate enter or leave to ancestors", () => {
    const root = new Group();
    const box = boxAt(0, 0);
    root.add(box.node);
    const { surface } = harness([box]);
    const ancestorEnter = vi.fn();
    const ancestorLeave = vi.fn();
    root.on("pointerenter", ancestorEnter);
    root.on("pointerleave", ancestorLeave);

    surface.fire("pointermove", clientXOf(0), clientYOf(0));
    surface.fire("pointermove", clientXOf(0.9), clientYOf(0));

    expect(ancestorEnter).not.toHaveBeenCalled();
    expect(ancestorLeave).not.toHaveBeenCalled();
  });

  it("carries a world point on enter and none on leave", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    let leaveEvent: ScenePointerEvent | undefined;
    let enterEvent: ScenePointerEvent | undefined;
    box.node.on("pointerenter", (event) => {
      enterEvent = event;
    });
    box.node.on("pointerleave", (event) => {
      leaveEvent = event;
    });

    surface.fire("pointermove", clientXOf(0), clientYOf(0));
    surface.fire("pointermove", clientXOf(0.9), clientYOf(0));

    expect(enterEvent?.worldPoint).toBeInstanceOf(Vector3);
    expect(leaveEvent?.worldPoint).toBeUndefined();
    expect(leaveEvent?.target).toBe(box.node);
  });

  it("tracks hover per pointer id", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);

    surface.fire("pointermove", clientXOf(-0.75), clientYOf(0), 7);
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0), 9);

    expect(input.getHovered(7)).toBe(left.node);
    expect(input.getHovered(9)).toBe(right.node);
  });
});

describe("PointerInput — pointer capture", () => {
  it("routes moves and releases to the capturing node", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);
    const leftMove = vi.fn();
    const rightMove = vi.fn();
    const leftUp = vi.fn();
    left.node.on("pointermove", leftMove);
    left.node.on("pointerup", leftUp);
    right.node.on("pointermove", rightMove);

    input.setPointerCapture(left.node, 1);
    expect(input.getPointerCapture(1)).toBe(left.node);

    // Over the right box, but the left one holds the pointer.
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0));
    surface.fire("pointerup", clientXOf(0.75), clientYOf(0));

    expect(leftMove).toHaveBeenCalledTimes(1);
    expect(leftUp).toHaveBeenCalledTimes(1);
    expect(rightMove).not.toHaveBeenCalled();
  });

  it("routes to the capturing node even where nothing is pickable", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const move = vi.fn();
    box.node.on("pointermove", move);

    input.setPointerCapture(box.node, 1);
    surface.fire("pointermove", clientXOf(0.95), clientYOf(0.95));

    expect(move).toHaveBeenCalledTimes(1);
  });

  it("suppresses hover changes while captured", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);
    const rightEnter = vi.fn();
    right.node.on("pointerenter", rightEnter);

    input.setPointerCapture(left.node, 1);
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0));

    expect(rightEnter).not.toHaveBeenCalled();
    expect(input.getHovered(1)).toBeNull();
  });

  it("reports no world point while captured", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    let event: ScenePointerEvent | undefined;
    box.node.on("pointermove", (e) => {
      event = e;
    });

    input.setPointerCapture(box.node, 1);
    surface.fire("pointermove", clientXOf(0), clientYOf(0));

    expect(event?.target).toBe(box.node);
    expect(event?.worldPoint).toBeUndefined();
  });

  it("releases the capture implicitly on release, and explicitly on request", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);

    input.setPointerCapture(box.node, 1);
    surface.fire("pointerup", clientXOf(0.9), clientYOf(0));
    expect(input.getPointerCapture(1)).toBeNull();

    input.setPointerCapture(box.node, 1);
    input.releasePointerCapture(1);
    expect(input.getPointerCapture(1)).toBeNull();
    // Releasing an uncaptured pointer is a no-op.
    expect(() => {
      input.releasePointerCapture(42);
    }).not.toThrow();
    expect(input.getPointerCapture(42)).toBeNull();
  });

  it("captures one pointer without affecting another", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);
    const leftMove = vi.fn();
    const rightMove = vi.fn();
    left.node.on("pointermove", leftMove);
    right.node.on("pointermove", rightMove);

    input.setPointerCapture(left.node, 1);
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0), 1);
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0), 2);

    expect(leftMove).toHaveBeenCalledTimes(1);
    expect(rightMove).toHaveBeenCalledTimes(1);
  });
});

describe("PointerInput — lifecycle", () => {
  it("subscribes to down, move, up, and cancel", () => {
    const { surface } = harness();
    expect([...surface.listeners.keys()].sort()).toEqual([
      "pointercancel",
      "pointerdown",
      "pointermove",
      "pointerup",
    ]);
    expect(surface.listenerCount).toBe(4);
  });

  it("removes every listener on dispose, idempotently", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const listener = vi.fn();
    box.node.on("pointerdown", listener);

    input.dispose();
    expect(surface.listenerCount).toBe(0);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    expect(listener).not.toHaveBeenCalled();

    expect(() => {
      input.dispose();
    }).not.toThrow();
    expect(surface.listenerCount).toBe(0);
  });

  it("forgets every tracked pointer on dispose", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), 4);
    surface.fire("pointerdown", clientXOf(0), clientYOf(0), 5);
    expect(input.trackedPointerCount).toBe(2);

    input.dispose();
    expect(input.trackedPointerCount).toBe(0);
  });
});

/**
 * A-9 (2026-08-06): per-pointer state used to be inserted on demand and never
 * removed, so a surface that saw N touch contacts kept N entries — each one
 * holding `downTarget` and `captured` `Node` references — until `dispose()`.
 */
describe("PointerInput — pointer lifetime (§72, §83, A-9)", () => {
  it("forgets a pointer when it is released", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), 3);
    expect(input.trackedPointerCount).toBe(1);
    expect(input.getHovered(3)).toBe(box.node);

    surface.fire("pointerup", clientXOf(0), clientYOf(0), 3);
    expect(input.trackedPointerCount).toBe(0);
    expect(input.getHovered(3)).toBeNull();
    expect(input.getPointerCapture(3)).toBeNull();
  });

  it("fires the pending leave when a release ends the hover", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const order: string[] = [];
    box.node.on("pointerenter", () => order.push("enter"));
    box.node.on("pointerup", () => order.push("up"));
    box.node.on("click", () => order.push("click"));
    box.node.on("pointerleave", (event) => {
      order.push("leave");
      // Target-only, and no world point: the pointer is no longer on it.
      expect(event.target).toBe(box.node);
      expect(event.worldPoint).toBeUndefined();
    });

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    surface.fire("pointerup", clientXOf(0), clientYOf(0));

    expect(order).toEqual(["enter", "up", "click", "leave"]);
  });

  it("releases a capture and fires no leave for a pointer that never hovered", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);
    const leave = vi.fn();
    left.node.on("pointerleave", leave);
    right.node.on("pointerleave", leave);

    input.setPointerCapture(left.node, 1);
    surface.fire("pointermove", clientXOf(0.75), clientYOf(0));
    surface.fire("pointerup", clientXOf(0.75), clientYOf(0));

    expect(leave).not.toHaveBeenCalled();
    expect(input.trackedPointerCount).toBe(0);
  });

  it("dispatches pointercancel through the three phases and ends the pointer", () => {
    const root = new Group();
    const box = boxAt(0, 0);
    root.add(box.node);
    const { surface, input } = harness([box]);
    const order: string[] = [];
    root.on("capture:pointercancel", () => order.push("capture:root"));
    box.node.on("pointercancel", (event) => {
      order.push("target");
      expect(event.type).toBe("pointercancel");
      expect(event.pointerId).toBe(11);
    });
    root.on("pointercancel", () => order.push("bubble:root"));
    box.node.on("pointerleave", () => order.push("leave"));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), 11);
    expect(input.trackedPointerCount).toBe(1);

    surface.fire("pointercancel", clientXOf(0), clientYOf(0), 11);

    expect(order).toEqual(["capture:root", "target", "bubble:root", "leave"]);
    expect(input.trackedPointerCount).toBe(0);
    expect(input.getHovered(11)).toBeNull();
  });

  it("never synthesizes a click from a cancel", () => {
    const box = boxAt(0, 0);
    const { surface } = harness([box]);
    const click = vi.fn();
    const up = vi.fn();
    box.node.on("click", click);
    box.node.on("pointerup", up);

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    surface.fire("pointercancel", clientXOf(0), clientYOf(0));

    expect(click).not.toHaveBeenCalled();
    expect(up).not.toHaveBeenCalled();
  });

  it("drops a capture held by a cancelled pointer", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);

    input.setPointerCapture(box.node, 2);
    expect(input.getPointerCapture(2)).toBe(box.node);

    surface.fire("pointercancel", clientXOf(0.95), clientYOf(0.95), 2);

    expect(input.getPointerCapture(2)).toBeNull();
    expect(input.trackedPointerCount).toBe(0);
  });

  it("a cancel that resolves to nothing still forgets the pointer", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);

    // Off every pickable: the cancel has no target, so nothing is dispatched —
    // the teardown must not depend on there being one.
    surface.fire("pointercancel", clientXOf(0.95), clientYOf(0.95), 8);

    expect(input.trackedPointerCount).toBe(0);
  });

  // 2026-08-07: the teardown deleted the map entry *after* dispatching
  // `pointerleave`, so a listener that started a new gesture with the same
  // pointerId during that dispatch wrote into the entry being torn down and
  // then had it deleted — the new gesture vanished, silently.
  it("keeps a gesture started from inside the leave of the previous one", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    let restarted = false;

    box.node.on("pointerleave", () => {
      if (restarted) return;
      restarted = true;
      // Same pointer id: a synthetic re-press from inside the teardown.
      surface.fire("pointerdown", clientXOf(0), clientYOf(0), 5);
    });

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), 5);
    surface.fire("pointerup", clientXOf(0), clientYOf(0), 5);

    // The re-press survived the outer teardown: one live pointer, hovering the
    // node it pressed, and its own release still ends it cleanly.
    expect(input.trackedPointerCount).toBe(1);
    expect(input.getHovered(5)).toBe(box.node);

    surface.fire("pointerup", clientXOf(0), clientYOf(0), 5);
    expect(input.trackedPointerCount).toBe(0);
  });

  it("still forgets a pointer whose leave listener does nothing", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    box.node.on("pointerleave", () => {
      // Reads the input mid-teardown: the entry is still there to be read.
      expect(input.trackedPointerCount).toBe(1);
    });

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), 6);
    surface.fire("pointerup", clientXOf(0), clientYOf(0), 6);

    expect(input.trackedPointerCount).toBe(0);
  });

  it("leaks nothing across 10 000 gestures with distinct pointer ids", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const x = clientXOf(0);
    const y = clientYOf(0);

    // What a touch surface really does: every contact is a *new* pointerId.
    for (let id = 1; id <= 10_000; id += 1) {
      surface.fire("pointerdown", x, y, id);
      surface.fire("pointermove", x, y, id);
      // Half the gestures are taken away by the system rather than released.
      surface.fire(id % 2 === 0 ? "pointerup" : "pointercancel", x, y, id);
      expect(input.trackedPointerCount).toBe(0);
    }

    expect(input.trackedPointerCount).toBe(0);
    expect(input.getHovered(10_000)).toBeNull();
    expect(input.getPointerCapture(10_000)).toBeNull();
  });

  it("holds one entry per live pointer while gestures overlap", () => {
    const left = boxAt(-1.5, 0);
    const right = boxAt(1.5, 0);
    const { surface, input } = harness([left, right]);

    surface.fire("pointerdown", clientXOf(-0.75), clientYOf(0), 7);
    surface.fire("pointerdown", clientXOf(0.75), clientYOf(0), 9);
    expect(input.trackedPointerCount).toBe(2);

    surface.fire("pointerup", clientXOf(-0.75), clientYOf(0), 7);
    expect(input.trackedPointerCount).toBe(1);
    expect(input.getHovered(9)).toBe(right.node);

    surface.fire("pointercancel", clientXOf(0.75), clientYOf(0), 9);
    expect(input.trackedPointerCount).toBe(0);
  });

  it("retains no reference to a node a completed gesture touched", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const captured: Node[] = [];
    box.node.on("pointerleave", () => captured.push(box.node));

    surface.fire("pointerdown", clientXOf(0), clientYOf(0), 12);
    input.setPointerCapture(box.node, 12);
    surface.fire("pointerup", clientXOf(0), clientYOf(0), 12);

    // The application removes the node; nothing inside the input may still name
    // it (§83: a dead pointer must not pin a detached node).
    expect(input.trackedPointerCount).toBe(0);
    expect(input.getPointerCapture(12)).toBeNull();
    expect(input.getHovered(12)).toBeNull();
    expect(captured).toHaveLength(1);
  });

  it("uses the camera it currently holds", () => {
    const box = boxAt(0, 0);
    const { surface, input } = harness([box]);
    const listener = vi.fn();
    box.node.on("pointerdown", listener);

    // A camera showing [-8, 8]²: world x = 8·ndcX, so NDC 0.25 is world 2 —
    // a miss, where the original camera would have hit at world 0.5.
    input.camera = new OrthographicCamera({
      left: -8,
      right: 8,
      bottom: -8,
      top: 8,
      near: 1,
      far: 21,
    });
    surface.fire("pointerdown", clientXOf(0.25), clientYOf(0));
    expect(listener).not.toHaveBeenCalled();

    surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("DragManager", () => {
  interface DragHarness {
    surface: FakeSurface;
    input: PointerInput;
    box: Pickable;
    drags: DragManager;
    deltas: Vector3[];
    started: Node[];
    ended: Node[];
  }

  function dragHarness(
    options: Partial<PointerInputOptions> = {},
    pickable: Pickable = boxAt(0, 0),
  ): DragHarness {
    const box = pickable;
    const { surface, input } = harness([box], options);
    const deltas: Vector3[] = [];
    const started: Node[] = [];
    const ended: Node[] = [];
    const drags = new DragManager({
      pointerInput: input,
      onDrag: (_node, worldDelta) => {
        // The vector is reused between calls — copy it.
        deltas.push(worldDelta.clone());
      },
      onDragStart: (node) => started.push(node),
      onDragEnd: (node) => ended.push(node),
    });
    return { surface, input, box, drags, deltas, started, ended };
  }

  it("converts NDC motion into exact world deltas under an ortho camera", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(-0.5));

    // World x = 2·ndcX and world y = 2·ndcY for this camera, so an NDC step of
    // 0.25 is a world step of 0.5, and one of -0.5 is -1.
    expect(h.deltas).toHaveLength(2);
    expect(h.deltas[0].x).toBeCloseTo(0.5, 12);
    expect(h.deltas[0].y).toBeCloseTo(0, 12);
    expect(h.deltas[0].z).toBeCloseTo(0, 12);
    expect(h.deltas[1].x).toBeCloseTo(0, 12);
    expect(h.deltas[1].y).toBeCloseTo(-1, 12);
    expect(h.deltas[1].z).toBeCloseTo(0, 12);
  });

  it("never writes the dragged node's transform", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);
    const before = h.box.node.transform.position.clone();

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0.25));
    h.surface.fire("pointerup", clientXOf(0.25), clientYOf(0.25));

    expect(h.box.node.transform.position.equalsApprox(before, 0)).toBe(true);
    expect(h.box.node.transformAuthority).toBe("manual");
    expect(h.deltas.length).toBeGreaterThan(0);
  });

  it("captures the pointer for the duration of the gesture", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    expect(h.input.getPointerCapture(1)).toBe(h.box.node);
    expect(h.drags.isDragging(1)).toBe(true);
    expect(h.drags.getDragged(1)).toBe(h.box.node);

    // Far outside the box — the capture keeps the drag alive.
    h.surface.fire("pointermove", clientXOf(0.95), clientYOf(0));
    expect(h.deltas).toHaveLength(1);
    expect(h.deltas[0].x).toBeCloseTo(1.9, 12);

    h.surface.fire("pointerup", clientXOf(0.95), clientYOf(0));
    expect(h.input.getPointerCapture(1)).toBeNull();
    expect(h.drags.isDragging(1)).toBe(false);
    expect(h.started).toEqual([h.box.node]);
    expect(h.ended).toEqual([h.box.node]);
  });

  it("ends a drag whose pointer the system cancelled (A-9)", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    expect(h.drags.isDragging(1)).toBe(true);

    h.surface.fire("pointercancel", clientXOf(0.5), clientYOf(0));

    expect(h.drags.isDragging(1)).toBe(false);
    expect(h.ended).toEqual([h.box.node]);
    expect(h.input.getPointerCapture(1)).toBeNull();
    expect(h.input.trackedPointerCount).toBe(0);

    // Nothing follows a cancelled gesture: the pointer is gone.
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));
    expect(h.deltas).toEqual([]);
  });

  it("ignores moves when no drag is in progress", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);

    h.surface.fire("pointermove", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));

    expect(h.deltas).toEqual([]);
    expect(h.started).toEqual([]);
  });

  it("is idempotent per node and undone by its unsubscriber", () => {
    const h = dragHarness();
    const first = h.drags.makeDraggable(h.box.node);
    expect(h.drags.makeDraggable(h.box.node)).toBe(first);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));
    expect(h.deltas).toHaveLength(1);

    first();
    expect(h.drags.isDragging(1)).toBe(false);
    expect(h.drags.getDragged(1)).toBeNull();
    expect(h.ended).toEqual([h.box.node]);
    // Unsubscribing twice does not re-end anything.
    first();
    expect(h.ended).toHaveLength(1);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));
    expect(h.deltas).toHaveLength(1);
  });

  it("ends drags and unsubscribes on dispose", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);
    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    h.drags.dispose();
    expect(h.drags.isDragging(1)).toBe(false);
    expect(h.ended).toEqual([h.box.node]);
    expect(h.input.getPointerCapture(1)).toBeNull();

    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));
    expect(h.deltas).toEqual([]);
  });

  it("releases a drag on request and stops reporting", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);
    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));

    h.drags.releaseDrag(1);
    expect(h.ended).toEqual([h.box.node]);
    // Releasing a pointer that is not dragging is a no-op.
    h.drags.releaseDrag(1);
    expect(h.ended).toHaveLength(1);

    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));
    expect(h.deltas).toEqual([]);
  });

  it("drags a parent when a press on its child bubbles up", () => {
    const parent = new Group();
    const child = boxAt(0, 0);
    parent.add(child.node);
    const h = dragHarness({}, child);
    h.drags.makeDraggable(parent);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    expect(h.drags.getDragged(1)).toBe(parent);

    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));
    expect(h.deltas).toHaveLength(1);
    expect(h.deltas[0].x).toBeCloseTo(0.5, 12);
  });

  it("ignores a second press from a pointer already dragging", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointerdown", clientXOf(0.5), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.25), clientYOf(0));

    expect(h.started).toEqual([h.box.node]);
    // The delta is measured from the first press, not the second.
    expect(h.deltas).toHaveLength(1);
    expect(h.deltas[0].x).toBeCloseTo(0.5, 12);
  });

  it("ends a drag whose capture was released out from under it", () => {
    const h = dragHarness();
    h.drags.makeDraggable(h.box.node);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.input.releasePointerCapture(1);
    // Hover is live again, so moving off the box fires `pointerleave`.
    h.surface.fire("pointermove", clientXOf(0.95), clientYOf(0));

    expect(h.drags.isDragging(1)).toBe(false);
    expect(h.ended).toEqual([h.box.node]);
  });

  it("scales the delta by the grab point's depth under a perspective camera", () => {
    // fov = π/2, aspect 1, near 1 → the near plane spans camera-space [-1, 1]²,
    // so an NDC step of 0.1 is a near-plane step of 0.1 world units.
    const camera = new PerspectiveCamera({
      fieldOfView: Math.PI / 2,
      aspect: 1,
      near: 1,
      far: 100,
    });
    camera.transform.position.set(0, 0, 10);
    const box = boxAt(0, 0, 0);
    const h = dragHarness({ camera }, box);
    h.drags.makeDraggable(box.node);

    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.1), clientYOf(0));

    // The grab point is the box's front face at z = 0.5, i.e. 9.5 in front of
    // the camera: delta = 0.1 · (9.5 / 1).
    expect(h.deltas).toHaveLength(1);
    expect(h.deltas[0].x).toBeCloseTo(0.95, 10);
    expect(h.deltas[0].y).toBeCloseTo(0, 10);
    expect(h.deltas[0].z).toBeCloseTo(0, 10);
  });

  it("falls back to the node's own depth when there is no grab point", () => {
    const camera = new PerspectiveCamera({
      fieldOfView: Math.PI / 2,
      aspect: 1,
      near: 1,
      far: 100,
    });
    camera.transform.position.set(0, 0, 10);
    const box = boxAt(0, 0, 0);
    const h = dragHarness({ camera }, box);
    h.drags.makeDraggable(box.node);

    // Capturing first means the press carries no world point: the node's own
    // origin (depth 10) is used instead of the front face (depth 9.5).
    h.input.setPointerCapture(box.node, 1);
    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.1), clientYOf(0));

    expect(h.deltas).toHaveLength(1);
    expect(h.deltas[0].x).toBeCloseTo(1, 10);
  });

  it("falls back to an unscaled delta when the grab point is behind the camera", () => {
    const camera = new PerspectiveCamera({
      fieldOfView: Math.PI / 2,
      aspect: 1,
      near: 1,
      far: 100,
    });
    // Looking down −Z from z = -10: the box at the origin is behind it, so the
    // measured depth is negative and the scale degenerates to 1.
    camera.transform.position.set(0, 0, -10);
    const box = boxAt(0, 0, 0);
    const h = dragHarness({ camera }, box);
    h.drags.makeDraggable(box.node);

    h.input.setPointerCapture(box.node, 1);
    h.surface.fire("pointerdown", clientXOf(0), clientYOf(0));
    h.surface.fire("pointermove", clientXOf(0.1), clientYOf(0));

    expect(h.deltas).toHaveLength(1);
    expect(h.deltas[0].x).toBeCloseTo(0.1, 10);
  });
});

describe("NodeEventMap augmentation (§6b)", () => {
  it("types pointer events on any node, and rejects unknown keys", () => {
    const node = new Group();
    const seen: number[] = [];
    const off = node.on("pointerdown", (event) => {
      // Fully typed: `event` is a ScenePointerEvent, not `unknown`.
      seen.push(event.ndcX);
    });
    node.on("capture:pointerdown", (event) => seen.push(event.ndcY));

    const event = new ScenePointerEvent({
      type: "pointerdown",
      pointerId: 3,
      ndcX: 0.5,
      ndcY: -0.5,
      target: node,
    });
    dispatchPointerEvent(event, [node]);
    expect(seen).toEqual([-0.5, 0.5]);

    off();
    // @ts-expect-error the augmentation is additive: unknown keys stay errors.
    node.on("pointerdance", () => undefined);
    // @ts-expect-error enter and leave do not propagate, so they have no capture key.
    node.on("capture:pointerenter", () => undefined);
    // Structural node events still work.
    node.on("added", (hierarchy) => seen.push(hierarchy.node === node ? 1 : 0));
    expect(seen).toEqual([-0.5, 0.5]);
  });
});
