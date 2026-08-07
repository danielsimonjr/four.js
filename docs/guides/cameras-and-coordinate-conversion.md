# Cameras and coordinate conversion

This guide covers the §47 camera system, §48 viewports, and every coordinate
conversion an application meets: CSS pixels → normalized device coordinates →
world space, and back. Picking (§71) and pointer input (§72) are the same
conversions packaged, so they are covered here too.

## Cameras are nodes (§47)

A camera is placed with its transform like any other node, and owns a
projection. Two projections ship: `OrthographicCamera` and
`PerspectiveCamera` (both in `four/scene`). Nothing recomputes implicitly —
after changing a projection parameter, call `updateProjectionMatrix()`:

```ts
import { OrthographicCamera, PerspectiveCamera } from "four/scene";

const ortho = new OrthographicCamera({
  left: -8,
  right: 8,
  bottom: -4.5,
  top: 4.5,
  near: 0.1,
  far: 100,
});
ortho.transform.position.set(0, 0, 20);
ortho.updateProjectionMatrix();

const persp = new PerspectiveCamera({
  fieldOfView: Math.PI / 4, // radians, as everywhere (§7a)
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
});
```

`camera.projectionMatrix` and `camera.inverseProjectionMatrix` are plain
`Matrix4`s; the inverse is the first half of unprojecting a pointer position.
Projections are parameterized by depth range (`DepthRange`) so a future
zero-to-one backend needs no camera changes.

## Viewports (§48)

A viewport binds a camera to a region of the canvas and a clear colour.
`createFullscreenViewport(camera)` covers the whole surface; a second entry in
`app.views` is split-screen or a minimap:

```ts
const view = createFullscreenViewport(camera);
view.clearColor = [0.05, 0.06, 0.09, 1];
const app = new Application({ renderer, canvas, views: [view] });
```

## The conversion chain

With an orthographic camera showing `W × H` world units over a `w × h` CSS
pixel canvas, the mapping is affine and exact. The playground's camera shows
16 × 9 units over 960 × 540 pixels — 60 px per unit:

```text
px = (x + 8) × 60        py = (4.5 − y) × 60
```

The Y flip is the one conversion everyone forgets: platform pointer
coordinates grow **downward**, world Y grows **upward** (§7a). The pipeline
in `four/input` does it for you:

1. Platform pixels → NDC through the canvas's bounding rectangle (including
   the Y flip and the device pixel ratio).
2. NDC → a world-space ray through `createPickRay(camera, ndcX, ndcY,
outOrigin, outDirection)` — the camera's world transform composed with its
   inverse projection. Under an orthographic camera the ray is parallel to the
   view direction; under a perspective camera it fans out from the eye.
3. The ray is tested against pick candidates (§71) in each candidate's
   **local** space, so an oriented box is picked as an oriented box.

## Picking and pointer input, complete (§71, §72)

```ts
import { PointerInput, type Pickable } from "four/input";

// The input package never reads geometry (its dependency matrix forbids it),
// so the layer that does states each node's local-space bounds:
const pickables: readonly Pickable[] = [disc, cube].map((node) => {
  const bounds = node.geometry.computeBounds();
  return { node, boundsMin: bounds.min, boundsMax: bounds.max };
});

// A real HTMLCanvasElement satisfies PointerSurface structurally.
const pointerInput = new PointerInput(canvas, {
  camera,
  pickables: () => pickables,
});

disc.on("click", (event) => {
  // `click` is synthesized: press + release on the same node, no drag between
  // (§72). event.worldPoint is the pick point in world space.
  console.log("hit at", event.worldPoint);
});
```

Pointer events propagate through the scene graph with capture-phase variants
(`"capture:pointerdown"` etc., §72). Passing `pickables` as a callback lets
you construct the input source before the scene exists.

## Dragging: pixels to world deltas

`DragManager` converts pointer motion into a **world-space displacement** —
exact under an orthographic camera, via near-plane unprojection under a
perspective one — and hands it to the application. It never writes a
transform; what a drag _means_ is your decision, and writing the transform
needs a §42 authority handover:

```ts
import { DragManager } from "four/input";

const drags = new DragManager({
  pointerInput,
  onDragStart: (node) => {
    motion.untrack(node);
    node.transformAuthority = "manual";
  },
  onDrag: (node, worldDelta) => {
    const p = node.transform.position;
    p.set(p.x + worldDelta.x, p.y + worldDelta.y, p.z);
  },
  onDragEnd: (node) => {
    node.transformAuthority = "kinematic";
    motion.track(node);
  },
});
drags.makeDraggable(cube);
```

See the [transform authority guide](transform-authority.md) for why the
handover is untrack + authority write, in that order.

## Honest state

- Camera **rigs** (orbit, follow, §44) live in `@four/motion` per the spec,
  but no rig classes have shipped yet — place cameras manually or drive them
  with tweens/trajectories.
- `PerspectiveCamera` is exercised by exactly one example,
  `examples/first-3d-scene` (written 2026-08-07); every other shipped example
  uses an orthographic camera. This bullet claimed the same example did until
  2026-08-05, when the claim was **false** — the directory then held only a
  `.gitkeep` — and it read "no example exercises it … the perspective path has
  no browser-level demonstration" from that date until the example was written.
  The projection is now measured in a browser rather than asserted:
  `tests/browser/first-3d-scene.spec.ts` compares the on-screen area of two
  identical spheres at different depths (`docs/AUDIT-120.md`, **S-8**).

## Cross-references

- §47 (cameras), §48 (viewports), §71 (picking), §72 (input), §7a (Y-up).
- `examples/first-2d-scene` (picking + dragging), `examples/mechanism`
  (click plates), `examples/physics-playground` (world-point impulses from
  clicks).
