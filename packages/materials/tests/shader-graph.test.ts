/**
 * §60's shader-graph IR (RFC 0001): `analyzeShaderGraph`'s type rules and §85
 * refusals, reflection and reachability, `freezeShaderGraph`, and the shared
 * reference walk. Every refusal here is a setup-time `RangeError` — the §85
 * stance the whole family takes: a backend never validates inside a frame.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_SHADER_GRAPH_NODES,
  MAX_SHADER_GRAPH_TEXTURES,
  SHADER_ATTRIBUTE_TYPES,
  SHADER_VALUE_COMPONENTS,
  analyzeShaderGraph,
  forEachShaderNodeReference,
  freezeShaderGraph,
  type ShaderGraph,
  type ShaderNode,
} from "../src/index.js";

/** A well-formed surface graph: `color = vec4(constant)`. */
function colorOnly(nodes: ShaderNode[], color = nodes.length - 1): ShaderGraph {
  return { domain: "surface", nodes, color };
}

const VEC4: ShaderNode = {
  kind: "constant",
  type: "vec4",
  value: [1, 0, 0, 1],
};

const VEC2: ShaderNode = { kind: "constant", type: "vec2", value: [0, 1] };

const FLOAT: ShaderNode = { kind: "constant", type: "float", value: [0.5] };

describe("analyzeShaderGraph — §85 refusals", () => {
  /** Every table row must throw a RangeError whose message contains `part`. */
  const refusals: [name: string, graph: ShaderGraph, part: string][] = [
    [
      "unknown domain",
      { domain: "flat" as never, nodes: [VEC4], color: 0 },
      "unknown domain",
    ],
    [
      "non-array nodes",
      { domain: "surface", nodes: null as never, color: 0 },
      "at least one node",
    ],
    [
      "empty nodes",
      { domain: "surface", nodes: [], color: 0 },
      "at least one node",
    ],
    [
      "too many nodes",
      colorOnly(Array.from({ length: MAX_SHADER_GRAPH_NODES + 1 }, () => VEC4)),
      "exceed the limit",
    ],
    [
      "constant of unknown type",
      colorOnly([{ kind: "constant", type: "vec5" as never, value: [0] }]),
      "unknown type",
    ],
    [
      "constant with the wrong arity",
      colorOnly([{ kind: "constant", type: "vec3", value: [1, 2] }]),
      "needs 3 components",
    ],
    [
      "constant with a non-finite component",
      colorOnly([{ kind: "constant", type: "float", value: [Number.NaN] }]),
      "must be finite",
    ],
    [
      "uniform of unknown type",
      colorOnly([{ kind: "uniform", type: "bool" as never, name: "a" }]),
      "unknown type",
    ],
    [
      "uniform with a non-identifier name",
      colorOnly([{ kind: "uniform", type: "float", name: "1abc" }]),
      "must be an identifier",
    ],
    [
      "uniform with a double underscore",
      colorOnly([{ kind: "uniform", type: "float", name: "a__b" }]),
      "must be an identifier",
    ],
    [
      "uniform with an overlong name",
      colorOnly([
        { kind: "uniform", type: "float", name: `a${"b".repeat(64)}` },
      ]),
      "must be an identifier",
    ],
    [
      "one uniform name with two types",
      colorOnly([
        { kind: "uniform", type: "float", name: "a" },
        { kind: "uniform", type: "vec2", name: "a" },
        VEC4,
      ]),
      "one name has one type",
    ],
    [
      "unknown attribute",
      colorOnly([{ kind: "attribute", name: "tangent" as never }]),
      "unknown attribute",
    ],
    [
      "screen-domain attribute other than uv",
      {
        domain: "screen",
        nodes: [{ kind: "attribute", name: "position" }, VEC4],
        color: 1,
      },
      "has no mesh",
    ],
    [
      "texture with a bad name",
      colorOnly([VEC2, { kind: "texture", name: "_s", uv: 0 }]),
      "must be an identifier",
    ],
    [
      "texture with a non-integer uv reference",
      colorOnly([VEC2, { kind: "texture", name: "s", uv: 0.5 }]),
      "must reference an earlier node",
    ],
    [
      "texture with a negative uv reference",
      colorOnly([VEC2, { kind: "texture", name: "s", uv: -1 }]),
      "must reference an earlier node",
    ],
    [
      "texture with a forward uv reference",
      colorOnly([VEC2, { kind: "texture", name: "s", uv: 1 }]),
      "must reference an earlier node",
    ],
    [
      "texture whose uv is not vec2",
      colorOnly([FLOAT, { kind: "texture", name: "s", uv: 0 }]),
      "uv must be vec2",
    ],
    [
      "compose of a non-vector type",
      colorOnly([FLOAT, { kind: "compose", type: "float", parts: [0] }]),
      "compose builds vectors",
    ],
    [
      "compose with a bad part reference",
      colorOnly([{ kind: "compose", type: "vec2", parts: [0] }]),
      "must reference an earlier node",
    ],
    [
      "compose over a matrix part",
      colorOnly([
        { kind: "uniform", type: "mat3", name: "m" },
        { kind: "compose", type: "vec2", parts: [0] },
      ]),
      "floats or vectors",
    ],
    [
      "compose with the wrong total",
      colorOnly([FLOAT, { kind: "compose", type: "vec3", parts: [0, 0] }]),
      "composes exactly 3 components",
    ],
    [
      "swizzle with a bad reference",
      colorOnly([{ kind: "swizzle", source: 0, pattern: "x" }]),
      "must reference an earlier node",
    ],
    [
      "swizzle of a non-vector",
      colorOnly([FLOAT, { kind: "swizzle", source: 0, pattern: "x" }]),
      "needs a vector source",
    ],
    [
      "swizzle with a malformed pattern",
      colorOnly([VEC4, { kind: "swizzle", source: 0, pattern: "rgba" }]),
      "components of xyzw",
    ],
    [
      "swizzle outside the source's size",
      colorOnly([VEC2, { kind: "swizzle", source: 0, pattern: "z" }]),
      "outside a vec2",
    ],
    [
      "unary with a bad reference",
      colorOnly([{ kind: "unary", op: "sin", source: 2 }]),
      "must reference an earlier node",
    ],
    [
      "normalize of a float",
      colorOnly([FLOAT, { kind: "unary", op: "normalize", source: 0 }]),
      "normalize needs a vector",
    ],
    [
      "length of a matrix",
      colorOnly([
        { kind: "uniform", type: "mat4", name: "m" },
        { kind: "unary", op: "length", source: 0 },
      ]),
      "length needs a vector",
    ],
    [
      "angle of a float",
      colorOnly([FLOAT, { kind: "unary", op: "angle", source: 0 }]),
      "angle needs a vec2",
    ],
    [
      "angle of a vec3",
      colorOnly([
        { kind: "constant", type: "vec3", value: [1, 0, 0] },
        { kind: "unary", op: "angle", source: 0 },
      ]),
      "angle needs a vec2",
    ],
    [
      "sin of a matrix",
      colorOnly([
        { kind: "uniform", type: "mat4", name: "m" },
        { kind: "unary", op: "sin", source: 0 },
      ]),
      "needs a float or vector",
    ],
    [
      "binary with a bad left reference",
      colorOnly([FLOAT, { kind: "binary", op: "add", left: 3, right: 0 }]),
      "must reference an earlier node",
    ],
    [
      "binary with a bad right reference",
      colorOnly([FLOAT, { kind: "binary", op: "add", left: 0, right: 3 }]),
      "must reference an earlier node",
    ],
    [
      "dot of mismatched vectors",
      colorOnly([VEC2, VEC4, { kind: "binary", op: "dot", left: 0, right: 1 }]),
      "dot needs two vectors",
    ],
    [
      "step with a mismatched edge",
      colorOnly([
        VEC2,
        VEC4,
        { kind: "binary", op: "step", left: 0, right: 1 },
      ]),
      "step needs",
    ],
    [
      "step over a matrix",
      colorOnly([
        FLOAT,
        { kind: "uniform", type: "mat3", name: "m" },
        { kind: "binary", op: "step", left: 0, right: 1 },
      ]),
      "step needs",
    ],
    [
      "add of mismatched vectors",
      colorOnly([VEC2, VEC4, { kind: "binary", op: "add", left: 0, right: 1 }]),
      "cannot combine",
    ],
    [
      "add of a matrix",
      colorOnly([
        { kind: "uniform", type: "mat3", name: "m" },
        { kind: "uniform", type: "mat3", name: "m" },
        { kind: "binary", op: "add", left: 0, right: 1 },
      ]),
      "cannot combine",
    ],
    [
      "multiply of mat3 by vec4",
      colorOnly([
        { kind: "uniform", type: "mat3", name: "m" },
        VEC4,
        { kind: "binary", op: "multiply", left: 0, right: 1 },
      ]),
      "cannot combine",
    ],
    [
      "mix with a bad a reference",
      colorOnly([FLOAT, { kind: "mix", a: 9, b: 0, t: 0 }]),
      "must reference an earlier node",
    ],
    [
      "mix with a bad b reference",
      colorOnly([FLOAT, { kind: "mix", a: 0, b: 9, t: 0 }]),
      "must reference an earlier node",
    ],
    [
      "mix with a bad t reference",
      colorOnly([FLOAT, { kind: "mix", a: 0, b: 0, t: 9 }]),
      "must reference an earlier node",
    ],
    [
      "mix of a matrix",
      colorOnly([
        { kind: "uniform", type: "mat3", name: "m" },
        { kind: "mix", a: 0, b: 0, t: 0 },
      ]),
      "mix blends",
    ],
    [
      "mix of mismatched values",
      colorOnly([VEC2, VEC4, FLOAT, { kind: "mix", a: 0, b: 1, t: 2 }]),
      "mix blends",
    ],
    [
      "mix with a mismatched t",
      colorOnly([VEC4, VEC4, VEC2, { kind: "mix", a: 0, b: 1, t: 2 }]),
      "mix t must be float or vec4",
    ],
    [
      "unknown node kind",
      colorOnly([{ kind: "noise" } as never]),
      "unknown node kind",
    ],
    [
      "non-integer color",
      { domain: "surface", nodes: [VEC4], color: 0.5 },
      "color must name a node",
    ],
    [
      "out-of-range color",
      { domain: "surface", nodes: [VEC4], color: 1 },
      "color must name a node",
    ],
    [
      "non-vec4 color",
      { domain: "surface", nodes: [FLOAT], color: 0 },
      "color must be vec4",
    ],
    [
      "positionOffset on a screen graph",
      {
        domain: "screen",
        nodes: [{ kind: "constant", type: "vec3", value: [0, 0, 0] }, VEC4],
        color: 1,
        positionOffset: 0,
      },
      "no vertices to move",
    ],
    [
      "out-of-range positionOffset",
      { domain: "surface", nodes: [VEC4], color: 0, positionOffset: 4 },
      "positionOffset must name a node",
    ],
    [
      "non-vec3 positionOffset",
      { domain: "surface", nodes: [VEC4], color: 0, positionOffset: 0 },
      "positionOffset must be vec3",
    ],
    [
      "texture feeding positionOffset",
      {
        domain: "surface",
        nodes: [
          VEC2,
          { kind: "texture", name: "s", uv: 0 },
          { kind: "swizzle", source: 1, pattern: "xyz" },
          VEC4,
        ],
        color: 3,
        positionOffset: 2,
      },
      "cannot feed positionOffset",
    ],
  ];

  it.each(refusals)("refuses %s", (_name, graph, part) => {
    expect(() => analyzeShaderGraph(graph)).toThrowError(RangeError);
    expect(() => analyzeShaderGraph(graph)).toThrowError(part);
  });

  it("refuses a graph binding more than the sampler cap", () => {
    const nodes: ShaderNode[] = [VEC2];
    for (let index = 0; index < MAX_SHADER_GRAPH_TEXTURES + 1; index += 1) {
      nodes.push({ kind: "texture", name: `t${String(index)}`, uv: 0 });
    }
    // Sum the nine samples into one vec4 so every texture is reachable.
    let previous = 1;
    for (let index = 2; index <= MAX_SHADER_GRAPH_TEXTURES + 1; index += 1) {
      nodes.push({
        kind: "binary",
        op: "add",
        left: previous,
        right: index,
      });
      previous = nodes.length - 1;
    }
    const graph: ShaderGraph = { domain: "surface", nodes, color: previous };
    expect(() => analyzeShaderGraph(graph)).toThrowError("exceed the limit");
  });
});

describe("analyzeShaderGraph — types, reflection, reachability", () => {
  it("types every closed operator as specified", () => {
    const nodes: ShaderNode[] = [
      /* 0 */ FLOAT,
      /* 1 */ VEC2,
      /* 2 */ { kind: "constant", type: "vec3", value: [1, 2, 3] },
      /* 3 */ VEC4,
      /* 4 */ { kind: "uniform", type: "mat3", name: "m3" },
      /* 5 */ { kind: "uniform", type: "mat4", name: "m4" },
      /* 6 */ { kind: "time" },
      /* 7 */ { kind: "attribute", name: "position" },
      /* 8 */ { kind: "attribute", name: "normal" },
      /* 9 */ { kind: "attribute", name: "uv" },
      /* 10 */ { kind: "attribute", name: "color" },
      /* 11 */ { kind: "binary", op: "multiply", left: 4, right: 4 },
      /* 12 */ { kind: "binary", op: "multiply", left: 5, right: 5 },
      /* 13 */ { kind: "binary", op: "multiply", left: 4, right: 2 },
      /* 14 */ { kind: "binary", op: "multiply", left: 5, right: 3 },
      /* 15 */ { kind: "binary", op: "multiply", left: 0, right: 1 },
      /* 16 */ { kind: "binary", op: "add", left: 1, right: 0 },
      /* 17 */ { kind: "binary", op: "dot", left: 2, right: 2 },
      /* 18 */ { kind: "binary", op: "step", left: 0, right: 3 },
      /* 19 */ { kind: "binary", op: "step", left: 1, right: 1 },
      /* 20 */ { kind: "unary", op: "normalize", source: 2 },
      /* 21 */ { kind: "unary", op: "length", source: 1 },
      /* 22 */ { kind: "unary", op: "saturate", source: 0 },
      /* 23 */ { kind: "mix", a: 3, b: 3, t: 0 },
      /* 24 */ { kind: "mix", a: 1, b: 1, t: 1 },
      /* 25 */ { kind: "swizzle", source: 3, pattern: "wzyx" },
      /* 26 */ { kind: "swizzle", source: 1, pattern: "y" },
      /* 27 */ { kind: "compose", type: "vec4", parts: [0, 2] },
      /* 28 */ { kind: "texture", name: "map", uv: 1 },
      /* 29 */ { kind: "binary", op: "add", left: 27, right: 28 },
      /* 30 */ { kind: "binary", op: "add", left: 29, right: 23 },
    ];
    const analysis = analyzeShaderGraph({
      domain: "surface",
      nodes,
      color: 30,
    });
    expect(analysis.nodeTypes).toEqual([
      "float",
      "vec2",
      "vec3",
      "vec4",
      "mat3",
      "mat4",
      "float",
      "vec3",
      "vec3",
      "vec2",
      "vec4",
      "mat3",
      "mat4",
      "vec3",
      "vec4",
      "vec2",
      "vec2",
      "float",
      "vec4",
      "vec2",
      "vec3",
      "float",
      "float",
      "vec4",
      "vec2",
      "vec4",
      "float",
      "vec4",
      "vec4",
      "vec4",
      "vec4",
    ]);
  });

  it("reflects only reachable uniforms, textures and attributes, in node order", () => {
    const nodes: ShaderNode[] = [
      /* 0: dead */ { kind: "uniform", type: "float", name: "dead" },
      /* 1 */ VEC2,
      /* 2 */ { kind: "uniform", type: "vec4", name: "tint" },
      /* 3 */ { kind: "texture", name: "map", uv: 1 },
      /* 4: dead */ { kind: "texture", name: "unusedMap", uv: 1 },
      /* 5 */ { kind: "attribute", name: "uv" },
      /* 6 */ { kind: "texture", name: "map", uv: 5 },
      /* 7 */ { kind: "binary", op: "multiply", left: 2, right: 3 },
      /* 8 */ { kind: "binary", op: "multiply", left: 7, right: 6 },
    ];
    const analysis = analyzeShaderGraph({ domain: "surface", nodes, color: 8 });
    expect(analysis.reflection.uniforms).toEqual([
      { name: "tint", type: "vec4" },
    ]);
    expect(analysis.reflection.textures).toEqual([{ name: "map" }]);
    expect(analysis.reflection.attributes).toEqual(["uv"]);
    expect(analysis.colorReachable[0]).toBe(false);
    expect(analysis.colorReachable[4]).toBe(false);
    expect(analysis.colorReachable[8]).toBe(true);
    expect(analysis.offsetReachable.every((flag) => !flag)).toBe(true);
  });

  it("tracks positionOffset reachability separately", () => {
    const nodes: ShaderNode[] = [
      /* 0 */ { kind: "uniform", type: "vec3", name: "wave" },
      /* 1 */ VEC4,
    ];
    const analysis = analyzeShaderGraph({
      domain: "surface",
      nodes,
      color: 1,
      positionOffset: 0,
    });
    expect(analysis.offsetReachable).toEqual([true, false]);
    expect(analysis.colorReachable).toEqual([false, true]);
    expect(analysis.reflection.uniforms).toEqual([
      { name: "wave", type: "vec3" },
    ]);
  });

  it('accepts "uv" — and only "uv" — in the screen domain', () => {
    const nodes: ShaderNode[] = [
      { kind: "attribute", name: "uv" },
      { kind: "texture", name: "source", uv: 0 },
    ];
    const analysis = analyzeShaderGraph({ domain: "screen", nodes, color: 1 });
    expect(analysis.reflection.textures).toEqual([{ name: "source" }]);
  });

  it("publishes the arity and attribute-type tables", () => {
    expect(SHADER_VALUE_COMPONENTS.mat3).toBe(9);
    expect(SHADER_ATTRIBUTE_TYPES.color).toBe("vec4");
  });
});

describe("forEachShaderNodeReference", () => {
  it("visits every reference of every node kind, in declaration order", () => {
    const collect = (node: ShaderNode): number[] => {
      const ids: number[] = [];
      forEachShaderNodeReference(node, (id) => ids.push(id));
      return ids;
    };
    expect(collect(VEC4)).toEqual([]);
    expect(collect({ kind: "uniform", type: "float", name: "u" })).toEqual([]);
    expect(collect({ kind: "attribute", name: "uv" })).toEqual([]);
    expect(collect({ kind: "time" })).toEqual([]);
    expect(collect({ kind: "texture", name: "s", uv: 3 })).toEqual([3]);
    expect(collect({ kind: "compose", type: "vec2", parts: [1, 2] })).toEqual([
      1, 2,
    ]);
    expect(collect({ kind: "swizzle", source: 4, pattern: "x" })).toEqual([4]);
    expect(collect({ kind: "unary", op: "sin", source: 5 })).toEqual([5]);
    expect(collect({ kind: "binary", op: "add", left: 6, right: 7 })).toEqual([
      6, 7,
    ]);
    expect(collect({ kind: "mix", a: 8, b: 9, t: 10 })).toEqual([8, 9, 10]);
  });
});

describe("freezeShaderGraph", () => {
  it("freezes the graph, the node array, every node, and every value array", () => {
    const nodes: ShaderNode[] = [
      FLOAT,
      { kind: "constant", type: "float", value: [2] },
      { kind: "compose", type: "vec2", parts: [0, 1] },
      { kind: "compose", type: "vec4", parts: [2, 2] },
      { kind: "time" },
    ];
    const graph: ShaderGraph = { domain: "surface", nodes, color: 3 };
    const frozen = freezeShaderGraph(graph);
    expect(frozen).toBe(graph);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.nodes)).toBe(true);
    for (const node of frozen.nodes) {
      expect(Object.isFrozen(node)).toBe(true);
    }
    expect(Object.isFrozen((frozen.nodes[0] as { value: unknown }).value)).toBe(
      true,
    );
    expect(Object.isFrozen((frozen.nodes[2] as { parts: unknown }).parts)).toBe(
      true,
    );
  });
});
