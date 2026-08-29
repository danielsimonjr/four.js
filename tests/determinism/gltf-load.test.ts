/**
 * §33 for the §78 loader: parsing is a pure function of the input bytes
 * (A-19's closing packet, 2026-08-29).
 *
 * Three claims, from cheap to strict:
 *
 * 1. **Two loads of the same bytes agree byte-for-byte** — every typed array
 *    of every primitive, skin, and channel, plus the record structure.
 * 2. **Traversal order comes from the file's arrays** — nodes, meshes, and
 *    channels appear in file order, never `Map`/object-iteration order.
 * 3. **The digest is pinned.** FNV-1a over the parsed content of the two
 *    committed fixtures, in a spelled-out canonical order, must equal the
 *    recorded constants — so a cross-run nondeterminism *and* an accidental
 *    parser behaviour change both fail loudly here. The reads are explicit
 *    little-endian `DataView` arithmetic, so the digest holds on any
 *    platform the suite runs on.
 *
 * If a deliberate parser change moves a digest, update the constant in the
 * same change and say why in its message.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  createGltfLoader,
  type FetchResponse,
  type GltfAsset,
} from "@four/assets";
import { describe, expect, it } from "vitest";

const FIXTURES = fileURLToPath(new URL("../fixtures/gltf/", import.meta.url));

async function fetchFile(url: string): Promise<FetchResponse> {
  const bytes = await readFile(url);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(buffer),
    text: () => Promise.resolve(bytes.toString("utf8")),
    json: () => Promise.resolve(JSON.parse(bytes.toString("utf8")) as unknown),
  };
}

function loadFixture(name: string): Promise<GltfAsset> {
  return createGltfLoader({ fetch: fetchFile }).load(
    // A fresh response per load, so the two loads share no buffers.
    {
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        const bytes = await readFile(`${FIXTURES}${name}`);
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      },
      text: () => Promise.reject(new Error("binary")),
      json: () => Promise.reject(new Error("binary")),
    },
    `${FIXTURES}${name}`,
  );
}

/** 32-bit FNV-1a over bytes, returned as 8 hex digits. */
function fnv1a(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Digest of a parsed asset's content, in a spelled-out canonical order. */
function digestOf(asset: GltfAsset): string {
  let hash = 0x811c9dc5;
  const feed = (view: ArrayBufferView | undefined): void => {
    if (view === undefined) {
      return;
    }
    hash = fnv1a(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      hash,
    );
  };
  const encoder = new TextEncoder();
  for (const mesh of asset.meshes) {
    hash = fnv1a(encoder.encode(mesh.name), hash);
    for (const primitive of mesh.primitives) {
      feed(primitive.positions);
      feed(primitive.normals);
      feed(primitive.uvs);
      feed(primitive.colors);
      feed(primitive.joints);
      feed(primitive.weights);
      feed(primitive.indices);
    }
  }
  for (const node of asset.nodes) {
    hash = fnv1a(encoder.encode(JSON.stringify(node.translation)), hash);
    hash = fnv1a(encoder.encode(JSON.stringify(node.rotation)), hash);
    hash = fnv1a(encoder.encode(JSON.stringify(node.scale)), hash);
  }
  for (const skin of asset.skins) {
    hash = fnv1a(encoder.encode(JSON.stringify(skin.joints)), hash);
    feed(skin.inverseBindMatrices ?? undefined);
  }
  for (const animation of asset.animations) {
    for (const channel of animation.channels) {
      hash = fnv1a(
        encoder.encode(`${String(channel.node)}:${channel.path}`),
        hash,
      );
      feed(channel.times);
      feed(channel.values);
    }
  }
  return hash.toString(16).padStart(8, "0");
}

describe("§33: glTF loading is deterministic per input bytes", () => {
  it("two loads of the quad fixture agree byte-for-byte", async () => {
    const first = await loadFixture("quad.gltf");
    const second = await loadFixture("quad.gltf");
    expect(digestOf(first)).toBe(digestOf(second));
    expect(first.meshes.map((mesh) => mesh.name)).toEqual(
      second.meshes.map((mesh) => mesh.name),
    );
    expect([...first.meshes[0].primitives[0].positions]).toEqual([
      ...second.meshes[0].primitives[0].positions,
    ]);
  });

  it("file order is the traversal order", async () => {
    const asset = await loadFixture("skinned-column.glb");
    expect(asset.nodes.map((node) => node.name)).toEqual([
      "column",
      "root",
      "elbow",
    ]);
    expect(asset.scenes[0].nodes).toEqual([0, 1]);
    expect(asset.skins[0].joints).toEqual([1, 2]);
  });

  it("the fixture digests are pinned", async () => {
    expect(digestOf(await loadFixture("quad.gltf"))).toBe("925a50c2");
    expect(digestOf(await loadFixture("skinned-column.glb"))).toBe("637ac47b");
  });
});
