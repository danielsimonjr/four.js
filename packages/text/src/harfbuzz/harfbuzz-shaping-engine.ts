// oxlint-disable-next-line typescript/triple-slash-reference -- Declaration-only ambient shims must accompany direct source consumers; no runtime import exists.
/// <reference path="./vendor.d.ts" />
/** RFC0008. Verified harfbuzzjs@0.4.13 README/hb.js/hbjs.js APIs:
 * hb.js factory instantiateWasm -> Emscripten Module; hbjs(Module), createBlob,
 * createFace/createFont/setScale, createBuffer/addText (UTF16), setDirection,
 * setScript/setLanguage/guessSegmentProperties, shape(CSV), json g/cl/ax/ay/dx/dy,
 * destroy. v1 auto-initializes wasm and lacks this explicit lifecycle seam. */
import { FourError } from "@fourjs/core";
import createModule from "harfbuzzjs/hb.js";
import wrap from "harfbuzzjs/hbjs.js";
import {
  DEFAULT_MAXIMUM_FONT_BYTES,
  validateFontBytes,
  validateShapingDirection,
  type ShapingEngine,
  type ShapeQuery,
  type ShapedRun,
} from "../shaping.js";
export interface HarfBuzzShapingEngineOptions {
  readonly wasm: BufferSource | WebAssembly.Module;
  readonly maximumFontBytes?: number;
}
type API = ReturnType<typeof wrap>;
type RecordFont = {
  blob: ReturnType<API["createBlob"]>;
  face: ReturnType<API["createFace"]>;
  font: ReturnType<API["createFont"]>;
};
/** Optional engine; application owns wasm loading and atlas rasterization. */
export class HarfBuzzShapingEngine implements ShapingEngine {
  readonly name = "fourJS:harfbuzz";
  readonly version = "harfbuzzjs@0.4.13";
  #fonts = new Map<string, RecordFont>();
  #next = 0;
  #disposed = false;
  private constructor(
    private hb: API,
    private limit: number,
  ) {}
  static async create(
    options: HarfBuzzShapingEngineOptions,
  ): Promise<HarfBuzzShapingEngine> {
    const limit = options.maximumFontBytes ?? DEFAULT_MAXIMUM_FONT_BYTES;
    validateFontBytes(new Uint8Array(), limit);
    try {
      const compiled =
        options.wasm instanceof WebAssembly.Module
          ? options.wasm
          : await WebAssembly.compile(options.wasm);
      const module = await createModule({
        instantiateWasm(imports, success) {
          const instance = new WebAssembly.Instance(compiled, imports);
          success(instance);
          return instance.exports;
        },
      });
      return new HarfBuzzShapingEngine(wrap(module), limit);
    } catch (cause) {
      throw new FourError(
        "UNTRUSTED_INPUT_REJECTED",
        "HarfBuzz initialization failed",
        { cause },
      );
    }
  }
  #check(id?: string): void {
    if (this.#disposed || (id !== undefined && !this.#fonts.has(id)))
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "Disposed shaper or unknown font",
      );
  }
  addFont(bytes: Uint8Array, options?: { maximumFontBytes?: number }): string {
    this.#check();
    validateFontBytes(bytes, options?.maximumFontBytes ?? this.limit);
    let blob: RecordFont["blob"] | undefined,
      face: RecordFont["face"] | undefined,
      font: RecordFont["font"] | undefined;
    try {
      // HarfBuzz accepts garbage as an empty face. Validate SFNT bounds first.
      const view = new DataView(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength,
        ),
        signature = view.getUint32(0),
        tables = view.getUint16(4);
      if (
        (signature !== 0x10000 && signature !== 0x4f54544f) ||
        !tables ||
        12 + tables * 16 > bytes.length
      )
        throw new Error("Expected SFNT font");
      for (let i = 0; i < tables; i++) {
        const offset = view.getUint32(20 + i * 16),
          length = view.getUint32(24 + i * 16);
        if (offset > bytes.length || length > bytes.length - offset)
          throw new Error("Font table exceeds bounds");
      }
      blob = this.hb.createBlob(bytes);
      face = this.hb.createFace(blob, 0);
      font = this.hb.createFont(face);
      font.setScale(1000, 1000);
      const id = `harfbuzz-font-${++this.#next}`;
      this.#fonts.set(id, { blob, face, font });
      return id;
    } catch (cause) {
      font?.destroy();
      face?.destroy();
      blob?.destroy();
      throw new FourError("UNTRUSTED_INPUT_REJECTED", "Invalid OpenType font", {
        cause,
      });
    }
  }
  removeFont(id: string): void {
    this.#check(id);
    const r = this.#fonts.get(id)!;
    r.font.destroy();
    r.face.destroy();
    r.blob.destroy();
    this.#fonts.delete(id);
  }
  shape(query: ShapeQuery): readonly ShapedRun[] {
    this.#check(query.fontId);
    validateShapingDirection(query.direction);
    let buffer: ReturnType<API["createBuffer"]> | undefined;
    try {
      buffer = this.hb.createBuffer();
      buffer.addText(query.text);
      const direction = query.direction ?? "ltr";
      buffer.setDirection(direction);
      if (query.script) buffer.setScript(query.script);
      if (query.language) buffer.setLanguage(query.language);
      buffer.guessSegmentProperties();
      const features = Object.entries(query.features ?? {})
        .map(([tag, value]) => {
          if (
            !/^[A-Za-z0-9]{4}$/.test(tag) ||
            !Number.isSafeInteger(value) ||
            value < 0
          )
            throw new RangeError("Invalid feature");
          return `${tag}=${value}`;
        })
        .join(",");
      this.hb.shape(this.#fonts.get(query.fontId)!.font, buffer, features);
      const output = buffer.json();
      if (direction === "rtl") output.reverse();
      const glyphs = output.map((g) =>
        Object.freeze({
          glyphId: g.g,
          cluster: g.cl,
          advanceX: g.ax,
          advanceY: g.ay,
          offsetX: g.dx,
          offsetY: g.dy,
        }),
      );
      return Object.freeze([
        Object.freeze({
          glyphs: Object.freeze(glyphs),
          direction,
          script: query.script ?? "Zyyy",
        }),
      ]);
    } catch (cause) {
      throw new FourError(
        "INVALID_APPLICATION_STATE",
        "HarfBuzz shaping failed",
        { cause },
      );
    } finally {
      buffer?.destroy();
    }
  }
  dispose(): void {
    if (this.#disposed) return;
    for (const id of this.#fonts.keys()) this.removeFont(id);
    this.#disposed = true;
  }
}
