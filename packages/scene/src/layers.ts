/**
 * Symbolic layers and their compiled masks (§46).
 *
 * §46 is two paragraphs. The first lists what layers *control* — "camera
 * visibility; rendering order; physics interaction groups; picking and pointer
 * interaction; post-processing inclusion; editor-only objects; debug
 * visualization" — and the second fixes the representation:
 *
 * > Layers should compile to efficient masks internally while preserving
 * > human-readable names in the public API and serialized scene files.
 *
 * So the shipped model is a **name registry over 32 bits**. An author names a
 * layer; the registry hands out the bit; every consumer — the §64 render list,
 * §47's `Camera.layers`, §48's `Viewport.layerMask`, a §71 candidate list — does
 * one `&`.
 *
 * ```ts
 * defineLayer("ui");                      // allocates a bit, idempotent
 * panel.layers = layerMask("ui");         // this node lives on "ui"
 * worldView.camera.layers = layerMask("default");   // and this camera cannot see it
 * uiView.layerMask = layerMask("ui");     // while this viewport sees only it
 * ```
 *
 * ## Self, not subtree (decision, R-38, 2026-08-08)
 *
 * **A node's mask gates that node only.** Its children are tested against their
 * own masks and are neither hidden by, nor forced to agree with, their parent's.
 * §46 does not say either way, so this is a decision, and it is the opposite of
 * how `visible` and `enabled` behave (both prune whole subtrees — see
 * `buildRenderList`). Three reasons:
 *
 * - **A layer is identity, not state.** `visible = false` says "this is off",
 *   and off-ness inherits naturally: nothing inside a hidden group can be
 *   meaningfully visible. A layer says "this belongs to the UI" — and a node's
 *   membership is no more its parent's than its name or its id is.
 * - **Subtree gating is strictly less expressive.** Under it, a node on `"ui"`
 *   could not carry a child on `"default"`; the model would have no way to say
 *   "this gizmo's handle is editor-only but its target is not". Self-only loses
 *   nothing in the other direction: subtree behaviour is one call to
 *   {@link applyLayers}, which is exactly how the editors that popularized
 *   per-object layers (Three.js's `Object3D.layers`, Unity's `GameObject.layer`)
 *   spell it.
 * - **Changing a layer can never make something else disappear.** Under subtree
 *   gating, moving a group onto an editor-only layer silently takes its whole
 *   contents with it — the class of surprise §46's "editor-only objects" bullet
 *   exists to make explicit.
 *
 * Traversal is therefore **unchanged**: a filtered node's children are still
 * visited, the walk order is still §6's depth-first insertion order, and the
 * filter is a pure predicate of `(node.layers, mask)` — which is what keeps a
 * filtered render list deterministic (§33) and a masked scene comparable to an
 * unmasked one.
 *
 * ## Bit allocation is by first definition
 *
 * {@link defineLayer} allocates the next free index the first time it sees a
 * name and returns the same index forever after, exactly as `Node`'s id counter
 * assigns ids in construction order (§33 — a counter, never a hash or a clock,
 * so two identical call sequences produce identical assignments). Index 0 is
 * seeded as {@link DEFAULT_LAYER_NAME} before any user code runs, so the default
 * layer is the same bit in every process.
 *
 * The registry is **module-level**, not per-`Scene`: a node exists before it is
 * added to a scene, may be moved between scenes, and — under §79 — is
 * deserialized before its scene is assembled, so a per-scene registry would have
 * to answer "which scene's bit?" at every one of those moments. One process-wide
 * table has no such question, and §46 puts layers beside queries in a *Scene*
 * section only because that is where the reader meets them.
 *
 * ## Serialization (§46, §79)
 *
 * §46 requires the **names** in serialized scene files, never the bits: a
 * document that stored `layers: 4` would silently mean a different layer in a
 * process that defined its layers in a different order. A writer emits
 * {@link layerNames} plus each node's mask decoded through
 * {@link layerMaskNames}; a reader calls {@link resetLayers} and then
 * {@link defineLayer} once per saved name, in saved order, which reproduces the
 * document's assignment exactly. No extra API is needed for the round trip, and
 * none is invented here — `@four/serialization` owns the document shape (§79).
 *
 * ## What this module deliberately does not do
 *
 * §46's list of what layers control is longer than what reads a mask today. The
 * shipped consumers are camera visibility and viewport selection (§47/§48, via
 * `@four/render`'s list builders and the backend's per-view filter). Physics
 * interaction groups (§25), post-processing inclusion (§70), and the §71 picking
 * filter are their own packets — each needs a mask *field* on a type this
 * package cannot see, and each is unblocked by this module rather than part of
 * it. `Renderable.renderLayer` (§49) is a different thing with a confusingly
 * similar name: it is §66's *sort key*, an ordinal, and it is not a mask.
 *
 * ## Where the object-side field lives
 *
 * §46 requires layers to control camera visibility, picking, and physics
 * grouping — all of which need a mask on the *object* — but the specification
 * never declares one: §6's `Node` does not list it, §49's `Renderable` does not
 * either, and only §47's `Camera` and §48's `Viewport` carry a mask in their
 * declarations. The engine puts it on `Node` (as §42's `transformAuthority`
 * already is), because every §46 consumer names things §49 does not cover —
 * a collider, an editor gizmo, a pointer hot zone. `Camera` then *overrides*
 * that field with §47's own meaning; see `camera.ts` for why that collision is
 * safe.
 */

import { FourError } from "@four/core";

/**
 * A set of layers, as a bit per layer (§46, §47's `LayerMask`).
 *
 * A plain `number` used as an unsigned 32-bit field: bit *i* is set when the
 * mask contains the layer whose index is *i*. It is a type alias rather than a
 * branded type or a class because §47 and §48 both declare it as an ordinary
 * field, because every operation on it is a machine instruction, and because a
 * class here would allocate per node for no gain.
 *
 * Values are canonically **unsigned** — `0` through `0xffffffff` — which is what
 * {@link layerMask} and {@link ALL_LAYERS} produce and what {@link isLayerMask}
 * accepts. Testing masks with `&` is safe regardless: JavaScript's bitwise
 * operators coerce both operands to int32 and the sign bit survives the round
 * trip, so `ALL_LAYERS & 0x80000000` is non-zero exactly as it should be.
 */
export type LayerMask = number;

/** How many layers a {@link LayerMask} can distinguish (§46) — one per bit. */
export const LAYER_COUNT = 32;

/**
 * The layer every node starts on (§46), seeded at index 0 before any user code
 * runs so that it is the same bit in every process.
 */
export const DEFAULT_LAYER_NAME = "default";

/** Index of {@link DEFAULT_LAYER_NAME}. Always 0. */
export const DEFAULT_LAYER = 0;

/**
 * `Node.layers`' default: the default layer and nothing else.
 *
 * A node belongs to exactly one layer until an author says otherwise, which is
 * what makes the whole mechanism opt-in — every mask that has ever been handed
 * out contains this bit unless it was built to exclude it.
 */
export const DEFAULT_LAYER_MASK: LayerMask = 1;

/**
 * Every layer, defined or not — `Camera.layers`' default (§47) and the render
 * list's.
 *
 * A camera with this mask sees every node whatever layer it is on, which is why
 * a scene that never mentions layers behaves exactly as it did before they
 * existed: the filter is `(node.layers & ALL_LAYERS) !== 0`, and `node.layers`
 * is never zero unless an author zeroed it.
 */
export const ALL_LAYERS: LayerMask = 0xffffffff;

/** No layer at all — a mask that matches nothing. Never a node's default. */
export const NO_LAYERS: LayerMask = 0;

/**
 * Layer names by index; `names[i]` is the layer whose bit is `1 << i`.
 *
 * Seeded with {@link DEFAULT_LAYER_NAME}, so index 0 is taken before anything
 * else can claim it.
 */
let names: string[] = [DEFAULT_LAYER_NAME];

/** Reverse of {@link names}, so a lookup is a hash probe rather than a scan. */
let indices = new Map<string, number>([[DEFAULT_LAYER_NAME, DEFAULT_LAYER]]);

/**
 * The bit index of the layer called `name`, defining it if this is the first
 * time the registry has seen it (§46).
 *
 * ```ts
 * const ui = defineLayer("ui");     // 1, on a fresh registry
 * defineLayer("ui") === ui;         // true — idempotent, forever
 * ```
 *
 * Allocation is by first definition (see the module header), so it is
 * deterministic given the same sequence of calls and reproducible from a
 * serialized document by replaying the saved names in order. Most code should
 * call {@link layerMask} instead and never see an index at all; this function is
 * for the caller that wants the bit position itself — a serializer, a
 * diagnostics table, or a consumer packing masks by hand.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` when `name` is empty (a layer
 * with no name cannot be written to a scene file, which §46 requires), or when
 * the registry already holds {@link LAYER_COUNT} layers. Both throw
 * unconditionally — in production too — because there is no value to return and
 * continuing would silently alias two layers onto one bit.
 */
export function defineLayer(name: string): number {
  const existing = indices.get(name);
  if (existing !== undefined) {
    return existing;
  }
  if (name === "") {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      "a layer name must not be empty (§46).",
    );
  }
  if (names.length >= LAYER_COUNT) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `cannot define layer "${name}": all ${String(LAYER_COUNT)} layers are ` +
        `taken (§46). Defined: ${names.join(", ")}.`,
      { context: { name, defined: [...names] } },
    );
  }
  const index = names.length;
  names.push(name);
  indices.set(name, index);
  return index;
}

/**
 * The bit index of the layer called `name`, or `undefined` if it has never been
 * defined — the non-allocating counterpart of {@link defineLayer}.
 *
 * Use it to ask a question without answering it: a diagnostics panel listing the
 * layers a document mentions must not create the ones it misspells.
 */
export function layerIndex(name: string): number | undefined {
  return indices.get(name);
}

/**
 * The name of the layer at bit index `index`, or `undefined` when nothing has
 * claimed that bit (§46's "human-readable names").
 */
export function layerName(index: number): string | undefined {
  return names[index];
}

/**
 * Every defined layer, in index order — `layerNames()[i]` is the layer whose bit
 * is `1 << i`.
 *
 * A fresh copy, not the live array: the registry's ordering *is* its bit
 * assignment, and handing out a mutable view would let a caller renumber every
 * mask in the process. This is what a §79 writer emits so that a reader can
 * reproduce the assignment (see the module header).
 */
export function layerNames(): readonly string[] {
  return [...names];
}

/**
 * Compiles layer names to the mask that contains exactly them (§46).
 *
 * ```ts
 * node.layers = layerMask("ui");                  // one layer
 * view.layerMask = layerMask("default", "debug"); // two
 * layerMask() === NO_LAYERS;                      // none
 * ```
 *
 * Undefined names are **defined on the way through**, by {@link defineLayer}:
 * `layerMask("ui")` is the shortest correct spelling of "put this on the UI
 * layer" and requiring a separate declaration first would make the common case
 * two statements for no safety — a name is checked by the same mechanism either
 * way, and a typo that allocates a bit is loud (the layer is empty, and
 * {@link layerNames} shows it) rather than silent. Call {@link layerIndex} when
 * you need a lookup that cannot allocate.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` — see {@link defineLayer}.
 */
export function layerMask(...layerNamesToSet: readonly string[]): LayerMask {
  let mask = 0;
  for (let i = 0; i < layerNamesToSet.length; i += 1) {
    mask |= 1 << defineLayer(layerNamesToSet[i]);
  }
  // `|` yields a signed int32, so bit 31 alone would come back negative; the
  // shift puts every mask back in the unsigned range this module documents.
  return mask >>> 0;
}

/**
 * The names of the layers `mask` contains, in index order — the inverse of
 * {@link layerMask}, and what a §79 writer stores instead of the number.
 *
 * Bits with no defined layer are skipped rather than reported as `undefined`: a
 * mask like {@link ALL_LAYERS} names every layer that exists and says nothing
 * about the ones that do not.
 */
export function layerMaskNames(mask: LayerMask): string[] {
  const result: string[] = [];
  for (let i = 0; i < names.length; i += 1) {
    if ((mask & (1 << i)) !== 0) {
      result.push(names[i]);
    }
  }
  return result;
}

/**
 * Whether two masks share a layer — the one predicate every §46 consumer runs
 * (§64's stage 2, §47's camera visibility, §48's viewport selection, §71's
 * candidate filter).
 *
 * ```ts
 * layersMatch(node.layers, camera.layers);   // does this camera see this node?
 * ```
 *
 * Deliberately symmetric and total: it is a set intersection test, it never
 * throws, and it has no notion of which argument is the object and which is the
 * view. That is what lets the same call filter a render list, a picking
 * candidate list, and a physics interaction pair without three spellings.
 */
export function layersMatch(a: LayerMask, b: LayerMask): boolean {
  return (a & b) !== 0;
}

/**
 * Whether `value` is a well-formed {@link LayerMask}: an integer in
 * `[0, 0xffffffff]`.
 *
 * A pure predicate with no side effects and no build-mode behaviour, so it can
 * back both a §85 assertion and an application's own validation of a value it
 * parsed.
 */
export function isLayerMask(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= ALL_LAYERS;
}

/**
 * Refuses a malformed mask (§85), naming the field it came from.
 *
 * §85 asks builds to detect "NaN and infinite values"; a mask is the case where
 * detection earns its check, because a `NaN` mask fails *every* `&` test
 * silently — the scene simply stops drawing, with no error and nothing in the
 * frame to point at. A fractional or out-of-range mask is the same mistake
 * arriving through a parsed document.
 *
 * **Unconditional, not gated on `DEV`** — deliberately, and for two reasons.
 * §85 lets production disable *expensive* validation "while preserving
 * essential safety checks", and this is three comparisons at an entry point,
 * not a scan: a build that skipped it would trade a named error for an empty
 * screen. And `@four/scene` is a simulation package under §33, which
 * `tests/integration/dev-build-mode.test.ts` holds to a blunt rule — nothing
 * here may branch on the build mode at all, so that a replay cannot depend on
 * which build ran it (see `@four/core`'s `dev.ts` for the "unconditional throw
 * vs. `devAssert`" rule this follows).
 *
 * Call it **once per operation** — at the entry point that accepts an author's
 * mask — never per node in a traversal.
 *
 * @throws FourError `INVALID_SCENE_GRAPH` when `mask` is not a well-formed
 * {@link LayerMask}.
 */
export function assertLayerMask(mask: LayerMask, field: string): void {
  if (isLayerMask(mask)) return;
  throw new FourError(
    "INVALID_SCENE_GRAPH",
    `${field} must be an integer layer mask in [0, 0xffffffff]; got ` +
      `${String(mask)} (§46, §85).`,
    { context: { field, mask } },
  );
}

/**
 * The slice of `Node` {@link applyLayers} walks: a mask and children.
 *
 * Structural rather than `import type { Node }`, for the reason `authority.ts`
 * gives: `node.ts` imports this module at runtime (for
 * {@link DEFAULT_LAYER_MASK}), so naming the class here — even type-only —
 * would close an import cycle between the two files. Every `Node` satisfies
 * this shape.
 */
export interface LayeredNode {
  /** `Node.layers` — the §46 mask to overwrite. */
  layers: LayerMask;
  /** `Node.children` — walked depth-first, in insertion order (§6). */
  readonly children: readonly LayeredNode[];
}

/**
 * Sets `layers` on `root` and every descendant (§46) — the subtree spelling that
 * self-only semantics makes explicit rather than implicit (see the module
 * header).
 *
 * ```ts
 * applyLayers(panel, layerMask("ui"));   // the panel and everything in it
 * ```
 *
 * Depth-first in insertion order, like every other walk in the engine, and it
 * writes nothing else — a node's transform, visibility, and components are
 * untouched. Idempotent, so calling it after adding a child re-establishes the
 * subtree's membership without any bookkeeping in between.
 *
 * It walks **every** node, cameras included — and `Camera.layers` is the mask
 * that camera *looks at*, not one it belongs to (see `camera.ts`). Applying
 * layers to a subtree containing a camera therefore re-aims that camera. Apply
 * to the branch you mean.
 *
 * Takes the node structurally rather than as a `Node`, so `node.ts` can import
 * this module for {@link DEFAULT_LAYER_MASK} without closing a cycle.
 */
export function applyLayers(root: LayeredNode, layers: LayerMask): void {
  assertLayerMask(layers, "applyLayers(layers)");
  root.layers = layers;
  const children = root.children;
  for (let i = 0; i < children.length; i += 1) {
    applyLayers(children[i], layers);
  }
}

/**
 * Forgets every layer but {@link DEFAULT_LAYER_NAME}, putting the registry back
 * to its initial state.
 *
 * Two callers, and the same reason `resetDevWarnings` exists: a test that
 * asserts "this name got bit 1" is only assertable from a known starting point,
 * and a §79 reader replaying a document's saved names needs the assignment to
 * start where the writer's did (see the module header).
 *
 * **Masks already held by nodes, cameras, and viewports are not rewritten** —
 * they are plain numbers and this function cannot reach them. Reset before
 * building a scene, never in the middle of one.
 */
export function resetLayers(): void {
  names = [DEFAULT_LAYER_NAME];
  indices = new Map<string, number>([[DEFAULT_LAYER_NAME, DEFAULT_LAYER]]);
}
