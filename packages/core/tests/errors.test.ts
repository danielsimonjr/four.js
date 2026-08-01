import { describe, expect, it } from "vitest";

import { disposeAll, type Disposable } from "../src/disposable.js";
import { FourError, isFourError, type FourErrorCode } from "../src/errors.js";

describe("FourError (§89)", () => {
  it("carries a code and a message", () => {
    const error = new FourError("ASSET_LOAD_FAILED", "Could not load texture.");

    expect(error.code).toBe("ASSET_LOAD_FAILED");
    expect(error.message).toBe("Could not load texture.");
    expect(error.name).toBe("FourError");
    expect(error.context).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it("is an Error and a FourError", () => {
    const error = new FourError("DEVICE_LOST", "The GPU device was lost.");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(FourError);
    expect(isFourError(error)).toBe(true);
    expect(isFourError(new Error("plain"))).toBe(false);
    expect(isFourError(undefined)).toBe(false);
    expect(String(error)).toBe("FourError: The GPU device was lost.");
    expect(typeof error.stack).toBe("string");
  });

  it("propagates structured context", () => {
    const context = { url: "/models/robot.glb", status: 404 };
    const error = new FourError("ASSET_LOAD_FAILED", "Load failed.", {
      context,
    });

    expect(error.context).toEqual(context);
    expect(error.context?.status).toBe(404);
  });

  it("propagates the cause through the standard Error.cause chain", () => {
    const cause = new Error("WebGL context creation returned null");
    const error = new FourError(
      "RENDERER_INITIALIZATION_FAILED",
      "Renderer initialization failed.",
      { cause },
    );

    expect(error.cause).toBe(cause);
  });

  it("accepts a non-Error cause", () => {
    const error = new FourError("PHYSICS_SOLVER_FAILED", "Solver failed.", {
      cause: { solver: "rapier", islands: 3 },
    });

    expect(error.cause).toEqual({ solver: "rapier", islands: 3 });
  });

  it("carries context and cause together", () => {
    const cause = new Error("shader log");
    const error = new FourError(
      "SHADER_COMPILATION_FAILED",
      "Shader compilation failed.",
      { context: { stage: "fragment" }, cause },
    );

    expect(error.context).toEqual({ stage: "fragment" });
    expect(error.cause).toBe(cause);
  });

  it("survives being thrown and caught", () => {
    const thrower = (): never => {
      throw new FourError("INVALID_SCENE_GRAPH", "Cycle detected.", {
        context: { nodeId: "n-3" },
      });
    };

    expect(thrower).toThrow(FourError);
    try {
      thrower();
      expect.unreachable("thrower must throw");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      if (isFourError(error)) {
        expect(error.code).toBe("INVALID_SCENE_GRAPH");
        expect(error.context).toEqual({ nodeId: "n-3" });
      }
    }
  });

  it("covers the §89 code list, including CONTEXT_LOST and DEVICE_LOST", () => {
    const codes: FourErrorCode[] = [
      "RENDERER_INITIALIZATION_FAILED",
      "UNSUPPORTED_GPU_FEATURE",
      "ASSET_LOAD_FAILED",
      "SHADER_COMPILATION_FAILED",
      "CONTEXT_LOST",
      "DEVICE_LOST",
      "INVALID_SCENE_GRAPH",
      "PHYSICS_SOLVER_FAILED",
      "SERIALIZATION_VERSION_MISMATCH",
    ];

    for (const code of codes) {
      expect(new FourError(code, code).code).toBe(code);
    }
    expect(codes).toHaveLength(9);
  });
});

class Resource implements Disposable {
  disposed = false;

  constructor(
    readonly label: string,
    private readonly log: string[],
    private readonly failure?: Error,
  ) {}

  dispose(): void {
    this.disposed = true;
    this.log.push(this.label);
    if (this.failure !== undefined) {
      throw this.failure;
    }
  }
}

describe("Disposable / disposeAll (§83)", () => {
  it("disposes in reverse insertion order", () => {
    const log: string[] = [];
    const items = [
      new Resource("device", log),
      new Resource("texture", log),
      new Resource("render-target", log),
    ];

    disposeAll(items);

    expect(log).toEqual(["render-target", "texture", "device"]);
    expect(items.every((item) => item.disposed)).toBe(true);
  });

  it("accepts any iterable, including a Set", () => {
    const log: string[] = [];
    const items = new Set([new Resource("a", log), new Resource("b", log)]);

    disposeAll(items);

    expect(log).toEqual(["b", "a"]);
  });

  it("does nothing for an empty iterable", () => {
    expect(() => {
      disposeAll([]);
    }).not.toThrow();
  });

  it("disposes the remaining items even when one throws, rethrowing the first failure", () => {
    const log: string[] = [];
    const failure = new FourError("DEVICE_LOST", "device already lost");
    const first = new Resource("device", log);
    const failing = new Resource("texture", log, failure);
    const last = new Resource("render-target", log);

    expect(() => {
      disposeAll([first, failing, last]);
    }).toThrow(failure);

    expect(log).toEqual(["render-target", "texture", "device"]);
    expect(first.disposed).toBe(true);
    expect(last.disposed).toBe(true);
  });

  it("rethrows the first failure when several items throw", () => {
    const log: string[] = [];
    const firstFailure = new Error("outer");
    const secondFailure = new Error("inner");
    // Reverse order: "b" is disposed first, so its failure is the first one.
    const a = new Resource("a", log, secondFailure);
    const b = new Resource("b", log, firstFailure);

    expect(() => {
      disposeAll([a, b]);
    }).toThrow(firstFailure);

    expect(log).toEqual(["b", "a"]);
  });
});
