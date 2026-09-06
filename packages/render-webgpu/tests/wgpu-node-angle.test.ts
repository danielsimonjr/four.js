/**
 * Compiles one graph that names RFC 0001's `angle` operator — a dedicated
 * file so `node-material-wgsl.json` does not have to move.
 */

import { describe, expect, it } from "vitest";

import { emitShaderGraphWgsl } from "../src/index.js";
import type { ShaderGraph } from "@four/render";

function angleGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      { kind: "attribute", name: "uv" },
      { kind: "unary", op: "angle", source: 0 },
      { kind: "constant", type: "vec3", value: [0, 0, 1] },
      { kind: "compose", type: "vec4", parts: [1, 2] },
    ],
    color: 3,
  };
}

describe("emitShaderGraphWgsl — angle operator", () => {
  it("emits WGSL atan2(y, x) for a vec2", () => {
    const emitted = emitShaderGraphWgsl(angleGraph());
    expect(emitted.code).toContain("let n1 : f32 = atan2(n0.y, n0.x);");
    expect(emitted.code).not.toContain("angle(");
  });
});
