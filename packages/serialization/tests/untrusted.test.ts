import { FourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  SCENE_FORMAT_VERSION,
  decodeSceneDocument,
  encodeSceneDocument,
  validateSceneDocument,
  type SceneDocument,
  type SceneNodeDocument,
} from "../src/index.js";

/** A document whose single root is `depth` generations of nested groups. */
function chainDocument(depth: number): SceneDocument {
  let node: SceneNodeDocument = { type: "group", id: `n${String(depth)}` };
  for (let i = depth - 1; i >= 1; i -= 1) {
    node = { type: "group", id: `n${String(i)}`, children: [node] };
  }
  return { formatVersion: SCENE_FORMAT_VERSION, nodes: [node] };
}

/**
 * A valid §79 document, as raw text, whose root nests `generations` deep.
 *
 * Assembled by concatenation rather than by `JSON.stringify`-ing a document,
 * because at these depths every recursive producer in the toolchain — this
 * package's validator included — is exactly what the test is about.
 */
function hostileChainText(generations: number): string {
  const open = '{"type":"group","children":[';
  return `{"formatVersion":${String(SCENE_FORMAT_VERSION)},"nodes":[${open.repeat(
    generations,
  )}{"type":"group"}${"]}".repeat(generations)}]}`;
}

describe("decodeSceneDocument treats its text as untrusted (§96)", () => {
  it("decodes an ordinary document exactly as it did before the guard", () => {
    const document = validateSceneDocument({
      formatVersion: SCENE_FORMAT_VERSION,
      nodes: [
        {
          type: "scene",
          id: "root",
          children: [{ type: "group", id: "child", name: "Child" }],
        },
      ],
    });
    const text = encodeSceneDocument(document);
    expect(decodeSceneDocument(text)).toEqual(document);
    // Byte-identical round trip — the property every golden depends on.
    expect(encodeSceneDocument(decodeSceneDocument(text))).toBe(text);
  });

  it("refuses text longer than maximumTextLength", () => {
    const text = encodeSceneDocument(chainDocument(4));
    try {
      decodeSceneDocument(text, { maximumTextLength: 16 });
      expect.unreachable("should have refused");
    } catch (error) {
      const failure = error as FourError;
      expect(failure.code).toBe("UNTRUSTED_INPUT_REJECTED");
      expect(failure.message).toContain("Scene document");
      expect(failure.context).toMatchObject({
        document: "Scene document",
        limitName: "maximumTextLength",
        limit: 16,
      });
    }
  });

  it("refuses a node chain deeper than maximumDepth before validateNode recurses", () => {
    const text = encodeSceneDocument(chainDocument(8));
    // A §79 node costs two JSON levels per generation (the object, then its
    // `children` array), plus the document envelope.
    expect(() => decodeSceneDocument(text, { maximumDepth: 6 })).toThrow(
      FourError,
    );
    expect(() => decodeSceneDocument(text, { maximumDepth: 6 })).toThrow(
      /nests deeper/,
    );
    expect(decodeSceneDocument(text, { maximumDepth: 64 })).toEqual(
      validateSceneDocument(chainDocument(8)),
    );
  });

  it("refuses the stack-overflow document a recursive validator would die on", () => {
    // Written as *text*, the way an attacker would: building it through this
    // package's own encoder would trip the very recursion under test.
    const text = hostileChainText(50_000);
    // `JSON.parse` is not the vulnerable step — V8 parses this happily …
    expect(() => {
      JSON.parse(text);
    }).not.toThrow();
    // … `validateSceneDocument`'s per-generation recursion is.
    expect(() => validateSceneDocument(JSON.parse(text))).toThrow(RangeError);
    // The guard turns that into a diagnosable refusal, before any recursion.
    const failure = (() => {
      try {
        decodeSceneDocument(text);
        expect.unreachable("should have refused");
      } catch (error) {
        return error as FourError;
      }
    })();
    expect(failure.code).toBe("UNTRUSTED_INPUT_REJECTED");
    expect(failure.context).toMatchObject({ limitName: "maximumDepth" });
  });

  it("leaves validateSceneDocument unguarded — it takes values, not text", () => {
    // Same content, reached the other way: an in-memory document the caller
    // built is the caller's own to bound.
    const document = validateSceneDocument(chainDocument(8));
    expect(document.nodes).toHaveLength(1);
  });

  it("still reports a SyntaxError for text that is not JSON", () => {
    expect(() => decodeSceneDocument("{not json")).toThrow(SyntaxError);
  });
});
