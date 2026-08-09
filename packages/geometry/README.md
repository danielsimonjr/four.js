# @four/geometry

Geometry primitives and buffers. Part of [four.js](../../README.md).

Implements the MVP tier of §50–53 in [`docs/SPECIFICATION.md`](../../docs/SPECIFICATION.md); shipped in Phase 3 (§106). Coordinates follow the §7a right-handed Y-up convention.

## What's here

- **`BufferGeometry`** — positions, optional normals, index (`GeometryIndexArray`), draw mode (`GeometryDrawMode`, including `"lines"`), and bounds (`GeometryBounds`).
- **2D primitive factories** — `boxGeometry`, `planeGeometry`, `circleGeometry2D`, `polygonGeometry2D`, each with an options type.
- **3D primitive factories** — `sphereGeometry`, `cylinderGeometry`, `coneGeometry`, `capsuleGeometry`, `torusGeometry`, `latheGeometry`, `tubeGeometry`, `extrudeGeometry`, `heightFieldGeometry`.
- **`Path`** (§51) — the six segment kinds, a fluent builder, flatten / subdivide / simplify / reverse / transform, length and point/tangent/normal evaluation, closest-point queries, and `fillRings` for the two fill rules.
- **Tessellation** (§52) — `triangulatePolygon` (ear clipping with bridged holes) behind the `PolygonTessellator` seam, and `expandStroke`, which widens polylines into §58's stroke band: alignment, butt/round/square caps, miter/round/bevel joins with a miter limit, and dashes with a phase offset. `Path.polylines` is the flattening it takes, closedness and all.
- **SVG path data** (§50) — `parseSvgPathData` reads a `d` attribute into a `Path`, `formatSvgPathData` writes one back out. Coordinates are transcribed verbatim: SVG's Y-down user space is **not** flipped, because the transform that would land it in a Y-up world needs the document's `viewBox`. See the module header for the whole argument and the one-line correction.

_Corrected 2026-08-09 (gap `R-26`): this section listed only `BufferGeometry` and "`boxGeometry`, `planeGeometry`, and `circleGeometry2D`", and the section below said the path model and tessellation were "staged / not yet implemented". Both shipped — tessellation on 2026-08-09 (`R-25`), the path model the same day (`R-24`), and the SVG bridge with this change._

## Staged / not yet implemented

- **Offset paths, and Boolean geometry operations** (union, intersection, subtraction, xor) — §51's remaining four operations. The offset now has §58's join model (`expandStroke`, gap `R-16`) but is a different output — a `Path`, not triangles; the booleans need the planar subdivision §52's self-intersection support also needs, and the two should be built once, together.
- **Anti-alias fringe generation** — §52's remaining half. A fringe is a second band carrying a coverage ramp, and a ramp needs a per-vertex coverage attribute no §57 pipeline reads: it is a pipeline decision, and it lands with the `ShapeMaterial` packet that owns that pipeline.
- **SVG documents** — `<svg>` markup, `viewBox`, `transform`, `<g>`, and the basic shape elements. Parsing markup needs an XML reader, and the only one every environment ships is `DOMParser`, which Node does not have; the seam is a decision, not an oversight. The shape elements are §50's shape nodes (gap `R-23`) rather than geometry.

Unit tests are colocated in `tests/` per §92.

Workspace name `@four/geometry`; publishes as `@danielsimonjr/fourjs-geometry`.
