/**
 * §79 for §58's paint-object tier (2026-08-29; R-16's follow-up).
 *
 * What is checked, in the module's own vocabulary:
 *
 * 1. **A paint-derived document is additive both ways.** It writes no
 *    material key — its material is derived from the paints the payload
 *    carries whole — and reloads `paintDerived` with every value intact,
 *    byte-for-byte across two trips.
 * 2. **A pattern's texture is a resource, not a value.** It travels as a
 *    logical key against the new `textures` catalog, with the resource
 *    rules: unresolvable keys refuse loudly, an uncatalogued texture throws
 *    on save (or writes `null` under `"skip"`).
 * 3. **The reading rules hold at the tier boundary.** A material key wins
 *    over an object paint (the picture cannot depend on registration); a
 *    malformed object paint drops to the material where one exists; a
 *    paint-derived document this build cannot restore refuses loudly naming
 *    `registerShapePaints()` instead of inventing a material.
 */

import { UnlitMaterial } from "@four/materials";
import type { MaterialTexture } from "@four/materials";
import {
  Circle,
  Line,
  Rectangle,
  Shape2D,
  clearRegisteredShapePaints,
  registerShapePaints,
  type LinearGradientPaint,
  type PatternPaint,
  type RadialGradientPaint,
  type ResolvedPatternPaint,
  type ResolvedRadialGradientPaint,
} from "@four/render";
import { Group } from "@four/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@four/serialization";
import { isFourError, type JsonValue } from "@four/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  registerSceneNodeTypes,
  registerShapeSerializers,
  resourceCatalog,
} from "../src/scene-serializers.js";

const ink = new UnlitMaterial({ color: [0.2, 0.3, 1, 1] });
const materials = resourceCatalog([["material/ink", ink]]);
const bricks = { id: 7, version: 0 } as unknown as MaterialTexture;
const textures = resourceCatalog<MaterialTexture>([["texture/bricks", bricks]]);

const LINEAR: LinearGradientPaint = {
  kind: "linear-gradient",
  from: { x: -1, y: 0 },
  to: { x: 1, y: 0.5 },
  stops: [
    { offset: 0, color: [1, 0, 0, 1] },
    { offset: 0.25, color: [1, 1, 0, 0.5] },
    { offset: 1, color: [0, 0, 1, 1] },
  ],
  opacity: 0.75,
};

const RADIAL: RadialGradientPaint = {
  kind: "radial-gradient",
  center: { x: 0.5, y: -0.5 },
  radius: 2,
  stops: [
    { offset: 0, color: [1, 1, 1, 1] },
    { offset: 1, color: [0, 0, 0, 1] },
  ],
};

const PATTERN: PatternPaint = {
  kind: "pattern",
  texture: bricks,
  repeat: { x: 4, y: 2 },
  offset: { x: 0.5, y: 0 },
  opacity: 0.5,
};

beforeEach(() => {
  registerShapePaints();
});

afterEach(() => {
  clearRegisteredShapePaints();
});

function support(
  options: Parameters<typeof registerShapeSerializers>[0] = {},
): ReturnType<typeof registerShapeSerializers> {
  return registerShapeSerializers({ materials, textures, ...options });
}

/** One write half → read half trip through the shape pair. */
function reload(shape: Shape2D, io = support()): Shape2D {
  const type = io.write.nodeTypeOf(shape) as string;
  const data = io.write.nodeDataOf(shape);
  return io.read.nodeFactory({ type, data }) as Shape2D;
}

describe("§79 paint-object writing", () => {
  it("writes no material key for a paint-derived shape", () => {
    const payload = support().write.nodeDataOf(
      new Circle({ fill: RADIAL }),
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("material");
    expect(payload.fill).toMatchObject({ kind: "radial-gradient" });
  });

  it("writes a pattern's texture as a catalog key", () => {
    const payload = support().write.nodeDataOf(
      new Circle({ fill: PATTERN }),
    ) as Record<string, { texture?: unknown }>;
    expect(payload.fill.texture).toBe("texture/bricks");
  });

  it("refuses to save an uncatalogued pattern texture, loudly", () => {
    const io = registerShapeSerializers({ materials });
    expect(() => io.write.nodeDataOf(new Circle({ fill: PATTERN }))).toThrow(
      /textures/,
    );
    try {
      io.write.nodeDataOf(new Circle({ fill: PATTERN }));
    } catch (error) {
      expect(isFourError(error)).toBe(true);
    }
  });

  it('writes a null texture reference under { unknownResources: "skip" }', () => {
    const io = registerShapeSerializers({
      materials,
      unknownResources: "skip",
    });
    const payload = io.write.nodeDataOf(
      new Circle({ fill: PATTERN }),
    ) as Record<string, { texture?: unknown }>;
    expect(payload.fill.texture).toBeNull();
  });
});

describe("§79 paint-object round trips", () => {
  it("restores a linear-gradient fill and a solid stroke, values intact", () => {
    const shape = new Rectangle({
      width: 4,
      height: 2,
      fill: LINEAR,
      stroke: { width: 0.25, paint: { kind: "solid", color: [0, 1, 0, 1] } },
    });
    const reloaded = reload(shape);
    expect(reloaded.paintDerived).toBe(true);
    expect(reloaded.fill).toEqual(shape.fill);
    expect(reloaded.stroke).toEqual(shape.stroke);
    expect(reloaded.material.kind).toBe("node");
  });

  it("restores a radial fill with defaulted opacity", () => {
    const reloaded = reload(new Circle({ fill: RADIAL }));
    const fill = reloaded.fill as ResolvedRadialGradientPaint;
    expect(fill.kind).toBe("radial-gradient");
    expect(fill.center).toEqual({ x: 0.5, y: -0.5 });
    expect(fill.radius).toBe(2);
    expect(fill.opacity).toBe(1);
  });

  it("restores a pattern through the textures catalog, by reference", () => {
    const reloaded = reload(
      new Line({
        start: { x: 0, y: 0 },
        end: { x: 2, y: 1 },
        stroke: { width: 0.2, paint: PATTERN },
      }),
    );
    const paint = reloaded.stroke?.paint as ResolvedPatternPaint;
    expect(paint.kind).toBe("pattern");
    expect(paint.texture).toBe(bricks);
    expect(paint.repeat).toEqual({ x: 4, y: 2 });
    expect(paint.offset).toEqual({ x: 0.5, y: 0 });
    expect(paint.opacity).toBe(0.5);
  });

  it("round-trips a painted scene through text, twice, byte for byte", () => {
    const io = registerSceneNodeTypes({ materials, textures });
    const root = new Group();
    root.add(new Rectangle({ width: 4, height: 2, fill: LINEAR }));
    root.add(
      new Circle({
        radius: 2,
        fill: RADIAL,
        stroke: { width: 0.1, paint: PATTERN },
      }),
    );
    root.add(new Circle({ radius: 1, material: ink })); // the material tier, beside it
    const first = encodeSceneDocument(
      serializeScene(root, io.components, io.write),
    );
    const reloaded = instantiateScene(
      decodeSceneDocument(first),
      io.components,
      io.read,
    );
    const second = encodeSceneDocument(
      serializeScene(reloaded, io.components, io.write),
    );
    expect(second).toBe(first);
    expect((reloaded.children[0] as Shape2D).paintDerived).toBe(true);
    expect((reloaded.children[2] as Shape2D).paintDerived).toBe(false);
  });
});

describe("§79 paint-object reading rules", () => {
  const document = (data: Record<string, JsonValue>) => ({
    type: "render:circle",
    id: "node-1",
    data: { radius: 1, ...data },
  });

  it("lets a material key win over an object paint — registration cannot change the picture", () => {
    const io = support();
    const withBoth = io.read.nodeFactory(
      document({
        material: "material/ink",
        fill: {
          kind: "linear-gradient",
          from: [-1, 0],
          to: [1, 0],
          stops: [
            { offset: 0, color: [1, 0, 0, 1] },
            { offset: 1, color: [0, 0, 1, 1] },
          ],
        },
      }),
    ) as Shape2D;
    expect(withBoth.paintDerived).toBe(false);
    expect(withBoth.material).toBe(ink);
    expect(withBoth.fill).toBe("inherit");
  });

  it("drops a malformed object paint to the material where one exists", () => {
    const io = support();
    const cases: JsonValue[] = [
      { kind: "linear-gradient" }, // no axis, no stops
      { kind: "linear-gradient", from: [0, 0], to: [1, 0], stops: "x" },
      {
        kind: "linear-gradient",
        from: [0, 0],
        to: [1, 0],
        stops: [{ offset: 0 }],
      },
      {
        kind: "linear-gradient",
        from: [0, 0],
        to: [0, 0], // zero axis — refused by the support, dropped here
        stops: [
          { offset: 0, color: [1, 0, 0, 1] },
          { offset: 1, color: [0, 0, 1, 1] },
        ],
      },
      { kind: "radial-gradient", center: [0, 0], stops: [] },
      { kind: "pattern" }, // no texture key
      { kind: "pattern", texture: null }, // written under "skip"
      { kind: "conic-gradient" }, // §58 lists it; no build draws it
      "gibberish",
      42,
    ];
    for (const fill of cases) {
      const reloaded = io.read.nodeFactory(
        document({ material: "material/ink", fill }),
      ) as Shape2D;
      expect(reloaded.fill).toBe("inherit");
      expect(reloaded.material).toBe(ink);
    }
  });

  it("defaults a pattern's transform and drops only its unusable opacity", () => {
    const io = support();
    const reloaded = io.read.nodeFactory(
      document({
        fill: { kind: "pattern", texture: "texture/bricks", opacity: 7 },
      }),
    ) as Shape2D;
    const paint = reloaded.fill as ResolvedPatternPaint;
    expect(paint.repeat).toEqual({ x: 1, y: 1 });
    expect(paint.offset).toEqual({ x: 0, y: 0 });
    expect(paint.opacity).toBe(1);
  });

  it("refuses an unresolvable pattern texture key loudly — the resource rule", () => {
    const io = support();
    expect(() =>
      io.read.nodeFactory(
        document({ fill: { kind: "pattern", texture: "texture/unknown" } }),
      ),
    ).toThrowError(/no catalog resolves/);
  });

  it("refuses a paint-derived document it cannot restore, naming the fix", () => {
    const io = support();
    // Well-formed conic: keyless, and no build draws it.
    expect(() =>
      io.read.nodeFactory(document({ fill: { kind: "conic-gradient" } })),
    ).toThrowError(/registerShapePaints/);
    // A malformed gradient with no material to fall back to.
    expect(() =>
      io.read.nodeFactory(
        document({ stroke: { width: 1, paint: { kind: "linear-gradient" } } }),
      ),
    ).toThrowError(/registerShapePaints/);
  });

  it("refuses every keyless malformed paint the same way — no invented material", () => {
    const io = support();
    const fills: JsonValue[] = [
      { kind: "linear-gradient" }, // structure missing entirely
      { kind: "linear-gradient", from: [0, 0], to: [1, 0], stops: "x" },
      {
        kind: "linear-gradient",
        from: [0, 0],
        to: [1, 0],
        stops: [{ offset: 0 }], // a stop without a colour
      },
      {
        kind: "linear-gradient",
        from: [0, 0],
        to: [0, 0], // zero axis — assembles, then the support refuses it
        stops: [
          { offset: 0, color: [1, 0, 0, 1] },
          { offset: 1, color: [0, 0, 1, 1] },
        ],
      },
      { kind: "radial-gradient", center: [0, 0], stops: [] }, // no radius
      { kind: "pattern" }, // no texture key
      { kind: "pattern", texture: null }, // written under "skip"
    ];
    for (const fill of fills) {
      expect(() => io.read.nodeFactory(document({ fill }))).toThrowError(
        /registerShapePaints|cannot restore/,
      );
    }
    // A pattern whose key exists but resolves through *no* catalog at all is
    // the resource refusal, not the restore refusal.
    const keyless = registerShapeSerializers({ materials });
    expect(() =>
      keyless.read.nodeFactory(
        document({ fill: { kind: "pattern", texture: "texture/bricks" } }),
      ),
    ).toThrowError(/no catalog resolves/);
    // …and both refusals survive a document node that carries no id (§79
    // makes ids optional).
    expect(() =>
      keyless.read.nodeFactory({
        type: "render:circle",
        data: {
          radius: 1,
          fill: { kind: "pattern", texture: "texture/bricks" },
        },
      }),
    ).toThrowError(/no catalog resolves/);
    expect(() =>
      io.read.nodeFactory({
        type: "render:circle",
        data: { radius: 1, fill: { kind: "conic-gradient" } },
      }),
    ).toThrowError(/registerShapePaints/);
  });

  it("refuses the same document when the tier is unregistered", () => {
    clearRegisteredShapePaints();
    const io = support();
    expect(() =>
      io.read.nodeFactory(
        document({
          fill: {
            kind: "radial-gradient",
            center: [0, 0],
            radius: 1,
            stops: [
              { offset: 0, color: [1, 0, 0, 1] },
              { offset: 1, color: [0, 0, 1, 1] },
            ],
          },
        }),
      ),
    ).toThrowError(/registerShapePaints/);
    // …but the same paint beside a material key still loads, dropped.
    const reloaded = io.read.nodeFactory(
      document({
        material: "material/ink",
        fill: {
          kind: "radial-gradient",
          center: [0, 0],
          radius: 1,
          stops: [
            { offset: 0, color: [1, 0, 0, 1] },
            { offset: 1, color: [0, 0, 1, 1] },
          ],
        },
      }),
    ) as Shape2D;
    expect(reloaded.material).toBe(ink);
    expect(reloaded.fill).toBe("inherit");
  });

  it("still refuses a keyless, paintless shape the way it always has", () => {
    const io = support();
    expect(() => io.read.nodeFactory(document({}))).toThrowError(
      /names no material/,
    );
  });

  it("reads a gradient opacity only when it is usable", () => {
    const io = support();
    const reloaded = io.read.nodeFactory(
      document({
        fill: {
          kind: "linear-gradient",
          from: [-1, 0],
          to: [1, 0],
          stops: [
            { offset: 0, color: [1, 0, 0, 1] },
            { offset: 1, color: [0, 0, 1, 1] },
          ],
          opacity: -3,
        },
      }),
    ) as Shape2D;
    expect((reloaded.fill as ResolvedRadialGradientPaint).opacity).toBe(1);
  });
});
