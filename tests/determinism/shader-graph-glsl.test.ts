/**
 * §60's shader-graph emission determinism gate (RFC 0001 — gap R-14; §33,
 * §92).
 *
 * RFC 0001's §33 obligations sit on the **compiler**, not the shader: node
 * visitation is array order, the structural program-cache key is computed
 * over the same ordered walk, and the emitted source is therefore a pure
 * function of the graph. This file pins all three:
 *
 * 1. **Same graph, same bytes, in-process** — two independent builder runs of
 *    one authored graph emit byte-identical GLSL (which is exactly what makes
 *    N materials share one compiled program).
 * 2. **Same graph, same bytes, against a committed golden** — the emitted
 *    vertex and fragment sources for one surface graph (uniforms of every
 *    transportable type, a texture, a displacement, time) and one screen
 *    graph match `golden/node-material-glsl.json` byte for byte, across
 *    processes and platforms.
 *
 * ## The golden file is immutable
 *
 * `golden/node-material-glsl.json` is evidence, not configuration. **Never
 * regenerate it to make this test pass** — a mismatch means the emitter's
 * output changed, and §92's pixel-golden tier is downstream of these bytes
 * (RFC 0001: making the compiler smarter later means re-baselining the pixel
 * goldens as a recorded decision, never as a side effect).
 */

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { emitShaderGraphGlsl } from "@four/render-webgl";
import type { ShaderGraph } from "@four/render";
import { NodeMaterialBuilder, ShaderGraphBuilder } from "@four/materials";

interface GoldenFile {
  _warning: string;
  _scenario: string;
  surfaceVertex: string;
  surfaceFragment: string;
  screenVertex: string;
  screenFragment: string;
}

const GOLDEN_URL = new URL("./golden/node-material-glsl.json", import.meta.url);
const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

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

describe("§60 GLSL emission is a pure function of the graph (§33)", () => {
  test("two independent builder runs emit byte-identical sources", () => {
    const first = emitShaderGraphGlsl(surfaceScenario());
    const second = emitShaderGraphGlsl(surfaceScenario());
    expect(second.vertex).toBe(first.vertex);
    expect(second.fragment).toBe(first.fragment);
    expect(second.uniforms).toEqual(first.uniforms);
    expect(second.textures).toEqual(first.textures);
  });

  test("the surface scenario matches the committed golden, byte for byte", () => {
    const emitted = emitShaderGraphGlsl(surfaceScenario());
    expect(emitted.vertex).toBe(golden.surfaceVertex);
    expect(emitted.fragment).toBe(golden.surfaceFragment);
  });

  test("the screen scenario matches the committed golden, byte for byte", () => {
    const emitted = emitShaderGraphGlsl(screenScenario());
    expect(emitted.vertex).toBe(golden.screenVertex);
    expect(emitted.fragment).toBe(golden.screenFragment);
  });

  test("reflection order is node order — the §33 binding ABI", () => {
    const emitted = emitShaderGraphGlsl(surfaceScenario());
    expect(emitted.uniforms.map((uniform) => uniform.name)).toEqual([
      "tint",
      "gain",
      "offset",
      "axis",
      "spin",
      "warp",
    ]);
    expect(emitted.textures).toEqual(["map"]);
    expect(emitted.usesTime).toBe(true);
  });
});
