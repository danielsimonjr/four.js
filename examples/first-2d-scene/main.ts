/**
 * four.js — first 2D scene, and the interaction demo of §106a.
 *
 * The smallest program that shows three of the four pillars cooperating over
 * one scene graph:
 *
 * - **Scene** — every object below is a node in a single graph: the camera, the
 *   ground, the circle, the box, and the letters of the label. There is no
 *   separate "2D layer": the circle is a flat XY shape and the box is a solid,
 *   and they share the same right-handed, Y-up world (§7a).
 * - **Render** — one `WebglRenderer` draws that graph through one viewport
 *   (§48, §62). Nothing in the scene names WebGL; swapping the backend is a
 *   one-line change at this file's top.
 * - **Motion** — the circle follows a prescribed path (`KinematicController` +
 *   a §13 trajectory) while the box integrates an angular velocity
 *   (`MotionComponent`). Both are *components* attached to ordinary nodes
 *   (§6a), advanced by systems registered on the application (§39).
 *
 * The fourth pillar, **Physics**, arrives in Phase 5 — and will attach to these
 * same nodes as one more component, under one more transform authority (§42).
 *
 * ## What you can do to it (§71, §72, §55, §56)
 *
 * - **Click** the circle or the box: each cycles its material colour through a
 *   small palette. The click is picked with a camera ray against the node's own
 *   bounds and delivered as a scene event that propagates through the graph.
 * - **Drag** the box: the pointer's motion is converted to a world-space
 *   displacement and applied to the node's position — under an authority
 *   handover the drag performs explicitly (see "Dragging and §42" below).
 * - The **label** above the scene is real geometry, not DOM: a bitmap glyph
 *   atlas, laid out into quads, drawn as textured sprites in the same graph as
 *   everything else.
 *
 * ## Fixed-step simulation, variable-rate rendering (§10, §43)
 *
 * The loop at the bottom feeds real elapsed seconds to `app.step(...)`. Inside,
 * simulation advances in fixed 1/60 s steps regardless of how fast the display
 * refreshes, and the frame is drawn from *interpolated* poses — which is why
 * `app.poses.track(...)` is called for the two moving nodes. On a 144 Hz screen
 * that is what keeps the motion smooth instead of showing each simulation step
 * two or three times.
 *
 * ## Dragging and §42, in full
 *
 * §42 gives exactly one system authority over a node's transform. The box is
 * normally `"kinematic"`: the `MotionSystem` integrates its angular velocity and
 * owns its transform. A drag wants to write that same transform from the
 * application, which is `"manual"` authority — so the drag *hands ownership
 * over* rather than writing behind the owner's back:
 *
 * ```text
 * dragStart:  motionSystem.untrack(box);  box.transformAuthority = "manual"
 * drag:       box.transform.position.set(… + worldDelta …) ← application writes
 * dragEnd:    box.transformAuthority = "kinematic";  motionSystem.track(box)
 * ```
 *
 * So the box stops tumbling while it is dragged and resumes when it is dropped,
 * and at no instant do two systems claim it. Setting the authority alone would
 * be enough for §42's *enforcement* — `MotionSystem` would refuse the write and
 * warn once (`warnAuthorityConflict`) — but leaving it tracked would mean asking
 * a system every step to do something it is not allowed to do. Untracking says
 * the same thing without the warning, which is what a handover actually is
 * (decision, WP-3a.5).
 *
 * ## What the label costs today (§55 limitation, feeds the §55 frame backlog)
 *
 * `Sprite` derives its texture coordinates from the quad's own bounds — the
 * whole texture is mapped across the whole sprite — and neither `Sprite` nor
 * `SpriteMaterial` carries §55's `frame` sub-rectangle yet. A glyph is a *cell*
 * of an atlas, so there is currently **no way to point a sprite at one cell of
 * one texture**. This example therefore cuts each distinct glyph cell out of the
 * atlas into its own small `Texture` (6 × 12 texels, 288 bytes) and caches it per
 * cell, so a 37-character label costs ~20 tiny textures and one sprite per drawn
 * glyph instead of one texture and one batched draw. It is correct and it is
 * visibly text; it is not how text should be drawn. The fix is §55's frame
 * region (a uv sub-rect on the item or the material) plus §65 batching, and this
 * paragraph is the evidence for why that backlog item exists.
 */

import { Application } from "four/application";
import { boxGeometry, circleGeometry2D, planeGeometry } from "four/geometry";
import { DragManager, PointerInput, type Pickable } from "four/input";
import { SpriteMaterial, UnlitMaterial } from "four/materials";
import { Vector3 } from "four/math";
import {
  CircularTrajectory,
  KinematicController,
  KinematicSystem,
  MotionComponent,
  MotionSystem,
} from "four/motion";
import { Renderable, Sprite, Texture } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import {
  Group,
  OrthographicCamera,
  createFullscreenViewport,
} from "four/scene";
import {
  buildGlyphAtlas,
  layoutText,
  type GlyphAtlas,
  type TextQuad,
} from "four/text";

// --- surface ---------------------------------------------------------------

const canvas = document.querySelector<HTMLCanvasElement>("#scene");
if (canvas === null) {
  throw new Error('four.js example: no <canvas id="scene"> in the document.');
}

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 800;
const HEIGHT = 600;

// --- camera and view (§47, §48) --------------------------------------------

// An orthographic camera showing 8 × 6 world units — the same 4:3 shape as the
// canvas, so nothing is stretched. +Y is up here exactly as it is in 3D (§7a).
const camera = new OrthographicCamera({
  left: -4,
  right: 4,
  bottom: -3,
  top: 3,
  near: 0.1,
  far: 10,
});
// A camera is a node, so it is placed with its transform. `Vector3.set` is a
// mutator and announces itself, so no `markDirty()` is needed (§7b).
camera.transform.position.set(0, 0, 5);
// Nothing recomputes implicitly: after changing projection parameters, say so.
camera.updateProjectionMatrix();

// One viewport covering the whole canvas, cleared to a dark background. A
// second entry in `app.views` would be split-screen or a minimap (§48).
const view = createFullscreenViewport(camera);
view.clearColor = [0.05, 0.06, 0.09, 1];

// --- application (§45) ------------------------------------------------------

// The backend is constructed here and handed over: the application drives it,
// but the code that created it owns it (§83).
const renderer = new WebglRenderer();
const app = new Application({ renderer, canvas, views: [view] });

// Draw at the display's true pixel density; the CSS size stays 800 × 600.
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);

app.scene.add(camera);

// --- the scene --------------------------------------------------------------

// (1) A static plane, one unit behind the movers — a ground reference, and the
// proof that depth still works in a "2D" scene: the orbiting circle passes in
// front of it.
const ground = new Renderable(
  planeGeometry({ width: 7.6, height: 1.2 }),
  new UnlitMaterial({ color: [0.1, 0.13, 0.19, 1] }),
);
ground.name = "ground";
ground.transform.position.set(0, -2.35, -1);
app.scene.add(ground);

// (2) An orbiting circle — a 2D shape driven by a *prescribed* path (§12, §13).
// The trajectory states where the node is as a function of time; the
// `KinematicSystem` evaluates it once per fixed step and writes the position.
const orbiter = new Renderable(
  circleGeometry2D({ radius: 0.45, segments: 48 }),
  new UnlitMaterial({ color: [1, 0.45, 0.2, 1] }),
);
orbiter.name = "orbiter";
// §42: exactly one system may write a node's transform, and it must say so.
orbiter.transformAuthority = "kinematic";
const orbit = orbiter.addComponent(new KinematicController());
orbit.followPath(
  new CircularTrajectory({
    center: new Vector3(0, 0, 0),
    radius: 2,
    // Radians per second (§7a: radians and seconds everywhere) — a quarter
    // turn per second, so one lap takes four seconds.
    angularVelocity: Math.PI / 2,
  }),
  { loop: true },
);
app.scene.add(orbiter);

// (3) A tumbling box — a 3D solid in the same graph, moved by *derived* motion
// (§11): a `MotionComponent` holds an angular velocity, and the `MotionSystem`
// integrates it into the node's rotation each fixed step. Two non-zero axes so
// the tumble reads as a tumble rather than a spin.
const tumbler = new Renderable(
  boxGeometry({ width: 0.9, height: 0.9, depth: 0.9 }),
  new UnlitMaterial({ color: [0.25, 0.7, 1, 1] }),
);
tumbler.name = "tumbler";
tumbler.transform.position.set(-2.7, 1.8, 0);
tumbler.transformAuthority = "kinematic";
tumbler.addComponent(
  new MotionComponent({ angularVelocity: new Vector3(0.7, 1.1, 0) }),
);
app.scene.add(tumbler);

// --- systems (§39) ----------------------------------------------------------

// Systems do the per-fixed-step work; components are just the state they read.
// Registration order does not matter — the registry runs them by priority.
const motionSystem = new MotionSystem();
const kinematicSystem = new KinematicSystem();
app.systems.register(motionSystem);
app.systems.register(kinematicSystem);

motionSystem.track(tumbler);
kinematicSystem.track(orbiter);

// Interpolate the two movers between simulation states when drawing (§43).
// The ground never moves, so it is left untracked and simply draws from its
// live transform.
app.poses.track(orbiter);
app.poses.track(tumbler);

// --- picking and pointer events (§71, §72) ----------------------------------

// The candidate list picking tests against. `@four/input` never reads geometry
// — it may not depend on `@four/render` or `@four/geometry` — so the layer that
// *does* see geometry states each node's box, in that node's own **local**
// space, which is exactly what `computeBounds()` returns. The ray is
// transformed into local space per candidate, so the box is tested oriented
// (the tumbling box is picked as a tumbling box, not as its inflated
// world-space extent).
//
// The list is built once because the *set* of pickable nodes never changes
// here; nothing has to be rebuilt when they move, and the bounds vectors are
// live views onto geometries this example never edits.
const pickables: readonly Pickable[] = [orbiter, tumbler].map((node) => {
  const bounds = node.geometry.computeBounds();
  return { node, boundsMin: bounds.min, boundsMax: bounds.max };
});

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally — the
// three members `PointerInput` touches (`addEventListener`,
// `removeEventListener`, `getBoundingClientRect`) are all on it — so no adapter
// and no cast is needed. Platform pixels become normalized device coordinates
// through the canvas rectangle, including the Y flip that turns the platform's
// downward Y into §7a's upward Y.
const pointerInput = new PointerInput(canvas, {
  camera,
  pickables: () => pickables,
});

/** An RGBA colour in 0…1, straight (non-premultiplied) alpha (§66). */
type Palette = readonly (readonly [number, number, number, number])[];

/**
 * Colours the orbiter cycles through, starting at the one it was built with.
 *
 * All four are *warm* — a bright red channel well clear of the blue one —
 * because the browser gate identifies the orbiter by exactly that signature
 * (`tests/browser/smoothness.spec.ts`) in order to recover its world position
 * from a screenshot. Keeping the whole palette inside that gamut means a click
 * changes what the demo looks like without changing what the gate can measure
 * (decision, WP-3a.5).
 */
const ORBITER_COLORS: Palette = [
  [1, 0.45, 0.2, 1],
  [1, 0.72, 0.15, 1],
  [0.95, 0.25, 0.15, 1],
  [1, 0.55, 0.35, 1],
];

/**
 * Colours the tumbler cycles through — all *cool*, and for the mirror-image
 * reason: none of them may be mistaken for the orbiter by that same detector.
 */
const TUMBLER_COLORS: Palette = [
  [0.25, 0.7, 1, 1],
  [0.35, 0.85, 0.55, 1],
  [0.55, 0.45, 0.95, 1],
  [0.85, 0.85, 0.9, 1],
];

/**
 * Advances `node`'s colour one step through `palette` on every click.
 *
 * `click` is synthesized by the pointer source, not by the platform: a press
 * and a release on the same node with no drag in between (§72). So dragging the
 * box does *not* recolour it, which is the behaviour a user expects and the
 * reason the two interactions can share one node at all.
 *
 * The listener is registered with the node's own event API — `Node` extends
 * §6b's typed `EventEmitter`, and `@four/input` widens its event map, so there
 * is one `on` for hierarchy events and pointer events alike.
 */
function recolorOnClick(node: Renderable, palette: Palette): void {
  let index = 0;
  node.on("click", () => {
    index = (index + 1) % palette.length;
    const [red, green, blue, alpha] = palette[index];
    node.material.setColor(red, green, blue, alpha);
  });
}

recolorOnClick(orbiter, ORBITER_COLORS);
recolorOnClick(tumbler, TUMBLER_COLORS);

// --- dragging, and the §42 handover -----------------------------------------

/** Keeps a dragged node inside the camera's view, in world units. */
const DRAG_LIMIT_X = 3.4;
const DRAG_LIMIT_Y = 2.2;

// `DragManager` computes the one thing only it can compute — the world-space
// displacement matching the pointer's motion, exact under this orthographic
// camera — and hands it to the application. It never writes a transform: input
// has no §42 authority, and what a drag *means* (move it, push it, refuse it)
// is the application's decision. See this file's header for the handover.
const drags = new DragManager({
  pointerInput,
  onDragStart: (node) => {
    // The previous owner stops being asked to write, and the application takes
    // the transform. The box's angular velocity is untouched, so the tumble
    // resumes from where it paused.
    motionSystem.untrack(node);
    node.transformAuthority = "manual";
  },
  onDrag: (node, worldDelta) => {
    const position = node.transform.position;
    // One clamped write rather than `add` + a correction: `Vector3.set`
    // announces the change once, which is what advances `Transform.version`
    // (§7) and what the §43 pose capture reads on the next fixed step.
    position.set(
      Math.min(
        DRAG_LIMIT_X,
        Math.max(-DRAG_LIMIT_X, position.x + worldDelta.x),
      ),
      Math.min(
        DRAG_LIMIT_Y,
        Math.max(-DRAG_LIMIT_Y, position.y + worldDelta.y),
      ),
      position.z,
    );
  },
  onDragEnd: (node) => {
    node.transformAuthority = "kinematic";
    motionSystem.track(node);
  },
});
drags.makeDraggable(tumbler);

// Neither the pointer source nor the drag manager is disposed here: both live
// exactly as long as the page does, and §83 puts disposal on whoever created a
// resource *when it is finished with it*. A widget that comes and goes calls
// `pointerInput.dispose()` / `drags.dispose()`; a demo that ends with the tab
// does not.

// --- the label (§55, §56) ---------------------------------------------------

/** World units per line of text — `layoutText`'s `size`, not an em size. */
const LABEL_SIZE = 0.26;

/** Height of the label's baseline above the world origin, in world units. */
const LABEL_BASELINE_Y = 2.65;

/**
 * Tint multiplied into every glyph texel: a soft near-white, cool rather than
 * warm for the reason {@link ORBITER_COLORS} gives — text must never be
 * mistaken for the orbiter by the browser gate's colour classifier.
 */
const LABEL_TINT: readonly [number, number, number, number] = [
  0.88, 0.92, 1, 1,
];

/**
 * The label. ASCII only: the built-in 6 × 12 face covers U+0020…U+007E, and
 * anything else — an em dash, say — would draw the missing-glyph box.
 */
const LABEL_TEXT = "four.js - click a shape, drag the box";

// The font, packed once into one RGBA8 buffer with a uv rectangle per glyph.
// White everywhere, alpha as coverage, so a filtered edge fades to transparent
// instead of to soot.
const atlas = buildGlyphAtlas();

// Pure arithmetic: where each glyph's rectangle goes (origin = the first line's
// baseline at its left edge, +Y up) and which part of the atlas it samples.
const layout = layoutText(LABEL_TEXT, atlas, { size: LABEL_SIZE });

/**
 * Sprite materials already built for a glyph cell, keyed by that cell's atlas
 * rectangle — so the two `o`s of "box" share one texture and one material.
 */
const glyphMaterials = new Map<string, SpriteMaterial>();

/**
 * Copies one glyph cell out of `atlas` into a standalone RGBA8 texture source.
 *
 * This is the workaround the file header describes: a `Sprite` maps its whole
 * texture across its whole quad, so pointing one at a *cell* of the atlas is
 * impossible until §55's frame region lands. Cutting the cell out gives the
 * sprite a texture whose 0…1 range **is** the glyph.
 *
 * The rectangle is recovered from the quad's uv, which the atlas produced as
 * exact texel ratios, so the rounding below is exact rather than approximate.
 * Row order is preserved: both the atlas and `TextureSource` put row 0 at
 * `v = 0`, the bottom (§7a).
 */
function cutGlyphCell(source: GlyphAtlas, quad: TextQuad): Texture {
  const x = Math.round(quad.u0 * source.width);
  const y = Math.round(quad.v0 * source.height);
  const width = Math.round((quad.u1 - quad.u0) * source.width);
  const height = Math.round((quad.v1 - quad.v0) * source.height);

  const data = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * source.width + x) * 4;
    data.set(source.data.subarray(from, from + width * 4), row * width * 4);
  }
  return new Texture({ width, height, data });
}

/** The material for one glyph cell, built on first use and cached. */
function materialForCell(quad: TextQuad): SpriteMaterial {
  const key = `${String(quad.u0)},${String(quad.v0)}`;
  const cached = glyphMaterials.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const material = new SpriteMaterial({
    texture: cutGlyphCell(atlas, quad),
    tint: [LABEL_TINT[0], LABEL_TINT[1], LABEL_TINT[2], LABEL_TINT[3]],
  });
  glyphMaterials.set(key, material);
  return material;
}

// One node holding the whole label, placed so the text is centred over the
// scene: children keep the layout's own coordinates and inherit the group's
// transform, so moving the label is one write (§7).
const label = new Group();
label.name = "label";
label.transform.position.set(0 - layout.width / 2, LABEL_BASELINE_Y, 0);

for (const quad of layout.quads) {
  // `renderLayer: 1` draws the glyphs after the opaque shapes — sprites blend,
  // and blending needs what is behind it already in the framebuffer (§66).
  const glyph = new Sprite(materialForCell(quad), {
    width: quad.x1 - quad.x0,
    height: quad.y1 - quad.y0,
    anchor: { x: 0, y: 0 },
    renderLayer: 1,
  });
  glyph.transform.position.set(quad.x0, quad.y0, 0);
  label.add(glyph);
}
app.scene.add(label);

// --- the frame loop ---------------------------------------------------------

/**
 * Drives the application from `requestAnimationFrame`.
 *
 * `performance.now()`/the rAF timestamp is a *presentation-side* clock, which
 * is the one place a wall clock is allowed: it measures how long the display
 * took, and is converted to seconds before it crosses into the engine (§7a).
 * Simulation itself never sees it — inside `app.step` the fixed-step
 * accumulator hands every system the same injected `fixedDeltaTime` (§10, §33).
 */
// Seeded from the FIRST rAF timestamp, not performance.now(): rAF hands the
// frame-start time, which can precede a now() taken moments earlier — a
// negative first delta would make app.step throw and kill the loop
// (WP-3.7-fix1, caught by the WP-3.8 browser gate).
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    app.step((now - last) / 1000);
  }
  last = now;
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  // Acquires the WebGL 2 context. A failure here rejects rather than leaving a
  // half-started application (§45).
  await app.initialize();
  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  console.error("four.js example: failed to start.", error);
});
