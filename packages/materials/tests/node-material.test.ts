/**
 * §57's `NodeMaterial` and §60's fluent builder (RFC 0001): the frozen graph,
 * per-material uniform/texture ownership (Q3's decided tier), the §85
 * validation on every write path, and the builder's sugar — including §60's
 * own example, which must compile against this API (Part X's discipline).
 */

import { describe, expect, it } from "vitest";

import {
  NodeMaterial,
  NodeMaterialBuilder,
  ShaderGraphBuilder,
  type MaterialTexture,
  type ShaderGraph,
} from "../src/index.js";

/** A texture reduced to the read surface a material sees (§77). */
function testTexture(): MaterialTexture {
  return {
    id: "texture-test",
    version: 0,
    width: 2,
    height: 2,
    data: new Uint8Array(16),
    disposed: false,
  };
}

/** A minimal valid surface graph with one uniform, one texture, one attribute. */
function richGraph(): ShaderGraph {
  return {
    domain: "surface",
    nodes: [
      /* 0 */ { kind: "attribute", name: "uv" },
      /* 1 */ { kind: "texture", name: "map", uv: 0 },
      /* 2 */ { kind: "uniform", type: "vec4", name: "tint" },
      /* 3 */ { kind: "uniform", type: "float", name: "gain" },
      /* 4 */ { kind: "binary", op: "multiply", left: 1, right: 2 },
      /* 5 */ { kind: "binary", op: "multiply", left: 4, right: 3 },
    ],
    color: 5,
  };
}

describe("NodeMaterial", () => {
  it("is the §57 family member with kind 'node', validated at construction", () => {
    const material = new NodeMaterial(richGraph());
    expect(material.kind).toBe("node");
    expect(material.id.startsWith("node-material-")).toBe(true);
    expect(material.reflection.uniforms).toEqual([
      { name: "tint", type: "vec4" },
      { name: "gain", type: "float" },
    ]);
    expect(material.reflection.textures).toEqual([{ name: "map" }]);
    expect(material.reflection.attributes).toEqual(["uv"]);
    // §57's shared render state rides along.
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
  });

  it("refuses a malformed graph where it was written (§85)", () => {
    expect(
      () => new NodeMaterial({ domain: "surface", nodes: [], color: 0 }),
    ).toThrowError(RangeError);
  });

  it("freezes the graph it is handed — RFC 0001's immutability", () => {
    const graph = richGraph();
    const material = new NodeMaterial(graph);
    expect(material.graph).toBe(graph);
    expect(Object.isFrozen(material.graph)).toBe(true);
    expect(Object.isFrozen(material.graph.nodes)).toBe(true);
  });

  it("seeds every reflected uniform with zeroes and every texture with null", () => {
    const material = new NodeMaterial(richGraph());
    expect(Array.from(material.getUniform("tint"))).toEqual([0, 0, 0, 0]);
    expect(Array.from(material.getUniform("gain"))).toEqual([0]);
    expect(material.getTexture("map")).toBeNull();
  });

  it("applies option-supplied uniforms and textures through the validating setters", () => {
    const map = testTexture();
    const material = new NodeMaterial(richGraph(), {
      uniforms: { tint: [1, 0.5, 0.25, 1], gain: 2 },
      textures: { map },
      transparent: true,
    });
    expect(Array.from(material.getUniform("tint"))).toEqual([1, 0.5, 0.25, 1]);
    expect(Array.from(material.getUniform("gain"))).toEqual([2]);
    expect(material.getTexture("map")).toBe(map);
    expect(material.transparent).toBe(true);
  });

  it("setUniform copies the value and returns this", () => {
    const material = new NodeMaterial(richGraph());
    const value = [0.25, 0.5, 0.75, 1];
    expect(material.setUniform("tint", value)).toBe(material);
    value[0] = 9;
    expect(Array.from(material.getUniform("tint"))).toEqual([
      0.25, 0.5, 0.75, 1,
    ]);
  });

  it("setUniform validates name, shape and finiteness (§85)", () => {
    const material = new NodeMaterial(richGraph());
    expect(() => material.setUniform("missing", 1)).toThrowError(
      "has no uniform",
    );
    expect(() => material.setUniform("tint", 1)).toThrowError(
      "only fits a float",
    );
    expect(() => material.setUniform("gain", Number.NaN)).toThrowError(
      "must be finite",
    );
    expect(() => material.setUniform("tint", [1, 2])).toThrowError(
      "needs 4 components",
    );
    expect(() =>
      material.setUniform("tint", [1, 2, Number.POSITIVE_INFINITY, 4]),
    ).toThrowError("must be finite");
    // A rejected write leaves the previous value in place.
    expect(Array.from(material.getUniform("tint"))).toEqual([0, 0, 0, 0]);
  });

  it("setTexture binds, rebinds to null, and validates the name (§85)", () => {
    const material = new NodeMaterial(richGraph());
    const map = testTexture();
    expect(material.setTexture("map", map)).toBe(material);
    expect(material.getTexture("map")).toBe(map);
    material.setTexture("map", null);
    expect(material.getTexture("map")).toBeNull();
    expect(() => material.setTexture("missing", map)).toThrowError(
      "has no texture",
    );
  });

  it("getUniform and getTexture refuse names the graph does not reach (§85)", () => {
    const material = new NodeMaterial(richGraph());
    expect(() => material.getUniform("missing")).toThrowError("has no uniform");
    expect(() => material.getTexture("missing")).toThrowError("has no texture");
  });

  it("names the empty reflection honestly in its refusals", () => {
    const bare = new NodeMaterial({
      domain: "surface",
      nodes: [{ kind: "constant", type: "vec4", value: [1, 1, 1, 1] }],
      color: 0,
    });
    expect(() => bare.setUniform("u", 1)).toThrowError("none");
    expect(() => bare.setTexture("t", null)).toThrowError("none");
  });
});

describe("ShaderGraphBuilder", () => {
  it("builds §60's own example (Part X's example-compilation discipline)", () => {
    const albedoTexture = testTexture();
    const material = new NodeMaterialBuilder();
    const albedo = material.texture(albedoTexture);
    const pulse = material.sin(material.time().multiply(2));
    material.output.color = albedo.multiply(pulse.add(1));
    const built = material.build(); // NodeMaterial
    expect(built).toBeInstanceOf(NodeMaterial);
    expect(built.graph.domain).toBe("surface");
    expect(built.reflection.textures).toEqual([{ name: "texture0" }]);
    expect(built.getTexture("texture0")).toBe(albedoTexture);
    // The graph reads time — §9 render time by contract.
    expect(built.graph.nodes.some((node) => node.kind === "time")).toBe(true);
  });

  it("lifts numbers and arrays into constants and covers every operator", () => {
    const builder = new ShaderGraphBuilder();
    const a = builder.constant([1, 2]);
    const chained = a
      .add(1)
      .subtract([1, 1])
      .multiply(2)
      .divide(4)
      .min([9, 9])
      .max(0)
      .mix([5, 5], 0.5)
      .swizzle("yx")
      .sin()
      .cos()
      .abs()
      .floor()
      .fract()
      .normalize()
      .negate()
      .saturate();
    const scalar = chained.length().step(builder.constant(0.5));
    const dotted = builder.constant([1, 0]).dot([0, 1]);
    const heading = builder.angle([1, 0]);
    builder.output.color = builder.vec4(
      scalar,
      dotted,
      builder.mix(0, 1, 0.5),
      heading.add(builder.cos(0)),
    );
    const graph = builder.graph();
    expect(graph.color).toBe(graph.nodes.length - 1);
    expect(new NodeMaterial(graph).reflection.uniforms).toEqual([]);
  });

  it("builds uniforms, attributes, samplers, vec2/vec3 composes and offsets", () => {
    const builder = new ShaderGraphBuilder("surface");
    const strength = builder.uniform("strength", "float");
    const normal = builder.attribute("normal");
    builder.output.positionOffset = normal.multiply(strength);
    const named = builder.sampler("detail", builder.vec2(0, 0));
    builder.output.color = named.add(
      builder.vec4(
        builder.vec3(builder.uv().swizzle("x"), builder.vec2(0, 0)),
        1,
      ),
    );
    const graph = builder.graph();
    expect(graph.positionOffset).toBeDefined();
    const material = new NodeMaterial(graph);
    expect(material.reflection.textures).toEqual([{ name: "detail" }]);
    expect(material.reflection.uniforms).toEqual([
      { name: "strength", type: "float" },
    ]);
  });

  it("caches the default uv attribute node across texture calls", () => {
    const builder = new NodeMaterialBuilder();
    const first = builder.texture(testTexture());
    const second = builder.texture(testTexture());
    builder.output.color = first.multiply(second);
    const graph = builder.graph();
    const uvNodes = graph.nodes.filter(
      (node) => node.kind === "attribute" && node.name === "uv",
    );
    expect(uvNodes).toHaveLength(1);
    expect(builder.nodeCount).toBe(graph.nodes.length);
  });

  it("refuses building before output.color is assigned (§85)", () => {
    const builder = new ShaderGraphBuilder();
    expect(() => builder.graph()).toThrowError("assign output.color");
  });

  it("output slots read back and clear with null", () => {
    const builder = new ShaderGraphBuilder();
    const color = builder.constant([1, 1, 1, 1]);
    expect(builder.output.color).toBeNull();
    builder.output.color = color;
    expect(builder.output.color).toBe(color);
    builder.output.color = null;
    expect(builder.output.color).toBeNull();
    expect(builder.output.positionOffset).toBeNull();
    const offset = builder.constant([0, 0, 0]);
    builder.output.positionOffset = offset;
    expect(builder.output.positionOffset).toBe(offset);
    builder.output.positionOffset = null;
    expect(builder.output.positionOffset).toBeNull();
  });

  it("refuses expressions from a different builder (§85)", () => {
    const one = new ShaderGraphBuilder();
    const other = new ShaderGraphBuilder();
    const foreign = other.constant(1);
    expect(() => one.sin(foreign)).toThrowError("different builder");
    expect(() => {
      one.output.color = other.constant([1, 1, 1, 1]);
    }).toThrowError("different builder");
  });

  it("refuses a constant with an impossible arity (§85)", () => {
    const builder = new ShaderGraphBuilder();
    expect(() => builder.constant([1, 2, 3, 4, 5])).toThrowError(
      "no shader type has 5 components",
    );
  });

  it("graph() refuses what analyzeShaderGraph refuses — at build time", () => {
    const screen = new ShaderGraphBuilder("screen");
    const bad = screen.attribute("position"); // no mesh in the screen domain
    screen.output.color = screen.vec4(bad, 1);
    expect(() => screen.graph()).toThrowError("has no mesh");
  });

  it("build() lets an explicit texture binding win over a collected one", () => {
    const collected = testTexture();
    const explicit = testTexture();
    const builder = new NodeMaterialBuilder();
    builder.output.color = builder.texture(collected);
    const material = builder.build({
      textures: { texture0: explicit },
      opacity: 0.5,
    });
    expect(material.getTexture("texture0")).toBe(explicit);
    expect(material.opacity).toBe(0.5);
  });
});
