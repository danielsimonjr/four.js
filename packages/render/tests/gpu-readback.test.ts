import { describe, expect, it } from "vitest";
import { FourError } from "@fourjs/core";
import { Rectangle2 } from "@fourjs/math";
import { planeGeometry } from "@fourjs/geometry";
import {
  UnlitMaterial,
  SpriteMaterial,
  StandardMaterial,
} from "@fourjs/materials";
import {
  Scene,
  OrthographicCamera,
  createFullscreenViewport,
} from "@fourjs/scene";
import {
  CanvasTexture,
  GpuReadbackSource,
  isGpuReadbackSource,
  NullRenderer,
  RenderTarget,
  RenderGraph,
  Renderable,
  Sprite,
  DEFAULT_RASTER_MAXIMUM_BYTES,
  type Renderer,
} from "../src/index.js";
const target = () => new RenderTarget({ width: 2, height: 2 });
function reader(readPixels: NonNullable<Renderer["readPixels"]>): Renderer {
  return Object.assign(new NullRenderer(), { readPixels });
}
describe("GPU raster snapshots", () => {
  it("copies region, preserves bottom-origin bytes and invalidates explicitly", async () => {
    const t = target(),
      region = new Rectangle2(1, 0, 1, 2),
      s = new GpuReadbackSource(t, { region });
    region.x = 99;
    const texture = new CanvasTexture(s);
    expect(texture.readbackTarget).toBe(t);
    texture.update();
    expect(Array.from(texture.data!)).toEqual(Array(8).fill(0));
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const r = reader((actual, area) => {
      expect(actual).toBe(t);
      expect(area).toEqual(new Rectangle2(1, 0, 1, 2));
      return Promise.resolve(bytes.buffer);
    });
    expect(await s.refresh(r)).toBe(true);
    bytes[0] = 99;
    expect(texture.update()).toBe(false);
    texture.invalidate();
    expect(texture.update()).toBe(true);
    expect(Array.from(texture.data!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await s.refresh(new NullRenderer())).toBe(false);
    const out = new Uint8Array(8);
    s.readPixels(out);
    expect(out[0]).toBe(1);
    expect(s.origin).toBe("bottom-left");
    expect(s.colorSpace).toBe("srgb");
    expect(s.byteLength).toBe(8);
    expect(isGpuReadbackSource(s)).toBe(true);
    for (const value of [null, 1, {}, "x"])
      expect(isGpuReadbackSource(value)).toBe(false);
    s.dispose();
    s.dispose();
    expect(s.disposed).toBe(true);
    expect(s.byteLength).toBe(0);
    expect(await s.refresh(r)).toBe(false);
    expect(() => s.readPixels(out)).toThrow(/disposed/);
    texture.dispose();
    t.dispose();
  });
  it("validates limits, lifecycle and backend byte contracts", async () => {
    expect(DEFAULT_RASTER_MAXIMUM_BYTES).toBe(64 * 1024 * 1024);
    const t = target();
    for (const maximumBytes of [0, NaN, -1, 15])
      expect(() => new GpuReadbackSource(t, { maximumBytes })).toThrow(
        RangeError,
      );
    expect(
      () => new GpuReadbackSource(t, { region: new Rectangle2(2, 0, 1, 1) }),
    ).toThrow(RangeError);
    expect(
      () => new GpuReadbackSource(t, { colorSpace: "bad" as "srgb" }),
    ).toThrow(RangeError);
    const s = new GpuReadbackSource(t, {
      colorSpace: "linear",
      maximumBytes: Infinity,
    });
    expect(s.colorSpace).toBe("linear");
    expect(() => s.readPixels(new Uint8Array(1))).toThrow(RangeError);
    await expect(
      s.refresh(reader(() => Promise.resolve(new ArrayBuffer(4)))),
    ).rejects.toThrow(/byte length/);
    const error = new FourError("CONTEXT_LOST", "lost");
    await expect(s.refresh(reader(() => Promise.reject(error)))).rejects.toBe(
      error,
    );
    expect(
      await s.refresh(reader(() => Promise.resolve(new ArrayBuffer(16)))),
    ).toBe(true);
    t.resize(3, 3);
    await expect(
      s.refresh(reader(() => Promise.resolve(new ArrayBuffer(16)))),
    ).rejects.toThrow(/resized/);
    s.dispose();
    t.dispose();
    expect(() => new GpuReadbackSource(t)).toThrow(/disposed/);
  });
  it("rejects concurrent refresh and discards reads after disposal", async () => {
    const t = target(),
      s = new GpuReadbackSource(t);
    let resolve!: (data: ArrayBuffer) => void;
    const r = reader(
      () =>
        new Promise<ArrayBuffer>((done) => {
          resolve = done;
        }),
    );
    const pending = s.refresh(r);
    await expect(s.refresh(r)).rejects.toThrow(/in flight/);
    s.dispose();
    resolve(new ArrayBuffer(16));
    expect(await pending).toBe(false);
    t.dispose();
  });
  it("does not publish a read if the target is disposed while awaiting", async () => {
    const t = target(),
      s = new GpuReadbackSource(t);
    await expect(
      s.refresh(
        reader(() => {
          t.dispose();
          return Promise.resolve(new ArrayBuffer(16));
        }),
      ),
    ).rejects.toThrow(/disposed/);
    s.dispose();
  });
  it("detects delayed feedback for maps and sprites without rejecting other targets", () => {
    const t = target(),
      other = target(),
      source = new GpuReadbackSource(t),
      texture = new CanvasTexture(source);
    const plain = new CanvasTexture({
      width: 1,
      height: 1,
      readPixels(out) {
        out.fill(0);
      },
    });
    expect(plain.readbackTarget).toBeNull();
    for (const sprite of [false, true]) {
      const scene = new Scene();
      scene.add(
        sprite
          ? new Sprite(new SpriteMaterial({ texture }))
          : new Renderable(
              planeGeometry(),
              new UnlitMaterial({ map: texture }),
            ),
      );
      const graph = new RenderGraph();
      graph.addPass("feedback", {
        root: scene,
        views: [createFullscreenViewport(new OrthographicCamera())],
        target: t,
      });
      expect(
        graph
          .validate()
          .some((x) => x.code === "feedback" && x.severity === "error"),
      ).toBe(true);
      const safe = new RenderGraph();
      safe.addPass("different", {
        root: scene,
        views: [createFullscreenViewport(new OrthographicCamera())],
        target: other,
      });
      expect(safe.validate().some((x) => x.code === "feedback")).toBe(false);
    }
    plain.dispose();
    texture.dispose();
    source.dispose();
    t.dispose();
    other.dispose();
  });
  it("tracks every standard-map feedback dependency", () => {
    const t = target(),
      source = new GpuReadbackSource(t),
      texture = new CanvasTexture(source);
    for (const key of [
      "map",
      "metalRoughnessMap",
      "emissiveMap",
      "normalMap",
      "occlusionMap",
    ] as const) {
      const material = new StandardMaterial();
      material[key] = texture;
      const scene = new Scene();
      scene.add(new Renderable(planeGeometry(), material));
      const graph = new RenderGraph();
      graph.addPass("feedback", {
        root: scene,
        views: [createFullscreenViewport(new OrthographicCamera())],
        target: t,
      });
      expect(
        graph.validate().some((issue) => issue.code === "feedback"),
        key,
      ).toBe(true);
      material.dispose();
    }
    texture.dispose();
    source.dispose();
    t.dispose();
  });
});
