/**
 * `Four.ComputePass` (§82; the Q3 promotion, 2026-08-29) — the named-map
 * sugar's one behavioural claim: a bindings record's keys become binding
 * indices in insertion order, and the result *is* `@four/render`'s ordered
 * `ComputePassDescriptor`, verbatim otherwise.
 */

import type { ComputeBuffer, ComputePassDescriptor } from "@four/render";
import { describe, expect, it } from "vitest";

import { ComputePass } from "../src/compute-pass.js";

/** A minimal structural handle — the sugar never touches a device. */
function buffer(byteLength: number): ComputeBuffer {
  return {
    isComputeBuffer: true,
    byteLength,
    disposed: false,
    dispose: () => undefined,
  };
}

const SHADER = "@compute fn computeMain() {}";

describe("Four.ComputePass (§82)", () => {
  it("maps a named record to binding indices in key insertion order", () => {
    const parameters = buffer(32);
    const positions = buffer(96);
    const velocities = buffer(96);
    const pass = new ComputePass({
      label: "integrate",
      shader: SHADER,
      workgroups: [4, 1, 1],
      bindings: {
        parameters: { buffer: parameters, access: "read-only" },
        positions,
        velocities,
      },
    });
    expect(pass.bindingNames).toEqual([
      "parameters",
      "positions",
      "velocities",
    ]);
    expect(pass.bindings).toHaveLength(3);
    expect(pass.bindings[0]).toEqual({
      buffer: parameters,
      access: "read-only",
    });
    expect(pass.bindings[1]).toBe(positions);
    expect(pass.bindings[2]).toBe(velocities);
    expect(pass.label).toBe("integrate");
    expect(pass.shader).toBe(SHADER);
    expect(pass.entryPoint).toBeUndefined();
  });

  it("orders by insertion, not alphabetically — the map is the layout", () => {
    const zebra = buffer(4);
    const apple = buffer(4);
    const pass = new ComputePass({
      shader: SHADER,
      workgroups: [1, 1, 1],
      bindings: { zebra, apple },
    });
    expect(pass.bindingNames).toEqual(["zebra", "apple"]);
    expect(pass.bindings[0]).toBe(zebra);
  });

  it("passes an ordered array through verbatim, with no names", () => {
    const first = buffer(4);
    const second = buffer(8);
    const pass = new ComputePass({
      shader: SHADER,
      entryPoint: "step",
      workgroups: [2, 3, 4],
      bindings: [first, { buffer: second, access: "read-only" }],
    });
    expect(pass.bindingNames).toEqual([]);
    expect(pass.bindings[0]).toBe(first);
    expect(pass.bindings[1]).toEqual({ buffer: second, access: "read-only" });
    expect(pass.entryPoint).toBe("step");
    expect(pass.workgroups).toEqual([2, 3, 4]);
  });

  it("defaults omitted bindings to a binding-less kernel", () => {
    const pass = new ComputePass({ shader: SHADER, workgroups: [1, 1, 1] });
    expect(pass.bindings).toEqual([]);
    expect(pass.bindingNames).toEqual([]);
  });

  it("copies and freezes — later mutation of the sources changes nothing", () => {
    const workgroups: [number, number, number] = [1, 1, 1];
    const entries = [buffer(4)];
    const pass = new ComputePass({
      shader: SHADER,
      workgroups,
      bindings: entries,
    });
    workgroups[0] = 99;
    entries.push(buffer(8));
    expect(pass.workgroups).toEqual([1, 1, 1]);
    expect(pass.bindings).toHaveLength(1);
    expect(Object.isFrozen(pass.workgroups)).toBe(true);
    expect(Object.isFrozen(pass.bindings)).toBe(true);
    expect(Object.isFrozen(pass.bindingNames)).toBe(true);
  });

  it("is itself the descriptor the seam consumes", () => {
    // Compile-time claim held by the assignment; runtime spot-checks ride
    // along so the test says something even in a transpiled world.
    const descriptor: ComputePassDescriptor = new ComputePass({
      shader: SHADER,
      workgroups: [1, 1, 1],
      bindings: { data: buffer(16) },
    });
    expect(descriptor.shader).toBe(SHADER);
    expect(descriptor.bindings).toHaveLength(1);
  });
});
