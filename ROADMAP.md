# four.js Roadmap

The release ladder below is **normative** — it reproduces §94 (Release Strategy) of
[`docs/SPECIFICATION.md`](docs/SPECIFICATION.md). Everything else on this page (phase
mapping, MVP notes) is guidance that points back at the spec and the implementation plan.

This repository is currently at the scaffold-and-specification stage; nothing on this
roadmap has shipped yet.

## Releases (§94)

| Release | Scope (§94) |
|---|---|
| **0.1** | math, scene, time, and basic WebGL rendering |
| **0.2** | native 2D shapes, sprites, text, and picking |
| **0.3** | 3D meshes, materials, lights, shadows, and mixed scenes |
| **0.4** | motion, tweens, timelines, and path animation |
| **0.5** | first physics adapter, bodies, colliders, forces, and collision events |
| **0.6** | joints, motors, animation-physics blending, and replay |
| **0.7** | assets, glTF, serialization, UI, and accessibility |
| **0.8** | WebGPU preview, render graph, compute particles, and workers |
| **0.9** | optimization, conformance, API stabilization, and production trials |
| **1.0** | stable API, stable scene format, compatibility policy, full documentation |

## Dates

**No dates are set up front.** §94 defines an ordered ladder of scope, not a calendar. A
target date is fixed per release, when the preceding release closes and the next one's work
packets are decomposed. Any date published for 0.1 says nothing about 0.2.

## MVP

The MVP contents are defined by **§120 (MVP Requirements)** of
[`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) — read that section as the authority; it is
not restated here. In outline it covers Scene, Time and Motion, Animation, Physics,
Rendering, Interaction, and Tooling, and it deliberately narrows the surface: **WebGL 2
only, one solver adapter, basic 2D/3D primitives**.

§120 calls its list "the first meaningful release" without naming a release number. Its
contents span the 0.1–0.5 rungs above plus the interaction and tooling items, so the §120
checklist is not complete at 0.1; treat it as a gate on the early ladder as a whole rather
than on any single release.

## Phases and how they map to releases

The executable plan is [`docs/plans/IMPLEMENTATION_PLAN.md`](docs/plans/IMPLEMENTATION_PLAN.md)
(phases 0–11, spec §103–§113a, decomposed into work packets). **That plan is the authority
on which phase delivers what**; the mapping below is indicative only, because §94's rungs
and the plan's phases are not a one-to-one correspondence.

| Release | Phases that feed it |
|---|---|
| 0.1 | Phases 0–2 (foundation, math/scene/time, motion foundation), with phase 3's renderer foundation supplying "basic WebGL rendering" |
| 0.2 | Phases 3 / 3a (renderer foundation; input, picking, dragging, sprites, MVP-tier text) |
| 0.3 | Continued renderer work after phase 3a — 3D materials, lights, shadows, mixed scenes; no dedicated numbered phase |
| 0.4 | Phase 4 (animation core), building on phase 2's motion foundation |
| 0.5 | Phase 5 (physics API + first solver adapter) |
| 0.6 | Phases 6 (joints), 7 (physics-animation blending), and 10 (replay, snapshots, diagnostics) |
| 0.7 | Phase 11 (assets, serialization, UI, tooling) |
| 0.8 | Phase 9 (particles and GPU motion) plus the WebGPU backend |
| 0.9 | Hardening, conformance, and API stabilization across all packages |
| 1.0 | Stabilization only: freeze the API and scene format, publish the compatibility policy and documentation |

Two seams worth naming explicitly:

- **Phase 8 (advanced motion — steering, IK, PID; §111)** has no line of its own in §94. It
  is scheduled by the implementation plan, not by the release ladder.
- **Release 0.3** likewise has no dedicated phase; it is renderer work that continues past
  the phase 3a exit.

Neither seam is licence to amend §94 or §103–§113a. Where this page and the specification
disagree, the specification wins.
