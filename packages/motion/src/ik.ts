/**
 * Analytic two-bone inverse kinematics (§111 "inverse kinematics"; plan P8-1).
 *
 * One solver: {@link solveTwoBoneIK}, the law-of-cosines solution for a chain of
 * exactly two bones — shoulder/elbow/hand, hip/knee/foot, the two links of a
 * robot arm. It is closed form, allocation-free, and pure (§33): the same inputs
 * always produce the same pose, with no iteration count, tolerance, or seed to
 * tune.
 *
 * ## What is staged (2026-08-02, plan P8-1)
 *
 * §111 lists "inverse kinematics" without bounding it. Only the two-bone
 * analytic case ships here, because it is the one that has an exact answer.
 * **Staged, not dropped:**
 *
 * - **CCD** and **FABRIK** (iterative solvers for chains of arbitrary length) —
 *   they need a joint/skeleton model (per-joint limits, chain ownership, a
 *   convergence and iteration-budget contract) that Phase 8 does not define, and
 *   an honest test for either is a convergence test, not an identity. The
 *   skeleton model now exists — `@four/scene`'s `Bone`/`Skeleton` (RFC 0003,
 *   2026-08-28), whose bones are ordinary nodes this solver can already aim —
 *   but the limits/ownership/convergence contract is still undefined, so both
 *   stay staged with that as the remaining blocker.
 * - **Joint limits, twist, and full-body/multi-effector IK** — same remaining
 *   reason: a chain exists, its constraint contract does not.
 * - **Path-planning adapters** (§111) — pending an adapter RFC.
 *
 * Nothing here fakes any of that: this file solves two bones and says so.
 *
 * ## Output: positions, not joint angles (decision, WP-8.3)
 *
 * {@link solveTwoBoneIK} returns the **world positions** of the middle joint and
 * of the chain tip ({@link TwoBoneIKSolution}), not Euler angles or quaternions.
 * Angles are not convention-free: turning this pose into rotations requires a
 * pinned bone-orientation convention (which local axis points down the bone, how
 * the roll around it is chosen, what the rest pose is), and this repository
 * deliberately pins none — RFC 0003's adopted disposition (2026-08-28): the
 * engine imposes **no** bone-axis convention on the data model, because the
 * inverse bind matrix absorbs whatever convention an authoring tool used, so a
 * `Bone`'s local frame stays arbitrary and this solver stays correct as
 * written. Positions are the whole geometric answer and the caller can build
 * whatever rotation its rig wants from `root → joint → end` plus its own rest
 * pose. A rotation-producing wrapper, when one lands, uses **+Y as the bone's
 * length axis** — RFC 0003's *helper* convention, matching §7a's Y-up world,
 * a promise about helpers and never about authored rigs — and layers on this
 * without changing it.
 *
 * ## Conventions
 *
 * Right-handed, Y-up, radians, world-space vectors throughout (§7a/§7b); no
 * times are involved, so nothing here is a rate. Lengths are world units.
 *
 * ## Allocation (§7b, plan D7)
 *
 * Solving allocates nothing when an `out` solution is passed (build one with
 * {@link createTwoBoneIKSolution} and reuse it). Two module-level scratch
 * vectors hold the chain frame; they are fully written before they are read on
 * every call, so they carry no state between calls and are never part of a
 * determinism checksum (§33). There is no callback anywhere in this file, so the
 * scratch cannot be re-entered.
 */

import { Vector3 } from "@four/math";

/**
 * Below this length a direction is treated as undefined rather than normalized
 * (world units). It is the same order as the coincident-point floor the
 * trajectory splines use.
 */
const DEGENERATE_LENGTH = 1e-12;

/** Chain direction used when the target coincides with the root (see {@link solveTwoBoneIK}). */
const FALLBACK_FORWARD_X = 1;

/** Unit vector from the root towards the target; scratch, write-before-read. */
const forward = new Vector3();

/** Unit vector towards the pole side, perpendicular to {@link forward}; scratch. */
const poleDirection = new Vector3();

/**
 * The pose produced by {@link solveTwoBoneIK}.
 *
 * `joint` and `end` are stable object references that the solver writes into —
 * the *vectors* are mutable, the fields are not reassigned — so a caller can
 * hold one solution and reuse it every frame.
 */
export interface TwoBoneIKSolution {
  /** World position of the middle joint (elbow, knee), on the pole side. */
  readonly joint: Vector3;

  /** World position of the chain tip after solving. Equals the target when reachable. */
  readonly end: Vector3;

  /**
   * `false` when the target lay outside the chain's annulus and the pose was
   * clamped — `end` is then the closest the tip can get, not the target.
   */
  reachable: boolean;
}

/** A reusable {@link TwoBoneIKSolution} at the origin, marked reachable. */
export function createTwoBoneIKSolution(): TwoBoneIKSolution {
  return { joint: new Vector3(), end: new Vector3(), reachable: true };
}

/**
 * Solves a two-bone chain so its tip reaches `target`, bending towards
 * `poleHint`.
 *
 * The chain is `root → joint → end`, with `|root − joint| = upperLength` and
 * `|joint − end| = lowerLength` **always** — bones never stretch, which is what
 * makes the unreachable case a clamp rather than a scale.
 *
 * ```text
 * d      = |target − root|, clamped to [|a − b|, a + b]
 * cos θ  = (a² + d² − b²) / (2·a·d)              // law of cosines at the root
 * joint  = root + a·(cos θ · forward + sin θ · pole)
 * end    = root + d·forward
 * ```
 *
 * where `a = upperLength`, `b = lowerLength`, `forward` is the unit vector from
 * the root to the target, and `pole` is the unit vector towards `poleHint` with
 * its `forward` component removed. `θ` is measured from `forward`, and `sin θ`
 * is taken non-negative, so the joint always lands on the pole side of the
 * root–target line: that is what stops a knee from flipping between frames.
 *
 * ## Unreachable targets clamp (decision, WP-8.3)
 *
 * Both failures clamp the *distance* and keep the direction, and both report
 * `reachable: false`:
 *
 * - **Too far** (`d > a + b`): the chain straightens and points at the target,
 *   `end = root + (a + b)·forward`. The tip stops short along the line to the
 *   target — the closest a rigid chain can get.
 * - **Too close** (`d < |a − b|`, only possible with unequal bones): the chain
 *   folds as far as it goes, `end = root + |a − b|·forward`, again the closest
 *   reachable point.
 *
 * Clamping rather than throwing is deliberate: a target sliding out of range is
 * an ordinary runtime event (a reaching character, a dragged handle), and the
 * clamped pose is continuous with the reachable ones, so the limb settles at
 * full extension instead of popping.
 *
 * ## Degenerate inputs
 *
 * - **Pole hint on the root–target line** (or at the root): the bend plane is
 *   undefined, so the solver picks a deterministic perpendicular of `forward` —
 *   the world axis least aligned with it, made perpendicular. The pose is valid
 *   and repeatable, just not authored; pass a meaningful hint to control it.
 * - **Target coincident with the root**: the chain direction is undefined and
 *   the solver uses `+X` as `forward` (documented, deterministic). With equal
 *   bones this is exactly reachable — the chain folds flat and the joint lands
 *   at `root + a·pole`, so the pole hint still chooses the fold direction.
 * - **A zero-length bone** is allowed (the chain degenerates to one bone, and
 *   the joint coincides with the root or the tip); **both** bones zero is
 *   rejected, because then there is no chain to solve.
 *
 * @param root World position of the chain's base. Not modified.
 * @param target World position the tip should reach. Not modified.
 * @param upperLength Length of the root→joint bone, in world units; finite, `>= 0`.
 * @param lowerLength Length of the joint→end bone, in world units; finite, `>= 0`.
 * @param poleHint World position the middle joint should bend towards. Not modified.
 * @param out Solution to write into; allocated when omitted.
 * @throws RangeError when either length is negative or not finite, or when both
 * lengths are zero.
 */
export function solveTwoBoneIK(
  root: Vector3,
  target: Vector3,
  upperLength: number,
  lowerLength: number,
  poleHint: Vector3,
  out?: TwoBoneIKSolution,
): TwoBoneIKSolution {
  assertLength(upperLength, "upperLength");
  assertLength(lowerLength, "lowerLength");
  if (upperLength + lowerLength === 0) {
    throw new RangeError(
      "solveTwoBoneIK needs a chain: upperLength and lowerLength cannot both be zero",
    );
  }
  const solution = out ?? createTwoBoneIKSolution();

  // Chain frame: `forward` towards the target, `poleDirection` perpendicular to
  // it on the side of the pole hint.
  const toTargetX = target.x - root.x;
  const toTargetY = target.y - root.y;
  const toTargetZ = target.z - root.z;
  const distance = Math.sqrt(
    toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ,
  );
  if (distance > DEGENERATE_LENGTH) {
    forward.set(
      toTargetX / distance,
      toTargetY / distance,
      toTargetZ / distance,
    );
  } else {
    forward.set(FALLBACK_FORWARD_X, 0, 0);
  }
  setPoleDirection(root, poleHint);

  // Reach limits: the tip can only sit in the annulus between the folded and the
  // straightened chain.
  const straight = upperLength + lowerLength;
  const folded = Math.abs(upperLength - lowerLength);
  let reach = distance;
  let reachable = true;
  if (distance > straight) {
    reach = straight;
    reachable = false;
  } else if (distance < folded) {
    reach = folded;
    reachable = false;
  }

  if (upperLength === 0) {
    // No first bone: the joint sits on the root.
    solution.joint.copy(root);
  } else if (reach === 0) {
    // Root and tip coincide (equal bones, target at the root): the chain folds
    // flat and the pole hint alone decides where the joint goes.
    solution.joint.set(
      root.x + poleDirection.x * upperLength,
      root.y + poleDirection.y * upperLength,
      root.z + poleDirection.z * upperLength,
    );
  } else {
    const cosine = clampToUnit(
      (upperLength * upperLength + reach * reach - lowerLength * lowerLength) /
        (2 * upperLength * reach),
    );
    const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
    const along = upperLength * cosine;
    const aside = upperLength * sine;
    solution.joint.set(
      root.x + forward.x * along + poleDirection.x * aside,
      root.y + forward.y * along + poleDirection.y * aside,
      root.z + forward.z * along + poleDirection.z * aside,
    );
  }

  solution.end.set(
    root.x + forward.x * reach,
    root.y + forward.y * reach,
    root.z + forward.z * reach,
  );
  solution.reachable = reachable;
  return solution;
}

/** Throws unless `value` is a finite number `>= 0`. */
function assertLength(value: number, what: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `solveTwoBoneIK ${what} must be a finite number >= 0 world units; received ${String(value)}`,
    );
  }
}

/** `value` limited to `[-1, 1]`, undoing rounding on a fully folded chain. */
function clampToUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/**
 * Writes the unit bend direction into {@link poleDirection}: `poleHint − root`
 * with its {@link forward} component removed. Falls back to a deterministic
 * perpendicular of `forward` when the hint carries no perpendicular component.
 */
function setPoleDirection(root: Vector3, poleHint: Vector3): void {
  const hintX = poleHint.x - root.x;
  const hintY = poleHint.y - root.y;
  const hintZ = poleHint.z - root.z;
  const alongForward =
    hintX * forward.x + hintY * forward.y + hintZ * forward.z;
  const x = hintX - forward.x * alongForward;
  const y = hintY - forward.y * alongForward;
  const z = hintZ - forward.z * alongForward;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length > DEGENERATE_LENGTH) {
    poleDirection.set(x / length, y / length, z / length);
    return;
  }

  // The hint is on the root–target line (or at the root): cross `forward` with
  // whichever world axis it is least aligned with, which is never parallel to it.
  const absoluteX = Math.abs(forward.x);
  const absoluteY = Math.abs(forward.y);
  const absoluteZ = Math.abs(forward.z);
  if (absoluteX <= absoluteY && absoluteX <= absoluteZ) {
    poleDirection.set(0, -forward.z, forward.y); // +X × forward
  } else if (absoluteY <= absoluteZ) {
    poleDirection.set(forward.z, 0, -forward.x); // +Y × forward
  } else {
    poleDirection.set(-forward.y, forward.x, 0); // +Z × forward
  }
  const fallbackLength = poleDirection.length();
  poleDirection.set(
    poleDirection.x / fallbackLength,
    poleDirection.y / fallbackLength,
    poleDirection.z / fallbackLength,
  );
}
