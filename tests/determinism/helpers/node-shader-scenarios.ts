/**
 * The two canonical §60 shader graphs the emission goldens are pinned over
 * (RFC 0001; WP-R1.9) — one surface graph exercising every transportable
 * uniform type, a texture, an attribute, §9 time, and a displacement; one
 * screen graph grading a copy over `source`.
 *
 * These restate `shader-graph-glsl.test.ts`'s builders **call for call**: the
 * two emitters' goldens must be pinned over structurally identical graphs, or
 * "the WGSL emitter is the GLSL emitter's twin" would be a claim about two
 * different shaders. They live in a helper rather than being imported from
 * that test file because importing one Vitest file from another registers its
 * suites a second time; the GLSL test predates this helper and keeps its own
 * copies (its golden is immutable evidence, its builders documented beside
 * it).
 */

import { NodeMaterialBuilder, ShaderGraphBuilder } from "@four/materials";
import type { ShaderGraph } from "@four/render";

/**
 * The canonical surface graph: every transportable uniform type, a sampled
 * texture, an attribute-driven gradient, §9 time, and a displacement.
 */
export function surfaceScenario(): ShaderGraph {
  const builder = new NodeMaterialBuilder();
  const uv = builder.uv();
  const tint = builder.uniform("tint", "vec4");
  const gain = builder.uniform("gain", "float");
  const offset = builder.uniform("offset", "vec2");
  const axis = builder.uniform("axis", "vec3");
  const spin = builder.uniform("spin", "mat3");
  const warp = builder.uniform("warp", "mat4");
  const texel = builder.sampler("map", uv.add(offset));
  const swirled = spin.multiply(axis);
  const warped = warp.multiply(tint);
  const pulse = builder.sin(builder.time().multiply(gain));
  builder.output.color = texel
    .multiply(warped)
    .add(builder.vec4(swirled, pulse))
    .saturate();
  builder.output.positionOffset = builder
    .attribute("normal")
    .multiply(pulse.multiply(0.25));
  return builder.graph();
}

/** The canonical screen graph: a graded copy over `source`. */
export function screenScenario(): ShaderGraph {
  const builder = new ShaderGraphBuilder("screen");
  const texel = builder.sampler("source");
  const gain = builder.uniform("gain", "float");
  builder.output.color = builder.vec4(
    texel.swizzle("xyz").multiply(gain),
    texel.swizzle("w"),
  );
  return builder.graph();
}
