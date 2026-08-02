/**
 * `Panel` and the §74 layout subset: absolute/anchor placement, stack and flex
 * packing, growth, justification, cross alignment, and intrinsic sizing.
 *
 * Every expectation is a number derived by hand from the box model in
 * `widget.ts` — content box, then margins, then gaps — never from a second
 * implementation of the same arithmetic.
 */

import { constructionCount, resetConstructionCount } from "@four/math";
import { Group } from "@four/scene";
import { describe, expect, it } from "vitest";

import { Panel } from "../src/panel.js";
import { UIWidget } from "../src/widget.js";

/** A fixed-size leaf, the only kind of child these layout tests need. */
class Box extends UIWidget {
  constructor(width: number, height: number) {
    super({ width, height });
  }
}

/** `[left, top]` of each widget child, in the parent's frame. */
function placements(panel: Panel): [number, number][] {
  const result: [number, number][] = [];
  for (const child of panel.children) {
    if (child instanceof UIWidget) {
      result.push([child.layoutLeft, child.layoutTop]);
    }
  }
  return result;
}

describe("Panel configuration", () => {
  it("defaults to absolute layout", () => {
    const panel = new Panel();
    expect(panel.layoutType).toBe("absolute");
    expect(panel.direction).toBe("row");
    expect(panel.gap).toBe(0);
    expect(panel.justify).toBe("start");
    expect(panel.align).toBe("start");
  });

  it("takes §74's layout record, including its padding", () => {
    const panel = new Panel({
      layout: { type: "flex", direction: "column", gap: 12, padding: 20 },
    });
    expect(panel.layoutType).toBe("flex");
    expect(panel.direction).toBe("column");
    expect(panel.gap).toBe(12);
    expect(panel.padding.top).toBe(20);
    expect(panel.padding.left).toBe(20);
  });

  it("changes only the fields setLayout is given", () => {
    const panel = new Panel({ layout: { type: "stack", gap: 4 } });
    expect(panel.setLayout({ justify: "end", align: "center" })).toBe(panel);
    expect(panel.layoutType).toBe("stack");
    expect(panel.gap).toBe(4);
    expect(panel.justify).toBe("end");
    expect(panel.align).toBe("center");
  });
});

describe("absolute layout (§74 absolute + anchor)", () => {
  it("places children by anchor, pivot, and offset inside the content box", () => {
    const panel = new Panel({ width: 100, height: 50, padding: 10 });
    const topLeft = new Box(20, 10);
    const bottomRight = new Box(20, 10);
    bottomRight.anchor.set(1, 1);
    bottomRight.pivot.set(1, 1);
    const centred = new Box(20, 10);
    centred.anchor.set(0.5, 0.5);
    centred.pivot.set(0.5, 0.5);
    centred.offset.set(5, -5);
    panel.add(topLeft, bottomRight, centred);

    panel.layout();

    expect(panel.contentWidth).toBe(80);
    expect(panel.contentHeight).toBe(30);
    expect(placements(panel)).toEqual([
      [10, 10],
      [70, 30],
      [45, 15],
    ]);
    // §7a: down is −Y, and layout is the only place the sign appears.
    expect(bottomRight.transform.position.y).toBe(-30);
  });

  it("sizes to its children's extent as if every anchor were (0, 0)", () => {
    const panel = new Panel({ padding: 4 });
    const first = new Box(20, 10);
    const second = new Box(5, 30);
    second.offset.set(10, 2);
    second.anchor.set(1, 1); // ignored while measuring — see the module header
    panel.add(first, second);

    panel.measure();
    expect(panel.measuredWidth).toBe(28);
    expect(panel.measuredHeight).toBe(40);
  });

  it("ignores non-widget children and disabled widgets", () => {
    const panel = new Panel({ width: 100, height: 100 });
    const group = new Group();
    group.transform.position.set(7, 8, 9);
    const off = new Box(10, 10);
    off.enabled = false;
    off.offset.set(3, 3);
    panel.add(group, off);

    panel.layout();
    expect(group.transform.position.x).toBe(7);
    expect(group.transform.position.y).toBe(8);
    expect(off.layoutLeft).toBe(0);
    expect(off.layoutTop).toBe(0);
  });
});

describe("stack layout (§74)", () => {
  it("packs a row with gaps and margins, and sizes to the result", () => {
    const panel = new Panel({ layout: { type: "stack", gap: 5, padding: 2 } });
    const first = new Box(20, 10);
    const second = new Box(30, 6);
    second.margin.set(0, 1, 0, 3);
    panel.add(first, second);

    panel.layout();

    expect(panel.measuredWidth).toBe(63); // 20 + (3 + 30 + 1) + 5 gap + 4 padding
    expect(panel.measuredHeight).toBe(14); // max(10, 6) + 4 padding
    expect(placements(panel)).toEqual([
      [2, 2],
      [30, 2],
    ]);
  });

  it("packs a column downward", () => {
    const panel = new Panel({
      width: 40,
      height: 100,
      layout: { type: "stack", direction: "column", gap: 10 },
    });
    panel.add(new Box(20, 10), new Box(20, 30));

    panel.layout();
    expect(placements(panel)).toEqual([
      [0, 0],
      [0, 20],
    ]);
  });

  it("ignores grow — that is what separates it from flex", () => {
    const panel = new Panel({ width: 100, layout: { type: "stack" } });
    const first = new Box(10, 10);
    first.grow = 1;
    const second = new Box(10, 10);
    second.grow = 3;
    panel.add(first, second);

    panel.layout();
    expect(first.measuredWidth).toBe(10);
    expect(second.measuredWidth).toBe(10);
    expect(placements(panel)).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it("skips non-widget and disabled children throughout the pass", () => {
    const panel = new Panel({
      width: 100,
      height: 20,
      layout: { type: "flex", justify: "end" },
    });
    const group = new Group();
    group.transform.position.set(7, 8, 0);
    const off = new Box(30, 10);
    off.enabled = false;
    const visible = new Box(20, 10);
    visible.grow = 1;
    panel.add(group, off, visible);

    panel.layout();

    expect(group.transform.position.x).toBe(7);
    expect(off.layoutLeft).toBe(0);
    // The disabled box reserved no main-axis space, so the grower took all 100.
    expect(visible.measuredWidth).toBe(100);
    expect(visible.layoutLeft).toBe(0);
  });

  it("measures an empty container as its padding alone", () => {
    const panel = new Panel({ layout: { type: "stack", padding: 3 } });
    panel.add(new Group());
    panel.layout();
    expect(panel.measuredWidth).toBe(6);
    expect(panel.measuredHeight).toBe(6);
  });
});

describe("flex layout (§74)", () => {
  it("distributes leftover main-axis space by grow weight", () => {
    const panel = new Panel({
      width: 100,
      height: 10,
      layout: { type: "flex" },
    });
    const first = new Box(10, 10);
    first.grow = 1;
    const second = new Box(10, 10);
    second.grow = 3;
    panel.add(first, second);

    panel.layout();
    expect(first.measuredWidth).toBe(30);
    expect(second.measuredWidth).toBe(70);
    expect(placements(panel)).toEqual([
      [0, 0],
      [30, 0],
    ]);
  });

  it("re-derives the leftover when a child is clamped by its own maximum", () => {
    const panel = new Panel({
      width: 100,
      height: 10,
      layout: { type: "flex", justify: "end" },
    });
    const clamped = new Box(10, 10);
    clamped.grow = 1;
    clamped.maxWidth = 15;
    const free = new Box(10, 10);
    free.grow = 1;
    panel.add(clamped, free);

    panel.layout();
    expect(clamped.measuredWidth).toBe(15); // wanted 50, capped
    expect(free.measuredWidth).toBe(50);
    // 35 units are genuinely still free, so `justify: "end"` uses them.
    expect(placements(panel)).toEqual([
      [35, 0],
      [50, 0],
    ]);
  });

  it("grows nothing when no child asks", () => {
    const panel = new Panel({
      width: 100,
      height: 10,
      layout: { type: "flex" },
    });
    const box = new Box(10, 10);
    panel.add(box);
    panel.layout();
    expect(box.measuredWidth).toBe(10);
  });
});

describe("justification (§74)", () => {
  const cases: [
    "start" | "center" | "end" | "space-between",
    [number, number][],
  ][] = [
    [
      "start",
      [
        [0, 0],
        [0, 20],
      ],
    ],
    [
      "center",
      [
        [0, 25],
        [0, 45],
      ],
    ],
    [
      "end",
      [
        [0, 50],
        [0, 70],
      ],
    ],
    [
      "space-between",
      [
        [0, 0],
        [0, 70],
      ],
    ],
  ];

  for (const [justify, expected] of cases) {
    it(`places a column with justify: "${justify}"`, () => {
      const panel = new Panel({
        width: 40,
        height: 100,
        layout: { type: "stack", direction: "column", gap: 10, justify },
      });
      panel.add(new Box(20, 10), new Box(20, 30));
      panel.layout();
      expect(placements(panel)).toEqual(expected);
    });
  }

  it("packs an overflowing line from the start whatever the justification", () => {
    const panel = new Panel({
      width: 10,
      height: 10,
      layout: { type: "stack", justify: "center" },
    });
    panel.add(new Box(20, 10), new Box(20, 10));
    panel.layout();
    expect(placements(panel)).toEqual([
      [0, 0],
      [20, 0],
    ]);
  });

  it("leaves a lone child alone under space-between", () => {
    const panel = new Panel({
      width: 100,
      height: 10,
      layout: { type: "stack", justify: "space-between" },
    });
    panel.add(new Box(10, 10));
    panel.layout();
    expect(placements(panel)).toEqual([[0, 0]]);
  });
});

describe("cross-axis alignment (§74)", () => {
  it("starts, centres, and ends children on the cross axis", () => {
    for (const [align, left] of [
      ["start", 0],
      ["center", 10],
      ["end", 20],
    ] as const) {
      const panel = new Panel({
        width: 40,
        height: 100,
        layout: { type: "stack", direction: "column", align },
      });
      const box = new Box(20, 10);
      panel.add(box);
      panel.layout();
      expect(box.layoutLeft).toBe(left);
    }
  });

  it("stretches a child to the content box minus its own margins", () => {
    const panel = new Panel({
      width: 40,
      height: 100,
      padding: 5,
      layout: { type: "stack", direction: "column", align: "stretch" },
    });
    const box = new Box(20, 10);
    box.margin.set(0, 2, 0, 3);
    panel.add(box);

    panel.layout();
    expect(panel.contentWidth).toBe(30);
    expect(box.measuredWidth).toBe(25); // 30 − (3 + 2)
    expect(box.layoutLeft).toBe(8); // padding 5 + left margin 3
  });

  it("stretches on the other axis for a row", () => {
    const panel = new Panel({
      width: 100,
      height: 40,
      layout: { type: "stack", align: "stretch" },
    });
    const box = new Box(20, 10);
    panel.add(box);
    panel.layout();
    expect(box.measuredHeight).toBe(40);
  });

  it("centres against the outer size, margins included", () => {
    const panel = new Panel({
      width: 100,
      height: 40,
      layout: { type: "stack", align: "center" },
    });
    const box = new Box(20, 10);
    box.margin.set(4, 0, 0, 0); // top only: outer height 14
    panel.add(box);
    panel.layout();
    expect(box.layoutTop).toBe(17); // (40 − 14) / 2 + 4
  });
});

describe("nesting", () => {
  it("lays a whole subtree out from one call on the root", () => {
    const root = new Panel({
      width: 100,
      height: 100,
      layout: { type: "stack", direction: "column", padding: 10 },
    });
    const inner = new Panel({
      width: 60,
      height: 40,
      layout: { type: "stack", padding: 5, gap: 5 },
    });
    const first = new Box(10, 10);
    const second = new Box(10, 10);
    inner.add(first, second);
    root.add(inner);

    root.layout();

    expect(inner.layoutLeft).toBe(10);
    expect(inner.layoutTop).toBe(10);
    expect(first.layoutLeft).toBe(5);
    expect(second.layoutLeft).toBe(20);
    // World-space position: the child's own frame, and its parent's negation.
    expect(second.transform.position.x).toBe(20);
    expect(second.transform.position.y).toBe(-5);
  });

  it("allocates no math objects in a warm pass (§7b)", () => {
    const root = new Panel({
      width: 100,
      height: 100,
      layout: { type: "flex", direction: "column", gap: 4, padding: 6 },
    });
    const grower = new Box(10, 10);
    grower.grow = 1;
    root.add(grower, new Box(10, 10));
    root.layout();

    resetConstructionCount();
    root.layout();
    expect(constructionCount()).toBe(0);
  });
});
