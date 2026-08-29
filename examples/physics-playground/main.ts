/**
 * four.js — the physics playground, and the §108 demonstration.
 *
 * §108 asks for one thing and this file is that thing:
 *
 * > a mixed 2D/3D demo in which gravity, collisions, impulses and sensors all
 * > go through **one** common API.
 *
 * So there is **one** `Application`, **one** canvas, **one** `WebglRenderer`,
 * **one** `PhysicsSystem` — and **two** `PhysicsWorld`s, a `"2d"` one on the
 * left and a `"3d"` one on the right, each driving its own Rapier adapter. The
 * two halves are built by the *same* function ({@link buildHalf}, over
 * {@link addBody}); everything that differs between a plane simulation and a
 * volume simulation is confined to the two {@link HalfKit} records, which name
 * a solver, a §24 shape and a geometry per dimension and nothing else. If the
 * §20 promise — "users should not need to write solver-specific application
 * code" — were false, the difference would show up as branching in the scene
 * code, and there is none.
 *
 * ## What you see (§108's four verbs)
 *
 * | verb           | where it is                                              |
 * | -------------- | -------------------------------------------------------- |
 * | **gravity**    | every dynamic body starts in the air and falls at −9.81 m/s² on **Y**, in *both* dimensions (§7a) |
 * | **collisions** | the bodies land on a static floor, stack, and settle (and then §32-sleep) |
 * | **impulses**   | **click a body** — the pointer's world-space hit point becomes an off-centre `applyImpulseAtPoint`, so a poke both launches and spins it (§26) |
 * | **sensors**    | the coloured slab at the bottom of each half is a §24 *sensor*: it exerts no force, and its collider's `triggerenter`/`triggerexit` (§29) flip its colour while a body is inside it — repainted from the step-8 tally below |
 *
 * ## Step-8 sensor bookkeeping, consumed at step 9 (§39, PH-21)
 *
 * Since PH-21 the §39 order is genuinely *configurable* around the solve: this
 * page runs `PhysicsSystem` with `dispatchEvents: false` and moves dispatch to
 * a `PhysicsEventSystem` at `PRIORITY_EVENT_DISPATCH` (900) — which is what
 * makes `PRIORITY_SENSOR_UPDATE` (800) a real slot *between* the solve and the
 * listeners. {@link ZoneTallySystem} occupies it, and the arrangement is the
 * worked example of §39's steps 8 and 9:
 *
 * ```text
 * 600  PhysicsSystem        both worlds step; §29 events are queued, not fired
 * 800  ZoneTallySystem      overlapBox over each zone's volume (§30) → tally
 * 900  PhysicsEventSystem   the queued trigger events fire; the listeners
 *                           REPAINT FROM THE TALLY the step-8 system recorded
 * ```
 *
 * Why bookkeep at 800 when §29 already delivers enter/exit at 900? Because the
 * two answer differently-shaped questions. The event counter is a **delta
 * accumulation** — `+1` on enter, `−1` on exit — which is why {@link watchZone}
 * has always had to clamp it at zero: one missed event and the count is wrong
 * for ever. The step-8 tally is an **absolute re-measure**: every fixed step it
 * asks the §30 query "how many dynamic colliders overlap this volume *right
 * now*?", against exactly the post-solve geometry the step-9 listeners are
 * about to observe. The listeners then *consume* the tally — the repaint colour
 * is `tally > 0` — so the picture is driven by measured state and the events
 * carry what they are good at: the moments of change. Both counts are mirrored
 * onto `#status` (`data-zone*` for the event counter, `data-tally*` for the
 * query), so the browser gate can hold them against each other.
 *
 * ## Two worlds, one coordinate system (a deliberate simplification)
 *
 * A `PhysicsWorld`'s coordinates are the coordinates of the node transforms it
 * reads and writes, so the halves are separated by *placing each world's
 * geometry* where it should appear — the 2D world's floor is genuinely at
 * x = −4 in its own solver, the 3D world's at x = +4 in its own. No stage
 * groups, no offsets: every body node is a child of the scene root, so its
 * local transform is its world transform and a solver-space point and a
 * scene-space point are the same point. That is what lets the click handler
 * hand a picked world point straight to `applyImpulseAtPoint` without a frame
 * conversion (decision, WP-5.7).
 *
 * Nothing is shared between the two worlds — separate adapters, separate wasm
 * images, separate §33 checksums. They are adjacent, not connected.
 *
 * ## Fixed step, interpolated frame (§10, §43)
 *
 * The loop at the bottom feeds real elapsed **seconds** to `app.step(...)`;
 * inside, both worlds advance in fixed 1/60 s steps in registration order and
 * their §29 events are dispatched at §39 step 9 — through the split systems
 * described above, with the sensor tally taken between the two. The frame is drawn
 * from §43-interpolated poses: each world is handed `app.poses`, so it tracks
 * the node of every **dynamic** body it registers and the application's
 * step-10 snapshot system captures them. Physics never sees the wall clock —
 * the rAF timestamp is converted to seconds at the loop boundary and no
 * further (§33).
 *
 * ## Mass is derived, never authored (§23, §25)
 *
 * Not one body below names a mass. Each collider carries a density (the
 * package default, 1) and the solver derives mass from density × area (2D) or
 * density × volume (3D); `PhysicsWorld.addBody` then reads it back onto the
 * component, which is why {@link poke} can size an impulse as `mass × Δv` and
 * get the same launch speed out of a 0.06 kg pebble and a 0.44 kg crate. That
 * path only became reachable through the component API in WP-5.2-fix1, and
 * this example is its first non-test consumer.
 *
 * ## Known visual approximations
 *
 * - **The 3D sphere is drawn as a disc.** `@four/geometry` ships
 *   `boxGeometry`, `planeGeometry` and `circleGeometry2D` and no sphere
 *   primitive yet, so the sphere *body* (a real §24 `sphere` collider) is drawn
 *   with a 40-segment circle. Under this orthographic camera a shaded sphere's
 *   silhouette would be that circle anyway, and the material is unlit, so the
 *   only thing lost is the shading that does not exist yet.
 * - **No transparency.** This renderer tier enables `GL_BLEND` for sprites
 *   only, so the sensor zones are not translucent overlays but opaque quads
 *   half a unit *behind* the bodies (z = −0.5), distinguished by hue alone
 *   (finding, WP-4.7 — restated here because it shapes the whole palette).
 * - **One orthographic camera for both halves.** A perspective camera would
 *   flatter the 3D half and distort the 2D one, and an affine world→pixel
 *   mapping is what makes the browser gate's pixel arithmetic exact: at 60
 *   pixels per world unit, `px = (x + 8) × 60`, `py = (4.5 − y) × 60`.
 */

import { Application } from "four/application";
import {
  boxGeometry,
  circleGeometry2D,
  planeGeometry,
  type BufferGeometry,
} from "four/geometry";
import { PointerInput, type Pickable } from "four/input";
import { UnlitMaterial } from "four/materials";
import { Vector2, Vector3 } from "four/math";
import { PRIORITY_SENSOR_UPDATE, type SimulationSystem } from "four/motion";
import {
  Collider,
  PhysicsEventSystem,
  PhysicsSystem,
  PhysicsWorld,
  RigidBody,
  type CollisionShape,
  type PhysicsDimension,
  type PhysicsWorldAdapter,
} from "four/physics";
import { Rapier2dAdapter, Rapier3dAdapter } from "four/physics-rapier";
import { Renderable } from "four/render";
import { WebglRenderer } from "four/render-webgl";
import {
  Group,
  OrthographicCamera,
  createFullscreenViewport,
} from "four/scene";

// --- surface -----------------------------------------------------------------

/**
 * Resolves one required element of the page.
 *
 * A function rather than `first-2d-scene`'s `const el = query(…); if (el ===
 * null) throw` because this file touches the status element from inside hoisted
 * function declarations, and TypeScript does not carry a module-level narrowing
 * into one of those — the guard would have to be repeated at every use.
 * Returning a non-nullable type states it once.
 */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`four.js playground: no ${selector} in the document.`);
  }
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#scene");

/** The one line of page chrome: the loading state, then the instructions. */
const status = requireElement<HTMLParagraphElement>("#status");

/** Layout size in CSS pixels; the drawing buffer is this times the DPR. */
const WIDTH = 960;
const HEIGHT = 540;

// --- the world's dimensions, in world units ----------------------------------

/** Half-width of the camera's view. The 2D half is x < 0, the 3D half x > 0. */
const VIEW_HALF_WIDTH = 8;

/** Half-height of the camera's view. 16 × 9 units over a 16:9 canvas. */
const VIEW_HALF_HEIGHT = 4.5;

/** Centre of each half, `∓HALF_CENTER_X`. Everything below is relative to it. */
const HALF_CENTER_X = 4;

/**
 * Half-extents of the static floor slab, and its centre's Y. Its **top
 * surface** — where a settled body's underside ends up — is therefore at
 * y = −3, which is the datum every settling number in this file is measured
 * from.
 */
const FLOOR_HALF_WIDTH = 3.4;
const FLOOR_HALF_HEIGHT = 0.25;
const FLOOR_CENTER_Y = -3.25;

/** The side walls that keep a rolling ball inside the frame. */
const WALL_HALF_WIDTH = 0.25;
const WALL_HALF_HEIGHT = 2;
const WALL_OFFSET_X = FLOOR_HALF_WIDTH - WALL_HALF_WIDTH;
const WALL_CENTER_Y = -1;

/**
 * The §24 sensor zone: a slab straddling the settling area, 0.1 above the floor
 * so that it never touches the floor collider and the only intersections it can
 * report come from dynamic bodies.
 */
const ZONE_HALF_WIDTH = 1.2;
const ZONE_HALF_HEIGHT = 0.65;
const ZONE_CENTER_Y = -2.25;

/** How far behind the bodies the zone is drawn — see "No transparency" above. */
const ZONE_Z = -0.5;

/** Half-depth given to every 3D static body; the 2D kit ignores it (§21). */
const STATIC_HALF_DEPTH = 3.4;

// --- palette (§66: no blending in this tier, so hue is the only channel) ------

/** Straight (non-premultiplied) RGBA in 0…1 (§60a, §66). */
type Color = readonly [number, number, number, number];

/** Floors and walls: dark and inert, so the movers own the eye. */
const STATIC_COLOR: Color = [0.16, 0.18, 0.24, 1];

/** The hairline between the two halves — scenery, not a body. */
const DIVIDER_COLOR: Color = [0.22, 0.24, 0.3, 1];

/** A sensor zone with nothing inside it. */
const ZONE_EMPTY_COLOR: Color = [0.16, 0.14, 0.34, 1];

/**
 * A sensor zone with at least one collider inside it.
 *
 * Far from {@link ZONE_EMPTY_COLOR} in every channel (Δ = 0.06/0.38/0.11 →
 * roughly 15/97/28 of 255) so that "the zone reacted" is a threshold a
 * screenshot can carry, not a subtlety.
 */
const ZONE_OCCUPIED_COLOR: Color = [0.1, 0.52, 0.45, 1];

/**
 * The 2D half's bodies: warm hues, red clearly above blue.
 *
 * The two palettes are disjoint in exactly that way — every 2D body has
 * `red > blue + 0.2` and every 3D body has `blue > red` — so a frame can be
 * attributed to a half by hue alone, which is what the Phase 5 browser gate
 * will need when it asks "did the *2D* bodies settle?".
 */
const TWO_D_COLORS: readonly Color[] = [
  [1, 0.45, 0.15, 1],
  [1, 0.72, 0.18, 1],
  [0.92, 0.26, 0.22, 1],
  [0.95, 0.45, 0.62, 1],
  [0.85, 0.62, 0.1, 1],
];

/** The 3D half's bodies: cool hues, blue clearly above red. See above. */
const THREE_D_COLORS: readonly Color[] = [
  [0.2, 0.68, 1, 1],
  [0.3, 0.85, 0.55, 1],
  [0.55, 0.45, 0.95, 1],
  [0.42, 0.55, 0.98, 1],
  [0.68, 0.8, 0.94, 1],
];

// --- camera and view (§47, §48) ----------------------------------------------

// 16 × 9 world units over a 16:9 canvas: 60 CSS pixels per world unit, and no
// stretch. +Y is up here exactly as it is in both physics worlds (§7a).
const camera = new OrthographicCamera({
  left: -VIEW_HALF_WIDTH,
  right: VIEW_HALF_WIDTH,
  bottom: -VIEW_HALF_HEIGHT,
  top: VIEW_HALF_HEIGHT,
  near: 0.1,
  far: 100,
});
camera.transform.position.set(0, 0, 20);
camera.updateProjectionMatrix();

const view = createFullscreenViewport(camera);
// Matches the page background, so the canvas has no visible edge.
view.clearColor = [0.05, 0.06, 0.09, 1];

// --- application (§45) --------------------------------------------------------

const renderer = new WebglRenderer();
const app = new Application({
  renderer,
  canvas,
  views: [view],
  // The default with a renderer, spelled out because the whole point of the
  // arrangement below is that the solver steps at 1/60 s while the display
  // draws at its own rate from interpolated poses (§43).
  poseInterpolation: true,
});
renderer.resize(WIDTH, HEIGHT, window.devicePixelRatio);
app.scene.add(camera);

// One solve system for both worlds (§39 step 6) — with dispatch split off to
// step 9 (PH-21), so that step 8 exists to occupy: see the header's step-8
// section. `dispatchEvents: false` is what makes the split legal, and
// `PhysicsEventSystem`'s constructor refuses a source that still dispatches.
const physics = new PhysicsSystem({ dispatchEvents: false });
app.systems.register(physics);
app.systems.register(new PhysicsEventSystem({ source: physics }));

// --- the two halves, as data (§21, §37) --------------------------------------

/**
 * Everything that differs between the `"2d"` half and the `"3d"` half.
 *
 * Deliberately small. A solver, two §24 shape constructors, two geometry
 * constructors, a palette and a place to stand — and with those six fields the
 * scene-building code below is written once and produces both halves.
 */
interface HalfKit {
  /** The §21 dimension of this half's world. */
  readonly dimension: PhysicsDimension;

  /** Where this half's floor is centred on X, in world units. */
  readonly centerX: number;

  /** This half's body colours, in creation order. */
  readonly colors: readonly Color[];

  /** A fresh, uninitialized Rapier adapter for {@link HalfKit.dimension}. */
  createAdapter(): PhysicsWorldAdapter;

  /** A ball: §24's `circle` in 2D, `sphere` in 3D. */
  ballShape(radius: number): CollisionShape;

  /** A slab: §24's `rectangle` in 2D, `box` in 3D. `halfDepth` is ignored in 2D. */
  slabShape(
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): CollisionShape;

  /** What a ball is drawn with. */
  ballGeometry(radius: number): BufferGeometry;

  /** What a slab is drawn with. */
  slabGeometry(
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): BufferGeometry;
}

/** How round a drawn ball is. Cheap: five bodies in the whole scene. */
const BALL_SEGMENTS = 40;

const KIT_2D: HalfKit = {
  dimension: "2d",
  centerX: -HALF_CENTER_X,
  colors: TWO_D_COLORS,
  createAdapter: (): PhysicsWorldAdapter => new Rapier2dAdapter(),
  ballShape: (radius: number): CollisionShape => ({ type: "circle", radius }),
  slabShape: (halfWidth: number, halfHeight: number): CollisionShape => ({
    type: "rectangle",
    halfExtents: new Vector2(halfWidth, halfHeight),
  }),
  ballGeometry: (radius: number): BufferGeometry =>
    circleGeometry2D({ radius, segments: BALL_SEGMENTS }),
  slabGeometry: (halfWidth: number, halfHeight: number): BufferGeometry =>
    planeGeometry({ width: halfWidth * 2, height: halfHeight * 2 }),
};

const KIT_3D: HalfKit = {
  dimension: "3d",
  centerX: HALF_CENTER_X,
  colors: THREE_D_COLORS,
  createAdapter: (): PhysicsWorldAdapter => new Rapier3dAdapter(),
  ballShape: (radius: number): CollisionShape => ({ type: "sphere", radius }),
  slabShape: (
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): CollisionShape => ({
    type: "box",
    halfExtents: new Vector3(halfWidth, halfHeight, halfDepth),
  }),
  // See "Known visual approximations": no sphere primitive exists yet, and an
  // unlit sphere under an orthographic camera *is* this disc.
  ballGeometry: (radius: number): BufferGeometry =>
    circleGeometry2D({ radius, segments: BALL_SEGMENTS }),
  slabGeometry: (
    halfWidth: number,
    halfHeight: number,
    halfDepth: number,
  ): BufferGeometry =>
    boxGeometry({
      width: halfWidth * 2,
      height: halfHeight * 2,
      depth: halfDepth * 2,
    }),
};

// The worlds themselves. Construction is synchronous; `initialize()` — which is
// where each adapter decodes its own wasm image — is awaited in `main()`.
const world2d = physics.track(
  new PhysicsWorld({
    dimension: KIT_2D.dimension,
    adapter: KIT_2D.createAdapter(),
    // §43: the world tracks every dynamic body's node in this buffer, and the
    // application's step-10 snapshot system captures into it.
    poses: app.poses,
  }),
);

const world3d = physics.track(
  new PhysicsWorld({
    dimension: KIT_3D.dimension,
    adapter: KIT_3D.createAdapter(),
    poses: app.poses,
  }),
);

// --- building a body (§6a: components, one per type per node) ----------------

/** A registered body: the node that draws it and the components that move it. */
interface Body {
  readonly node: Renderable;
  readonly body: RigidBody;
  readonly collider: Collider;
}

/**
 * Adds one body to `world` and to the scene.
 *
 * The shape is authored twice — once as a §24 collider and once as a geometry —
 * because they are genuinely two different things: physics needs half-extents
 * and rendering needs vertices, and no automatic derivation could know that the
 * sensor zone is drawn as a flat slab while its collider is a box. The two
 * always agree here because both come from the same `HalfKit` call with the
 * same numbers.
 *
 * No mass is authored anywhere in this file — see the header (§23, §25).
 */
function addBody(
  world: PhysicsWorld,
  type: "dynamic" | "static",
  shape: CollisionShape,
  geometry: BufferGeometry,
  color: Color,
  options: {
    name: string;
    x: number;
    y: number;
    restitution?: number;
    friction?: number;
  },
): Body {
  const node = new Renderable(geometry, new UnlitMaterial({ color }));
  node.name = options.name;
  // z is always 0: §21 requires a `"2d"` body to lie in the XY plane, and the
  // 3D half is arranged in that same plane so one camera frames both.
  node.transform.position.set(options.x, options.y, 0);
  // §42: exactly one system writes a transform. A dynamic body's is the
  // solver's; a static body never moves and stays under the default authority.
  if (type === "dynamic") {
    node.transformAuthority = "physics";
  }

  node.addComponent(new RigidBody({ type }));
  const collider = node.addComponent(
    new Collider({
      shape,
      ...(options.restitution === undefined
        ? {}
        : { restitution: options.restitution }),
      ...(options.friction === undefined ? {} : { friction: options.friction }),
    }),
  );

  app.scene.add(node);
  // Reads the node's transform as the initial pose, hands the descriptors to
  // the solver, and reads the derived mass back onto the component (§23, §37).
  const body = world.addBody(node);
  return { node, body, collider };
}

/** Adds one immovable slab — a floor or a wall. */
function addStatic(
  world: PhysicsWorld,
  kit: HalfKit,
  name: string,
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
): Body {
  return addBody(
    world,
    "static",
    kit.slabShape(halfWidth, halfHeight, STATIC_HALF_DEPTH),
    kit.slabGeometry(halfWidth, halfHeight, STATIC_HALF_DEPTH),
    STATIC_COLOR,
    { name, x, y, friction: 0.9 },
  );
}

/**
 * A half's §24 sensor zone: the collider that reports the §29 triggers, and the
 * quad that shows what it reported.
 *
 * They are two nodes, not one, for a reason worth stating: **§21 forbids a
 * `"2d"` body from leaving the XY plane** (`position.z must be 0`, and the
 * validator says so), while the zone has to be *drawn* behind the bodies
 * because this renderer tier cannot blend an unlit material. So the body node
 * stays at z = 0 where physics requires it and carries a child node at
 * z = {@link ZONE_Z} that does the drawing — which is what a rigid visual
 * offset already is in a scene graph, and needs no new concept (§7). Found the
 * hard way: authoring the whole thing at z = −0.5 is rejected at registration,
 * loudly and correctly (finding, WP-5.7).
 */
interface Zone {
  /** The quad that is recoloured; a child of the sensor body's node. */
  readonly face: Renderable;
  /** The sensor collider, and therefore §29's trigger emitter. */
  readonly collider: Collider;
}

/** Adds one half's sensor zone. See {@link Zone} for the two-node shape. */
function addZone(world: PhysicsWorld, kit: HalfKit): Zone {
  const node = new Group();
  node.name = `${kit.dimension}-zone`;
  node.transform.position.set(kit.centerX, ZONE_CENTER_Y, 0);
  node.addComponent(new RigidBody({ type: "static" }));
  const collider = node.addComponent(
    new Collider({
      shape: kit.slabShape(ZONE_HALF_WIDTH, ZONE_HALF_HEIGHT, ZONE_HALF_WIDTH),
      // §24: a sensor takes part in the broad phase and exerts no force, so a
      // body falls straight through it and only the events say it was there.
      sensor: true,
    }),
  );

  // Drawn as a flat quad whatever the dimension: what matters about a zone on
  // screen is its colour, not its solidity.
  const face = new Renderable(
    planeGeometry({ width: ZONE_HALF_WIDTH * 2, height: ZONE_HALF_HEIGHT * 2 }),
    new UnlitMaterial({ color: ZONE_EMPTY_COLOR }),
  );
  face.name = `${kit.dimension}-zone-face`;
  face.transform.position.set(0, 0, ZONE_Z);
  node.add(face);

  app.scene.add(node);
  world.addBody(node);
  return { face, collider };
}

/** Restitution of the bouncy bodies (balls) and the dull ones (bricks/crates). */
const BALL_RESTITUTION = 0.25;
const SLAB_RESTITUTION = 0.05;

/** Friction of every dynamic body (§25 combines it with the floor's 0.9). */
const BODY_FRICTION = 0.6;

// --- the scene ---------------------------------------------------------------

/** Where a half's bodies start, relative to that half's centre. */
interface Drop {
  /** Node name, and the name an authority warning would print. */
  readonly name: string;
  /** Offset from the half's centre on X, and absolute Y. */
  readonly offsetX: number;
  readonly y: number;
  /** A ball of this radius, or a slab of this half-extent — exactly one. */
  readonly radius?: number;
  readonly halfExtent?: number;
}

/**
 * The five dynamic bodies of each half, in creation order (which is also
 * {@link HalfKit.colors} order, and the §33 body-id order).
 *
 * Chosen so that the three §108 behaviours are all visible at once once
 * everything settles:
 *
 * - `anchor` lands square in the middle of the sensor zone and stays there, so
 *   the zone ends up *occupied* and the sensor colour is a stable end state
 *   rather than a flicker during the fall;
 * - `stack-mid` and `stack-top` fall onto `anchor` and stack on it;
 * - `outer` and `far` land outside the zone, so a settled frame shows both zone
 *   colours' worth of information: bodies inside and bodies outside.
 *
 * A poke (see {@link poke}) then launches a body out of the zone and lets it
 * fall back in, which is the same two events in the other order.
 */
const DROPS: readonly Drop[] = [
  { name: "anchor", offsetX: 0, y: -0.6, halfExtent: 0.38 },
  { name: "stack-mid", offsetX: 0.12, y: 0.8, halfExtent: 0.32 },
  { name: "stack-top", offsetX: -0.1, y: 2, halfExtent: 0.27 },
  { name: "outer", offsetX: 1.75, y: 2.6, radius: 0.32 },
  { name: "far", offsetX: -1.9, y: 1.4, radius: 0.28 },
];

/** One built half: its dynamic bodies and the state its sensor zone carries. */
interface Half {
  readonly kit: HalfKit;
  /** The world this half simulates in — what {@link ZoneTallySystem} queries. */
  readonly world: PhysicsWorld;
  readonly bodies: readonly Body[];
  readonly zone: Zone;
  /**
   * The §29 event counter: `+1` per `triggerenter`, `−1` per `triggerexit`,
   * clamped at zero. A delta accumulation — see the header's step-8 section
   * for why the repaint no longer trusts it alone.
   */
  occupancy: number;
  /**
   * The step-8 tally: how many **dynamic** colliders the §30 overlap query
   * found inside the zone's volume this fixed step. Written by
   * {@link ZoneTallySystem} at `PRIORITY_SENSOR_UPDATE` (800), consumed by the
   * step-9 listeners in {@link watchZone}.
   */
  tally: number;
}

/**
 * Builds one half of the playground into `world`: a container, a sensor zone,
 * and five dynamic bodies in the air.
 *
 * Called twice with two different {@link HalfKit}s and nothing else, which is
 * the §108 claim in executable form.
 */
function buildHalf(world: PhysicsWorld, kit: HalfKit): Half {
  const cx = kit.centerX;

  addStatic(
    world,
    kit,
    `${kit.dimension}-floor`,
    cx,
    FLOOR_CENTER_Y,
    FLOOR_HALF_WIDTH,
    FLOOR_HALF_HEIGHT,
  );
  addStatic(
    world,
    kit,
    `${kit.dimension}-wall-left`,
    cx - WALL_OFFSET_X,
    WALL_CENTER_Y,
    WALL_HALF_WIDTH,
    WALL_HALF_HEIGHT,
  );
  addStatic(
    world,
    kit,
    `${kit.dimension}-wall-right`,
    cx + WALL_OFFSET_X,
    WALL_CENTER_Y,
    WALL_HALF_WIDTH,
    WALL_HALF_HEIGHT,
  );

  const zone = addZone(world, kit);

  const bodies = DROPS.map((drop, index) => {
    const color = kit.colors[index % kit.colors.length];
    const common = {
      name: `${kit.dimension}-${drop.name}`,
      x: cx + drop.offsetX,
      y: drop.y,
      friction: BODY_FRICTION,
    };
    if (drop.radius !== undefined) {
      return addBody(
        world,
        "dynamic",
        kit.ballShape(drop.radius),
        kit.ballGeometry(drop.radius),
        color,
        { ...common, restitution: BALL_RESTITUTION },
      );
    }
    const halfExtent = drop.halfExtent ?? 0.3;
    return addBody(
      world,
      "dynamic",
      kit.slabShape(halfExtent, halfExtent, halfExtent),
      kit.slabGeometry(halfExtent, halfExtent, halfExtent),
      color,
      { ...common, restitution: SLAB_RESTITUTION },
    );
  });

  return { kit, world, bodies, zone, occupancy: 0, tally: 0 };
}

// --- the step-8 bookkeeping (§39 step 8, §30) --------------------------------

/** Scratch for the tally query's centre (§7b, D7: no per-step allocation). */
const tallyCenter = new Vector3();

/** The zone's half-extents, restated once for the query side. */
const tallyHalfExtents = new Vector3(
  ZONE_HALF_WIDTH,
  ZONE_HALF_HEIGHT,
  ZONE_HALF_WIDTH,
);

/**
 * §39 step 8, occupied: re-measures each zone's occupancy from the §30 overlap
 * query, once per fixed step, into {@link Half.tally}.
 *
 * Three things make this the honest shape for sensor bookkeeping:
 *
 * - **It runs after the solve and before the listeners.** At 800 the query
 *   sees exactly the post-step geometry the step-9 listeners are about to be
 *   told about, which is the ordering PH-21's split exists to provide — at the
 *   old combined step 6 there was nowhere to stand between the two.
 * - **It is absolute, not accumulated.** `overlapBox` over the zone's own
 *   volume answers "who is inside *now*"; it cannot drift the way a ±1 counter
 *   can, and needs no clamp.
 * - **It counts dynamic colliders only.** The query already excludes sensors
 *   by default (§30's `includeSensors`), so the zone cannot count itself; the
 *   `"dynamic"` filter keeps the floor and walls out of the tally in the same
 *   way the zone's placement keeps them out of its §29 events.
 *
 * The DOM is deliberately not touched here: the tally is *read* at 800 and
 * *consumed* at 900, by the listeners in {@link watchZone} — which is the
 * split the §39 example order describes.
 */
class ZoneTallySystem implements SimulationSystem {
  priority = PRIORITY_SENSOR_UPDATE;

  readonly #halves: readonly Half[];

  constructor(halves: readonly Half[]) {
    this.#halves = halves;
  }

  /** No per-registration setup is needed (§39). */
  initialize(): void {
    // Intentionally empty: the halves own their worlds and zones.
  }

  /** Re-measures every half's tally against its post-solve world. */
  fixedUpdate(): void {
    for (const half of this.#halves) {
      tallyCenter.set(half.kit.centerX, ZONE_CENTER_Y, 0);
      const hits = half.world.overlapBox(tallyCenter, tallyHalfExtents);
      let count = 0;
      for (const hit of hits) {
        if (hit.body.type === "dynamic") {
          count += 1;
        }
      }
      half.tally = count;
    }
  }

  /** Nothing to release (§39 teardown): the halves outlive the registry. */
  dispose(): void {
    // Intentionally empty — see the doc comment.
  }
}

// --- the sensor zones (§24, §29) ---------------------------------------------

/**
 * Subscribes a half's zone to §29's two trigger names and repaints it — from
 * the step-8 tally, which is what "consumed at 900" means concretely.
 *
 * The listeners are registered on the **sensor's collider**, which is what §29
 * says (`sensor.on("triggerenter", …)`) and not on the body: a body may carry
 * several colliders and only the sensor among them is a trigger volume.
 *
 * Emission happens after the fixed step, never inside it (§39 step 9, §6b), so
 * a listener may safely do anything — here, write a material colour and two DOM
 * attributes. Because dispatch now runs at `PRIORITY_EVENT_DISPATCH` (900),
 * every listener below observes a {@link Half.tally} that
 * {@link ZoneTallySystem} recorded at 800 **in the same fixed step** as the
 * event it is handling: the event says *something changed*, the tally says
 * *what the measured occupancy now is*, and the colour follows the
 * measurement. The ±1 event counter is kept, mirrored, and held against the
 * tally by the browser gate — but it no longer drives the picture.
 */
function watchZone(half: Half): void {
  const repaint = (): void => {
    const color = half.tally > 0 ? ZONE_OCCUPIED_COLOR : ZONE_EMPTY_COLOR;
    half.zone.face.material.setColor(color[0], color[1], color[2], color[3]);
    // Mirrored onto the page as `data-zone2d` / `data-zone3d` (the §29 event
    // counter) and `data-tally2d` / `data-tally3d` (the §30 re-measure), so
    // both accounts are legible to a test without reading pixels.
    status.dataset[`zone${half.kit.dimension}`] = String(half.occupancy);
    status.dataset[`tally${half.kit.dimension}`] = String(half.tally);
  };

  half.zone.collider.on("triggerenter", () => {
    half.occupancy += 1;
    repaint();
  });
  half.zone.collider.on("triggerexit", () => {
    // Clamped rather than trusted: an exit for something that never entered
    // would otherwise leave the counter negative and the colour stuck.
    half.occupancy = Math.max(0, half.occupancy - 1);
    repaint();
  });
  repaint();
}

// --- clicking a body: the §26 impulse ----------------------------------------

/** Upward speed a poke imparts, in m/s — about 2.1 m of rise under −9.81. */
const POKE_SPEED_UP = 6.5;

/** How much of the click's horizontal offset becomes sideways speed, per metre. */
const POKE_LATERAL_GAIN = 7;

/** Ceiling on the sideways part, in m/s, so a rim click cannot fling a body out. */
const POKE_LATERAL_MAX = 2.6;

/** Scratch for {@link poke}: the impulse and its point of application (§7b, D7). */
const pokeImpulse = new Vector3();
const pokePoint = new Vector3();

/**
 * The pick candidates, filled by {@link buildScene} once the bodies exist.
 *
 * The pointer source below reads them through a callback, so it can be
 * constructed before there is anything to pick — which is what lets the page
 * accept clicks the instant the scene appears rather than a frame later.
 */
let pickables: readonly Pickable[] = [];

// A real `HTMLCanvasElement` satisfies `PointerSurface` structurally, so no
// adapter and no cast is needed. Platform pixels become normalized device
// coordinates through the canvas rectangle, including the Y flip that turns the
// platform's downward Y into §7a's upward Y. It is never disposed: it lives
// exactly as long as the page does (§83).
new PointerInput(canvas, { camera, pickables: () => pickables });

/**
 * Pokes `body` upward and away from `worldPoint` (§26).
 *
 * Three things about this are worth reading:
 *
 * 1. **The impulse is `mass × Δv`.** An impulse is momentum, so a fixed impulse
 *    would launch the lightest body four times higher than the heaviest. Sizing
 *    it from `RigidBody.mass` — which the solver derived from collider density
 *    and the world read back at registration (§23) — makes every body answer a
 *    click with the same *speed*, which is what a user expects a poke to mean.
 * 2. **It is applied at the click point, flattened onto the body's own Z.**
 *    `applyImpulseAtPoint` keeps the lever arm, so the adapter (which knows the
 *    world-space centre of mass) turns an off-centre poke into spin as well as
 *    lift: clicking a crate's corner tumbles it, clicking its middle does not.
 *    But a pick against a 3D box reports a point on the box's **front face**,
 *    and the lever arm from there is mostly along Z — which spins the crate
 *    about X and walks it out of the z = 0 plane this camera frames, and
 *    eventually off the (unwalled) Z edge of the floor. Measured, WP-5.7: a
 *    poked crate left the arena in about two seconds. Replacing the point's Z
 *    with the body's own leaves a purely in-plane lever arm, which is the only
 *    kind this scene can show.
 * 3. **It wakes the body explicitly.** §32 puts settled bodies to sleep, and
 *    WP-5.2 decided that applying a load does *not* implicitly wake one — what
 *    wakes a body is always something the caller asked for. So the caller asks.
 *
 * The impulse is queued on the component's §26 command buffer and drained by
 * the world at the *next* fixed step, one-shot: clicking twice in one frame
 * accumulates, clicking once does not persist.
 */
function poke(node: Renderable, body: RigidBody, worldPoint?: Vector3): void {
  // `mass` is `undefined` only for a body a solver reported no mass for, which
  // cannot happen for the dynamic bodies here; 1 kg keeps the arithmetic finite
  // rather than silently producing `NaN` if it ever did.
  const mass = body.mass ?? 1;
  const offsetX =
    worldPoint === undefined ? 0 : node.transform.position.x - worldPoint.x;
  const lateral = Math.max(
    -POKE_LATERAL_MAX,
    Math.min(POKE_LATERAL_MAX, offsetX * POKE_LATERAL_GAIN),
  );
  pokeImpulse.set(lateral * mass, POKE_SPEED_UP * mass, 0);

  body.wake();
  if (worldPoint === undefined) {
    body.applyImpulse(pokeImpulse);
  } else {
    // Solver space and scene space are the same space here — see the header —
    // so the picked point needs no conversion, only the Z flattening above.
    pokePoint.set(worldPoint.x, worldPoint.y, node.transform.position.z);
    body.applyImpulseAtPoint(pokeImpulse, pokePoint);
  }
}

// --- assembling it -----------------------------------------------------------

/**
 * Builds both halves, wires picking and the sensors, and returns the halves.
 *
 * Everything here happens *after* both worlds are initialized, because
 * `addBody` registers into a live solver.
 */
function buildScene(): readonly Half[] {
  // Scenery, not a body: the hairline between the two simulations. It belongs
  // to no world, has no components, and never moves.
  const divider = new Renderable(
    planeGeometry({ width: 0.05, height: VIEW_HALF_HEIGHT * 1.9 }),
    new UnlitMaterial({ color: DIVIDER_COLOR }),
  );
  divider.name = "divider";
  divider.transform.position.set(0, 0, -1);
  app.scene.add(divider);

  const halves = [buildHalf(world2d, KIT_2D), buildHalf(world3d, KIT_3D)];
  for (const half of halves) {
    watchZone(half);
  }

  // §71/§72 picking. `@four/input` never reads geometry, so the layer that does
  // states each candidate's **local** bounds; the ray is transformed into each
  // node's local space, so a tumbling crate is picked as a tumbling crate. The
  // list is built once because the set of pickable nodes never changes — the
  // bounds vectors are live views onto geometries nothing here edits.
  pickables = halves
    .flatMap((half) => half.bodies)
    .map(({ node }) => {
      const bounds = node.geometry.computeBounds();
      return { node, boundsMin: bounds.min, boundsMax: bounds.max };
    });

  for (const half of halves) {
    for (const { node, body } of half.bodies) {
      // `click` is synthesized by the pointer source — a press and a release on
      // the same node (§72) — and delivered through the node's own §6b emitter.
      node.on("click", (event) => {
        poke(node, body, event.worldPoint);
      });
    }
  }

  return halves;
}

// --- the frame loop ----------------------------------------------------------

/**
 * Seeded from the FIRST rAF timestamp rather than `performance.now()`: rAF
 * hands the frame-start time, which can precede a `now()` taken moments
 * earlier, and a negative first delta would make `app.step` throw and kill the
 * loop (WP-3.7-fix1, caught by the WP-3.8 browser gate).
 */
let last: number | null = null;

function frame(now: number): void {
  if (last !== null) {
    // The one place a wall clock is allowed: a presentation-side measurement,
    // converted to **seconds** before it crosses into the engine (§7a, §33).
    app.step((now - last) / 1000);
  }
  last = now;
  requestAnimationFrame(frame);
}

/** What the page says while the two wasm images are decoding, and after. */
const LOADING_TEXT = "loading physics (WebAssembly solvers)…";
const RUNNING_TEXT =
  "Left: a 2D world. Right: a 3D world. One application, one physics system, " +
  "two solvers. Click a body to poke it; the slab at the bottom of each half " +
  "is a sensor zone and changes colour while something is inside it.";

async function main(): Promise<void> {
  status.textContent = LOADING_TEXT;
  status.dataset["state"] = "loading";

  // Acquires the WebGL 2 context (§45).
  await app.initialize();
  // Decodes one wasm image per dimension (§37 allows `initialize` to be async
  // for exactly this). The two are independent packages with independent
  // images, so they load concurrently.
  await Promise.all([world2d.initialize(), world3d.initialize()]);

  const halves = buildScene();
  // §39 step 8, occupied now that the scene's zones exist. Registration order
  // against the systems above is irrelevant — the registry runs by priority.
  app.systems.register(new ZoneTallySystem(halves));

  status.textContent = RUNNING_TEXT;
  status.dataset["state"] = "running";
  // Self-description for the browser gate: dispatch runs at §39 step 9, split
  // from the solve — the arrangement the step-8 tally depends on.
  status.dataset["dispatch"] = "step-9";

  app.start();
  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  status.textContent = "four.js playground: failed to start — see the console.";
  status.dataset["state"] = "error";
  console.error("four.js playground: failed to start.", error);
});
