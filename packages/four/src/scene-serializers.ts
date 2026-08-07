/**
 * §79 node types and component serializers for the classes the engine itself
 * ships (A-14, PH-17 — 2026-08-06).
 *
 * §73 promises that "UI objects are scene nodes and therefore share animation,
 * input, clipping, serialization, and diagnostics", and §6a promises that
 * components "serialize under registered type names (§79)". Neither held.
 * `@four/serialization` may depend on `core`, `math`, and `scene` only (plan
 * §3.1), so its registry ships one component serializer (`PoseTarget`) and its
 * instantiator knows two node classes (`Scene`, `Group`) — every widget tree
 * round-tripped as bare `Node` state, and every `MotionComponent` was dropped
 * from the document with nobody able to notice.
 *
 * This module is where that is fixed, because **the umbrella package is the one
 * place allowed to see everything**. It adds no dependency edge anywhere: it
 * imports `@four/ui` and `@four/motion` the way an application would, and hands
 * `@four/serialization` the two things its documented seams ask for — a
 * `nodeTypeOf` / `nodeFactory` pair and a populated component registry.
 *
 * ```ts
 * import { registerSceneNodeTypes } from "four";
 *
 * const io = registerSceneNodeTypes({ atlas });
 * const text = serialization.encodeSceneDocument(
 *   serialization.serializeScene(app.scene, io.components, io.write),
 * );
 * // … later
 * const scene = serialization.instantiateScene(
 *   serialization.decodeSceneDocument(text),
 *   io.components,
 *   io.read,
 * );
 * ```
 *
 * ## What is covered, and what is deliberately not
 *
 * Covered: the nine §73 widgets — `Panel`, `Label`, `Button`, and, since
 * 2026-08-07 (A-12), `Toggle`, `Checkbox`, `RadioButton`, `Slider`,
 * `ProgressIndicator`, and `ImageWidget` — with their §74 box model and layout,
 * their interaction flags, their §75 accessibility record, and whatever state
 * each control adds (checkedness, a group name, a range and its value, an image
 * key); `MotionComponent` (§11) and `KinematicController` (§12, added
 * 2026-08-07), through the serializers `@four/motion` itself exports; and
 * `RigidBody` and `Collider` (§23–§25), through the pair `@four/physics`
 * exports (`RIGID_BODY_SERIALIZER` / `COLLIDER_SERIALIZER`, 2026-08-06 — the
 * `PH-17` remainder). All three packages declare their serializers against the
 * same structural `ComponentSerializer` shape, so registering them here adds no
 * §3.1 edge anywhere.
 *
 * That is **every** component class the engine ships — the five with a
 * `static typeName`, counting `PoseTarget`, which `@four/serialization` seeds
 * itself. `tests/scene-serializers.test.ts` enumerates them off the umbrella's
 * own barrels and fails if one is missing, because an unregistered component
 * makes `serializeScene` throw (A-15) and the only sign of a new one being
 * forgotten would be an application that cannot save its scene.
 *
 * A scene carrying physics components therefore saves and reloads through this
 * one call, with no `{ unknownComponents: "skip" }` opt-out and nothing dropped
 * — see {@link registerPhysicsSerializers} for what a physics document does and
 * does not carry.
 *
 * Camera, light, sprite and renderable node types are still absent (A-16):
 * the seam they need is the same one used below, so they are additions to this
 * file rather than to any format.
 *
 * ## Why a `Label`'s atlas is an option and not a payload
 *
 * A `GlyphAtlas` is a loaded resource, not scene state — §79 references
 * resources by logical key and stores none of them inline. So a label writes
 * its text, size, and letter spacing, and {@link SceneNodeTypeOptions.atlas}
 * supplies the face on the way back in. A document restored without one holds
 * labels that measure `0 × 0`, which is exactly what a `Label` with no atlas
 * is — not an error, and visible the moment anything lays it out.
 */

import type { JsonValue } from "@four/core";
import {
  KINEMATIC_CONTROLLER_SERIALIZER,
  KinematicController,
  MOTION_COMPONENT_SERIALIZER,
  MotionComponent,
} from "@four/motion";
import {
  COLLIDER_SERIALIZER,
  Collider,
  RIGID_BODY_SERIALIZER,
  RigidBody,
} from "@four/physics";
import { restoreNodeId, type Node } from "@four/scene";
import {
  ComponentSerializerRegistry,
  createDefaultComponentSerializers,
  type InstantiateSceneOptions,
  type SceneNodeDocument,
  type SerializeSceneOptions,
} from "@four/serialization";
import type { GlyphAtlas } from "@four/text";
import {
  Button,
  Checkbox,
  ImageWidget,
  Label,
  Panel,
  ProgressIndicator,
  RadioButton,
  Slider,
  Toggle,
  UIWidget,
  type CheckableWidget,
  type UIWidgetOptions,
  type WidgetAccessibility,
} from "@four/ui";

/** The document `type` a {@link Panel} serializes as. */
export const PANEL_NODE_TYPE = "ui:panel";

/** The document `type` a {@link Label} serializes as. */
export const LABEL_NODE_TYPE = "ui:label";

/** The document `type` a {@link Button} serializes as. */
export const BUTTON_NODE_TYPE = "ui:button";

/** The document `type` a {@link Toggle} serializes as (2026-08-07, A-12). */
export const TOGGLE_NODE_TYPE = "ui:toggle";

/** The document `type` a {@link Checkbox} serializes as. */
export const CHECKBOX_NODE_TYPE = "ui:checkbox";

/** The document `type` a {@link RadioButton} serializes as. */
export const RADIO_BUTTON_NODE_TYPE = "ui:radio";

/** The document `type` a {@link Slider} serializes as. */
export const SLIDER_NODE_TYPE = "ui:slider";

/** The document `type` a {@link ProgressIndicator} serializes as. */
export const PROGRESS_NODE_TYPE = "ui:progress";

/**
 * The document `type` an {@link ImageWidget} serializes as.
 *
 * `ui:image` — §73's own name for the control. The class carries a `Widget`
 * suffix only because `Image` is a browser global; the document format has no
 * such collision to avoid.
 */
export const IMAGE_NODE_TYPE = "ui:image";

/** Options for {@link registerUISerializers} and {@link registerSceneNodeTypes}. */
export interface SceneNodeTypeOptions {
  /**
   * The glyph atlas restored {@link Label}s are given (§56, §79).
   *
   * Omit it and labels reload with no atlas, measuring `0 × 0` — see the module
   * header for why the face is not part of the document.
   */
  readonly atlas?: GlyphAtlas;
}

/**
 * A `nodeTypeOf` / `nodeDataOf` writer paired with the `nodeFactory` that reads
 * it back (§79).
 *
 * The two halves are returned together because they are one decision: a type
 * name written by a build whose reader does not know it is a load failure, and
 * splitting them across two call sites is how that happens.
 */
export interface SceneNodeTypeSupport {
  /** Pass to `serializeScene` as its options. */
  readonly write: Required<
    Pick<SerializeSceneOptions, "nodeTypeOf" | "nodeDataOf">
  >;
  /** Pass to `instantiateScene` / `instantiateSceneNodes` as their options. */
  readonly read: Required<Pick<InstantiateSceneOptions, "nodeFactory">>;
}

/** Everything a §79 round trip of an engine scene needs. */
export interface SceneSerializationSupport extends SceneNodeTypeSupport {
  /**
   * The component serializers, seeded with `PoseTarget` (from
   * `@four/serialization`), `MotionComponent` (§11), `KinematicController`
   * (§12), and the two physics components — `RigidBody` (§23) and `Collider`
   * (§24).
   *
   * A fresh registry per call, never a shared singleton — registries are
   * mutable, and two applications registering their own component types must
   * not see each other's. Register more on it before use.
   */
  readonly components: ComponentSerializerRegistry;
}

// --- payload helpers ---------------------------------------------------------

/** A JSON object, read defensively: anything else is treated as empty. */
function record(value: JsonValue | undefined): {
  readonly [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : {};
}

function readString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readBoolean(value: JsonValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * A **finite** number, or `undefined` (2026-08-07, A-12).
 *
 * The controls that carry a value validate their inputs (§85) and throw on
 * anything else, so every number handed to one of their constructors below goes
 * through this first: a hand-built or corrupted payload must restore a usable
 * widget rather than take the whole scene down with it, which is the same
 * tolerance the layout and label reads already apply.
 */
function readFinite(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * A finite number as JSON, or `null` for `Infinity` — which is what an unset
 * `maxWidth` / `maxHeight` holds and which JSON cannot carry.
 */
function sizeJson(value: number): JsonValue {
  return Number.isFinite(value) ? value : null;
}

function readSize(value: JsonValue | undefined, fallback: number): number {
  if (value === null) return Infinity;
  return typeof value === "number" ? value : fallback;
}

/** `[x, y]` of a `Vector2`-shaped widget field. */
function pairJson(x: number, y: number): JsonValue {
  return [x, y];
}

function readPair(value: JsonValue | undefined): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const pair = value as readonly JsonValue[];
  const x = pair[0];
  const y = pair[1];
  return typeof x === "number" && typeof y === "number" ? [x, y] : undefined;
}

/** §74 insets as the four-number record `applyInsets` accepts. */
function insetsJson(insets: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): JsonValue {
  return {
    top: insets.top,
    right: insets.right,
    bottom: insets.bottom,
    left: insets.left,
  };
}

function readInsets(
  value: JsonValue | undefined,
): { top: number; right: number; bottom: number; left: number } | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  return {
    top: readNumber(source.top) ?? 0,
    right: readNumber(source.right) ?? 0,
    bottom: readNumber(source.bottom) ?? 0,
    left: readNumber(source.left) ?? 0,
  };
}

/** §75's accessibility record, written only for the fields that are set. */
function accessibilityJson(
  accessibility: WidgetAccessibility | null,
): JsonValue | undefined {
  if (accessibility === null) return undefined;
  const payload: Record<string, JsonValue> = {};
  if (accessibility.role !== undefined) payload.role = accessibility.role;
  if (accessibility.label !== undefined) payload.label = accessibility.label;
  if (accessibility.description !== undefined) {
    payload.description = accessibility.description;
  }
  if (accessibility.tabIndex !== undefined) {
    payload.tabIndex = accessibility.tabIndex;
  }
  return payload;
}

function readAccessibility(
  value: JsonValue | undefined,
): WidgetAccessibility | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const accessibility: WidgetAccessibility = {};
  const role = readString(source.role);
  if (role !== undefined) accessibility.role = role;
  const label = readString(source.label);
  if (label !== undefined) accessibility.label = label;
  const description = readString(source.description);
  if (description !== undefined) accessibility.description = description;
  const tabIndex = readNumber(source.tabIndex);
  if (tabIndex !== undefined) accessibility.tabIndex = tabIndex;
  return accessibility;
}

/**
 * The §74 box model, the interaction flags, and the §75 record every widget
 * carries.
 *
 * Written in full rather than default-elided: `nodeDataOf` produces one opaque
 * value that `@four/serialization` does not interpret, so there is nowhere for
 * a "absent means default" rule to live except here, and a payload that spells
 * every field is the one whose meaning does not depend on the reader's version.
 */
function widgetDataJson(widget: UIWidget): Record<string, JsonValue> {
  const payload: Record<string, JsonValue> = {
    width: widget.width,
    height: widget.height,
    minWidth: widget.minWidth,
    maxWidth: sizeJson(widget.maxWidth),
    minHeight: widget.minHeight,
    maxHeight: sizeJson(widget.maxHeight),
    padding: insetsJson(widget.padding),
    margin: insetsJson(widget.margin),
    anchor: pairJson(widget.anchor.x, widget.anchor.y),
    pivot: pairJson(widget.pivot.x, widget.pivot.y),
    offset: pairJson(widget.offset.x, widget.offset.y),
    grow: widget.grow,
    interactive: widget.interactive,
    focusable: widget.focusable,
    disabled: widget.disabled,
  };
  const accessibility = accessibilityJson(widget.accessibility);
  if (accessibility !== undefined) {
    payload.accessibility = accessibility;
  }
  return payload;
}

/** The {@link UIWidgetOptions} a widget payload restores. */
function widgetOptionsFrom(
  document: SceneNodeDocument,
): UIWidgetOptions & { readonly id?: string } {
  const data = record(document.data);
  const options: UIWidgetOptions = {
    width: data.width === null ? null : (readNumber(data.width) ?? null),
    height: data.height === null ? null : (readNumber(data.height) ?? null),
    minWidth: readSize(data.minWidth, 0),
    maxWidth: readSize(data.maxWidth, Infinity),
    minHeight: readSize(data.minHeight, 0),
    maxHeight: readSize(data.maxHeight, Infinity),
    grow: readNumber(data.grow) ?? 0,
  };
  const mutable = options as Record<string, unknown>;
  if (document.id !== undefined) mutable.id = document.id;
  const padding = readInsets(data.padding);
  if (padding !== undefined) mutable.padding = padding;
  const margin = readInsets(data.margin);
  if (margin !== undefined) mutable.margin = margin;
  const anchor = readPair(data.anchor);
  if (anchor !== undefined) mutable.anchor = anchor;
  const pivot = readPair(data.pivot);
  if (pivot !== undefined) mutable.pivot = pivot;
  const offset = readPair(data.offset);
  if (offset !== undefined) mutable.offset = offset;
  const interactive = readBoolean(data.interactive);
  if (interactive !== undefined) mutable.interactive = interactive;
  const focusable = readBoolean(data.focusable);
  if (focusable !== undefined) mutable.focusable = focusable;
  const disabled = readBoolean(data.disabled);
  if (disabled !== undefined) mutable.disabled = disabled;
  const accessibility = readAccessibility(data.accessibility);
  if (accessibility !== undefined) mutable.accessibility = accessibility;
  return options;
}

/** §74 layout configuration, for the two container widgets. */
function panelDataJson(panel: Panel): Record<string, JsonValue> {
  return {
    ...widgetDataJson(panel),
    layout: {
      type: panel.layoutType,
      direction: panel.direction,
      gap: panel.gap,
      justify: panel.justify,
      align: panel.align,
    },
  };
}

/**
 * Applies a restored layout record. Read through `setLayout`, so an absent or
 * misspelled field keeps the class default rather than corrupting the panel.
 */
function applyPanelData(panel: Panel, document: SceneNodeDocument): void {
  const layout = record(record(document.data).layout);
  const type = readString(layout.type);
  if (type === "absolute" || type === "stack" || type === "flex") {
    panel.layoutType = type;
  }
  const direction = readString(layout.direction);
  if (direction === "row" || direction === "column") {
    panel.direction = direction;
  }
  const gap = readNumber(layout.gap);
  if (gap !== undefined) panel.gap = gap;
  const justify = readString(layout.justify);
  if (
    justify === "start" ||
    justify === "center" ||
    justify === "end" ||
    justify === "space-between"
  ) {
    panel.justify = justify;
  }
  const align = readString(layout.align);
  if (
    align === "start" ||
    align === "center" ||
    align === "end" ||
    align === "stretch"
  ) {
    panel.align = align;
  }
}

// --- the §73 controls that carry their own state (2026-08-07, A-12) ----------

/** A checkable control's payload: a panel's, plus the one flag it adds. */
function checkableDataJson(widget: CheckableWidget): Record<string, JsonValue> {
  return { ...panelDataJson(widget), checked: widget.checked };
}

/**
 * The bounds a ranged control (`Slider`, `ProgressIndicator`) restores.
 *
 * Both are always returned — filled in from the class defaults when the payload
 * omits one — because the two are checked against each other at construction
 * and a half-read pair is exactly what makes that check throw. A pair that
 * contradicts itself is dropped **whole**: `{}` keeps both class defaults,
 * which is a usable control, where applying one bound would move the other's
 * meaning in a way the document never stated.
 */
function readBounds(
  data: { readonly [key: string]: JsonValue },
  defaultMin: number,
  defaultMax: number,
): { min: number; max: number } | Record<string, never> {
  const min = readFinite(data.min) ?? defaultMin;
  const max = readFinite(data.max) ?? defaultMax;
  return max < min ? {} : { min, max };
}

// --- the pairs ---------------------------------------------------------------

/**
 * The §73/§79 node-type pair for every widget class `@four/ui` ships — `Panel`,
 * `Label`, `Button`, `Toggle`, `Checkbox`, `RadioButton`, `Slider`,
 * `ProgressIndicator`, and `ImageWidget` (A-14; the six controls added
 * 2026-08-07, A-12).
 *
 * Matched by **exact class identity**, exactly as `@four/serialization` matches
 * its own two: a subclass of `Button` is not a `Button` for this purpose, and
 * writing it out as one would reload it as a plain button and lose everything
 * that made it a subclass. An application's own widget classes therefore compose
 * with this pair rather than being swallowed by it — see
 * {@link registerSceneNodeTypes} for how the fallbacks chain.
 *
 * @param options the glyph atlas restored labels are given
 * @returns the writer and reader halves; pass both or neither
 */
export function registerUISerializers(
  options: SceneNodeTypeOptions = {},
): SceneNodeTypeSupport {
  const atlas = options.atlas;
  return {
    write: {
      nodeTypeOf: (node: Node): string | undefined => {
        const constructor = node.constructor;
        if (constructor === Button) return BUTTON_NODE_TYPE;
        if (constructor === Label) return LABEL_NODE_TYPE;
        if (constructor === Panel) return PANEL_NODE_TYPE;
        if (constructor === Toggle) return TOGGLE_NODE_TYPE;
        if (constructor === Checkbox) return CHECKBOX_NODE_TYPE;
        if (constructor === RadioButton) return RADIO_BUTTON_NODE_TYPE;
        if (constructor === Slider) return SLIDER_NODE_TYPE;
        if (constructor === ProgressIndicator) return PROGRESS_NODE_TYPE;
        if (constructor === ImageWidget) return IMAGE_NODE_TYPE;
        return undefined;
      },
      nodeDataOf: (node: Node): JsonValue | undefined => {
        const constructor = node.constructor;
        if (constructor === Button || constructor === Panel) {
          return panelDataJson(node as Panel);
        }
        if (constructor === Label) {
          const label = node as Label;
          return {
            ...widgetDataJson(label),
            text: label.text,
            size: label.size,
            letterSpacing: label.letterSpacing,
          };
        }
        if (constructor === Toggle || constructor === Checkbox) {
          return checkableDataJson(node as CheckableWidget);
        }
        if (constructor === RadioButton) {
          const radio = node as RadioButton;
          return { ...checkableDataJson(radio), group: radio.group };
        }
        if (constructor === Slider) {
          const slider = node as Slider;
          return {
            ...panelDataJson(slider),
            min: slider.min,
            max: slider.max,
            step: slider.step,
            value: slider.value,
            orientation: slider.orientation,
          };
        }
        if (constructor === ProgressIndicator) {
          const progress = node as ProgressIndicator;
          return {
            ...panelDataJson(progress),
            min: progress.min,
            max: progress.max,
            value: progress.value,
            indeterminate: progress.indeterminate,
          };
        }
        if (constructor === ImageWidget) {
          const image = node as ImageWidget;
          return {
            ...widgetDataJson(image),
            source: image.source,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
          };
        }
        return undefined;
      },
    },
    read: {
      nodeFactory: (document: SceneNodeDocument): Node | undefined => {
        const widgetOptions = widgetOptionsFrom(document);
        if (document.type === BUTTON_NODE_TYPE) {
          const button = new Button(widgetOptions);
          applyPanelData(button, document);
          return button;
        }
        if (document.type === PANEL_NODE_TYPE) {
          const panel = new Panel(widgetOptions);
          applyPanelData(panel, document);
          return panel;
        }
        if (
          document.type === TOGGLE_NODE_TYPE ||
          document.type === CHECKBOX_NODE_TYPE ||
          document.type === RADIO_BUTTON_NODE_TYPE
        ) {
          const data = record(document.data);
          const checked = readBoolean(data.checked) ?? false;
          const options = { ...widgetOptions, checked };
          let control: Panel;
          if (document.type === TOGGLE_NODE_TYPE) {
            control = new Toggle(options);
          } else if (document.type === CHECKBOX_NODE_TYPE) {
            control = new Checkbox(options);
          } else {
            // Restored through the constructor, so no group is reconciled on
            // the way in: `RadioButton` enforces exclusivity on the transition
            // to checked, precisely so a document reloads as it was saved.
            control = new RadioButton({
              ...options,
              group: readString(data.group) ?? "",
            });
          }
          applyPanelData(control, document);
          return control;
        }
        if (document.type === SLIDER_NODE_TYPE) {
          const data = record(document.data);
          const step = readFinite(data.step);
          const value = readFinite(data.value);
          const orientation = readString(data.orientation);
          const slider = new Slider({
            ...widgetOptions,
            ...readBounds(data, 0, 1),
            ...(step !== undefined && step >= 0 ? { step } : {}),
            ...(value !== undefined ? { value } : {}),
            ...(orientation === "horizontal" || orientation === "vertical"
              ? { orientation }
              : {}),
          });
          applyPanelData(slider, document);
          return slider;
        }
        if (document.type === PROGRESS_NODE_TYPE) {
          const data = record(document.data);
          const value = readFinite(data.value);
          const progress = new ProgressIndicator({
            ...widgetOptions,
            ...readBounds(data, 0, 1),
            ...(value !== undefined ? { value } : {}),
            indeterminate: readBoolean(data.indeterminate) ?? false,
          });
          applyPanelData(progress, document);
          return progress;
        }
        if (document.type === IMAGE_NODE_TYPE) {
          const data = record(document.data);
          const naturalWidth = readFinite(data.naturalWidth);
          const naturalHeight = readFinite(data.naturalHeight);
          return new ImageWidget({
            ...widgetOptions,
            source: readString(data.source) ?? null,
            ...(naturalWidth !== undefined && naturalWidth >= 0
              ? { naturalWidth }
              : {}),
            ...(naturalHeight !== undefined && naturalHeight >= 0
              ? { naturalHeight }
              : {}),
          });
        }
        if (document.type === LABEL_NODE_TYPE) {
          const data = record(document.data);
          const label = new Label(widgetOptions);
          if (atlas !== undefined) label.atlas = atlas;
          const text = readString(data.text);
          if (text !== undefined) label.text = text;
          const size = readNumber(data.size);
          if (size !== undefined && Number.isFinite(size) && size > 0) {
            label.size = size;
          }
          const letterSpacing = readNumber(data.letterSpacing);
          if (letterSpacing !== undefined && Number.isFinite(letterSpacing)) {
            label.letterSpacing = letterSpacing;
          }
          return label;
        }
        return undefined;
      },
    },
  };
}

/**
 * Registers the two §6a physics components on `components` and returns it
 * (§23–§25, §79, PH-17 — 2026-08-06).
 *
 * ```ts
 * import { registerPhysicsSerializers } from "four";
 * import { createDefaultComponentSerializers } from "@four/serialization";
 *
 * const components = registerPhysicsSerializers(createDefaultComponentSerializers());
 * ```
 *
 * Separated from {@link registerSceneNodeTypes} because a headless simulation
 * has physics and no widgets, and pulling `@four/ui` and `@four/text` into its
 * bundle to save a scene would be a real cost for nothing (§91's tree-shaking
 * requirement on the umbrella). {@link registerSceneNodeTypes} calls this, so an
 * application that wants everything still makes one call.
 *
 * The serializers themselves live in `@four/physics` — this function only
 * performs the registration, which is the one act neither that package nor
 * `@four/serialization` may perform alone. What a physics document carries (the
 * authored state, never the solve) is documented there; the boundary worth
 * repeating here is that **reloading a scene is not restoring a simulation**.
 * Registering a reloaded node with a world is a separate, explicit step:
 *
 * ```ts
 * const root = instantiateScene(decodeSceneDocument(text), io.components, io.read);
 * for (const node of bodyNodes(root)) world.addBody(node);
 * ```
 *
 * and a save taken while the solver held contacts reloads to the same *scene*,
 * not to the same *solve* — the §79/§34 line `tests/integration` measures.
 *
 * @param components the registry to register on; returned for chaining
 * @throws FourError `INVALID_APPLICATION_STATE` if either type name is already
 * registered — `ComponentSerializerRegistry.register` refuses duplicates, so
 * calling this twice on one registry is an error rather than a silent overwrite.
 */
export function registerPhysicsSerializers(
  components: ComponentSerializerRegistry,
): ComponentSerializerRegistry {
  return components
    .register(RigidBody, RIGID_BODY_SERIALIZER)
    .register(Collider, COLLIDER_SERIALIZER);
}

/**
 * Everything a §79 round trip of an engine-authored scene needs: the component
 * serializers, the node-type writer, and the node factory (A-14, PH-17).
 *
 * The one call an application makes. Chaining an application's own classes on
 * top is ordinary function composition — return your own type name, and fall
 * back to this pair when you have none:
 *
 * ```ts
 * const io = registerSceneNodeTypes({ atlas });
 * const document = serializeScene(root, io.components, {
 *   nodeTypeOf: (node) => myTypeOf(node) ?? io.write.nodeTypeOf(node),
 *   nodeDataOf: (node) => {
 *     const mine = myDataOf(node);
 *     return mine === undefined ? io.write.nodeDataOf(node) : mine;
 *   },
 * });
 * ```
 *
 * The two fall-backs are spelled differently on purpose (2026-08-07): a node
 * type is a string or nothing, so `??` says what it means, but §79 node *data*
 * is one opaque JSON value and `null` is a legitimate one — a writer that
 * "said something" by writing `null` would have `??` fall through to this
 * module's writer and lose it. The composition test is therefore
 * `!== undefined`, which is the same rule `serializeScene` itself applies to a
 * writer's answer.
 *
 * `restoreNodeId` is not needed by any of this: every widget takes its id
 * through {@link UIWidgetOptions} (which extends `NodeOptions`), so a restored
 * widget is constructed with the id it was saved under rather than having one
 * written onto it afterwards (A-17).
 *
 * @param options the glyph atlas restored labels are given
 * @returns a fresh registry and the matching writer/reader halves
 */
export function registerSceneNodeTypes(
  options: SceneNodeTypeOptions = {},
): SceneSerializationSupport {
  const components = createDefaultComponentSerializers();
  components.register(MotionComponent, MOTION_COMPONENT_SERIALIZER);
  // §12's controller, added 2026-08-07: without it a scene carrying one could
  // not be saved at all, because an unregistered component throws (A-15). Its
  // payload is empty by design — see `KINEMATIC_CONTROLLER_SERIALIZER`.
  components.register(KinematicController, KINEMATIC_CONTROLLER_SERIALIZER);
  registerPhysicsSerializers(components);
  return { components, ...registerUISerializers(options) };
}

/**
 * Re-exported so an application that builds its own factory can still restore
 * ids the way this module's does not have to (§79, A-17).
 *
 * A `nodeFactory` that constructs a class taking no `id` option writes the
 * saved id afterwards with this; `@four/serialization` calls it for exactly
 * that case.
 */
export { restoreNodeId };
