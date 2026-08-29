/**
 * §71's authoring surface at the scene tier (A-11, adopted RFC 0005 Q3,
 * 2026-08-29): `Node.hitTestMode` is a plain field, defaulting `null`.
 *
 * Everything the mode *does* lives above this package — `@four/input`'s
 * `pick()` dispatches on it, the candidate data each strategy needs rides the
 * `Pickable` — so this file pins only what `@four/scene` promises: the field
 * exists on every node, defaults `null` (§71's "the engine should select the
 * cheapest valid method"), holds what it is assigned, and gates the node
 * rather than the subtree. A plain field like `visible`, `layers` and `clip`,
 * for the recorded reason: `pick()` reads it once per candidate per pick and
 * the union is the check — there is no assignable value §85 would refuse.
 */

import { describe, expect, it } from "vitest";

import { Group, Scene, type HitTestMode } from "../src/index.js";

describe("Node.hitTestMode (§71)", () => {
  it("defaults to null on every node — §71's engine-selects rule", () => {
    expect(new Group().hitTestMode).toBeNull();
    expect(new Scene().hitTestMode).toBeNull();
  });

  it("holds each strategy value, and clearing it restores the default", () => {
    const node = new Group();
    const modes: readonly HitTestMode[] = [
      "bounds",
      "geometry",
      "pixel",
      "gpu",
    ];
    for (const mode of modes) {
      node.hitTestMode = mode;
      expect(node.hitTestMode).toBe(mode);
    }
    node.hitTestMode = null;
    expect(node.hitTestMode).toBeNull();
  });

  it("does not inherit through the graph — the mode gates the node, not the subtree", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);
    parent.hitTestMode = "geometry";
    expect(child.hitTestMode).toBeNull();
  });
});
