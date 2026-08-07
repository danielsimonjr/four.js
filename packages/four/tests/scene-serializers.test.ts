/**
 * §79 round trips of the engine's own node classes and components (A-14,
 * PH-17 — 2026-08-06).
 *
 * The gate: build a widget tree with a laid-out box model, layout configuration,
 * §75 accessibility, and a `MotionComponent`; save it; push it through JSON
 * *text*; reload it — and get the same **classes** back with the same state,
 * not a tree of bare `Group`s. Before this module a widget tree round-tripped
 * as `Node` state only, contradicting §73's "UI objects are scene nodes and
 * therefore share … serialization", and a `MotionComponent` was dropped
 * silently.
 */

import { isFourError } from "@four/core";
import { MotionComponent } from "@four/motion";
import { Vector3 } from "@four/math";
import { Collider, RigidBody } from "@four/physics";
import { Group, Scene } from "@four/scene";
import {
  ComponentSerializerRegistry,
  createDefaultComponentSerializers,
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  serializeScene,
} from "@four/serialization";
import { buildGlyphAtlas } from "@four/text";
import { Button, Label, Panel } from "@four/ui";
import { describe, expect, it } from "vitest";

import {
  BUTTON_NODE_TYPE,
  LABEL_NODE_TYPE,
  PANEL_NODE_TYPE,
  registerPhysicsSerializers,
  registerSceneNodeTypes,
  registerUISerializers,
} from "../src/scene-serializers.js";

const atlas = buildGlyphAtlas();

/** A HUD with one label and one button holding its own label. */
function buildTree(): Panel {
  const root = new Panel({
    name: "hud",
    width: 320,
    height: 200,
    minWidth: 100,
    maxHeight: 400,
    padding: 8,
    margin: { top: 1, right: 2, bottom: 3, left: 4 },
    layout: {
      type: "flex",
      direction: "column",
      gap: 6,
      justify: "space-between",
      align: "stretch",
    },
  });

  const caption = new Label({
    name: "caption",
    text: "Score: 0",
    atlas,
    size: 16,
    letterSpacing: 0.5,
    grow: 1,
  });

  const start = new Button({
    name: "start",
    width: 160,
    height: 40,
    focusable: true,
    disabled: true,
    accessibility: {
      role: "button",
      label: "Start simulation",
      description: "Begins the run",
      tabIndex: 3,
    },
  });
  start.anchor.set(0.5, 0.25);
  start.pivot.set(1, 0);
  start.offset.set(12, -4);
  start.add(new Label({ name: "start-text", text: "Start", atlas, size: 12 }));

  root.add(caption, start);
  return root;
}

describe("registerSceneNodeTypes — §73 widgets survive §79", () => {
  it("round-trips classes, box model, layout, and accessibility through text", () => {
    const root = buildTree();
    root.layout();
    const io = registerSceneNodeTypes({ atlas });

    const document = serializeScene(root, io.components, io.write);
    const reloaded = instantiateScene(
      decodeSceneDocument(encodeSceneDocument(document)),
      io.components,
      io.read,
    );

    expect(reloaded).toBeInstanceOf(Panel);
    const panel = reloaded as Panel;
    expect(panel.name).toBe("hud");
    expect(panel.width).toBe(320);
    expect(panel.height).toBe(200);
    expect(panel.minWidth).toBe(100);
    expect(panel.maxHeight).toBe(400);
    expect(panel.padding.top).toBe(8);
    expect({
      top: panel.margin.top,
      right: panel.margin.right,
      bottom: panel.margin.bottom,
      left: panel.margin.left,
    }).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(panel.layoutType).toBe("flex");
    expect(panel.direction).toBe("column");
    expect(panel.gap).toBe(6);
    expect(panel.justify).toBe("space-between");
    expect(panel.align).toBe("stretch");

    const [caption, start] = panel.children;
    expect(caption).toBeInstanceOf(Label);
    expect((caption as Label).text).toBe("Score: 0");
    expect((caption as Label).size).toBe(16);
    expect((caption as Label).letterSpacing).toBe(0.5);
    expect((caption as Label).grow).toBe(1);
    expect((caption as Label).atlas).toBe(atlas);

    expect(start).toBeInstanceOf(Button);
    const button = start as Button;
    expect(button.width).toBe(160);
    expect(button.focusable).toBe(true);
    expect(button.disabled).toBe(true);
    expect(button.accessibility).toEqual({
      role: "button",
      label: "Start simulation",
      description: "Begins the run",
      tabIndex: 3,
    });
    expect(button.anchor.x).toBe(0.5);
    expect(button.anchor.y).toBe(0.25);
    expect(button.pivot.x).toBe(1);
    expect(button.offset.x).toBe(12);
    expect(button.offset.y).toBe(-4);
    expect(button.children[0]).toBeInstanceOf(Label);
    expect((button.children[0] as Label).text).toBe("Start");
  });

  it("is textually idempotent — the P11-1 round-trip gate", () => {
    const root = buildTree();
    root.layout();
    const io = registerSceneNodeTypes({ atlas });

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
  });

  it("keeps every node's saved id (§79)", () => {
    const root = buildTree();
    const io = registerSceneNodeTypes({ atlas });
    const ids: string[] = [];
    root.traverse((node) => ids.push(node.id));

    const reloaded = instantiateScene(
      serializeScene(root, io.components, io.write),
      io.components,
      io.read,
    );

    const restored: string[] = [];
    reloaded.traverse((node) => restored.push(node.id));
    expect(restored).toEqual(ids);
    // …and the counter knows about them, so the next node cannot collide.
    expect(ids).not.toContain(new Group().id);
  });

  it("names each widget class with its own document type", () => {
    const io = registerUISerializers();
    expect(io.write.nodeTypeOf(new Panel())).toBe(PANEL_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Label())).toBe(LABEL_NODE_TYPE);
    expect(io.write.nodeTypeOf(new Button())).toBe(BUTTON_NODE_TYPE);
    // Exact class identity: a `Scene` is not this pair's business, and neither
    // is an application's own widget subclass.
    expect(io.write.nodeTypeOf(new Scene())).toBeUndefined();
    expect(
      io.write.nodeTypeOf(new (class extends Button {})()),
    ).toBeUndefined();
    expect(io.write.nodeDataOf(new Group())).toBeUndefined();
    expect(io.read.nodeFactory({ type: "group" })).toBeUndefined();
  });

  it("restores labels with no atlas when none is supplied", () => {
    const root = new Label({ text: "hello", atlas, size: 10 });
    const io = registerSceneNodeTypes();

    const reloaded = instantiateScene(
      serializeScene(root, io.components, io.write),
      io.components,
      io.read,
    ) as Label;

    expect(reloaded.text).toBe("hello");
    expect(reloaded.size).toBe(10);
    // A font is a loaded resource, not scene state (§79) — so this is `null`
    // and the label measures nothing, which is exactly what it says it is.
    expect(reloaded.atlas).toBeNull();
    expect(reloaded.textLayout).toBeNull();
  });

  it("carries an infinite max size across JSON, which cannot hold Infinity", () => {
    const io = registerSceneNodeTypes();
    const panel = new Panel({ minWidth: 10 });

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(panel, io.components, io.write)),
      ),
      io.components,
      io.read,
    ) as Panel;

    expect(reloaded.maxWidth).toBe(Infinity);
    expect(reloaded.maxHeight).toBe(Infinity);
    expect(reloaded.minWidth).toBe(10);
  });

  it("restores an intrinsic (null) width rather than zero", () => {
    const io = registerSceneNodeTypes();
    const reloaded = instantiateScene(
      serializeScene(new Panel(), io.components, io.write),
      io.components,
      io.read,
    ) as Panel;

    expect(reloaded.width).toBeNull();
    expect(reloaded.height).toBeNull();
  });

  it("tolerates a payload from a build that wrote less", () => {
    const io = registerSceneNodeTypes({ atlas });
    const reloaded = io.read.nodeFactory({
      type: BUTTON_NODE_TYPE,
      id: "node-partial",
      data: { width: 40 },
    }) as Button;

    expect(reloaded).toBeInstanceOf(Button);
    expect(reloaded.id).toBe("node-partial");
    expect(reloaded.width).toBe(40);
    expect(reloaded.layoutType).toBe("absolute");
    expect(reloaded.accessibility).toBeNull();
  });
});

describe("registerSceneNodeTypes — components (PH-17)", () => {
  it("round-trips a MotionComponent that used to be dropped silently", () => {
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(
      new MotionComponent({
        linearVelocity: new Vector3(1, 2, 3),
        damping: 0.5,
        maxSpeed: 9,
      }),
    );

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const motion = reloaded.getComponent(MotionComponent);
    expect(motion).toBeInstanceOf(MotionComponent);
    expect(motion?.linearVelocity.equalsApprox(new Vector3(1, 2, 3), 0)).toBe(
      true,
    );
    expect(motion?.damping).toBe(0.5);
    expect(motion?.maxSpeed).toBe(9);
    expect(motion?.host).toBe(reloaded);
  });

  it("refuses to save a component it has no serializer for (A-15)", () => {
    class Health {
      static readonly typeName = "com.example.health";
      host: unknown = null;
    }
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(new Health() as never);

    let thrown: unknown;
    try {
      serializeScene(root, io.components, io.write);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );

    // …and dropping it is a deliberate opt-in, not the default.
    expect(() =>
      serializeScene(root, io.components, {
        ...io.write,
        unknownComponents: "skip",
      }),
    ).not.toThrow();
  });

  it("round-trips a RigidBody and a Collider through one call (PH-17)", () => {
    // The physics half of PH-17, closed 2026-08-06: `@four/physics` owns the
    // serializers and this package performs the registration neither it nor
    // `@four/serialization` may perform alone. Before this, a scene carrying
    // physics components needed `{ unknownComponents: "skip" }` to save at all.
    const io = registerSceneNodeTypes();
    const root = new Group();
    root.addComponent(
      new RigidBody({
        type: "dynamic",
        mass: 3,
        linearVelocity: new Vector3(0, -2, 0),
        linearDamping: 0.2,
      }),
    );
    root.addComponent(
      new Collider({
        shape: { type: "sphere", radius: 0.5 },
        restitution: 0.4,
        sensor: true,
      }),
    );

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    const body = reloaded.getComponent(RigidBody);
    expect(body).toBeInstanceOf(RigidBody);
    expect(body?.type).toBe("dynamic");
    expect(body?.mass).toBe(3);
    expect(body?.linearDamping).toBe(0.2);
    expect(body?.linearVelocity.equalsApprox(new Vector3(0, -2, 0), 0)).toBe(
      true,
    );

    const collider = reloaded.getComponent(Collider);
    expect(collider).toBeInstanceOf(Collider);
    expect(collider?.shape).toEqual({ type: "sphere", radius: 0.5 });
    expect(collider?.restitution).toBe(0.4);
    expect(collider?.sensor).toBe(true);
    // The §24 association is rebuilt by the hierarchy, not by the document.
    expect(collider?.body).toBe(body);
  });

  it("hands out a fresh registry per call", () => {
    const first = registerSceneNodeTypes().components;
    const second = registerSceneNodeTypes().components;

    expect(first).not.toBe(second);
    expect(first.has(MotionComponent.typeName)).toBe(true);
    expect(second.has(MotionComponent.typeName)).toBe(true);
    expect(first.has(RigidBody.typeName)).toBe(true);
    expect(first.has(Collider.typeName)).toBe(true);
  });
});

describe("registerPhysicsSerializers (PH-17)", () => {
  it("registers both components without pulling in the UI node types", () => {
    const components = registerPhysicsSerializers(
      createDefaultComponentSerializers(),
    );

    expect(components.has(RigidBody.typeName)).toBe(true);
    expect(components.has(Collider.typeName)).toBe(true);
    // The registry it was handed, returned for chaining — not a copy.
    expect(
      registerPhysicsSerializers(new ComponentSerializerRegistry()).size,
    ).toBe(2);
  });

  it("refuses to register twice on one registry, rather than overwriting", () => {
    const components = registerPhysicsSerializers(
      createDefaultComponentSerializers(),
    );

    let thrown: unknown;
    try {
      registerPhysicsSerializers(components);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) && thrown.code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });
});

/**
 * The tolerant read paths: a `data` payload from a build that wrote less, wrote
 * more, or wrote nonsense must restore a usable widget rather than throw. §79's
 * extensibility goal is better served by a default than by refusing the scene.
 */
describe("registerUISerializers — defensive reads", () => {
  const io = registerUISerializers();

  it("defaults every inset component the payload omits", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: { padding: { left: 4 }, margin: "nonsense" },
    }) as Panel;

    expect({
      top: panel.padding.top,
      right: panel.padding.right,
      bottom: panel.padding.bottom,
      left: panel.padding.left,
    }).toEqual({ top: 0, right: 0, bottom: 0, left: 4 });
    expect(panel.margin.left).toBe(0);
  });

  it("ignores an anchor, pivot, or offset that is not a number pair", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: { anchor: [1], pivot: ["a", "b"], offset: { x: 1, y: 2 } },
    }) as Panel;

    expect([panel.anchor.x, panel.anchor.y]).toEqual([0, 0]);
    expect([panel.pivot.x, panel.pivot.y]).toEqual([0, 0]);
    expect([panel.offset.x, panel.offset.y]).toEqual([0, 0]);
  });

  it("keeps the class defaults for a layout record it cannot read", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: {
        layout: {
          type: "diagonal",
          direction: "sideways",
          justify: "everywhere",
          align: "nowhere",
        },
      },
    }) as Panel;

    expect(panel.layoutType).toBe("absolute");
    expect(panel.direction).toBe("row");
    expect(panel.justify).toBe("start");
    expect(panel.align).toBe("start");
  });

  it("reads every valid layout value", () => {
    for (const [type, direction, justify, align] of [
      ["stack", "row", "center", "center"],
      ["flex", "column", "end", "end"],
      ["absolute", "row", "space-between", "stretch"],
    ] as const) {
      const panel = io.read.nodeFactory({
        type: PANEL_NODE_TYPE,
        data: { layout: { type, direction, justify, align } },
      }) as Panel;

      expect([
        panel.layoutType,
        panel.direction,
        panel.justify,
        panel.align,
      ]).toEqual([type, direction, justify, align]);
    }
  });

  it("refuses a label size the class would reject, keeping the default", () => {
    const label = io.read.nodeFactory({
      type: LABEL_NODE_TYPE,
      data: { size: 0, letterSpacing: "wide", text: 7 },
    }) as Label;

    expect(label.size).toBe(1);
    expect(label.letterSpacing).toBe(0);
    expect(label.text).toBe("");
  });

  it("reads an accessibility record with only some fields set", () => {
    const button = io.read.nodeFactory({
      type: BUTTON_NODE_TYPE,
      data: { accessibility: { label: "Go" } },
    }) as Button;

    expect(button.accessibility).toEqual({ label: "Go" });
  });

  it("writes only the accessibility fields that are set", () => {
    const button = new Button({ accessibility: { role: "button" } });

    expect(io.write.nodeDataOf(button)).toMatchObject({
      accessibility: { role: "button" },
    });
  });

  it("treats a non-object data payload as empty", () => {
    const panel = io.read.nodeFactory({
      type: PANEL_NODE_TYPE,
      data: ["not", "a", "record"],
    }) as Panel;

    expect(panel).toBeInstanceOf(Panel);
    expect(panel.width).toBeNull();
  });
});
