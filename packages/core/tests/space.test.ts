/**
 * §8 *Space Modes* — the vocabulary and the predicate (PH-12, 2026-08-09).
 *
 * `space.ts` is a union, a default, a frozen list and one predicate, so this
 * file is short by construction. What it pins is the part a later edit could
 * quietly get wrong: that the union is §8's own six members in §8's own order,
 * and that {@link isSimulationSpaceMode} answers **§8's sentence** rather than
 * "what `@four/physics` happens to accept today" — the two are deliberately
 * different for `"local-plane"`, and a packet that implements §21's mapping
 * must be able to tell them apart.
 *
 * The frame a body is actually solved in is `RigidBody.space`, and its refusals
 * are pinned by `packages/physics/tests/world-space-mode.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SPACE_MODE,
  SPACE_MODES,
  isSimulationSpaceMode,
} from "../src/index.js";

describe("§8 the SpaceMode vocabulary", () => {
  it("is §8's six members, in §8's order", () => {
    expect(SPACE_MODES).toEqual([
      "world",
      "screen",
      "viewport",
      "camera",
      "billboard",
      "local-plane",
    ]);
  });

  it("is frozen, so a caller cannot re-order every later reader's answer", () => {
    expect(Object.isFrozen(SPACE_MODES)).toBe(true);
  });

  it("defaults to world, which is the frame every existing node is in", () => {
    expect(DEFAULT_SPACE_MODE).toBe("world");
    expect(SPACE_MODES).toContain(DEFAULT_SPACE_MODE);
  });
});

describe("§8 isSimulationSpaceMode", () => {
  it("admits exactly world and local-plane", () => {
    // "Physics normally operates in world or local-plane space" — the whole of
    // §8's first sentence, enumerated rather than paraphrased.
    const admitted = SPACE_MODES.filter((mode) => isSimulationSpaceMode(mode));
    expect(admitted).toEqual(["world", "local-plane"]);
  });

  it("rejects every presentation frame", () => {
    for (const mode of ["screen", "viewport", "camera", "billboard"] as const) {
      expect(isSimulationSpaceMode(mode)).toBe(false);
    }
  });

  it("is the specification's line and not an implementation status", () => {
    // `"local-plane"` is admitted here and still refused by
    // `PhysicsWorld.addBody`, because §21's plane→XY mapping is unbuilt. The
    // two questions must stay separable: this assertion is what breaks if
    // someone "fixes" the predicate to match what physics accepts.
    expect(isSimulationSpaceMode("local-plane")).toBe(true);
  });
});
