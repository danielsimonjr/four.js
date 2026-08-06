/**
 * Phase 11 cross-integration (plan §6j, WP-11.5) — the §113a exit, end to end:
 * *"a scene can be saved, reloaded, and benchmarked"*.
 *
 * Three things compose here that nothing else in the repository composes:
 *
 * 1. **`@four/serialization` × `@four/physics` × `@four/physics-rapier`.** The
 *    P11-1 gate is "round-trip save → load → §33-checksum-relevant state
 *    equality", and it cannot be met inside `@four/serialization`, which may not
 *    name `RigidBody` (plan §3.1). `helpers/roundtrip-scenarios.ts` performs the
 *    one cross-package registration P11-1 assigns to this layer and holds the
 *    reference serializers applications copy; this file is what proves they
 *    work.
 * 2. **The §79 / §34 line.** Saving a *scene* is not snapshotting a
 *    *simulation*, and the difference is measurable: the same scene reloads
 *    bit-identically when the solver holds no contacts, and parts from the run
 *    it was saved from within two steps when it does. Both halves are asserted
 *    below, because the pair is the finding — either one alone is an anecdote.
 * 3. **`@four/ui` composition (§72–§75).** A `Panel`/`Label`/`Button` tree lays
 *    itself out and activates from a synthetic §72 click, and round-trips
 *    through §79 — completely, including its §74 box model and §75
 *    accessibility record, through the umbrella package's
 *    `registerSceneNodeTypes()` (2026-08-06, A-14). The hand-written
 *    `nodeTypeOf` pair beside it shows what an application pays for supplying
 *    the minimum instead: the classes come back, the box model does not.
 *
 * Plus the §80 exercise the format needs and nothing else covers: a
 * hand-authored older document, upgraded by a registered migration and then
 * instantiated.
 *
 * ## Conventions (plan §1)
 *
 * Y-up (2D gravity is negative Y, §7a), radians, **seconds** everywhere, no
 * clock and no `Math.random`: every run is driven by `Application.step(DT)` with
 * a constant, injected delta, so every number below is reproducible.
 */

import { isFourError } from "@four/core";
import {
  ScenePointerEvent,
  buildPropagationPath,
  dispatchPointerEvent,
} from "@four/input";
import { Collider, RigidBody } from "@four/physics";
import { Group, Node, Scene } from "@four/scene";
import {
  ComponentSerializerRegistry,
  SCENE_FORMAT_VERSION,
  SceneMigrationRegistry,
  createDefaultComponentSerializers,
  decodeSceneDocument,
  encodeSceneDocument,
  instantiateScene,
  migrateSceneDocument,
  serializeScene,
  type JsonObject,
  type SceneDocument,
  type SceneMigrationWarning,
} from "@four/serialization";
import { buildGlyphAtlas } from "@four/text";
import { Button, Label, Panel, UI_LAYOUT_AUTHORITY } from "@four/ui";
import { registerSceneNodeTypes } from "four";
import { describe, expect, it } from "vitest";

import {
  BALLS,
  BODY_COUNT,
  CONTACT_FREE_SAVE_STEP,
  CONTACT_RELOAD_POSITION_TOLERANCE,
  CONTACT_RELOAD_VELOCITY_TOLERANCE,
  CONTROL_STEPS,
  RIGID_BODY_SERIALIZER,
  SAVE_STEP,
  SIM_ROOT_NAME,
  createRoundtripRig,
  createRoundtripSerializers,
  firstDivergence,
  loadRoundtripRig,
  maxStateDrift,
  readBodyStates,
  stepChecksums,
  type BodyState,
} from "./helpers/roundtrip-scenarios.js";

// ---------------------------------------------------------------------------
// Shared runs
// ---------------------------------------------------------------------------

/** What one straight run of the scenario produced. */
interface ControlRun {
  /** `world.checksum()` after every fixed step, in step order (§33). */
  readonly checksums: readonly number[];
  /** Every body's state after the last step. */
  readonly states: readonly BodyState[];
  /** §29 trigger events the sensor dispatched, in dispatch order. */
  readonly triggers: readonly string[];
}

/**
 * The control: one fresh rig stepped {@link CONTROL_STEPS} times in a row, with
 * nothing saved and nothing reloaded.
 *
 * Computed once and shared, because it is a pure function of the scenario and
 * three tests compare against it; `createRoundtripRig` is deterministic (§33),
 * which is itself asserted by the "does not perturb" case below.
 */
let controlRun: ControlRun | undefined;

async function control(): Promise<ControlRun> {
  if (controlRun !== undefined) {
    return controlRun;
  }
  const rig = await createRoundtripRig();
  try {
    const checksums = stepChecksums(rig, CONTROL_STEPS);
    controlRun = {
      checksums,
      states: readBodyStates(rig),
      triggers: [...rig.triggers],
    };
    return controlRun;
  } finally {
    rig.dispose();
  }
}

/** What one save → reload cycle produced. */
interface ReloadRun {
  /** The saved document, as the JSON text an application would write to disk. */
  readonly text: string;
  /** Every body's state at the instant of the save. */
  readonly saved: readonly BodyState[];
  /** Every body's state after the reload, **before** any step ran. */
  readonly restored: readonly BodyState[];
  /** Checksums of the steps run after the reload, in step order (§33). */
  readonly checksums: readonly number[];
  /** Every body's state after those steps. */
  readonly final: readonly BodyState[];
  /** §29 trigger events the reloaded sensor dispatched. */
  readonly triggers: readonly string[];
}

/**
 * Runs the scenario for `saveStep` steps, saves it through the reference
 * serializers, tears the world down, reloads into a fresh one, and runs the rest
 * of {@link CONTROL_STEPS} there.
 *
 * The save goes through `encodeSceneDocument` → text → `decodeSceneDocument`, so
 * every assertion below is about a document that really survived JSON, not about
 * an in-memory object that happened to be shaped like one.
 */
async function saveAndReload(saveStep: number): Promise<ReloadRun> {
  const registry = createRoundtripSerializers();

  const original = await createRoundtripRig();
  let text: string;
  let saved: BodyState[];
  try {
    stepChecksums(original, saveStep);
    saved = readBodyStates(original);
    text = encodeSceneDocument(serializeScene(original.root, registry));
  } finally {
    original.dispose();
  }

  const root = instantiateScene(decodeSceneDocument(text), registry);
  const reloaded = await loadRoundtripRig(root);
  try {
    const restored = readBodyStates(reloaded);
    const checksums = stepChecksums(reloaded, CONTROL_STEPS - saveStep);
    return {
      text,
      saved,
      restored,
      checksums,
      final: readBodyStates(reloaded),
      triggers: [...reloaded.triggers],
    };
  } finally {
    reloaded.dispose();
  }
}

/** Both reload runs, computed once each. */
let contactFreeReload: ReloadRun | undefined;
let contactReload: ReloadRun | undefined;

async function reloadedFromContactFreeSave(): Promise<ReloadRun> {
  contactFreeReload ??= await saveAndReload(CONTACT_FREE_SAVE_STEP);
  return contactFreeReload;
}

async function reloadedFromContactSave(): Promise<ReloadRun> {
  contactReload ??= await saveAndReload(SAVE_STEP);
  return contactReload;
}

/** Asserts that two state readbacks agree on every §33-relevant field. */
function expectStatesIdentical(
  actual: readonly BodyState[],
  expected: readonly BodyState[],
): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const a = actual[i];
    const b = expected[i];
    expect(a.name).toBe(b.name);
    // Exact equality, not `toBeCloseTo`: the claim is that a §79 round trip
    // restores authored state bit for bit, and a tolerance here would hide the
    // one thing this assertion exists to check.
    expect([a.position.x, a.position.y, a.position.z]).toEqual([
      b.position.x,
      b.position.y,
      b.position.z,
    ]);
    expect([a.rotation.x, a.rotation.y, a.rotation.z, a.rotation.w]).toEqual([
      b.rotation.x,
      b.rotation.y,
      b.rotation.z,
      b.rotation.w,
    ]);
    expect([
      a.linearVelocity.x,
      a.linearVelocity.y,
      a.linearVelocity.z,
    ]).toEqual([b.linearVelocity.x, b.linearVelocity.y, b.linearVelocity.z]);
    expect([
      a.angularVelocity.x,
      a.angularVelocity.y,
      a.angularVelocity.z,
    ]).toEqual([b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z]);
    expect(a.mass).toBe(b.mass);
  }
}

// ---------------------------------------------------------------------------
// The P11-1 gate: save → load → §33-relevant state equality
// ---------------------------------------------------------------------------

describe("scene round trip (§79, §113a)", () => {
  it("writes a document that carries the whole simulated subtree", async () => {
    const run = await reloadedFromContactSave();
    const document = decodeSceneDocument(run.text);

    expect(document.formatVersion).toBe(SCENE_FORMAT_VERSION);
    expect(document.nodes).toHaveLength(1);
    const root = document.nodes[0];
    expect(root.type).toBe("group");
    expect(root.name).toBe(SIM_ROOT_NAME);
    expect(root.children).toHaveLength(BODY_COUNT);

    // Components appear in *registration* order, which is the registry's order
    // (`PoseTarget`, then `RigidBody`, then `Collider`) and not the node's
    // attach order, which nothing can observe (`serializer.ts`). No node here
    // carries a `PoseTarget`, so two of the three appear.
    for (const child of root.children ?? []) {
      expect((child.components ?? []).map((entry) => entry.type)).toEqual([
        "rigid-body",
        "collider",
      ]);
    }

    // The one body authored with no mass *reports* the solver-derived one and
    // the document deliberately does **not** carry it: registration mirrors the
    // derived mass onto `RigidBody.derivedMass` and leaves authoredness alone,
    // so `toDescriptor()` still asks the next solver to derive (§23, §25;
    // corrected 2026-08-06 — see the helper module header).
    const derived = (root.children ?? []).find(
      (child) => child.name === "ball-derived",
    );
    const body = (derived?.components ?? []).find(
      (entry) => entry.type === "rigid-body",
    );
    expect(body).toBeDefined();
    expect("mass" in (body?.data as JsonObject)).toBe(false);

    // Density 1 kg/m² times the circle's area (§24, §25), to f32 precision: the
    // component still *reports* it — both before and after the reload, which is
    // what re-derivation from the saved collider buys — even though the
    // document never wrote it down.
    const savedDerived = run.saved.find(
      (state) => state.name === BALLS[1].name,
    );
    const reloadedDerived = run.restored.find(
      (state) => state.name === BALLS[1].name,
    );
    const derivedArea = Math.PI * BALLS[1].radius * BALLS[1].radius;
    expect(savedDerived?.mass).toBeCloseTo(derivedArea, 7);
    expect(reloadedDerived?.mass).toBeCloseTo(derivedArea, 7);

    // The authored ball keeps its authored mass in the document, which is the
    // other half of the distinction.
    const authored = (root.children ?? []).find(
      (child) => child.name === "ball-authored",
    );
    const authoredBody = (authored?.components ?? []).find(
      (entry) => entry.type === "rigid-body",
    );
    expect((authoredBody?.data as JsonObject).mass).toBe(BALLS[0].mass);
  }, 30_000);

  it("restores every §33-relevant field bit for bit (the P11-1 gate)", async () => {
    const run = await reloadedFromContactSave();

    expect(run.restored).toHaveLength(BODY_COUNT);
    expectStatesIdentical(run.restored, run.saved);
    expect(maxStateDrift(run.restored, run.saved)).toEqual({
      position: 0,
      velocity: 0,
    });
  }, 30_000);

  it("does not perturb the simulation it saves", async () => {
    // The same rig, saved mid-run and then *continued*, must produce exactly the
    // control's stream: serialization is a read (§79), and a writer that touched
    // a transform or drained a command buffer would show up here as a divergence
    // from the save step onwards.
    const expected = await control();
    const registry = createRoundtripSerializers();
    const rig = await createRoundtripRig();
    try {
      const before = stepChecksums(rig, SAVE_STEP);
      serializeScene(rig.root, registry);
      const after = stepChecksums(rig, CONTROL_STEPS - SAVE_STEP);
      expect([...before, ...after]).toEqual([...expected.checksums]);
    } finally {
      rig.dispose();
    }
  }, 30_000);

  it("reloads bit-identically while the solver holds no contacts (§79)", async () => {
    // The positive half of the §79 / §34 finding. Saved while both balls are
    // still falling, the reloaded world reproduces the control's §33 checksum
    // stream *element by element* for the remaining 200 steps — through every
    // later collision, bounce, and sensor crossing. Nothing about §79 is lossy
    // here; the document is a complete description of the scene.
    const expected = await control();
    const run = await reloadedFromContactFreeSave();

    expect(run.checksums).toHaveLength(CONTROL_STEPS - CONTACT_FREE_SAVE_STEP);
    expect([...run.checksums]).toEqual([
      ...expected.checksums.slice(CONTACT_FREE_SAVE_STEP),
    ]);
    expect(
      firstDivergence(
        run.checksums,
        expected.checksums.slice(CONTACT_FREE_SAVE_STEP),
      ),
    ).toBe(-1);
    expectStatesIdentical(run.final, expected.states);
  }, 30_000);

  it("re-triggers the reloaded sensor exactly as the control did (§24, §29)", async () => {
    // A sensor is not just a flag that survived JSON: the reloaded collider
    // dispatches the same §29 trigger sequence, at the same points of the same
    // simulation. Asserted on the contact-free reload, which still has the whole
    // fall ahead of it.
    const expected = await control();
    const run = await reloadedFromContactFreeSave();
    expect([...run.triggers]).toEqual([...expected.triggers]);
    expect(run.triggers.length).toBeGreaterThan(0);
  }, 30_000);

  it("diverges from the run it was saved from once contacts are live — the §79/§34 line", async () => {
    // The negative half, and the boundary this packet exists to state.
    //
    // Saved with both balls resting on the ground, the reloaded world starts
    // from *identical* poses and velocities (the case above asserts a drift of
    // exactly zero) and still parts from the control within two steps. Nothing was lost
    // that §79 promises to carry: what is missing is the solver's contact
    // manifolds and warm-start impulses, which are §34 snapshot state
    // (`PhysicsWorld.createSnapshot`) and are deliberately absent from a scene
    // document — §79: "physics state, animation state, and replay data must be
    // separate optional sections".
    //
    // An application that needs bit-identity across a save must take a §34
    // snapshot beside the §79 document. What a §79 document alone guarantees is
    // what is asserted here: the same scene, settling to the same place.
    const expected = await control();
    const run = await reloadedFromContactSave();
    const tail = expected.checksums.slice(SAVE_STEP);

    expect(run.checksums).toHaveLength(tail.length);
    // Measured 2026-08-02: the streams part company at index **1** — the first
    // reloaded step still quantizes to the same digest and the second does not.
    // Asserted as a bound rather than as the exact index, so a solver update
    // that moves it by a step is not a false failure, while a reload that
    // somehow stopped diverging at all still is: the claim under test is that a
    // §79 document cannot reproduce a contact-carrying solve, and if it ever
    // could, this comment is wrong and somebody should find out why.
    const divergence = firstDivergence(run.checksums, tail);
    expect(divergence).toBeGreaterThanOrEqual(0);
    expect(divergence).toBeLessThan(10);

    const drift = maxStateDrift(run.final, expected.states);
    expect(drift.position).toBeLessThan(CONTACT_RELOAD_POSITION_TOLERANCE);
    expect(drift.velocity).toBeLessThan(CONTACT_RELOAD_VELOCITY_TOLERANCE);
    // Same bodies, same masses, same resting arrangement — a behavioural
    // equality the checksum stream cannot express.
    for (let i = 0; i < expected.states.length; i += 1) {
      expect(run.final[i].name).toBe(expected.states[i].name);
      expect(run.final[i].mass).toBe(expected.states[i].mass);
    }
  }, 30_000);

  it("refuses to save a component whose class was never registered (A-15)", async () => {
    // This used to be the one failure mode of the design, asserted here as
    // "silently drops": the writer walked the *serializer* registry and probed
    // each registered class, because `Node` offered no component enumeration —
    // so a component nobody registered was unsaved and the omission could not
    // be detected at save time. `Node.components` closed it on 2026-08-06;
    // forgetting one of the two `register` calls now costs a `FourError`
    // naming the component, not every collider in the scene.
    const partial = new ComponentSerializerRegistry().register(
      RigidBody,
      RIGID_BODY_SERIALIZER,
    );
    expect(partial.has("rigid-body")).toBe(true);
    expect(partial.has("collider")).toBe(false);

    const componentsOf = (document: SceneDocument): string[] =>
      (document.nodes[0].children ?? []).flatMap((child) =>
        (child.components ?? []).map((entry) => entry.type),
      );

    const rig = await createRoundtripRig();
    try {
      expect(
        new Set(
          componentsOf(serializeScene(rig.root, createRoundtripSerializers())),
        ),
      ).toEqual(new Set(["rigid-body", "collider"]));

      let thrown: unknown;
      try {
        serializeScene(rig.root, partial);
      } catch (error) {
        thrown = error;
      }
      expect(isFourError(thrown) && thrown.code).toBe(
        "INVALID_APPLICATION_STATE",
      );
      expect(isFourError(thrown) && thrown.message).toMatch(/collider/);

      // Dropping it is still available — as a deliberate, per-save opt-in that
      // mirrors the read side, rather than as the default.
      expect(
        new Set(
          componentsOf(
            serializeScene(rig.root, partial, { unknownComponents: "skip" }),
          ),
        ),
      ).toEqual(new Set(["rigid-body"]));
    } finally {
      rig.dispose();
    }
  }, 30_000);

  it("refuses to load a document whose components it cannot rebuild", async () => {
    const run = await reloadedFromContactSave();
    const document = decodeSceneDocument(run.text);
    const bare = createDefaultComponentSerializers();

    // The reading side has no blind spot: an unknown component type is visible,
    // and the default policy refuses the load rather than handing back a scene
    // that is quietly missing its physics.
    expect(() => instantiateScene(document, bare)).toThrow(/rigid-body/);

    const skipped = instantiateScene(document, bare, {
      unknownComponents: "skip",
    });
    expect(skipped.children).toHaveLength(BODY_COUNT);
    for (const child of skipped.children) {
      expect(child.getComponent(RigidBody)).toBeUndefined();
      expect(child.getComponent(Collider)).toBeUndefined();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// §72–§75 UI composition
// ---------------------------------------------------------------------------

/** Dispatches one §72 event at `target` through the real propagation path. */
function dispatch(
  type: "pointerdown" | "pointerup" | "click",
  target: Node,
): void {
  dispatchPointerEvent(
    new ScenePointerEvent({ type, pointerId: 1, ndcX: 0, ndcY: 0, target }),
    buildPropagationPath(target),
  );
}

/** The tree both UI cases build: a panel holding a label and a button. */
function buildUITree(): {
  root: Panel;
  caption: Label;
  button: Button;
  buttonLabel: Label;
} {
  const atlas = buildGlyphAtlas();
  const root = new Panel({
    name: "hud",
    width: 200,
    layout: { type: "flex", direction: "column", gap: 8, padding: 10 },
  });
  const caption = new Label({
    name: "caption",
    text: "Bodies: 4",
    atlas,
    size: 12,
  });
  const button = new Button({ name: "start", height: 30 });
  const buttonLabel = new Label({
    name: "start-text",
    text: "Start",
    atlas,
    size: 12,
  });
  button.add(buttonLabel);
  root.add(caption);
  root.add(button);
  return { root, caption, button, buttonLabel };
}

describe("UI composition (§72–§75)", () => {
  it("lays a Panel/Label/Button tree out and activates from a §72 click", () => {
    const { root, caption, button, buttonLabel } = buildUITree();
    const scene = new Scene();
    scene.add(root);
    root.layout();

    // §74: the panel's explicit width wins, the label measures its own text
    // through `@four/text`, and the flex column stacks them with the gap.
    expect(root.measuredWidth).toBe(200);
    expect(caption.measuredWidth).toBeGreaterThan(0);
    expect(button.measuredHeight).toBe(30);
    expect(caption.layoutTop).toBe(10);
    expect(button.layoutTop).toBe(10 + caption.measuredHeight + 8);
    // The layout pass owns the transform under §42's `"constraint"` authority.
    expect(button.transformAuthority).toBe(UI_LAYOUT_AUTHORITY);
    expect(button.transform.position.y).toBe(-button.layoutTop);

    const activations: string[] = [];
    button.on("uiactivate", (event) => activations.push(event.source));

    dispatch("pointerdown", button);
    expect(button.pressed).toBe(true);
    expect(button.focused).toBe(true);
    dispatch("pointerup", button);
    expect(button.pressed).toBe(false);

    // A click on the label *inside* the button bubbles to it and activates it
    // exactly once (§72's Capture → Target → Bubble).
    dispatch("click", buttonLabel);
    expect(activations).toEqual(["pointer"]);
  });

  it("refuses to serialize a widget tree, because no class names a node type", () => {
    // Widgets *are* `Node`s, so the tree is a legal scene graph — but
    // `serializeScene` matches node types by **exact class identity**, and a
    // `Panel` is neither `Scene` nor `Group`. Writing it out as `"group"` would
    // reload it as a plain group and lose everything that made it a panel, so
    // the writer refuses and names the class instead. Widget serializers now
    // exist — `registerSceneNodeTypes()` in the umbrella `four` package, see
    // the test below — but they are opt-in, and a caller that supplies none
    // still gets this refusal rather than a silent downgrade.
    //
    // The refusal names the *deepest* offending class, because `serializeScene`
    // walks children before it resolves its own type — here the `Label` inside
    // the button, not the `Panel` at the root.
    const { root } = buildUITree();
    expect(() => serializeScene(root, createRoundtripSerializers())).toThrow(
      /has no type name for/,
    );
    expect(() => serializeScene(root, createRoundtripSerializers())).toThrow(
      /Label|Button|Panel/,
    );
  });

  it("round-trips a widget tree's Node state through a bare nodeTypeOf pair", () => {
    // The minimum an application can supply: a `nodeTypeOf` / `nodeFactory`
    // pair that names the classes and nothing more. The tree round-trips — as
    // `Node`s. What survives is exactly what `@four/scene`'s own serializer
    // carries: hierarchy, names, transforms (including the positions the layout
    // pass wrote), authority, flags, tags.
    //
    // What does **not** survive is every field `UIWidget` added: requested
    // width/height, padding and margins, the label's text and atlas, the
    // button's focusability. A reloaded tree is therefore a correctly *placed*
    // widget tree that has forgotten how it was placed — laying it out again
    // would move everything. That is the cost of writing the pair by hand;
    // `registerSceneNodeTypes()` (next test) is the pair that does not pay it.
    const { root, button } = buildUITree();
    root.layout();

    const registry = createRoundtripSerializers();
    const document = serializeScene(root, registry, {
      nodeTypeOf: (node): string | undefined =>
        node instanceof Button
          ? "ui:button"
          : node instanceof Label
            ? "ui:label"
            : node instanceof Panel
              ? "ui:panel"
              : undefined,
    });

    const reloaded = instantiateScene(
      decodeSceneDocument(encodeSceneDocument(document)),
      registry,
      {
        // A faithful factory would restore the box model here from data the
        // document does not carry; a `Group` is the honest stand-in and makes the
        // loss visible rather than papering over it.
        nodeFactory: (): Node => new Group(),
      },
    );

    expect(reloaded.name).toBe("hud");
    expect(reloaded.children.map((child) => child.name)).toEqual([
      "caption",
      "start",
    ]);
    expect(reloaded.children[1].children.map((child) => child.name)).toEqual([
      "start-text",
    ]);
    // The laid-out position survives, because it is a `Transform` (§7).
    expect(reloaded.children[1].transform.position.y).toBe(
      button.transform.position.y,
    );
    expect(reloaded.children[1].transformAuthority).toBe(UI_LAYOUT_AUTHORITY);
    // The inputs that produced it do not: the reloaded node is not a widget at
    // all, and there is nowhere for a width or a string of text to have gone.
    expect(reloaded.children[1]).not.toBeInstanceOf(Button);
    expect(reloaded).not.toBeInstanceOf(Panel);
  });

  it("round-trips a widget tree completely through registerSceneNodeTypes (A-14)", () => {
    // §73: "UI objects are scene nodes and therefore share animation, input,
    // clipping, serialization, and diagnostics." Of those five, serialization
    // did not hold until 2026-08-06 — and this is the cross-package proof that
    // it now does, because only the umbrella package may see `@four/ui` and
    // `@four/serialization` at once.
    const { root, button, buttonLabel } = buildUITree();
    root.layout();
    const io = registerSceneNodeTypes({ atlas: buildGlyphAtlas() });

    const reloaded = instantiateScene(
      decodeSceneDocument(
        encodeSceneDocument(serializeScene(root, io.components, io.write)),
      ),
      io.components,
      io.read,
    );

    expect(reloaded).toBeInstanceOf(Panel);
    const restoredButton = (reloaded as Panel).children[1];
    expect(restoredButton).toBeInstanceOf(Button);
    expect((restoredButton as Button).width).toBe(button.width);
    expect((restoredButton as Button).height).toBe(button.height);
    expect((restoredButton as Button).focusable).toBe(button.focusable);
    const restoredLabel = (restoredButton as Button).children[0];
    expect(restoredLabel).toBeInstanceOf(Label);
    expect((restoredLabel as Label).text).toBe(buttonLabel.text);

    // The real test of "it remembers how it was placed": lay the reloaded tree
    // out from scratch and it lands where the original did.
    const before = button.transform.position.y;
    (reloaded as Panel).layout();
    expect(restoredButton.transform.position.y).toBeCloseTo(before, 12);
  });
});

// ---------------------------------------------------------------------------
// §80 migration
// ---------------------------------------------------------------------------

describe("scene migration (§80)", () => {
  /**
   * A hand-authored document in an imagined format version 0: nodes hang off a
   * single `root` object instead of a `nodes` array, and a node's layer is an
   * integer rather than a tag.
   *
   * Hand-written on purpose — a migration that is only ever fed documents this
   * build produced proves nothing about the older files §80 exists for.
   */
  const V0_DOCUMENT = {
    formatVersion: 0,
    root: {
      id: "legacy-root",
      name: "level",
      type: "group",
      layer: 3,
      children: [
        {
          id: "legacy-crate",
          name: "crate",
          type: "group",
          layer: 3,
          transform: { position: { x: 2, y: 0.5, z: 0 } },
        },
      ],
    },
  };

  /** Upgrades a v0 node in place, recursively: `layer` becomes a §6 tag. */
  function upgradeNode(node: JsonObject): JsonObject {
    const { layer, children, ...rest } = node;
    const upgraded: Record<string, unknown> = { ...rest };
    if (typeof layer === "number") {
      upgraded.tags = [`layer-${String(layer)}`];
    }
    if (Array.isArray(children)) {
      upgraded.children = (children as JsonObject[]).map((child) =>
        upgradeNode(child),
      );
    }
    return upgraded as JsonObject;
  }

  it("upgrades a hand-authored v0 document and instantiates it", () => {
    const warnings: SceneMigrationWarning[] = [];
    const migrations = new SceneMigrationRegistry().registerMigration(
      0,
      (document, context) => {
        context.warn(
          "v0 `layer` integers are dropped; each becomes a `layer-N` tag (§6).",
        );
        expect(context.fromVersion).toBe(0);
        expect(context.toVersion).toBe(1);
        return { nodes: [upgradeNode(document.root as JsonObject)] };
      },
    );

    const document = migrateSceneDocument(V0_DOCUMENT, migrations, {
      onWarning: (warning) => warnings.push(warning),
    });

    // The runner stamps the version, so a step cannot forget to.
    expect(document.formatVersion).toBe(SCENE_FORMAT_VERSION);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fromVersion).toBe(0);
    expect(warnings[0].message).toMatch(/layer/);

    const scene = instantiateScene(document, createRoundtripSerializers());
    expect(scene).toBeInstanceOf(Group);
    expect(scene.id).toBe("legacy-root");
    expect([...scene.tags]).toEqual(["layer-3"]);
    expect(scene.children).toHaveLength(1);
    const crate = scene.children[0];
    expect(crate.name).toBe("crate");
    expect(crate.transform.position.x).toBe(2);
    expect(crate.transform.position.y).toBe(0.5);
    expect([...crate.tags]).toEqual(["layer-3"]);
  });

  it("refuses a version it has no path to, rather than loading it anyway", () => {
    // §80's "composable across multiple versions" is only checkable when a
    // missing link is an error; a silent pass-through would hand the reader a
    // v0 document to validate as v1.
    expect(() =>
      migrateSceneDocument(V0_DOCUMENT, new SceneMigrationRegistry()),
    ).toThrow(/migration/i);
  });
});
