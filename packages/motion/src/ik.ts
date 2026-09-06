/**
 * Analytic two-bone inverse kinematics (§111 "inverse kinematics"; plan P8-1).
 *
 * One solver: {@link solveTwoBoneIK}, the law-of-cosines solution for a chain of
 * exactly two bones — shoulder/elbow/hand, hip/knee/foot, the two links of a
 * robot arm. It is closed form, allocation-free, and pure (§33): the same inputs
 * always produce the same pose, with no iteration count, tolerance, or seed to
 * tune.
 *
 * ## What ships, and what is still staged
 *
 * - **Two-bone analytic** — {@link solveTwoBoneIK}. Closed form, no iteration.
 * - **CCD** and **FABRIK** — {@link solveCCD} / {@link solveFABRIK}. The
 *   limits / ownership / convergence contract this header used to wait on
 *   is the one below. The `@four/scene` `Bone`/`Skeleton` (RFC 0003) is a
 *   valid chain: bones are ordinary nodes, and a node chain is read, never
 *   retained.
 * - **Full-body / multi-effector IK, twist limits, path-planning adapters**
 *   (§111) — still staged. Path-planning waits on an adapter RFC.
 *
 * ### Limits / ownership / convergence (decision)
 *
 * - **Ownership.** The chain is an array of world positions or of nodes.
 *   The caller owns it. The solver never stores a node reference and never
 *   writes a node — results land in `out` (world positions).
 * - **Limits.** Optional per-joint `{ min, max }` radians about a local
 *   axis. An omitted entry is unlimited. With an `axis`, the outgoing bone
 *   is hinged to that axis and the signed angle from the rest outgoing
 *   (measured at solve start) is clamped to `[min, max]`. Without an
 *   `axis`, the limit is a ball: the angle between the rest outgoing and
 *   the current outgoing is clamped to `[min, max]`.
 * - **Convergence.** Iterate until the tip error is `< tolerance` (default
 *   {@link DEFAULT_IK_TOLERANCE}, `1e-4` world units) **or**
 *   `maxIterations` (default {@link DEFAULT_IK_MAX_ITERATIONS}, 16) is
 *   reached. The return is `{ iterations, error, converged }` plus the
 *   positions in `out`.
 *
 * Same-runtime determinism (§33): no RNG. Transcendental (`acos`, `atan2`,
 * `sin`, `cos`, `sqrt`) is accepted, as it is everywhere else in this
 * package.
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
import { resolveWorldTransform, type Node } from "@four/scene";

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

// ---------------------------------------------------------------------------
// Iterative solvers — CCD and FABRIK (WP-8.2 / §111)
// ---------------------------------------------------------------------------

/**
 * Default tip-error tolerance, in world units. A chain whose tip is closer
 * than this to the target is treated as converged.
 */
export const DEFAULT_IK_TOLERANCE = 1e-4;

/**
 * Default iteration budget. Excess iterations are not run: the last
 * iterate is returned with `converged: false`.
 */
export const DEFAULT_IK_MAX_ITERATIONS = 16;

/**
 * A world-space chain: positions the caller owns, or nodes whose world
 * origins are read at the start of the solve and then forgotten.
 */
export type IKChain = ReadonlyArray<Vector3 | Node>;

/**
 * Per-joint hinge or ball limit, in radians about a local axis.
 *
 * Omit the entry (or pass `null` / `undefined`) for an unlimited joint.
 * `axis` omitted is a **ball**: the angle between the rest outgoing bone
 * and the current outgoing is clamped to `[min, max]`. `axis` supplied is
 * a **hinge**: the outgoing bone is projected onto the plane ⊥ `axis` and
 * the signed angle from the rest outgoing, about that axis, is clamped.
 */
export interface JointLimit {
  /** Lower bound, in radians (§7a). */
  min: number;
  /** Upper bound, in radians (§7a). Must be `>= min`. */
  max: number;
  /**
   * Hinge axis in the coordinates the chain is solved in (world, for a
   * world-position chain). **Not** copied after the solve starts — the
   * caller owns it. Omit for a ball limit.
   */
  axis?: Vector3;
}

/** Options for {@link solveCCD} and {@link solveFABRIK}. */
export interface IKSolveOptions {
  /**
   * Tip-error threshold in world units. Finite and `> 0`. Default
   * {@link DEFAULT_IK_TOLERANCE}.
   */
  tolerance?: number;
  /**
   * Iteration ceiling. Integer `>= 1`. Default
   * {@link DEFAULT_IK_MAX_ITERATIONS}.
   */
  maxIterations?: number;
  /**
   * Per-joint limits, indexed from the root. Missing / nullish entries
   * are unlimited. Extra entries past the last moving joint are ignored.
   */
  limits?: ReadonlyArray<JointLimit | undefined | null>;
}

/**
 * The report {@link solveCCD} and {@link solveFABRIK} return. Positions
 * live in `out`, not here — this record is three numbers and a flag.
 */
export interface IKSolveResult {
  /** Iterations actually run. `0` when the tip already met `tolerance`. */
  iterations: number;
  /** World-space distance from the tip to the target after the last iterate. */
  error: number;
  /** `true` when `error < tolerance`. */
  converged: boolean;
}

/**
 * Writes `chain`'s world positions into `out` and solves cyclic coordinate
 * descent so the tip reaches `target`.
 *
 * Each iteration walks the joints from the tip backward to the root and
 * rotates the suffix so that joint's outgoing points closer to the target,
 * then applies that joint's limit if one was given. Bone lengths are taken
 * from the input chain and never stretch.
 *
 * Allocation-free when `out` is provided and already holds one `Vector3`
 * per chain entry (scratch is module-level, write-before-read). The
 * solver does not retain nodes.
 *
 * @param chain World positions or nodes; length `>= 2`. Not modified.
 * @param target World position the tip should reach. Not modified.
 * @param options Tolerance, iteration budget, optional per-joint limits.
 * @param out Positions to write; allocated when omitted.
 * @throws RangeError when the chain is shorter than two, `out` is too
 * short, a length/option is not finite, or a limit has `min > max`.
 */
export function solveCCD(
  chain: IKChain,
  target: Vector3,
  options?: IKSolveOptions,
  out?: Vector3[],
): IKSolveResult {
  const positions = prepareChain(chain, out);
  const { tolerance, maxIterations, limits } = readSolveOptions(options);
  const n = positions.length;
  captureRestAndLengths(positions, n);

  let error = tipError(positions[n - 1], target);
  if (error < tolerance) {
    return { iterations: 0, error, converged: true };
  }

  let iterations = 0;
  for (let iter = 1; iter <= maxIterations; iter += 1) {
    iterations = iter;
    for (let j = n - 2; j >= 0; j -= 1) {
      rotateJointToward(positions, j, n, target);
      applyJointLimit(positions, j, n, limits[j], true);
    }
    error = tipError(positions[n - 1], target);
    if (error < tolerance) {
      return { iterations, error, converged: true };
    }
  }
  return { iterations, error, converged: false };
}

/**
 * Writes `chain`'s world positions into `out` and solves FABRIK
 * (Forward And Backward Reaching Inverse Kinematics) so the tip reaches
 * `target`.
 *
 * Each iteration pulls the tip onto the target and walks back to the root
 * at the recorded bone lengths, then pins the root and walks forward
 * again. Limits are applied on the forward pass, after each child is
 * placed. An unreachable target leaves `converged: false` and the last
 * iterate — the chain points at the target, stretched as far as the
 * lengths allow.
 *
 * Allocation-free when `out` is provided (see {@link solveCCD}). The
 * solver does not retain nodes. No RNG.
 *
 * @param chain World positions or nodes; length `>= 2`. Not modified.
 * @param target World position the tip should reach. Not modified.
 * @param options Tolerance, iteration budget, optional per-joint limits.
 * @param out Positions to write; allocated when omitted.
 * @throws RangeError when the chain is shorter than two, `out` is too
 * short, a length/option is not finite, or a limit has `min > max`.
 */
export function solveFABRIK(
  chain: IKChain,
  target: Vector3,
  options?: IKSolveOptions,
  out?: Vector3[],
): IKSolveResult {
  const positions = prepareChain(chain, out);
  const { tolerance, maxIterations, limits } = readSolveOptions(options);
  const n = positions.length;
  captureRestAndLengths(positions, n);

  const rootX = positions[0].x;
  const rootY = positions[0].y;
  const rootZ = positions[0].z;

  let error = tipError(positions[n - 1], target);
  if (error < tolerance) {
    return { iterations: 0, error, converged: true };
  }

  let iterations = 0;
  for (let iter = 1; iter <= maxIterations; iter += 1) {
    iterations = iter;

    // Forward: tip onto the target, then each previous joint toward the next.
    positions[n - 1].set(target.x, target.y, target.z);
    for (let i = n - 2; i >= 0; i -= 1) {
      placeAtDistance(positions[i], positions[i + 1], boneLengths[i]);
    }

    // Backward: pin the root, then each next joint toward the previous.
    positions[0].set(rootX, rootY, rootZ);
    for (let i = 0; i < n - 1; i += 1) {
      placeAtDistance(positions[i + 1], positions[i], boneLengths[i]);
      applyJointLimit(positions, i, n, limits[i], false);
    }

    error = tipError(positions[n - 1], target);
    if (error < tolerance) {
      return { iterations, error, converged: true };
    }
  }
  return { iterations, error, converged: false };
}

/** Grow-only bone-length scratch. Written every call before it is read. */
const boneLengths: number[] = [];

/** Rest outgoing directions, one per moving joint (x/y/z packed). */
const restOutX: number[] = [];
const restOutY: number[] = [];
const restOutZ: number[] = [];

/** Empty options bag, so `readSolveOptions()` allocates nothing. */
const EMPTY_IK_OPTIONS: IKSolveOptions = {};

/** Shared empty limits list — `?? []` would allocate per unlimited solve. */
const EMPTY_LIMITS: ReadonlyArray<JointLimit | undefined | null> = [];

/** Scratch for a deterministic perpendicular; write-before-read. */
const perpScratch = { x: 0, y: 0, z: 0 };

/** Scratch for a plane projection; write-before-read. */
const planeScratch = { x: 0, y: 0, z: 0 };

/**
 * Reads `chain` into `out` (allocating `out` when omitted) and returns
 * the working positions. Nodes are sampled through their world matrix
 * and then forgotten.
 */
function prepareChain(chain: IKChain, out: Vector3[] | undefined): Vector3[] {
  const n = chain.length;
  if (n < 2) {
    throw new RangeError(
      `IK chain must have at least two points (a root and a tip); received ${String(n)}`,
    );
  }
  const positions = out ?? allocatePositions(n);
  if (positions.length < n) {
    throw new RangeError(
      `IK out must hold one Vector3 per chain entry; received ${String(positions.length)} for a chain of ${String(n)}`,
    );
  }
  for (let i = 0; i < n; i += 1) {
    const point = chain[i];
    const dest = positions[i];
    if (dest === undefined) {
      throw new RangeError(
        `IK out[${String(i)}] is missing; pass a Vector3 per chain entry`,
      );
    }
    if (point instanceof Vector3) {
      dest.copy(point);
    } else {
      const elements = resolveWorldTransform(point).elements;
      dest.set(elements[12], elements[13], elements[14]);
    }
  }
  return positions;
}

/** Allocates `n` fresh origin vectors. */
function allocatePositions(n: number): Vector3[] {
  const positions: Vector3[] = [];
  for (let i = 0; i < n; i += 1) {
    positions.push(new Vector3());
  }
  return positions;
}

/** Records rest outgoing directions and bone lengths for this solve. */
function captureRestAndLengths(positions: readonly Vector3[], n: number): void {
  while (boneLengths.length < n - 1) {
    boneLengths.push(0);
    restOutX.push(0);
    restOutY.push(0);
    restOutZ.push(0);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const ax = positions[i + 1].x - positions[i].x;
    const ay = positions[i + 1].y - positions[i].y;
    const az = positions[i + 1].z - positions[i].z;
    const length = Math.sqrt(ax * ax + ay * ay + az * az);
    boneLengths[i] = length;
    if (length > DEGENERATE_LENGTH) {
      restOutX[i] = ax / length;
      restOutY[i] = ay / length;
      restOutZ[i] = az / length;
    } else {
      restOutX[i] = 1;
      restOutY[i] = 0;
      restOutZ[i] = 0;
    }
  }
}

/** Validates and normalizes the shared options bag. */
function readSolveOptions(options?: IKSolveOptions): {
  tolerance: number;
  maxIterations: number;
  limits: ReadonlyArray<JointLimit | undefined | null>;
} {
  const resolved = options ?? EMPTY_IK_OPTIONS;
  const tolerance = resolved.tolerance ?? DEFAULT_IK_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new RangeError(
      `IK tolerance must be a finite number of world units > 0; received ${String(tolerance)}`,
    );
  }
  const maxIterations = resolved.maxIterations ?? DEFAULT_IK_MAX_ITERATIONS;
  if (
    !Number.isFinite(maxIterations) ||
    maxIterations < 1 ||
    !Number.isInteger(maxIterations)
  ) {
    throw new RangeError(
      `IK maxIterations must be an integer >= 1; received ${String(maxIterations)}`,
    );
  }
  const limits = resolved.limits ?? EMPTY_LIMITS;
  for (let i = 0; i < limits.length; i += 1) {
    const limit = limits[i];
    if (limit == null) {
      continue;
    }
    if (!Number.isFinite(limit.min) || !Number.isFinite(limit.max)) {
      throw new RangeError(
        `IK JointLimit[${String(i)}] min/max must be finite radians; received ${String(limit.min)} / ${String(limit.max)}`,
      );
    }
    if (limit.min > limit.max) {
      throw new RangeError(
        `IK JointLimit[${String(i)}] min must not exceed max; received ${String(limit.min)} > ${String(limit.max)}`,
      );
    }
  }
  return { tolerance, maxIterations, limits };
}

/** World-space distance from `tip` to `target`. */
function tipError(tip: Vector3, target: Vector3): number {
  const dx = tip.x - target.x;
  const dy = tip.y - target.y;
  const dz = tip.z - target.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Places `point` on the sphere of radius `length` centred on `anchor`,
 * keeping the current direction from `anchor` to `point`. A coincident
 * pair falls back to `+X`.
 */
function placeAtDistance(point: Vector3, anchor: Vector3, length: number): void {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const dz = point.z - anchor.z;
  const current = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (current > DEGENERATE_LENGTH) {
    const scale = length / current;
    point.set(anchor.x + dx * scale, anchor.y + dy * scale, anchor.z + dz * scale);
    return;
  }
  point.set(anchor.x + length, anchor.y, anchor.z);
}

/**
 * Rotates the suffix `positions[j+1 … n)` about joint `j` so the tip
 * swings toward `target`. A degenerate (parallel) pair is a no-op.
 */
function rotateJointToward(
  positions: Vector3[],
  j: number,
  n: number,
  target: Vector3,
): void {
  const joint = positions[j];
  const tip = positions[n - 1];
  const toTipX = tip.x - joint.x;
  const toTipY = tip.y - joint.y;
  const toTipZ = tip.z - joint.z;
  const toTargetX = target.x - joint.x;
  const toTargetY = target.y - joint.y;
  const toTargetZ = target.z - joint.z;
  const tipLength = Math.sqrt(toTipX * toTipX + toTipY * toTipY + toTipZ * toTipZ);
  const targetLength = Math.sqrt(
    toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ,
  );
  if (tipLength <= DEGENERATE_LENGTH || targetLength <= DEGENERATE_LENGTH) {
    return;
  }
  const invTip = 1 / tipLength;
  const invTarget = 1 / targetLength;
  const ux = toTipX * invTip;
  const uy = toTipY * invTip;
  const uz = toTipZ * invTip;
  const vx = toTargetX * invTarget;
  const vy = toTargetY * invTarget;
  const vz = toTargetZ * invTarget;
  const axisX = uy * vz - uz * vy;
  const axisY = uz * vx - ux * vz;
  const axisZ = ux * vy - uy * vx;
  const axisLength = Math.sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
  const cos = clampToUnit(ux * vx + uy * vy + uz * vz);
  if (axisLength <= DEGENERATE_LENGTH) {
    // Parallel or anti-parallel: no unique axis. Anti-parallel still
    // needs a 180° flip so a folded chain can unfold; pick a
    // deterministic perpendicular of `u`.
    if (cos > 0) {
      return;
    }
    const perp = writePerpendicular(ux, uy, uz);
    rotateSuffix(positions, j, n, joint, perp.x, perp.y, perp.z, -1, 0);
    return;
  }
  const invAxis = 1 / axisLength;
  const angle = Math.atan2(axisLength, cos);
  const sin = Math.sin(angle);
  const cosA = Math.cos(angle);
  rotateSuffix(
    positions,
    j,
    n,
    joint,
    axisX * invAxis,
    axisY * invAxis,
    axisZ * invAxis,
    cosA,
    sin,
  );
}

/** Writes a deterministic unit perpendicular of `(x, y, z)` into {@link perpScratch}. */
function writePerpendicular(
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const absoluteX = Math.abs(x);
  const absoluteY = Math.abs(y);
  const absoluteZ = Math.abs(z);
  let px: number;
  let py: number;
  let pz: number;
  if (absoluteX <= absoluteY && absoluteX <= absoluteZ) {
    px = 0;
    py = -z;
    pz = y;
  } else if (absoluteY <= absoluteZ) {
    px = z;
    py = 0;
    pz = -x;
  } else {
    px = -y;
    py = x;
    pz = 0;
  }
  const length = Math.sqrt(px * px + py * py + pz * pz);
  perpScratch.x = px / length;
  perpScratch.y = py / length;
  perpScratch.z = pz / length;
  return perpScratch;
}

/**
 * Applies a hinge or ball limit at joint `j`. `rotateDescendants` is
 * CCD's rule (the whole suffix rotates with the outgoing bone). FABRIK
 * only needs the next point moved — the rest of the chain is rewritten
 * on the following steps.
 */
function applyJointLimit(
  positions: Vector3[],
  j: number,
  n: number,
  limit: JointLimit | undefined | null,
  rotateDescendants: boolean,
): void {
  if (limit == null) {
    return;
  }
  const joint = positions[j];
  const child = positions[j + 1];
  let ox = child.x - joint.x;
  let oy = child.y - joint.y;
  let oz = child.z - joint.z;
  const currentLength = Math.sqrt(ox * ox + oy * oy + oz * oz);
  if (currentLength <= DEGENERATE_LENGTH) {
    return;
  }
  const inv = 1 / currentLength;
  ox *= inv;
  oy *= inv;
  oz *= inv;

  const restX = restOutX[j];
  const restY = restOutY[j];
  const restZ = restOutZ[j];
  const axis = limit.axis;

  let delta = 0;
  let rotX: number;
  let rotY: number;
  let rotZ: number;

  if (axis !== undefined) {
    let ax = axis.x;
    let ay = axis.y;
    let az = axis.z;
    const axisLength = Math.sqrt(ax * ax + ay * ay + az * az);
    if (axisLength <= DEGENERATE_LENGTH) {
      return;
    }
    const invAxis = 1 / axisLength;
    ax *= invAxis;
    ay *= invAxis;
    az *= invAxis;

    const restProj = writeProjected(restX, restY, restZ, ax, ay, az);
    if (restProj === null) {
      return;
    }
    const rpx = restProj.x;
    const rpy = restProj.y;
    const rpz = restProj.z;
    const currProj = writeProjected(ox, oy, oz, ax, ay, az);
    if (currProj === null) {
      return;
    }
    const crossX = rpy * currProj.z - rpz * currProj.y;
    const crossY = rpz * currProj.x - rpx * currProj.z;
    const crossZ = rpx * currProj.y - rpy * currProj.x;
    const sin = ax * crossX + ay * crossY + az * crossZ;
    const cos = rpx * currProj.x + rpy * currProj.y + rpz * currProj.z;
    const angle = Math.atan2(sin, cos);
    const clamped = Math.min(limit.max, Math.max(limit.min, angle));
    delta = clamped - angle;
    rotX = ax;
    rotY = ay;
    rotZ = az;
  } else {
    const cos = clampToUnit(ox * restX + oy * restY + oz * restZ);
    const angle = Math.acos(cos);
    if (angle <= limit.max && angle >= limit.min) {
      return;
    }
    const clamped = Math.min(limit.max, Math.max(limit.min, angle));
    delta = clamped - angle;
    const cx = restY * oz - restZ * oy;
    const cy = restZ * ox - restX * oz;
    const cz = restX * oy - restY * ox;
    const cLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (cLen <= DEGENERATE_LENGTH) {
      return;
    }
    rotX = cx / cLen;
    rotY = cy / cLen;
    rotZ = cz / cLen;
  }

  if (delta === 0) {
    return;
  }
  const cosA = Math.cos(delta);
  const sinA = Math.sin(delta);
  if (rotateDescendants) {
    rotateSuffix(positions, j, n, joint, rotX, rotY, rotZ, cosA, sinA);
    return;
  }
  rotatePoint(child, joint.x, joint.y, joint.z, rotX, rotY, rotZ, cosA, sinA);
}

/** Unit projection of `v` onto the plane ⊥ `axis`, or `null` if it collapses. */
function writeProjected(
  vx: number,
  vy: number,
  vz: number,
  ax: number,
  ay: number,
  az: number,
): { x: number; y: number; z: number } | null {
  const along = vx * ax + vy * ay + vz * az;
  const x = vx - ax * along;
  const y = vy - ay * along;
  const z = vz - az * along;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (length <= DEGENERATE_LENGTH) {
    return null;
  }
  planeScratch.x = x / length;
  planeScratch.y = y / length;
  planeScratch.z = z / length;
  return planeScratch;
}

/** Rodrigues-rotates `positions[j+1 … n)` about `joint`. */
function rotateSuffix(
  positions: Vector3[],
  j: number,
  n: number,
  joint: Vector3,
  axisX: number,
  axisY: number,
  axisZ: number,
  cosA: number,
  sinA: number,
): void {
  for (let k = j + 1; k < n; k += 1) {
    rotatePoint(
      positions[k],
      joint.x,
      joint.y,
      joint.z,
      axisX,
      axisY,
      axisZ,
      cosA,
      sinA,
    );
  }
}

/** Rodrigues rotation of `point` about `(px, py, pz)` by a unit axis. */
function rotatePoint(
  point: Vector3,
  px: number,
  py: number,
  pz: number,
  axisX: number,
  axisY: number,
  axisZ: number,
  cosA: number,
  sinA: number,
): void {
  const vx = point.x - px;
  const vy = point.y - py;
  const vz = point.z - pz;
  const dot = vx * axisX + vy * axisY + vz * axisZ;
  const cx = axisY * vz - axisZ * vy;
  const cy = axisZ * vx - axisX * vz;
  const cz = axisX * vy - axisY * vx;
  const omc = 1 - cosA;
  point.set(
    px + vx * cosA + cx * sinA + axisX * dot * omc,
    py + vy * cosA + cy * sinA + axisY * dot * omc,
    pz + vz * cosA + cz * sinA + axisZ * dot * omc,
  );
}
