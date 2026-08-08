/**
 * The metallic-roughness pipeline (§59, §68) — this backend's sixth program,
 * added by R-13 on 2026-08-08.
 *
 * `@four/materials`' `StandardMaterial` says *what* the surface is; this module
 * says how WebGL 2 shades it. The division is `gl-program.ts`'s throughout:
 * the material carries numbers and a texture, the program carries the uniform
 * locations and the two shader stages, and `webgl-renderer.ts` carries the draw
 * loop that moves one into the other.
 *
 * It lives in a file of its own, as `gl-particles.ts` and `gl-effect.ts` do,
 * rather than joining the three pipelines in `gl-program.ts`: those three were
 * written together and share their vertex conventions with each other, while
 * every pipeline added since has been a separate concern with its own shader
 * pair. Its vertex arrays are still `gl-geometry.ts`'s — position at
 * `POSITION_ATTRIBUTE_LOCATION`, normal at `NORMAL_ATTRIBUTE_LOCATION`, uv at
 * `UV_ATTRIBUTE_LOCATION` — so
 * one geometry cache serves all six programs and a mesh can be moved between
 * the lit and the standard family without re-uploading anything.
 *
 * ## The BRDF, and why it is written this way (§59)
 *
 * Cook-Torrance over the metallic-roughness parameterization glTF defines:
 *
 * ```text
 * albedo   = baseColor × map
 * diffuse  = albedo × (1 − metalness)
 * F0       = mix(0.04, albedo, metalness)
 * α        = roughness²
 * D        = α² / (NdotH²(α² − 1) + 1)²          GGX, with 1/π folded out
 * V        = 0.5 / (NdotL·√(NdotV²(1−α²)+α²) + NdotV·√(NdotL²(1−α²)+α²))
 * F        = F0 + (1 − F0)(1 − VdotH)⁵           Schlick
 * out.rgb  = ambient·diffuse + (diffuse + D·V·F)·lightColor·NdotL + emissive
 * out.a    = albedo.a
 * ```
 *
 * Three choices in there are this engine's rather than the literature's, and
 * each is load-bearing:
 *
 * 1. **No `1/π` on either lobe.** The textbook diffuse BRDF is `albedo/π` and
 *    the textbook `D` carries a `1/π`; both are dropped here, which is the same
 *    thing as declaring that this engine's light colour × intensity is already
 *    an irradiance divided by π. That is exactly the convention `LitProgram`
 *    has used since 2026-08-04 (`fragment = color × lightColor × N·−L`), so a
 *    fully-rough dielectric `StandardMaterial` and a `LitMaterial` under the
 *    same light differ only by the specular lobe — which is what lets the two
 *    families sit in one scene and read as one lighting model. Dropping the
 *    `1/π` from *both* lobes also leaves the diffuse-to-specular ratio exactly
 *    where physics puts it; it is a change of light units, not of the BRDF.
 * 2. **Ambient reaches the diffuse lobe only.** There is no environment to
 *    reflect (§68's image-based lighting is staged), so a pure metal — which
 *    has no diffuse lobe at all — renders black under ambient light alone. That
 *    is physically what a mirror in a featureless void looks like; inventing an
 *    `F0 × ambient` term to avoid it would be a lie the day IBL lands and the
 *    real reflection replaces it.
 * 3. **Roughness is floored, not clamped.** `roughness: 0` makes `α² = 0` and
 *    `D` evaluate `0/0` at the exact highlight centre, i.e. NaN across a pixel.
 *    The floor is applied **in the shader**, where the division happens; the
 *    material itself deliberately does not clamp, because clamping authored
 *    data is the thing `UnlitMaterial` refused to do in WP-3.3.
 *
 * ## Color space (§60a)
 *
 * The same untagged linear space every other pipeline in this backend works in:
 * plain 0…1 numbers, straight (non-premultiplied) alpha, **no tone mapping and
 * no output transform** — §60a makes both the final render-graph pass and
 * neither exists yet (R-15). The standard and lit stages therefore write
 * comparable values into one framebuffer, which is the property that lets a
 * scene mix them. When the output transform lands it moves both.
 */

import type { Disposable } from "@four/core";
import type { Matrix4, Vector3 } from "@four/math";

import {
  MAP_TEXTURE_UNIT,
  createLinkedProgram,
  matrixScratch,
  requireUniform,
  type GlProgramHandle,
  type GlUniformLocation,
  type WebglContext,
} from "./gl-program.js";

/**
 * The vertex stage: object space → clip space, plus the world-space normal and
 * position the fragment stage needs, plus the uv.
 *
 * A **world position** is the one thing the lit pipeline's vertex stage does
 * not produce: a diffuse-only BRDF needs no view vector, and a specular one
 * cannot be evaluated without it. It is `(model × position).xyz`, and
 * `gl_Position` is then `viewProjection × world` — the same product the lit
 * stage forms as `viewProjection × model × position`, re-associated so the
 * world position is computed once rather than twice.
 *
 * The normal is transformed by the **inverse transpose** of the model matrix's
 * upper 3×3, the standard fix for non-uniform scale, derived in the shader for
 * the reason `LIT_VERTEX_SHADER_SOURCE` records — and staged with it: when
 * `@four/math`'s `Matrix3` grows a normal-matrix utility both stages hoist it
 * to a per-draw uniform together.
 */
const STANDARD_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;

uniform mat4 viewProjection;
uniform mat4 model;

out vec3 vNormal;
out vec3 vWorldPosition;
out vec2 vUv;

void main() {
  vec4 world = model * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  vNormal = transpose(inverse(mat3(model))) * normal;
  vUv = uv;
  gl_Position = viewProjection * world;
}
`;

/**
 * The fragment stage: §59's metallic-roughness BRDF under §68's one directional
 * light plus the scene ambient term. See the module header for the equations
 * and for the three conventions this engine fixes.
 *
 * Two guards keep a legitimate scene out of the undefined-behaviour corners,
 * and both mirror guards the lit stage already carries:
 *
 * - **A zero-length normal shades ambient-only.** A geometry with no `normals`
 *   attribute reads GL's constant default `(0, 0, 0, 1)`, whose xyz would turn
 *   `normalize()` into NaN. Same guard, same documented fallback as
 *   `LIT_FRAGMENT_SHADER_SOURCE`.
 * - **A back-facing surface takes the ambient branch.** `NdotL ≤ 0` skips the
 *   whole direct term rather than multiplying a specular lobe by a negative
 *   cosine. With back-face culling off (see `webgl-renderer.ts`) that is the
 *   honest look for a plane's back.
 *
 * `useMap` is the uniform switch every textured pipeline in this backend uses
 * (R-19): a uniform rather than a shader variant, so a textured and an
 * untextured standard draw share one program and one pipeline binding. See
 * `FRAGMENT_SHADER_SOURCE` for the full argument.
 */
const STANDARD_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec4 baseColor;
uniform sampler2D map;
uniform bool useMap;
uniform float metalness;
uniform float roughness;
uniform vec3 emissive;
uniform vec3 ambientLight;
uniform vec3 lightDirection;
uniform vec3 lightColor;
uniform vec3 cameraPosition;

in vec3 vNormal;
in vec3 vWorldPosition;
in vec2 vUv;

out vec4 fragColor;

const float DIELECTRIC_F0 = 0.04;
const float MIN_ROUGHNESS = 0.045;

void main() {
  vec4 base = baseColor;
  if (useMap) {
    base *= texture(map, vUv);
  }

  vec3 albedo = base.rgb;
  vec3 diffuseColor = albedo * (1.0 - metalness);
  vec3 f0 = mix(vec3(DIELECTRIC_F0), albedo, metalness);
  vec3 shaded = ambientLight * diffuseColor;

  float normalLength = length(vNormal);
  if (normalLength > 0.0) {
    vec3 n = vNormal / normalLength;
    vec3 l = -lightDirection;
    float nDotL = dot(n, l);
    if (nDotL > 0.0) {
      vec3 v = normalize(cameraPosition - vWorldPosition);
      vec3 h = normalize(l + v);
      float nDotV = max(dot(n, v), 1e-4);
      float nDotH = max(dot(n, h), 0.0);
      float vDotH = clamp(dot(v, h), 0.0, 1.0);

      float alpha = max(roughness, MIN_ROUGHNESS);
      alpha = alpha * alpha;
      float alpha2 = alpha * alpha;

      float denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
      float distribution = alpha2 / max(denominator * denominator, 1e-8);

      float visibilityV = nDotL * sqrt(nDotV * nDotV * (1.0 - alpha2) + alpha2);
      float visibilityL = nDotV * sqrt(nDotL * nDotL * (1.0 - alpha2) + alpha2);
      float visibility = 0.5 / max(visibilityV + visibilityL, 1e-6);

      vec3 fresnel = f0 + (vec3(1.0) - f0) * pow(1.0 - vDotH, 5.0);
      vec3 specular = vec3(distribution * visibility) * fresnel;

      shaded += (diffuseColor + specular) * lightColor * nDotL;
    }
  }

  fragColor = vec4(shaded + emissive, base.a);
}
`;

/** Scratch for this pipeline's `vec4` uploads; see `matrixScratch`. */
const colorScratch = new Float32Array(4);

/** Scratch for this pipeline's `vec3` uploads; see `matrixScratch`. */
const vec3Scratch = new Float32Array(3);

/**
 * The metallic-roughness pipeline (§57's `StandardMaterial`, §59, §68).
 *
 * ```ts
 * const program = StandardProgram.create(gl);
 * program.use();
 * program.setViewProjection(viewProjection);       // once per viewport
 * program.setAmbientLight(lights.ambientColor);    // once per viewport
 * program.setDirectionalLight(lights.direction, lights.directionalColor);
 * program.setCameraPosition(x, y, z);              // once per viewport
 * program.setFeatures(hasMap);                     // once per draw
 * program.setModel(item.worldMatrix);
 * program.setBaseColor(material.baseColor, material.opacity);
 * program.setSurface(material.metalness, material.roughness, material.emissive);
 * ```
 *
 * Light and camera uniforms are per-*frame* state uploaded per viewport — they
 * live in the program object, exactly like the view-projection, so one upload
 * holds for every standard draw into that view even when other pipelines run in
 * between.
 *
 * Owns its GL objects and nothing else; the renderer re-creates it on context
 * restore exactly as it re-creates the other five (§61).
 */
export class StandardProgram implements Disposable {
  readonly #gl: WebglContext;

  readonly #program: GlProgramHandle;

  readonly #viewProjectionLocation: GlUniformLocation;

  readonly #modelLocation: GlUniformLocation;

  readonly #baseColorLocation: GlUniformLocation;

  readonly #metalnessLocation: GlUniformLocation;

  readonly #roughnessLocation: GlUniformLocation;

  readonly #emissiveLocation: GlUniformLocation;

  readonly #ambientLightLocation: GlUniformLocation;

  readonly #lightDirectionLocation: GlUniformLocation;

  readonly #lightColorLocation: GlUniformLocation;

  readonly #cameraPositionLocation: GlUniformLocation;

  readonly #mapLocation: GlUniformLocation;

  readonly #useMapLocation: GlUniformLocation;

  /** CPU mirror of `useMap`; see `UnlitProgram`'s for the contract. */
  #useMap = false;

  #samplerUploaded = false;

  #disposed = false;

  private constructor(
    gl: WebglContext,
    program: GlProgramHandle,
    locations: readonly GlUniformLocation[],
  ) {
    this.#gl = gl;
    this.#program = program;
    // Positionally, from the one array `create` builds: twelve uniforms is more
    // than a constructor parameter list can carry without every call site
    // becoming a puzzle, and the array is written once, next to the names it
    // resolves.
    this.#viewProjectionLocation = locations[0];
    this.#modelLocation = locations[1];
    this.#baseColorLocation = locations[2];
    this.#metalnessLocation = locations[3];
    this.#roughnessLocation = locations[4];
    this.#emissiveLocation = locations[5];
    this.#ambientLightLocation = locations[6];
    this.#lightDirectionLocation = locations[7];
    this.#lightColorLocation = locations[8];
    this.#cameraPositionLocation = locations[9];
    this.#mapLocation = locations[10];
    this.#useMapLocation = locations[11];
  }

  /**
   * Compiles and links the standard program on `gl`.
   *
   * Fails exactly as `UnlitProgram.create` does — see it, and
   * `createLinkedProgram`, for the contract; the messages name `"standard"` and
   * the §89 code is the same.
   */
  static create(gl: WebglContext): StandardProgram {
    const program = createLinkedProgram(
      gl,
      "standard",
      STANDARD_VERTEX_SHADER_SOURCE,
      STANDARD_FRAGMENT_SHADER_SOURCE,
    );
    try {
      const names = [
        "viewProjection",
        "model",
        "baseColor",
        "metalness",
        "roughness",
        "emissive",
        "ambientLight",
        "lightDirection",
        "lightColor",
        "cameraPosition",
        "map",
        "useMap",
      ];
      return new StandardProgram(
        gl,
        program,
        names.map((name) => requireUniform(gl, program, name, "standard")),
      );
    } catch (error: unknown) {
      gl.deleteProgram(program);
      throw error;
    }
  }

  /** Whether {@link StandardProgram.dispose} has run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Makes this the current program. Call before any upload below. */
  use(): void {
    this.#gl.useProgram(this.#program);
  }

  /**
   * Uploads `projection * view` for the viewport being drawn. Column-major, so
   * `transpose` is false — the engine's `Matrix4` layout is already GL's (§7b).
   */
  setViewProjection(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(
      this.#viewProjectionLocation,
      false,
      matrixScratch,
    );
  }

  /** Uploads one render item's world matrix. See {@link setViewProjection}. */
  setModel(matrix: Matrix4): void {
    matrixScratch.set(matrix.elements);
    this.#gl.uniformMatrix4fv(this.#modelLocation, false, matrixScratch);
  }

  /**
   * Uploads §59's `baseColor` as straight-alpha, linear-light RGBA, scaled by
   * the material's `opacity` exactly as `UnlitProgram.setColor` does — see it
   * for the multiply and for why the default reproduces an untouched material's
   * upload bit for bit. Accepts the material's own live array; the values are
   * copied into scratch, so the material keeps ownership of its array.
   */
  setBaseColor(
    color: readonly [number, number, number, number],
    opacity = 1,
  ): void {
    colorScratch[0] = color[0];
    colorScratch[1] = color[1];
    colorScratch[2] = color[2];
    colorScratch[3] = color[3] * opacity;
    this.#gl.uniform4fv(this.#baseColorLocation, colorScratch);
  }

  /**
   * Uploads the three surface parameters §59 puts beside the base colour:
   * `metalness`, `roughness`, and the straight-RGB `emissive` term.
   *
   * One method rather than three, because they are one material's description
   * of one surface and every draw uploads all of them: splitting would triple
   * the call sites for no caller that wants two of the three. Values are
   * uploaded as authored — the material documents 0…1 and does not clamp, and
   * the *shader* applies the one floor it cannot survive without (see the
   * module header).
   */
  setSurface(
    metalness: number,
    roughness: number,
    emissive: readonly [number, number, number],
  ): void {
    this.#gl.uniform1f(this.#metalnessLocation, metalness);
    this.#gl.uniform1f(this.#roughnessLocation, roughness);
    vec3Scratch[0] = emissive[0];
    vec3Scratch[1] = emissive[1];
    vec3Scratch[2] = emissive[2];
    this.#gl.uniform3fv(this.#emissiveLocation, vec3Scratch);
  }

  /**
   * Uploads the scene ambient term (§68), straight RGB. Accepts the
   * `SceneLights` record's own live array — copied into scratch, as every
   * upload here is.
   */
  setAmbientLight(color: readonly [number, number, number]): void {
    vec3Scratch[0] = color[0];
    vec3Scratch[1] = color[1];
    vec3Scratch[2] = color[2];
    this.#gl.uniform3fv(this.#ambientLightLocation, vec3Scratch);
  }

  /**
   * Uploads the directional light (§68): the world-space unit vector the light
   * **travels along** (`SceneLights.direction` — the fragment stage negates it)
   * and its colour premultiplied by intensity (`SceneLights.directionalColor`).
   * A frame with no directional light uploads black, which zeroes the whole
   * direct term — one shader, no variants, exactly as in `LitProgram`.
   */
  setDirectionalLight(
    direction: Vector3,
    color: readonly [number, number, number],
  ): void {
    vec3Scratch[0] = direction.x;
    vec3Scratch[1] = direction.y;
    vec3Scratch[2] = direction.z;
    this.#gl.uniform3fv(this.#lightDirectionLocation, vec3Scratch);
    vec3Scratch[0] = color[0];
    vec3Scratch[1] = color[1];
    vec3Scratch[2] = color[2];
    this.#gl.uniform3fv(this.#lightColorLocation, vec3Scratch);
  }

  /**
   * Uploads the world-space eye position the specular lobe is evaluated
   * against — the one per-view input a diffuse-only pipeline never needed.
   *
   * Three scalars rather than a matrix or a `Vector3`, because the renderer
   * reads them straight out of the camera's world matrix translation column and
   * has nothing to allocate on the way.
   */
  setCameraPosition(x: number, y: number, z: number): void {
    vec3Scratch[0] = x;
    vec3Scratch[1] = y;
    vec3Scratch[2] = z;
    this.#gl.uniform3fv(this.#cameraPositionLocation, vec3Scratch);
  }

  /**
   * Selects whether this draw samples the bound base-colour texture (§59's
   * `map`). Identical in contract to `LitProgram.setFeatures` — mirrored on the
   * CPU, uploaded only on change, sampler unit uploaded lazily the first time
   * this program draws a texture at all.
   */
  setFeatures(useMap: boolean): void {
    if (useMap === this.#useMap) {
      return;
    }
    if (useMap && !this.#samplerUploaded) {
      this.#gl.uniform1i(this.#mapLocation, MAP_TEXTURE_UNIT);
      this.#samplerUploaded = true;
    }
    this.#gl.uniform1i(this.#useMapLocation, useMap ? 1 : 0);
    this.#useMap = useMap;
  }

  /**
   * Deletes the GL program (§83). Idempotent.
   *
   * **Only call this on a live context** — see `UnlitProgram.dispose`.
   */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#gl.deleteProgram(this.#program);
  }
}
