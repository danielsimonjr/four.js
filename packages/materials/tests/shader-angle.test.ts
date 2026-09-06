/**
 * RFC 0001 residue — the closed-union `angle` operator (§60), typed and
 * authored here. Backend emission lives in dedicated compile tests so the
 * existing node-material GLSL/WGSL goldens do not move.
 */

import { describe, expect, it } from "vitest";

import {
  NodeMaterialBuilder,
  ShaderGraphBuilder,
  analyzeShaderGraph,
  type ShaderGraph,
  type ShaderNode,
} from "../src/index.js";

const VEC2: ShaderNode = { kind: "constant", type: "vec2", value: [1, 0] };

function angleGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      VEC2,
      { kind: "unary", op: "angle", source: 0 },
      { kind: "constant", type: "vec4", value: [1, 0, 0, 1] },
      { kind: "compose", type: "vec4", parts: [1, 1, 1, 1] },
    ],
    color: 3,
  };
}

describe("shader graph — angle operator (RFC 0001)", () => {
  it("types angle(vec2) as float", () => {
    const analysis = analyzeShaderGraph(angleGraph());
    expect(analysis.nodeTypes[1]).toBe("float");
    expect(analysis.colorReachable[1]).toBe(true);
  });

  it("builds a heading from a vec2 through the fluent surface", () => {
    const builder = new ShaderGraphBuilder();
    const heading = builder.constant([0, 1]).angle();
    builder.output.color = builder.vec4(heading, 0, 0, 1);
    const graph = builder.graph();
    const angleNode = graph.nodes[heading.nodeId];
    expect(angleNode).toEqual({ kind: "unary", op: "angle", source: 0 });
    expect(analyzeShaderGraph(graph).nodeTypes[heading.nodeId]).toBe("float");
  });

  it("compiles a NodeMaterial whose graph names the operator", () => {
    const material = new NodeMaterialBuilder();
    material.output.color = material.vec4(
      material.angle(material.attribute("uv")),
      0,
      0,
      1,
    );
    const built = material.build();
    expect(
      built.graph.nodes.some(
        (node) => node.kind === "unary" && node.op === "angle",
      ),
    ).toBe(true);
  });
});
