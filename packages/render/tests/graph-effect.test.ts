/**
 * §70's graph effect (§60; RFC 0001): the `GraphEffect` member of the closed
 * `ScreenEffect` union, its §85 validation, and the property the whole design
 * exists for — a graph pass's **full** sample set is visible to
 * `RenderGraph.validate()`, so a graph effect is exactly as checkable as a
 * built-in one and emits no `"opaque"` issue.
 */

import { planeGeometry } from "@four/geometry";
import {
  NodeMaterial,
  ShaderGraphBuilder,
  type ShaderGraph,
} from "@four/materials";
import { Scene, resolveWorldTransforms } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  RenderGraph,
  RenderTarget,
  Renderable,
  validateEffectRenderPass,
  type EffectRenderPass,
  type GraphEffect,
} from "../src/index.js";

function target(): RenderTarget {
  return new RenderTarget({ width: 8, height: 8 });
}

/** A screen graph sampling `source` (and optionally more), with uniforms. */
function screenGraph(
  extraSampler?: string,
  uniform?: "float" | "vec4",
): ShaderGraph {
  const builder = new ShaderGraphBuilder("screen");
  let texel = builder.sampler("source");
  if (extraSampler !== undefined) {
    texel = texel.add(builder.sampler(extraSampler));
  }
  if (uniform !== undefined) {
    texel = texel.multiply(builder.uniform("gain", uniform));
  }
  builder.output.color = texel;
  return builder.graph();
}

function graphPass(
  effect: GraphEffect,
  source = target(),
  destination?: RenderTarget,
): EffectRenderPass {
  return {
    kind: "effect",
    source: source.colorTexture,
    effect,
    ...(destination === undefined ? {} : { target: destination }),
  };
}

describe("validateEffectRenderPass — the graph arm (§60, §85)", () => {
  it("accepts a well-formed screen graph over source alone", () => {
    expect(() =>
      validateEffectRenderPass(
        graphPass({ kind: "graph", graph: screenGraph() }),
      ),
    ).not.toThrow();
  });

  it("accepts declared extra inputs and well-shaped uniform values", () => {
    const noise = target();
    const effect: GraphEffect = {
      kind: "graph",
      graph: screenGraph("noise", "vec4"),
      textures: { noise: noise.colorTexture },
      uniforms: { gain: [1, 1, 1, 1] },
    };
    expect(() => validateEffectRenderPass(graphPass(effect))).not.toThrow();
  });

  it("refuses a surface-domain graph — a full-screen pass has no mesh", () => {
    const surface: ShaderGraph = {
      domain: "surface",
      nodes: [{ kind: "constant", type: "vec4", value: [1, 1, 1, 1] }],
      color: 0,
    };
    expect(() =>
      validateEffectRenderPass(graphPass({ kind: "graph", graph: surface })),
    ).toThrow(/"screen"-domain/);
  });

  it("propagates the graph's own §60 refusals", () => {
    const broken: ShaderGraph = { domain: "screen", nodes: [], color: 0 };
    expect(() =>
      validateEffectRenderPass(graphPass({ kind: "graph", graph: broken })),
    ).toThrow(RangeError);
  });

  it("refuses a sampler the pass does not declare", () => {
    expect(() =>
      validateEffectRenderPass(
        graphPass({ kind: "graph", graph: screenGraph("noise") }),
      ),
    ).toThrow(/does not declare/);
  });

  it("refuses a declared input that is not a render-target texture", () => {
    const effect: GraphEffect = {
      kind: "graph",
      graph: screenGraph("noise"),
      textures: { noise: {} as never },
    };
    expect(() => validateEffectRenderPass(graphPass(effect))).toThrow(
      /must be a RenderTarget's colorTexture/,
    );
  });

  it("refuses a declared input the graph never samples", () => {
    const effect: GraphEffect = {
      kind: "graph",
      graph: screenGraph(),
      textures: { unused: target().colorTexture },
    };
    expect(() => validateEffectRenderPass(graphPass(effect))).toThrow(
      /never samples/,
    );
  });

  it("refuses uniform values the graph does not declare or that are mis-shaped", () => {
    const base = screenGraph(undefined, "vec4");
    const withUniforms = (
      uniforms: GraphEffect["uniforms"],
      graph: ShaderGraph = base,
    ): EffectRenderPass => graphPass({ kind: "graph", graph, uniforms });

    expect(() =>
      validateEffectRenderPass(withUniforms({ missing: 1 })),
    ).toThrow(/does not \(reachably\) declare/);
    expect(() => validateEffectRenderPass(withUniforms({ gain: 1 }))).toThrow(
      /only fits a float/,
    );
    expect(() =>
      validateEffectRenderPass(withUniforms({ gain: [1, 2] })),
    ).toThrow(/needs 4 components/);
    expect(() =>
      validateEffectRenderPass(withUniforms({ gain: [1, 2, Number.NaN, 4] })),
    ).toThrow(/must be finite/);
    const scalar = screenGraph(undefined, "float");
    expect(() =>
      validateEffectRenderPass(withUniforms({ gain: Number.NaN }, scalar)),
    ).toThrow(/must be finite/);
    expect(() =>
      validateEffectRenderPass(withUniforms({ gain: 2 }, scalar)),
    ).not.toThrow();
  });
});

describe("RenderGraph.validate over graph effects (§63; RFC 0001)", () => {
  it("sees the pass's full sample set — and reports no opaque issue", () => {
    const scene = new Scene();
    const world = target();
    const noise = target();
    const graph = new RenderGraph();
    graph.addPass("world", { root: scene, views: [], target: world });
    graph.addPass("noise", { root: scene, views: [], target: noise });
    graph.addPass("composite", {
      kind: "effect",
      source: world.colorTexture,
      effect: {
        kind: "graph",
        graph: screenGraph("noise"),
        textures: { noise: noise.colorTexture },
      },
    });
    expect(graph.validate()).toEqual([]);
  });

  it("refuses a feedback loop through a *declared extra* input", () => {
    const scene = new Scene();
    const world = target();
    const noise = target();
    const graph = new RenderGraph();
    graph.addPass("world", { root: scene, views: [], target: world });
    graph.addPass("noise", { root: scene, views: [], target: noise });
    graph.addPass("composite", {
      kind: "effect",
      source: world.colorTexture,
      effect: {
        kind: "graph",
        graph: screenGraph("noise"),
        textures: { noise: noise.colorTexture },
      },
      target: noise,
    });
    const issues = graph.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("feedback");
    expect(issues[0].target).toBe(noise);
  });

  it("reports an ordering error when an extra input is written later", () => {
    const scene = new Scene();
    const world = target();
    const noise = target();
    const graph = new RenderGraph();
    graph.addPass("world", { root: scene, views: [], target: world });
    graph.addPass("composite", {
      kind: "effect",
      source: world.colorTexture,
      effect: {
        kind: "graph",
        graph: screenGraph("noise"),
        textures: { noise: noise.colorTexture },
      },
    });
    graph.addPass("noise", { root: scene, views: [], target: noise });
    const issues = graph.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("order");
    expect(issues[0].producer).toBe("noise");
  });

  it("discovers what a scene pass's node materials sample (§60's checkability)", () => {
    const scene = new Scene();
    const sampled = target();
    const builder = new ShaderGraphBuilder("surface");
    builder.output.color = builder.sampler("scene");
    const material = new NodeMaterial(builder.graph());
    material.setTexture("scene", sampled.colorTexture);
    // A second sampler left null exercises the "bound to nothing" read.
    const nullBuilder = new ShaderGraphBuilder("surface");
    nullBuilder.output.color = nullBuilder.sampler("unbound");
    scene.add(
      new Renderable(planeGeometry(), material),
      new Renderable(planeGeometry(), new NodeMaterial(nullBuilder.graph())),
    );
    resolveWorldTransforms(scene);

    const graph = new RenderGraph();
    graph.addPass("world", { root: scene, views: [], target: sampled });
    const issues = graph.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("feedback");
    expect(issues[0].target).toBe(sampled);
  });
});
