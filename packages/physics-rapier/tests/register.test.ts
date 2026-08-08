import { isFourError } from "@four/core";
import { SolverRegistry, registeredSolvers } from "@four/physics";
import { describe, expect, it } from "vitest";

import {
  Rapier2dAdapter,
  Rapier3dAdapter,
  createRapierAdapter,
  isRapierSupported,
  registerRapierSolver,
} from "../src/index.js";

describe("isRapierSupported", () => {
  it("answers true wherever WebAssembly exists", () => {
    expect(isRapierSupported()).toBe(typeof WebAssembly !== "undefined");
    expect(isRapierSupported()).toBe(true);
  });
});

describe("createRapierAdapter", () => {
  it("builds the adapter for the world's §21 dimension", () => {
    const two = createRapierAdapter({ dimension: "2d" });
    const three = createRapierAdapter({ dimension: "3d" });
    expect(two).toBeInstanceOf(Rapier2dAdapter);
    expect(three).toBeInstanceOf(Rapier3dAdapter);
    expect(two.capabilities.dimensions).toEqual(["2d"]);
    expect(three.capabilities.dimensions).toEqual(["3d"]);
    two.dispose();
    three.dispose();
  });

  it("loads no wasm image (§37 puts the load in `initialize`)", () => {
    // §37's `version` reads out of the wasm module and is empty until
    // `initialize` has loaded it (`init.ts`), so an empty string here is the
    // observable proof that constructing an adapter decoded nothing.
    expect(createRapierAdapter({ dimension: "3d" }).version).toBe("");
  });
});

describe("registerRapierSolver", () => {
  it("registers Rapier into the registry it is given", () => {
    const registry = new SolverRegistry();
    expect(registerRapierSolver(registry)).toBe(registry);
    expect(registry.solvers).toEqual(["rapier"]);
    // The shared registry is untouched, which is what keeps this test hermetic.
    expect(registeredSolvers()).toEqual([]);
  });

  it('serves both §21 dimensions through one "auto" registration', () => {
    const registry = new SolverRegistry();
    registerRapierSolver(registry);
    expect(registry.resolve("auto", { dimension: "2d" })).toBeInstanceOf(
      Rapier2dAdapter,
    );
    expect(registry.resolve("auto", { dimension: "3d" })).toBeInstanceOf(
      Rapier3dAdapter,
    );
    expect(registry.resolve("rapier", { dimension: "3d" })).toBeInstanceOf(
      Rapier3dAdapter,
    );
  });

  it("declares only the §33 tier the adapters declare", () => {
    const registry = new SolverRegistry();
    registerRapierSolver(registry);
    // Both Rapier adapters declare `"same-runtime"`, so a world asking for
    // `"cross-platform"` gets a §37 rejection rather than a silent downgrade.
    expect(() =>
      registry.resolve("auto", {
        dimension: "3d",
        determinism: "cross-platform",
      }),
    ).toThrow(/"rapier" \(determinism\)/);
  });

  it("refuses a second registration in the same registry (§37)", () => {
    const registry = new SolverRegistry();
    registerRapierSolver(registry);
    let thrown: unknown;
    try {
      registerRapierSolver(registry);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isFourError(thrown)).toBe(true);
    if (isFourError(thrown)) {
      expect(thrown.code).toBe("INVALID_APPLICATION_STATE");
    }
  });
});
