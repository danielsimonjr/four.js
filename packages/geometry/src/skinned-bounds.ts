/**
 * CPU linear-blend skinning **as skinned bounds only** (RFC 0003 residue).
 *
 * RFC 0003 §6 drew the §33 boundary in one sentence: skeletal animation is
 * deterministic (bones are nodes; the palette is a CPU walk), and **vertex
 * skinning is not required to be** — the deformation happens in the GPU
 * vertex stage, the palette goes out, nothing comes back, and §33's checksum
 * is over bodies, not vertices. The committed rule that keeps that true:
 *
 * > **No engine API returns skinned vertex positions.**
 *
 * Skinned bounds still want the posed positions. This module is the honest
 * home for that want: a **same-runtime** (§33) CPU walk that applies the
 * same four-influence LBS the GPU programs run (`SKINNING_GLSL` /
 * `skinningWgsl`), then throws the positions away and returns a
 * {@link BoundingVolume}. Nothing here — and nothing this package exports —
 * hands a deformed vertex array to a caller. Canvas 2D / SVG remain reserved
 * stubs; they are not a reason to grow a public `skinPositions()`.
 *
 * The palette is a `Float32Array` of column-major mat4s (16 floats per joint),
 * the same packing `Skeleton.jointMatrices` and the skinned render item
 * already use. This package's §3.1 row is `core, math`: it cannot name a
 * `Skeleton`, so the palette is just numbers.
 *
 * ## Math (must match GPU LBS)
 *
 * For each vertex `i`, with `p = vec4(positions[3i..], 1)`:
 *
 * ```text
 * skinned = w0·M[j0]·p + w1·M[j1]·p + w2·M[j2]·p + w3·M[j3]·p
 * ```
 *
 * Weights are applied **as authored** — they are not renormalised, matching
 * `BufferGeometry`'s "sum to 1 is the author's contract" rule and the GPU
 * programs, which likewise sum four weighted matrices without a divide.
 * `jk = joints[4·i + k]`. `M[j]` is the column-major mat4 at
 * `palette[16·j .. 16·j + 15]`.
 *
 * A joint index that does not address a complete mat4 in `palette` (including
 * a trailing run of fewer than 16 floats) **contributes nothing** — the same
 * as a zero matrix. The hot path does not throw: `computeBounds()` does not
 * throw on empty input, and an out-of-range index is the geometry's analogue
 * of "no vertices here" for that influence. (The geometry cannot see the
 * skeleton, so it cannot know a legal range at assignment time either.)
 *
 * Missing `joints` or missing `weights` means the geometry is not skinned.
 * The bind-pose volume {@link BufferGeometry.computeBounds} already computed
 * is the right answer; this function returns it rather than throwing.
 *
 * ## Volume construction
 *
 * Min/max scan, then centre `(min+max)/2` and circumradius `|max−min|/2`,
 * identical to {@link BufferGeometry.computeBounds}. No vertices: the empty
 * box `min = +∞`, `max = −∞`, `center`/`radius` `NaN` — the identity of
 * bounds union, not a point at the origin.
 *
 * The posed volume is a **new object** (the palette changes every frame, so
 * it cannot share the geometry's bind-pose cache). The bind-pose fallback
 * returns the geometry's own volume, the same object `computeBounds()`
 * returns.
 *
 * Determinism: same inputs ⇒ bit-identical `min`/`max` (comparisons and
 * stores only; no `Math.random`, no `Date`). `radius` is one `Math.sqrt`,
 * same-runtime, the same claim {@link BoundingVolume} already makes.
 */

import { Vector3 } from "@fourjs/math";

import type { BufferGeometry } from "./buffer-geometry.js";
import type { BoundingVolume } from "./geometry.js";

/** Floats in one column-major mat4 — `Skeleton.jointMatrices` packing. */
const FLOATS_PER_JOINT = 16;

/** Influences per vertex; glTF `JOINTS_0` / `WEIGHTS_0`, RFC 0003. */
const INFLUENCES_PER_VERTEX = 4;

/**
 * Axis-aligned box of the LBS-posed vertices, then the circumscribing
 * sphere — never the posed vertices themselves.
 *
 * @param geometry - Positions plus optional `joints`/`weights`. Bind-pose
 *   bounds if either skin attribute is absent.
 * @param palette - Column-major mat4s, 16 floats per joint, the same
 *   packing as `Skeleton.jointMatrices`. Trailing incomplete matrices are
 *   ignored; out-of-range joint indices skip that influence.
 */
export function computeSkinnedBounds(
  geometry: BufferGeometry,
  palette: Float32Array,
): BoundingVolume {
  const joints = geometry.joints;
  const weights = geometry.weights;
  if (joints === undefined || weights === undefined) {
    return geometry.computeBounds();
  }

  const positions = geometry.positions;
  const jointCount = (palette.length / FLOATS_PER_JOINT) | 0;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const vertexCount = positions.length / 3;
  for (let i = 0; i < vertexCount; i += 1) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const influence = i * INFLUENCES_PER_VERTEX;
    for (let k = 0; k < INFLUENCES_PER_VERTEX; k += 1) {
      const joint = joints[influence + k];
      if (joint >= jointCount) {
        continue;
      }
      const w = weights[influence + k];
      const m = joint * FLOATS_PER_JOINT;
      // Column-major mat4 × vec4(p, 1); affine w is unused (matches GPU LBS).
      const x =
        palette[m] * px +
        palette[m + 4] * py +
        palette[m + 8] * pz +
        palette[m + 12];
      const y =
        palette[m + 1] * px +
        palette[m + 5] * py +
        palette[m + 9] * pz +
        palette[m + 13];
      const z =
        palette[m + 2] * px +
        palette[m + 6] * py +
        palette[m + 10] * pz +
        palette[m + 14];
      sx += w * x;
      sy += w * y;
      sz += w * z;
    }
    if (sx < minX) {
      minX = sx;
    }
    if (sy < minY) {
      minY = sy;
    }
    if (sz < minZ) {
      minZ = sz;
    }
    if (sx > maxX) {
      maxX = sx;
    }
    if (sy > maxY) {
      maxY = sy;
    }
    if (sz > maxZ) {
      maxZ = sz;
    }
  }

  return volumeFromExtents(minX, minY, minZ, maxX, maxY, maxZ);
}

/**
 * The same empty-or-box construction {@link BufferGeometry.computeBounds}
 * uses, allocated onto a fresh {@link BoundingVolume} so a posed result
 * cannot rewrite the geometry's bind-pose cache.
 */
function volumeFromExtents(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): BoundingVolume {
  const min = new Vector3(minX, minY, minZ);
  const max = new Vector3(maxX, maxY, maxZ);
  const center = new Vector3();
  if (minX > maxX) {
    center.set(Number.NaN, Number.NaN, Number.NaN);
    return { min, max, center, radius: Number.NaN };
  }
  const halfX = (maxX - minX) * 0.5;
  const halfY = (maxY - minY) * 0.5;
  const halfZ = (maxZ - minZ) * 0.5;
  center.set(minX + halfX, minY + halfY, minZ + halfZ);
  return {
    min,
    max,
    center,
    radius: Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ),
  };
}
