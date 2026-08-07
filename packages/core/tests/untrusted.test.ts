import { describe, expect, it } from "vitest";

import { FourError, isFourError } from "../src/errors.js";
import {
  DEFAULT_MAXIMUM_DEPTH,
  DEFAULT_MAXIMUM_TEXT_LENGTH,
  parseUntrustedJson,
} from "../src/untrusted.js";

/** Builds `{"a":{"a":…}}` nested `levels` objects deep. */
function nestedObjects(levels: number): string {
  return `${'{"a":'.repeat(levels)}1${"}".repeat(levels)}`;
}

/** Builds `[[[…]]]` nested `levels` arrays deep. */
function nestedArrays(levels: number): string {
  return `${"[".repeat(levels)}${"]".repeat(levels)}`;
}

describe("parseUntrustedJson (§96 input-size and nesting limits)", () => {
  it("parses an ordinary document with the documented defaults", () => {
    expect(parseUntrustedJson('{"a":[1,2,"three"],"b":null}', "Doc")).toEqual({
      a: [1, 2, "three"],
      b: null,
    });
    expect(DEFAULT_MAXIMUM_TEXT_LENGTH).toBe(33_554_432);
    expect(DEFAULT_MAXIMUM_DEPTH).toBe(1024);
  });

  it("defaults are finite — a limit that defaults to Infinity is not a limit", () => {
    expect(Number.isFinite(DEFAULT_MAXIMUM_TEXT_LENGTH)).toBe(true);
    expect(Number.isFinite(DEFAULT_MAXIMUM_DEPTH)).toBe(true);
  });

  it("refuses text longer than maximumTextLength before it parses", () => {
    const text = JSON.stringify({ padding: "x".repeat(64) });
    expect(() =>
      parseUntrustedJson(text, "Scene document", { maximumTextLength: 8 }),
    ).toThrow(FourError);
    try {
      parseUntrustedJson(text, "Scene document", { maximumTextLength: 8 });
      expect.unreachable("should have refused");
    } catch (error) {
      expect(isFourError(error)).toBe(true);
      const failure = error as FourError;
      expect(failure.code).toBe("UNTRUSTED_INPUT_REJECTED");
      expect(failure.message).toContain("Scene document");
      expect(failure.message).toContain("§96");
      expect(failure.context).toEqual({
        document: "Scene document",
        limitName: "maximumTextLength",
        limit: 8,
        observed: text.length,
      });
    }
  });

  it("accepts text of exactly maximumTextLength", () => {
    expect(parseUntrustedJson("[1]", "Doc", { maximumTextLength: 3 })).toEqual([
      1,
    ]);
  });

  it("refuses nesting deeper than maximumDepth", () => {
    try {
      parseUntrustedJson(nestedArrays(6), "Replay recording", {
        maximumDepth: 4,
      });
      expect.unreachable("should have refused");
    } catch (error) {
      const failure = error as FourError;
      expect(failure.code).toBe("UNTRUSTED_INPUT_REJECTED");
      expect(failure.message).toContain("Replay recording");
      expect(failure.context).toEqual({
        document: "Replay recording",
        limitName: "maximumDepth",
        limit: 4,
        // Capped at limit + 1: a hostile document is refused, not measured.
        observed: 5,
      });
    }
  });

  it("counts the parsed value itself as level 1", () => {
    expect(parseUntrustedJson("5", "Doc", { maximumDepth: 1 })).toBe(5);
    expect(parseUntrustedJson("{}", "Doc", { maximumDepth: 1 })).toEqual({});
    // `{"a":1}` is two levels: the object, then its member.
    expect(() =>
      parseUntrustedJson('{"a":1}', "Doc", { maximumDepth: 1 }),
    ).toThrow(/nests deeper/);
    expect(parseUntrustedJson('{"a":1}', "Doc", { maximumDepth: 2 })).toEqual({
      a: 1,
    });
  });

  it("measures object and array nesting alike, and stops at nulls and scalars", () => {
    expect(
      parseUntrustedJson(nestedObjects(4), "Doc", { maximumDepth: 5 }),
    ).toBeTypeOf("object");
    expect(() =>
      parseUntrustedJson(nestedObjects(4), "Doc", { maximumDepth: 4 }),
    ).toThrow(/nests deeper/);
    // `null` is an object to `typeof` and must not be walked as one.
    expect(
      parseUntrustedJson('[null,1,"s",true]', "Doc", { maximumDepth: 2 }),
    ).toEqual([null, 1, "s", true]);
  });

  it("survives nesting that would overflow a recursive checker", () => {
    // `JSON.parse` itself handles this happily — the recursion this guard
    // protects lives in the document validators downstream, which is exactly
    // why the guard must be iterative too.
    const deep = nestedArrays(200_000);
    expect(() => parseUntrustedJson(deep, "Doc")).toThrow(FourError);
    expect(() => parseUntrustedJson(deep, "Doc")).toThrow(
      /nests deeper than the 1024-level limit/,
    );
  });

  it("accepts Number.POSITIVE_INFINITY as an explicit opt-out", () => {
    expect(
      parseUntrustedJson(nestedArrays(64), "Doc", {
        maximumTextLength: Number.POSITIVE_INFINITY,
        maximumDepth: Number.POSITIVE_INFINITY,
      }),
    ).toBeInstanceOf(Array);
  });

  it("refuses a limit that is not greater than zero", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(() =>
        parseUntrustedJson("[]", "Doc", { maximumTextLength: bad }),
      ).toThrow(/maximumTextLength must be a number greater than zero/);
      expect(() =>
        parseUntrustedJson("[]", "Doc", { maximumDepth: bad }),
      ).toThrow(/maximumDepth must be a number greater than zero/);
    }
    try {
      parseUntrustedJson("[]", "Doc", { maximumDepth: 0 });
      expect.unreachable("should have refused");
    } catch (error) {
      const failure = error as FourError;
      expect(failure.code).toBe("INVALID_APPLICATION_STATE");
      expect(failure.context).toEqual({ limitName: "maximumDepth", found: 0 });
    }
  });

  it("still reports a SyntaxError for text that is not JSON", () => {
    expect(() => parseUntrustedJson("{oops", "Doc")).toThrow(SyntaxError);
  });
});
