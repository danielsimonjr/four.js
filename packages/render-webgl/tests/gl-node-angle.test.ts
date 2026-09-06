/**
 * Compiles one graph that names RFC 0001's `angle` operator — a dedicated
 * file so `node-material-glsl.json` does not have to move.
 */

import { describe, expect, it } from "vitest";

import { emitShaderGraphGlsl } from "../src/index.js";
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

describe("emitShaderGraphGlsl — angle operator", () => {
  it("emits GLSL two-argument atan(y, x) for a vec2", () => {
    const emitted = emitShaderGraphGlsl(angleGraph());
    expect(emitted.fragment).toContain("float n1 = atan(n0.y, n0.x);");
    expect(emitted.fragment).not.toContain("angle(");
  });
});
