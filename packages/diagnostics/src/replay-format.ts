/**
 * The §34 replay document — its types, its JSON encoding, and its validation
 * (plan P10-2).
 *
 * §34 says a replay format "should store": *initial scene state; solver
 * settings; time step; random seed; external inputs, indexed by simulation step;
 * per-frame executed fixed-step counts and dropped time (§10); optional periodic
 * snapshots*, and that because "snapshots are opaque adapter data … the replay
 * format therefore records the adapter name and version, and a replay refuses to
 * run against a different solver".
 *
 * This module is that document written down as a type plus the three operations
 * a document needs: **encode** it to text, **decode** text back into it, and
 * **refuse** it when it does not belong to the solver in front of you. Producing
 * one is `recorder.ts`'s job; consuming one is the replay player's (WP-10.2).
 *
 * ## Where each §34 item lives
 *
 * | §34 item | Field |
 * | --- | --- |
 * | initial scene state | {@link ReplayRecording.initialSnapshot} — the solver's own opaque bytes, base64 |
 * | solver settings | {@link ReplayRecording.worldConfiguration} — the world configuration the run was captured under (§34: "a snapshot is valid only for the same adapter, adapter version, **and world configuration**") — plus whatever the adapter persists inside the opaque bytes, plus caller {@link ReplayRecording.metadata} |
 * | time step | {@link ReplayRecording.fixedDeltaTime} (seconds) |
 * | random seed | {@link ReplayRecording.seed} |
 * | external inputs, indexed by simulation step | {@link ReplayRecording.inputs} |
 * | per-frame fixed-step counts and dropped time | {@link ReplayRecording.frames} |
 * | optional periodic snapshots | {@link ReplayRecording.periodicSnapshots} |
 * | adapter name and version (refusal key) | {@link ReplayRecording.adapterName} / {@link ReplayRecording.adapterVersion} |
 *
 * One of those deserves its honesty stated out loud (decision, WP-10.1):
 *
 * - **"Initial scene state" is the *solver's* state, not the scene graph's.**
 *   `@four/diagnostics` may depend on `core`, `math`, and `scene` only — it can
 *   never see `@four/physics` (same dispatch wave) — so the only initial state
 *   it can capture is whatever the target hands back from `createSnapshot()`.
 *   For a `PhysicsWorld` that is the full solver world. A caller that also needs
 *   the *authoring* scene serialized alongside puts it in `metadata` (or ships
 *   the `@four/serialization` document next to the recording); this format does
 *   not duplicate `@four/serialization`.
 *
 * "Solver settings" used to be the second entry on that list, recorded here as
 * having *no dedicated field* (WP-10.1). {@link ReplayRecording.worldConfiguration}
 * closed it on **2026-08-06** (PH-6). The gap it left was not cosmetic: the
 * refusal §34 asks for exists — `PhysicsWorld.restoreSnapshot` compares a
 * snapshot's configuration field by field and refuses a mismatch — but the
 * replay path could not reach it, because the configuration was dropped at
 * record time. Replaying a run captured at gravity −9.81 into a world built
 * with gravity 0 therefore ran silently and diverged, and the only signal was
 * `finalChecksum`, checked at the *end*.
 *
 * The field stays **opaque** to this module for the same reason the snapshot
 * bytes are: a cross-package settings schema is an API this package may not
 * open. It is captured off the snapshot, validated as JSON, carried, and handed
 * back — the solver decides what it means.
 *
 * ## Canonical form
 *
 * {@link validateReplayRecording} does not merely check a document — it rebuilds
 * it, field by field, in a fixed key order, dropping anything it does not know.
 * So `encodeReplayRecording(decodeReplayRecording(text)) === text` for every
 * document this module itself produced, which is what makes a byte-identity
 * assertion in a determinism gate (§92) meaningful, and it means a decoded
 * document can never carry a `__proto__` or a stray field into the player.
 *
 * ## Numbers
 *
 * All times are seconds (plan §1, §7a). `finalChecksum` is a uint32 — the §33
 * digest `@four/diagnostics`'s `hashFloats` and `PhysicsWorld.checksum()` both
 * produce. Step indices are non-negative safe integers.
 */

import {
  FourError,
  cloneJsonValue,
  parseUntrustedJson,
  type JsonValue,
  type UntrustedJsonLimits,
} from "@four/core";

/**
 * Any value JSON can carry, losslessly — `@four/core`'s {@link JsonValue},
 * re-exported so the replay format keeps naming its own payload type.
 *
 * This module's definition was the original; `@four/serialization` transcribed
 * it (no §3.1 edge runs between the two packages) and both carried dated
 * hoist-to-core notes until the 2026-08-04 hoist landed. Recorded input
 * payloads and metadata are typed with this rather than `unknown`: a replay
 * document is JSON, so a payload that cannot survive `JSON.stringify`
 * unchanged (a `Date`, a `Map`, `undefined`, a function, `NaN`) is not
 * recordable, and it is better to say so in the type than to discover it as a
 * silent `null` in a golden file.
 */
export type { JsonValue } from "@four/core";

/**
 * The highest format version this build writes.
 *
 * `2` since 2026-08-06 (PH-6), which added
 * {@link ReplayRecording.worldConfiguration}.
 *
 * ## The versioning rule (decision, PH-6)
 *
 * A document declares **the lowest version that can express its content**, not
 * the version of the build that wrote it. So a recording carrying a world
 * configuration is a `2`, and one without is still a `1` — byte for byte the
 * same text this format produced before version 2 existed.
 *
 * That rule is what makes the bump safe in both directions:
 *
 * - **Old documents still run.** A `1` is read by this build unchanged and
 *   re-encodes identically, so every recording on disk, and every golden that
 *   pins one, is untouched. §34's refusal is about not running bytes you do not
 *   understand — and this build understands a `1` completely.
 * - **New documents are refused by old builds, loudly.** A version-1 reader
 *   meeting a `2` raises `SERIALIZATION_VERSION_MISMATCH` naming both numbers,
 *   which is exactly right: it would otherwise drop the configuration during
 *   its canonical rebuild and replay into a mismatched world without noticing —
 *   the very defect PH-6 closed.
 * - **Downgrading is a real operation, not a hack.** Deleting
 *   `worldConfiguration` from a `2` and re-validating yields a valid `1`
 *   (`validateReplayRecording` re-derives the version from the content), so a
 *   recording can be handed to an older build deliberately, losing exactly the
 *   guarantee it names.
 *
 * See {@link SUPPORTED_REPLAY_FORMAT_VERSIONS} for what this build reads.
 */
export const REPLAY_FORMAT_VERSION = 2;

/**
 * Every format version {@link validateReplayRecording} accepts, ascending.
 *
 * A *range* rather than a single number since 2026-08-06 (PH-6) — see
 * {@link REPLAY_FORMAT_VERSION} for the rule that keeps the range honest. Each
 * version in it is a shape this build can read completely; a version outside it
 * is refused rather than guessed at (§34).
 */
export const SUPPORTED_REPLAY_FORMAT_VERSIONS: readonly number[] =
  Object.freeze([1, 2]);

/** The version a document needs to carry a world configuration (PH-6). */
const WORLD_CONFIGURATION_VERSION = 2;

/** One external input, indexed by the simulation step it applies to (§34). */
export interface ReplayInputRecord {
  /** Simulation step index this input belongs to; a non-negative integer. */
  readonly step: number;
  /** The application's own payload; JSON, deep-frozen by the recorder. */
  readonly payload: JsonValue;
}

/**
 * One rendered frame's accounting of the fixed-step loop (§10, §34).
 *
 * §10's accumulator runs `stepCount` fixed steps for the frame and drops the
 * excess beyond `maximumSubSteps`; both numbers are recorded because a replay
 * that re-runs the steps but not the *pattern* of steps would diverge from the
 * recording the moment anything reads `TimeState`.
 */
export interface ReplayFrameRecord {
  /** Fixed steps executed during this frame; a non-negative integer. */
  readonly stepCount: number;
  /** `TimeState.droppedTime` for this frame, in seconds; `>= 0`. */
  readonly droppedTime: number;
}

/** One optional periodic snapshot: the solver's bytes after `step` steps (§34). */
export interface ReplaySnapshotRecord {
  /** Steps simulated when the snapshot was taken; a non-negative integer. */
  readonly step: number;
  /** The adapter's opaque bytes, base64 (see {@link encodeBase64}). */
  readonly data: string;
}

/**
 * The identity a snapshot is valid for (§34).
 *
 * Deliberately structural, so `PhysicsWorld`'s `PhysicsSnapshot` — and a
 * {@link ReplayRecording} itself — both satisfy it without either package
 * importing the other.
 */
export interface ReplayAdapterIdentity {
  /** `PhysicsSolverAdapter.name`, e.g. `"rapier2d"`. */
  readonly adapterName: string;
  /** `PhysicsSolverAdapter.version`. */
  readonly adapterVersion: string;
}

/**
 * A complete §34 replay document — the P10-2 envelope.
 *
 * Directly `JSON.stringify`-able: every field is JSON already, with the two
 * binary blobs base64-encoded. Absent optionals are absent *keys*, never
 * `null`.
 */
export interface ReplayRecording extends ReplayAdapterIdentity {
  /**
   * The lowest format version that can express this document — `2` when it
   * carries a {@link ReplayRecording.worldConfiguration}, `1` otherwise. See
   * {@link REPLAY_FORMAT_VERSION}.
   */
  readonly formatVersion: number;
  /** Seed of the run's RNG (§33), when the caller supplied one. */
  readonly seed?: number;
  /** The fixed simulation step, in seconds (§10). */
  readonly fixedDeltaTime: number;
  /**
   * The world configuration the run was captured under — §34's "solver
   * settings" (2026-08-06, PH-6).
   *
   * Whatever the target put on `ReplaySnapshot.configuration` at
   * `ReplayRecorder.begin`. For a `PhysicsWorld` that is its
   * `PhysicsSnapshotConfiguration`: dimension, resolved gravity, resolved §32
   * sleeping, §33 determinism tier, and §28 solver iterations when set — every
   * field of which changes what stepping the restored bytes produces.
   *
   * **Opaque here.** This module validates it as JSON and carries it; it never
   * reads a field. `ReplayPlayer` re-attaches it to every snapshot it restores,
   * and the *solver* decides whether it matches — `PhysicsWorld.restoreSnapshot`
   * refuses a mismatch field by field, which is the §34 refusal this format
   * previously could not reach.
   *
   * Absent when the target supplied none, which is every recording made before
   * this field existed and every target that does not report a configuration.
   * An absent configuration restores exactly as it always did: the adapter
   * name/version check is then the whole §34 guarantee.
   */
  readonly worldConfiguration?: JsonValue;
  /** The solver's state before step 0, base64. */
  readonly initialSnapshot: string;
  /** External inputs in recorded (insertion) order; steps non-decreasing. */
  readonly inputs: readonly ReplayInputRecord[];
  /** One entry per recorded frame, in order (§10). */
  readonly frames: readonly ReplayFrameRecord[];
  /** Mid-run snapshots, if the recorder was asked for them; steps ascending. */
  readonly periodicSnapshots?: readonly ReplaySnapshotRecord[];
  /** The §33 checksum of the target when recording ended, as a uint32. */
  readonly finalChecksum: number;
  /**
   * Free-form caller data — a scenario name, a build id, a date the *caller*
   * supplied. Nothing in this package reads a clock (§33).
   */
  readonly metadata?: { readonly [key: string]: JsonValue };
}

// --- base64 -----------------------------------------------------------------

/** RFC 4648 §4 alphabet (standard, `+/`, `=` padded). */
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Reverse lookup, `charCode → sextet`, with `-1` for every other code unit.
 *
 * Built once at module load over the 128 ASCII code units; anything outside
 * that range is rejected by the range check before the table is consulted.
 */
const BASE64_LOOKUP: readonly number[] = (() => {
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Bytes encoded per chunk. A multiple of 3, so padding can only ever appear in
 * the final chunk and every chunk boundary lands on a whole 4-character group.
 */
const BASE64_CHUNK_BYTES = 3 * 1024;

/**
 * Encodes bytes as standard, padded base64 (RFC 4648 §4).
 *
 * Written out by hand rather than delegating, on purpose: `Buffer` does not
 * exist in a browser and would drag a Node dependency into a package that must
 * run in both, while `btoa` only accepts a string of code units ≤ 255 — feeding
 * it a large buffer means first materialising that string, which is exactly the
 * spread-the-arguments pattern that blows the call stack on real snapshots.
 * Sixteen lines of table lookup have neither problem and are identical on every
 * runtime, which is what §33 wants from anything on the replay path.
 *
 * Output is built in chunks and joined once, so encoding an N-byte buffer costs
 * O(N) and holds at most one chunk of intermediate string at a time.
 *
 * @param buffer bytes to encode
 * @returns the base64 text (`""` for an empty buffer)
 *
 * @example
 * ```ts
 * encodeBase64(new TextEncoder().encode("foobar").buffer); // "Zm9vYmFy"
 * ```
 */
export function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const end = Math.min(offset + BASE64_CHUNK_BYTES, bytes.length);
    let chunk = "";
    for (let i = offset; i < end; i += 3) {
      const remaining = end - i;
      const b0 = bytes[i];
      if (remaining >= 3) {
        const word = (b0 << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        chunk +=
          BASE64_ALPHABET[(word >>> 18) & 63] +
          BASE64_ALPHABET[(word >>> 12) & 63] +
          BASE64_ALPHABET[(word >>> 6) & 63] +
          BASE64_ALPHABET[word & 63];
      } else if (remaining === 2) {
        const word = (b0 << 16) | (bytes[i + 1] << 8);
        chunk +=
          BASE64_ALPHABET[(word >>> 18) & 63] +
          BASE64_ALPHABET[(word >>> 12) & 63] +
          BASE64_ALPHABET[(word >>> 6) & 63] +
          "=";
      } else {
        const word = b0 << 16;
        chunk +=
          BASE64_ALPHABET[(word >>> 18) & 63] +
          BASE64_ALPHABET[(word >>> 12) & 63] +
          "==";
      }
    }
    parts.push(chunk);
  }
  return parts.join("");
}

/**
 * One base64 character as its sextet.
 *
 * @throws TypeError if the code unit is not in the standard alphabet — which
 * includes `=`, whitespace, and every non-ASCII character
 */
function sextetAt(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const sextet = code < 128 ? BASE64_LOOKUP[code] : -1;
  if (sextet < 0) {
    throw new TypeError(
      `Base64 text contains ${JSON.stringify(text[index])} at index ${String(index)}, which is not a base64 character.`,
    );
  }
  return sextet;
}

/**
 * Decodes standard, padded base64 back to bytes — strictly.
 *
 * "Strictly" means the decoder is the exact inverse of {@link encodeBase64} and
 * accepts nothing else: no whitespace or line breaks, no URL-safe `-_`, no
 * missing padding, and **no non-zero unused bits** in a padded group (`"Zg=="`
 * is accepted, `"Zh=="` is not — both would decode to the same byte, and a
 * format that admits two spellings of one buffer cannot be compared byte for
 * byte). Every rejection is a {@link TypeError} naming the offence.
 *
 * @param text base64 text
 * @returns a fresh `ArrayBuffer` of exactly the decoded length
 * @throws TypeError if the text is not canonical base64
 */
export function decodeBase64(text: string): ArrayBuffer {
  if (text.length % 4 !== 0) {
    throw new TypeError(
      `Base64 text must be a multiple of 4 characters long (got ${String(text.length)}); padding is required.`,
    );
  }
  if (text.length === 0) {
    return new ArrayBuffer(0);
  }
  let padding = 0;
  if (text.charCodeAt(text.length - 1) === 0x3d /* = */) {
    padding = text.charCodeAt(text.length - 2) === 0x3d ? 2 : 1;
  }
  const groups = text.length / 4;
  const byteLength = groups * 3 - padding;
  const bytes = new Uint8Array(byteLength);
  let out = 0;
  for (let group = 0; group < groups; group += 1) {
    const base = group * 4;
    const last = group === groups - 1;
    // Only the final group may be short, and only by the padding just measured;
    // a '=' anywhere else fails the alphabet lookup below like any other
    // non-base64 character.
    const present = last ? 4 - padding : 4;
    const s0 = sextetAt(text, base);
    const s1 = sextetAt(text, base + 1);
    const s2 = present > 2 ? sextetAt(text, base + 2) : 0;
    const s3 = present > 3 ? sextetAt(text, base + 3) : 0;
    const word = (s0 << 18) | (s1 << 12) | (s2 << 6) | s3;
    const kept = 3 - (last ? padding : 0);
    if (last && padding > 0 && (word & (padding === 1 ? 0xff : 0xffff)) !== 0) {
      throw new TypeError(
        `Base64 text has non-zero unused bits in its final group (${JSON.stringify(text.slice(base))}); this encoding is canonical.`,
      );
    }
    // `kept` is 3, 2, or 1 — never 0, since padding is at most 2.
    bytes[out] = (word >>> 16) & 0xff;
    if (kept > 1) {
      bytes[out + 1] = (word >>> 8) & 0xff;
    }
    if (kept > 2) {
      bytes[out + 2] = word & 0xff;
    }
    out += kept;
  }
  return bytes.buffer;
}

// --- JSON payloads ----------------------------------------------------------

/**
 * Validates a value as JSON and returns a deep-frozen copy of it —
 * `@four/core`'s {@link cloneJsonValue}, re-exported.
 *
 * Recorded payloads are copied rather than referenced because the caller
 * usually hands over the same mutable object every frame; a recording that kept
 * the reference would silently record the *final* state of that object N times.
 * They are validated rather than trusted because `JSON.stringify` is lossy in
 * exactly the ways that ruin a determinism gate — `undefined` and functions
 * vanish, `NaN` and `±Infinity` become `null`, a `Date` becomes a string, a
 * cycle throws far from the call site that caused it. Each of those is a
 * {@link TypeError} here, at the `recordInput` that introduced it.
 *
 * The shared implementation carries `@four/serialization`'s `__proto__`
 * strengthening (the 2026-08-04 hoist): a payload with a `__proto__` own key
 * is now refused with a `TypeError` instead of being silently mis-copied into
 * the fresh object's prototype — this module's original would have re-parented
 * the copy, contradicting its own "never carry a `__proto__` into the player"
 * contract at the payload level.
 */
export { cloneJsonValue } from "@four/core";

// --- document validation ----------------------------------------------------

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value as readonly unknown[];
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string.`);
  }
  return value;
}

function asFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function asStepIndex(value: unknown, path: string): number {
  const step = asFiniteNumber(value, path);
  if (!Number.isSafeInteger(step) || step < 0) {
    throw new TypeError(
      `${path} must be a non-negative safe integer (got ${String(step)}).`,
    );
  }
  return step;
}

function asBase64(value: unknown, path: string): string {
  const text = asString(value, path);
  try {
    // Decoding is the validation: it is the only check that guarantees the
    // player will not fail on this field later. The bytes are discarded.
    decodeBase64(text);
  } catch (cause) {
    // The offence itself rides on `cause` (Node and every browser print the
    // chain), so the wrapper only has to add the field's path.
    throw new TypeError(`${path} is not canonical base64.`, { cause });
  }
  return text;
}

function validateInputs(value: unknown, path: string): ReplayInputRecord[] {
  const source = asArray(value, path);
  const inputs: ReplayInputRecord[] = [];
  let previousStep = 0;
  for (let i = 0; i < source.length; i += 1) {
    const entryPath = `${path}[${String(i)}]`;
    const entry = asRecord(source[i], entryPath);
    const step = asStepIndex(entry.step, `${entryPath}.step`);
    if (step < previousStep) {
      throw new TypeError(
        `${entryPath}.step is ${String(step)}, before the previous input's step ${String(previousStep)}; inputs are recorded in non-decreasing step order (§34).`,
      );
    }
    previousStep = step;
    if (entry.payload === undefined) {
      throw new TypeError(`${entryPath}.payload is missing.`);
    }
    inputs.push(
      Object.freeze({
        step,
        payload: cloneJsonValue(entry.payload, `${entryPath}.payload`),
      }),
    );
  }
  return inputs;
}

function validateFrames(value: unknown, path: string): ReplayFrameRecord[] {
  const source = asArray(value, path);
  const frames: ReplayFrameRecord[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const entryPath = `${path}[${String(i)}]`;
    const entry = asRecord(source[i], entryPath);
    const stepCount = asStepIndex(entry.stepCount, `${entryPath}.stepCount`);
    const droppedTime = asFiniteNumber(
      entry.droppedTime,
      `${entryPath}.droppedTime`,
    );
    if (droppedTime < 0) {
      throw new TypeError(
        `${entryPath}.droppedTime must be >= 0 seconds (got ${String(droppedTime)}).`,
      );
    }
    frames.push(Object.freeze({ stepCount, droppedTime: droppedTime || 0 }));
  }
  return frames;
}

function validateSnapshots(
  value: unknown,
  path: string,
): ReplaySnapshotRecord[] {
  const source = asArray(value, path);
  const snapshots: ReplaySnapshotRecord[] = [];
  let previousStep = -1;
  for (let i = 0; i < source.length; i += 1) {
    const entryPath = `${path}[${String(i)}]`;
    const entry = asRecord(source[i], entryPath);
    const step = asStepIndex(entry.step, `${entryPath}.step`);
    if (step <= previousStep) {
      throw new TypeError(
        `${entryPath}.step is ${String(step)}, not after the previous snapshot's step ${String(previousStep)}; periodic snapshots are ordered and unique (§34).`,
      );
    }
    previousStep = step;
    snapshots.push(
      Object.freeze({ step, data: asBase64(entry.data, `${entryPath}.data`) }),
    );
  }
  return snapshots;
}

/**
 * Validates an arbitrary value as a §34 replay document and returns it in
 * canonical form.
 *
 * The result is a fresh, deep-frozen object holding *only* the fields this
 * format defines, built in a fixed key order — so re-encoding it is
 * byte-stable, and no unknown field from an untrusted document survives into
 * the player.
 *
 * The declared `formatVersion` is **re-derived** rather than copied: the result
 * carries the lowest version that can express it (see
 * {@link REPLAY_FORMAT_VERSION}), so validation is idempotent and a
 * configuration-free document is spelled exactly as version 1 always spelled
 * it.
 *
 * @param value the candidate document (typically `JSON.parse` output)
 * @returns the canonical, frozen recording
 * @throws FourError `SERIALIZATION_VERSION_MISMATCH` if `formatVersion` is not
 * one of {@link SUPPORTED_REPLAY_FORMAT_VERSIONS}, or if the document declares
 * a version too low for the fields it carries — §34's "refuses to run" applied
 * to the envelope itself
 * @throws TypeError if any field is missing, mistyped, or out of range; the
 * message names the field's path
 */
export function validateReplayRecording(value: unknown): ReplayRecording {
  const record = asRecord(value, "recording");
  const formatVersion = asFiniteNumber(
    record.formatVersion,
    "recording.formatVersion",
  );
  if (!SUPPORTED_REPLAY_FORMAT_VERSIONS.includes(formatVersion)) {
    throw new FourError(
      "SERIALIZATION_VERSION_MISMATCH",
      `Replay document declares formatVersion ${String(formatVersion)}; this build reads ${SUPPORTED_REPLAY_FORMAT_VERSIONS.join(", ")} (§34).`,
      {
        context: {
          expected: [...SUPPORTED_REPLAY_FORMAT_VERSIONS],
          found: formatVersion,
        },
      },
    );
  }
  if (
    record.worldConfiguration !== undefined &&
    formatVersion < WORLD_CONFIGURATION_VERSION
  ) {
    // A version-1 reader would drop the field during its canonical rebuild and
    // then replay into a world it never checked — so a document that declares
    // `1` may not carry one (PH-6). The producer writes the version its content
    // needs; nothing has to guess.
    throw new FourError(
      "SERIALIZATION_VERSION_MISMATCH",
      `Replay document declares formatVersion ${String(formatVersion)} and carries a worldConfiguration, which needs ${String(WORLD_CONFIGURATION_VERSION)} (§34).`,
      {
        context: {
          expected: WORLD_CONFIGURATION_VERSION,
          found: formatVersion,
        },
      },
    );
  }
  const fixedDeltaTime = asFiniteNumber(
    record.fixedDeltaTime,
    "recording.fixedDeltaTime",
  );
  if (fixedDeltaTime <= 0) {
    throw new TypeError(
      `recording.fixedDeltaTime must be a positive number of seconds (got ${String(fixedDeltaTime)}).`,
    );
  }
  const finalChecksum = asFiniteNumber(
    record.finalChecksum,
    "recording.finalChecksum",
  );
  if (
    !Number.isInteger(finalChecksum) ||
    finalChecksum < 0 ||
    finalChecksum > 0xffffffff
  ) {
    throw new TypeError(
      `recording.finalChecksum must be a uint32 (got ${String(finalChecksum)}).`,
    );
  }
  const adapterName = asString(record.adapterName, "recording.adapterName");
  const adapterVersion = asString(
    record.adapterVersion,
    "recording.adapterVersion",
  );
  const initialSnapshot = asBase64(
    record.initialSnapshot,
    "recording.initialSnapshot",
  );
  const inputs = Object.freeze(
    validateInputs(record.inputs, "recording.inputs"),
  );
  const frames = Object.freeze(
    validateFrames(record.frames, "recording.frames"),
  );

  // The version is re-derived from the content, not copied from the input: a
  // document declares the lowest version that can express it (PH-6), which is
  // what keeps a configuration-free recording byte-identical to the version-1
  // text this format has always produced.
  const worldConfiguration =
    record.worldConfiguration === undefined
      ? undefined
      : cloneJsonValue(
          record.worldConfiguration,
          "recording.worldConfiguration",
        );

  // Built key by key in the documented order, so `JSON.stringify` emits one
  // fixed spelling per document and an absent optional is an absent key.
  const canonical: Record<string, unknown> = {
    formatVersion:
      worldConfiguration === undefined ? 1 : WORLD_CONFIGURATION_VERSION,
    adapterName,
    adapterVersion,
  };
  if (record.seed !== undefined) {
    canonical.seed = asFiniteNumber(record.seed, "recording.seed");
  }
  canonical.fixedDeltaTime = fixedDeltaTime;
  if (worldConfiguration !== undefined) {
    canonical.worldConfiguration = worldConfiguration;
  }
  canonical.initialSnapshot = initialSnapshot;
  canonical.inputs = inputs;
  canonical.frames = frames;
  if (record.periodicSnapshots !== undefined) {
    canonical.periodicSnapshots = Object.freeze(
      validateSnapshots(
        record.periodicSnapshots,
        "recording.periodicSnapshots",
      ),
    );
  }
  canonical.finalChecksum = finalChecksum;
  if (record.metadata !== undefined) {
    const metadata = cloneJsonValue(record.metadata, "recording.metadata");
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      throw new TypeError("recording.metadata must be an object.");
    }
    canonical.metadata = metadata;
  }
  return Object.freeze(canonical) as unknown as ReplayRecording;
}

/**
 * Serializes a recording to its JSON text, validating it on the way out.
 *
 * @param recording the document to encode
 * @returns compact JSON text in canonical key order
 * @throws FourError / TypeError exactly as {@link validateReplayRecording}
 */
export function encodeReplayRecording(recording: ReplayRecording): string {
  return JSON.stringify(validateReplayRecording(recording));
}

/**
 * Size and nesting bounds for an untrusted document — `@four/core`'s
 * {@link UntrustedJsonLimits}, re-exported so a caller of
 * {@link decodeReplayRecording} does not have to reach past this package for
 * the type of its own second argument.
 *
 * The same type bounds `@four/serialization`'s §79 scene documents; see
 * `@four/core`'s `untrusted.ts` for why one definition sits below both.
 */
export type { UntrustedJsonLimits } from "@four/core";

/**
 * Parses and validates JSON text as a §34 replay document, treating the text as
 * **untrusted** (§96).
 *
 * A recording is exactly the kind of file §96 has in mind: it arrives from a bug
 * report, a CI artifact, or a user's disk, and the first thing the engine does
 * with it is walk it. So the text length is checked before `JSON.parse` runs,
 * and the nesting depth before {@link validateReplayRecording} — whose
 * `cloneJsonValue` copies of `metadata` and `worldConfiguration` recurse once
 * per level — ever sees the value.
 *
 * {@link validateReplayRecording} itself stays unguarded, deliberately: it is
 * the entry point for a value the caller *built* (`ReplayRecorder.finish` and
 * `ReplayPlayer.load` both go through it), and bounding an in-memory object the
 * process just produced would refuse nothing an attacker controls.
 *
 * Both bounds default to finite, generous values, so every recording and golden
 * in this repository decodes exactly as it did before the guard existed.
 *
 * @param text JSON text, typically read from a file
 * @param limits optional §96 bounds; omitted fields take their defaults
 * @returns the canonical, frozen recording
 * @throws FourError `UNTRUSTED_INPUT_REJECTED` if the text is too long or nests
 * too deeply
 * @throws SyntaxError if the text is not JSON; then exactly as
 * {@link validateReplayRecording}
 */
export function decodeReplayRecording(
  text: string,
  limits?: UntrustedJsonLimits,
): ReplayRecording {
  return validateReplayRecording(
    parseUntrustedJson(text, "Replay recording", limits),
  );
}

/**
 * §34's refusal: *"a replay refuses to run against a different solver"*.
 *
 * Compares the document's recorded adapter name and version against the
 * identity of the solver about to run it. The `identity` argument is
 * structural, so the caller can pass anything carrying the two fields — most
 * usefully a fresh `PhysicsWorld.createSnapshot()`, whose `PhysicsSnapshot`
 * already reports the live adapter's name and version.
 *
 * The two thrown errors mirror `PhysicsWorld.restoreSnapshot`'s, code and
 * context included, so a mismatch reads the same whether it is caught at the
 * document or at the solver.
 *
 * @param recording the document about to be replayed
 * @param identity the solver that would run it
 * @throws FourError `INVALID_APPLICATION_STATE` on a name or version mismatch
 */
export function assertReplayCompatible(
  recording: ReplayRecording,
  identity: ReplayAdapterIdentity,
): void {
  if (recording.adapterName !== identity.adapterName) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Replay was recorded with adapter ${JSON.stringify(recording.adapterName)} and this world runs ${JSON.stringify(identity.adapterName)}; a replay refuses to run against a different solver (§34).`,
      {
        context: {
          expected: identity.adapterName,
          found: recording.adapterName,
        },
      },
    );
  }
  if (recording.adapterVersion !== identity.adapterVersion) {
    throw new FourError(
      "INVALID_APPLICATION_STATE",
      `Replay was recorded with ${JSON.stringify(recording.adapterName)} version ${JSON.stringify(recording.adapterVersion)} and this world runs version ${JSON.stringify(identity.adapterVersion)}; a replay refuses to run against a different solver version (§34).`,
      {
        context: {
          adapter: identity.adapterName,
          expected: identity.adapterVersion,
          found: recording.adapterVersion,
        },
      },
    );
  }
}

/**
 * Non-throwing form of {@link assertReplayCompatible}.
 *
 * @param recording the document about to be replayed
 * @param identity the solver that would run it
 * @returns whether the recording may run against that solver (§34)
 */
export function isReplayCompatible(
  recording: ReplayRecording,
  identity: ReplayAdapterIdentity,
): boolean {
  return (
    recording.adapterName === identity.adapterName &&
    recording.adapterVersion === identity.adapterVersion
  );
}
