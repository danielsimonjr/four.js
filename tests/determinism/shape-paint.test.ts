/**
 * §58's paint-to-graph lowering is a pure function of the paint values
 * (2026-08-29; §33, §92 — R-16's follow-up, unblocked by RFC 0001).
 *
 * The lowering's whole §33 obligation is that the same paint values produce
 * the same graph **bytes**: the backend's program cache keys on the emitted
 * source (RFC 0001 §2), so "N shapes with one paint share one program" is
 * true exactly as long as this file stays green. Three pins:
 *
 * 1. **Same values, same bytes, in-process** — two independently authored
 *    copies of one fill/stroke pair lower to graphs whose emitted GLSL is
 *    byte-identical (the program-share property, stated as bytes).
 * 2. **Same values, same bytes, against a committed golden** — the canonical
 *    pair (a three-stop radial fill with a hard edge, a translucent solid
 *    stroke, so the selector `mix` and both ramp spellings are in the
 *    emission) matches `golden/shape-paint-glsl.json` across processes and
 *    platforms.
 * 3. **The selector contract** — the pair's graph reads the `color`
 *    attribute the geometry bakes, and an equal-valued pair reads no
 *    attribute stream at all.
 *
 * ## The golden file is immutable
 *
 * `golden/shape-paint-glsl.json` is evidence, not configuration — the
 * `node-material-glsl.json` rule verbatim: **never regenerate it to make
 * this test pass.** A mismatch means either the lowering or the emitter
 * moved, and §92's pixel-golden tier is downstream of these bytes.
 */

import { readFileSync } from "node:fs";

import { describe, expect, test, afterEach } from "vitest";

import type { NodeMaterial } from "@four/materials";
import {
  Rectangle,
  clearRegisteredShapePaints,
  registerShapePaints,
  type StrokeStyle,
  type RadialGradientPaint,
} from "@four/render";
import { emitShaderGraphGlsl } from "@four/render-webgl";

const GOLDEN_URL = new URL("./golden/shape-paint-glsl.json", import.meta.url);

interface GoldenFile {
  _warning: string;
  _scenario: string;
  vertex: string;
  fragment: string;
}

const golden = JSON.parse(readFileSync(GOLDEN_URL, "utf8")) as GoldenFile;

/** The canonical fill: three stops, one hard edge, offset centre. */
function canonicalFill(): RadialGradientPaint {
  return {
    kind: "radial-gradient",
    center: { x: 0.25, y: -0.5 },
    radius: 1.5,
    stops: [
      { offset: 0, color: [1, 0.9, 0.4, 1] },
      { offset: 0.5, color: [1, 0.4, 0, 1] },
      { offset: 0.5, color: [0.2, 0, 0.4, 1] },
      { offset: 1, color: [0, 0, 0.1, 1] },
    ],
    opacity: 0.875,
  };
}

/** The canonical stroke: a translucent solid, so the selector is needed. */
function canonicalStroke(): StrokeStyle {
  return {
    width: 0.25,
    paint: { kind: "solid", color: [1, 1, 1, 1], opacity: 0.5 },
  };
}

/** The canonical pair, lowered through the public tier. */
function canonicalGraph(): NodeMaterial["graph"] {
  const shape = new Rectangle({
    width: 4,
    height: 2,
    fill: canonicalFill(),
    stroke: canonicalStroke(),
  });
  return (shape.material as unknown as NodeMaterial).graph;
}

afterEach(() => {
  clearRegisteredShapePaints();
});

describe("§58 paint lowering is a pure function of the paint values (§33)", () => {
  test("two independent authorings emit byte-identical GLSL", () => {
    registerShapePaints();
    const first = emitShaderGraphGlsl(canonicalGraph());
    const second = emitShaderGraphGlsl(canonicalGraph());
    expect(second.vertex).toBe(first.vertex);
    expect(second.fragment).toBe(first.fragment);
  });

  test("the canonical pair matches the committed golden, byte for byte", () => {
    registerShapePaints();
    const emitted = emitShaderGraphGlsl(canonicalGraph());
    expect(emitted.vertex).toBe(golden.vertex);
    expect(emitted.fragment).toBe(golden.fragment);
  });

  test("the selector rides the colour attribute — and only when needed", () => {
    registerShapePaints();
    const paired = canonicalGraph();
    expect(
      paired.nodes.some(
        (node) => node.kind === "attribute" && node.name === "color",
      ),
    ).toBe(true);
    const fill = canonicalFill();
    const agreeing = new Rectangle({
      width: 4,
      height: 2,
      fill,
      stroke: { width: 0.25, paint: fill },
    });
    expect(
      (agreeing.material as unknown as NodeMaterial).graph.nodes.some(
        (node) => node.kind === "attribute" && node.name === "color",
      ),
    ).toBe(false);
  });
});
