import { planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import {
  CanvasTexture,
  GpuReadbackSource,
  RenderTarget,
  Renderable,
  type Renderer,
} from "@fourjs/render";
import { WebglRenderer } from "@fourjs/render-webgl";
import { WebgpuRenderer } from "@fourjs/render-webgpu";
import {
  Scene,
  OrthographicCamera,
  createFullscreenViewport,
  resolveWorldTransforms,
} from "@fourjs/scene";

declare global {
  interface Window {
    fourReadbackProbe?: (
      backend: "webgl" | "webgpu",
    ) => Promise<{ snapshot: number[]; sampled: number[] }>;
  }
}
window.fourReadbackProbe = async (backend) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const renderer: Renderer =
    backend === "webgpu" ? new WebgpuRenderer() : new WebglRenderer();
  await renderer.initialize({ canvas });
  const target = new RenderTarget({ width: 16, height: 16 });
  const output = new RenderTarget({ width: 16, height: 16 });
  const camera = new OrthographicCamera({
    left: -1,
    right: 1,
    bottom: -1,
    top: 1,
    near: 0.1,
    far: 10,
  });
  camera.transform.position.z = 2;
  camera.updateProjectionMatrix();
  resolveWorldTransforms(camera);
  const view = {
    ...createFullscreenViewport(camera),
    clearColor: [1, 0, 0, 1] as [number, number, number, number],
  };
  const empty = new Scene();
  renderer.render(empty, [view], undefined, target);
  const source = new GpuReadbackSource(target);
  const texture = new CanvasTexture(source);
  await source.refresh(renderer);
  texture.invalidate();
  texture.update();
  const snapshot = Array.from(texture.data!);
  const scene = new Scene(),
    geometry = planeGeometry({ width: 2, height: 2 });
  const material = new UnlitMaterial({ map: texture, color: [1, 1, 1, 1] });
  scene.add(new Renderable(geometry, material));
  resolveWorldTransforms(scene);
  renderer.render(
    scene,
    [{ ...view, clearColor: [0, 0, 1, 1] }],
    undefined,
    output,
  );
  const sampled = Array.from(
    new Uint8Array(await renderer.readPixels!(output)),
  );
  texture.dispose();
  source.dispose();
  geometry.dispose();
  material.dispose();
  target.dispose();
  output.dispose();
  renderer.dispose();
  return { snapshot, sampled };
};
document.body.dataset["readbackReady"] = "1";
