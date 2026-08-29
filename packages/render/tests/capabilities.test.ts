/**
 * `RENDERER_REGISTRY` and `RENDER_GRAPH` (§81, RFC 0002 §2): declared here
 * since 2026-08-29, when the tokens moved home from `four/plugins.ts`. The
 * umbrella's `plugins.test.ts` pins cross-package identity; this file pins
 * what the owner itself promises — the names (a token's identity), the Q3
 * non-revocable dispositions, and that each token really keys this package's
 * value for the compiler (a registry for one, the application's own §63
 * graph — the differently-shaped capability — for the other).
 */

import { bindCapability } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  RENDERER_REGISTRY,
  RENDER_GRAPH,
  RenderGraph,
  RendererRegistry,
} from "../src/index.js";

describe("render capability tokens", () => {
  it("are the four:renderer-registry and four:render-graph tokens, not revocable (RFC 0002 Q3)", () => {
    expect(RENDERER_REGISTRY).toEqual({
      name: "four:renderer-registry",
      revocable: false,
    });
    expect(RENDER_GRAPH).toEqual({
      name: "four:render-graph",
      revocable: false,
    });
  });

  it("key a RendererRegistry and a RenderGraph for the compiler", () => {
    const registry = new RendererRegistry();
    const graph = new RenderGraph();
    expect(bindCapability(RENDERER_REGISTRY, registry).value).toBe(registry);
    expect(bindCapability(RENDER_GRAPH, graph).value).toBe(graph);
  });
});
