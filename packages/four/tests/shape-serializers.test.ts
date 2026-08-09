/**
 * §79 for §50's shape family (R-23, 2026-08-09).
 *
 * Three properties are checked, and they are different properties:
 *
 * 1. **Every shipped shape has a pair.** The registry is walked off
 *    `@four/render`'s own barrel, so a tenth shape class fails this suite until
 *    it is registered — the mechanical guard the family gets nothing else from.
 * 2. **A document says what the shape is.** Every parameter round-trips, and
 *    the reloaded node draws the same fill.
 * 3. **A corrupted document is read the way §96 asks.** A field with a class
 *    default restores that default; a parameter that *is* the shape is refused
 *    loudly rather than invented.
 */

import { UnlitMaterial } from "@four/materials";
import { Path } from "@four/geometry";
import {
  Arc,
  Circle,
  Ellipse,
  Line,
  PathShape,
  Polygon,
  Polyline,
  Rectangle,
  RegularPolygon,
  Ring,
  Sector,
  Shape2D,
  Star,
} from "@four/render";
import { Group } from "@four/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
  type SceneNodeDocument,
} from "@four/serialization";
import { isFourError, type JsonValue } from "@four/core";
import { describe, expect, it } from "vitest";

import * as render from "../src/render.js";
import {
  ARC_NODE_TYPE,
  CIRCLE_NODE_TYPE,
  ELLIPSE_NODE_TYPE,
  LINE_NODE_TYPE,
  POLYLINE_NODE_TYPE,
  PATH_SHAPE_NODE_TYPE,
  POLYGON_NODE_TYPE,
  RECTANGLE_NODE_TYPE,
  REGULAR_POLYGON_NODE_TYPE,
  RING_NODE_TYPE,
  SECTOR_NODE_TYPE,
  STAR_NODE_TYPE,
  registerSceneNodeTypes,
  registerShapeSerializers,
  resourceCatalog,
} from "../src/scene-serializers.js";

const ink = new UnlitMaterial({ color: [0.2, 0.3, 1, 1] });
const materials = resourceCatalog([["material/ink", ink]]);
const support = (): ReturnType<typeof registerShapeSerializers> =>
  registerShapeSerializers({ materials });

/** Every §50 shape, one instance each, in the order they are documented. */
function everyShape(): Shape2D[] {
  return [
    new Circle({ radius: 2, material: ink }),
    new Ellipse({ radiusX: 3, radiusY: 1, startAngle: 0.4, material: ink }),
    new Rectangle({ width: 8, height: 4, radius: 1, material: ink }),
    new RegularPolygon({
      sides: 7,
      radius: 2,
      startAngle: 0.2,
      material: ink,
    }),
    new Polygon({
      points: [
        { x: 0, y: 1 },
        { x: -1, y: -1 },
        { x: 0, y: -0.4 },
        { x: 1, y: -1 },
      ],
      material: ink,
    }),
    new Star({
      points: 5,
      innerRadius: 0.4,
      outerRadius: 1,
      startAngle: 0.1,
      material: ink,
    }),
    new Sector({ radius: 2, startAngle: 0.3, endAngle: 2.1, material: ink }),
    new Ring({ innerRadius: 0.6, outerRadius: 1, material: ink }),
    new PathShape({
      path: new Path({ fillRule: "even-odd" })
        .moveTo(0, 0)
        .lineTo(2, 0)
        .quadraticCurveTo(3, 1, 2, 2)
        .cubicCurveTo(1.5, 2.5, 0.5, 2.5, 0, 2)
        .close()
        .moveTo(6, 0)
        .arc(5, 0, 1, 0, Math.PI * 2)
        .close(),
      material: ink,
    }),
    new Line({
      start: { x: -1, y: -2 },
      end: { x: 3, y: 0.5 },
      stroke: { width: 0.25, lineCap: "round" },
      material: ink,
    }),
    new Polyline({
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 2 },
        { x: 3, y: 1 },
      ],
      stroke: { width: 0.2, lineJoin: "bevel", dash: [0.5, 0.25] },
      material: ink,
    }),
    new Arc({
      radius: 2,
      startAngle: 0.25,
      endAngle: 2.5,
      stroke: { width: 0.1, alignment: "outside" },
      material: ink,
    }),
  ];
}

/** Reads a shape's fill as a signed area, the oracle the family is tested by. */
function filledArea(shape: Shape2D): number {
  const geometry = shape.geometry;
  const indices = geometry.indices ?? new Uint16Array(0);
  const positions = geometry.positions;
  let twice = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    twice +=
      (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1]) -
      (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]);
  }
  return twice / 2;
}

describe("registerShapeSerializers — every §50 shape is registered", () => {
  it("names a document type for every Shape2D subclass @four/render exports", () => {
    const io = support();
    const shapes: string[] = [];
    for (const [name, value] of Object.entries(
      render as Record<string, unknown>,
    )) {
      if (typeof value !== "function") continue;
      if (value === Shape2D) continue;
      if (!Object.prototype.isPrototypeOf.call(Shape2D, value)) continue;
      shapes.push(name);
    }
    expect(shapes.sort()).toEqual([
      "Arc",
      "Circle",
      "Ellipse",
      "Line",
      "PathShape",
      "Polygon",
      "Polyline",
      "Rectangle",
      "RegularPolygon",
      "Ring",
      "Sector",
      "Star",
    ]);
    // …and every one of them writes a type. The instances carry the shape's
    // own required parameters, so this also proves each constructor is
    // reachable through the pair that has to rebuild it.
    for (const shape of everyShape()) {
      expect(io.write.nodeTypeOf(shape)).toBeTypeOf("string");
    }
    expect(new Set(everyShape().map((s) => io.write.nodeTypeOf(s))).size).toBe(
      shapes.length,
    );
  });

  it("answers nothing for a node that is not a shape", () => {
    const io = support();
    const group = new Group();
    expect(io.write.nodeTypeOf(group)).toBeUndefined();
    expect(io.write.nodeDataOf(group)).toBeUndefined();
    expect(io.read.nodeFactory({ type: "ui:panel" })).toBeUndefined();
  });

  it("does not swallow a subclass an application writes", () => {
    class Squircle extends Rectangle {}
    const io = support();
    const squircle = new Squircle({ material: ink });
    expect(io.write.nodeTypeOf(squircle)).toBeUndefined();
    expect(io.write.nodeDataOf(squircle)).toBeUndefined();
  });
});

describe("registerShapeSerializers — a document says what the shape is", () => {
  it("round-trips every shape's parameters and its fill", () => {
    const io = support();
    for (const shape of everyShape()) {
      shape.renderLayer = 3;
      shape.renderOrder = 7;
      shape.castShadow = false;
      shape.tolerance = 0.005;
      const type = io.write.nodeTypeOf(shape) as string;
      const data = io.write.nodeDataOf(shape);
      const reloaded = io.read.nodeFactory({ type, data }) as Shape2D;
      expect(reloaded.constructor).toBe(shape.constructor);
      expect(reloaded.renderLayer).toBe(3);
      expect(reloaded.renderOrder).toBe(7);
      expect(reloaded.castShadow).toBe(false);
      expect(reloaded.receiveShadow).toBe(true);
      expect(reloaded.tolerance).toBe(0.005);
      expect(reloaded.material).toBe(ink);
      // The fill is the real assertion: every parameter reached the class, in
      // the right slot, or the tessellation would move.
      expect(filledArea(reloaded)).toBeCloseTo(filledArea(shape), 6);
      expect(reloaded.geometry.vertexCount).toBe(shape.geometry.vertexCount);
    }
  });

  it("carries no geometry key — a shape derives and owns its fill (§83)", () => {
    const io = support();
    const payload = io.write.nodeDataOf(
      new Circle({ material: ink }),
    ) as Record<string, unknown>;
    expect(payload.material).toBe("material/ink");
    expect(payload).not.toHaveProperty("geometry");
  });

  it("round-trips a whole scene through text, twice, byte for byte", () => {
    const io = registerSceneNodeTypes({ materials });
    const root = new Group();
    for (const shape of everyShape()) root.add(shape);

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
    expect(reloaded.children).toHaveLength(12);
    // No `geometries` catalog was supplied and nothing was skipped: a shape
    // needs none, because its fill is a function of the payload above (§83).
  });

  it("keeps an arc-bearing path's document byte-stable, sweep ulps and all", () => {
    // The one number that is not bit-exact: §51 stores a signed sweep and its
    // builder takes an end angle, so the recomputed sweep can move in its last
    // bits. Writing the *end* angle is what keeps the document exact anyway.
    const io = support();
    const path = new Path()
      .moveTo(0, 0)
      .arc(3, 4, 2, 5.5, 7.1)
      .arc(9, 1, 1, -2.25, -8.6, true)
      .arc(0, 0, 1, 0.75, 0.75 + Math.PI * 2)
      .close();
    const shape = new PathShape({ path, material: ink });
    const data = io.write.nodeDataOf(shape);
    const reloaded = io.read.nodeFactory({
      type: PATH_SHAPE_NODE_TYPE,
      data,
    }) as PathShape;
    expect(io.write.nodeDataOf(reloaded)).toEqual(data);

    const before = path.commands.filter((c) => c.kind === "arc");
    const after = reloaded.path.commands.filter((c) => c.kind === "arc");
    expect(after).toHaveLength(3);
    for (let i = 0; i < after.length; i += 1) {
      expect(Math.abs(after[i].deltaAngle - before[i].deltaAngle)).toBeLessThan(
        1e-14,
      );
    }
    // A whole turn is exact in both directions, by `arcSweep`'s early exit.
    expect(after[2].deltaAngle).toBe(Math.PI * 2);
  });

  it("writes each §51 command kind with its SVG letter", () => {
    const io = support();
    const path = new Path()
      .moveTo(0, 0)
      .lineTo(1, 0)
      .quadraticCurveTo(2, 1, 1, 2)
      .cubicCurveTo(0.5, 2.5, -0.5, 2.5, -1, 2)
      .arc(-1, 1, 1, Math.PI / 2, -Math.PI / 2, true)
      .close();
    const data = io.write.nodeDataOf(
      new PathShape({ path, material: ink }),
    ) as { path: { fillRule: string; commands: unknown[][] } };
    expect(data.path.fillRule).toBe("nonzero");
    expect(data.path.commands.map((command) => command[0])).toEqual([
      "M",
      "L",
      "Q",
      "C",
      "A",
      "Z",
    ]);
    expect(data.path.commands[4]).toHaveLength(8);
  });
});

describe("registerShapeSerializers — reading a document that lies", () => {
  const io = support();
  const withMaterial = (
    type: string,
    data: Record<string, unknown>,
  ): SceneNodeDocument => ({
    type,
    id: "node-1",
    data: { material: "material/ink", ...data },
  });

  it("restores class defaults for every field the class defaults", () => {
    const circle = io.read.nodeFactory(
      withMaterial(CIRCLE_NODE_TYPE, {
        radius: -4,
        tolerance: "wide",
        renderLayer: Number.NaN,
      }),
    ) as Circle;
    expect(circle.radius).toBe(1);
    expect(circle.tolerance).toBeCloseTo(0.01, 12);
    expect(circle.renderLayer).toBe(0);

    const ellipse = io.read.nodeFactory(
      withMaterial(ELLIPSE_NODE_TYPE, { radiusX: 0, radiusY: null }),
    ) as Ellipse;
    expect(ellipse.radiusX).toBe(1);
    expect(ellipse.radiusY).toBe(1);
    expect(ellipse.startAngle).toBe(0);

    const sector = io.read.nodeFactory(
      withMaterial(SECTOR_NODE_TYPE, {
        radius: -1,
        startAngle: 0,
        endAngle: 1,
      }),
    ) as Sector;
    expect(sector.radius).toBe(1);

    const polygon = io.read.nodeFactory(
      withMaterial(REGULAR_POLYGON_NODE_TYPE, { sides: 5, radius: 0 }),
    ) as RegularPolygon;
    expect(polygon.radius).toBe(1);
    expect(polygon.startAngle).toBe(0);
  });

  it("restores square corners when a rectangle's radius cannot fit", () => {
    const tooRound = io.read.nodeFactory(
      withMaterial(RECTANGLE_NODE_TYPE, { width: 2, height: 1, radius: 5 }),
    ) as Rectangle;
    expect(tooRound.radius).toBe(0);
    expect(tooRound.width).toBe(2);

    const negative = io.read.nodeFactory(
      withMaterial(RECTANGLE_NODE_TYPE, { radius: -1 }),
    ) as Rectangle;
    expect(negative.radius).toBe(0);
    expect(negative.width).toBe(1);
    expect(negative.height).toBe(1);

    const unusable = io.read.nodeFactory(
      withMaterial(RECTANGLE_NODE_TYPE, { width: "wide", height: 0 }),
    ) as Rectangle;
    expect(unusable.width).toBe(1);
    expect(unusable.height).toBe(1);

    const fits = io.read.nodeFactory(
      withMaterial(RECTANGLE_NODE_TYPE, { width: 4, height: 2, radius: 1 }),
    ) as Rectangle;
    expect(fits.radius).toBe(1);
  });

  it("refuses a parameter that is the shape rather than inventing one", () => {
    const refusals: readonly (readonly [string, Record<string, unknown>])[] = [
      [REGULAR_POLYGON_NODE_TYPE, {}],
      [REGULAR_POLYGON_NODE_TYPE, { sides: 2 }],
      [REGULAR_POLYGON_NODE_TYPE, { sides: 4.5 }],
      [STAR_NODE_TYPE, { innerRadius: 1, outerRadius: 2 }],
      [STAR_NODE_TYPE, { points: 5, outerRadius: 2 }],
      [STAR_NODE_TYPE, { points: 5, innerRadius: 0 }],
      [STAR_NODE_TYPE, { points: 5, innerRadius: 2, outerRadius: 1 }],
      [SECTOR_NODE_TYPE, { endAngle: 1 }],
      [SECTOR_NODE_TYPE, { startAngle: 1 }],
      [RING_NODE_TYPE, { outerRadius: 2 }],
      [RING_NODE_TYPE, { innerRadius: 2, outerRadius: 1 }],
      [POLYGON_NODE_TYPE, {}],
      [POLYGON_NODE_TYPE, { points: "three" }],
      [
        POLYGON_NODE_TYPE,
        {
          points: [
            [0, 0],
            [1, 0],
          ],
        },
      ],
      [
        POLYGON_NODE_TYPE,
        {
          points: [
            [0, 0],
            [1, 0],
            [1, Number.NaN],
          ],
        },
      ],
    ];
    for (const [type, data] of refusals) {
      let thrown: unknown;
      try {
        io.read.nodeFactory(withMaterial(type, data));
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown) && thrown.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
    }
  });

  it("accepts a legal star and ring, so the refusals above are about the data", () => {
    const star = io.read.nodeFactory(
      withMaterial(STAR_NODE_TYPE, {
        points: 6,
        innerRadius: 0.5,
        outerRadius: 2,
        startAngle: 0.5,
      }),
    ) as Star;
    expect(star.points).toBe(6);
    expect(star.startAngle).toBe(0.5);

    const ring = io.read.nodeFactory(
      withMaterial(RING_NODE_TYPE, { innerRadius: 0.5, outerRadius: 3 }),
    ) as Ring;
    expect(ring.outerRadius).toBe(3);
  });

  it("reads a path defensively, and refuses one that is not well formed", () => {
    const empty = io.read.nodeFactory(
      withMaterial(PATH_SHAPE_NODE_TYPE, {}),
    ) as PathShape;
    expect(empty.path.isEmpty).toBe(true);
    expect(empty.path.fillRule).toBe("nonzero");
    expect(empty.geometry.vertexCount).toBe(0);

    const noCommands = io.read.nodeFactory(
      withMaterial(PATH_SHAPE_NODE_TYPE, {
        path: { fillRule: "even-odd", commands: "none" },
      }),
    ) as PathShape;
    expect(noCommands.path.isEmpty).toBe(true);
    expect(noCommands.path.fillRule).toBe("even-odd");

    const malformed: readonly unknown[] = [
      [["X", 1, 2]],
      [["M", 1]],
      [["M", 1, 2, 3]],
      [["M", 1, "two"]],
      [
        ["M", 0, 0],
        ["Z", 1],
      ],
      ["M"],
      // A `Z` that closes nothing: the builder's own §85 refusal, translated.
      [["Z"]],
      // An arc of zero radius: likewise.
      [["A", 0, 0, 0, 1, 0, 0, 1]],
    ];
    for (const commands of malformed) {
      let thrown: unknown;
      try {
        io.read.nodeFactory(
          withMaterial(PATH_SHAPE_NODE_TYPE, { path: { commands } }),
        );
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown) && thrown.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(isFourError(thrown) && thrown.cause).toBeInstanceOf(RangeError);
    }
  });

  it("names the node as null when the document carries no id", () => {
    // §79 ids are optional, and all three refusals above read one; a document
    // written without ids must still produce a message rather than a crash.
    const anonymous: readonly (readonly [string, Record<string, unknown>])[] = [
      [REGULAR_POLYGON_NODE_TYPE, {}],
      [POLYGON_NODE_TYPE, {}],
      [PATH_SHAPE_NODE_TYPE, { path: { commands: [["Z"]] } }],
    ];
    for (const [type, data] of anonymous) {
      let thrown: unknown;
      try {
        io.read.nodeFactory({
          type,
          data: { material: "material/ink", ...data },
        });
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown) && thrown.message).toContain("node null");
      expect(isFourError(thrown) && thrown.context?.node).toBeNull();
    }
  });

  it("refuses a shape whose material key no catalog resolves (§79)", () => {
    let thrown: unknown;
    try {
      io.read.nodeFactory({
        type: CIRCLE_NODE_TYPE,
        data: { material: "material/nothing" },
      });
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });

  it("writes a null material key under the skip policy, and still refuses to load it", () => {
    const skipping = registerShapeSerializers({ unknownResources: "skip" });
    const payload = skipping.write.nodeDataOf(
      new Circle({ material: ink }),
    ) as Record<string, unknown>;
    expect(payload.material).toBeNull();
    expect(() =>
      skipping.read.nodeFactory({
        type: CIRCLE_NODE_TYPE,
        data: payload as never,
      }),
    ).toThrow();
  });

  it("refuses to write a shape whose material no catalog names", () => {
    const bare = registerShapeSerializers();
    expect(() =>
      bare.write.nodeDataOf(new Circle({ material: ink })),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// §58's fill and stroke (R-16, 2026-08-09)
// ---------------------------------------------------------------------------

const paintedInk = new UnlitMaterial({ vertexColors: true });
const paintedMaterials = resourceCatalog([
  ["material/ink", ink],
  ["material/painted", paintedInk],
]);
const paintedSupport = (): ReturnType<typeof registerShapeSerializers> =>
  registerShapeSerializers({ materials: paintedMaterials });

describe("registerShapeSerializers — §58 is additive in both directions", () => {
  it("writes no fill or stroke key for a shape that names neither", () => {
    const io = support();
    const payload = io.write.nodeDataOf(
      new Circle({ material: ink }),
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("fill");
    expect(payload).not.toHaveProperty("stroke");
  });

  it("restores a pre-R-16 document as a fill-only shape", () => {
    const io = support();
    const circle = io.read.nodeFactory({
      type: CIRCLE_NODE_TYPE,
      data: { material: "material/ink", radius: 3 },
    }) as Circle;
    expect(circle.fill).toBe("inherit");
    expect(circle.stroke).toBeNull();
    expect(circle.radius).toBe(3);
  });

  it("round-trips a paint, its opacity, and a whole stroke style", () => {
    const io = paintedSupport();
    const shape = new Rectangle({
      width: 4,
      height: 2,
      material: paintedInk,
      fill: { kind: "solid", color: [0.25, 0.5, 1, 0.75], opacity: 0.5 },
      stroke: {
        width: 0.2,
        paint: { kind: "solid", color: [1, 1, 1, 1] },
        alignment: "outside",
        lineCap: "round",
        lineJoin: "bevel",
        miterLimit: 8,
        dash: [1, 0.5],
        dashOffset: 0.25,
      },
    });
    const data = io.write.nodeDataOf(shape);
    const reloaded = io.read.nodeFactory({
      type: RECTANGLE_NODE_TYPE,
      data,
    }) as Rectangle;
    expect(reloaded.fill).toEqual({
      kind: "solid",
      color: [0.25, 0.5, 1, 0.75],
      opacity: 0.5,
    });
    expect(reloaded.stroke).toEqual(shape.stroke);
    expect(io.write.nodeDataOf(reloaded)).toEqual(data);
  });

  it("writes a stroke with no paint and no dash without inventing either", () => {
    const io = support();
    const shape = new Circle({ material: ink, stroke: { width: 0.5 } });
    const data = io.write.nodeDataOf(shape);
    const stroke = (data as { readonly [key: string]: JsonValue }).stroke;
    expect(stroke).not.toHaveProperty("paint");
    expect(stroke).not.toHaveProperty("dash");
    const reloaded = io.read.nodeFactory({
      type: CIRCLE_NODE_TYPE,
      data,
    }) as Circle;
    expect(reloaded.stroke?.paint).toBeUndefined();
    expect(reloaded.stroke?.dash).toBeUndefined();
  });

  it("writes `none` for an outlined shape and reads it back", () => {
    const io = support();
    const shape = new Rectangle({
      material: ink,
      fill: "none",
      stroke: { width: 0.1 },
    });
    const data = io.write.nodeDataOf(shape);
    expect((data as { readonly [key: string]: JsonValue }).fill).toBe("none");
    const reloaded = io.read.nodeFactory({
      type: RECTANGLE_NODE_TYPE,
      data,
    }) as Rectangle;
    expect(reloaded.fill).toBe("none");
  });
});

describe("registerShapeSerializers — the three stroke-only shapes", () => {
  it("round-trips a line, a polyline and an arc through text", () => {
    const io = registerSceneNodeTypes({ materials });
    const root = new Group();
    root.add(
      new Line({
        start: { x: -1, y: -2 },
        end: { x: 3, y: 0.5 },
        stroke: { width: 0.25, lineCap: "square" },
        material: ink,
      }),
    );
    root.add(
      new Polyline({
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 2 },
          { x: 3, y: 1 },
        ],
        stroke: { width: 0.2, dash: [0.5, 0.25], dashOffset: 0.1 },
        material: ink,
      }),
    );
    root.add(
      new Arc({
        radius: 2,
        startAngle: 0.25,
        endAngle: 2.5,
        stroke: { width: 0.1, alignment: "inside" },
        material: ink,
      }),
    );
    const first = encodeSceneDocument(
      serializeScene(root, io.components, io.write),
    );
    const reloaded = instantiateScene(
      decodeSceneDocument(first),
      io.components,
      io.read,
    );
    expect(
      encodeSceneDocument(serializeScene(reloaded, io.components, io.write)),
    ).toBe(first);
    const [line, polyline, arc] = reloaded.children as [Line, Polyline, Arc];
    expect(line.start).toEqual({ x: -1, y: -2 });
    expect(line.end).toEqual({ x: 3, y: 0.5 });
    expect(polyline.points).toHaveLength(3);
    expect(arc.startAngle).toBe(0.25);
    expect(arc.endAngle).toBe(2.5);
    // Their fill is `"none"` by default, so no document writes the word.
    expect(line.fill).toBe("none");
  });

  it("refuses a stroke-only document that carries no usable stroke", () => {
    const io = support();
    for (const type of [LINE_NODE_TYPE, POLYLINE_NODE_TYPE, ARC_NODE_TYPE]) {
      expect(() =>
        io.read.nodeFactory({
          type,
          data: { material: "material/ink" },
        }),
      ).toThrow(/only a stroke/);
    }
    expect(() =>
      io.read.nodeFactory({
        type: LINE_NODE_TYPE,
        data: {
          material: "material/ink",
          stroke: { width: 0 },
          start: [0, 0],
          end: [1, 1],
        },
      }),
    ).toThrow(/stroke\.width/);
  });

  it("refuses a line or polyline whose points the document does not carry", () => {
    const io = support();
    const stroke = { width: 1 };
    expect(() =>
      io.read.nodeFactory({
        type: LINE_NODE_TYPE,
        data: { material: "material/ink", stroke, end: [1, 1] },
      }),
    ).toThrow(/start/);
    expect(() =>
      io.read.nodeFactory({
        type: LINE_NODE_TYPE,
        data: {
          material: "material/ink",
          stroke,
          start: [0, 0],
          end: ["x", 1],
        },
      }),
    ).toThrow(/end/);
    expect(() =>
      io.read.nodeFactory({
        type: POLYLINE_NODE_TYPE,
        data: { material: "material/ink", stroke, points: [[0, 0]] },
      }),
    ).toThrow(/point chain/);
    expect(() =>
      io.read.nodeFactory({
        type: POLYLINE_NODE_TYPE,
        data: {
          material: "material/ink",
          stroke,
          points: [
            [0, 0],
            [1, "x"],
            [2, 2],
          ],
        },
      }),
    ).toThrow(/point chain/);
    expect(() =>
      io.read.nodeFactory({
        type: ARC_NODE_TYPE,
        data: { material: "material/ink", stroke, endAngle: 1 },
      }),
    ).toThrow(/startAngle/);
    expect(() =>
      io.read.nodeFactory({
        type: ARC_NODE_TYPE,
        data: { material: "material/ink", stroke, startAngle: 0 },
      }),
    ).toThrow(/endAngle/);
  });
});

describe("registerShapeSerializers — a §58 document that lies", () => {
  const read = (data: Record<string, unknown>): Circle =>
    paintedSupport().read.nodeFactory({
      type: CIRCLE_NODE_TYPE,
      data: { material: "material/painted", ...data },
    }) as Circle;

  it("refuses a document whose paint its material cannot draw", () => {
    // The `assertSpriteMaterial` precedent: a node whose material key resolves
    // to one it cannot draw through is refused by name rather than loaded in a
    // state where half its document is inert.
    expect(() =>
      support().read.nodeFactory({
        type: CIRCLE_NODE_TYPE,
        data: {
          material: "material/ink",
          fill: { kind: "solid", color: [1, 0, 0, 1], opacity: 1 },
        },
      }),
    ).toThrow(/vertexColors/);
  });

  it("drops a paint of a kind this build cannot draw, rather than the node", () => {
    // §58 lists seven paints and one ships. A gradient written by a later
    // build leaves a shape in its material's colour — visible and
    // recoverable — where refusing the node would lose the artwork.
    expect(read({ fill: { kind: "linear-gradient", stops: [] } }).fill).toBe(
      "inherit",
    );
    expect(read({ fill: [1, 0, 0, 1] }).fill).toBe("inherit");
    expect(read({ fill: "chartreuse" }).fill).toBe("inherit");
    expect(read({ fill: { kind: "solid" } }).fill).toBe("inherit");
    expect(read({ fill: { kind: "solid", color: [1, 0, 0] } }).fill).toBe(
      "inherit",
    );
    expect(read({ fill: { kind: "solid", color: [1, 0, "x", 1] } }).fill).toBe(
      "inherit",
    );
  });

  it("restores a paint's opacity default when the document's is unusable", () => {
    const shape = read({
      fill: { kind: "solid", color: [1, 0, 0, 1], opacity: 5 },
    });
    expect(shape.fill).toEqual({
      kind: "solid",
      color: [1, 0, 0, 1],
      opacity: 1,
    });
  });

  it("restores each stroke field's default when the document's is unusable", () => {
    const shape = read({
      stroke: {
        width: 2,
        alignment: "sideways",
        lineCap: 7,
        lineJoin: null,
        miterLimit: 0.5,
        dashOffset: "x",
        dash: [1, -1],
        paint: { kind: "pattern" },
      },
    });
    expect(shape.stroke).toEqual({
      width: 2,
      alignment: "center",
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 4,
      dashOffset: 0,
    });
  });

  it("drops a dash pattern that is empty, unusable or all zero", () => {
    for (const dash of [[], [1, "x"], [0, 0], "solid", [1, -2]]) {
      expect(read({ stroke: { width: 1, dash } }).stroke?.dash).toBeUndefined();
    }
    expect(read({ stroke: { width: 1, dash: [2, 1] } }).stroke?.dash).toEqual([
      2, 1,
    ]);
  });

  it("reads no stroke at all from a filled shape whose stroke is not a record", () => {
    expect(read({ stroke: "thick" }).stroke).toBeNull();
    expect(read({ stroke: [1, 2] }).stroke).toBeNull();
    expect(read({ stroke: null }).stroke).toBeNull();
  });

  it("keeps every §58 field alive through a corrupted-but-legal document", () => {
    const shape = read({
      stroke: {
        width: 3,
        alignment: "inside",
        lineCap: "round",
        lineJoin: "round",
        miterLimit: 2,
        dashOffset: 1.5,
      },
    });
    expect(shape.stroke).toEqual({
      width: 3,
      alignment: "inside",
      lineCap: "round",
      lineJoin: "round",
      miterLimit: 2,
      dashOffset: 1.5,
    });
  });
});
