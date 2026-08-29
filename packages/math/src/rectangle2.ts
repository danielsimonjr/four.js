import { noteConstruction } from "./alloc-counter.js";

/**
 * Default tolerance for {@link Rectangle2.equalsApprox}. See `vector2.ts` for
 * the rationale; every type in the family uses the same value.
 */
const DEFAULT_EPSILON = 1e-6;

/**
 * Mutable axis-aligned rectangle (§7b) — `x`/`y` is one corner, `width` and
 * `height` extend it along the two axes.
 *
 * Which corner `x`/`y` names is deliberately **not** decided here: a rectangle
 * is four numbers, and the space it measures belongs to the API that takes it.
 * §61's `readPixels(target, region)` — the first consumer, and the reason this
 * type exists (RFC 0005's recorded prerequisite) — reads `x`/`y` as the
 * region's **bottom-left** corner in target texels, matching the §7a Y-up
 * bottom-to-top row order its result is defined in; §55's sprite `frame` will
 * document its own atlas convention when it lands. Each consumer states its
 * origin, exactly as `Viewport` documents its own rectangle.
 *
 * Validation posture (§85, per the family): none. Like `Vector2`, this type
 * stores what it is given — negative or fractional extents included — and the
 * API that consumes a rectangle enforces its own §85 constraints (a readback
 * region must be integral and inside the target; a UV frame need not be).
 *
 * Allocation policy (§7b, plan D7): instance methods that produce a
 * "this-shaped" result mutate in place and return `this`; only
 * {@link Rectangle2.clone} allocates. Scalar queries (`containsPoint`,
 * `isEmpty`) and `equalsApprox` never allocate and never mutate.
 *
 * Change notification (plan D3): every mutator invokes
 * {@link Rectangle2.onChanged} after writing. Direct field writes
 * (`r.width = 8`) bypass the hook by design and require an explicit
 * `markDirty()` on the owner.
 */
export class Rectangle2 {
  x: number;
  y: number;
  width: number;
  height: number;

  /**
   * Optional change hook invoked at the end of every mutator. Engine-internal:
   * owners install it, user code normally leaves it unset. It is intentionally
   * *not* copied by {@link Rectangle2.copy} or {@link Rectangle2.clone} — the
   * hook belongs to the owner of the instance, not to the value.
   */
  onChanged?: () => void;

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    noteConstruction();
  }

  /** Sets all four components. */
  set(x: number, y: number, width: number, height: number): this {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.onChanged?.();
    return this;
  }

  /** Copies the components of `r` into this rectangle. The change hook is not copied. */
  copy(r: Rectangle2): this {
    this.x = r.x;
    this.y = r.y;
    this.width = r.width;
    this.height = r.height;
    this.onChanged?.();
    return this;
  }

  /**
   * Allocates a new rectangle with the same components. The clone has no
   * change hook. This is the only allocating method on the type (§7b).
   */
  clone(): Rectangle2 {
    return new Rectangle2(this.x, this.y, this.width, this.height);
  }

  /**
   * Whether this rectangle covers no area — a non-positive `width` or
   * `height`. Does not mutate.
   */
  isEmpty(): boolean {
    return this.width <= 0 || this.height <= 0;
  }

  /**
   * Whether the point lies inside this rectangle, **half-open on both axes**:
   * the `x`/`y` edge is inside, the `x + width` / `y + height` edge is out.
   * Half-open is what makes adjacent rectangles partition a space with no
   * point in two of them — the texel-region semantics §61's first consumer
   * needs. Does not mutate; an empty rectangle contains nothing.
   */
  containsPoint(x: number, y: number): boolean {
    return (
      x >= this.x &&
      x < this.x + this.width &&
      y >= this.y &&
      y < this.y + this.height
    );
  }

  /**
   * Component-wise approximate equality: true when every component differs by
   * at most `epsilon` (absolute tolerance).
   */
  equalsApprox(r: Rectangle2, epsilon: number = DEFAULT_EPSILON): boolean {
    return (
      Math.abs(this.x - r.x) <= epsilon &&
      Math.abs(this.y - r.y) <= epsilon &&
      Math.abs(this.width - r.width) <= epsilon &&
      Math.abs(this.height - r.height) <= epsilon
    );
  }
}
