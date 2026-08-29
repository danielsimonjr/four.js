/**
 * §60's WGSL shader-graph emission determinism gate (WP-R1.9 — the twin of
 * `shader-graph-glsl.test.ts`; §33, §92).
 *
 * The §33 obligations sit on the **compiler**, not the shader: node
 * visitation is array order, the structural program-cache key is the emitted
 * source, and the emitted WGSL is therefore a pure function of the graph.
 * This file pins the same three claims the GLSL gate pins, over
 * **structurally identical graphs** (`helpers/node-shader-scenarios.ts`
 * restates that file's builders call for call):
 *
 * 1. **Same graph, same bytes, in-process** — two independent builder runs
 *    emit byte-identical WGSL.
 * 2. **Same graph, same bytes, against a committed golden** — the emitted
 *    surface and screen modules match `golden/node-material-wgsl.json` byte
 *    for byte, across processes and platforms.
 * 3. **Reflection order is node order** — the binding ABI both the uniform
 *    lanes and the texture pairs are assigned by.
 *
 * ## The golden file is immutable
 *
 * `golden/node-material-wgsl.json` is evidence, not configuration. **Never
 * regenerate it to make this test pass** — a mismatch means the emitter's
 * output changed, and §92's pixel tier is downstream of these bytes
 * (RFC 0001's rule, restated for the second backend).
 */

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { emitShaderGraphWgsl } from "@four/render-webgpu";

import {
  screenScenario,
  surfaceScenario,
} from "./helpers/node-shader-scenarios.js";

interface GoldenFile {
  _warning: string;
  _scenario: string;
  surface: string;
  screen: string;
}

const GOLDEN_URL = new URL("./golden/node-material-wgsl.json", import.meta.url);
const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

describe("§60 WGSL emission is a pure function of the graph (§33)", () => {
  test("two independent builder runs emit byte-identical modules", () => {
    const first = emitShaderGraphWgsl(surfaceScenario());
    const second = emitShaderGraphWgsl(surfaceScenario());
    expect(second.code).toBe(first.code);
    expect(second.uniforms).toEqual(first.uniforms);
    expect(second.textures).toEqual(first.textures);
    expect(second.vertexStreams).toEqual(first.vertexStreams);
    expect(second.blockBytes).toBe(first.blockBytes);
  });

  test("the surface scenario matches the committed golden, byte for byte", () => {
    expect(emitShaderGraphWgsl(surfaceScenario()).code).toBe(golden.surface);
  });

  test("the screen scenario matches the committed golden, byte for byte", () => {
    expect(emitShaderGraphWgsl(screenScenario()).code).toBe(golden.screen);
  });

  test("reflection order is node order — the §33 binding ABI", () => {
    const emitted = emitShaderGraphWgsl(surfaceScenario());
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
    // The all-vec4 lane assignment: 1 + 1 + 1 + 1 + 3 + 4 lanes, after the
    // 144-byte fixed prefix.
    expect(emitted.uniformSlots).toBe(11);
    expect(emitted.blockBytes).toBe(144 + 11 * 16);
  });
});
