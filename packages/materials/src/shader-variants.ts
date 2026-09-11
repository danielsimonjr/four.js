import {
  analyzeShaderGraph,
  freezeShaderGraph,
  type ShaderGraph,
} from "./shader-graph.js";

/**
 * A finite, declarative family of compile-time graph alternatives. Each key
 * selects a complete graph, so inactive branches consume no uniforms,
 * samplers, instructions, or render-target dependencies. Backend caches still
 * share identical source between variants; distinct source gets its own GPU
 * program. Variant selection is explicit authoring work, never a frame-time
 * compilation flag hidden in mutable material state.
 */
export class ShaderVariantSet {
  readonly #graphs = new Map<string, ShaderGraph>();

  constructor(variants: Readonly<Record<string, ShaderGraph>>) {
    const names = Object.keys(variants).sort();
    if (names.length === 0 || names.length > 256) {
      throw new RangeError(
        "ShaderVariantSet: supply between 1 and 256 variants.",
      );
    }
    let domain: string | undefined;
    for (const name of names) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
        throw new RangeError("ShaderVariantSet: invalid variant name.");
      }
      const graph = structuredClone(variants[name]);
      analyzeShaderGraph(graph);
      if (domain !== undefined && domain !== graph.domain) {
        throw new RangeError(
          "ShaderVariantSet: every variant must share a domain.",
        );
      }
      domain = graph.domain;
      this.#graphs.set(name, freezeShaderGraph(graph));
    }
  }

  /** Stable sorted variant keys, independent of JSON object insertion order. */
  get names(): readonly string[] {
    return [...this.#graphs.keys()];
  }

  /** Selects an immutable graph; an unknown choice is refused, never a fallback. */
  select(name: string): ShaderGraph {
    const graph = this.#graphs.get(name);
    if (graph === undefined)
      throw new RangeError(
        `ShaderVariantSet: unknown variant ${JSON.stringify(name)}.`,
      );
    return graph;
  }
}
