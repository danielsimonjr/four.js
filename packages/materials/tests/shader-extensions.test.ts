import { describe, expect, it } from "vitest";
import { ShaderFunction } from "../src/shader-function.js";
import { ShaderVariantSet } from "../src/shader-variants.js";
import { ShaderGraphBuilder } from "../src/node-material-builder.js";
import { ShaderOperatorRegistry } from "../src/shader-operators.js";
import { analyzeShaderGraph, type ShaderGraph } from "../src/shader-graph.js";
import { createShaderSourceMap } from "../src/shader-source-map.js";

function pulse() {
  const b = new ShaderGraphBuilder();
  const x = b.uniform("x", "float");
  const value = x.sin().add(1).multiply(0.5);
  b.output.color = b.vec4(value, value, value, 1);
  return {
    name: "pulse",
    graph: b.graph(),
    parameters: ["x"],
    result: value.nodeId,
  };
}
function solid(domain: "surface" | "screen" = "surface") {
  const b = new ShaderGraphBuilder(domain);
  b.output.color = b.constant([1, 0, 0, 1]);
  return b.graph();
}

describe("reusable declarative shader functions", () => {
  it("substitutes typed parameters, scopes calls and caches identical call sites", () => {
    const fn = new ShaderFunction(pulse());
    const b = new ShaderGraphBuilder();
    const time = b.time();
    const first = fn.call(b, time);
    const count = b.nodeCount;
    expect(fn.call(b, time)).toBe(first);
    expect(b.nodeCount).toBe(count);
    const second = fn.call(b, b.uniform("speed", "float"));
    expect(second.nodeId).not.toBe(first.nodeId);
    b.output.color = b.vec4(first, second, 0, 1);
    expect(analyzeShaderGraph(b.graph()).reflection.uniforms).toEqual([
      { name: "speed", type: "float" },
    ]);
    expect(fn.resultType).toBe("float");
    expect(Object.isFrozen(fn.definition.graph.nodes)).toBe(true);
    expect(() => fn.call(b, [1, 2])).toThrow("argument 0 must be float");
    expect(() => fn.call(b)).toThrow("argument count");
    expect(() => fn.call(new ShaderGraphBuilder("screen"), 1)).toThrow(
      "domains",
    );
    expect(() => fn.call(b, new ShaderGraphBuilder().time())).toThrow(
      "different builder",
    );
  });

  it("copies declarations, accepts arbitrary result types, and validates declarations", () => {
    const declaration = pulse();
    const fn = new ShaderFunction(declaration);
    declaration.parameters[0] = "other";
    expect(fn.definition.parameters).toEqual(["x"]);
    expect(() => new ShaderFunction({ ...pulse(), name: "bad-name" })).toThrow(
      "invalid name",
    );
    expect(() => new ShaderFunction({ ...pulse(), name: "bad__name" })).toThrow(
      "invalid name",
    );
    expect(() => new ShaderFunction({ ...pulse(), result: -1 })).toThrow(
      "result",
    );
    expect(() => new ShaderFunction({ ...pulse(), result: 100 })).toThrow(
      "result",
    );
    expect(
      () => new ShaderFunction({ ...pulse(), parameters: ["x", "x"] }),
    ).toThrow("parameters");
    expect(
      () => new ShaderFunction({ ...pulse(), parameters: ["missing"] }),
    ).toThrow("parameters");
    expect(
      new ShaderFunction({ name: "solid", graph: solid(), parameters: [] })
        .resultType,
    ).toBe("vec4");
  });

  it("lowers all safe IR nodes and retains named sampler reflection", () => {
    const b = new ShaderGraphBuilder();
    const uv = b.vec2(b.uniform("x", "float"), 0);
    const normal = b.attribute("normal");
    const rgb = b.vec3(normal.swizzle("xy"), 1);
    const texel = b.sampler("albedo", uv);
    b.output.color = b.vec4(rgb, b.time()).mix(texel, 0.5);
    const fn = new ShaderFunction({
      name: "shade",
      graph: b.graph(),
      parameters: ["x"],
    });
    const caller = new ShaderGraphBuilder();
    caller.output.color = fn.call(caller, 0.5);
    expect(analyzeShaderGraph(caller.graph()).reflection.textures).toEqual([
      { name: "albedo" },
    ]);
    expect(analyzeShaderGraph(caller.graph()).reflection.attributes).toEqual([
      "normal",
    ]);
  });

  it("exposes data operators through the existing registry without executable source", () => {
    const registry = new ShaderOperatorRegistry();
    const factory = () => ({ kind: "time" as const });
    registry
      .register("time", factory)
      .registerDefinition(pulse())
      .register("later", factory);
    expect(registry.names).toEqual(["time", "pulse", "later"]);
    expect(registry.size).toBe(3);
    expect(registry.has("pulse")).toBe(true);
    expect(registry.getDefinition("pulse")).toBeInstanceOf(ShaderFunction);
    expect(registry.get("pulse")).toBeUndefined();
    expect(registry.getDefinition("missing")).toBeUndefined();
    expect(() => registry.registerDefinition(pulse())).toThrow(
      "already registered",
    );
    expect(() => registry.register("pulse", factory)).toThrow(
      "already registered",
    );
    expect(() =>
      registry.registerDefinition({ ...pulse(), name: "time" }),
    ).toThrow("already registered");
  });
});

describe("finite shader variants", () => {
  it("sorts keys and freezes independent snapshots with strict selection", () => {
    const graph = solid();
    const variants = new ShaderVariantSet({ warm: graph, cold: graph });
    expect(variants.names).toEqual(["cold", "warm"]);
    expect(variants.select("cold")).toBe(variants.select("cold"));
    expect(variants.select("cold")).not.toBe(graph);
    expect(Object.isFrozen(variants.select("cold"))).toBe(true);
    expect(() => variants.select("absent")).toThrow("unknown variant");
    expect(() => new ShaderVariantSet({})).toThrow("between");
    expect(
      () =>
        new ShaderVariantSet(
          Object.fromEntries(
            Array.from({ length: 257 }, (_, i) => [`v${i}`, graph]),
          ),
        ),
    ).toThrow("between");
    expect(() => new ShaderVariantSet({ "not valid": graph })).toThrow("name");
    expect(
      () => new ShaderVariantSet({ surface: graph, screen: solid("screen") }),
    ).toThrow("domain");
  });
});

describe("shader provenance and untrusted IR", () => {
  it("maps node statements to one-based lines and columns across WGSL stages", () => {
    const source =
      "fn vertexMain() {\n  let n0 : vec3<f32> = input.position;\n}\n@fragment\nfn fragmentMain() {\n  let n12 : vec4<f32> = vec4<f32>(1.0);\n}";
    const map = createShaderSourceMap(source);
    expect(map).toEqual([
      { line: 2, column: 7, nodeId: 0, stage: "vertex" },
      { line: 6, column: 7, nodeId: 12, stage: "fragment" },
    ]);
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map[0])).toBe(true);
    expect(
      createShaderSourceMap(
        "void main() {\n  vec4 n2 = vec4(1.0);\n}",
        "fragment",
      ),
    ).toEqual([{ line: 2, column: 8, nodeId: 2, stage: "fragment" }]);
  });

  it.each(["unary", "binary"])(
    "rejects arbitrary %s operator strings at the JSON trust boundary",
    (kind) => {
      const graph = JSON.parse(JSON.stringify(solid())) as ShaderGraph;
      const malicious =
        kind === "unary"
          ? { kind, op: "evil(); discard; //", source: 0 }
          : { kind, op: "evil", left: 0, right: 0 };
      expect(() =>
        analyzeShaderGraph({
          ...graph,
          nodes: [...graph.nodes, malicious],
        } as ShaderGraph),
      ).toThrow("unknown");
    },
  );

  it("rejects inherited property names as shader types and attributes", () => {
    for (const node of [
      { kind: "uniform", type: "toString", name: "x" },
      { kind: "constant", type: "__proto__", value: [] },
      { kind: "attribute", name: "constructor" },
    ]) {
      expect(() =>
        analyzeShaderGraph({
          domain: "surface",
          nodes: [node],
          color: 0,
        } as ShaderGraph),
      ).toThrow("unknown");
    }
  });
});

it("selects std140 transport explicitly and refuses unknown transport from JSON", () => {
  const b = new ShaderGraphBuilder().useUniformBlock();
  b.output.color = b.uniform("color", "vec4");
  expect(b.graph().uniformTransport).toBe("std140");
  expect(() =>
    analyzeShaderGraph({
      ...solid(),
      uniformTransport: "unsafe",
    } as unknown as ShaderGraph),
  ).toThrow("transport");
});

it("inlines only dependencies of a function's selected intermediate result", () => {
  const b = new ShaderGraphBuilder();
  const selected = b.constant(2);
  for (let index = 0; index < 1000; index += 1) b.constant(index);
  b.output.color = b.constant([1, 1, 1, 1]);
  const fn = new ShaderFunction({
    name: "small",
    graph: b.graph(),
    parameters: [],
    result: selected.nodeId,
  });
  const caller = new ShaderGraphBuilder();
  const value = fn.call(caller);
  expect(caller.nodeCount).toBe(1);
  expect(caller.typeOf(value)).toBe("float");
  caller.output.color = caller.vec4(value, value, value, 1);
  expect(caller.graph().nodes.length).toBe(3);
});
