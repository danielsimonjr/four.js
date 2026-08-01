/**
 * Unit tests for the WebGL 2 backend, driven by a hand-rolled fake context.
 *
 * ## Why a fake and not jsdom, headless-gl, or a browser
 *
 * The packet's testability split: the backend talks to GL through exactly one
 * interface (`WebglContext`, whose whole surface is written out in
 * `src/gl-program.ts`), so a hand-written object implementing those ~30 methods
 * is a *complete* double, not a partial stub. That buys three things a real
 * context cannot:
 *
 * 1. **Failure paths are reachable.** A driver will not fail to compile a
 *    shader on request, nor return `null` from `createVertexArray`, nor lose
 *    its context on cue. The fake does all three.
 * 2. **Call *sequences* are assertable.** The §61 clear/viewport contract is an
 *    ordering contract — rectangles before clears, colour only when
 *    `clearColor` is present, depth always — and ordering is invisible to a
 *    pixel comparison that happens to come out right for the wrong reason.
 * 3. **It runs in Node.** No jsdom (this package deliberately has no DOM
 *    dependency at all), no GPU, no SwiftShader, no flake.
 *
 * What the fake cannot check is whether the GL calls *mean* what we think —
 * that the shader links on a real driver, that the winding is right, that
 * anything appears on screen. That is WP-3.8's Playwright test against real
 * WebGL 2, and it is the reason this file asserts sequences rather than pixels.
 *
 * ## Why the scene objects are doubles too
 *
 * `@four/render-webgl`'s dependencies are `core`, `math`, and `render` (plan
 * §3.1, frozen — a worker may not add an edge). Cameras, `BufferGeometry`, and
 * `UnlitMaterial` live in `@four/scene`, `@four/geometry`, and
 * `@four/materials`, so importing them here — even in a test — would be a
 * phantom dependency outside the matrix. They are therefore typed doubles,
 * derived from the very types the renderer consumes
 * (`RenderItem["geometry"]`, `Parameters<Renderer["render"]>`), which keeps
 * them structurally exact while adding no edge. `Renderable` and
 * `buildRenderList` are used for real: `@four/render` *is* a dependency.
 */

import { FourError, isFourError } from "@four/core";
import { Matrix4, Quaternion, Vector3 } from "@four/math";
import {
  Renderable,
  Sprite,
  type RenderItem,
  type Renderer,
  type SpriteRenderItem,
  type UnlitRenderItem,
} from "@four/render";
import { beforeEach, describe, expect, it } from "vitest";

import {
  GL,
  GeometryCache,
  POSITION_ATTRIBUTE_LOCATION,
  SpriteProgram,
  TextureCache,
  UnlitProgram,
  WebglRenderer,
  type WebglCanvas,
  type WebglContext,
  type WebglContextAttributes,
  type WebglContextEventLike,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Types borrowed from the interface under test (no new dependency edges).
// ---------------------------------------------------------------------------

type RenderView = Parameters<Renderer["render"]>[1][number];
type RenderCamera = RenderView["camera"];
type ItemGeometry = RenderItem["geometry"];
/** The *unlit* half of the render item union — §57's `UnlitMaterial`. */
type ItemMaterial = UnlitRenderItem["material"];
type ItemSpriteMaterial = SpriteRenderItem["material"];
type ItemTexture = ItemSpriteMaterial["texture"];
type RenderInterpolation = NonNullable<Parameters<Renderer["render"]>[2]>;
type RenderPoseBuffer = RenderInterpolation["poseBuffer"];
type RenderNode = Parameters<Renderer["render"]>[0];

// ---------------------------------------------------------------------------
// The fake GL context.
// ---------------------------------------------------------------------------

/** One recorded entry point call. */
interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** Knobs the failure-path tests turn. */
interface FakeGlOptions {
  /** Result of `getShaderParameter(..., COMPILE_STATUS)`. Default true. */
  compileStatus?: boolean;
  /** Result of `getProgramParameter(..., LINK_STATUS)`. Default true. */
  linkStatus?: boolean;
  /** `getParameter(MAX_TEXTURE_SIZE)`. Default 4096. */
  maxTextureSize?: unknown;
  /** When false, `createShader` returns null. Default true. */
  allocateShaders?: boolean;
  /** When false, `createProgram` returns null. Default true. */
  allocatePrograms?: boolean;
  /** When false, `createVertexArray` returns null. Default true. */
  allocateVertexArrays?: boolean;
  /** When false, `createTexture` returns null. Default true. */
  allocateTextures?: boolean;
  /** When false, `createBuffer` returns null. Default true. */
  allocateBuffers?: boolean;
  /** When false, `getUniformLocation` returns null. Default true. */
  resolveUniforms?: boolean;
  /**
   * Text returned by both info-log getters. `null` is legal in WebGL and is
   * what a driver that has nothing to say may return.
   */
  infoLog?: string | null;
}

/** The double: `WebglContext` plus the recording surface the tests read. */
interface FakeGl extends WebglContext {
  readonly calls: RecordedCall[];
  /**
   * Uniform handles by name, from the **first** program that resolved each name
   * — which is the unlit one, since the renderer builds it first. Uniform
   * locations are per-program in real GL, so a name a second pipeline also
   * declares (`viewProjection`, `model`) gets a *different* handle there; see
   * {@link FakeGl.uniformsByProgram}.
   */
  readonly uniformLocations: Map<string, object>;
  /** Uniform handles by program, then by name — real GL's actual scoping. */
  readonly uniformsByProgram: Map<object, Map<string, object>>;
  names(): string[];
  callsOf(name: string): RecordedCall[];
  countOf(name: string): number;
  reset(): void;
}

/**
 * Copies typed-array arguments when recording.
 *
 * The renderer uploads out of a *shared* module-level scratch buffer (plan D7),
 * so retaining the reference would make every recorded upload show the last
 * frame's values. Snapshotting is what makes the uniform assertions mean
 * anything.
 */
function snapshot(args: readonly unknown[]): readonly unknown[] {
  return args.map((arg) =>
    ArrayBuffer.isView(arg) && !(arg instanceof DataView)
      ? Array.from(arg as unknown as ArrayLike<number>)
      : arg,
  );
}

function createFakeGl(options: FakeGlOptions = {}): FakeGl {
  const {
    compileStatus = true,
    linkStatus = true,
    maxTextureSize = 4096,
    allocateShaders = true,
    allocatePrograms = true,
    allocateVertexArrays = true,
    allocateTextures = true,
    allocateBuffers = true,
    resolveUniforms = true,
    infoLog = "",
  } = options;

  const calls: RecordedCall[] = [];
  const uniformLocations = new Map<string, object>();
  const uniformsByProgram = new Map<object, Map<string, object>>();
  let handleCount = 0;

  const record = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args: snapshot(args) });
  };
  const handle = (kind: string): object => {
    handleCount += 1;
    return { kind, serial: handleCount };
  };

  const gl: FakeGl = {
    calls,
    uniformLocations,
    uniformsByProgram,
    names: () => calls.map((call) => call.name),
    callsOf: (name) => calls.filter((call) => call.name === name),
    countOf: (name) => calls.filter((call) => call.name === name).length,
    reset: () => {
      calls.length = 0;
    },

    createShader(type) {
      record("createShader", type);
      return allocateShaders ? handle("shader") : null;
    },
    shaderSource(shader, source) {
      record("shaderSource", shader, source);
    },
    compileShader(shader) {
      record("compileShader", shader);
    },
    getShaderParameter(shader, pname) {
      record("getShaderParameter", shader, pname);
      return compileStatus;
    },
    getShaderInfoLog(shader) {
      record("getShaderInfoLog", shader);
      return infoLog;
    },
    deleteShader(shader) {
      record("deleteShader", shader);
    },

    createProgram() {
      record("createProgram");
      return allocatePrograms ? handle("program") : null;
    },
    attachShader(program, shader) {
      record("attachShader", program, shader);
    },
    linkProgram(program) {
      record("linkProgram", program);
    },
    getProgramParameter(program, pname) {
      record("getProgramParameter", program, pname);
      return linkStatus;
    },
    getProgramInfoLog(program) {
      record("getProgramInfoLog", program);
      return infoLog;
    },
    deleteProgram(program) {
      record("deleteProgram", program);
    },

    getUniformLocation(program, name) {
      record("getUniformLocation", program, name);
      if (!resolveUniforms) {
        return null;
      }
      let perProgram = uniformsByProgram.get(program);
      if (perProgram === undefined) {
        perProgram = new Map<string, object>();
        uniformsByProgram.set(program, perProgram);
      }
      let location = perProgram.get(name);
      if (location === undefined) {
        location = handle(`uniform:${name}`);
        perProgram.set(name, location);
        if (!uniformLocations.has(name)) {
          uniformLocations.set(name, location);
        }
      }
      return location;
    },
    useProgram(program) {
      record("useProgram", program);
    },
    uniformMatrix4fv(location, transpose, data) {
      record("uniformMatrix4fv", location, transpose, data);
    },
    uniform4fv(location, data) {
      record("uniform4fv", location, data);
    },
    uniform1i(location, value) {
      record("uniform1i", location, value);
    },

    createTexture() {
      record("createTexture");
      return allocateTextures ? handle("texture") : null;
    },
    bindTexture(target, texture) {
      record("bindTexture", target, texture);
    },
    texImage2D(
      target,
      level,
      internalFormat,
      width,
      height,
      border,
      format,
      type,
      pixels,
    ) {
      record(
        "texImage2D",
        target,
        level,
        internalFormat,
        width,
        height,
        border,
        format,
        type,
        pixels,
      );
    },
    texParameteri(target, pname, param) {
      record("texParameteri", target, pname, param);
    },
    deleteTexture(texture) {
      record("deleteTexture", texture);
    },
    activeTexture(unit) {
      record("activeTexture", unit);
    },

    createBuffer() {
      record("createBuffer");
      return allocateBuffers ? handle("buffer") : null;
    },
    bindBuffer(target, buffer) {
      record("bindBuffer", target, buffer);
    },
    bufferData(target, data, usage) {
      record("bufferData", target, data, usage);
    },
    deleteBuffer(buffer) {
      record("deleteBuffer", buffer);
    },

    createVertexArray() {
      record("createVertexArray");
      return allocateVertexArrays ? handle("vertexArray") : null;
    },
    bindVertexArray(array) {
      record("bindVertexArray", array);
    },
    deleteVertexArray(array) {
      record("deleteVertexArray", array);
    },
    enableVertexAttribArray(index) {
      record("enableVertexAttribArray", index);
    },
    vertexAttribPointer(index, size, type, normalized, stride, offset) {
      record(
        "vertexAttribPointer",
        index,
        size,
        type,
        normalized,
        stride,
        offset,
      );
    },

    getParameter(pname) {
      record("getParameter", pname);
      return maxTextureSize;
    },
    enable(capability) {
      record("enable", capability);
    },
    disable(capability) {
      record("disable", capability);
    },
    depthFunc(func) {
      record("depthFunc", func);
    },
    frontFace(mode) {
      record("frontFace", mode);
    },
    viewport(x, y, width, height) {
      record("viewport", x, y, width, height);
    },
    scissor(x, y, width, height) {
      record("scissor", x, y, width, height);
    },
    clearColor(red, green, blue, alpha) {
      record("clearColor", red, green, blue, alpha);
    },
    clearDepth(depth) {
      record("clearDepth", depth);
    },
    clear(mask) {
      record("clear", mask);
    },
    blendFunc(sourceFactor, destinationFactor) {
      record("blendFunc", sourceFactor, destinationFactor);
    },
    drawArrays(mode, first, count) {
      record("drawArrays", mode, first, count);
    },
    drawElements(mode, count, type, offset) {
      record("drawElements", mode, count, type, offset);
    },
    isContextLost() {
      record("isContextLost");
      return false;
    },
  };

  return gl;
}

// ---------------------------------------------------------------------------
// The fake canvas.
// ---------------------------------------------------------------------------

class TestCanvas implements WebglCanvas {
  width = 300;

  height = 150;

  readonly attributes: (WebglContextAttributes | undefined)[] = [];

  readonly listeners = new Map<
    string,
    ((event: WebglContextEventLike) => void)[]
  >();

  readonly #context: unknown;

  constructor(context: unknown) {
    this.#context = context;
  }

  getContext(
    contextId: "webgl2",
    attributes?: WebglContextAttributes,
  ): unknown {
    expect(contextId).toBe("webgl2");
    this.attributes.push(attributes);
    return this.#context;
  }

  addEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      this.listeners.set(type, [listener]);
    } else {
      existing.push(listener);
    }
  }

  removeEventListener(
    type: string,
    listener: (event: WebglContextEventLike) => void,
  ): void {
    const existing = this.listeners.get(type);
    if (existing === undefined) {
      return;
    }
    const index = existing.indexOf(listener);
    if (index !== -1) {
      existing.splice(index, 1);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }

  /** Delivers an event; returns whether a listener called `preventDefault`. */
  dispatch(type: string): boolean {
    let prevented = false;
    const event: WebglContextEventLike = {
      preventDefault() {
        prevented = true;
      },
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
    return prevented;
  }
}

// ---------------------------------------------------------------------------
// Scene-side doubles (see the header for why these are not the real classes).
// ---------------------------------------------------------------------------

let nextTestGeometryId = 0;

/** A `BufferGeometry` reduced to what the backend reads (§53). */
class TestGeometry {
  readonly id: string;

  version = 0;

  positions: Float32Array;

  indices: Uint16Array | Uint32Array | undefined;

  mode: "triangles" | "lines" = "triangles";

  constructor(
    positions: Float32Array,
    indices?: Uint16Array | Uint32Array,
    mode: "triangles" | "lines" = "triangles",
  ) {
    nextTestGeometryId += 1;
    this.id = `test-geometry-${String(nextTestGeometryId)}`;
    this.positions = positions;
    this.indices = indices;
    this.mode = mode;
  }

  get drawCount(): number {
    return this.indices === undefined
      ? this.positions.length / 3
      : this.indices.length;
  }

  /** §53's `markDirty()`: announce an edit the geometry could not see. */
  markDirty(): void {
    this.version += 1;
  }

  /** §53's `dispose()`: empties the arrays and bumps the version. */
  dispose(): void {
    this.positions = new Float32Array(0);
    this.indices = undefined;
    this.markDirty();
  }

  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

/** An `UnlitMaterial` reduced to what the backend reads (§57). */
class TestMaterial {
  readonly color: [number, number, number, number];

  constructor(color: [number, number, number, number] = [1, 1, 1, 1]) {
    this.color = color;
  }

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

let nextTestTextureId = 0;

/**
 * A `Texture` reduced to the `SpriteTexture` read surface a backend sees (§77).
 *
 * The concrete class lives in `@four/render`, which *is* a dependency — but the
 * cache is typed against `SpriteRenderItem["material"]["texture"]`, i.e. the
 * structural contract, and a double is what proves the cache reads nothing
 * outside it. It also makes the failure paths reachable: a real texture cannot
 * be asked to report a version that never advanced.
 */
class TestTexture {
  readonly id: string;

  version = 0;

  width: number;

  height: number;

  data: Uint8Array | null;

  disposed = false;

  constructor(width = 2, height = 2, data: Uint8Array | null = null) {
    nextTestTextureId += 1;
    this.id = `test-texture-${String(nextTestTextureId)}`;
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8Array(width * height * 4);
  }

  /** §77's `markDirty()`: announce a texel edit the texture could not see. */
  markDirty(): void {
    this.version += 1;
  }

  /** §77's `dispose()`: drops the data and bumps the version. */
  dispose(): void {
    this.disposed = true;
    this.data = null;
    this.markDirty();
  }

  /**
   * No cast is needed — the double satisfies the `SpriteTexture` contract
   * structurally, which is the point of that contract. The accessor exists so
   * the doubles all read the same way.
   */
  get asTexture(): ItemTexture {
    return this;
  }
}

/** A `SpriteMaterial` reduced to what the backend reads (§55, §57). */
class TestSpriteMaterial {
  readonly tint: [number, number, number, number];

  texture: ItemTexture;

  constructor(
    texture: TestTexture = new TestTexture(),
    tint: [number, number, number, number] = [1, 1, 1, 1],
  ) {
    this.texture = texture.asTexture;
    this.tint = tint;
  }

  get asMaterial(): ItemSpriteMaterial {
    return this as unknown as ItemSpriteMaterial;
  }
}

/** A `Camera` reduced to what the backend reads and calls (§47). */
class TestCamera {
  readonly projectionMatrix = new Matrix4();

  readonly viewMatrix = new Matrix4();

  updateViewMatrixCalls = 0;

  updateViewMatrix(): void {
    this.updateViewMatrixCalls += 1;
  }

  get asCamera(): RenderCamera {
    return this as unknown as RenderCamera;
  }
}

/**
 * A `PoseBuffer` reduced to the one method the interpolated render list calls
 * (§43).
 *
 * `PoseBuffer` lives in `@four/scene`, outside this package's dependency
 * matrix, so — like the camera, geometry, and material above — it is a double.
 * The interpolation *arithmetic* under test is `@four/render`'s real
 * `buildInterpolatedRenderList`; what this double supplies is the pair of poses
 * a simulation would have captured, so the assertion is about which list the
 * backend built and what it uploaded, not about lerp.
 */
class TestPoseBuffer {
  /** Nodes this buffer claims to track, with the two poses §43 blends. */
  readonly tracked = new Map<
    RenderNode,
    { readonly from: Vector3; readonly to: Vector3 }
  >();

  /** Alphas the render list asked about, in call order. */
  readonly alphas: number[] = [];

  track(node: RenderNode, from: Vector3, to: Vector3): this {
    this.tracked.set(node, { from, to });
    return this;
  }

  /** `PoseBuffer.computeRenderPose`: lerp position, leave rotation identity. */
  computeRenderPose(
    node: RenderNode,
    alpha: number,
    outPosition: Vector3,
    outRotation: Quaternion,
  ): boolean {
    const entry = this.tracked.get(node);
    if (entry === undefined) {
      return false;
    }
    this.alphas.push(alpha);
    outPosition.copy(entry.from).lerp(entry.to, alpha);
    outRotation.identity();
    return true;
  }

  get asPoseBuffer(): RenderPoseBuffer {
    return this as unknown as RenderPoseBuffer;
  }
}

/** The §43 argument `Application` passes to `render` each frame. */
function interpolationAt(
  poses: TestPoseBuffer,
  alpha: number,
): RenderInterpolation {
  return { poseBuffer: poses.asPoseBuffer, alpha };
}

/** The model matrices uploaded by the last render, in upload order. */
function modelUploads(gl: FakeGl): number[][] {
  const model = gl.uniformLocations.get("model");
  return gl
    .callsOf("uniformMatrix4fv")
    .filter((call) => call.args[0] === model)
    .map((call) => call.args[2] as number[]);
}

/** Three vertices, one unindexed triangle. */
function triangleGeometry(): TestGeometry {
  return new TestGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    undefined,
  );
}

/** Four vertices, two indexed triangles (`Uint16Array` indices). */
function quadGeometry(): TestGeometry {
  return new TestGeometry(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    new Uint16Array([0, 1, 2, 0, 2, 3]),
  );
}

function renderable(
  geometry: TestGeometry,
  material: TestMaterial = new TestMaterial(),
): Renderable {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

/**
 * A real `Sprite` — `@four/render` is a dependency, and the quad it builds from
 * its anchor and size is exactly what the `quad` uniform assertions are about.
 * Only the material and the texture are doubles.
 */
function sprite(
  material: TestSpriteMaterial = new TestSpriteMaterial(),
  options?: ConstructorParameters<typeof Sprite>[1],
): Sprite {
  return new Sprite(material.asMaterial, options);
}

/**
 * The sprite program's uniform handles, found by the one uniform name only it
 * declares. Uniform locations are per-program (see {@link FakeGl}), so this is
 * what distinguishes a sprite `model` upload from an unlit one.
 */
function spriteUniforms(gl: FakeGl): Map<string, object> {
  for (const perProgram of gl.uniformsByProgram.values()) {
    if (perProgram.has("tint")) {
      return perProgram;
    }
  }
  throw new Error("the sprite program never resolved its uniforms");
}

/** Values uploaded to `location` by the recorded calls, in upload order. */
function uploadsAt(gl: FakeGl, location: object | undefined): unknown[] {
  return gl.calls
    .filter((call) => call.args[0] === location)
    .map((call) => call.args[call.args.length - 1]);
}

/**
 * A container node.
 *
 * `Group`/`Scene` live in `@four/scene`, which is outside this package's
 * dependency matrix, so the root is a `Renderable` carrying an *empty*
 * geometry: it generates a render item, the geometry cache reports "nothing to
 * draw", and it contributes no GL call — a container in everything but name.
 */
function createRoot(): Renderable {
  return renderable(new TestGeometry(new Float32Array(0)));
}

function createView(
  camera: TestCamera,
  overrides: Partial<RenderView> = {},
): RenderView {
  return {
    id: "main",
    camera: camera.asCamera,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    normalized: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness.
// ---------------------------------------------------------------------------

interface Harness {
  gl: FakeGl;
  canvas: TestCanvas;
  renderer: WebglRenderer;
  camera: TestCamera;
}

async function initialized(options: FakeGlOptions = {}): Promise<Harness> {
  const gl = createFakeGl(options);
  const canvas = new TestCanvas(gl);
  const renderer = new WebglRenderer();
  await renderer.initialize({ canvas });
  return { gl, canvas, renderer, camera: new TestCamera() };
}

/** Awaits a rejection and returns the `FourError` it carried. */
async function rejection(promise: Promise<unknown>): Promise<FourError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw new Error(`expected a FourError, got ${String(error)}`);
  }
  throw new Error("expected the promise to reject");
}

/** Runs `body`, expecting a `FourError`, and returns it. */
function thrown(body: () => void): FourError {
  try {
    body();
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw new Error(`expected a FourError, got ${String(error)}`);
  }
  throw new Error("expected the call to throw");
}

/** Index of the first call named `name`, or -1. */
function indexOf(gl: FakeGl, name: string): number {
  return gl.names().indexOf(name);
}

beforeEach(() => {
  nextTestGeometryId = 0;
});

// ---------------------------------------------------------------------------

describe("WebglRenderer — initialization (§61, §62)", () => {
  it("implements the Renderer interface", async () => {
    const { renderer } = await initialized();
    const asInterface: Renderer = renderer;

    expect(typeof asInterface.initialize).toBe("function");
    expect(typeof asInterface.render).toBe("function");
    expect(typeof asInterface.resize).toBe("function");
    expect(typeof asInterface.dispose).toBe("function");
    expect(asInterface.events.listenerCount("contextlost")).toBe(0);
  });

  it("reports the webgl2 backend before initialization, with no texture limit", () => {
    const renderer = new WebglRenderer();

    expect(renderer.capabilities.backend).toBe("webgl2");
    expect(renderer.capabilities.maxTextureSize).toBe(0);
    expect(renderer.initialized).toBe(false);
  });

  it("publishes MAX_TEXTURE_SIZE from the context after initialization (§62)", async () => {
    const { renderer, gl } = await initialized({ maxTextureSize: 8192 });

    expect(renderer.capabilities.maxTextureSize).toBe(8192);
    expect(renderer.initialized).toBe(true);
    expect(gl.callsOf("getParameter")[0].args[0]).toBe(GL.MAX_TEXTURE_SIZE);
  });

  it("reports 0 when the driver answers MAX_TEXTURE_SIZE with a non-number", async () => {
    const { renderer } = await initialized({ maxTextureSize: null });

    expect(renderer.capabilities.maxTextureSize).toBe(0);
  });

  it("requests a webgl2 context with depth, no stencil, and the antialias hint", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    const renderer = new WebglRenderer();

    await renderer.initialize({ canvas, antialias: true });

    expect(canvas.attributes).toEqual([
      { alpha: true, antialias: true, depth: true, stencil: false },
    ]);
  });

  it("defaults antialias to false when the option is absent (§45 hint)", async () => {
    const { canvas } = await initialized();

    expect(canvas.attributes[0]?.antialias).toBe(false);
  });

  it("rejects with RENDERER_INITIALIZATION_FAILED when no canvas is given", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(renderer.initialize());

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(renderer.initialized).toBe(false);
  });

  it("rejects when `canvas` is not an object", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(renderer.initialize({ canvas: "canvas" }));

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects when `canvas` lacks the members this backend uses", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: { getContext: () => null } }),
    );

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects when getContext returns null (WebGL 2 unavailable or blocked)", async () => {
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: new TestCanvas(null) }),
    );

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
    expect(error.context?.received).toBe("null");
  });

  it("rejects a WebGL 1 style context that lacks createVertexArray", async () => {
    const gl = createFakeGl() as unknown as Record<string, unknown>;
    delete gl.createVertexArray;
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: new TestCanvas(gl) }),
    );

    expect(error.code).toBe("RENDERER_INITIALIZATION_FAILED");
  });

  it("rejects a second initialize with INVALID_APPLICATION_STATE", async () => {
    const { renderer, canvas } = await initialized();

    const error = await rejection(renderer.initialize({ canvas }));

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("sets the fixed GL state: depth test, LEQUAL, CCW, no culling, scissor on", async () => {
    const { gl } = await initialized();

    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.DEPTH_TEST,
      GL.SCISSOR_TEST,
    ]);
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.CULL_FACE,
    ]);
    expect(gl.callsOf("depthFunc")[0].args[0]).toBe(GL.LEQUAL);
    expect(gl.callsOf("frontFace")[0].args[0]).toBe(GL.CCW);
  });

  it("wires both context-loss listeners onto the canvas (§61)", async () => {
    const { canvas } = await initialized();

    expect(canvas.listenerCount("webglcontextlost")).toBe(1);
    expect(canvas.listenerCount("webglcontextrestored")).toBe(1);
  });

  it("adopts the canvas's current size as the drawing-buffer size", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    canvas.width = 640;
    canvas.height = 480;
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas });
    const camera = new TestCamera();
    gl.reset();

    renderer.render(createRoot(), [createView(camera)]);

    expect(gl.callsOf("scissor")[0].args).toEqual([0, 0, 640, 480]);
  });

  it("lets a resize issued before initialize win over the canvas attributes", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    const renderer = new WebglRenderer();

    renderer.resize(200, 100, 2);
    await renderer.initialize({ canvas });

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);
  });
});

describe("UnlitProgram — compilation and linking (§61, §89)", () => {
  it("compiles both stages, links, and resolves the three uniforms", () => {
    const gl = createFakeGl();

    const program = UnlitProgram.create(gl);

    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.callsOf("createShader").map((call) => call.args[0])).toEqual([
      GL.VERTEX_SHADER,
      GL.FRAGMENT_SHADER,
    ]);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(["viewProjection", "model", "color"]);
    expect(program.disposed).toBe(false);
  });

  it("emits GLSL ES 3.00 sources with the version directive on line 1", () => {
    const gl = createFakeGl();

    UnlitProgram.create(gl);

    const sources = gl.callsOf("shaderSource").map((call) => call.args[1]);
    for (const source of sources) {
      expect(typeof source).toBe("string");
      expect(String(source).startsWith("#version 300 es\n")).toBe(true);
    }
    expect(String(sources[0])).toContain(
      `layout(location = ${String(POSITION_ATTRIBUTE_LOCATION)}) in vec3 position;`,
    );
    expect(String(sources[1])).toContain("uniform vec4 color;");
  });

  it("deletes both shader objects after a successful link", () => {
    const gl = createFakeGl();

    UnlitProgram.create(gl);

    expect(gl.countOf("deleteShader")).toBe(2);
  });

  it("throws SHADER_COMPILATION_FAILED with the info log when a stage fails", () => {
    const gl = createFakeGl({ compileStatus: false, infoLog: "ERROR: 0:3" });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");
    expect(error.context?.log).toBe("ERROR: 0:3");
    expect(typeof error.context?.source).toBe("string");
  });

  it("deletes the vertex shader when the fragment stage is the one that fails", () => {
    let compiled = 0;
    const gl = createFakeGl();
    const base = gl.getShaderParameter.bind(gl);
    gl.getShaderParameter = (shader, pname): boolean => {
      base(shader, pname);
      compiled += 1;
      return compiled === 1;
    };

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.context?.stage).toBe("fragment");
    // One from the failing stage's own cleanup, one for the vertex shader.
    expect(gl.countOf("deleteShader")).toBe(2);
    expect(gl.countOf("createProgram")).toBe(0);
  });

  it("throws SHADER_COMPILATION_FAILED when linking fails, and deletes the program", () => {
    const gl = createFakeGl({ linkStatus: false, infoLog: "link error" });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("link");
    expect(error.context?.log).toBe("link error");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("reports an empty log when the driver returns null from either getter", () => {
    const compileError = thrown(() => {
      UnlitProgram.create(
        createFakeGl({ compileStatus: false, infoLog: null }),
      );
    });
    const linkError = thrown(() => {
      UnlitProgram.create(createFakeGl({ linkStatus: false, infoLog: null }));
    });

    expect(compileError.context?.log).toBe("");
    expect(linkError.context?.log).toBe("");
  });

  it("throws when GL will not allocate a shader object", () => {
    const gl = createFakeGl({ allocateShaders: false });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");
  });

  it("throws when GL will not allocate a program object", () => {
    const gl = createFakeGl({ allocatePrograms: false });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("link");
  });

  it("throws when a uniform the backend wrote is missing from the link", () => {
    const gl = createFakeGl({ resolveUniforms: false });

    const error = thrown(() => {
      UnlitProgram.create(gl);
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.uniform).toBe("viewProjection");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("propagates a shader failure out of initialize as a rejection", async () => {
    const gl = createFakeGl({ compileStatus: false });
    const renderer = new WebglRenderer();

    const error = await rejection(
      renderer.initialize({ canvas: new TestCanvas(gl) }),
    );

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(renderer.initialized).toBe(false);
  });

  it("deletes the GL program once, idempotently", () => {
    const gl = createFakeGl();
    const program = UnlitProgram.create(gl);

    program.dispose();
    program.dispose();

    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });
});

describe("GeometryCache — vertex arrays keyed by id and version (§53, §64)", () => {
  it("uploads positions and indices into one vertex array", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();

    const record = cache.acquire(geometry.asGeometry);

    expect(record).not.toBeNull();
    expect(record?.mode).toBe(GL.TRIANGLES);
    expect(record?.count).toBe(6);
    expect(record?.indexType).toBe(GL.UNSIGNED_SHORT);
    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("createBuffer")).toBe(2);
    expect(gl.callsOf("vertexAttribPointer")[0].args).toEqual([
      POSITION_ATTRIBUTE_LOCATION,
      3,
      GL.FLOAT,
      false,
      0,
      0,
    ]);
    expect(cache.size).toBe(1);
  });

  it("unbinds the vertex array before clearing ARRAY_BUFFER, never the index binding", () => {
    const gl = createFakeGl();
    new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    const names = gl.names();
    const unbindVao = names.lastIndexOf("bindVertexArray");
    const unbindArray = names.lastIndexOf("bindBuffer");
    expect(unbindVao).toBeLessThan(unbindArray);
    expect(gl.callsOf("bindBuffer").at(-1)?.args).toEqual([
      GL.ARRAY_BUFFER,
      null,
    ]);
  });

  it("creates one buffer and uses drawArrays data for a non-indexed geometry", () => {
    const gl = createFakeGl();
    const record = new GeometryCache(gl).acquire(triangleGeometry().asGeometry);

    expect(record?.indexType).toBeNull();
    expect(record?.count).toBe(3);
    expect(gl.countOf("createBuffer")).toBe(1);
  });

  it("maps the lines draw mode and Uint32 indices onto their GL enumerants", () => {
    const gl = createFakeGl();
    const geometry = new TestGeometry(
      new Float32Array([0, 0, 0, 1, 1, 1]),
      new Uint32Array([0, 1]),
      "lines",
    );

    const record = new GeometryCache(gl).acquire(geometry.asGeometry);

    expect(record?.mode).toBe(GL.LINES);
    expect(record?.indexType).toBe(GL.UNSIGNED_INT);
  });

  it("reuses the cached vertex array while the version is unchanged", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();

    const first = cache.acquire(geometry.asGeometry);
    const second = cache.acquire(geometry.asGeometry);

    expect(second).toBe(first);
    expect(gl.countOf("createVertexArray")).toBe(1);
  });

  it("evicts and re-uploads when the version advances (§53 cache key)", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();
    cache.acquire(geometry.asGeometry);
    gl.reset();

    geometry.positions[0] = 5;
    geometry.markDirty();
    const record = cache.acquire(geometry.asGeometry);

    expect(gl.countOf("deleteVertexArray")).toBe(1);
    expect(gl.countOf("deleteBuffer")).toBe(2);
    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(record?.version).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("keeps one entry per geometry id", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);

    cache.acquire(quadGeometry().asGeometry);
    cache.acquire(triangleGeometry().asGeometry);

    expect(cache.size).toBe(2);
    expect(gl.countOf("createVertexArray")).toBe(2);
  });

  it("returns null and creates no entry for a geometry with nothing to draw", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);

    const record = cache.acquire(
      new TestGeometry(new Float32Array(0)).asGeometry,
    );

    expect(record).toBeNull();
    expect(cache.size).toBe(0);
    expect(gl.countOf("createVertexArray")).toBe(0);
  });

  it("evicts a disposed geometry lazily, on its next acquire", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    const geometry = quadGeometry();
    cache.acquire(geometry.asGeometry);
    gl.reset();

    geometry.dispose();
    const record = cache.acquire(geometry.asGeometry);

    expect(record).toBeNull();
    expect(cache.size).toBe(0);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
    expect(gl.countOf("deleteBuffer")).toBe(2);
  });

  it("returns null rather than throwing when GL will not allocate a vertex array", () => {
    const gl = createFakeGl({ allocateVertexArrays: false });

    const record = new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    expect(record).toBeNull();
  });

  it("cleans up a partly built record when a buffer allocation fails", () => {
    const gl = createFakeGl({ allocateBuffers: false });

    const record = new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    expect(record).toBeNull();
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });

  it("deletes the index buffer allocation failure's earlier objects", () => {
    let created = 0;
    const gl = createFakeGl();
    const base = gl.createBuffer.bind(gl);
    gl.createBuffer = (): ReturnType<WebglContext["createBuffer"]> => {
      created += 1;
      const buffer = base();
      return created === 1 ? buffer : null;
    };

    const record = new GeometryCache(gl).acquire(quadGeometry().asGeometry);

    expect(record).toBeNull();
    expect(gl.countOf("deleteBuffer")).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(1);
  });

  it("deletes every vertex array and buffer on dispose, idempotently", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    cache.acquire(quadGeometry().asGeometry);
    cache.acquire(triangleGeometry().asGeometry);
    gl.reset();

    cache.dispose();
    cache.dispose();

    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(3);
    expect(cache.size).toBe(0);
    expect(cache.disposed).toBe(true);
  });

  it("forget() drops records without touching the context (§61 loss)", () => {
    const gl = createFakeGl();
    const cache = new GeometryCache(gl);
    cache.acquire(quadGeometry().asGeometry);
    gl.reset();

    cache.forget();

    expect(cache.size).toBe(0);
    expect(gl.calls).toHaveLength(0);
  });
});

describe("WebglRenderer.render — viewport and clear semantics (§61, §48)", () => {
  it("sets the scissor rectangle before the viewport, and clears after both", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { clearColor: [0.1, 0.2, 0.3, 1] }),
    ]);

    const names = gl.names();
    expect(indexOf(gl, "scissor")).toBeLessThan(indexOf(gl, "viewport"));
    expect(indexOf(gl, "viewport")).toBeLessThan(indexOf(gl, "clearColor"));
    expect(indexOf(gl, "clearColor")).toBeLessThan(indexOf(gl, "clear"));
    expect(names).toContain("clearDepth");
  });

  it("resolves a normalized rectangle against the drawing-buffer size", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(400, 300, 2);
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { x: 0.5, y: 0, width: 0.5, height: 1 }),
    ]);

    expect(gl.callsOf("scissor")[0].args).toEqual([400, 0, 400, 600]);
    expect(gl.callsOf("viewport")[0].args).toEqual([400, 0, 400, 600]);
  });

  it("uses an unnormalized rectangle as drawing-buffer pixels, unscaled", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(400, 300, 2);
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, {
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        normalized: false,
      }),
    ]);

    expect(gl.callsOf("scissor")[0].args).toEqual([10, 20, 100, 50]);
  });

  it("keeps the bottom-left origin unflipped — GL's convention is already §7a's", async () => {
    const { renderer, gl, camera } = await initialized();
    renderer.resize(200, 100);
    gl.reset();

    // A view pinned to the bottom half of the surface.
    renderer.render(createRoot(), [
      createView(camera, { x: 0, y: 0, width: 1, height: 0.5 }),
    ]);

    expect(gl.callsOf("viewport")[0].args).toEqual([0, 0, 200, 50]);
  });

  it("clamps a negative extent to zero rather than passing a GL error along", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { width: -0.5, normalized: true }),
    ]);

    expect(gl.callsOf("scissor")[0].args[2]).toBe(0);
  });

  it("clears colour and depth together when the view carries a clearColor", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { clearColor: [0.25, 0.5, 0.75, 1] }),
    ]);

    expect(gl.callsOf("clearColor")[0].args).toEqual([0.25, 0.5, 0.75, 1]);
    expect(gl.callsOf("clearDepth")[0].args).toEqual([1]);
    expect(gl.callsOf("clear")[0].args).toEqual([
      GL.DEPTH_BUFFER_BIT | GL.COLOR_BUFFER_BIT,
    ]);
  });

  it("clears depth only when clearColor is absent (§61 composite-over case)", async () => {
    const { renderer, gl, camera } = await initialized();
    gl.reset();

    renderer.render(createRoot(), [createView(camera)]);

    expect(gl.countOf("clearColor")).toBe(0);
    expect(gl.callsOf("clear")[0].args).toEqual([GL.DEPTH_BUFFER_BIT]);
  });

  it("draws views in array order, each with its own rectangle and clear", async () => {
    const { renderer, gl, camera } = await initialized();
    const second = new TestCamera();
    gl.reset();

    renderer.render(createRoot(), [
      createView(camera, { id: "main" }),
      createView(second, {
        id: "minimap",
        x: 0,
        y: 0,
        width: 0.25,
        height: 0.25,
      }),
    ]);

    expect(gl.callsOf("scissor").map((call) => call.args[2])).toEqual([
      300, 75,
    ]);
    expect(gl.countOf("clear")).toBe(2);
    expect(camera.updateViewMatrixCalls).toBe(1);
    expect(second.updateViewMatrixCalls).toBe(1);
  });

  it("draws and clears nothing at all when the view list is empty (§61)", async () => {
    const { renderer, gl } = await initialized();
    gl.reset();

    renderer.render(createRoot(), []);

    expect(gl.calls).toHaveLength(0);
  });

  it("throws INVALID_APPLICATION_STATE when rendering before initialize", () => {
    const renderer = new WebglRenderer();
    const camera = new TestCamera();

    const error = thrown(() => {
      renderer.render(createRoot(), [createView(camera)]);
    });

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });
});

describe("WebglRenderer.render — uniforms and draws (§64, §57)", () => {
  it("uploads projection · view once per view, then a model matrix per item", async () => {
    const { renderer, gl, camera } = await initialized();
    camera.projectionMatrix.identity();
    camera.viewMatrix.identity();
    const root = createRoot();
    const child = renderable(quadGeometry());
    child.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1,
    ]);
    root.add(child);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uploads = gl.callsOf("uniformMatrix4fv");
    expect(uploads).toHaveLength(2);
    expect(uploads[0].args[0]).toBe(gl.uniformLocations.get("viewProjection"));
    expect(uploads[0].args[1]).toBe(false);
    expect(uploads[1].args[0]).toBe(gl.uniformLocations.get("model"));
    expect(uploads[1].args[2]).toEqual([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1,
    ]);
  });

  it("multiplies the camera's projection by its view matrix, in that order", async () => {
    const { renderer, gl, camera } = await initialized();
    camera.projectionMatrix.setOrthographic(-2, 2, -1, 1, 0.1, 10);
    camera.viewMatrix.identity();
    camera.viewMatrix.elements[12] = -3;
    const expected = camera.projectionMatrix
      .clone()
      .multiply(camera.viewMatrix);
    gl.reset();

    renderer.render(createRoot(), [createView(camera)]);

    expect(gl.callsOf("uniformMatrix4fv")[0].args[2]).toEqual(
      Array.from(new Float32Array(expected.elements)),
    );
  });

  it("updates the camera's view matrix before uploading it (§47)", async () => {
    const { renderer, camera } = await initialized();

    renderer.render(createRoot(), [createView(camera)]);
    renderer.render(createRoot(), [createView(camera)]);

    expect(camera.updateViewMatrixCalls).toBe(2);
  });

  it("uploads each item's material colour (§57 straight-alpha RGBA)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry(), new TestMaterial([1, 0, 0, 1])));
    root.add(
      renderable(triangleGeometry(), new TestMaterial([0, 0.5, 1, 0.25])),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("uniform4fv").map((call) => call.args[1])).toEqual([
      [1, 0, 0, 1],
      [0, 0.5, 1, 0.25],
    ]);
  });

  it("issues drawElements for indexed geometry with count, type, and offset", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("drawElements")[0].args).toEqual([
      GL.TRIANGLES,
      6,
      GL.UNSIGNED_SHORT,
      0,
    ]);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("issues drawArrays for non-indexed geometry", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("drawArrays")[0].args).toEqual([GL.TRIANGLES, 0, 3]);
    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("binds the item's vertex array before drawing it", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const names = gl.names();
    expect(names.indexOf("bindVertexArray")).toBeLessThan(
      names.indexOf("drawArrays"),
    );
  });

  it("leaves no vertex array bound when the frame ends", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("bindVertexArray").at(-1)?.args).toEqual([null]);
  });

  it("uploads geometry once and draws it twice across two frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("shares one vertex array between renderables that share a geometry", async () => {
    const { renderer, gl, camera } = await initialized();
    const geometry = quadGeometry();
    const root = createRoot();
    root.add(renderable(geometry), renderable(geometry));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("re-uploads a geometry whose version advanced between frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const geometry = quadGeometry();
    const root = createRoot();
    root.add(renderable(geometry));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    geometry.markDirty();
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("deleteVertexArray")).toBe(1);
    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("skips a render item whose geometry has nothing to draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(new TestGeometry(new Float32Array(0))));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawArrays")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("uniform4fv")).toBe(0);
  });

  it("honours §64 filtering: a hidden subtree contributes no draw", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const hidden = renderable(quadGeometry());
    hidden.visible = false;
    root.add(hidden);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("draws every item once per view", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()), renderable(triangleGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera), createView(new TestCamera())]);

    expect(gl.countOf("drawElements")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(gl.countOf("useProgram")).toBe(1);
  });
});

describe("WebglRenderer.render — §43 interpolated poses (WP-3.6)", () => {
  /** A root with one drawable child; the root itself draws nothing. */
  function interpolationScene(): { root: Renderable; child: Renderable } {
    const root = createRoot();
    const child = renderable(quadGeometry());
    root.add(child);
    return { root, child };
  }

  it("draws the render pose at alpha, not the resolved world matrix", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, child } = interpolationScene();
    // The world matrix says one thing, the captured poses another: only the
    // interpolated list can produce the alpha-blended answer.
    child.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -99, -99, -99, 1,
    ]);
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 0));
    const atZero = modelUploads(gl);

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 1));
    const atOne = modelUploads(gl);

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.25));
    const atQuarter = modelUploads(gl);

    expect(atZero).toHaveLength(1);
    expect(atOne).toHaveLength(1);
    expect(atZero[0].slice(12, 15)).toEqual([0, 0, 0]);
    expect(atOne[0].slice(12, 15)).toEqual([10, 0, 0]);
    expect(atQuarter[0].slice(12, 15)).toEqual([2.5, 0, 0]);
    // The point of §43: the same scene, a different alpha, a different frame.
    expect(atZero[0]).not.toEqual(atOne[0]);
  });

  it("passes the frame's alpha through to the pose buffer unchanged", async () => {
    const { renderer, camera } = await initialized();
    const { root, child } = interpolationScene();
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(4, 0, 0),
    );

    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.75));

    expect(poses.alphas).toEqual([0.75]);
  });

  it("uses the live local transform of a node the buffer does not track", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, child } = interpolationScene();
    child.transform.position.set(1, 2, 3);
    const poses = new TestPoseBuffer();

    gl.reset();
    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.5));

    expect(poses.alphas).toEqual([]);
    expect(modelUploads(gl)[0].slice(12, 15)).toEqual([1, 2, 3]);
  });

  it("never writes a render pose back into the scene (§42, §43)", async () => {
    const { renderer, camera } = await initialized();
    const { root, child } = interpolationScene();
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );
    const version = child.transform.version;

    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.5));

    const { x, y, z } = child.transform.position;
    expect([x, y, z]).toEqual([0, 0, 0]);
    expect(child.transform.version).toBe(version);
  });

  it("builds the ordinary render list when no interpolation is passed", async () => {
    const { renderer, gl, camera } = await initialized();
    const { root, child } = interpolationScene();
    child.transform.worldMatrix.fromArray([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1,
    ]);
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The resolved world matrix, and the buffer was never consulted: the
    // non-interpolated path is a matter of omitting the argument, not of
    // configuring the renderer.
    expect(modelUploads(gl)[0].slice(12, 15)).toEqual([7, 8, 9]);
    expect(poses.alphas).toEqual([]);
  });

  it("skips the frame while the context is lost, interpolation and all (§61)", async () => {
    const { renderer, canvas, camera } = await initialized();
    const { root, child } = interpolationScene();
    const poses = new TestPoseBuffer().track(
      child,
      new Vector3(0, 0, 0),
      new Vector3(10, 0, 0),
    );
    canvas.dispatch("webglcontextlost");

    expect(() => {
      renderer.render(root, [createView(camera)], interpolationAt(poses, 0.5));
    }).not.toThrow();
    expect(poses.alphas).toEqual([]);
  });
});

describe("WebglRenderer — resize (§61, §45)", () => {
  it("scales the drawing buffer by the resolution", async () => {
    const { renderer, canvas } = await initialized();

    renderer.resize(800, 600, 2);

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
  });

  it("defaults the resolution to 1", async () => {
    const { renderer, canvas } = await initialized();

    renderer.resize(640, 480);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
  });

  it("does not touch cameras (§47 explicit recomputation)", async () => {
    const { renderer, camera } = await initialized();
    const before = camera.projectionMatrix.clone();

    renderer.resize(1024, 768);

    expect(Array.from(camera.projectionMatrix.elements)).toEqual(
      Array.from(before.elements),
    );
  });

  it("records the size but leaves the surface alone while the context is lost", async () => {
    const { renderer, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");

    renderer.resize(800, 600);

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(150);
  });
});

describe("WebglRenderer — context loss and restore (§61)", () => {
  it("prevents the default on webglcontextlost, without which restore never fires", async () => {
    const { canvas } = await initialized();

    expect(canvas.dispatch("webglcontextlost")).toBe(true);
  });

  it("emits contextlost with the renderer, after marking itself lost", async () => {
    const { renderer, canvas } = await initialized();
    let observed: { lostAtDispatch: boolean } | null = null;
    renderer.events.on("contextlost", (event) => {
      expect(event.renderer).toBe(renderer);
      observed = { lostAtDispatch: renderer.contextLost };
    });

    canvas.dispatch("webglcontextlost");

    expect(observed).toEqual({ lostAtDispatch: true });
  });

  it("emits contextlost once even if the event arrives twice", async () => {
    const { renderer, canvas } = await initialized();
    let count = 0;
    renderer.events.on("contextlost", () => {
      count += 1;
    });

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextlost");

    expect(count).toBe(1);
  });

  it("issues no GL call while losing the context — every handle is already dead", async () => {
    const { gl, canvas } = await initialized();
    gl.reset();

    canvas.dispatch("webglcontextlost");

    expect(gl.calls).toHaveLength(0);
  });

  it("returns from render silently while lost, and never throws (§61)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    canvas.dispatch("webglcontextlost");
    gl.reset();

    expect(() => {
      renderer.render(root, [createView(camera)]);
    }).not.toThrow();
    expect(gl.calls).toHaveLength(0);
  });

  it("re-creates both programs and the fixed state on restore", async () => {
    const { renderer, gl, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");
    gl.reset();

    canvas.dispatch("webglcontextrestored");

    // Unlit and sprite (WP-3a.3): §61 requires engine-owned GPU resources to be
    // re-created before `contextrestored` is emitted, and both pipelines are.
    expect(gl.countOf("createProgram")).toBe(2);
    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.DEPTH_TEST,
      GL.SCISSOR_TEST,
    ]);
    expect(renderer.contextLost).toBe(false);
  });

  it("emits contextrestored after the rebuild, so the first frame draws", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(triangleGeometry()));
    canvas.dispatch("webglcontextlost");
    let drewInListener = 0;
    renderer.events.on("contextrestored", (event) => {
      expect(event.renderer).toBe(renderer);
      gl.reset();
      renderer.render(root, [createView(camera)]);
      drewInListener = gl.countOf("drawArrays");
    });

    canvas.dispatch("webglcontextrestored");

    expect(drewInListener).toBe(1);
  });

  it("re-creates vertex arrays after a restore rather than reusing dead handles", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    renderer.render(root, [createView(camera)]);
    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createVertexArray")).toBe(1);
    expect(gl.countOf("deleteVertexArray")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("re-applies the size recorded while the context was lost", async () => {
    const { renderer, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");
    renderer.resize(800, 600);

    canvas.dispatch("webglcontextrestored");

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it("re-reads capabilities on restore", async () => {
    const { renderer, canvas } = await initialized({ maxTextureSize: 2048 });
    canvas.dispatch("webglcontextlost");

    canvas.dispatch("webglcontextrestored");

    expect(renderer.capabilities.maxTextureSize).toBe(2048);
  });

  it("ignores webglcontextrestored when the context was never lost", async () => {
    const { renderer, gl, canvas } = await initialized();
    let restored = 0;
    renderer.events.on("contextrestored", () => {
      restored += 1;
    });
    gl.reset();

    canvas.dispatch("webglcontextrestored");

    expect(restored).toBe(0);
    expect(gl.calls).toHaveLength(0);
  });

  it("stays lost and emits nothing when the program will not rebuild", async () => {
    const gl = createFakeGl();
    const canvas = new TestCanvas(gl);
    const renderer = new WebglRenderer();
    await renderer.initialize({ canvas });
    let restored = 0;
    renderer.events.on("contextrestored", () => {
      restored += 1;
    });
    canvas.dispatch("webglcontextlost");
    gl.getShaderParameter = (): boolean => false;

    expect(() => {
      canvas.dispatch("webglcontextrestored");
    }).toThrow(FourError);
    expect(restored).toBe(0);
    expect(renderer.contextLost).toBe(true);
  });
});

describe("WebglRenderer — disposal (§83)", () => {
  it("deletes both programs and every vertex array", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()), renderable(triangleGeometry()));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    expect(gl.countOf("deleteProgram")).toBe(2);
    expect(gl.countOf("deleteVertexArray")).toBe(2);
    expect(gl.countOf("deleteBuffer")).toBe(3);
    expect(renderer.disposed).toBe(true);
  });

  it("removes both canvas listeners and every emitter listener", async () => {
    const { renderer, canvas } = await initialized();
    renderer.events.on("contextlost", () => undefined);

    renderer.dispose();

    expect(canvas.listenerCount("webglcontextlost")).toBe(0);
    expect(canvas.listenerCount("webglcontextrestored")).toBe(0);
    expect(renderer.events.listenerCount("contextlost")).toBe(0);
  });

  it("is idempotent", async () => {
    const { renderer, gl } = await initialized();
    gl.reset();

    renderer.dispose();
    renderer.dispose();

    expect(gl.countOf("deleteProgram")).toBe(2);
  });

  it("succeeds during a lost context, without touching the context", async () => {
    const { renderer, gl, canvas } = await initialized();
    canvas.dispatch("webglcontextlost");
    gl.reset();

    renderer.dispose();

    expect(gl.calls).toHaveLength(0);
    expect(renderer.disposed).toBe(true);
    expect(canvas.listenerCount("webglcontextlost")).toBe(0);
  });

  it("throws INVALID_APPLICATION_STATE from render after disposal", async () => {
    const { renderer, camera } = await initialized();
    renderer.dispose();

    const error = thrown(() => {
      renderer.render(createRoot(), [createView(camera)]);
    });

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("throws INVALID_APPLICATION_STATE from resize after disposal", async () => {
    const { renderer } = await initialized();
    renderer.dispose();

    const error = thrown(() => {
      renderer.resize(100, 100);
    });

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("rejects initialize after disposal", async () => {
    const { renderer, canvas } = await initialized();
    renderer.dispose();

    const error = await rejection(renderer.initialize({ canvas }));

    expect(error.code).toBe("INVALID_APPLICATION_STATE");
  });

  it("ignores a context-loss event that arrives after disposal", async () => {
    const { renderer, canvas } = await initialized();
    const listeners = [...(canvas.listeners.get("webglcontextlost") ?? [])];
    renderer.dispose();

    for (const listener of listeners) {
      listener({ preventDefault: () => undefined });
    }

    expect(renderer.contextLost).toBe(false);
  });
});

describe("SpriteProgram — compilation and linking (§55, §61, §89)", () => {
  it("compiles both stages, links, and resolves the five uniforms", () => {
    const gl = createFakeGl();

    const program = SpriteProgram.create(gl);

    expect(gl.countOf("createShader")).toBe(2);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(
      gl.callsOf("getUniformLocation").map((call) => call.args[1]),
    ).toEqual(["viewProjection", "model", "quad", "tint", "map"]);
    expect(program.disposed).toBe(false);
  });

  it("emits GLSL ES 3.00 sources binding position at the shared location", () => {
    const gl = createFakeGl();

    SpriteProgram.create(gl);

    const sources = gl.callsOf("shaderSource").map((call) => call.args[1]);
    for (const source of sources) {
      expect(String(source).startsWith("#version 300 es\n")).toBe(true);
    }
    // The same attribute slot the unlit pipeline uses, which is what lets one
    // geometry cache serve both.
    expect(String(sources[0])).toContain(
      `layout(location = ${String(POSITION_ATTRIBUTE_LOCATION)}) in vec3 position`,
    );
    // uv is derived from the quad's local rect, not read from an attribute.
    expect(String(sources[0])).toContain("uniform vec4 quad");
    expect(String(sources[1])).toContain("texture(map, vUv) * tint");
  });

  it("fails with SHADER_COMPILATION_FAILED, naming the sprite pipeline", () => {
    const error = thrown(() => {
      SpriteProgram.create(createFakeGl({ compileStatus: false }));
    });

    expect(error.code).toBe("SHADER_COMPILATION_FAILED");
    expect(error.context?.stage).toBe("vertex");
    expect(error.message).toContain("sprite");
  });

  it("deletes the program when a uniform is missing from the link", () => {
    const gl = createFakeGl({ resolveUniforms: false });

    const error = thrown(() => {
      SpriteProgram.create(gl);
    });

    expect(error.context?.uniform).toBe("viewProjection");
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("deletes the GL program once, idempotently", () => {
    const gl = createFakeGl();
    const program = SpriteProgram.create(gl);

    program.dispose();
    program.dispose();

    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(program.disposed).toBe(true);
  });
});

describe("TextureCache — textures keyed by id and version (§77, §61)", () => {
  it("uploads RGBA8 texels with clamped, linearly filtered sampler state", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const data = new Uint8Array(2 * 3 * 4);
    const texture = new TestTexture(2, 3, data);

    const record = cache.acquire(texture.asTexture);

    expect(record).not.toBeNull();
    expect(gl.countOf("createTexture")).toBe(1);
    expect(gl.callsOf("texImage2D")[0].args).toEqual([
      GL.TEXTURE_2D,
      0,
      GL.RGBA8,
      2,
      3,
      0,
      GL.RGBA,
      GL.UNSIGNED_BYTE,
      Array.from(data),
    ]);
    expect(
      gl.callsOf("texParameteri").map((call) => [call.args[1], call.args[2]]),
    ).toEqual([
      [GL.TEXTURE_MIN_FILTER, GL.LINEAR],
      [GL.TEXTURE_MAG_FILTER, GL.LINEAR],
      [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
      [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
    ]);
    // Nothing left bound: an upload mid-frame must not displace the texture
    // being drawn.
    expect(gl.callsOf("bindTexture").at(-1)?.args).toEqual([
      GL.TEXTURE_2D,
      null,
    ]);
    expect(cache.size).toBe(1);
  });

  it("allocates zero-filled storage for a texture with no CPU-side data", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture(4, 4);
    texture.data = null;

    cache.acquire(texture.asTexture);

    expect(gl.callsOf("texImage2D")[0].args[8]).toBeNull();
  });

  it("returns the same record for an unchanged texture", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture();

    const first = cache.acquire(texture.asTexture);
    const second = cache.acquire(texture.asTexture);

    expect(second).toBe(first);
    expect(gl.countOf("createTexture")).toBe(1);
  });

  it("deletes and re-uploads when the version advances", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture();
    cache.acquire(texture.asTexture);

    texture.data![0] = 255;
    texture.markDirty();
    const record = cache.acquire(texture.asTexture);

    expect(record?.version).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("createTexture")).toBe(2);
    expect(cache.size).toBe(1);
  });

  it("drops a disposed texture and keeps no entry (§83)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    const texture = new TestTexture();
    cache.acquire(texture.asTexture);

    texture.dispose();

    expect(cache.acquire(texture.asTexture)).toBeNull();
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("createTexture")).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("returns null without an entry when GL will not allocate a texture", () => {
    const gl = createFakeGl({ allocateTextures: false });
    const cache = new TextureCache(gl);

    expect(cache.acquire(new TestTexture().asTexture)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("forgets every record without touching the context (§61 loss)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    cache.acquire(new TestTexture().asTexture);
    gl.reset();

    cache.forget();

    expect(gl.calls).toHaveLength(0);
    expect(cache.size).toBe(0);
  });

  it("deletes every texture on dispose, idempotently (§83)", () => {
    const gl = createFakeGl();
    const cache = new TextureCache(gl);
    cache.acquire(new TestTexture().asTexture);
    cache.acquire(new TestTexture().asTexture);
    gl.reset();

    cache.dispose();
    cache.dispose();

    expect(gl.countOf("deleteTexture")).toBe(2);
    expect(cache.disposed).toBe(true);
    expect(cache.size).toBe(0);
  });
});

describe("WebglRenderer.render — sprites (§55, §66)", () => {
  it("switches to the sprite pipeline, binds the sampler, and enables blending", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const names = gl.names();
    // Unlit is the frame's starting state; the sprite run switches to the
    // second pipeline once and switches blending on with it.
    expect(gl.countOf("useProgram")).toBe(2);
    expect(uploadsAt(gl, spriteUniforms(gl).get("map"))).toEqual([0]);
    expect(gl.callsOf("activeTexture")[0].args).toEqual([GL.TEXTURE0]);
    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    // Ordering: program, then sampler, then a texture bind, then the draw.
    const drawIndex = names.indexOf("drawElements");
    expect(names.indexOf("useProgram")).toBeLessThan(
      names.indexOf("uniform1i"),
    );
    expect(names.indexOf("uniform1i")).toBeLessThan(drawIndex);
    const boundBeforeDraw = gl.calls
      .slice(0, drawIndex)
      .filter((call) => call.name === "bindTexture" && call.args[1] !== null);
    expect(boundBeforeDraw).not.toHaveLength(0);
  });

  it("blends with straight alpha, and fixes the function once at initialize (§66)", async () => {
    const { gl } = await initialized();

    expect(gl.callsOf("blendFunc")[0].args).toEqual([
      GL.SRC_ALPHA,
      GL.ONE_MINUS_SRC_ALPHA,
    ]);
    // GL's initial state already has BLEND off, so nothing disables it here.
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.CULL_FACE,
    ]);
  });

  it("disables blending and unbinds the texture when the frame ends", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    expect(gl.callsOf("bindTexture").at(-1)?.args).toEqual([
      GL.TEXTURE_2D,
      null,
    ]);
  });

  it("leaves the opaque unlit path untouched — no blending, one program", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(renderable(quadGeometry()));
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("useProgram")).toBe(1);
    expect(gl.countOf("enable")).toBe(0);
    expect(gl.countOf("disable")).toBe(0);
    expect(gl.countOf("bindTexture")).toBe(0);
    expect(gl.countOf("uniform1i")).toBe(0);
  });

  it("uploads the tint, and the quad's local rect the vertex stage maps uv from", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(
      sprite(new TestSpriteMaterial(new TestTexture(), [1, 0.5, 0, 0.25]), {
        width: 4,
        height: 2,
        anchor: { x: 0, y: 0 },
      }),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = spriteUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("tint"))).toEqual([[1, 0.5, 0, 0.25]]);
    // anchor (0, 0) and 4 × 2 ⇒ the quad spans x ∈ [0, 4], y ∈ [0, 2].
    expect(uploadsAt(gl, uniforms.get("quad"))).toEqual([[0, 0, 4, 2]]);
  });

  it("tracks the quad rect when the sprite is resized", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite(new TestSpriteMaterial(), { width: 2, height: 2 });
    root.add(node);
    renderer.render(root, [createView(camera)]);

    node.width = 6;
    gl.reset();
    renderer.render(root, [createView(camera)]);

    expect(uploadsAt(gl, spriteUniforms(gl).get("quad"))).toEqual([
      [-3, -1, 6, 2],
    ]);
  });

  it("uploads the sprite view-projection once per view, after switching to it", async () => {
    const { renderer, gl, camera } = await initialized();
    camera.projectionMatrix.identity();
    camera.viewMatrix.identity();
    const root = createRoot();
    root.add(sprite(), sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);

    const uniforms = spriteUniforms(gl);
    expect(uploadsAt(gl, uniforms.get("viewProjection"))).toHaveLength(1);
    expect(uploadsAt(gl, uniforms.get("model"))).toHaveLength(2);
  });

  it("uploads a sprite view-projection per view when there are two", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera), createView(new TestCamera())]);

    expect(
      uploadsAt(gl, spriteUniforms(gl).get("viewProjection")),
    ).toHaveLength(2);
  });

  it("switches pipelines and blending back and forth for interleaved items", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    // renderOrder decides the sequence: unlit, sprite, unlit.
    const first = renderable(quadGeometry());
    first.renderOrder = 0;
    const middle = sprite(new TestSpriteMaterial(), { renderOrder: 1 });
    const last = renderable(triangleGeometry());
    last.renderOrder = 2;
    root.add(first, middle, last);
    gl.reset();

    renderer.render(root, [createView(camera)]);

    // The frame's opening `use` of the unlit pipeline, then two switches:
    // unlit → sprite → unlit.
    expect(gl.countOf("useProgram")).toBe(3);
    expect(gl.callsOf("enable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    expect(gl.callsOf("disable").map((call) => call.args[0])).toEqual([
      GL.BLEND,
    ]);
    const names = gl.names();
    expect(names.indexOf("enable")).toBeLessThan(names.indexOf("disable"));
    expect(gl.countOf("drawElements")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(1);
  });

  it("uploads a texture once and reuses it across frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    gl.reset();

    renderer.render(root, [createView(camera)]);
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createTexture")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("shares one GL texture between sprites that share a texture", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(
      sprite(new TestSpriteMaterial(texture)),
      sprite(new TestSpriteMaterial(texture)),
    );
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("createTexture")).toBe(1);
    // Two from the single upload (bind, then unbind), one per draw, and the
    // end-of-frame unbind.
    expect(gl.countOf("bindTexture")).toBe(5);
  });

  it("re-uploads a texture whose version advanced between frames", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(sprite(new TestSpriteMaterial(texture)));
    renderer.render(root, [createView(camera)]);
    gl.reset();

    texture.data![0] = 255;
    texture.markDirty();
    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("createTexture")).toBe(1);
  });

  it("skips a sprite whose texture has been disposed (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    const texture = new TestTexture();
    const root = createRoot();
    root.add(sprite(new TestSpriteMaterial(texture)));
    texture.dispose();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
    // Never switched pipelines either: the skip happens before the switch.
    expect(gl.countOf("useProgram")).toBe(1);
    expect(gl.countOf("enable")).toBe(0);
  });

  it("skips a disposed sprite, whose quad has no vertices", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite();
    root.add(node);
    node.dispose();
    gl.reset();

    renderer.render(root, [createView(camera)]);

    expect(gl.countOf("drawElements")).toBe(0);
    expect(gl.countOf("createTexture")).toBe(0);
  });

  it("draws the §43 interpolated pose of a sprite like any other item", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    const node = sprite();
    root.add(node);
    const poses = new TestPoseBuffer().track(
      node,
      new Vector3(0, 0, 0),
      new Vector3(8, 0, 0),
    );
    gl.reset();

    renderer.render(root, [createView(camera)], interpolationAt(poses, 0.25));

    const models = uploadsAt(gl, spriteUniforms(gl).get("model")) as number[][];
    expect(models[0].slice(12, 15)).toEqual([2, 0, 0]);
  });

  it("forgets textures on context loss and re-uploads after restore (§61)", async () => {
    const { renderer, gl, canvas, camera } = await initialized();
    const root = createRoot();
    root.add(sprite());
    renderer.render(root, [createView(camera)]);

    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");
    gl.reset();
    renderer.render(root, [createView(camera)]);

    // A fresh upload, and no `deleteTexture` against the dead handle.
    expect(gl.countOf("createTexture")).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(1);
  });

  it("deletes every GL texture on disposal (§83)", async () => {
    const { renderer, gl, camera } = await initialized();
    const root = createRoot();
    root.add(sprite(), sprite());
    renderer.render(root, [createView(camera)]);
    gl.reset();

    renderer.dispose();

    expect(gl.countOf("deleteTexture")).toBe(2);
  });
});
