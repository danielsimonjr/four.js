import { describe, expect, it } from "vitest";

import {
  PACKAGE_NAME,
  assertFiniteVec3,
  auditFinalizedLeaks,
  trackDisposable,
  warnImpossibleMass,
  warnVersionMismatch,
} from "../src/index.js";

describe("@four/diagnostics", () => {
  it("exposes its package name", () => {
    expect(PACKAGE_NAME).toBe("@four/diagnostics");
  });

  it("re-exports the A-4/A-5 leak and validation helpers", () => {
    expect(typeof trackDisposable).toBe("function");
    expect(typeof auditFinalizedLeaks).toBe("function");
    expect(typeof assertFiniteVec3).toBe("function");
    expect(typeof warnImpossibleMass).toBe("function");
    expect(typeof warnVersionMismatch).toBe("function");
  });
});
