/**
 * §67 clipping — a node's drawn shape masks its subtree, expressed entirely in
 * §57 stencil records (R-23, 2026-08-21).
 *
 * ```ts
 * panel.clip = true;          // @four/scene: this node's shape clips its subtree
 * buildRenderList(scene, list);
 * // list[0] is the panel's *mask* draw; every descendant item carries the
 * // stencil test that keeps it inside.
 * ```
 *
 * ## The tier this ships, against §67's list
 *
 * §67 names eight mechanisms: rectangular scissor clipping, path masks, alpha
 * masks, stencil masks, nested clipping, UI overflow clipping, 3D clipping
 * planes, and section views. This module ships **stencil masks, nested
 * clipping, and UI overflow clipping**, with the mask source being *any*
 * drawable node — so a §50 `Shape` carrying a rounded-rectangle path is a path
 * mask for free, an axis-aligned rectangle is the scissor case expressed the
 * same way, and §73's scroll view has the primitive it needs. Alpha masks
 * (which need the fragment's alpha to reach the stencil op, i.e. alpha-to-
 * coverage or a discard variant), 3D clipping planes (a per-pipeline uniform
 * and a shader edit, not a stencil at all), and true `scissor` rectangles (a
 * per-draw `gl.scissor`, cheaper than a mask but only for axis-aligned screen
 * rectangles) are **not** here and are named so that the next packet knows what
 * it is picking up.
 *
 * Deciding the tier by *mechanism* rather than by *fraction of the list* is
 * R-7's rule applied one level up: R-7 shipped §57's `stencil` member
 * completely rather than six clipping mechanisms partly, and this packet ships
 * three of the eight completely rather than eight approximately.
 *
 * ## The shape of the design
 *
 * A clip is one extra draw and one extra field:
 *
 * 1. a clip node emits a **mask item** — its own geometry, colour and depth
 *    writes off, writing its bit plane into the stencil buffer;
 * 2. every item in its subtree carries a **test record** — `func: "equal"` over
 *    the accumulated bits of every enclosing clip — so a fragment reaches the
 *    colour buffer only where *all* of them wrote.
 *
 * Nesting therefore intersects by construction and costs nothing extra: two
 * clips owning bits 0 and 1 make their common subtree test `0b11`, which passes
 * exactly on the intersection. No clip needs to know about any other, no mask
 * needs to be drawn inside another mask, and the whole arrangement is one
 * unsigned integer per subtree.
 *
 * Mask items sort **before every other item in the list** (`render-list.ts`'s
 * comparators carry the test as their first key), so the buffer is complete
 * before the first clipped fragment is tested, whatever §66's other keys do to
 * the content. They are exempt from §46's layer filter and from §87's frustum
 * cull for the same reason: a mask is not content. A view that dropped a mask
 * would not draw *less* of that clip's subtree, it would draw **none** of it —
 * failing toward the invisible, which is the failure mode this whole module
 * avoids (see {@link ClipPlaneAllocator}).
 *
 * ## Frame state, applied per view
 *
 * Plane assignment happens once per **frame**, during the one traversal
 * `render-list.ts` performs (R-8: the frame builds one list and a view queries
 * it). The mask *draws* then happen once per **view**, at the head of each
 * view's derived list, after that view's clear — which is where they have to
 * be, because a stencil buffer is one per surface and each view clears it. A
 * clip's bit plane is consequently the same in every view of a frame, which is
 * what lets one shared test record serve them all.
 *
 * ## Byte identity
 *
 * A scene with no clips allocates no plane, emits no mask item, and leaves
 * every item's {@link RenderItem.clip} `null` — so every comparator key added
 * here compares equal, the backend's `clip ?? material.stencil` resolves to
 * exactly what it resolved to before, and not one GL call is added or moved.
 */

import { DEV, devWarn } from "@four/core";
import type { StencilFunc, StencilOp } from "@four/materials";

/**
 * How many clips one frame can carry: eight, because every stencil buffer
 * WebGL 2 can allocate is 8 bits deep (`STENCIL_INDEX8` and
 * `DEPTH24_STENCIL8`, R-7) and this design spends one **bit plane** per clip.
 *
 * A plane per clip rather than a counter per nesting *depth* is the only
 * assignment that is correct for siblings: two clips at the same depth writing
 * the same plane would each pass the other's test, so a scroll view would show
 * its neighbour's content. The price is that the limit counts *clips in the
 * frame*, not *nesting levels* — which is the number §67 asks for a diagnostic
 * about, and {@link ClipPlaneAllocator} emits it.
 */
export const MAX_CLIP_PLANES = 8;

/**
 * A stencil configuration as a **render item** carries it — structurally
 * identical to §57's `StencilState`, and deliberately not that class.
 *
 * `@four/materials`' `StencilState` is nominal (private fields) precisely so
 * that `material.ts` can import it type-only and a bundle that never masks does
 * not carry it (R-7, measured at 0.62 kB gzip). Constructing one here would
 * undo that for every bundle that carries a render list — i.e. all of them — so
 * this module builds plain records instead and the backend, which has always
 * read §57's state structurally, cannot tell the difference. The two string
 * unions are imported `import type`, which costs nothing at runtime.
 *
 * Every field is present, so a backend's defensive `?? default` reads never
 * fire on one of these.
 */
export interface RenderItemStencil {
  /** The comparison; see `StencilFunc`. `(ref & readMask) OP (stored & readMask)`. */
  readonly func: StencilFunc;
  /** The reference value, 0…255. */
  readonly ref: number;
  /** The bits the test looks at, 0…255. */
  readonly readMask: number;
  /** The bits a write may change, 0…255; `0` for a read-only test. */
  readonly writeMask: number;
  /** Stored on stencil-test failure. */
  readonly failOp: StencilOp;
  /** Stored when the stencil test passes and the depth test fails. */
  readonly depthFailOp: StencilOp;
  /** Stored when both tests pass. */
  readonly passOp: StencilOp;
}

/**
 * What §67 clipping asks of one draw — the record a {@link RenderItem} carries
 * in its `clip` field.
 *
 * Two kinds of draw carry one:
 *
 * - a **mask** draw (`maskPass: true`), which is a clip node's own geometry
 *   punching its bit plane into the stencil buffer. A backend must force colour
 *   writes, depth writes, and the depth test **off** for it, whatever the
 *   material says: a mask contributes no pixels and must not occlude, be
 *   occluded by, or be depth-rejected against the content it masks;
 * - a **clipped** draw (`maskPass: false`), which is any item inside a clip's
 *   subtree. Its `stencil` is a read-only test (`writeMask: 0`) and the rest of
 *   its §57 state is its material's, untouched.
 *
 * The object is **pooled per bit plane and per frame**, and its identity is
 * meaningful: two items carrying the *same* record are under the same set of
 * clips, which is what lets §65's batcher break a run on `!==` without
 * comparing seven fields.
 *
 * A clipped item's record takes precedence over its material's own `stencil`
 * (§57). That is a deliberate, documented collision: a material that names a
 * stencil is composing a mask by hand — R-7's tier — and a node that also
 * declares a clip is asking the engine to compose one for it. Letting the
 * engine's win keeps the clip's *containment* guarantee true, which is the one
 * an author cannot restore by hand once it is broken.
 */
export interface RenderItemClip {
  /** The stencil state this draw runs under. */
  readonly stencil: RenderItemStencil;
  /** Whether this draw *writes* the mask rather than being tested by it. */
  readonly maskPass: boolean;
}

/** A {@link RenderItemStencil} the allocator rewrites in place. */
interface MutableStencil {
  func: StencilFunc;
  ref: number;
  readMask: number;
  writeMask: number;
  failOp: StencilOp;
  depthFailOp: StencilOp;
  passOp: StencilOp;
}

/** A {@link RenderItemClip} the allocator rewrites in place. */
interface MutableClip {
  readonly stencil: MutableStencil;
  readonly maskPass: boolean;
}

/** One bit plane's two records — the mask draw's, and its subtree's. */
interface ClipPlaneRecord {
  readonly write: MutableClip;
  readonly test: MutableClip;
}

/**
 * What {@link ClipPlaneAllocator.allocate} hands back: the clip a node's
 * subtree inherits, and the mask draw that makes it true.
 */
export interface ClipScope {
  /** Accumulated bit planes of this clip and every enclosing one. */
  readonly bits: number;
  /** The record every item in the subtree carries. */
  readonly test: RenderItemClip;
  /** The record the clip node's own mask draw carries. */
  readonly write: RenderItemClip;
}

/** Builds one plane's pooled pair, with the fields that never change set. */
function createPlaneRecord(): ClipPlaneRecord {
  return {
    // `always`/`replace` with the reference *and* the write mask set to this
    // plane's bit writes a 1 into that bit and leaves the other seven alone —
    // which is what lets eight clips share one buffer.
    write: {
      maskPass: true,
      stencil: {
        func: "always",
        ref: 0,
        readMask: 0xff,
        writeMask: 0,
        failOp: "keep",
        depthFailOp: "keep",
        passOp: "replace",
      },
    },
    // `equal` with the reference and the read mask both set to the accumulated
    // bits passes exactly where every one of those planes was written — the
    // intersection, with no per-clip bookkeeping. `writeMask: 0` makes the
    // three operations inert, which is R-7's recorded spelling of "read-only".
    test: {
      maskPass: false,
      stencil: {
        func: "equal",
        ref: 0,
        readMask: 0,
        writeMask: 0,
        failOp: "keep",
        depthFailOp: "keep",
        passOp: "keep",
      },
    },
  };
}

/**
 * Assigns §67's bit planes to the clips of one frame, in traversal order, and
 * emits §67's required diagnostic when they run out.
 *
 * One allocator per render list (`render-list.ts` keeps it in the list's pool),
 * reset by {@link ClipPlaneAllocator.begin} at the start of every build, so
 * plane 0 is always the first clip the depth-first walk meets. **Traversal
 * order, never `Map` order** (§33): the same scene built twice assigns the same
 * planes, and a plane number is therefore a deterministic function of the scene
 * rather than of insertion history in a hash table.
 *
 * ## The ninth clip (§67's "diagnostics when backend limits are exceeded")
 *
 * The ninth clip of a frame gets no plane. §61 forbids throwing inside a frame,
 * so the limit is a **warning plus a defined behaviour**, and the behaviour is
 * the one that fails toward *drawing*:
 *
 * - the over-limit clip is **dropped**. Its subtree keeps every clip it
 *   inherited — up to eight of them — and simply is not narrowed by this one;
 * - it is not "unclipped": the region drawn is the intersection of the eight
 *   constraints that did fit, which is a **superset** of the region the author
 *   asked for. Content spills outside the ninth boundary and nothing that
 *   should be visible disappears.
 *
 * The alternative — dropping the *subtree*, i.e. failing toward fully clipped —
 * was rejected on the R-8 precedent ("cannot be bounded ⇒ drawn"). A spill is a
 * visible, localized, diagnosable artefact that points straight at the clip
 * that caused it; a vanished subtree is indistinguishable from a scene-graph
 * bug, a culling bug, a material bug, or a camera bug, and the warning that
 * would explain it is in a console the author may never open. Between two wrong
 * pictures, prefer the one that shows the content **and** the mistake.
 *
 * The warning fires **once per allocator**, not once per exhausted build: an
 * over-budget scene is over budget on every frame it renders, and a warning
 * repeated at the frame rate hides its own first line — the same argument
 * behind §42's once-only authority-conflict warning and §39's once-only
 * undispatched-queue warning. `begin` therefore resets the *plane counter* and
 * not the warned flag; the message names the first clip refused, which is the
 * one an author goes looking for.
 */
export class ClipPlaneAllocator {
  /** Pooled records, indexed by bit plane; grown once, to at most eight. */
  readonly #planes: ClipPlaneRecord[] = [];

  /** Planes handed out so far this build. */
  #used = 0;

  /**
   * Whether this allocator has ever warned about exhaustion (§67, §61) —
   * deliberately **not** reset by {@link ClipPlaneAllocator.begin}; see the
   * class documentation for why the warning is once per allocator rather than
   * once per frame.
   */
  #warned = false;

  /** How many clips this build has refused, for the diagnostic's count. */
  #refused = 0;

  /**
   * Resets the allocator for a new build. Called by both list builders before
   * traversal, so plane numbers are a function of the scene and not of how many
   * frames have been drawn.
   */
  begin(): void {
    this.#used = 0;
    this.#refused = 0;
  }

  /** How many bit planes this build has assigned; 0…{@link MAX_CLIP_PLANES}. */
  get used(): number {
    return this.#used;
  }

  /**
   * Assigns the next bit plane to a clip whose enclosing clips have written
   * `inheritedBits`, or returns `null` when the frame's eight planes are gone.
   *
   * `nodeId` appears only in the diagnostic, and only in a development build.
   *
   * @returns the subtree's clip and the mask draw's, or `null` — in which case
   * the caller keeps the clip it already had (see the class documentation).
   */
  allocate(inheritedBits: number, nodeId: string): ClipScope | null {
    if (this.#used >= MAX_CLIP_PLANES) {
      this.#refused += 1;
      if (DEV && !this.#warned) {
        this.#warned = true;
        devWarn(
          `§67: this frame uses more than ${String(MAX_CLIP_PLANES)} clips, ` +
            "and a stencil buffer has only that many bit planes. The clip on " +
            `node "${nodeId}" is ignored: its subtree is still clipped by the ` +
            `${String(MAX_CLIP_PLANES)} clips that did fit, so content may ` +
            "spill outside this one's boundary rather than disappear. Reduce " +
            "the number of clipped subtrees drawn in one frame (hiding an " +
            "off-screen clip releases its plane).",
        );
      }
      return null;
    }
    const plane = this.#used;
    this.#used = plane + 1;
    let record = this.#planes[plane];
    if (record === undefined) {
      record = createPlaneRecord();
      this.#planes[plane] = record;
    }
    const bit = 1 << plane;
    const bits = inheritedBits | bit;
    record.write.stencil.ref = bit;
    record.write.stencil.writeMask = bit;
    record.test.stencil.ref = bits;
    record.test.stencil.readMask = bits;
    return { bits, test: record.test, write: record.write };
  }

  /** How many clips this build refused for want of a plane (§84). */
  get refused(): number {
    return this.#refused;
  }
}
