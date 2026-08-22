/**
 * four.js — the §73–§75 retained-mode UI, composed into a rendered scene
 * (post-plan backlog: the WP-11.5 packet-intent shortfall — "@four/ui has
 * node-level §72 coverage only; no example app imports it").
 *
 * The smallest program in which `@four/ui` does everything it claims to own,
 * on a real WebGL 2 surface, with the application supplying exactly what the
 * package may not:
 *
 * - **Widgets own hierarchy, layout, hit areas, and state.** A `Panel` lays a
 *   title `Label`, a row of three `Button`s, and a status `Label` out with
 *   §74's flex modes (a column of rows, gaps and padding in layout units). The
 *   buttons' hover/press/focus state machines and the `click → uiactivate`
 *   synthesis are the package's (§72); nothing here re-derives a gesture.
 * - **The application owns the pixels.** `@four/ui`'s frozen dependency matrix
 *   gives it no `render`, `materials`, or `geometry`, so widgets cannot draw
 *   themselves. Every visible surface below — panel background, button faces,
 *   the focus ring, the glyphs of every label — is supplied through the
 *   {@link WidgetSkin} seam: the skin reads the widget's measured box and state
 *   flags and builds ordinary scene nodes as children of the widget, so the
 *   whole UI still moves (and would serialize, and clip) as one subtree (§73).
 * - **Picking is the §71 pipeline, unmodified.** `collectPickables` walks the
 *   widget tree into the candidate list a `PointerInput` tests its camera ray
 *   against; the panel and the row opt out (`interactive: false`) so a click
 *   inside a button resolves to the button rather than tying with its
 *   coplanar ancestor (the documented candidate-order rule).
 * - **Keyboard navigation is the engine's, end to end (§75).** The application
 *   supplies a key *surface* (`window`) and nothing else: `KeyboardInput`
 *   normalizes the platform's events and routes them to the focused node, and
 *   `@four/ui` decides what they mean — Tab and Shift-Tab walk the focus
 *   through `installKeyboardTraversal`, Enter and Space activate the focused
 *   `Button`. Until 2026-08-07 this page carried a hand-written `keydown`
 *   handler doing both, because `@four/input` had no key source at all (the
 *   `UI_STAGED` entry that A-10 closed); the handler is gone, and every
 *   listener downstream still cannot tell a key from a click apart from the
 *   event's `source` field ("pointer" vs "keyboard").
 *
 * Clicking (or key-activating) a button visibly changes two things: the status
 * label's text — re-laid-out through `layout()` and re-skinned into new glyph
 * sprites — and the colour of the swatch quad beside the panel. The page
 * publishes its own account of all of it as `data-*` attributes on `#status`,
 * so the browser gate (`tests/browser/ui.spec.ts`) can assert the engine's
 * numbers and reserve the framebuffer for what only pixels can prove.
 *
 * ## Layout, in world units
 *
 * One orthographic camera shows 8 × 6 world units over an 800 × 600 canvas:
 * **100 CSS pixels per world unit**, `px = (x + 4) × 100`, `py = (3 − y) × 100`.
 * Layout units are world units (§74 — "layout units are just units"), so the
 * whole panel arithmetic is exact and restatable:
 *
 * | thing | numbers |
 * | ----- | ------- |
 * | panel top-left | world (−3.8, 1.6); flex column, padding 0.3, gap 0.3 |
 * | title label | "four.js - ui demo", size 0.28 → 2.38 × 0.28 |
 * | button row | flex row, gap 0.3; three buttons of 1.2 × 0.6 → 4.2 × 0.6 |
 * | status label | "swatch: coral", size 0.24 |
 * | panel resolved size | 4.8 × 2.32 (intrinsic: widest child + padding) |
 * | button centres | world (−2.9, 0.42), (−1.4, 0.42), (0.1, 0.42) |
 * | swatch | 1.4 × 1.4 quad centred at world (2.6, 0.4) |
 *
 * ## §42, and why nothing here fights it
 *
 * Laid-out widgets are written by their parent's layout under the
 * `"constraint"` authority they declare at construction. The root panel is laid
 * out by nobody — the application places it — so its authority is set to
 * `"manual"`, exactly as `widget.ts` prescribes for a root. The skins position
 * only their own non-widget children, which no system claims.
 *
 * ## Text, and what it costs (§49, §56)
 *
 * Labels *measure* their text through `@four/text` (a real `@four/ui`
 * dependency); drawing it is the skin's job, and {@link labelSkin} does it with
 * **one `Text` node per label** over one shared atlas texture and one shared
 * material — three nodes and three draw calls for the whole page.
 *
 * Until 2026-08-21 this skin used the cut-a-glyph-cell-per-texture workaround
 * `examples/first-2d-scene` documented, because `Sprite` has no §55 frame
 * sub-rectangle and a glyph is a *cell* of an atlas: every distinct cell became
 * its own tiny texture and every drawn glyph its own sprite. R-28's `Text` node
 * addresses the cells with §53 per-vertex uvs instead, so that workaround — and
 * the backlog item it was the evidence for — is gone.
 */

import { Application } from "four/application";
import { planeGeometry } from "four/geometry";
import { KeyboardInput, PointerInput, type Pickable } from "four/input";
import { UnlitMaterial } from "four/materials";
import { Renderable, Texture } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import { OrthographicCamera, createFullscreenViewport } from "four/scene";
import { buildGlyphAtlas } from "four/text";
import {
  Button,
  Label,
  Panel,
  collectPickables,
  focusedWidget,
  installKeyboardTraversal,
  keyboardFocusTarget,
  type WidgetActivationSource,
  type WidgetSkin,
} from "four/ui";
import { Text } from "four";

// --- surface ---------------------------------------------------------------

/**
 * The one element matching `selector`, or a thrown error naming it.
 *
 * A helper rather than two inline null checks because both handles are read
 * from inside callbacks, and TypeScript does not carry a narrowing from a
 * module-level `if` into a closure.
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`four.js example: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 800;
const HEIGHT = 600;

/** Half-extents of the orthographic view, in world units (8 × 6 units shown). */
const VIEW_HALF_WIDTH = 4;
const VIEW_HALF_HEIGHT = 3;

// --- camera and view (§47, §48) --------------------------------------------

const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 10,
});
camera.transform.position.set(0, 0, 5);
camera.updateProjectionMatrix();

const view = createFullscreenViewport(camera);
view.clearColor = [0.051, 0.059, 0.078, 1];

// --- application (§45) ------------------------------------------------------

const renderer = new WebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });

renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);
app.scene.add(camera);

// --- palette ----------------------------------------------------------------

/** An RGBA colour in 0…1, straight (non-premultiplied) alpha (§66). */
type Rgba = readonly [number, number, number, number];

/**
 * Colour discipline: the browser gate identifies every surface below from the
 * framebuffer by nearness to these exact values (`UnlitMaterial` writes its
 * colour straight out, no tone mapping — the finding `smoothness.spec.ts`
 * records), so adjacent interaction states are kept ≥ 30 bytes apart per
 * channel and no two surfaces share a neighbourhood.
 */
const PANEL_COLOR: Rgba = [0.16, 0.18, 0.24, 1];
const BUTTON_IDLE_COLOR: Rgba = [0.24, 0.34, 0.52, 1];
const BUTTON_HOVER_COLOR: Rgba = [0.36, 0.5, 0.72, 1];
const BUTTON_PRESSED_COLOR: Rgba = [0.5, 0.65, 0.9, 1];
const FOCUS_RING_COLOR: Rgba = [0.95, 0.8, 0.3, 1];

/** Soft near-white multiplied into every glyph texel. */
const LABEL_TINT: Rgba = [0.92, 0.94, 1, 1];

/** What one button selects: a name the page publishes, a colour it renders. */
interface SwatchOption {
  readonly name: string;
  readonly color: Rgba;
}

/** The three selectable swatch colours, in button order. The first is initial. */
const SWATCH_OPTIONS: readonly SwatchOption[] = [
  { name: "coral", color: [0.92, 0.36, 0.25, 1] },
  { name: "mint", color: [0.22, 0.82, 0.5, 1] },
  { name: "azure", color: [0.28, 0.56, 0.95, 1] },
];

// --- skin z offsets ----------------------------------------------------------

/*
 * Widgets are all coplanar at z = 0 — layout writes (left, −top) and preserves
 * z — so the *visuals* separate by depth instead: each skin lifts its quads a
 * few hundredths toward the camera, panel background under focus ring under
 * button face under glyphs. Depth testing then settles overlap whatever order
 * the render list visits them in.
 */
const PANEL_QUAD_Z = 0;
const FOCUS_RING_Z = 0.006;
const BUTTON_QUAD_Z = 0.012;
const GLYPH_Z = 0.02;

/** How far the focus ring extends past the button's box on every side. */
const FOCUS_RING_MARGIN = 0.06;

// --- the font (one atlas, one texture, one material) -------------------------

// The font, packed once into one RGBA8 buffer with a uv rectangle per glyph.
const atlas = buildGlyphAtlas();

/**
 * The whole sheet as one texture, sampled with §77's `"nearest"` filter (R-30):
 * the face is a bitmap, so a linear filter would blend each texel with its
 * neighbours — including, at a cell's edge, the neighbouring *glyph*.
 */
const font = new Texture({ ...atlas, filter: "nearest" });

/**
 * One material for **every** label on the page. Shared deliberately: §57 puts a
 * label's colour on the material, and consecutive `Text` nodes over one material
 * are exactly the run §65's batcher merges — so the whole UI's text is one draw
 * call under `createGlBatching()` and one per label without it.
 *
 * `transparent: true` because the atlas carries coverage in alpha.
 */
const ink = new UnlitMaterial({
  map: font,
  transparent: true,
  color: [LABEL_TINT[0], LABEL_TINT[1], LABEL_TINT[2], LABEL_TINT[3]],
});

// --- the skins (the WidgetSkin seam) -----------------------------------------

/**
 * A flat background quad filling the widget's box — the panel's skin.
 *
 * The quad is a unit plane scaled to the measured size and centred on the box
 * (`(w/2, −h/2)` in the widget's top-left-origin, y-down local frame). It is a
 * child of the widget, so the §74 layout that places the widget places it too;
 * the skin only ever writes its own node, which no §42 system claims.
 */
function panelSkin(color: Rgba, z: number): WidgetSkin {
  let quad: Renderable | null = null;
  return {
    onAttach(widget) {
      quad = new Renderable(
        planeGeometry({ width: 1, height: 1 }),
        new UnlitMaterial({ color: [color[0], color[1], color[2], color[3]] }),
      );
      quad.name = `${widget.name}-background`;
      widget.add(quad);
    },
    onLayout(widget) {
      if (quad === null) return;
      quad.transform.position.set(
        widget.measuredWidth / 2,
        -widget.measuredHeight / 2,
        z,
      );
      quad.transform.scale.set(widget.measuredWidth, widget.measuredHeight, 1);
    },
    onDetach(widget) {
      if (quad !== null) widget.remove(quad);
      quad = null;
    },
  };
}

/**
 * A button's face and focus ring.
 *
 * `onStateChange` is the whole §72 → pixels contract: the face colour follows
 * pressed > hovered > idle, and the ring — a slightly larger quad *behind* the
 * face, so only its border shows — is visible exactly while the widget holds
 * its scene root's focus (§75).
 */
function buttonSkin(): WidgetSkin {
  let face: Renderable | null = null;
  let ring: Renderable | null = null;
  return {
    onAttach(widget) {
      ring = new Renderable(
        planeGeometry({ width: 1, height: 1 }),
        new UnlitMaterial({
          color: [
            FOCUS_RING_COLOR[0],
            FOCUS_RING_COLOR[1],
            FOCUS_RING_COLOR[2],
            FOCUS_RING_COLOR[3],
          ],
        }),
      );
      ring.name = `${widget.name}-focus-ring`;
      ring.visible = false;
      widget.add(ring);

      face = new Renderable(
        planeGeometry({ width: 1, height: 1 }),
        new UnlitMaterial({
          color: [
            BUTTON_IDLE_COLOR[0],
            BUTTON_IDLE_COLOR[1],
            BUTTON_IDLE_COLOR[2],
            BUTTON_IDLE_COLOR[3],
          ],
        }),
      );
      face.name = `${widget.name}-face`;
      widget.add(face);
    },
    onLayout(widget) {
      if (face === null || ring === null) return;
      const width = widget.measuredWidth;
      const height = widget.measuredHeight;
      face.transform.position.set(width / 2, -height / 2, BUTTON_QUAD_Z);
      face.transform.scale.set(width, height, 1);
      ring.transform.position.set(width / 2, -height / 2, FOCUS_RING_Z);
      ring.transform.scale.set(
        width + 2 * FOCUS_RING_MARGIN,
        height + 2 * FOCUS_RING_MARGIN,
        1,
      );
    },
    onStateChange(widget) {
      if (face === null || ring === null) return;
      const [red, green, blue, alpha] = widget.pressed
        ? BUTTON_PRESSED_COLOR
        : widget.hovered
          ? BUTTON_HOVER_COLOR
          : BUTTON_IDLE_COLOR;
      face.material.setColor(red, green, blue, alpha);
      ring.visible = widget.focused;
    },
    onDetach(widget) {
      if (face !== null) widget.remove(face);
      if (ring !== null) widget.remove(ring);
      face = null;
      ring = null;
    },
  };
}

/**
 * A label's glyphs — **one `Text` node per label** (§49, §56).
 *
 * `Label` measures its text (that is `@four/ui`'s half of the §56 split); this
 * skin draws it, by handing the same three numbers to a `Text` node and letting
 * it own the quads. The node sits at `(0, −textBaselineTop)` because a `Text`'s
 * origin is the first line's baseline at its left edge while the widget's origin
 * is its top-left corner — the label documents exactly this translation.
 *
 * Until 2026-08-21 this function turned every laid-out quad into its own tiny
 * textured `Sprite` over its own cut-out `Texture` — `examples/first-2d-scene`'s
 * §55 workaround, which R-28's `Text` node retired. The status label alone went
 * from 13 sprites to one node, and the page from 44 glyph draws to 3.
 *
 * The three assignments are guarded, not unconditional: `size` and
 * `letterSpacing` have no equality check of their own (`text` does), so writing
 * them on every `layout()` pass would mark the node dirty every frame and
 * rebuild vertex buffers that did not change.
 */
function labelSkin(): WidgetSkin {
  let glyphs: Text | null = null;
  return {
    onAttach(widget) {
      glyphs = new Text(atlas, ink, { renderLayer: 1 });
      glyphs.name = `${widget.name}-glyphs`;
      widget.add(glyphs);
    },
    onLayout(widget) {
      if (glyphs === null || !(widget instanceof Label)) return;
      glyphs.transform.position.set(0, -widget.textBaselineTop, GLYPH_Z);
      glyphs.text = widget.text;
      if (glyphs.size !== widget.size) glyphs.size = widget.size;
      if (glyphs.letterSpacing !== widget.letterSpacing) {
        glyphs.letterSpacing = widget.letterSpacing;
      }
    },
    onDetach(widget) {
      if (glyphs !== null) {
        widget.remove(glyphs);
        // The node owns its quad buffers; the atlas, texture and material are
        // shared and outlive it (§83).
        glyphs.dispose();
      }
      glyphs = null;
    },
  };
}

// --- the widget tree (§73, §74) ----------------------------------------------

/** Where the panel's top-left corner sits, in world units. */
const PANEL_LEFT = -3.8;
const PANEL_TOP = 1.6;

/** The §74 numbers the layout table in the header derives from. */
const PANEL_PADDING = 0.3;
const PANEL_GAP = 0.3;
const BUTTON_WIDTH = 1.2;
const BUTTON_HEIGHT = 0.6;
const TITLE_TEXT_SIZE = 0.28;
const STATUS_TEXT_SIZE = 0.24;
const BUTTON_TEXT_SIZE = 0.22;

// The root container. `interactive: false` keeps it (and the row below) out of
// the §71 candidate list, so a click inside a button cannot tie with a
// coplanar ancestor — `collectPickables` documents that tie and this is its
// recommended resolution for containers that do not need pointer state.
const uiRoot = new Panel({
  name: "panel",
  interactive: false,
  layout: {
    type: "flex",
    direction: "column",
    gap: PANEL_GAP,
    padding: PANEL_PADDING,
  },
});
// §42: the application places the root; every descendant stays under the
// `"constraint"` authority its parent's layout writes with.
uiRoot.transformAuthority = "manual";
uiRoot.transform.position.set(PANEL_LEFT, PANEL_TOP, 0);

const title = new Label({
  name: "title",
  text: "four.js - ui demo",
  atlas,
  size: TITLE_TEXT_SIZE,
});

const buttonRow = new Panel({
  name: "buttons",
  interactive: false,
  layout: { type: "flex", direction: "row", gap: PANEL_GAP },
});

const statusLabel = new Label({
  name: "status",
  text: `swatch: ${SWATCH_OPTIONS[0].name}`,
  atlas,
  size: STATUS_TEXT_SIZE,
});

uiRoot.add(title);
uiRoot.add(buttonRow);
uiRoot.add(statusLabel);

// --- the swatch — what activation visibly changes ----------------------------

/** Side length of the swatch quad, world units. */
const SWATCH_SIZE = 1.4;

/** Where the swatch quad is centred, in world units — clear of the panel. */
const SWATCH_CENTER_X = 2.6;
const SWATCH_CENTER_Y = 0.4;

const swatchMaterial = new UnlitMaterial({
  color: [
    SWATCH_OPTIONS[0].color[0],
    SWATCH_OPTIONS[0].color[1],
    SWATCH_OPTIONS[0].color[2],
    SWATCH_OPTIONS[0].color[3],
  ],
});
const swatch = new Renderable(
  planeGeometry({ width: SWATCH_SIZE, height: SWATCH_SIZE }),
  swatchMaterial,
);
swatch.name = "swatch";
swatch.transform.position.set(SWATCH_CENTER_X, SWATCH_CENTER_Y, 0);
app.scene.add(swatch);

// --- application state, and the buttons that change it -----------------------

/** The selected option's name; mirrored onto `#status`. */
let selectedName = SWATCH_OPTIONS[0].name;

/** Activations since the page loaded — pointer and programmatic alike. */
let activationCount = 0;

/** What caused the most recent activation; `"none"` before the first. */
let lastSource: WidgetActivationSource | "none" = "none";

/**
 * Applies one option: recolours the swatch, rewrites the status label, and
 * re-lays the panel out (layout is explicit — §74's one-pass contract — and a
 * changed text is a changed intrinsic size).
 */
function selectSwatch(
  option: SwatchOption,
  source: WidgetActivationSource,
): void {
  const [red, green, blue, alpha] = option.color;
  swatchMaterial.setColor(red, green, blue, alpha);
  selectedName = option.name;
  activationCount += 1;
  lastSource = source;
  statusLabel.text = `swatch: ${option.name}`;
  uiRoot.layout();
}

/**
 * The three buttons, in `SWATCH_OPTIONS` order — kept only so the page can
 * report which one is hovered. Tab walks the *widget tree*, not this array:
 * `installKeyboardTraversal` collects the focus order from the scene itself,
 * ascending `accessibility.tabIndex` (0, 1, 2 below, which agrees with the
 * scene order) and ties broken by scene order.
 */
const buttons: Button[] = SWATCH_OPTIONS.map((option, index) => {
  const button = new Button({
    name: option.name,
    width: BUTTON_WIDTH,
    height: BUTTON_HEIGHT,
    layout: {
      type: "flex",
      direction: "row",
      justify: "center",
      align: "center",
    },
    accessibility: {
      role: "button",
      label: `Select ${option.name}`,
      tabIndex: index,
    },
  });
  const caption = new Label({
    name: `${option.name}-caption`,
    text: option.name,
    atlas,
    size: BUTTON_TEXT_SIZE,
  });
  button.add(caption);
  buttonRow.add(button);

  // One event, whatever the source: a §72 click synthesized by the pointer
  // source, or an Enter/Space the button read off §72's key events.
  button.on("uiactivate", (event) => {
    selectSwatch(option, event.source);
  });

  button.skin = buttonSkin();
  caption.skin = labelSkin();
  return button;
});

uiRoot.skin = panelSkin(PANEL_COLOR, PANEL_QUAD_Z);
title.skin = labelSkin();
statusLabel.skin = labelSkin();

app.scene.add(uiRoot);
uiRoot.layout();

// --- picking and pointer events (§71, §72) -----------------------------------

/** Candidate scratch — `collectPickables` overwrites it per query, zero-alloc. */
const pickables: Pickable[] = [];

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally. The
// pointer source lives exactly as long as the page does, so it is never
// disposed here (§83) — the same ownership note `first-2d-scene` carries.
new PointerInput(canvas, {
  camera,
  pickables: () => collectPickables(uiRoot, pickables),
});

// --- keyboard (§72 source, §75 navigation) -----------------------------------

/*
 * Two lines, and the application decides nothing about keys.
 *
 * `window` satisfies `KeySurface` structurally (the same duck-typing that lets
 * the canvas satisfy `PointerSurface`), and it rather than the canvas is the
 * surface because a DOM element receives key events only while it holds the
 * DOM's focus — and this scene's focus model is §75's, not the DOM's.
 *
 * `keyboardFocusTarget(uiRoot)` is the seam `@four/input` needs and may not
 * import: it answers the focused widget, or the UI root when nothing is
 * focused yet, so the very first Tab is deliverable. `installKeyboardTraversal`
 * then owns Tab and Shift-Tab, and each `Button` owns its own Enter and Space
 * — so a `uiactivate` from the keyboard arrives at the listener registered
 * above with `source: "keyboard"`, on the same path a click takes.
 *
 * Both live exactly as long as the page does, so neither is disposed here
 * (§83) — the ownership note `first-2d-scene` carries.
 */
new KeyboardInput(window, { focusTarget: keyboardFocusTarget(uiRoot) });
installKeyboardTraversal(uiRoot);

// --- what the page publishes -------------------------------------------------

/** Frames rendered since the loop started; mirrored onto `#status`. */
let frameCount = 0;

/**
 * Mirrors the live UI state onto `#status`, so the browser gate can read the
 * engine's own account instead of inferring everything from pixels.
 *
 * Called from `update` — once per host frame — because these are values a
 * frame observes; the framebuffer assertions in `tests/browser/ui.spec.ts`
 * cover the half that only pixels can prove.
 */
function publish(): void {
  const data = status.dataset;
  data["state"] = "running";
  data["frames"] = String(frameCount);
  data["swatch"] = selectedName;
  data["clicks"] = String(activationCount);
  data["source"] = lastSource;
  data["label"] = statusLabel.text;
  data["focused"] = focusedWidget(app.scene)?.name ?? "none";
  data["hover"] = buttons.find((button) => button.hovered)?.name ?? "none";
  status.textContent =
    `swatch: ${selectedName} — ${String(activationCount)} activations — ` +
    `click a button, or Tab + Enter`;
}

app.on("update", () => {
  frameCount += 1;
  publish();
});

// --- the frame loop ----------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * The rAF timestamp is a *presentation-side* clock, which is the one place a
 * wall clock is allowed: it is converted to seconds before it crosses into the
 * engine (§7a). Seeded from the FIRST rAF timestamp rather than a `now()`
 * taken earlier — a negative first delta would make `app.step` throw and kill
 * the loop (the bug WP-3.7-fix1 fixed).
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
  }
  last = now;
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  await app.initialize();
  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.dataset["state"] = "error";
  status.textContent = "failed to start — see the console";
  console.error("four.js example: failed to start.", error);
});
