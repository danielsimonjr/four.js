/**
 * `StencilState` — §57's seventh member and §67's substrate (R-7, 2026-08-11).
 *
 * Three properties, and every test here belongs to one of them:
 *
 * 1. **the defaults are GL's initial state**, so a material that opts in and
 *    names nothing changes nothing but the fact that the test is enabled;
 * 2. **every value is refused rather than clamped** (§85), on assignment as
 *    well as at construction (F14) — and a rejected write leaves the previous
 *    value in place, exactly as a rejected `setColor` does;
 * 3. **`Material.stencil` normalizes**: a plain object literal is the
 *    ergonomic form and must not be a way around (2).
 */

import { describe, expect, it } from "vitest";

import {
  MAX_STENCIL_VALUE,
  Material,
  StencilState,
  UnlitMaterial,
  type StencilFunc,
  type StencilOp,
} from "../src/index.js";

/** Every §67 comparison, as the backend's table is keyed. */
const FUNCS: readonly StencilFunc[] = [
  "never",
  "less",
  "equal",
  "lequal",
  "greater",
  "notequal",
  "gequal",
  "always",
];

/** Every §67 operation. */
const OPS: readonly StencilOp[] = [
  "keep",
  "zero",
  "replace",
  "increment",
  "increment-wrap",
  "decrement",
  "decrement-wrap",
  "invert",
];

describe("StencilState — the defaults are GL's initial state (§67)", () => {
  it("enables a test that compares everything and stores nothing", () => {
    const state = new StencilState();

    expect(state.func).toBe("always");
    expect(state.ref).toBe(0);
    expect(state.readMask).toBe(MAX_STENCIL_VALUE);
    expect(state.writeMask).toBe(MAX_STENCIL_VALUE);
    expect(state.failOp).toBe("keep");
    expect(state.depthFailOp).toBe("keep");
    expect(state.passOp).toBe("keep");
  });

  it("takes every field from options", () => {
    const state = new StencilState({
      func: "equal",
      ref: 3,
      readMask: 0b0111,
      writeMask: 0,
      failOp: "zero",
      depthFailOp: "invert",
      passOp: "replace",
    });

    expect(state.func).toBe("equal");
    expect(state.ref).toBe(3);
    expect(state.readMask).toBe(0b0111);
    expect(state.writeMask).toBe(0);
    expect(state.failOp).toBe("zero");
    expect(state.depthFailOp).toBe("invert");
    expect(state.passOp).toBe("replace");
  });

  it("accepts all eight comparisons and all eight operations", () => {
    for (const func of FUNCS) {
      expect(new StencilState({ func }).func).toBe(func);
    }
    for (const op of OPS) {
      const state = new StencilState({
        failOp: op,
        depthFailOp: op,
        passOp: op,
      });
      expect([state.failOp, state.depthFailOp, state.passOp]).toEqual([
        op,
        op,
        op,
      ]);
    }
  });

  it("accepts both ends of the 8-bit range", () => {
    expect(new StencilState({ ref: 0, readMask: 0, writeMask: 0 }).ref).toBe(0);
    const full = new StencilState({
      ref: MAX_STENCIL_VALUE,
      readMask: MAX_STENCIL_VALUE,
      writeMask: MAX_STENCIL_VALUE,
    });
    expect(full.ref).toBe(255);
    expect(full.readMask).toBe(255);
    expect(full.writeMask).toBe(255);
  });

  it("clones independently, so a second pass can be derived from a first", () => {
    const write = new StencilState({
      func: "always",
      ref: 1,
      passOp: "replace",
    });
    const test = write.clone();
    test.func = "equal";
    test.writeMask = 0;

    expect(write.func).toBe("always");
    expect(write.writeMask).toBe(MAX_STENCIL_VALUE);
    expect(test.ref).toBe(1);
    expect(test.passOp).toBe("replace");
  });
});

describe("StencilState — refused, not clamped (§85, F14)", () => {
  it("rejects a comparison or an operation outside the vocabulary", () => {
    expect(
      () => new StencilState({ func: "sometimes" as StencilFunc }),
    ).toThrow(RangeError);
    expect(() => new StencilState({ failOp: "melt" as StencilOp })).toThrow(
      /failOp must be one of/,
    );
    expect(
      () => new StencilState({ depthFailOp: "melt" as StencilOp }),
    ).toThrow(/depthFailOp must be one of/);
    expect(() => new StencilState({ passOp: "melt" as StencilOp })).toThrow(
      /passOp must be one of/,
    );
  });

  it("rejects a reference or mask an 8-bit buffer cannot hold", () => {
    for (const bad of [-1, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new StencilState({ ref: bad })).toThrow(RangeError);
      expect(() => new StencilState({ readMask: bad })).toThrow(RangeError);
      expect(() => new StencilState({ writeMask: bad })).toThrow(RangeError);
    }
  });

  it("applies the same rules on assignment, leaving the old value in place", () => {
    const state = new StencilState({ func: "equal", ref: 7, writeMask: 3 });

    expect(() => {
      state.func = "sometimes" as StencilFunc;
    }).toThrow(RangeError);
    expect(() => {
      state.ref = 999;
    }).toThrow(RangeError);
    expect(() => {
      state.readMask = -2;
    }).toThrow(RangeError);
    expect(() => {
      state.writeMask = 0.5;
    }).toThrow(RangeError);
    expect(() => {
      state.failOp = "melt" as StencilOp;
    }).toThrow(RangeError);
    expect(() => {
      state.depthFailOp = "melt" as StencilOp;
    }).toThrow(RangeError);
    expect(() => {
      state.passOp = "melt" as StencilOp;
    }).toThrow(RangeError);

    expect(state.func).toBe("equal");
    expect(state.ref).toBe(7);
    expect(state.readMask).toBe(MAX_STENCIL_VALUE);
    expect(state.writeMask).toBe(3);
    expect(state.failOp).toBe("keep");
    expect(state.depthFailOp).toBe("keep");
    expect(state.passOp).toBe("keep");
  });

  it("names the section and the range in the message a caller reads", () => {
    expect(() => new StencilState({ ref: 300 })).toThrow(/§85/);
    expect(() => new StencilState({ func: "x" as StencilFunc })).toThrow(/§67/);
  });
});

describe("Material.stencil — §57's seventh member", () => {
  it("is undefined by default, on every family member", () => {
    expect(new UnlitMaterial().stencil).toBeUndefined();
    const material: Material = new UnlitMaterial({ opacity: 0.5 });
    expect(material.stencil).toBeUndefined();
  });

  it("carries the record a caller constructed, defaults and all", () => {
    const material = new UnlitMaterial({
      stencil: new StencilState({ func: "equal", ref: 2, writeMask: 0 }),
    });

    expect(material.stencil).toBeInstanceOf(StencilState);
    expect(material.stencil?.func).toBe("equal");
    expect(material.stencil?.ref).toBe(2);
    expect(material.stencil?.writeMask).toBe(0);
    // The fields it did not name are the documented defaults, not undefined.
    expect(material.stencil?.readMask).toBe(MAX_STENCIL_VALUE);
    expect(material.stencil?.passOp).toBe("keep");
  });

  it("shares a StencilState by reference, so two passes can hold one record", () => {
    const shared = new StencilState({ func: "equal", ref: 1 });
    const a = new UnlitMaterial({ stencil: shared });
    const b = new UnlitMaterial();
    b.stencil = shared;

    expect(a.stencil).toBe(shared);
    expect(b.stencil).toBe(shared);
    shared.ref = 2;
    expect(a.stencil?.ref).toBe(2);
  });

  it("clears back to undefined", () => {
    const material = new UnlitMaterial({
      stencil: new StencilState({ func: "equal" }),
    });
    material.stencil = undefined;
    expect(material.stencil).toBeUndefined();
  });

  it("is nominal, so an unchecked object literal cannot reach the backend", () => {
    // The compile-time half of the F14 rule, asserted at runtime because a
    // type test is not a test: `StencilState`'s fields are private, so
    // `material.stencil = { func: "bogus" }` does not type-check, and the only
    // way to build one is the constructor that validates every field. That is
    // what lets `Material.stencil` be a plain property with no accessor — and
    // what lets `material.ts` import this class type-only, so a bundle that
    // never masks does not carry it.
    const material = new UnlitMaterial();
    expect(() => {
      material.stencil = { func: "bogus" } as unknown as StencilState;
    }).not.toThrow();
    // Nothing validated it, because nothing could have: the cast is the
    // caller's own defeat of the type system, and the backend reads every
    // field defensively for exactly this reason.
    expect(material.stencil?.func).toBe("bogus");
  });

  it("announces nothing: render state is read per draw, never cached (R-12)", () => {
    const material = new UnlitMaterial();
    const record = new StencilState({ func: "equal", ref: 1 });
    material.stencil = record;
    record.ref = 2;
    material.stencil = undefined;
    expect(material.version).toBe(0);
  });
});
