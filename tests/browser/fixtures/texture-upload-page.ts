import { planeGeometry } from "@fourjs/geometry";
import { UnlitMaterial } from "@fourjs/materials";
import { Rectangle2 } from "@fourjs/math";
import {
  ImageBitmapTexture,
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
    fourTextureProbe?: (backend: "webgl" | "webgpu") => Promise<{
      prepared: boolean[];
      initial: number[];
      changed: number[];
      copied: number[];
    }>;
  }
}
window.fourTextureProbe = async (backend) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 4;
  const renderer: Renderer =
    backend === "webgpu" ? new WebgpuRenderer() : new WebglRenderer();
  await renderer.initialize({ canvas });
  const painted = new OffscreenCanvas(2, 2),
    context = painted.getContext("2d")!;
  context.fillStyle = "red";
  context.fillRect(0, 0, 2, 1);
  context.fillStyle = "blue";
  context.fillRect(0, 1, 2, 1);
  const bitmap = await createImageBitmap(painted);
  const texture = new ImageBitmapTexture(bitmap, {
    surface: new OffscreenCanvas(1, 1),
    filter: "nearest",
    mipmaps: true,
  });
  bitmap.close(); // GPU restoration/upload must use the retained copy, not the closed host bitmap.
  const copied = Array.from(texture.data!);
  const target = new RenderTarget({ width: 4, height: 4 });
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
  const view = createFullscreenViewport(camera),
    scene = new Scene(),
    geometry = planeGeometry({ width: 2, height: 2 });
  const material = new UnlitMaterial({ map: texture, color: [1, 1, 1, 1] });
  scene.add(new Renderable(geometry, material));
  resolveWorldTransforms(scene);
  const prepared = [await renderer.prepareTexture!(texture)];
  renderer.render(scene, [view], undefined, target);
  const initial = Array.from(
    new Uint8Array(await renderer.readPixels!(target)),
  );
  texture.data!.set([0, 255, 0, 255], 0);
  texture.markDirty(new Rectangle2(0, 0, 1, 1));
  prepared.push(await renderer.prepareTexture!(texture));
  renderer.render(scene, [view], undefined, target);
  const changed = Array.from(
    new Uint8Array(await renderer.readPixels!(target)),
  );
  texture.dispose();
  geometry.dispose();
  material.dispose();
  target.dispose();
  renderer.dispose();
  return { prepared, initial, changed, copied };
};
document.body.dataset["textureReady"] = "1";
