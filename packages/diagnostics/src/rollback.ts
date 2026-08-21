/**
 * `RollbackBuffer` (§33 *"rollback"*, §34; PH-20, 2026-08-21) — a bounded ring
 * of recent simulation snapshots, and the one API §33's six-item list was
 * missing.
 *
 * §33 requires the engine to support seeded RNGs, recorded inputs, state
 * snapshots, replay, **rollback**, and checksums. Five of the six shipped:
 * `SeededRandom` (§33), `ReplayRecorder`'s input track (§34), `PhysicsWorld`'s
 * `createSnapshot`/`restoreSnapshot` (§34), `ReplayPlayer` (§34), and
 * `createChecksum` (§33). Rollback had the *primitives* —
 * `ReplayPlayer.seekToStep` restores the nearest recorded snapshot and
 * re-simulates — but no API, and `seekToStep`'s primitives are the wrong shape
 * for the use case §34 names: **network rollback** is a *live* world being
 * rewound to a step whose inputs turned out to be wrong, not a finished
 * recording being scrubbed.
 *
 * ```ts
 * const rollback = new RollbackBuffer({ target: world, capacity: 8 });
 *
 * // …every confirmed fixed step:
 * rollback.capture(step);
 *
 * // …a late input for step 41 arrives at step 46:
 * const steps = rollback.rollbackTo(41); // → 5, and the world is at step 41
 * for (let i = 0; i < steps; i += 1) {
 *   applyCorrectedInputs(41 + i);
 *   app.systems.runFixedStep(time); // the caller's own fixed-step loop
 * }
 * ```
 *
 * ## What it deliberately does not do: re-simulate
 *
 * A rollback buffer that re-simulated for you would have to step *something*,
 * and the only thing it could reach is the target — `world.step(dt)`. That
 * would silently skip every other §39 occupant: force generation at step 5,
 * constraints at step 7, event dispatch at step 9. The re-simulated steps would
 * then not be the steps that were rolled back, which is the one property
 * rollback exists to preserve. So the buffer restores state and *returns the
 * number of fixed steps the caller owes*, and the caller re-runs its own loop —
 * the same registry, the same systems, in the same order.
 *
 * Corollary worth stating: the caller must also rewind anything else that
 * carries simulation state across steps — a `SeededRandom`'s stream, an
 * animation clock, its own accumulators. A snapshot is §34's *adapter* state
 * and nothing else, and this class cannot honestly pretend otherwise.
 *
 * ## Determinism (§33)
 *
 * Two parallel arrays in insertion order, no `Map`, no `Set`, no object-key
 * iteration, and no arithmetic on simulation values at all — the buffer only
 * moves opaque snapshots around. It therefore has no determinism tier of its
 * own: rewinding to step *n* and re-simulating reproduces the original run
 * exactly as far as the *target's* tier allows, which for a Rapier world is
 * `same-runtime`. `tests/determinism/rollback.test.ts` is that claim, measured
 * against `world.checksum()` rather than asserted.
 *
 * ## Capacity is a refusal, not a policy (§85)
 *
 * The oldest snapshot is evicted when a `capture` overflows the ring, so a
 * buffer of capacity *n* can rewind at most *n* captures. Asking for a step it
 * no longer holds **throws**, naming the window it does hold. The alternative —
 * restoring the nearest older snapshot instead — silently rewinds further than
 * the caller asked, and a network predictor that re-simulated a different
 * number of steps than it accounted for would drift with no error anywhere.
 */

import { FourError } from "@four/core";

import type { ReplaySnapshot } from "./recorder.js";

/** Every refusal here is a misuse of a live simulation facility. */
const ROLLBACK_ERROR_CODE = "INVALID_APPLICATION_STATE";

/**
 * What {@link RollbackBuffer} needs from a simulation.
 *
 * A strict subset of {@link @four/diagnostics!ReplayTarget} — `PhysicsWorld`
 * satisfies it, and so
 * does any application object that can capture and restore itself. `checksum`
 * is deliberately *not* required: a rollback does not verify, it rewinds, and
 * demanding a checksum would exclude targets that have no meaningful one.
 */
export interface RollbackTarget {
  /** Captures the target's state, with the adapter identity §34 requires. */
  createSnapshot(): ReplaySnapshot;
  /** Restores a snapshot this target produced; refuses a foreign one (§34). */
  restoreSnapshot(snapshot: ReplaySnapshot): void;
}

/** How a {@link RollbackBuffer} is configured. */
export interface RollbackBufferOptions {
  /** The simulation to snapshot and rewind. */
  readonly target: RollbackTarget;
  /**
   * How many snapshots to keep. Must be a positive integer.
   *
   * This is the rewind window in fixed steps, if every step is captured — an
   * eight-entry buffer captured every step rewinds 133 ms at 60 Hz. Snapshot
   * bytes are the solver's, so the memory cost is the world's size times this.
   */
  readonly capacity: number;
}

/**
 * A bounded, ordered ring of simulation snapshots that can rewind its target to
 * any step it still holds (§33 rollback, §34).
 *
 * See the module header for why it never re-simulates, and for what else the
 * caller must rewind alongside it.
 */
export class RollbackBuffer {
  /** The rewind window, in captures. */
  readonly capacity: number;

  /** The simulation this buffer snapshots and rewinds. */
  readonly target: RollbackTarget;

  /** Captured steps, strictly ascending. Parallel to {@link #snapshots}. */
  readonly #steps: number[] = [];

  /** Captured snapshots, oldest first (§33: insertion order, no `Map`). */
  readonly #snapshots: ReplaySnapshot[] = [];

  /**
   * @throws FourError if `capacity` is not a positive integer — a zero-capacity
   * rollback buffer is a buffer that refuses every rewind, which §85 says to
   * reject at construction rather than to discover one dropped frame later
   */
  constructor(options: RollbackBufferOptions) {
    const { capacity, target } = options;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new FourError(
        ROLLBACK_ERROR_CODE,
        `RollbackBuffer capacity must be a positive integer (got ${String(capacity)}).`,
      );
    }
    this.capacity = capacity;
    this.target = target;
  }

  /** How many snapshots are held. Never exceeds {@link RollbackBuffer.capacity}. */
  get size(): number {
    return this.#steps.length;
  }

  /** The oldest step still rewindable, or `undefined` when empty. */
  get oldestStep(): number | undefined {
    return this.#steps.length === 0 ? undefined : this.#steps[0];
  }

  /** The most recent captured step, or `undefined` when empty. */
  get newestStep(): number | undefined {
    return this.#steps.length === 0
      ? undefined
      : this.#steps[this.#steps.length - 1];
  }

  /** The captured steps, ascending — the exact set `rollbackTo` accepts. */
  get steps(): readonly number[] {
    return this.#steps;
  }

  /** Whether `step` can still be rolled back to. */
  has(step: number): boolean {
    return this.#indexOf(step) !== -1;
  }

  /**
   * Snapshots the target as the state **at the end of** fixed step `step`.
   *
   * Evicts the oldest snapshot once the ring is full. Steps must arrive
   * strictly ascending: a simulation runs forwards, and a repeat or a
   * going-backwards capture means the caller's own step counter disagrees with
   * the one it rewound to — which is exactly the bug this class exists to make
   * impossible to have silently.
   *
   * @throws FourError if `step` is not a non-negative integer, or is not
   * greater than {@link RollbackBuffer.newestStep}
   */
  capture(step: number): void {
    if (!Number.isInteger(step) || step < 0) {
      throw new FourError(
        ROLLBACK_ERROR_CODE,
        `RollbackBuffer.capture step must be a non-negative integer (got ${String(step)}).`,
      );
    }
    const newest = this.newestStep;
    if (newest !== undefined && step <= newest) {
      throw new FourError(
        ROLLBACK_ERROR_CODE,
        `RollbackBuffer.capture steps must strictly ascend: step ${String(step)} is not after the last captured step ${String(newest)}. Clear the buffer after a rollback if the caller's step counter restarts.`,
        { context: { step, newestStep: newest } },
      );
    }
    if (this.#steps.length === this.capacity) {
      this.#steps.shift();
      this.#snapshots.shift();
    }
    this.#steps.push(step);
    this.#snapshots.push(this.target.createSnapshot());
  }

  /**
   * Restores the target to the state captured at `step` and forgets everything
   * after it, returning **how many fixed steps the caller must re-simulate** to
   * get back to where it was.
   *
   * The returned count is `newestStep − step`, so re-simulating exactly that
   * many steps lands on the same step number the simulation was on before the
   * rewind. `rollbackTo(newestStep)` restores and returns `0` — a legitimate
   * call, and the cheap way to discard uncommitted state.
   *
   * `step` itself stays in the buffer: rolling back to the same step twice is
   * ordinary in a network predictor that receives two late inputs for one step.
   *
   * @throws FourError if `step` was never captured or has been evicted; the
   * message names the window still held, because "how far back can I go" is
   * the question the caller has at that moment
   */
  rollbackTo(step: number): number {
    const index = this.#indexOf(step);
    if (index === -1) {
      const held =
        this.#steps.length === 0
          ? "the buffer is empty"
          : `held steps are ${String(this.oldestStep)}…${String(this.newestStep)}`;
      throw new FourError(
        ROLLBACK_ERROR_CODE,
        `RollbackBuffer.rollbackTo cannot reach step ${String(step)}: ${held}. Increase capacity, or capture more often.`,
        {
          context: { step, size: this.#steps.length, capacity: this.capacity },
        },
      );
    }
    const rewound = this.#steps[this.#steps.length - 1] - step;
    this.target.restoreSnapshot(this.#snapshots[index]);
    this.#steps.length = index + 1;
    this.#snapshots.length = index + 1;
    return rewound;
  }

  /** Forgets every snapshot. The target is not touched. */
  clear(): void {
    this.#steps.length = 0;
    this.#snapshots.length = 0;
  }

  /**
   * Index of `step`, or `-1`.
   *
   * A linear scan from the newest end: the ring is short (a rewind window, not
   * a recording), and a rollback almost always targets a recent step.
   */
  #indexOf(step: number): number {
    for (let i = this.#steps.length - 1; i >= 0; i -= 1) {
      if (this.#steps[i] === step) {
        return i;
      }
    }
    return -1;
  }
}
