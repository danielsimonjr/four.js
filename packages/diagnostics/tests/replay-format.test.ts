/**
 * The §34 replay document (plan P10-2) — encoding, decoding, and refusal.
 *
 * Four things are pinned here:
 *
 * 1. **base64 is RFC 4648 §4.** The known vectors from RFC 4648 §10 are asserted
 *    literally, so the hand-written codec cannot quietly drift into some
 *    private encoding, plus an all-256-byte round trip and a buffer larger than
 *    the internal chunk so the chunking path is real.
 * 2. **The codec is canonical.** Every non-canonical spelling of a buffer is
 *    rejected, which is what lets two recordings of the same run be compared as
 *    text.
 * 3. **Validation is a gate, not a formality.** Every field's failure mode has a
 *    test, and the two §34 refusals (format version, adapter identity) are
 *    asserted by error *code*, not by message.
 * 4. **Round-tripping is byte-identical.** `encode(decode(text)) === text`,
 *    including for a document carrying binary that is nowhere near ASCII.
 */

import { isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  type JsonValue,
  type ReplayRecording,
  REPLAY_FORMAT_VERSION,
  SUPPORTED_REPLAY_FORMAT_VERSIONS,
  assertReplayCompatible,
  cloneJsonValue,
  decodeBase64,
  decodeReplayRecording,
  encodeBase64,
  encodeReplayRecording,
  isReplayCompatible,
  validateReplayRecording,
} from "../src/replay-format.js";

/** An `ArrayBuffer` of the given byte values. */
function buffer(...values: readonly number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

/** An `ArrayBuffer` holding the ASCII code units of `text`. */
function ascii(text: string): ArrayBuffer {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes.buffer;
}

/** The bytes of a buffer, as a plain array, for value comparison. */
function bytesOf(value: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(value));
}

/** A minimal valid document; `overrides` are applied on top. */
function recording(overrides: Record<string, unknown> = {}): ReplayRecording {
  return validateReplayRecording({
    formatVersion: REPLAY_FORMAT_VERSION,
    adapterName: "rapier2d",
    adapterVersion: "0.1.0",
    fixedDeltaTime: 1 / 60,
    initialSnapshot: encodeBase64(buffer(1, 2, 3)),
    inputs: [],
    frames: [],
    finalChecksum: 2166136261,
    ...overrides,
  });
}

/** The same document as a raw object, so invalid fields can be injected. */
function rawRecording(overrides: Record<string, unknown> = {}): unknown {
  return {
    formatVersion: REPLAY_FORMAT_VERSION,
    adapterName: "rapier2d",
    adapterVersion: "0.1.0",
    fixedDeltaTime: 1 / 60,
    initialSnapshot: encodeBase64(buffer(1, 2, 3)),
    inputs: [],
    frames: [],
    finalChecksum: 2166136261,
    ...overrides,
  };
}

describe("encodeBase64 / decodeBase64 — RFC 4648 §10 vectors", () => {
  const vectors: readonly (readonly [string, string])[] = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
  ];

  for (const [plain, encoded] of vectors) {
    it(`encodes ${JSON.stringify(plain)} as ${JSON.stringify(encoded)}`, () => {
      expect(encodeBase64(ascii(plain))).toBe(encoded);
    });

    it(`decodes ${JSON.stringify(encoded)} back to ${JSON.stringify(plain)}`, () => {
      expect(bytesOf(decodeBase64(encoded))).toEqual(bytesOf(ascii(plain)));
    });
  }
});

describe("encodeBase64 / decodeBase64 — binary round trips", () => {
  it("round-trips every byte value, in order", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) {
      all[i] = i;
    }

    const text = encodeBase64(all.buffer);

    expect(text).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(bytesOf(decodeBase64(text))).toEqual(Array.from(all));
  });

  it("round-trips bytes no text encoding would survive (0x00, 0xff, lone surrogates)", () => {
    const nasty = buffer(0x00, 0xff, 0xed, 0xa0, 0x80, 0xc3, 0x28, 0x00);

    expect(bytesOf(decodeBase64(encodeBase64(nasty)))).toEqual(bytesOf(nasty));
  });

  it("round-trips a buffer larger than one internal chunk", () => {
    // 3 * 1024 bytes per chunk, so 8000 bytes spans three chunks and ends
    // mid-chunk with padding.
    const long = new Uint8Array(8000);
    for (let i = 0; i < long.length; i += 1) {
      long[i] = (i * 37 + (i >>> 3)) & 0xff;
    }

    const text = encodeBase64(long.buffer);

    expect(text.length).toBe(Math.ceil(long.length / 3) * 4);
    // 8000 = 2666 * 3 + 2, so the final group carries one pad character.
    expect(text.indexOf("=")).toBe(text.length - 1);
    expect(bytesOf(decodeBase64(text))).toEqual(Array.from(long));
  });

  it("decodes an empty string to an empty buffer", () => {
    expect(decodeBase64("").byteLength).toBe(0);
  });

  it("encodes a view's whole underlying buffer", () => {
    expect(encodeBase64(new Uint8Array([102, 111, 111]).buffer)).toBe("Zm9v");
  });
});

describe("decodeBase64 — strictness", () => {
  it("rejects a length that is not a multiple of four", () => {
    expect(() => decodeBase64("Zm9")).toThrow(TypeError);
    expect(() => decodeBase64("Zm9")).toThrow(/multiple of 4/);
  });

  it("rejects characters outside the standard alphabet", () => {
    expect(() => decodeBase64("Zm9-")).toThrow(/not a base64 character/);
    expect(() => decodeBase64("Zm9_")).toThrow(/not a base64 character/);
  });

  it("rejects whitespace and line breaks", () => {
    expect(() => decodeBase64("Zm9v\nZm9v")).toThrow(TypeError);
    expect(() => decodeBase64("Zm9v\tZm9")).toThrow(/not a base64 character/);
  });

  it("rejects non-ASCII characters", () => {
    expect(() => decodeBase64("Zm9é")).toThrow(/not a base64 character/);
    expect(() => decodeBase64("Zm9\u{1f600}v")).toThrow(TypeError);
  });

  it("rejects padding before the final group", () => {
    expect(() => decodeBase64("Zm==Zm8=")).toThrow(/not a base64 character/);
    expect(() => decodeBase64("Z=8=")).toThrow(/not a base64 character/);
    expect(() => decodeBase64("====")).toThrow(/not a base64 character/);
  });

  it("rejects non-zero unused bits — one buffer has exactly one spelling", () => {
    // "Zg==" and "Zh==" would both decode to the single byte 0x66.
    expect(bytesOf(decodeBase64("Zg=="))).toEqual([0x66]);
    expect(() => decodeBase64("Zh==")).toThrow(/non-zero unused bits/);
    // Likewise "Zm8=" versus "Zm9=".
    expect(bytesOf(decodeBase64("Zm8="))).toEqual([0x66, 0x6f]);
    expect(() => decodeBase64("Zm9=")).toThrow(/non-zero unused bits/);
  });
});

describe("cloneJsonValue", () => {
  it("copies JSON scalars unchanged", () => {
    expect(cloneJsonValue(null)).toBeNull();
    expect(cloneJsonValue(true)).toBe(true);
    expect(cloneJsonValue("x")).toBe("x");
    expect(cloneJsonValue(1.5)).toBe(1.5);
  });

  it("normalizes -0 to 0, as JSON and the §33 checksum both do", () => {
    expect(Object.is(cloneJsonValue(-0), 0)).toBe(true);
  });

  it("deep-copies and deep-freezes objects and arrays", () => {
    const source = { a: [1, { b: "c" }], d: {} };

    const copy = cloneJsonValue(source) as {
      a: [number, { b: string }];
      d: object;
    };

    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy.a).not.toBe(source.a);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.a)).toBe(true);
    expect(Object.isFrozen(copy.a[1])).toBe(true);
  });

  it("preserves key insertion order", () => {
    const copy = cloneJsonValue({ z: 1, a: 2, m: 3 });

    expect(Object.keys(copy as object)).toEqual(["z", "a", "m"]);
  });

  it("accepts a null-prototype object", () => {
    const source = Object.create(null) as Record<string, unknown>;
    source.k = 1;

    expect(cloneJsonValue(source)).toEqual({ k: 1 });
  });

  it("rejects values JSON would silently mangle", () => {
    expect(() => cloneJsonValue(Number.NaN)).toThrow(/round-trip as null/);
    expect(() => cloneJsonValue(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => cloneJsonValue(undefined)).toThrow(/undefined/);
    expect(() => cloneJsonValue(() => 0)).toThrow(/function/);
    expect(() => cloneJsonValue(Symbol("s"))).toThrow(/symbol/);
    expect(() => cloneJsonValue(1n)).toThrow(/bigint/);
  });

  it("rejects objects that are not plain", () => {
    expect(() => cloneJsonValue(new Date(0))).toThrow(/not a plain object/);
    expect(() => cloneJsonValue(new Map())).toThrow(/not a plain object/);
    expect(() => cloneJsonValue(new Uint8Array(1))).toThrow(TypeError);
  });

  it("rejects undefined nested in an object, which JSON would drop", () => {
    expect(() => cloneJsonValue({ a: undefined })).toThrow(
      /value.a is undefined/,
    );
  });

  it("rejects cycles, naming the path", () => {
    const cyclic: Record<string, unknown> = { a: {} };
    (cyclic.a as Record<string, unknown>).back = cyclic;

    expect(() => cloneJsonValue(cyclic, "payload")).toThrow(
      /payload.a.back is a circular reference/,
    );
  });

  it("allows the same object twice when it is not an ancestor", () => {
    const shared = { n: 1 };

    expect(cloneJsonValue({ x: shared, y: shared })).toEqual({
      x: { n: 1 },
      y: { n: 1 },
    });
  });

  it("names the offending path inside an array", () => {
    expect(() => cloneJsonValue([1, [2, Number.NaN]], "payload")).toThrow(
      /payload\[1\]\[1\]/,
    );
  });
});

describe("validateReplayRecording — the happy path", () => {
  it("accepts a minimal document and freezes it", () => {
    const value = recording();

    // A document with no world configuration is still a version-1 document:
    // the canonical version is the lowest that can express the content (PH-6).
    expect(value.formatVersion).toBe(1);
    expect(value.adapterName).toBe("rapier2d");
    expect(value.inputs).toEqual([]);
    expect(value.frames).toEqual([]);
    expect(value.seed).toBeUndefined();
    expect(value.periodicSnapshots).toBeUndefined();
    expect(value.metadata).toBeUndefined();
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("keeps every §34 field of a full document", () => {
    const value = recording({
      seed: 1337,
      inputs: [
        { step: 0, payload: { thrust: 1 } },
        { step: 0, payload: "second at the same step" },
        { step: 4, payload: [1, 2, 3] },
      ],
      frames: [
        { stepCount: 2, droppedTime: 0 },
        { stepCount: 0, droppedTime: 0.25 },
      ],
      periodicSnapshots: [
        { step: 2, data: encodeBase64(buffer(9)) },
        { step: 4, data: encodeBase64(buffer(9, 9)) },
      ],
      metadata: { scenario: "stack", recordedAt: "2026-08-02T00:00:00.000Z" },
    });

    expect(value.seed).toBe(1337);
    expect(value.inputs.map((input) => input.step)).toEqual([0, 0, 4]);
    expect(value.inputs[1].payload).toBe("second at the same step");
    expect(value.frames[1]).toEqual({ stepCount: 0, droppedTime: 0.25 });
    expect(value.periodicSnapshots?.map((s) => s.step)).toEqual([2, 4]);
    expect(value.metadata?.scenario).toBe("stack");
  });

  it("canonicalizes: unknown fields are dropped, key order is fixed", () => {
    const value = recording({
      surprise: "dropped",
      seed: 7,
      metadata: { a: 1 },
      periodicSnapshots: [{ step: 1, data: "" }],
    });

    expect(Object.keys(value)).toEqual([
      "formatVersion",
      "adapterName",
      "adapterVersion",
      "seed",
      "fixedDeltaTime",
      "initialSnapshot",
      "inputs",
      "frames",
      "periodicSnapshots",
      "finalChecksum",
      "metadata",
    ]);
    expect(
      (value as unknown as Record<string, unknown>).surprise,
    ).toBeUndefined();
  });

  it("drops a __proto__ key rather than carrying it into the player", () => {
    // Spliced into the text rather than written as an object literal, where
    // `__proto__:` would set a prototype instead of a key.
    const text = `{"__proto__":{"polluted":true},${encodeReplayRecording(recording()).slice(1)}`;
    // `JSON.parse` makes `__proto__` an ordinary own property; the rebuild must
    // not copy it anywhere.
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);

    const value = decodeReplayRecording(text);

    expect(Object.hasOwn(value, "__proto__")).toBe(false);
    expect(
      (value as unknown as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("accepts a document whose keys arrive in a different order", () => {
    const shuffled = validateReplayRecording({
      finalChecksum: 1,
      frames: [],
      inputs: [],
      initialSnapshot: "",
      fixedDeltaTime: 0.02,
      adapterVersion: "2",
      adapterName: "box2d",
      formatVersion: REPLAY_FORMAT_VERSION,
    });

    expect(Object.keys(shuffled)[0]).toBe("formatVersion");
    expect(shuffled.adapterName).toBe("box2d");
  });
});

describe("validateReplayRecording — refusals (§34)", () => {
  it("refuses a foreign format version with SERIALIZATION_VERSION_MISMATCH", () => {
    let thrown: unknown;
    try {
      validateReplayRecording(rawRecording({ formatVersion: 99 }));
    } catch (error) {
      thrown = error;
    }

    expect(isFourError(thrown)).toBe(true);
    expect(isFourError(thrown) ? thrown.code : "").toBe(
      "SERIALIZATION_VERSION_MISMATCH",
    );
    expect(isFourError(thrown) ? thrown.context : undefined).toEqual({
      expected: [...SUPPORTED_REPLAY_FORMAT_VERSIONS],
      found: 99,
    });
  });

  it("rejects a document that is not an object", () => {
    expect(() => validateReplayRecording(null)).toThrow(/must be an object/);
    expect(() => validateReplayRecording([])).toThrow(/must be an object/);
    expect(() => validateReplayRecording("{}")).toThrow(TypeError);
  });

  it("rejects a non-numeric format version before comparing it", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ formatVersion: "1" })),
    ).toThrow(/formatVersion must be a finite number/);
  });

  it("rejects mistyped adapter identity", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ adapterName: 1 })),
    ).toThrow(/adapterName must be a string/);
    expect(() =>
      validateReplayRecording(rawRecording({ adapterVersion: null })),
    ).toThrow(/adapterVersion must be a string/);
  });

  it("rejects a non-positive or non-finite fixed step", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ fixedDeltaTime: 0 })),
    ).toThrow(/positive number of seconds/);
    expect(() =>
      validateReplayRecording(rawRecording({ fixedDeltaTime: -0.1 })),
    ).toThrow(/positive number of seconds/);
    expect(() =>
      validateReplayRecording(rawRecording({ fixedDeltaTime: Number.NaN })),
    ).toThrow(/must be a finite number/);
  });

  it("rejects a checksum that is not a uint32", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ finalChecksum: -1 })),
    ).toThrow(/uint32/);
    expect(() =>
      validateReplayRecording(rawRecording({ finalChecksum: 4294967296 })),
    ).toThrow(/uint32/);
    expect(() =>
      validateReplayRecording(rawRecording({ finalChecksum: 1.5 })),
    ).toThrow(/uint32/);
  });

  it("rejects a non-finite seed", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ seed: Number.POSITIVE_INFINITY })),
    ).toThrow(/seed must be a finite number/);
  });

  it("rejects a malformed initial snapshot", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ initialSnapshot: "not base64!" })),
    ).toThrow(/initialSnapshot is not canonical base64/);
    expect(() =>
      validateReplayRecording(rawRecording({ initialSnapshot: 5 })),
    ).toThrow(/initialSnapshot must be a string/);
  });

  it("rejects malformed inputs", () => {
    expect(() => validateReplayRecording(rawRecording({ inputs: {} }))).toThrow(
      /inputs must be an array/,
    );
    expect(() =>
      validateReplayRecording(rawRecording({ inputs: [1] })),
    ).toThrow(/inputs\[0\] must be an object/);
    expect(() =>
      validateReplayRecording(
        rawRecording({ inputs: [{ step: -1, payload: 0 }] }),
      ),
    ).toThrow(/inputs\[0\].step must be a non-negative safe integer/);
    expect(() =>
      validateReplayRecording(
        rawRecording({ inputs: [{ step: 0.5, payload: 0 }] }),
      ),
    ).toThrow(/non-negative safe integer/);
    expect(() =>
      validateReplayRecording(rawRecording({ inputs: [{ step: 0 }] })),
    ).toThrow(/inputs\[0\].payload is missing/);
    expect(() =>
      validateReplayRecording(
        rawRecording({ inputs: [{ step: 0, payload: Number.NaN }] }),
      ),
    ).toThrow(/inputs\[0\].payload/);
  });

  it("rejects inputs whose steps go backwards", () => {
    expect(() =>
      validateReplayRecording(
        rawRecording({
          inputs: [
            { step: 3, payload: 1 },
            { step: 2, payload: 2 },
          ],
        }),
      ),
    ).toThrow(/non-decreasing step order/);
  });

  it("rejects malformed frames", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ frames: "no" })),
    ).toThrow(/frames must be an array/);
    expect(() =>
      validateReplayRecording(rawRecording({ frames: [null] })),
    ).toThrow(/frames\[0\] must be an object/);
    expect(() =>
      validateReplayRecording(
        rawRecording({ frames: [{ stepCount: -1, droppedTime: 0 }] }),
      ),
    ).toThrow(/frames\[0\].stepCount/);
    expect(() =>
      validateReplayRecording(
        rawRecording({ frames: [{ stepCount: 1, droppedTime: -1 }] }),
      ),
    ).toThrow(/droppedTime must be >= 0 seconds/);
    expect(() =>
      validateReplayRecording(
        rawRecording({ frames: [{ stepCount: 1, droppedTime: "0" }] }),
      ),
    ).toThrow(/droppedTime must be a finite number/);
  });

  it("normalizes a -0 dropped time to 0", () => {
    const value = recording({ frames: [{ stepCount: 1, droppedTime: -0 }] });

    expect(Object.is(value.frames[0].droppedTime, 0)).toBe(true);
  });

  it("rejects malformed periodic snapshots", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ periodicSnapshots: 0 })),
    ).toThrow(/periodicSnapshots must be an array/);
    expect(() =>
      validateReplayRecording(
        rawRecording({ periodicSnapshots: [{ step: 1, data: "??" }] }),
      ),
    ).toThrow(/periodicSnapshots\[0\].data is not canonical base64/);
    expect(() =>
      validateReplayRecording(
        rawRecording({
          periodicSnapshots: [
            { step: 4, data: "" },
            { step: 4, data: "" },
          ],
        }),
      ),
    ).toThrow(/ordered and unique/);
  });

  it("rejects metadata that is not an object", () => {
    expect(() =>
      validateReplayRecording(rawRecording({ metadata: [1] })),
    ).toThrow(/metadata must be an object/);
    expect(() =>
      validateReplayRecording(rawRecording({ metadata: 4 })),
    ).toThrow(/metadata must be an object/);
    expect(() =>
      validateReplayRecording(rawRecording({ metadata: { when: undefined } })),
    ).toThrow(/metadata.when is undefined/);
  });
});

describe("encodeReplayRecording / decodeReplayRecording", () => {
  it("round-trips a document byte for byte, binary included", () => {
    const payload: JsonValue = { keys: ["a", "b"], held: true };
    const original = recording({
      seed: 42,
      initialSnapshot: encodeBase64(buffer(0, 255, 128, 7, 0, 0, 13)),
      inputs: [{ step: 1, payload }],
      frames: [{ stepCount: 1, droppedTime: 0.5 }],
      periodicSnapshots: [{ step: 1, data: encodeBase64(buffer(255, 0)) }],
      metadata: { scenario: "π/2 ramp — non-ASCII ✓" },
    });

    const text = encodeReplayRecording(original);
    const decoded = decodeReplayRecording(text);

    expect(decoded).toEqual(original);
    expect(encodeReplayRecording(decoded)).toBe(text);
    expect(bytesOf(decodeBase64(decoded.initialSnapshot))).toEqual([
      0, 255, 128, 7, 0, 0, 13,
    ]);
  });

  it("omits absent optionals rather than writing null", () => {
    const text = encodeReplayRecording(recording());

    expect(text).not.toContain("seed");
    expect(text).not.toContain("periodicSnapshots");
    expect(text).not.toContain("metadata");
  });

  it("validates on the way out as well as on the way in", () => {
    const bad = { ...recording(), fixedDeltaTime: -1 } as ReplayRecording;

    expect(() => encodeReplayRecording(bad)).toThrow(TypeError);
  });

  it("propagates a JSON syntax error unchanged", () => {
    expect(() => decodeReplayRecording("{")).toThrow(SyntaxError);
  });

  it("refuses a decoded document from a future format version", () => {
    const text = JSON.stringify({ ...recording(), formatVersion: 3 });

    expect(() => decodeReplayRecording(text)).toThrow(/formatVersion 3/);
  });
});

describe("assertReplayCompatible / isReplayCompatible (§34)", () => {
  const value = recording();

  it("accepts the solver that produced the recording", () => {
    const identity = { adapterName: "rapier2d", adapterVersion: "0.1.0" };

    expect(() => assertReplayCompatible(value, identity)).not.toThrow();
    expect(isReplayCompatible(value, identity)).toBe(true);
  });

  it("refuses a different solver", () => {
    const identity = { adapterName: "box2d", adapterVersion: "0.1.0" };

    expect(isReplayCompatible(value, identity)).toBe(false);
    let thrown: unknown;
    try {
      assertReplayCompatible(value, identity);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) ? thrown.code : "").toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(isFourError(thrown) ? thrown.message : "").toMatch(
      /refuses to run against a different solver/,
    );
    expect(isFourError(thrown) ? thrown.context : undefined).toEqual({
      expected: "box2d",
      found: "rapier2d",
    });
  });

  it("refuses a different version of the same solver", () => {
    const identity = { adapterName: "rapier2d", adapterVersion: "0.2.0" };

    expect(isReplayCompatible(value, identity)).toBe(false);
    let thrown: unknown;
    try {
      assertReplayCompatible(value, identity);
    } catch (error) {
      thrown = error;
    }
    expect(isFourError(thrown) ? thrown.code : "").toBe(
      "INVALID_APPLICATION_STATE",
    );
    expect(isFourError(thrown) ? thrown.context : undefined).toEqual({
      adapter: "rapier2d",
      expected: "0.2.0",
      found: "0.1.0",
    });
  });

  it("accepts a PhysicsSnapshot-shaped identity, which is how a player uses it", () => {
    // What `assertReplayCompatible(recording, world.createSnapshot())` passes.
    const snapshot = {
      adapterName: "rapier2d",
      adapterVersion: "0.1.0",
      data: new ArrayBuffer(0),
    };

    expect(() => assertReplayCompatible(value, snapshot)).not.toThrow();
  });
});

/**
 * PH-6 (2026-08-06): §34's "solver settings" gained a dedicated field, and the
 * format version became a range so that every document written before it still
 * reads and re-encodes byte for byte.
 */
describe("worldConfiguration and the format-version range (§34, PH-6)", () => {
  const configuration = {
    dimension: "2d",
    gravity: [0, -9.81, 0],
    sleeping: { enabled: true, timeToSleep: 0.5 },
    determinism: "same-runtime",
    solverIterations: 8,
  };

  it("carries the configuration verbatim and declares version 2", () => {
    const value = recording({
      formatVersion: 2,
      worldConfiguration: configuration,
    });

    expect(value.formatVersion).toBe(2);
    expect(value.worldConfiguration).toEqual(configuration);
  });

  it("derives the version from the content, not from the input", () => {
    // Declared 2, carries nothing version 2 can express: canonicalizes to 1.
    expect(recording({ formatVersion: 2 }).formatVersion).toBe(1);
    // Declared 1 with a configuration is refused, not silently upgraded.
    expect(() =>
      validateReplayRecording(
        rawRecording({ formatVersion: 1, worldConfiguration: configuration }),
      ),
    ).toThrow(/needs 2/);
  });

  it("places the configuration in a fixed key position", () => {
    const value = recording({
      formatVersion: 2,
      worldConfiguration: configuration,
      seed: 7,
    });

    expect(Object.keys(value)).toEqual([
      "formatVersion",
      "adapterName",
      "adapterVersion",
      "seed",
      "fixedDeltaTime",
      "worldConfiguration",
      "initialSnapshot",
      "inputs",
      "frames",
      "finalChecksum",
    ]);
  });

  it("keeps a version-1 document byte-identical through the bump", () => {
    // The property every committed recording and every determinism golden
    // depends on: a document with no configuration is spelled exactly as it was
    // before version 2 existed.
    const text = encodeReplayRecording(recording());

    expect(text).toContain('"formatVersion":1');
    expect(text).not.toContain("worldConfiguration");
    expect(encodeReplayRecording(decodeReplayRecording(text))).toBe(text);
  });

  it("re-encodes a version-2 document identically", () => {
    const text = encodeReplayRecording(
      recording({ formatVersion: 2, worldConfiguration: configuration }),
    );

    expect(encodeReplayRecording(decodeReplayRecording(text))).toBe(text);
  });

  it("downgrades to version 1 when the configuration is dropped", () => {
    const two = recording({
      formatVersion: 2,
      worldConfiguration: configuration,
    });
    const rest: Record<string, unknown> = { ...two };
    delete rest.worldConfiguration;

    const one = validateReplayRecording(rest);

    expect(one.formatVersion).toBe(1);
    expect(one.worldConfiguration).toBeUndefined();
  });

  it("deep-freezes the configuration it carries", () => {
    const value = recording({
      formatVersion: 2,
      worldConfiguration: configuration,
    });

    expect(Object.isFrozen(value.worldConfiguration)).toBe(true);
  });

  it("refuses a configuration JSON cannot carry, naming the field", () => {
    expect(() =>
      validateReplayRecording(
        rawRecording({
          formatVersion: 2,
          worldConfiguration: { gravity: [0, Number.NaN, 0] },
        }),
      ),
    ).toThrow(/recording\.worldConfiguration/);
  });

  it("reads every supported version and no others", () => {
    expect([...SUPPORTED_REPLAY_FORMAT_VERSIONS]).toEqual([1, 2]);
    expect(REPLAY_FORMAT_VERSION).toBe(2);
    expect(() =>
      validateReplayRecording(rawRecording({ formatVersion: 0 })),
    ).toThrow(/formatVersion 0/);
    expect(() =>
      validateReplayRecording(rawRecording({ formatVersion: 3 })),
    ).toThrow(/formatVersion 3/);
  });
});
