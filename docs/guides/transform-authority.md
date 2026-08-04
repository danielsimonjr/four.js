# Transform authority

Animation, kinematics, physics, constraints, and plain application code all
want to write node transforms. §42 gives every node **exactly one owner** at a
time, named on the node itself:

```ts
node.transformAuthority = "kinematic";
```

The authorities are `"manual"` (application code, the default), `"animation"`,
`"kinematic"`, `"physics"`, `"blended"`, `"constraint"`, and `"network"`.
A system that is asked to write a transform it does not own **refuses the
write and warns once** (`warnAuthorityConflict` in `four/scene`) — conflicts
are loud, never silent overwrites.

## Declaring owners

Each mover in a scene names the system that drives it:

```ts
orbiter.transformAuthority = "kinematic"; // KinematicSystem follows a trajectory
beacon.transformAuthority = "animation"; // a Tween owns the position outright
crate.transformAuthority = "physics"; // the solver writes what it solves
uiRoot.transformAuthority = "manual"; // the application places the root panel
```

UI layout writes children under `"constraint"` (§74); `"network"` is reserved
for replicated state. Render interpolation (§43) is **not** an authority — it
never writes transforms back, it only affects what is drawn.

## Handovers: the drag pattern

When ownership must change at runtime, hand it over explicitly — stop asking
the old owner to write, then take the authority. `examples/first-2d-scene`
does this for its draggable box:

```ts
import { DragManager, PointerInput } from "four/input";

const drags = new DragManager({
  pointerInput,
  onDragStart: (node) => {
    motionSystem.untrack(node); // the old owner stops being asked
    node.transformAuthority = "manual"; // the application takes the transform
  },
  onDrag: (node, worldDelta) => {
    const p = node.transform.position;
    p.set(p.x + worldDelta.x, p.y + worldDelta.y, p.z);
  },
  onDragEnd: (node) => {
    node.transformAuthority = "kinematic";
    motionSystem.track(node); // the tumble resumes where it paused
  },
});
drags.makeDraggable(crate);
```

Setting the authority alone would be enough for _enforcement_ — the
`MotionSystem` would refuse and warn — but leaving the node tracked means
asking a system every step to do something it is not allowed to do.
Untracking says the same thing without the warning; that is what a handover
is.

## `"blended"`: the §19 pipeline

`"blended"` selects the physics-animation blending pipeline: animation writes
a **`PoseTarget`** component (never the transform), the solver solves, and
the world publishes `lerp/slerp(animationPose, physicsPose)` weighted by the
`RigidBody`'s `animationWeight` / `physicsWeight`. Nothing else may write the
transform at all.

```ts
import { AnimationMixer, AnimationSystem } from "four/animation";
import {
  createPoseTargetCaptureSystem,
  PhysicsSystem,
  RigidBody,
} from "four/physics";
import { PoseTarget } from "four/scene";

const animation = new AnimationSystem(); // priority 300
const physics = new PhysicsSystem(); // priority 600
app.systems.register(animation);
app.systems.register(physics);
// Priority 299 — NOT registered by Application, and not optional when
// blending: it keeps the one-step pose history that velocity inheritance
// finite-differences. Without it a control-mode switch inherits a wildly
// inflated velocity (measured: ~30×).
app.systems.register(createPoseTargetCaptureSystem(physics.worlds));

link.transformAuthority = "blended";
const body = link.addComponent(new RigidBody({ type: "kinematic-position" }));
body.animationWeight = 1; // §19 weights: fully animated to start
body.physicsWeight = 0;
const target = link.addComponent(new PoseTarget()).copyFrom(link.transform);

// Animate the TARGET, not the node — the only thing §19 changes about
// authoring animation:
animation.track(new AnimationMixer(target).play(waveClip, { loop: Infinity }));
```

Switching control modes goes through the world, which retypes the solver body
in place and can inherit the animated velocity:

```ts
// hand the chain to physics, keeping the motion the animation had:
world.setBodyControlMode(link, "dynamic", { inheritVelocityFrom: target });
// ...later, sweep body.animationWeight 0 → 1 over ~90 steps, then:
world.setBodyControlMode(link, "kinematic-position");
```

Write **both** weights during a sweep (`w` and `1 − w`): the published share
is normalized by their sum, so leaving `physicsWeight` at 1 caps the
animation share at ½. Re-type only after a step has already published at full
animation weight — then the retype teleports the _solver body_ onto the
target and cannot move the node. `examples/blending` demonstrates the full
cycle and measures the per-step displacement at each switch.

## Rules to keep

1. One owner per node; name it before the first write.
2. Handovers are untrack + authority write, in that order.
3. Animation under blending writes `PoseTarget`s, never transforms.
4. Render interpolation never feeds back into simulation state.
5. A refused write warns once per conflict — treat any authority warning in
   the console as a bug in your scene wiring, not as noise.

## Cross-references

- §42 (authority), §19 (blending), §39 (system order), §22 (body types).
- `examples/first-2d-scene` (drag handover), `examples/blending` (the full
  animated → ragdoll → recovering cycle with measurements).
