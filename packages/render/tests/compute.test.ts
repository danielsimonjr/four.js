/**
 * §82's promoted compute vocabulary (the Q3 promotion, 2026-08-29): the
 * descriptor and handle types, the entry-point constant, and the
 * `supportsCompute` guard — the optional-member pattern's fourth instance.
 * The one implementor of `Renderer.compute?()` lives in `@four/render-webgpu`,
 * whose suite pins the dispatch; here the claims are the seam's own.
 */

import { describe, expect, it } from "vitest";

import {
  COMPUTE_ENTRY_POINT,
  NullRenderer,
  supportsCompute,
  type ComputeBuffer,
  type ComputePassDescriptor,
  type Renderer,
} from "../src/index.js";

/** A minimal structural buffer handle — proof the seam needs no backend. */
function fakeBuffer(): ComputeBuffer {
  return {
    isComputeBuffer: true,
    byteLength: 16,
    disposed: false,
    dispose: () => undefined,
  };
}

describe("supportsCompute (§82, presence is the capability)", () => {
  it("answers false for the null renderer — the headless tier has no compute", () => {
    const renderer = new NullRenderer();
    expect(supportsCompute(renderer)).toBe(false);
  });

  it("answers false for a plain object and true for a declarer", () => {
    expect(supportsCompute({})).toBe(false);
    const dispatched: ComputePassDescriptor[] = [];
    const declarer = {
      compute: (pass: ComputePassDescriptor): void => {
        dispatched.push(pass);
      },
    };
    expect(supportsCompute(declarer)).toBe(true);
    if (supportsCompute(declarer)) {
      // The narrowing is usable — the whole point of the guard.
      declarer.compute({
        shader: "@compute fn computeMain() {}",
        workgroups: [1, 1, 1],
        bindings: [],
      });
    }
    expect(dispatched).toHaveLength(1);
  });
});

describe("the promoted descriptor shape", () => {
  it("names computeMain as the default entry point", () => {
    expect(COMPUTE_ENTRY_POINT).toBe("computeMain");
  });

  it("carries bare buffers and access records side by side", () => {
    const buffer = fakeBuffer();
    const descriptor: ComputePassDescriptor = {
      label: "seam",
      shader: "@compute fn computeMain() {}",
      entryPoint: COMPUTE_ENTRY_POINT,
      workgroups: [4, 1, 1],
      bindings: [buffer, { buffer, access: "read-only" }, { buffer }],
    };
    expect(descriptor.bindings).toHaveLength(3);
    expect(descriptor.bindings[0]).toBe(buffer);
  });

  it("is an optional Renderer member — a compute-less implementor satisfies the interface", () => {
    // Compile-time claim, held by the assignment itself: `NullRenderer`
    // declares no `compute` and still is a `Renderer`.
    const renderer: Renderer = new NullRenderer();
    expect("compute" in renderer).toBe(false);
  });
});
