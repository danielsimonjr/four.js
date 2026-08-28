/**
 * §67's authoring surface at the scene tier (R-23, 2026-08-28): `Node.clip` is
 * a plain boolean field, defaulting off.
 *
 * Everything the flag *does* lives above this package — the render list emits
 * the mask and inherits the test (`@four/render`), the backend writes the
 * stencil (`@four/render-webgl`) — so this file pins only what `@four/scene`
 * promises: the field exists on every node, defaults `false`, and holds what
 * it is assigned. A plain field like `visible` and `layers`, for the recorded
 * reason: the render list reads it once per node per frame and there is no
 * value it can hold that §85 would refuse.
 */

import { describe, expect, it } from "vitest";

import { Group, Scene } from "../src/index.js";

describe("Node.clip (§67)", () => {
  it("defaults to false on every node", () => {
    expect(new Group().clip).toBe(false);
    expect(new Scene().clip).toBe(false);
  });

  it("holds an assignment, and clearing it restores the default", () => {
    const node = new Group();
    node.clip = true;
    expect(node.clip).toBe(true);
    node.clip = false;
    expect(node.clip).toBe(false);
  });

  it("does not inherit through the graph — the subtree effect is the render list's", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    parent.clip = true;
    expect(child.clip).toBe(false);
  });
});
