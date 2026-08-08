/**
 * §46 symbolic layers and their compiled masks (R-38, 2026-08-08).
 *
 * The registry is module-level state, so every case that inspects allocation
 * starts from {@link resetLayers} — the same discipline `resetDevWarnings`
 * imposes on `@four/core`'s warning tests.
 */

import { isFourError } from "@four/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ALL_LAYERS,
  applyLayers,
  assertLayerMask,
  Camera,
  createFullscreenViewport,
  DEFAULT_LAYER,
  DEFAULT_LAYER_MASK,
  DEFAULT_LAYER_NAME,
  defineLayer,
  Group,
  isLayerMask,
  LAYER_COUNT,
  layerIndex,
  layerMask,
  layerMaskNames,
  layerName,
  layerNames,
  layersMatch,
  NO_LAYERS,
  PerspectiveCamera,
  resetLayers,
  type Viewport,
} from "../src/index.js";

beforeEach(() => {
  resetLayers();
});

afterEach(() => {
  resetLayers();
});

describe("§46 — the layer registry", () => {
  it("seeds the default layer at index 0 before anything else can claim it", () => {
    expect(DEFAULT_LAYER).toBe(0);
    expect(layerName(DEFAULT_LAYER)).toBe(DEFAULT_LAYER_NAME);
    expect(layerIndex(DEFAULT_LAYER_NAME)).toBe(DEFAULT_LAYER);
    expect(layerNames()).toEqual([DEFAULT_LAYER_NAME]);
    expect(defineLayer(DEFAULT_LAYER_NAME)).toBe(DEFAULT_LAYER);
  });

  it("allocates by first definition and is idempotent forever after", () => {
    expect(defineLayer("ui")).toBe(1);
    expect(defineLayer("debug")).toBe(2);
    expect(defineLayer("ui")).toBe(1);
    expect(defineLayer("debug")).toBe(2);
    expect(layerNames()).toEqual([DEFAULT_LAYER_NAME, "ui", "debug"]);
  });

  it("does not define a name that is only looked up", () => {
    expect(layerIndex("ui")).toBeUndefined();
    expect(layerNames()).toEqual([DEFAULT_LAYER_NAME]);
  });

  it("reports no name for a bit nothing has claimed", () => {
    expect(layerName(7)).toBeUndefined();
  });

  it("hands out a copy of the name table, not the live array", () => {
    defineLayer("ui");
    const first = layerNames();
    (first as string[]).push("smuggled");
    expect(layerNames()).toEqual([DEFAULT_LAYER_NAME, "ui"]);
  });

  it("refuses an empty layer name (§46 requires a serializable name)", () => {
    expect(() => defineLayer("")).toThrow(/must not be empty/u);
    try {
      defineLayer("");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      if (isFourError(error)) {
        expect(error.code).toBe("INVALID_APPLICATION_STATE");
      }
    }
  });

  it("refuses the thirty-third layer rather than aliasing two onto one bit", () => {
    for (let i = 1; i < LAYER_COUNT; i += 1) {
      expect(defineLayer(`layer-${String(i)}`)).toBe(i);
    }
    expect(layerNames()).toHaveLength(LAYER_COUNT);
    expect(() => defineLayer("one-too-many")).toThrow(/all 32 layers/u);
    try {
      defineLayer("one-too-many");
    } catch (error) {
      if (isFourError(error)) {
        expect(error.code).toBe("INVALID_APPLICATION_STATE");
        expect(error.context?.name).toBe("one-too-many");
        expect(error.context?.defined).toHaveLength(LAYER_COUNT);
      }
    }
    // An already-defined name still resolves once the table is full.
    expect(defineLayer("layer-31")).toBe(31);
  });

  it("puts the registry back to its seeded state on reset", () => {
    defineLayer("ui");
    defineLayer("debug");
    resetLayers();
    expect(layerNames()).toEqual([DEFAULT_LAYER_NAME]);
    // The re-run reproduces the same assignment, which is what makes a §79
    // reader able to restore a document's bits by replaying its names.
    expect(defineLayer("ui")).toBe(1);
    expect(defineLayer("debug")).toBe(2);
  });
});

describe("§46 — compiling names to masks", () => {
  it("builds the mask that contains exactly the named layers", () => {
    expect(layerMask(DEFAULT_LAYER_NAME)).toBe(DEFAULT_LAYER_MASK);
    expect(layerMask("ui")).toBe(0b10);
    expect(layerMask(DEFAULT_LAYER_NAME, "ui")).toBe(0b11);
    expect(layerMask("ui", DEFAULT_LAYER_NAME)).toBe(0b11);
  });

  it("compiles no names to NO_LAYERS", () => {
    expect(layerMask()).toBe(NO_LAYERS);
    expect(NO_LAYERS).toBe(0);
  });

  it("defines unknown names on the way through", () => {
    expect(layerMask("ui")).toBe(0b10);
    expect(layerIndex("ui")).toBe(1);
  });

  it("keeps bit 31 unsigned rather than letting `|` sign-extend it", () => {
    for (let i = 1; i < LAYER_COUNT; i += 1) {
      defineLayer(`layer-${String(i)}`);
    }
    const top = layerMask("layer-31");
    expect(top).toBe(0x8000_0000);
    expect(top).toBeGreaterThan(0);
    expect(isLayerMask(top)).toBe(true);
    // And it still matches, because `&` coerces both operands to int32.
    expect(layersMatch(top, ALL_LAYERS)).toBe(true);
  });

  it("decodes a mask back to names, skipping bits no layer has claimed", () => {
    defineLayer("ui");
    defineLayer("debug");
    expect(layerMaskNames(layerMask("ui", "debug"))).toEqual(["ui", "debug"]);
    expect(layerMaskNames(NO_LAYERS)).toEqual([]);
    // ALL_LAYERS names every layer that exists and invents none.
    expect(layerMaskNames(ALL_LAYERS)).toEqual([
      DEFAULT_LAYER_NAME,
      "ui",
      "debug",
    ]);
  });
});

describe("§46 — the matching predicate", () => {
  it("is a set intersection: true when the masks share a bit", () => {
    expect(layersMatch(0b001, 0b011)).toBe(true);
    expect(layersMatch(0b100, 0b011)).toBe(false);
    expect(layersMatch(NO_LAYERS, ALL_LAYERS)).toBe(false);
    expect(layersMatch(ALL_LAYERS, DEFAULT_LAYER_MASK)).toBe(true);
  });

  it("is symmetric", () => {
    expect(layersMatch(0b010, 0b110)).toBe(layersMatch(0b110, 0b010));
    expect(layersMatch(0b010, 0b100)).toBe(layersMatch(0b100, 0b010));
  });

  it("makes ALL_LAYERS match every mask a node can hold by default", () => {
    expect(ALL_LAYERS).toBe(0xffff_ffff);
    for (let i = 0; i < LAYER_COUNT; i += 1) {
      expect(layersMatch((1 << i) >>> 0, ALL_LAYERS)).toBe(true);
    }
  });
});

describe("§85 — mask validation", () => {
  it("accepts every integer in [0, 0xffffffff] and nothing else", () => {
    expect(isLayerMask(0)).toBe(true);
    expect(isLayerMask(1)).toBe(true);
    expect(isLayerMask(ALL_LAYERS)).toBe(true);
    expect(isLayerMask(ALL_LAYERS + 1)).toBe(false);
    expect(isLayerMask(-1)).toBe(false);
    expect(isLayerMask(1.5)).toBe(false);
    expect(isLayerMask(Number.NaN)).toBe(false);
    expect(isLayerMask(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("throws INVALID_SCENE_GRAPH naming the field, in every build", () => {
    expect(() => {
      assertLayerMask(Number.NaN, "view.layerMask");
    }).toThrow(/view\.layerMask/u);
    try {
      assertLayerMask(Number.NaN, "view.layerMask");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      if (isFourError(error)) {
        expect(error.code).toBe("INVALID_SCENE_GRAPH");
        expect(error.context?.field).toBe("view.layerMask");
      }
    }
  });

  it("passes a well-formed mask through silently", () => {
    expect(() => {
      assertLayerMask(ALL_LAYERS, "camera.layers");
    }).not.toThrow();
  });
});

describe("§46 — Node.layers", () => {
  it("starts on the default layer and nothing else", () => {
    const node = new Group();
    expect(node.layers).toBe(DEFAULT_LAYER_MASK);
    expect(layerMaskNames(node.layers)).toEqual([DEFAULT_LAYER_NAME]);
  });

  it("gates the node only — a child keeps its own membership", () => {
    const parent = new Group();
    const child = new Group();
    parent.add(child);

    parent.layers = layerMask("ui");

    expect(parent.layers).toBe(layerMask("ui"));
    expect(child.layers).toBe(DEFAULT_LAYER_MASK);
    expect(layersMatch(child.layers, layerMask(DEFAULT_LAYER_NAME))).toBe(true);
  });

  it("applies to a whole subtree only when asked (applyLayers)", () => {
    const root = new Group();
    const child = new Group();
    const grandchild = new Group();
    root.add(child);
    child.add(grandchild);

    applyLayers(root, layerMask("ui"));

    expect(root.layers).toBe(layerMask("ui"));
    expect(child.layers).toBe(layerMask("ui"));
    expect(grandchild.layers).toBe(layerMask("ui"));
  });

  it("re-applies idempotently, so a later child is easy to fold in", () => {
    const root = new Group();
    const first = new Group();
    root.add(first);
    applyLayers(root, layerMask("ui"));

    const second = new Group();
    root.add(second);
    expect(second.layers).toBe(DEFAULT_LAYER_MASK);

    applyLayers(root, layerMask("ui"));
    expect(first.layers).toBe(layerMask("ui"));
    expect(second.layers).toBe(layerMask("ui"));
  });

  it("refuses a malformed subtree mask (§85)", () => {
    expect(() => {
      applyLayers(new Group(), Number.NaN);
    }).toThrow(/applyLayers/u);
  });
});

describe("§47/§48 — camera and viewport masks", () => {
  it("gives a camera ALL_LAYERS: it sees everything until told otherwise", () => {
    const camera = new PerspectiveCamera();
    expect(camera.layers).toBe(ALL_LAYERS);
    expect(camera).toBeInstanceOf(Camera);
  });

  it("overrides Node.layers rather than adding a second field (§47)", () => {
    const camera = new PerspectiveCamera();
    const node = new Group();
    // One property, two defaults: a node belongs to `default`, a camera looks
    // at everything.
    expect(node.layers).toBe(DEFAULT_LAYER_MASK);
    expect(camera.layers).toBe(ALL_LAYERS);

    camera.layers = layerMask(DEFAULT_LAYER_NAME);
    expect(camera.layers).toBe(DEFAULT_LAYER_MASK);
  });

  it("re-aims a camera caught inside an applyLayers subtree (documented)", () => {
    const root = new Group();
    const camera = new PerspectiveCamera();
    root.add(camera);

    applyLayers(root, layerMask("ui"));

    expect(camera.layers).toBe(layerMask("ui"));
  });

  it("leaves a fullscreen viewport with no mask of its own", () => {
    const camera = new PerspectiveCamera();
    const view: Viewport = createFullscreenViewport(camera);
    expect(view.layerMask).toBeUndefined();
  });

  it("lets one camera feed two views that show different layers (§48)", () => {
    const camera = new PerspectiveCamera();
    const world: Viewport = {
      ...createFullscreenViewport(camera, "world"),
      layerMask: layerMask(DEFAULT_LAYER_NAME),
    };
    const ui: Viewport = {
      ...createFullscreenViewport(camera, "ui"),
      layerMask: layerMask("ui"),
    };

    const panel = new Group();
    panel.layers = layerMask("ui");
    const box = new Group();

    expect(layersMatch(box.layers, world.layerMask ?? camera.layers)).toBe(
      true,
    );
    expect(layersMatch(panel.layers, world.layerMask ?? camera.layers)).toBe(
      false,
    );
    expect(layersMatch(panel.layers, ui.layerMask ?? camera.layers)).toBe(true);
    expect(layersMatch(box.layers, ui.layerMask ?? camera.layers)).toBe(false);
  });
});
