/** Verified harfbuzzjs 0.4.13 low-level APIs; no root auto-initialization import. */
declare module "harfbuzzjs/hb.js" {
  export default function create(options: {
    instantiateWasm: (
      imports: WebAssembly.Imports,
      success: (instance: WebAssembly.Instance) => void,
    ) => WebAssembly.Exports;
  }): Promise<unknown>;
}
declare module "harfbuzzjs/hbjs.js" {
  interface Handle {
    destroy(): void;
  }
  interface Face extends Handle {
    upem: number;
    reference_table(tag: string): Uint8Array;
  }
  interface Font extends Handle {
    setScale(x: number, y: number): void;
  }
  interface Buffer extends Handle {
    addText(text: string): void;
    guessSegmentProperties(): void;
    setDirection(direction: string): void;
    setScript(script: string): void;
    setLanguage(language: string): void;
    json(): {
      g: number;
      cl: number;
      ax: number;
      ay: number;
      dx: number;
      dy: number;
    }[];
  }
  interface API {
    createBlob(bytes: Uint8Array): Handle;
    createFace(blob: Handle, index: number): Face;
    createFont(face: Face): Font;
    createBuffer(): Buffer;
    shape(font: Font, buffer: Buffer, features?: string): void;
  }
  export default function wrap(module: unknown): API;
}
