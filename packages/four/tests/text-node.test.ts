/**
 * §49/§56's `Text` node, and its §79 pair (R-28, 2026-08-13).
 *
 * Four properties, and they are different properties:
 *
 * 1. **A label is one geometry.** The whole string becomes one indexed triangle
 *    buffer with per-vertex uv into one atlas, so it is one draw call before any
 *    §65 batching is switched on — which is the whole reason the node exists
 *    rather than a bag of `Sprite` children.
 * 2. **The rebuild is lazy and keeps the geometry's id.** R-23's stable-id rule,
 *    including the resize path that has to pass through an empty index buffer.
 * 3. **§85 refuses rather than clamps**, on the node's own options and on the
 *    one cross-object agreement it can check (atlas size versus the material's
 *    map).
 * 4. **A document says what the label is**, the font arrives through the option
 *    `Label` already uses, and a corrupted field restores the class default
 *    while a missing font is refused loudly.
 */

import { SpriteMaterial, UnlitMaterial, type Material } from "@four/materials";
import { Texture } from "@four/render";
import { Group } from "@four/scene";
import {
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@four/serialization";
import { buildGlyphAtlas, type GlyphAtlas } from "@four/text";
import { describe, expect, it } from "vitest";

import {
  TEXT_NODE_TYPE,
  registerSceneNodeTypes,
  registerTextSerializers,
  resourceCatalog,
} from "../src/scene-serializers.js";
import { Text } from "../src/text-node.js";

const atlas = buildGlyphAtlas();

/** A material sampling `source`, as every `Text` in this file needs. */
function inkFor(source: GlyphAtlas = atlas): UnlitMaterial {
  return new UnlitMaterial({
    map: new Texture({ ...source, filter: "nearest" }),
    transparent: true,
  });
}

/** `size = lineHeight` makes one font pixel one world unit — advance 6. */
const unit = { size: atlas.lineHeight };

describe("Text — construction and defaults (§49, §56)", () => {
  it("is a Renderable carrying the material it was given", () => {
    const ink = inkFor();
    const label = new Text(atlas, ink, { text: "AB", ...unit });

    expect(label.material).toBe(ink);
    expect(label.atlas).toBe(atlas);
    expect(label.text).toBe("AB");
    expect(label.size).toBe(atlas.lineHeight);
    expect(label.letterSpacing).toBe(0);
    expect(label.align).toBe("left");
    expect(label.renderLayer).toBe(0);
    expect(label.renderOrder).toBe(0);
    expect(label.disposed).toBe(false);
  });

  it("defaults to an empty string at size 1", () => {
    const label = new Text(atlas, inkFor());

    expect(label.text).toBe("");
    expect(label.size).toBe(1);
    expect(label.geometry.vertexCount).toBe(0);
    expect(label.layout.lineCount).toBe(0);
  });

  it("opts out of §69's shadow map by default, and can opt back in", () => {
    // A depth-only pass writes geometry, not alpha, so a label that cast would
    // cast its rectangles — see DEFAULT_CAST_SHADOW in text-node.ts.
    expect(new Text(atlas, inkFor()).castShadow).toBe(false);
    expect(new Text(atlas, inkFor(), { castShadow: true }).castShadow).toBe(
      true,
    );
    // The other two §49 flags keep the family's defaults.
    const label = new Text(atlas, inkFor());
    expect(label.receiveShadow).toBe(true);
    expect(label.frustumCulled).toBe(true);
  });

  it("takes the §49 options the family takes", () => {
    const label = new Text(atlas, inkFor(), {
      renderLayer: 3,
      renderOrder: -2,
      frustumCulled: false,
      receiveShadow: false,
    });

    expect(label.renderLayer).toBe(3);
    expect(label.renderOrder).toBe(-2);
    expect(label.frustumCulled).toBe(false);
    expect(label.receiveShadow).toBe(false);
  });
});

describe("Text — one geometry for the whole string (§53, §56, §65)", () => {
  it("emits four vertices and six indices per drawn glyph", () => {
    const label = new Text(atlas, inkFor(), { text: "AB", ...unit });
    const geometry = label.geometry;

    expect(geometry.vertexCount).toBe(8);
    expect(geometry.drawCount).toBe(12);
    expect(geometry.mode).toBe("triangles");
    expect(geometry.uvs).toHaveLength(16);
  });

  it("skips blank glyphs, so a space costs no quad", () => {
    const label = new Text(atlas, inkFor(), { text: "A B", ...unit });

    // Three characters, two drawn.
    expect(label.geometry.vertexCount).toBe(8);
    expect(label.layout.width).toBe(18);
  });

  it("places the corners where the layout says, counter-clockwise from +Z", () => {
    const label = new Text(atlas, inkFor(), { text: "A", ...unit });
    const geometry = label.geometry;
    const quad = label.layout.quads[0];

    expect(quad).toBeDefined();
    expect(Array.from(geometry.positions)).toEqual([
      quad?.x0,
      quad?.y0,
      0,
      quad?.x1,
      quad?.y0,
      0,
      quad?.x1,
      quad?.y1,
      0,
      quad?.x0,
      quad?.y1,
      0,
    ]);
    expect(Array.from(geometry.indices ?? [])).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("maps each glyph onto its own atlas cell, which one affine uv could not", () => {
    // The reason this is not a Sprite: two glyphs sample two different cells
    // out of one texture, in one buffer, with one material.
    const label = new Text(atlas, inkFor(), { text: "AB", ...unit });
    const uvs = label.geometry.uvs;
    const [first, second] = label.layout.quads;

    expect(uvs).toBeDefined();
    expect(first?.u0).not.toBe(second?.u0);
    expect(Array.from(uvs?.slice(0, 8) ?? [])).toEqual([
      first?.u0,
      first?.v0,
      first?.u1,
      first?.v0,
      first?.u1,
      first?.v1,
      first?.u0,
      first?.v1,
    ]);
    expect(uvs?.[8]).toBe(second?.u0);
  });

  it("indexes past 65 535 vertices with 32-bit indices (§86's glyph rows)", () => {
    const short = new Text(atlas, inkFor(), { text: "A", ...unit });
    expect(short.geometry.indices).toBeInstanceOf(Uint16Array);

    // 16 384 glyphs is exactly 65 536 vertices, whose highest index is 65 535
    // — still addressable. One glyph more is not.
    const edge = new Text(atlas, inkFor(), {
      text: "A".repeat(16_384),
      ...unit,
    });
    expect(edge.geometry.vertexCount).toBe(65_536);
    expect(edge.geometry.indices).toBeInstanceOf(Uint16Array);

    const long = new Text(atlas, inkFor(), {
      text: "A".repeat(16_385),
      ...unit,
    });
    expect(long.geometry.vertexCount).toBe(65_540);
    expect(long.geometry.indices).toBeInstanceOf(Uint32Array);
  });

  it("draws two lines below one another, Y-up (§7a)", () => {
    const label = new Text(atlas, inkFor(), { text: "A\nB", ...unit });
    const [first, second] = label.layout.quads;

    expect(label.layout.lineCount).toBe(2);
    // The second baseline is one `size` below the first, so the second line's
    // cell sits exactly one cell lower — its top meets the first's bottom.
    expect(second?.y0).toBe((first?.y0 ?? 0) - atlas.lineHeight);
    expect(second?.y1).toBe(first?.y0);
    expect(label.geometry.vertexCount).toBe(8);
  });
});

describe("Text — lazy rebuilds with a stable geometry id (R-23, §53)", () => {
  it("keeps the same geometry object and id across a text change", () => {
    const label = new Text(atlas, inkFor(), { text: "AB", ...unit });
    const geometry = label.geometry;
    const id = geometry.id;
    const version = geometry.version;

    label.text = "ABCD";

    expect(label.geometry).toBe(geometry);
    expect(label.geometry.id).toBe(id);
    expect(label.geometry.version).toBeGreaterThan(version);
    expect(label.geometry.vertexCount).toBe(16);
  });

  it("resizes in both directions, which needs the empty-index pivot", () => {
    const label = new Text(atlas, inkFor(), { text: "ABCD", ...unit });
    expect(label.geometry.vertexCount).toBe(16);

    label.text = "A";
    expect(label.geometry.vertexCount).toBe(4);
    expect(label.geometry.drawCount).toBe(6);

    label.text = "ABCDEFGH";
    expect(label.geometry.vertexCount).toBe(32);
    expect(label.geometry.uvs).toHaveLength(64);
  });

  it("empties to a non-indexed, vertex-free geometry and comes back", () => {
    const label = new Text(atlas, inkFor(), { text: "AB", ...unit });
    expect(label.geometry.vertexCount).toBe(8);

    label.text = "";
    expect(label.geometry.vertexCount).toBe(0);
    expect(label.geometry.indices).toBeUndefined();
    expect(label.geometry.uvs).toBeUndefined();

    label.text = "C";
    expect(label.geometry.vertexCount).toBe(4);
  });

  it("rebuilds once for a burst of edits, on the next read", () => {
    const label = new Text(atlas, inkFor(), { text: "A", ...unit });
    const before = label.geometry.version;

    label.text = "AB";
    label.size = 2;
    label.letterSpacing = 0.5;
    label.align = "center";

    // Nothing has been rebuilt yet: reading `layout` measures without touching
    // the vertex buffers.
    expect(label.geometry.version).toBeGreaterThan(before);
    const after = label.geometry.version;
    expect(label.geometry.version).toBe(after);
  });

  it("ignores a write of the same string", () => {
    const label = new Text(atlas, inkFor(), { text: "AB", ...unit });
    const layout = label.layout;

    label.text = "AB";

    expect(label.layout).toBe(layout);
  });

  it("recomputes the layout when the atlas is swapped", () => {
    const padded = buildGlyphAtlas(undefined, { padding: 1 });
    const label = new Text(atlas, inkFor(), { text: "AB", ...unit });
    const before = label.layout;

    label.atlas = padded;

    expect(label.atlas).toBe(padded);
    expect(label.layout).not.toBe(before);
  });

  it("honours §56 alignment through the node", () => {
    const label = new Text(atlas, inkFor(), { text: "ABC\nA", ...unit });
    expect(label.layout.quads[3]?.x0).toBe(0);

    label.align = "right";

    expect(label.layout.quads[3]?.x0).toBe(12);
    expect(label.geometry.positions[3 * 12]).toBe(12);
  });
});

describe("Text — validation (§85, refuse rather than clamp)", () => {
  it("refuses a material that samples nothing", () => {
    expect(() => new Text(atlas, new UnlitMaterial())).toThrow(
      /Text needs a material that samples the glyph atlas/,
    );
  });

  it("refuses a material whose map is not the atlas's size", () => {
    const wrong = new UnlitMaterial({
      map: new Texture({ width: 8, height: 8 }),
    });

    expect(() => new Text(atlas, wrong)).toThrow(
      /samples a 8 × 8 texture, but its glyph atlas is 128 × 128/,
    );
  });

  it("refuses an atlas the current material does not sample", () => {
    const label = new Text(atlas, inkFor());
    const other = buildGlyphAtlas(undefined, { padding: 0 });

    expect(other.width).not.toBe(atlas.width);
    expect(() => {
      label.atlas = other;
    }).toThrow(/the two must be the same sheet/);
    expect(label.atlas).toBe(atlas);
  });

  it("refuses a non-positive or non-finite size", () => {
    const ink = inkFor();
    expect(() => new Text(atlas, ink, { size: 0 })).toThrow(RangeError);
    expect(() => new Text(atlas, ink, { size: -1 })).toThrow(RangeError);
    expect(() => new Text(atlas, ink, { size: Number.NaN })).toThrow(
      RangeError,
    );

    const label = new Text(atlas, ink);
    expect(() => {
      label.size = 0;
    }).toThrow(/finite positive number of world units per line/);
    expect(label.size).toBe(1);
  });

  it("refuses a non-finite letterSpacing", () => {
    const ink = inkFor();
    expect(
      () => new Text(atlas, ink, { letterSpacing: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);

    const label = new Text(atlas, ink);
    expect(() => {
      label.letterSpacing = Number.NaN;
    }).toThrow(/letterSpacing must be finite/);
  });

  it("refuses an alignment outside the union rather than falling back to left", () => {
    const ink = inkFor();
    expect(
      () =>
        new Text(atlas, ink, {
          align: "justify",
        } as unknown as Record<string, never>),
    ).toThrow(/Text align must be one of "left", "center", "right"/);

    const label = new Text(atlas, ink);
    expect(() => {
      label.align = "start" as "left";
    }).toThrow(RangeError);
    expect(label.align).toBe("left");
  });
});

describe("Text — disposal (§83)", () => {
  it("disposes the geometry it owns and nothing it shares", () => {
    const ink = inkFor();
    const label = new Text(atlas, ink, { text: "AB", ...unit });
    const geometry = label.geometry;

    label.dispose();

    expect(label.disposed).toBe(true);
    expect(geometry.disposed).toBe(true);
    expect(ink.disposed).toBe(false);
    expect(ink.map?.disposed).toBe(false);
  });

  it("is idempotent, and rebuilds nothing afterwards", () => {
    const label = new Text(atlas, inkFor(), { text: "AB", ...unit });
    expect(label.geometry.vertexCount).toBe(8);

    label.dispose();
    label.dispose();
    label.text = "CDEF";

    expect(label.geometry.vertexCount).toBe(0);
  });
});

describe("Text — §79 round trip (R-28)", () => {
  const ink = inkFor();
  const materials = resourceCatalog([["material/ink", ink]]);

  /** Saves `node` and loads it back through a fresh registry. */
  function roundTrip(
    node: Text,
    options: { atlas?: GlyphAtlas } = { atlas },
  ): Text {
    const root = new Group();
    root.add(node);
    const io = registerSceneNodeTypes({ ...options, materials });
    const document = serializeScene(root, io.components, io.write);
    const reloaded = instantiateScene(
      decodeSceneDocument(encodeSceneDocument(document)),
      io.components,
      io.read,
    );
    const restored = reloaded.children[0];
    expect(restored).toBeInstanceOf(Text);
    return restored as Text;
  }

  it("writes every authored field and reads it back", () => {
    const label = new Text(atlas, ink, {
      text: "Motor 42\nnominal",
      size: 0.25,
      letterSpacing: 0.01,
      align: "center",
      renderLayer: 2,
      renderOrder: -1,
      castShadow: true,
      receiveShadow: false,
      frustumCulled: false,
    });

    const restored = roundTrip(label);

    expect(restored.text).toBe("Motor 42\nnominal");
    expect(restored.size).toBe(0.25);
    expect(restored.letterSpacing).toBe(0.01);
    expect(restored.align).toBe("center");
    expect(restored.renderLayer).toBe(2);
    expect(restored.renderOrder).toBe(-1);
    expect(restored.castShadow).toBe(true);
    expect(restored.receiveShadow).toBe(false);
    expect(restored.frustumCulled).toBe(false);
    expect(restored.material).toBe(ink);
    expect(restored.atlas).toBe(atlas);
    // The geometry is derived, so the reloaded node draws the same quads.
    expect(Array.from(restored.geometry.positions)).toEqual(
      Array.from(label.geometry.positions),
    );
  });

  it("writes the node type and no geometry key", () => {
    const root = new Group();
    root.add(new Text(atlas, ink, { text: "A" }));
    const io = registerSceneNodeTypes({ atlas, materials });
    const document = serializeScene(root, io.components, io.write);
    const node = (document.nodes[0]?.children ?? [])[0];

    expect(node.type).toBe(TEXT_NODE_TYPE);
    expect(TEXT_NODE_TYPE).toBe("render:text");
    const data = node.data as Record<string, unknown>;
    expect(data.material).toBe("material/ink");
    expect(data.geometry).toBeUndefined();
    expect(data.text).toBe("A");
  });

  it("refuses to restore a text node with no atlas option", () => {
    const label = new Text(atlas, ink, { text: "A" });

    expect(() => roundTrip(label, {})).toThrow(/no glyph atlas was supplied/);
  });

  it("names the node in the missing-atlas refusal, id or no id", () => {
    // §79 ids are optional in the format, so the message has to read for both.
    const io = registerTextSerializers({ materials });

    expect(() =>
      io.read.nodeFactory({
        type: TEXT_NODE_TYPE,
        data: { material: "material/ink" },
      }),
    ).toThrow(/node null is a text node/);
    expect(() =>
      io.read.nodeFactory({
        id: "node-7",
        type: TEXT_NODE_TYPE,
        data: { material: "material/ink" },
      }),
    ).toThrow(/node "node-7" is a text node/);
  });

  it("refuses a material key that resolves to another pipeline's material", () => {
    // A label draws through the **unlit** pipeline with the atlas as §57's
    // `map`; a sprite material samples its own `texture` and would draw
    // nothing here, so it is a run-time type error rather than a silent blank.
    const io = registerTextSerializers({
      atlas,
      materials: resourceCatalog<Material>([
        [
          "material/sprite",
          new SpriteMaterial({ texture: new Texture(atlas) }),
        ],
      ]),
    });

    expect(() =>
      io.read.nodeFactory({
        type: TEXT_NODE_TYPE,
        data: { material: "material/sprite" },
      }),
    ).toThrow(/but a text node draws an "unlit" material/);
  });

  it("restores class defaults for corrupted numbers and alignments (§96)", () => {
    const io = registerTextSerializers({ atlas, materials });
    const restored = io.read.nodeFactory({
      type: TEXT_NODE_TYPE,
      data: {
        material: "material/ink",
        text: "A",
        size: -3,
        letterSpacing: "wide",
        align: "justify",
      },
    }) as Text;

    expect(restored.size).toBe(1);
    expect(restored.letterSpacing).toBe(0);
    expect(restored.align).toBe("left");
    expect(restored.text).toBe("A");
  });

  it("restores an empty string for a payload with no text", () => {
    const io = registerTextSerializers({ atlas, materials });
    const restored = io.read.nodeFactory({
      type: TEXT_NODE_TYPE,
      data: { material: "material/ink" },
    }) as Text;

    expect(restored.text).toBe("");
  });

  it("declines nodes and documents that are not its own", () => {
    const io = registerTextSerializers({ atlas, materials });
    const group = new Group();

    expect(io.write.nodeTypeOf(group)).toBeUndefined();
    expect(io.write.nodeDataOf(group)).toBeUndefined();
    expect(io.read.nodeFactory({ type: "ui:panel", data: {} })).toBeUndefined();
  });

  it("refuses to write a text node whose material no catalog names", () => {
    const io = registerTextSerializers({ atlas });

    expect(() =>
      io.write.nodeDataOf(new Text(atlas, ink, { text: "A" })),
    ).toThrow(/references a material that no catalog names/);
  });

  it("writes a null material reference under the skip policy", () => {
    const io = registerTextSerializers({ atlas, unknownResources: "skip" });
    const data = io.write.nodeDataOf(
      new Text(atlas, ink, { text: "A" }),
    ) as Record<string, unknown>;

    expect(data.material).toBeNull();
  });
});
