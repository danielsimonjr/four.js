/** Optional §56 shaping seam. Positions use 1000 units/em; clusters use UTF-16 indices. */
import { FourError, type Disposable } from "@fourjs/core";
export type ShapingDirection = "ltr" | "rtl" | "ttb" | "btt";
export interface ShapedGlyph {
  readonly glyphId: number;
  readonly cluster: number;
  readonly advanceX: number;
  readonly advanceY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}
export interface ShapedRun {
  /** Logical order; layout places RTL runs from their right edge. */
  readonly glyphs: readonly ShapedGlyph[];
  readonly script: string;
  readonly direction: ShapingDirection;
}
export interface ShapeQuery {
  readonly text: string;
  readonly fontId: string;
  readonly script?: string;
  readonly language?: string;
  readonly direction?: ShapingDirection;
  readonly features?: Readonly<Record<string, number>>;
}
export interface ShapingEngine extends Disposable {
  readonly name: string;
  readonly version: string;
  addFont(bytes: Uint8Array, options?: { maximumFontBytes?: number }): string;
  removeFont(fontId: string): void;
  shape(query: ShapeQuery): readonly ShapedRun[];
}
export const DEFAULT_MAXIMUM_FONT_BYTES = 16 * 1024 * 1024;
/** Validate application limits separately from untrusted content. */
export function validateFontBytes(
  bytes: Uint8Array,
  maximumFontBytes = DEFAULT_MAXIMUM_FONT_BYTES,
): void {
  if (!Number.isFinite(maximumFontBytes) || maximumFontBytes <= 0)
    throw new RangeError("maximumFontBytes must be finite and positive");
  if (bytes.byteLength > maximumFontBytes)
    throw new FourError("UNTRUSTED_INPUT_REJECTED", "Font exceeds byte limit", {
      context: { byteLength: bytes.byteLength, maximumFontBytes },
    });
}
export function validateShapingDirection(
  direction: ShapingDirection = "ltr",
): void {
  if (direction === "ttb" || direction === "btt")
    throw new FourError("NOT_IMPLEMENTED", "Vertical shaping is not supported");
  if (direction !== "ltr" && direction !== "rtl")
    throw new RangeError("Invalid shaping direction");
}
/** Code-point identity. Advances denote cells; layout uses the atlas's pixel metrics. */
export class IdentityShapingEngine implements ShapingEngine {
  readonly name = "fourJS:identity";
  readonly version = "0.1.0";
  #fonts = new Set<string>();
  #next = 0;
  #disposed = false;
  #check(id?: string): void {
    if (this.#disposed || (id !== undefined && !this.#fonts.has(id)))
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Disposed shaper or unknown font",
      );
  }
  addFont(bytes: Uint8Array, options?: { maximumFontBytes?: number }): string {
    this.#check();
    validateFontBytes(bytes, options?.maximumFontBytes);
    const id = `identity-font-${++this.#next}`;
    this.#fonts.add(id);
    return id;
  }
  removeFont(id: string): void {
    this.#check(id);
    this.#fonts.delete(id);
  }
  shape(query: ShapeQuery): readonly ShapedRun[] {
    this.#check(query.fontId);
    validateShapingDirection(query.direction);
    const glyphs: ShapedGlyph[] = [];
    let cluster = 0;
    for (const char of query.text) {
      glyphs.push(
        Object.freeze({
          glyphId: char.codePointAt(0)!,
          cluster,
          advanceX: 1000,
          advanceY: 0,
          offsetX: 0,
          offsetY: 0,
        }),
      );
      cluster += char.length;
    }
    return Object.freeze([
      Object.freeze({
        glyphs: Object.freeze(glyphs),
        script: query.script ?? "Zyyy",
        direction: query.direction ?? "ltr",
      }),
    ]);
  }
  dispose(): void {
    this.#fonts.clear();
    this.#disposed = true;
  }
}
