/**
 * §77's mipmaps, min-filter split, and anisotropy across the packages that have
 * to agree about them (R-30b, 2026-08-21) — `@four/materials` declares the read
 * contract, `@four/render` owns the `Texture`, `@four/render-webgl` uploads it.
 *
 * Three claims live only in the composition:
 *
 * 1. **A scene whose textures name none of the three fields emits the
 *    byte-identical GL transcript** it emitted before this packet — asserted as
 *    a full transcript, call for call and argument for argument, against a
 *    context that *offers* `generateMipmap` and `getExtension` and is never
 *    asked for either. That is this repository's byte-identity discipline, and
 *    it is the reason the fields are opt-in.
 * 2. **Asking for a mip chain adds exactly one call**, in one place, and changes
 *    exactly one argument — the min filter — leaving the magnification filter,
 *    the wrap pair, and every draw untouched.
 * 3. **Anisotropy is negotiated, not demanded** (§62): the same scene runs on a
 *    device with the extension and on one without it, differing by one
 *    `texParameteri` and nothing else. A quality knob that made a scene
 *    unrunnable would be worse than one that costs less on weaker hardware.
 */

import { SpriteMaterial } from "@four/materials";
import { Texture, type TextureSource } from "@four/render";
import { WebglRenderer } from "@four/render-webgl";
import {
  OrthographicCamera,
  Scene,
  createFullscreenViewport,
  type Viewport,
} from "@four/scene";
import { Sprite } from "@four/render";
import { describe, expect, it } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordedCall,
  type RecordingGl,
} from "./helpers/recording-gl.js";

/** `GL_TEXTURE_MIN_FILTER` / `GL_TEXTURE_MAG_FILTER`; the backend's `GL` is not exported. */
const TEXTURE_MAG_FILTER = 0x2800;
const TEXTURE_MIN_FILTER = 0x2801;
const TEXTURE_MAX_ANISOTROPY_EXT = 0x84fe;
const LINEAR = 0x2601;
const LINEAR_MIPMAP_LINEAR = 0x2703;
const TEXTURE_2D = 0x0de1;

/**
 * How the device this rig pretends to be answers §77's two optional entry
 * points (`WebglContext.generateMipmap`, `WebglContext.getExtension`).
 */
interface Device {
  /** Whether the context can build a mip chain. Default true. */
  readonly mipmaps?: boolean;
  /** The device's anisotropy ceiling, or `0` for "extension absent". Default 16. */
  readonly maxAnisotropy?: number;
}

interface Rig {
  readonly renderer: WebglRenderer;
  readonly recording: RecordingGl;
  readonly views: readonly Viewport[];
}

/**
 * A recording context extended with §77's two optional entry points.
 *
 * `helpers/recording-gl.ts` predates them and declares neither — which is
 * itself part of claim 1, since a context missing both is a legal
 * `WebglContext`. They are added *here*, recording into the same tape, so this
 * suite can assert both what a capable device does and what a bare one does
 * without reshaping a helper five other suites depend on.
 */
function createDevice(device: Device = {}): RecordingGl {
  const recording = createRecordingGl();
  const gl = recording.gl as unknown as {
    generateMipmap?: (target: number) => void;
    getExtension?: (name: string) => unknown;
    getParameter: (pname: number) => unknown;
  };
  const maxAnisotropy = device.maxAnisotropy ?? 16;

  if (device.mipmaps !== false) {
    gl.generateMipmap = (target: number): void => {
      recording.calls.push({ name: "generateMipmap", args: [target] });
    };
  }
  gl.getExtension = (name: string): unknown => {
    recording.calls.push({ name: "getExtension", args: [name] });
    return maxAnisotropy > 0 ? { name } : null;
  };
  const inner = gl.getParameter.bind(gl);
  gl.getParameter = (pname: number): unknown => {
    const answer = inner(pname);
    return pname === 0x84ff ? maxAnisotropy : answer;
  };
  return recording;
}

async function createRig(device: Device = {}): Promise<Rig> {
  const recording = createDevice(device);
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
  const camera = new OrthographicCamera({
    left: -8,
    right: 8,
    bottom: -6,
    top: 6,
  });
  camera.transform.position.set(0, 0, 5);
  return { renderer, recording, views: [createFullscreenViewport(camera)] };
}

/** A 4 × 4 opaque source — big enough for a mip chain to have levels. */
function source(extra: Partial<TextureSource> = {}): TextureSource {
  return { width: 4, height: 4, data: new Uint8Array(4 * 4 * 4), ...extra };
}

/** One sprite over `texture`, in a scene of its own. */
function sceneWith(texture: Texture): Scene {
  const scene = new Scene();
  scene.add(new Sprite(new SpriteMaterial({ texture }), { width: 2 }));
  return scene;
}

/** Renders one frame of a one-sprite scene and returns the recorded tape. */
async function upload(
  texture: Texture,
  device: Device = {},
): Promise<{ transcript: string[]; calls: RecordedCall[] }> {
  const { renderer, recording, views } = await createRig(device);
  recording.reset();
  renderer.render(sceneWith(texture), views);
  const result = { transcript: recording.transcript(), calls: recording.calls };
  renderer.dispose();
  return result;
}

/** The `texParameteri` pnames and values of one tape, in order. */
function samplerState(calls: readonly RecordedCall[]): number[][] {
  return calls
    .filter((call) => call.name === "texParameteri")
    .map((call) => [call.args[1] as number, call.args[2] as number]);
}

describe("§77 mipmaps — a texture that never asked (R-30b byte-identity)", () => {
  it("emits no generateMipmap and no getExtension on a device offering both", async () => {
    const { transcript, calls } = await upload(new Texture(source()));

    expect(transcript.some((line) => line.startsWith("generateMipmap"))).toBe(
      false,
    );
    expect(transcript.some((line) => line.startsWith("getExtension"))).toBe(
      false,
    );
    // And the sampler state is the pair R-30 landed, unchanged: min and mag are
    // both the texture's `filter`, and no fifth parameter follows the wrap pair.
    expect(samplerState(calls).length).toBe(4);
    expect(samplerState(calls)[0]).toEqual([TEXTURE_MIN_FILTER, LINEAR]);
    expect(samplerState(calls)[1]).toEqual([TEXTURE_MAG_FILTER, LINEAR]);
  });

  it("draws the identical frame whether or not the device could mipmap", async () => {
    // The claim in its strongest form: on a context with *no* `generateMipmap`
    // at all, a texture that never asked for one produces the same transcript,
    // call for call and argument for argument.
    const capable = await upload(new Texture(source()));
    const bare = await upload(new Texture(source()), { mipmaps: false });

    expect(bare.transcript).toEqual(capable.transcript);
  });
});

describe("§77 mipmaps — a texture that asked (R-30b)", () => {
  it("adds one call and changes one argument, and nothing else", async () => {
    const plain = await upload(new Texture(source()));
    const mipped = await upload(new Texture(source({ mipmaps: true })));

    // Exactly one call more…
    expect(mipped.transcript.length).toBe(plain.transcript.length + 1);
    const added = mipped.transcript.filter(
      (line, index) => line !== plain.transcript[index],
    );
    expect(added[0]).toBe(`generateMipmap(${String(TEXTURE_2D)})`);

    // …and exactly one sampler argument different: the *minification* filter.
    // Magnification cannot use mip levels, so it stays what it was.
    expect(samplerState(mipped.calls)).toEqual([
      [TEXTURE_MIN_FILTER, LINEAR_MIPMAP_LINEAR],
      [TEXTURE_MAG_FILTER, LINEAR],
      ...samplerState(plain.calls).slice(2),
    ]);
  });

  it("generates the chain before the min filter that samples it", async () => {
    // Order is load-bearing: `generateMipmap` reads the level-0 image the
    // upload just wrote, and a mip-choosing min filter on a one-level texture
    // is *incomplete* in GL — it samples as opaque black.
    const { calls } = await upload(new Texture(source({ mipmaps: true })));
    const names = calls.map((call) => call.name);

    expect(names.indexOf("texImage2D")).toBeLessThan(
      names.indexOf("generateMipmap"),
    );
    expect(names.indexOf("generateMipmap")).toBeLessThan(
      names.indexOf("texParameteri"),
    );
  });

  it("degrades to an in-level filter where the device cannot generate a chain", async () => {
    const texture = new Texture(
      source({ mipmaps: true, minFilter: "linear-mipmap-linear" }),
    );

    const { calls } = await upload(texture, { mipmaps: false });

    // Not `LINEAR_MIPMAP_LINEAR`, which GL would call incomplete: a slightly
    // worse frame beats a black one, and §85's refusal is reserved for values
    // no device could honour.
    expect(samplerState(calls)[0]).toEqual([TEXTURE_MIN_FILTER, LINEAR]);
  });

  it("bills the whole chain to §84's texture memory, and nothing when absent", () => {
    // 4×4 RGBA8: 64 + 16 + 4.
    expect(new Texture(source({ mipmaps: true })).byteLength).toBe(84);
    expect(new Texture(source()).byteLength).toBe(64);
  });
});

describe("§77 anisotropy — negotiated, never demanded (§62, R-30b)", () => {
  it("clamps the request to the device ceiling and queries once per context", async () => {
    const texture = new Texture(source({ mipmaps: true, anisotropy: 64 }));

    const { calls } = await upload(texture, { maxAnisotropy: 4 });

    expect(calls.filter((call) => call.name === "getExtension").length).toBe(1);
    expect(
      samplerState(calls).filter(
        ([pname]) => pname === TEXTURE_MAX_ANISOTROPY_EXT,
      ),
    ).toEqual([[TEXTURE_MAX_ANISOTROPY_EXT, 4]]);
  });

  it("runs the same scene unchanged where the extension is absent", async () => {
    const build = (): Texture =>
      new Texture(source({ mipmaps: true, anisotropy: 8 }));

    const rich = await upload(build(), { maxAnisotropy: 16 });
    const poor = await upload(build(), { maxAnisotropy: 0 });

    // One `texParameteri` fewer, one `getExtension` more on neither side's
    // draw path, and every draw identical: §62's capability tiering, not §85's
    // refusal.
    expect(samplerState(rich.calls).length).toBe(
      samplerState(poor.calls).length + 1,
    );
    const draws = (tape: string[]): string[] =>
      tape.filter((line) => line.startsWith("draw"));
    expect(draws(rich.transcript).length).toBeGreaterThan(0);
    expect(draws(poor.transcript)).toEqual(draws(rich.transcript));
  });

  it("refuses at authoring time only what no device could honour (§85)", () => {
    expect(() => new Texture(source({ anisotropy: 0 }))).toThrow(
      /anisotropy must be an integer of at least 1/,
    );
    // …while a request beyond any real device is legal, and clamped above.
    expect(new Texture(source({ anisotropy: 64 })).anisotropy).toBe(64);
  });
});
