/**
 * §54 skinning across the packages that have to agree about it (RFC 0003 —
 * gaps PH-10 + R-22, 2026-08-28): `@four/geometry` carries the influences,
 * `@four/scene` the bones and palette, `@four/animation` the joint and morph
 * tracks, `@four/render` the skinned items, `@four/render-webgl` the lazily
 * registered pipeline.
 *
 * Three claims live only in the composition:
 *
 * 1. **Byte-identity for skinless scenes — the RFC's acceptance gate.** A
 *    scene with no skinned mesh issues the identical GL transcript whether or
 *    not `registerSkinningPipeline()` was called, call for call and argument
 *    for argument; and a skinned mesh met *without* registration is skipped —
 *    absent from the transcript, never drawn in bind pose.
 * 2. **The full PH-10 stack**: a §17 skeletal-joint track (a quaternion track
 *    over `bones.0.transform.rotation` — a binding form, not a new track
 *    type) drives a real `Bone` through the real mixer, `Skeleton.update`
 *    turns the pose into the palette in the same render-list build, and the
 *    backend uploads exactly that palette. A §17 morph-weight track (a number
 *    track over `morphTargetWeights.0`) lands in the `MorphWeights` component
 *    through §54's own spelling.
 * 3. **Lazy compilation is observable**: the two skinned programs compile on
 *    the first skinned draw — never at initialize, never at registration.
 */

import {
  AnimationClip,
  AnimationMixer,
  AnimationTrack,
  numberAdapter,
  quaternionAdapter,
} from "@four/animation";
import { planeGeometry } from "@four/geometry";
import { Quaternion, Vector3 } from "@four/math";
import { LitMaterial, UnlitMaterial } from "@four/materials";
import { Mesh, Renderable } from "@four/render";
import {
  WebglRenderer,
  clearRegisteredSkinningPipeline,
  registerSkinningPipeline,
} from "@four/render-webgl";
import {
  Bone,
  MorphWeights,
  OrthographicCamera,
  Scene,
  Skeleton,
  createFullscreenViewport,
  resolveWorldTransforms,
  type Viewport,
} from "@four/scene";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecordingCanvas,
  createRecordingGl,
  type RecordingGl,
} from "./helpers/recording-gl.js";

interface Rig {
  readonly renderer: WebglRenderer;
  readonly recording: RecordingGl;
  readonly views: readonly Viewport[];
}

async function createRig(): Promise<Rig> {
  const recording = createRecordingGl();
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas: new RecordingCanvas(recording.gl) });
  const camera = new OrthographicCamera({
    left: -4,
    right: 4,
    bottom: -3,
    top: 3,
  });
  camera.transform.position.set(0, 0, 5);
  return { renderer, recording, views: [createFullscreenViewport(camera)] };
}

/** A plane whose four vertices all follow joint 0 with full weight. */
function skinnedPlaneGeometry(): ReturnType<typeof planeGeometry> {
  const geometry = planeGeometry({ width: 2, height: 2 });
  const vertexCount = geometry.vertexCount;
  geometry.joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i += 1) {
    weights[i * 4] = 1;
  }
  geometry.weights = weights;
  return geometry;
}

/** A one-bone skinned mesh, its bone parented under it. */
function skinnedMesh(material: UnlitMaterial | LitMaterial): {
  mesh: Mesh<UnlitMaterial | LitMaterial>;
  bone: Bone;
} {
  const mesh = new Mesh<UnlitMaterial | LitMaterial>(
    skinnedPlaneGeometry(),
    material,
  );
  const bone = new Bone();
  mesh.add(bone);
  mesh.skeleton = new Skeleton([bone]);
  return { mesh, bone };
}

/** The values of every `uniformMatrix4fv` upload, snapshotted immediately. */
function matrixUploads(recording: RecordingGl): number[][] {
  return recording
    .callsOf("uniformMatrix4fv")
    .map((call) => Array.from(call.args[2] as Float32Array));
}

afterEach(() => {
  clearRegisteredSkinningPipeline();
});

describe("byte-identity for skinless scenes (RFC 0003's acceptance gate)", () => {
  /** One frame of a small unskinned scene on a fresh rig; the transcript. */
  async function skinlessTranscript(): Promise<string[]> {
    const rig = await createRig();
    const scene = new Scene();
    scene.add(
      new Renderable(
        planeGeometry({ width: 2, height: 2 }),
        new UnlitMaterial(),
      ),
      new Renderable(planeGeometry(), new UnlitMaterial({ transparent: true })),
    );
    resolveWorldTransforms(scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    return rig.recording.transcript();
  }

  it("registration alone changes not one call of a skinless frame", async () => {
    clearRegisteredSkinningPipeline();
    const before = await skinlessTranscript();
    registerSkinningPipeline();
    const after = await skinlessTranscript();
    expect(after).toEqual(before);
  });

  it("skips an unregistered skinned draw — absent, never bind pose", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      clearRegisteredSkinningPipeline();
      // The same scene, with and without the skinned mesh: identical
      // transcripts, because the skipped draw contributes nothing at all.
      const bare = await createRig();
      const bareScene = new Scene();
      bareScene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
      resolveWorldTransforms(bareScene);
      bare.recording.reset();
      bare.renderer.render(bareScene, bare.views);
      const withoutMesh = bare.recording.transcript();

      const rig = await createRig();
      const scene = new Scene();
      scene.add(new Renderable(planeGeometry(), new UnlitMaterial()));
      const { mesh } = skinnedMesh(new UnlitMaterial());
      scene.add(mesh);
      resolveWorldTransforms(scene);
      rig.recording.reset();
      rig.renderer.render(scene, rig.views);

      expect(rig.recording.transcript()).toEqual(withoutMesh);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the skinned pipeline, end to end (§54, §62)", () => {
  it("compiles on the first skinned draw and uploads the live palette", async () => {
    registerSkinningPipeline();
    const rig = await createRig();
    const scene = new Scene();
    const { mesh, bone } = skinnedMesh(new UnlitMaterial());
    scene.add(mesh);
    resolveWorldTransforms(scene);

    // Registration compiled nothing; initialize compiled the seven eager
    // programs already. The first skinned frame adds exactly two.
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    expect(rig.recording.countOf("createProgram")).toBe(2);
    expect(rig.recording.countOf("drawElements")).toBe(1);

    // Move the bone one unit up: the palette uploaded next frame carries the
    // translation — Skeleton.update ran inside the render-list build.
    bone.transform.position.set(0, 1, 0);
    resolveWorldTransforms(scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    expect(rig.recording.countOf("createProgram")).toBe(0);
    const uploads = matrixUploads(rig.recording);
    // view-projection, model, palette — the palette is the 16-float upload
    // with the bone's translation in its y column.
    const palette = uploads.find((values) => values[13] === 1);
    expect(palette).toBeDefined();
    expect(palette?.[12]).toBe(0);
  });

  it("shades a skinned-lit mesh through the same §68 lights as a lit one", async () => {
    registerSkinningPipeline();
    const rig = await createRig();
    const scene = new Scene();
    scene.ambientLight[0] = 0.25;
    scene.ambientLight[1] = 0.25;
    scene.ambientLight[2] = 0.25;
    const { mesh } = skinnedMesh(new LitMaterial());
    scene.add(mesh);
    resolveWorldTransforms(scene);
    rig.recording.reset();
    rig.renderer.render(scene, rig.views);
    expect(rig.recording.countOf("drawElements")).toBe(1);
    // The lit family's per-view light uploads ran on the skinned program:
    // ambient, direction, and directional colour — three `vec3` uploads, with
    // the punctual set and the shadow state rightly skipped (no lamp casts).
    // The recorded *values* cannot be asserted here: `recording-gl.ts`
    // retains typed-array arguments by reference and every vec3 rides one
    // shared scratch (the R-37 gotcha), so the tape shows the last write.
    expect(rig.recording.countOf("uniform3fv")).toBe(3);
  });
});

describe("§17's two binding-form tracks drive the whole stack (PH-10)", () => {
  it("a skeletal-joint quaternion track poses a bone; the palette follows", () => {
    const scene = new Scene();
    const { mesh, bone } = skinnedMesh(new UnlitMaterial());
    scene.add(mesh);
    bone.transformAuthority = "animation";

    // A 1-second quarter-turn about +Z, slerped (§17's fifth interpolation
    // mode) — addressed through the skeleton, where the joint index is the
    // ABI (§33): no new track type, no new ValueKind.
    const quarter = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 2,
    );
    const clip = new AnimationClip({
      name: "wave",
      duration: 1,
      tracks: [
        new AnimationTrack({
          path: "bones.0.transform.rotation",
          adapter: quaternionAdapter,
          times: [0, 1],
          values: [new Quaternion(), quarter],
        }),
      ],
    });
    const mixer = new AnimationMixer(mesh.skeleton as Skeleton);
    mixer.play(clip);
    mixer.advance(0.5);

    // The bone's live quaternion is the slerped half-turn — an ordinary
    // transform write under the "animation" authority (§42).
    expect(bone.transform.rotation.z).toBeCloseTo(Math.sin(Math.PI / 8), 12);

    // …and the palette derives from it in the same frame's build.
    resolveWorldTransforms(scene);
    (mesh.skeleton as Skeleton).update(mesh);
    const palette = (mesh.skeleton as Skeleton).jointMatrices;
    const angle = Math.PI / 4;
    expect(palette[0]).toBeCloseTo(Math.cos(angle), 5);
    expect(palette[1]).toBeCloseTo(Math.sin(angle), 5);
  });

  it("a morph-weight number track writes one element through §54's spelling", () => {
    const mesh = new Mesh(skinnedPlaneGeometry(), new UnlitMaterial());
    mesh.addComponent(new MorphWeights(2));

    const clip = new AnimationClip({
      name: "blink",
      duration: 1,
      tracks: [
        new AnimationTrack({
          path: "morphTargetWeights.1",
          adapter: numberAdapter,
          times: [0, 1],
          values: [0, 1],
        }),
      ],
    });
    const mixer = new AnimationMixer(mesh);
    mixer.play(clip);
    mixer.advance(0.25);

    expect(mesh.morphTargetWeights?.[1]).toBeCloseTo(0.25, 12);
    expect(mesh.morphTargetWeights?.[0]).toBe(0);
    // The same array the render list snapshots onto the item.
    expect(mesh.getComponent(MorphWeights)?.weights[1]).toBeCloseTo(0.25, 12);
  });
});
