/**
 * §57/§67 stencil parity for the WebGPU backend (WP-R1.7) — the per-frame
 * stencil decision, the record-to-descriptor resolution, and the two pass
 * commands stencil still owes.
 *
 * WP-R1.3 landed §67's clip application and recorded one honest residue:
 * *"§57 `material.stencil` is inert on clipless frames"* — R-7's
 * mask-by-hand tier only reached the hardware when a clip had already forced
 * the stencil format. This module retires that residue. The per-frame format
 * question ({@link frameWantsStencil}) now has two clauses:
 *
 * 1. **Does the frame clip?** One property read — R-23's sort key puts mask
 *    draws first, so `items[0].clip?.maskPass` answers for the whole list.
 * 2. **Does any drawable material name a §57 stencil?** A linear scan with
 *    early exit — one property read per item until the first hit, the same
 *    cost class as the frame's `hasLitItems` scan, and the scan a frame pays
 *    only until it finds a reason to stop.
 *
 * The scan is the honest mechanism, and it follows from a decision already
 * recorded: this backend deliberately has **no `{ stencil: true }` renderer
 * option** (R1.3 — the backend owns its depth attachment and can always
 * widen it, so an option would gate something that costs nothing when
 * unused). With no option, the only place "does this frame need stencil
 * bits" can be answered is the frame's own list. GL cannot do this — its
 * stencil buffer is a context-creation attribute — which is why the two
 * backends reach §57 parity by different mechanisms: GL asks its surface
 * (`stencilAttached`), this backend asks its frame. Off screen both ask the
 * target's `stencil` option, unchanged (a target's attachment is fixed at
 * allocation, R-7's packed-format reasoning — §3.3.6's exclusivity with
 * `depthTexture` holds here for the independent WebGPU reason
 * `wgpu-render-target.ts` records).
 *
 * The cost stays where the pipeline-cost law wants it: a scene with no clip
 * and no stencil material scans, finds nothing, and records the WP-R1.1
 * transcript byte for byte; a scene that names a material stencil pays the
 * stencil-carrying format and pipelines — which is the feature, not a cost.
 * A scene that starts or stops masking reallocates the depth attachment
 * once, like a resize.
 *
 * ## What stencil is, on this backend — a seam restated
 *
 * §57's record splits across WebGPU's pipeline/pass seam (R1.3): test, ops
 * and masks are **pipeline identity** ({@link stencilDescriptor} → the
 * `|s:` key segment), `ref` is a **pass command**
 * ({@link applyStencilReference}, mirrored so a clipless, maskless frame
 * records none). §67's scissor never appears in any of it: on GL the mask
 * dance shares the ambient scissor/stencil state machine and the mirror
 * discipline that guards it; here scissor is a per-pass command
 * (`setScissorRect`) and every stencil bit a draw tests is baked into the
 * immutable pipeline, so there is no ambient state to corrupt and the mirror
 * discipline evaporates — the one place this backend is structurally safer
 * than GL, recorded per the R-1 plan's WP-R1.7 note. The stencil reference
 * is the single surviving mirror, one integer wide, reset to 0 by every
 * fresh pass.
 */

import type { RenderItem, RenderItemStencil } from "@four/render";

import type { GpuRenderPassEncoder } from "./webgpu-device.js";
import type { WgpuStencilDescriptor } from "./wgpu-pipeline-cache.js";

/** Every bit of the eight-plane stencil buffer (§67; `STENCIL_INDEX8`). */
export const STENCIL_ALL_BITS = 0xff;

/**
 * The clear draw's stencil state on a stencil-carrying frame: both tests
 * always pass, and the pass operation stores **zero** into every plane —
 * which makes the §61 clear triangle clear the stencil rectangle exactly as
 * it clears depth, scissored per view. (`loadOp: "clear"` would clear the
 * whole attachment; `wgpu-unlit.ts`'s argument, third application.)
 */
export const CLEAR_STENCIL: WgpuStencilDescriptor = Object.freeze({
  func: "always",
  readMask: STENCIL_ALL_BITS,
  writeMask: STENCIL_ALL_BITS,
  failOp: "keep",
  depthFailOp: "keep",
  passOp: "zero",
});

/**
 * A §57/§67 stencil record as a draw resolves it: the engine-composed clip
 * record (every field present) or a material's own `StencilState` — read
 * defensively for the reason the GL backend reads it defensively: a
 * structurally-typed material double may carry a partial record, and a
 * missing field must mean the documented default.
 */
export type WgpuStencilSource = {
  readonly [Key in keyof RenderItemStencil]?: RenderItemStencil[Key];
};

/**
 * Resolves a stencil record into the canonical pipeline-descriptor form, with
 * §57's documented defaults applied — so two draws under one pooled record
 * always produce one pipeline key (`WgpuStencilDescriptor`'s note).
 */
export function stencilDescriptor(
  stencil: WgpuStencilSource,
): WgpuStencilDescriptor {
  return {
    func: stencil.func ?? "always",
    readMask: stencil.readMask ?? STENCIL_ALL_BITS,
    writeMask: stencil.writeMask ?? STENCIL_ALL_BITS,
    failOp: stencil.failOp ?? "keep",
    depthFailOp: stencil.depthFailOp ?? "keep",
    passOp: stencil.passOp ?? "keep",
  };
}

/**
 * Issues `setStencilReference` when — and only when — `ref` differs from the
 * pass's current value, returning the value now in effect (§67, WP-R1.3).
 *
 * A one-line mirror rather than the GL backend's eight-field `GlState`,
 * because everything else GL mirrors is pipeline identity here; the reference
 * is the one §57 stencil field WebGPU leaves as a pass command. `ref` is read
 * defensively (`?? 0`) for the reason every §57 field is: a structurally-typed
 * material double may omit it, and the documented default is 0.
 */
export function applyStencilReference(
  pass: GpuRenderPassEncoder,
  current: number,
  ref: number | undefined,
): number {
  const value = ref ?? 0;
  if (value !== current) {
    pass.setStencilReference(value);
  }
  return value;
}

/**
 * Whether an **on-screen** frame needs its depth attachment to carry §67's
 * stencil planes — the module header's two clauses. Off-screen frames never
 * ask this; their answer is the target's `stencil` option, read off the
 * cache record.
 *
 * Only the material-carrying kinds this backend draws are scanned: an item
 * with no pipeline (skinned, node — skipped draws) must not be able to
 * re-key every pipeline of a frame it contributes nothing to, and a
 * `"particles"` item — drawn since WP-R1.8 — carries **no material at all**
 * (`material?: undefined` on the item), so it has nothing to scan and its
 * only stencil is §67's clip record, which clause 1 already answers. Mask
 * items short out at clause 1, so the scan body only ever reads content
 * materials.
 */
export function frameWantsStencil(items: readonly RenderItem[]): boolean {
  if (items.length === 0) {
    return false;
  }
  if (items[0].clip?.maskPass === true) {
    return true;
  }
  for (const item of items) {
    const kind = item.kind;
    if (
      kind !== "unlit" &&
      kind !== "sprite" &&
      kind !== "lit" &&
      kind !== "standard"
    ) {
      continue;
    }
    if ((item.material.stencil ?? null) !== null) {
      return true;
    }
  }
  return false;
}
