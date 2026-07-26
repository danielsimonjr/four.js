# Specification Errata

Known internal defects in [`four-js-specification.pdf`](four-js-specification.pdf) (65 pages) and its
extracted rendering [`SPECIFICATION.md`](SPECIFICATION.md).

These are **defects in the source document**, not in this repository's scaffold. They are recorded
here because the specification is published in `docs/` as-is and would otherwise mislead a reader.
The PDF remains the authoritative source; nothing in it has been altered.

Line numbers refer to `SPECIFICATION.md`. Locate any entry by searching the quoted heading text.

---

## E-1 — `Part VII` is used for two different parts

The document contains **two distinct parts both labelled `Part VII`**:

| Occurrence | Heading | Covers |
|---|---|---|
| First | `Part VII - Complete Graphics, Rendering, Application, and Platform Architecture` | §45 *Application Model* → §67 *Clipping, Masks, and Stencils* |
| Second | `Part VII - Package Architecture` | §45 *Proposed Monorepo* → §49 *Solver Packages* |

Every other part label is unique and sequential (`Part I` … `Part XII`), so this is an isolated
numbering error. Based on position, the second occurrence should almost certainly be a **new part
between the first `Part VII` and `Part VIII - Implementation Plan`**.

**Status:** unresolved — requires a decision from the specification's author.

---

## E-2 — Section numbers 45–67 are assigned twice ⚠ most consequential

A direct consequence of E-1: the second `Part VII` **restarts section numbering at 45**, so the
range **45–67 is used twice**. Any cross-reference such as "see §49" is therefore **ambiguous**.

Examples of the collision:

| § | First meaning | Second meaning |
|---|---|---|
| 45 | Application Model | Proposed Monorepo |
| 46 | Scene Queries, Layers, and Tags | Motion Package |
| 47 | Camera System | Animation Package |
| 48 | Viewports and Render Surfaces | Physics Package |
| 49 | Renderable Node Hierarchy | **Solver Packages** |
| 60 | Shader and Node-Material System | Phase 10 — Replay, Snapshots, Diagnostics |
| 67 | Clipping, Masks, and Stencils | MVP Requirements |

**Disambiguation convention used in this repository:** where a section in the 45–67 range is cited,
qualify it by part — e.g. **"§49 (Solver Packages)"** rather than bare "§49".

**Status:** unresolved — requires renumbering in the source document.

---

## E-3 — Solver packages named in §49 are missing from the §45 monorepo tree

**§49 (Solver Packages)** names four solver adapter packages:

```
@four/physics-rapier
@four/physics-box2d
@four/physics-matter
@four/physics-cannon
```

**§45 (Proposed Monorepo)** lists only `physics-rapier`, `physics-box2d`, and `physics-soft`.
So `physics-matter` and `physics-cannon` are specified as packages but absent from the tree, while
`physics-soft` (a soft-body package, not a solver adapter) appears only in the tree.

A full cross-check of every `@four/<pkg>` reference in the document against the §45 tree found
**these two and no others**.

**Status: RESOLVED for this repository.** The project owner chose **the §45 tree as written**, so the
scaffold contains `physics-rapier`, `physics-box2d`, and `physics-soft` only. `physics-matter` and
`physics-cannon` are **deliberately not present** and should not be added without a decision to
amend the specification.

---

## Non-defects (checked and dismissed)

Recorded so they are not "rediscovered" later:

- **Section 65 is not missing.** It exists as `65. "One Scene, Everything Moves"`. It is easy to miss
  with a heading scan because its title begins with a typographic quote rather than a letter.
- **Repeated low numbers (1., 2., 3., …) scattered through the text are numbered *lists*,** not
  sections — e.g. the four fundamentals in §1 *Vision*. Only the 45–67 range is a genuine collision.
- **Text artifacts in `SPECIFICATION.md`** such as `T agline` / `T arget` are PDF text-extraction
  kerning artifacts, not errors in the specification. The PDF is authoritative.
