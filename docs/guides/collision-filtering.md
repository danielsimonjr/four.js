# Collision filtering

Who collides with whom — and who merely _reports_ — is decided by collider
group/mask bits (§24), the sensor flag (§24), and per-query filters (§30).
This guide covers the machinery in context: bodies, colliders, materials,
events, and queries. It assumes the physics basics from
`examples/physics-playground`.

## Bodies and colliders, briefly (§23, §24)

Physics attaches to nodes as components: a `RigidBody` (type `"dynamic"`,
`"static"`, `"kinematic-position"`, or `"kinematic-velocity"`, §22) plus one
or more `Collider`s, registered into a `PhysicsWorld` with
`world.addBody(node)`. Mass is derived from collider density × area/volume by
default — author density (or a `PhysicsMaterial`, §25), not mass, and read
`body.mass` back after registration. Surface response comes from `friction`
and `restitution`, explicit fields beating the material fallback, combined
across a contact pair by the §25 combine modes (restitution combines with
`max` per Appendix A).

## Groups and masks (§24)

Every collider carries two bit sets, both defaulting to all bits
(`ALL_COLLISION_GROUPS`):

- `collisionGroups` — the groups this collider **belongs to**;
- `collisionMask` — the groups it **collides with**.

A pair collides only if each side's mask admits the other's groups. A
complete, headless example — runnable under Node, since solvers need no
renderer:

```ts
import { Vector2, Vector3 } from "four/math";
import { Collider, PhysicsWorld, RigidBody } from "four/physics";
import { Rapier2dAdapter } from "four/physics-rapier";
import { Group } from "four/scene";

const GROUP_TERRAIN = 0b001;
const GROUP_DEBRIS = 0b010;
const GROUP_PLAYER = 0b100;

const world = new PhysicsWorld({
  dimension: "2d",
  adapter: new Rapier2dAdapter(),
});
await world.initialize(); // decodes the solver's wasm image (§37)

function drop(name: string, x: number, groups: number, mask: number): Group {
  const node = new Group();
  node.name = name;
  node.transform.position.set(x, 3, 0); // 2D bodies must sit at z = 0 plane-wise (§21)
  node.transformAuthority = "physics";
  node.addComponent(new RigidBody({ type: "dynamic" }));
  node.addComponent(
    new Collider({
      shape: { type: "circle", radius: 0.3 },
      collisionGroups: groups,
      collisionMask: mask,
    }),
  );
  world.addBody(node);
  return node;
}

// The floor supports everything:
const floor = new Group();
floor.name = "floor";
floor.transform.position.set(0, -1, 0);
floor.addComponent(new RigidBody({ type: "static" }));
floor.addComponent(
  new Collider({
    shape: { type: "rectangle", halfExtents: new Vector2(10, 0.5) },
    collisionGroups: GROUP_TERRAIN,
    collisionMask: GROUP_DEBRIS | GROUP_PLAYER,
  }),
);
world.addBody(floor);

// Debris lands on terrain but passes through the player (mask omits PLAYER):
drop("debris", -0.2, GROUP_DEBRIS, GROUP_TERRAIN);
// The player collides with terrain and debris — but debris's mask still
// excludes the player, and filtering is mutual, so the pair stays inert:
drop("player", 0.2, GROUP_PLAYER, GROUP_TERRAIN | GROUP_DEBRIS);

for (let i = 0; i < 240; i += 1) world.step(1 / 60);
```

Filtering is **mutual**: both masks must admit the pair. Jointed bodies skip
collision with each other by default (§28 `collisionEnabled: false`), which
is a separate mechanism from groups.

## Sensors (§24, §29)

A `sensor: true` collider takes part in the broad phase and exerts **no
force**: bodies fall straight through, and only events say they were there.
Listen on the sensor's collider — not the body — for the §29 trigger pair:

```ts
zoneCollider.on("triggerenter", (event) => {
  occupancy += 1;
});
zoneCollider.on("triggerexit", (event) => {
  occupancy = Math.max(0, occupancy - 1);
});
```

Solid colliders emit `collisionenter` / `collisionstay` / `collisionexit` on
their bodies. All physics events dispatch **after** the fixed step (§39 step
9), so a listener may safely mutate the scene.

## Query filtering (§30)

Every query — `raycast`, `shapeCast`, `overlapSphere`, `overlapBox`,
`pointQuery` — takes the same filter options, using the same bits:

```ts
const hits = world.raycast({
  origin: new Vector2(0, 0),
  direction: new Vector2(1, 0), // need not be unit length
  maxDistance: 25,
  collisionGroups: GROUP_PLAYER, // what the ray "is"
  collisionMask: GROUP_TERRAIN, // what it may hit
  mode: "all", // or "first" for the nearest hit
  sorted: true, // ascending distance
});
for (const hit of hits) {
  // hits identify components, not handles: hit.collider, hit.body,
  // plus hit.point / hit.normal / hit.distance for a raycast
}
```

The filter also carries `ignoredBodies` / `ignoredColliders` (§30's "skip the
caster"), which take **solver handles** — the identifiers adapters traffic
in — so they are mostly used at the adapter seam; at the world level, groups
and masks are the ergonomic exclusion mechanism.

`overlapSphere` is a circle overlap in a `"2d"` world and a sphere overlap in
a `"3d"` one — one call, the shape the dimension implies (§21). Queries are
read-only: even thousands of overlap probes per step provably perturb no
solver state (verified by checksum-stream identity in the Phase 8 exit).

## Practical guidance

- Name your groups as constants; raw bit literals scattered through scene
  code are the main source of "why doesn't this collide" bugs.
- Prefer **sensors** for gameplay volumes and **query filters** for
  interrogation; groups/masks are for standing rules of the world.
- Colliders registered this step are invisible to queries until the next
  step on Rapier — query after `world.step`, not between `addBody` and it
  (measured, WP-5.4).

## Cross-references

- §22–§25 (bodies, colliders, materials), §29 (events), §30 (queries),
  §21 (dimensions).
- `examples/physics-playground` — sensors, impulses, and derived mass in a
  live scene.
