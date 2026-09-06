/**
 * Unit tests for §70's full-screen effect surface (R-6, 2026-08-07).
 *
 * Three things are under test, all of them backend-free:
 *
 * 1. **The closed union and its defaults** — `COPY_EFFECT` and
 *    `COLOR_GRADE_DEFAULTS` are the shared, frozen values a backend reads, so
 *    that "omitted means identity" is one fact rather than five `?? 1`s spread
 *    across packages.
 * 2. **`validateEffectRenderPass`** — the §85 boundary. It runs at setup, from
 *    `RenderGraph.addPass`, because a backend may not throw inside a frame
 *    (§61); every value it refuses is one that would otherwise reach a
 *    `uniform3fv` and produce a black frame with no error anywhere.
 * 3. **`supportsScreenEffects`** — presence is the capability, the same stance
 *    `supportsRenderStatistics` takes, tested against a renderer that declares
 *    the member (`NullRenderer`) and one that does not.
 *
 * `NullRenderer.renderEffect` is here too: it is the interface's conformance
 * fixture, and an application's post-processing wiring is assertable headlessly
 * only because it accepts effect passes and records them.
 */

import { describe, expect, it } from "vitest";

import {
  COLOR_GRADE_DEFAULTS,
  COPY_EFFECT,
  NullRenderer,
  OUTPUT_TRANSFORM_EFFECT,
  RenderTarget,
  supportsScreenEffects,
  validateEffectRenderPass,
  type EffectRenderPass,
  type ScreenEffect,
} from "../src/index.js";

function target(): RenderTarget {
  return new RenderTarget({ width: 8, height: 8 });
}

function pass(effect: ScreenEffect, source = target()): EffectRenderPass {
  return { kind: "effect", source: source.colorTexture, effect };
}

// ---------------------------------------------------------------------------
// The closed union and its shared values.
// ---------------------------------------------------------------------------

describe("ScreenEffect — the closed union's shared values (§70)", () => {
  it("COPY_EFFECT is a frozen, parameterless copy", () => {
    expect(COPY_EFFECT).toEqual({ kind: "copy" });
    expect(Object.isFrozen(COPY_EFFECT)).toBe(true);
  });

  it("OUTPUT_TRANSFORM_EFFECT is a frozen, parameterless encode (§60a)", () => {
    // Parameterless because tone mapping — the other half of §60a's output
    // transform — is staged on the HDR float targets R-4 named, and lands as a
    // field on this effect rather than as a sixth union member.
    expect(OUTPUT_TRANSFORM_EFFECT).toEqual({ kind: "output-transform" });
    expect(Object.isFrozen(OUTPUT_TRANSFORM_EFFECT)).toBe(true);
  });

  it("COLOR_GRADE_DEFAULTS is the identity of all three operations", () => {
    // The property that makes `{ kind: "grade" }` a no-op and a grade naming
    // one field leave the other two alone. A backend reads these rather than
    // inventing its own fallbacks.
    expect(COLOR_GRADE_DEFAULTS).toEqual({
      exposure: 1,
      contrast: 1,
      saturation: 1,
    });
    expect(Object.isFrozen(COLOR_GRADE_DEFAULTS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §85 validation.
// ---------------------------------------------------------------------------

describe("validateEffectRenderPass — the §85 boundary (§70)", () => {
  it("accepts a copy and a fully specified grade", () => {
    expect(() => {
      validateEffectRenderPass(pass(COPY_EFFECT));
    }).not.toThrow();
    expect(() => {
      validateEffectRenderPass(
        pass({ kind: "grade", exposure: 2, contrast: 0, saturation: 3 }),
      );
    }).not.toThrow();
  });

  it("accepts a grade that omits every coefficient", () => {
    expect(() => {
      validateEffectRenderPass(pass({ kind: "grade" }));
    }).not.toThrow();
  });

  it("refuses a source that is not a render-target texture", () => {
    // The check is the marker guard, not the type: a JavaScript caller can
    // hand over an ordinary texture, and a backend that met one here would
    // draw a black screen with nothing to explain it.
    const notATarget = { id: "t", version: 0, width: 1, height: 1 };
    expect(() => {
      validateEffectRenderPass({
        kind: "effect",
        source: notATarget,
        effect: COPY_EFFECT,
      } as unknown as EffectRenderPass);
    }).toThrow(/must be a RenderTarget's colorTexture/);
  });

  it.each([
    ["exposure", Number.NaN],
    ["exposure", -1],
    ["contrast", Number.POSITIVE_INFINITY],
    ["contrast", -0.5],
    ["saturation", Number.NaN],
    ["saturation", -2],
  ])("refuses %s = %s", (name, value) => {
    expect(() => {
      validateEffectRenderPass(pass({ kind: "grade", [name]: value }));
    }).toThrow(new RegExp(`ColorGradeEffect ${name}`));
  });

  it("accepts an output transform from a linear source to the drawing buffer", () => {
    // The default case, and the one §60a describes: the last pass of the graph
    // encodes the composited linear-light frame onto the presentable surface.
    expect(() => {
      validateEffectRenderPass(pass(OUTPUT_TRANSFORM_EFFECT));
    }).not.toThrow();
  });

  it("accepts an output transform into an sRGB-tagged target", () => {
    const destination = new RenderTarget({
      width: 8,
      height: 8,
      colorSpace: "srgb",
    });
    expect(() => {
      validateEffectRenderPass({
        ...pass(OUTPUT_TRANSFORM_EFFECT),
        target: destination,
      });
    }).not.toThrow();
  });

  it("refuses encoding a source that is already sRGB (§60a double encode)", () => {
    const source = new RenderTarget({
      width: 8,
      height: 8,
      colorSpace: "srgb",
    });
    expect(() => {
      validateEffectRenderPass(pass(OUTPUT_TRANSFORM_EFFECT, source));
    }).toThrow(/double-encode/);
  });

  it("refuses encoding into a linear-tagged target", () => {
    expect(() => {
      validateEffectRenderPass({
        ...pass(OUTPUT_TRANSFORM_EFFECT),
        target: target(),
      });
    }).toThrow(/destination render target is tagged "linear"/);
  });

  it("accepts a destination rectangle (R-6 follow-up)", () => {
    expect(() => {
      validateEffectRenderPass({
        ...pass(COPY_EFFECT),
        rect: { x: 8, y: 16, width: 32, height: 24 },
      });
    }).not.toThrow();
  });

  it("refuses a non-finite or negative destination rectangle", () => {
    expect(() => {
      validateEffectRenderPass({
        ...pass(COPY_EFFECT),
        rect: { x: Number.NaN, y: 0, width: 8, height: 8 },
      });
    }).toThrow(/rect\.x/);
    expect(() => {
      validateEffectRenderPass({
        ...pass(COPY_EFFECT),
        rect: { x: 0, y: 0, width: -1, height: 8 },
      });
    }).toThrow(/width and height must be >= 0/);
  });

  it("refuses an effect kind outside the closed union", () => {
    // `{ kind: "bloom" }` is a compile error; this is the same value arriving
    // from JSON or from JavaScript, and it has to be refused rather than
    // quietly treated as a copy.
    expect(() => {
      validateEffectRenderPass(
        pass({ kind: "bloom" } as unknown as ScreenEffect),
      );
    }).toThrow(/Unknown ScreenEffect kind "bloom"/);
  });
});

// ---------------------------------------------------------------------------
// The structural capability.
// ---------------------------------------------------------------------------

describe("supportsScreenEffects — presence is the capability (§70)", () => {
  it("narrows a renderer that declares renderEffect", () => {
    const renderer = new NullRenderer();
    expect(supportsScreenEffects(renderer)).toBe(true);
  });

  it("rejects a renderer that omits it, and one that carries a non-function", () => {
    expect(supportsScreenEffects({})).toBe(false);
    expect(supportsScreenEffects({ renderEffect: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The conformance fixture.
// ---------------------------------------------------------------------------

describe("NullRenderer.renderEffect — recording, not drawing (§70)", () => {
  it("counts the call and retains the pass", () => {
    const renderer = new NullRenderer();
    const effect = pass({ kind: "grade", exposure: 1.5 });

    expect(renderer.renderEffectCount).toBe(0);
    expect(renderer.lastEffectPass).toBeNull();

    renderer.renderEffect(effect);

    expect(renderer.renderEffectCount).toBe(1);
    expect(renderer.lastEffectPass).toBe(effect);
  });

  it("throws INVALID_APPLICATION_STATE after disposal, like every other method", () => {
    const renderer = new NullRenderer();
    renderer.dispose();

    expect(() => {
      renderer.renderEffect(pass(COPY_EFFECT));
    }).toThrow(/disposal is terminal/);
  });
});
