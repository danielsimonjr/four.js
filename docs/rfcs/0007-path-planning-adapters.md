# RFC 0007: Path-planning adapters (§111, steering fold)

- **Status:** Proposed
- **Date:** 2026-09-06
- **Owner decision:** pending
- **Spec sections affected:** §111 (primary), §12, §13, §33, §42, §81, §85, §89, §90, §98

## Context

§111 lists **path planning adapters** among Phase 8's components, beside steering,
flocking, IK, and trajectory prediction. Plan P8-1 staged them with an explicit
gate: they need an adapter RFC before a packet. That residue is still open.

Verified against the tree (2026-09-06):

- `@four/motion` ships Reynolds steering (`seek`, `flee`, `pursue`, `evade`,
  `arrive`, `wander` / `wanderSpherical`, flocking) as **pure functions that
  write an acceleration** (plan P8-2). The caller applies it. Nothing in
  `steering.ts` owns a node, reads a clock, or writes a transform.
- Path *following* already exists, and is a different thing: §12's
  `KinematicController.followPath` samples a §13 `Trajectory` and writes
  `transform.position` under `"kinematic"` authority. Steering's own header
  names path following as *not here*, because it needs a path type.
- Trajectory prediction (`prediction.ts`) and two-bone / CCD / FABRIK IK
  (`ik.ts`) both carry the same dated staging note: path-planning adapters wait
  on this RFC.
- **Robotic joint commands** are out of scope. Plan P8-1's MAY (a thin mapping
  over Phase 6 motors) was declined; the PID → `setMotor` hinge scenario in
  `tests/integration/motion-advanced.test.ts` already demonstrates the mapping
  without a wrapper. This RFC does not reopen that MAY.

The missing surface is a **cross-package contract** for planners that answer
"how do I get from here to there?" and hand the answer to steering — not a
second kinematic controller, and not a robotics command language.

Three planner families are in scope because they are the ones applications
actually ship, and they share one output shape:

| Family    | Input                                                                 | Typical algorithm                         |
| --------- | --------------------------------------------------------------------- | ----------------------------------------- |
| Grid      | occupancy / cost field on a regular lattice (2D XY or 3D)             | A\*, JPS, Dijkstra                        |
| Navmesh   | walkable triangles (2D or 3.5D) plus off-mesh links                   | funnel / string-pull, A\* on the dual     |
| Waypoint  | directed graph of named points, optional radii / portals              | A\* / Dijkstra on the graph               |

`@four/motion`'s frozen §3.1 row is `core, math, scene`. A planner that imported
`@four/physics` (collider occupancy) or `@four/geometry` (navmesh tessellation)
would add an edge the matrix forbids. The seam therefore has to be
**structural**: motion names the query and the path; the host or a plugin
supplies occupancy, triangles, or a graph.

This is the same shape as `PhysicsSolverAdapter` (§37), `FetchLike`, and
`SteeringNeighbor`: the engine names a contract, implementations live beside
or above it, and application code never names a particular planner for the
common case.

## Proposed decision

### 1. Home and layering

The adapter interface, the path record, and the steering consumer live in
`@four/motion` (`packages/motion/src/path-planning.ts`, beside `steering.ts`).
No new §98 package. No new §3.1 edge.

A planner implementation that needs physics queries or geometry processing is
a **plugin** (or application code) that *reads* those packages and *implements*
the motion-side interface. Motion never imports them.

### 2. The path a planner returns

A planned path is a **polyline of world-space waypoints**, plus the metadata
steering and diagnostics need. It is not a `Trajectory` and it is not a
node-owned command.

```ts
export interface PlannedPath {
  /** World-space waypoints, at least two, in travel order. Y-up (§7a). */
  readonly waypoints: readonly Vector3[];
  /** Optional corridor half-width per segment (world units). */
  readonly radii?: readonly number[];
  /** Planner that produced this path; informational. */
  readonly planner: string;
  /** Finite cost in the planner's own units (length, time, …). */
  readonly cost: number;
}

export interface PathQuery {
  readonly start: Vector3;
  readonly goal: Vector3;
  /** Optional agent radius in world units; default 0. */
  readonly radius?: number;
  /** Optional cap on expanded nodes / triangles. */
  readonly maxExpansions?: number;
}
```

Waypoints are copied at return. The planner does not retain the caller's
vectors. A query with a coincident start and goal, or with no route, is a
**reported miss** — `null` — not a throw, matching `interceptPoint`'s
no-solution policy (`prediction.ts`). Non-finite inputs and a
non-positive `maxExpansions` are authoring errors (`RangeError` / §85).

A `Trajectory` is a **consumer conversion**, not the planner's native output:
`plannedPathToTrajectory(path)` builds a `CatmullRomTrajectory` (or a
piecewise-linear `ParametricTrajectory`) so `KinematicController.followPath`
can consume the same plan. Conversion is opt-in. Steering never needs it.

### 3. The adapter

```ts
export interface PathPlannerCapabilities {
  readonly families: readonly ("grid" | "navmesh" | "waypoint")[];
  readonly dimensions: readonly ("2d" | "3d")[];
  /** Same-runtime is the floor this RFC requires of every adapter. */
  readonly determinism: DeterminismLevel;
}

export interface PathPlannerAdapter extends Disposable {
  readonly name: string;
  readonly version: string;
  readonly capabilities: PathPlannerCapabilities;
  plan(query: PathQuery): PlannedPath | null;
}
```

Rules the interface commits to:

- **`plan` is synchronous and pure** with respect to wall time: no
  `performance.now`, no `Date`, no `Math.random`. A planner that needs
  randomness takes a `SeededRandom` on construction (the wander precedent).
- **Iteration order is insertion order** of the planner's own nodes / cells /
  triangles (§33). Heap ties break by insertion index, never by pointer
  identity.
- **No user callbacks from inside `plan`.** A custom heuristic or cost is
  supplied at construction, not as a per-query closure the planner invokes
  while a heap is live — the same "never callbacks from inside `step`" rule
  §37 imposes on solvers, so a listener can rebuild a graph without
  re-entering a search.
- **`plan` does not write transforms** and does not consult
  `transformAuthority`. Authority stays with whoever consumes the path
  (steering → the caller; `followPath` → `"kinematic"`).

### 4. How the path feeds steering

Add one behaviour to `steering.ts`:

```ts
followWaypoints(
  agent: SteeringContext,
  path: PlannedPath,
  cursor: WaypointCursor,
  out: Vector3,
): Vector3;
```

`followWaypoints` is Reynolds seek toward `path.waypoints[cursor.index]`,
advancing the cursor when the agent is inside a finite arrival radius
(default: the path's per-segment `radii[i]`, else a caller-supplied
`arrivalRadius`). The last waypoint uses `arrive` so the agent stops.
`out` is an acceleration, like every other behaviour. The cursor is
caller-owned mutable state (`{ index: number }`); the behaviour does not
store it.

This is the fold P8-1 asked for: planners produce geometry, steering
produces acceleration, the caller integrates. Obstacle avoidance and wall
following remain out of this RFC — they need a collision query, which is a
different seam.

### 5. Built-in waypoint planner; grid and navmesh as adapters

`@four/motion` ships **one** built-in: a waypoint-graph planner
(`WaypointGraphPlanner`) over an insertion-ordered list of nodes and
directed edges. A\*, binary heap, optional edge costs. Enough to exercise
the interface and to cover "named points in a facility / level".

Grid and navmesh planners are **adapter implementations**, not motion
built-ins:

- A grid planner accepts a structural occupancy field
  `{ origin, cellSize, size, cost: Float64Array | ((ix, iy, iz) => number) }`.
  The cost callback, if used, is fixed at construction.
- A navmesh planner accepts a structural triangle soup
  `{ positions: Float64Array, indices: Uint32Array }` plus optional off-mesh
  links. Tessellation stays in `@four/geometry` or the application; motion
  only searches.

Neither implementation is required to land with the interface packet. The
RFC's job is the contract. A first grid A\* MAY ship in the same packet if
it stays small and has no new dependency; a navmesh funnel is a later
packet.

### 6. Plugin registration

§81 has no "path planners" row. This RFC does **not** add one to the
specification (that is an amendments-table change after acceptance). The
in-repo registration path is a new capability token in `@four/motion`,
declared the way `SIMULATION_SYSTEMS` already is:

```ts
export const PATH_PLANNERS =
  defineCapability<PathPlannerRegistry>("four:path-planners");
```

`PathPlannerRegistry` is `register(adapter)` / `resolve(name)` /
`list()`, explicit calls, never side-effect imports (RFC 0002's binding
rule). The token is **not revocable** (the conservative default). An
application that does not configure plugins constructs a planner with
`new` and never touches the registry.

### 7. Determinism, units, authority

- **Tier:** `same-runtime` is required. Same planner, same graph, same
  query, same seed → bit-identical waypoint coordinates. Cross-platform
  is not claimed (heap ordering on equal keys is pinned by insertion
  index so it does not depend on allocator addresses; float ties in cost
  still may).
- **Units:** world units and seconds only. A planner that thinks in
  "grid cells" converts at its own boundary; motion never sees cell
  indices in `PlannedPath`.
- **§42:** planning writes no transform. A kinematic consumer already
  has a path. A steering consumer writes acceleration; the authority of
  the node the caller integrates onto is the caller's problem, as it is
  for `seek` today.

### 8. Staging

**Interface packet (S).** `PathQuery`, `PlannedPath`,
`PathPlannerAdapter`, `WaypointGraphPlanner`, `followWaypoints`,
`plannedPathToTrajectory`, the `PATH_PLANNERS` token, analytic tests
(known graphs, miss → `null`, seek-along-waypoints reaches the last
point and stops, checksum identity of two plans of the same query).

**Deferred:** grid A\* if it does not fit the interface packet; navmesh
funnel; dynamic / moving-obstacle replanning; hierarchical (HPA\*)
planners; any occupancy built by reading `@four/physics` colliders
(application or plugin code). Robotic joint commands stay declined.

## Alternatives

**A. Treat `KinematicController.followPath` as the whole answer.** It
already follows a `Trajectory`. A planner would only need to emit one.
This loses the steering fold §111 asked for: kinematic follow *owns*
translation and samples time, which is the wrong contract for an agent
that must still flee, separate, and arrive. Steering outputs a
*contribution*; kinematics replaces the channel. Both consumers are
real; only a waypoint record serves both.

**B. Put planners in `@four/physics`.** Attractive for "occupancy is
colliders". It loses on layering: physics is wave 4 and already depends
on motion; a planner that steering must call cannot live above it
without a cycle. Occupancy derived from colliders is a plugin that
implements `PathPlannerAdapter`, not a reason to move the interface.

**C. A new `@four/navigation` package.** Clean isolation, and navmesh
generation is large enough to want one. It loses on §98 and plan §3.1:
new top-level packages need an owner amendment. This RFC can be accepted
without that. If a navmesh packet later needs its own home, that is a
follow-up RFC that *adds* a package; it should not gate the adapter.

**D. Callback-per-query heuristics and cost.** The nicest research API
(`plan(query, { heuristic, cost })`). It re-enters user code from inside
the heap, which is how a listener mutates the graph mid-search. Rejected
for the same reason §37 forbids callbacks from `step`.

**E. Make the planner produce a `Trajectory` only.** Then steering must
sample time, which it does not have (P8-2: no clock). A polyline plus an
opt-in conversion keeps time on the kinematic side.

**F. Include robotic joint commands.** Declined already. A joint command
is an actuation mapping (`PID` → `setMotor`), not a spatial search.

## Consequences

**Easier.** Steering agents can chase a planned corridor without the
application re-deriving seek-along-waypoints. Kinematic `followPath`
keeps working: convert the same plan. Third-party grid / navmesh /
Recast-style planners have a stable place to plug in without forking
motion. The PH-22 / P8-1 residue becomes a packet instead of a note.

**Harder.** Motion gains another public interface that implementations
must keep honest (capabilities, miss policy, insertion-order ties).
Applications will ask for "just bake occupancy from the physics world";
the answer is a plugin, and that answer will need repeating. Dynamic
worlds (doors, moving platforms) are not designed here and will attract
follow-up pressure.

**Committed to.** The output is a waypoint polyline. `plan` is
synchronous, callback-free, and wall-clock-free. Steering consumes paths
as accelerations. No new package. No robotics wrapper. Same-runtime
determinism is the floor.

## Compatibility analysis

Rows in `docs/COMPATIBILITY.md` this RFC moves:

- **Public API (§90).** Additive. New exports from `@four/motion`
  (`PathPlannerAdapter`, `PathQuery`, `PlannedPath`,
  `WaypointGraphPlanner`, `followWaypoints`, `plannedPathToTrajectory`,
  `PATH_PLANNERS`). Re-exported through the umbrella barrels per §97a.
  **Minor.** No closed union widens.
- **Scene format versions (§79).** Unmoved. A planned path is a runtime
  value, not a node. A future document that *names* a registered planner
  (by `name` string, never a module specifier) is a later packet and
  would be additive.
- **Plugin API versions (§81).** Additive token `four:path-planners`.
  `PLUGIN_API_VERSION` does not need a bump for a new optional
  capability — existing plugins do not require it. Record the token in
  §5 of `COMPATIBILITY.md` when the packet lands. No solver
  `capabilities` change; do not regenerate the adapter block.
- **WebGPU/WebGL feature tiers / solver adapters.** Unmoved.

## Prototype / benchmark

None run; this is a design decision ahead of a packet. What the
interface packet must measure:

1. **Correctness oracles.** A 4-neighbour grid with one corridor, and a
   4-node waypoint diamond, each compared against an independent A\*
   written in the test. Miss cases (`null`) for a blocked goal and a
   disconnected graph.
2. **Steering fold.** An agent under `followWaypoints` + `arrive` on the
   last point reaches the goal and stays; adding `separation` against a
   neighbour still converges. Two runs, same seed, bit-identical
   positions (§33).
3. **Cost.** `plan` on a 256×256 open grid and a 256×256 maze, reported
   as microseconds / expansions, so a later navmesh packet has a number
   to beat. Not a gate.
4. **Bundle.** `followWaypoints` and the waypoint planner must be absent
   from example bundles that do not name them (A/B grep, §62-registry
   style). Target: zero delta on first-2d-scene / ui-demo.

## Open questions

1. **Does the first packet include grid A\*, or only the waypoint graph
   plus the interface?** Recommendation: waypoint only, unless the grid
   implementation stays under ~200 lines and has no new dependency.
2. **Arrival radius default.** Per-segment `radii` vs a single
   `PathQuery.radius`. Recommendation: query radius is the agent's body;
   path radii are the corridor; `followWaypoints` uses
   `max(agentRadius, radii[i] ?? 0)` and requires the caller to pass
   `agentRadius` (no silent 0.5).
3. **Should `PATH_PLANNERS` wait for a §81 amendment?** The token can
   ship as motion-side infrastructure (like `SIMULATION_SYSTEMS`) without
   adding a twelfth bullet to §81. Recommendation: ship the token; amend
   §81 only if the owner wants planners listed beside solvers.
4. **3D navmesh vs 2D-on-a-plane.** Recommendation: the interface is
   3D (`Vector3`); a 2D planner zeros `z` and declares
   `dimensions: ["2d"]`. No separate 2D path type.
