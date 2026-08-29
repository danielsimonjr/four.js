/**
 * The backend-neutral picking seam (§71; RFC 0005): the candidate table's §33
 * obligations, the id encoding's exactness, the §85 count refusal, and the
 * `supportsPicking` capability test.
 */

import { FourError } from "@four/core";
import { planeGeometry } from "@four/geometry";
import type { Matrix4 } from "@four/math";
import { UnlitMaterial } from "@four/materials";
import { Group, Scene } from "@four/scene";
import { describe, expect, it } from "vitest";

import {
  MAX_PICK_CANDIDATES,
  NullRenderer,
  Renderable,
  assertEncodableCandidateCount,
  collectPickCandidates,
  decodePickId,
  encodePickId,
  supportsPicking,
  type PickingService,
  type Renderer,
} from "../src/index.js";

function renderable(name: string): Renderable {
  const node = new Renderable(planeGeometry(), new UnlitMaterial());
  node.name = name;
  return node;
}

describe("collectPickCandidates (§33)", () => {
  it("collects renderables in scene traversal order, depth first", () => {
    const scene = new Scene();
    const a = renderable("a");
    const group = new Group();
    const b = renderable("b");
    const c = renderable("c");
    scene.add(a);
    a.add(group);
    group.add(b);
    scene.add(c);

    const ids: string[] = [];
    const byMatrix = new Map<Matrix4, number>();
    collectPickCandidates(scene, ids, byMatrix);

    // Depth-first, insertion order (§6): a, then a's descendant b, then c —
    // never a hash order over the set.
    expect(ids).toEqual([a.id, b.id, c.id]);
    expect(byMatrix.get(a.transform.worldMatrix)).toBe(0);
    expect(byMatrix.get(b.transform.worldMatrix)).toBe(1);
    expect(byMatrix.get(c.transform.worldMatrix)).toBe(2);
    // A non-drawable never enters the table.
    expect(byMatrix.has(group.transform.worldMatrix)).toBe(false);
  });

  it("prunes invisible and disabled subtrees, exactly as the render list does", () => {
    const scene = new Scene();
    const hidden = renderable("hidden");
    const inHidden = renderable("in-hidden");
    hidden.visible = false;
    hidden.add(inHidden);
    const disabled = renderable("disabled");
    disabled.enabled = false;
    const kept = renderable("kept");
    scene.add(hidden);
    scene.add(disabled);
    scene.add(kept);

    const ids: string[] = [];
    const byMatrix = new Map<Matrix4, number>();
    collectPickCandidates(scene, ids, byMatrix);
    expect(ids).toEqual([kept.id]);
  });

  it("rebuilds the table per pass — no index survives a scene change", () => {
    const scene = new Scene();
    const first = renderable("first");
    const second = renderable("second");
    scene.add(first);
    scene.add(second);

    const ids: string[] = [];
    const byMatrix = new Map<Matrix4, number>();
    collectPickCandidates(scene, ids, byMatrix);
    expect(ids).toEqual([first.id, second.id]);

    // A node inserted *before* an existing one shifts that node's index —
    // which is exactly why the table may never be carried across passes.
    const inserted = renderable("inserted");
    scene.add(inserted);
    first.visible = false;
    collectPickCandidates(scene, ids, byMatrix);
    expect(ids).toEqual([second.id, inserted.id]);
    expect(byMatrix.get(second.transform.worldMatrix)).toBe(0);
    expect(byMatrix.has(first.transform.worldMatrix)).toBe(false);
  });
});

describe("id encoding (RFC 0005 §3)", () => {
  it("round-trips every byte boundary exactly", () => {
    const out = new Float32Array(4);
    const texel = new Uint8Array(4);
    for (const index of [0, 1, 254, 255, 256, 65_535, 65_536, 16_777_215]) {
      encodePickId(index, out);
      // What an RGBA8 UNORM attachment stores for component `f` is
      // `round(f * 255)` — apply it and decode.
      for (let component = 0; component < 4; component += 1) {
        texel[component] = Math.round(out[component] * 255);
      }
      expect(decodePickId(texel)).toBe(index + 1);
    }
  });

  it("reserves 0 for “nothing” — the clear colour decodes to no candidate", () => {
    expect(decodePickId(new Uint8Array([0, 0, 0, 0]))).toBe(0);
    // …and index 0 encodes to the value 1, never to the clear colour.
    const out = new Float32Array(4);
    encodePickId(0, out);
    // `out` is a Float32Array, so compare against the f32 rounding of 1/255.
    expect(out[0]).toBe(Math.fround(1 / 255));
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(0);
  });

  it("decodes the full 32-bit range without sign trouble", () => {
    expect(decodePickId(new Uint8Array([255, 255, 255, 255]))).toBe(
      MAX_PICK_CANDIDATES,
    );
  });
});

describe("assertEncodableCandidateCount (§85)", () => {
  it("accepts the encoding's exact capacity", () => {
    expect(() => {
      assertEncodableCandidateCount(0);
    }).not.toThrow();
    expect(() => {
      assertEncodableCandidateCount(MAX_PICK_CANDIDATES);
    }).not.toThrow();
  });

  it("refuses one past it, with the count in the context", () => {
    let caught: unknown;
    try {
      assertEncodableCandidateCount(MAX_PICK_CANDIDATES + 1);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FourError);
    const failure = caught as FourError;
    expect(failure.code).toBe("INVALID_APPLICATION_STATE");
    expect(failure.context).toMatchObject({
      count: MAX_PICK_CANDIDATES + 1,
      maximum: MAX_PICK_CANDIDATES,
    });
  });
});

describe("supportsPicking (§62)", () => {
  it("is false for NullRenderer — a backend with no pixels declares the tier absent", () => {
    expect(supportsPicking(new NullRenderer())).toBe(false);
  });

  it("is true exactly when the optional member is a function, and narrows", () => {
    const service = { disposed: false } as unknown as PickingService;
    const renderer = new NullRenderer() as Renderer;
    const capable: Renderer = Object.assign(Object.create(renderer) as object, {
      createPickingService: () => service,
    }) as Renderer;
    expect(supportsPicking(capable)).toBe(true);
    if (supportsPicking(capable)) {
      // The guard's narrowing is the API: no cast at the call site.
      expect(capable.createPickingService()).toBe(service);
    }
  });
});
