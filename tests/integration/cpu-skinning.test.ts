import { planeGeometry } from "@fourjs/geometry";
import { Frustum, Matrix4 } from "@fourjs/math";
import { pick } from "@fourjs/input";
import { UnlitMaterial } from "@fourjs/materials";
import { Mesh, buildRenderList, buildViewRenderList } from "@fourjs/render";
import {
  Bone,
  OrthographicCamera,
  Scene,
  Skeleton,
  createFullscreenViewport,
} from "@fourjs/scene";
import { expect, it } from "vitest";

it("CPU-skinned geometry supplies the deformed silhouette to picking and frustum culling", () => {
  const geometry = planeGeometry();
  geometry.joints = new Uint16Array(geometry.vertexCount * 4);
  geometry.weights = new Float32Array(geometry.vertexCount * 4);
  for (let i = 0; i < geometry.vertexCount; i += 1) geometry.weights[i * 4] = 1;
  const mesh = new Mesh(geometry, new UnlitMaterial());
  mesh.skinningMode = "cpu";
  mesh.hitTestMode = "geometry";
  mesh.transform.position.z = -2;
  const bone = new Bone();
  bone.transform.position.set(1, 0, -2);
  mesh.skeleton = new Skeleton([bone]);
  const scene = new Scene();
  scene.add(mesh, bone);
  const camera = new OrthographicCamera({
    left: -2,
    right: 2,
    bottom: -2,
    top: 2,
    near: 1,
    far: 21,
  });
  const view = createFullscreenViewport(camera);
  camera.updateProjectionMatrix();
  camera.updateViewMatrix();
  const frustum = new Frustum().setFromViewProjection(
    new Matrix4().copy(camera.projectionMatrix).multiply(camera.viewMatrix),
  );
  const deformed = mesh.geometry;
  const bounds = deformed.computeBounds();
  const candidate = {
    node: mesh,
    boundsMin: bounds.min,
    boundsMax: bounds.max,
    triangles: { positions: deformed.positions, indices: deformed.indices },
  };
  expect(pick(camera, 0.5, 0, [candidate])[0]?.node).toBe(mesh);
  expect(pick(camera, 0, 0, [candidate])).toEqual([]);
  expect(
    buildViewRenderList(buildRenderList(scene, []), view, [], { frustum }),
  ).toHaveLength(1);
  bone.transform.position.set(10, 0, -2);
  expect(
    buildViewRenderList(buildRenderList(scene, []), view, [], { frustum }),
  ).toHaveLength(0);
});
