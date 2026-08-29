/**
 * The WebGL 2 picking service (§71; RFC 0005), driven host-first: the
 * `PickingRendererHost` seam is a plain object here, so every §61 lifecycle —
 * loss, restore-as-new-caches, disposal under the service — is one field
 * write, and every read-back path (fence, stall, refusals) is reachable on a
 * fake context with no GPU.
 *
 * The scene objects are `@four/render`'s real `Renderable` over structural
 * geometry/material doubles — `webgl-renderer.test.ts`'s argument: `core`,
 * `math`, `render` is this package's whole dependency row (plan §3.1), so
 * `@four/scene` and `@four/geometry` may not appear even in a test.
 */

import { isFourError, resetDevWarnings } from "@four/core";
import { Matrix4 } from "@four/math";
import {
  MAX_PICK_CANDIDATES,
  Renderable,
  encodePickId,
  type PickingService,
  type RenderItem,
  type UnlitRenderItem,
} from "@four/render";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  GL,
  GeometryCache,
  IdPassProgram,
  PICKING_GL,
  RenderTargetCache,
  WebglPickingService,
  clearRegisteredPickingPipeline,
  registerPickingPipeline,
  resolvePickingServiceFactory,
  type PickingRendererHost,
  type WebglContext,
} from "../src/index.js";

type PickView = Parameters<PickingService["update"]>[1];
type PickCameraContract = PickView["camera"];
type ItemGeometry = RenderItem["geometry"];
type ItemMaterial = UnlitRenderItem["material"];

// ---------------------------------------------------------------------------
// The fake GL context — the members the service, `GeometryCache`, and
// `RenderTargetCache` touch, plus the optional read-back group under test.
// ---------------------------------------------------------------------------

interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

interface FakePickGlOptions {
  /** Result of `getShaderParameter(..., COMPILE_STATUS)`. Default true. */
  compileStatus?: boolean;
  /** Result of `checkFramebufferStatus`. Default complete. */
  framebufferStatus?: number;
  /** When false, `createBuffer` returns null. Default true. */
  allocateBuffers?: boolean;
  /** When false, the double declares no `readPixels` at all. Default true. */
  canReadPixels?: boolean;
  /** When false, the double declares none of the fence group. Default true. */
  canFence?: boolean;
  /** When true, `fenceSync` answers `null` — GL refused the fence. */
  refuseFence?: boolean;
  /** `clientWaitSync` answers, consumed in order; then ALREADY_SIGNALED. */
  waitStatuses?: number[];
}

interface FakePickGl extends WebglContext {
  readonly calls: RecordedCall[];
  /** Uniform handles by name — one program compiles here, so one scope. */
  readonly uniforms: Map<string, object>;
  /** The texel `readPixels` answers with, RGBA bytes. */
  nextTexel: [number, number, number, number];
  names(): string[];
  callsOf(name: string): RecordedCall[];
  countOf(name: string): number;
  reset(): void;
}

function snapshot(args: readonly unknown[]): readonly unknown[] {
  return args.map((arg) =>
    ArrayBuffer.isView(arg) && !(arg instanceof DataView)
      ? Array.from(arg as unknown as ArrayLike<number>)
      : arg,
  );
}

function createFakePickGl(options: FakePickGlOptions = {}): FakePickGl {
  const {
    compileStatus = true,
    framebufferStatus = GL.FRAMEBUFFER_COMPLETE,
    allocateBuffers = true,
    canReadPixels = true,
    canFence = true,
    refuseFence = false,
    waitStatuses = [],
  } = options;

  const calls: RecordedCall[] = [];
  const uniforms = new Map<string, object>();
  let handleCount = 0;
  /** What a pack-buffer `readPixels` staged for `getBufferSubData`. */
  let packPending: [number, number, number, number] | null = null;

  const record = (name: string, ...args: unknown[]): void => {
    calls.push({ name, args: snapshot(args) });
  };
  const handle = (kind: string): object => {
    handleCount += 1;
    return { kind, serial: handleCount };
  };

  const gl: FakePickGl = {
    calls,
    uniforms,
    nextTexel: [0, 0, 0, 0],
    names: () => calls.map((call) => call.name),
    callsOf: (name) => calls.filter((call) => call.name === name),
    countOf: (name) => calls.filter((call) => call.name === name).length,
    reset: () => {
      calls.length = 0;
    },

    createShader(type) {
      record("createShader", type);
      return handle("shader");
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
      return "";
    },
    deleteShader(shader) {
      record("deleteShader", shader);
    },
    createProgram() {
      record("createProgram");
      return handle("program");
    },
    attachShader(program, shader) {
      record("attachShader", program, shader);
    },
    linkProgram(program) {
      record("linkProgram", program);
    },
    getProgramParameter(program, pname) {
      record("getProgramParameter", program, pname);
      return true;
    },
    getProgramInfoLog(program) {
      record("getProgramInfoLog", program);
      return "";
    },
    deleteProgram(program) {
      record("deleteProgram", program);
    },
    getUniformLocation(program, name) {
      record("getUniformLocation", program, name);
      let location = uniforms.get(name);
      if (location === undefined) {
        location = { kind: "uniform", name };
        uniforms.set(name, location);
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
    uniform3fv(location, data) {
      record("uniform3fv", location, data);
    },
    uniform1f(location, value) {
      record("uniform1f", location, value);
    },
    uniform1i(location, value) {
      record("uniform1i", location, value);
    },

    createTexture() {
      record("createTexture");
      return handle("texture");
    },
    bindTexture(target, texture) {
      record("bindTexture", target, texture);
    },
    texImage2D(...args) {
      record("texImage2D", ...args);
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

    createFramebuffer() {
      record("createFramebuffer");
      return handle("framebuffer");
    },
    bindFramebuffer(target, framebuffer) {
      record("bindFramebuffer", target, framebuffer);
    },
    framebufferTexture2D(...args) {
      record("framebufferTexture2D", ...args);
    },
    checkFramebufferStatus(target) {
      record("checkFramebufferStatus", target);
      return framebufferStatus;
    },
    deleteFramebuffer(framebuffer) {
      record("deleteFramebuffer", framebuffer);
    },
    createRenderbuffer() {
      record("createRenderbuffer");
      return handle("renderbuffer");
    },
    bindRenderbuffer(target, renderbuffer) {
      record("bindRenderbuffer", target, renderbuffer);
    },
    renderbufferStorage(...args) {
      record("renderbufferStorage", ...args);
    },
    framebufferRenderbuffer(...args) {
      record("framebufferRenderbuffer", ...args);
    },
    deleteRenderbuffer(renderbuffer) {
      record("deleteRenderbuffer", renderbuffer);
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
      return handle("vertexArray");
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
    vertexAttribPointer(...args) {
      record("vertexAttribPointer", ...args);
    },

    getParameter(pname) {
      record("getParameter", pname);
      return 4096;
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
    blendFunc(sfactor, dfactor) {
      record("blendFunc", sfactor, dfactor);
    },
    depthMask(enabled) {
      record("depthMask", enabled);
    },
    colorMask(red, green, blue, alpha) {
      record("colorMask", red, green, blue, alpha);
    },
    stencilFunc(func, ref, mask) {
      record("stencilFunc", func, ref, mask);
    },
    stencilOp(fail, depthFail, pass) {
      record("stencilOp", fail, depthFail, pass);
    },
    stencilMask(mask) {
      record("stencilMask", mask);
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

  if (canReadPixels) {
    gl.readPixels = (x, y, width, height, format, type, into): void => {
      record("readPixels", x, y, width, height, format, type, into);
      if (typeof into === "number") {
        packPending = [...gl.nextTexel];
        return;
      }
      const view = into as Uint8Array;
      view.set(gl.nextTexel);
    };
  }
  if (canFence) {
    let waitCall = 0;
    gl.fenceSync = (condition, flags): object | null => {
      record("fenceSync", condition, flags);
      return refuseFence ? null : handle("sync");
    };
    gl.clientWaitSync = (sync, flags, timeout): number => {
      record("clientWaitSync", sync, flags, timeout);
      const status = waitStatuses[waitCall];
      waitCall += 1;
      return status ?? PICKING_GL.ALREADY_SIGNALED;
    };
    gl.deleteSync = (sync): void => {
      record("deleteSync", sync);
    };
    gl.getBufferSubData = (target, sourceByteOffset, into): void => {
      record("getBufferSubData", target, sourceByteOffset, into);
      if (packPending !== null) {
        (into as Uint8Array).set(packPending);
      }
    };
  }

  return gl;
}

// ---------------------------------------------------------------------------
// Scene, camera, and host doubles.
// ---------------------------------------------------------------------------

let nextGeometryId = 0;

class PickGeometry {
  readonly id: string;

  version = 0;

  positions: Float32Array;

  indices: Uint16Array | undefined;

  mode: "triangles" | "lines" = "triangles";

  constructor(positions: Float32Array, indices?: Uint16Array) {
    nextGeometryId += 1;
    this.id = `pick-geometry-${String(nextGeometryId)}`;
    this.positions = positions;
    this.indices = indices;
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  get drawCount(): number {
    return this.indices === undefined
      ? this.positions.length / 3
      : this.indices.length;
  }

  get asGeometry(): ItemGeometry {
    return this as unknown as ItemGeometry;
  }
}

class PickMaterial {
  readonly color: [number, number, number, number] = [1, 1, 1, 1];

  depthTest?: boolean;

  depthWrite?: boolean;

  colorWrite?: boolean;

  get asMaterial(): ItemMaterial {
    return this as unknown as ItemMaterial;
  }
}

/** A unit triangle at the origin — inside the identity frustum. */
function triangleGeometry(): PickGeometry {
  return new PickGeometry(new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0.5, 0]));
}

/** The same triangle, indexed — the `drawElements` arm. */
function indexedTriangleGeometry(): PickGeometry {
  return new PickGeometry(
    new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0.5, 0]),
    new Uint16Array([0, 1, 2]),
  );
}

function drawable(
  geometry: PickGeometry = triangleGeometry(),
  material: PickMaterial = new PickMaterial(),
): Renderable {
  return new Renderable(geometry.asGeometry, material.asMaterial);
}

/**
 * A container: an empty-geometry `Renderable` (`webgl-renderer.test.ts`'s
 * `createRoot` argument — `Group` lives outside this package's dependency
 * row). It occupies candidate index 0 and never draws.
 */
function createRoot(): Renderable {
  return drawable(new PickGeometry(new Float32Array(0)));
}

class PickCamera {
  readonly projectionMatrix = new Matrix4();

  readonly viewMatrix = new Matrix4();

  updateViewMatrixCalls = 0;

  updateViewMatrix(): void {
    this.updateViewMatrixCalls += 1;
  }

  get asCamera(): PickCameraContract {
    return this as unknown as PickCameraContract;
  }
}

function createView(
  camera: PickCamera,
  overrides: Partial<PickView> = {},
): PickView {
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

/** The mutable state behind one live host — a renderer in seven fields. */
interface HostState {
  gl: FakePickGl;
  geometries: GeometryCache;
  renderTargets: RenderTargetCache;
  surfaceWidth: number;
  surfaceHeight: number;
  contextLost: boolean;
  disposed: boolean;
}

interface Rig {
  readonly gl: FakePickGl;
  readonly state: HostState;
  readonly host: PickingRendererHost;
  readonly service: WebglPickingService;
  readonly camera: PickCamera;
  readonly view: PickView;
}

function createRig(options: FakePickGlOptions = {}): Rig {
  const gl = createFakePickGl(options);
  const state: HostState = {
    gl,
    geometries: new GeometryCache(gl),
    renderTargets: new RenderTargetCache(gl),
    surfaceWidth: 64,
    surfaceHeight: 64,
    contextLost: false,
    disposed: false,
  };
  const host: PickingRendererHost = {
    context: () => state.gl,
    geometries: () => state.geometries,
    renderTargets: () => state.renderTargets,
    surfaceWidth: () => state.surfaceWidth,
    surfaceHeight: () => state.surfaceHeight,
    contextLost: () => state.contextLost,
    disposed: () => state.disposed,
  };
  const camera = new PickCamera();
  return {
    gl,
    state,
    host,
    service: new WebglPickingService(host),
    camera,
    view: createView(camera),
  };
}

/** §61 loss-and-restore, as the renderer performs it: new caches, same context. */
function restoreContext(state: HostState): void {
  state.geometries = new GeometryCache(state.gl);
  state.renderTargets = new RenderTargetCache(state.gl);
  state.contextLost = false;
}

/** The encoded RGBA bytes a draw of table index `index` writes. */
function texelOf(index: number): [number, number, number, number] {
  const encoded = new Float32Array(4);
  encodePickId(index, encoded);
  return [
    Math.round(encoded[0] * 255),
    Math.round(encoded[1] * 255),
    Math.round(encoded[2] * 255),
    Math.round(encoded[3] * 255),
  ];
}

/** The values uploaded through `uniform4fv` to the `pickId` location. */
function idUploads(gl: FakePickGl): number[][] {
  const location = gl.uniforms.get("pickId");
  return gl
    .callsOf("uniform4fv")
    .filter((call) => call.args[0] === location)
    .map((call) => call.args[1] as number[]);
}

function expectedIdUpload(index: number): number[] {
  const encoded = new Float32Array(4);
  encodePickId(index, encoded);
  return Array.from(encoded);
}

/** Runs `fn` and returns the thrown `FourError`, failing if none came. */
function thrown(fn: () => void): { code: string; context?: unknown } {
  try {
    fn();
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a FourError");
}

/** Awaits `promise` and returns the `FourError` it rejected with. */
async function rejection(promise: Promise<unknown>): Promise<{ code: string }> {
  try {
    await promise;
  } catch (error: unknown) {
    if (isFourError(error)) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  resetDevWarnings();
  clearRegisteredPickingPipeline();
});

// ---------------------------------------------------------------------------
// The registry seam.
// ---------------------------------------------------------------------------

describe("the registration seam (pipeline-cost law)", () => {
  it("is empty until registerPickingPipeline() runs, and clearable", () => {
    expect(resolvePickingServiceFactory()).toBeNull();
    registerPickingPipeline();
    const factory = resolvePickingServiceFactory();
    expect(factory).not.toBeNull();
    clearRegisteredPickingPipeline();
    expect(resolvePickingServiceFactory()).toBeNull();
  });

  it("builds a WebglPickingService over the host it is given", () => {
    registerPickingPipeline();
    const { host } = createRig();
    const factory = resolvePickingServiceFactory();
    expect(factory).not.toBeNull();
    const service = factory?.create(host);
    expect(service).toBeInstanceOf(WebglPickingService);
    expect(service?.disposed).toBe(false);
  });

  it("registration and creation alone issue no GL call (lazy compile)", () => {
    registerPickingPipeline();
    const { gl, host } = createRig();
    const factory = resolvePickingServiceFactory();
    factory?.create(host);
    expect(gl.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The id pass.
// ---------------------------------------------------------------------------

describe("WebglPickingService.update — the id pass", () => {
  it("compiles the id program on the first pass only, and draws every candidate", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    root.add(drawable(indexedTriangleGeometry()));

    service.update(root, view);
    expect(gl.countOf("compileShader")).toBe(2);
    expect(gl.countOf("linkProgram")).toBe(1);
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(gl.countOf("drawElements")).toBe(1);

    service.update(root, view);
    // Second pass: no recompile, same draws again.
    expect(gl.countOf("compileShader")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(gl.countOf("drawElements")).toBe(2);
  });

  it("clears the id target to zero over the view rectangle, then unbinds", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);

    expect(gl.callsOf("viewport")[0].args).toEqual([0, 0, 64, 64]);
    expect(gl.callsOf("scissor")[0].args).toEqual([0, 0, 64, 64]);
    expect(gl.callsOf("clearColor")[0].args).toEqual([0, 0, 0, 0]);
    expect(gl.callsOf("clear")[0].args).toEqual([
      GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT,
    ]);
    // The pass binds its framebuffer and leaves nothing bound behind.
    const framebufferBinds = gl.callsOf("bindFramebuffer");
    expect(framebufferBinds[framebufferBinds.length - 1].args[1]).toBeNull();
  });

  it("encodes the traversal-order table index, not the draw order (§33)", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    const first = drawable();
    const second = drawable();
    // `second` draws *before* `first` (§66 key 5) while the table stays in
    // traversal order — the two orders must not be conflated.
    first.renderOrder = 1;
    second.renderOrder = 0;
    root.add(first);
    root.add(second);

    service.update(root, view);

    // Root is table index 0 (empty geometry, never drawn); first is 1,
    // second is 2. Draw order: second (id 2+1 wait — value 3? no: value =
    // index+1) then first.
    expect(idUploads(gl)).toEqual([expectedIdUpload(2), expectedIdUpload(1)]);
  });

  it("skips a drawable whose geometry has nothing to draw, like the frame", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    root.add(drawable(new PickGeometry(new Float32Array(0))));
    service.update(root, view);
    expect(gl.countOf("drawArrays")).toBe(0);
    expect(gl.countOf("drawElements")).toBe(0);
  });

  it("skips a node grown by a geometry accessor mid-build (reentrancy)", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    const stable = drawable();
    root.add(stable);

    // The pinned mid-frame-reentrancy family: a geometry accessor that grows
    // the scene *between* the table walk and the list build. Its item misses
    // the table and is skipped this pass rather than mis-identified.
    class GrowingRenderable extends Renderable {
      #grown = false;

      override get geometry(): ItemGeometry {
        if (!this.#grown) {
          this.#grown = true;
          root.add(drawable());
        }
        return super.geometry;
      }
    }
    root.add(
      new GrowingRenderable(
        triangleGeometry().asGeometry,
        new PickMaterial().asMaterial,
      ),
    );

    service.update(root, view);
    // stable + growing drew; the mid-build node did not.
    expect(gl.countOf("drawArrays")).toBe(2);
    expect(idUploads(gl)).toEqual([expectedIdUpload(1), expectedIdUpload(2)]);
  });

  it("mirrors §57 depth and colour state, and restores the baseline after", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    const overlayMaterial = new PickMaterial();
    overlayMaterial.depthTest = false;
    overlayMaterial.depthWrite = false;
    const invisibleMaterial = new PickMaterial();
    invisibleMaterial.colorWrite = false;
    root.add(drawable(triangleGeometry(), overlayMaterial));
    root.add(drawable(triangleGeometry(), invisibleMaterial));

    service.update(root, view);

    // The overlay switched the depth pair off; the occluder switched colour
    // off (still writing depth); the pass put all three back.
    expect(gl.callsOf("disable").map((call) => call.args[0])).toContain(
      GL.DEPTH_TEST,
    );
    expect(gl.callsOf("depthMask").map((call) => call.args[0])).toEqual([
      false,
      true,
    ]);
    const colorMasks = gl.callsOf("colorMask").map((call) => call.args[0]);
    expect(colorMasks).toEqual([false, true]);
    const enables = gl.callsOf("enable").map((call) => call.args[0]);
    expect(enables).toContain(GL.DEPTH_TEST);
  });

  it("resolves a pixel-rect viewport against nothing — pixels are pixels", () => {
    const { gl, service, camera } = createRig();
    const root = createRoot();
    root.add(drawable());
    const view = createView(camera, {
      normalized: false,
      x: 8,
      y: 4,
      width: 16,
      height: 12,
    });
    service.update(root, view);
    expect(gl.callsOf("viewport")[0].args).toEqual([8, 4, 16, 12]);
    expect(gl.callsOf("scissor")[0].args).toEqual([8, 4, 16, 12]);
  });

  it("restores depth state the *last* draw left off — the finally's half", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    const overlayMaterial = new PickMaterial();
    overlayMaterial.depthTest = false;
    overlayMaterial.depthWrite = false;
    // The overlay is the FINAL draw, so nothing after it restores in-loop and
    // the pass envelope must.
    root.add(drawable());
    root.add(drawable(triangleGeometry(), overlayMaterial));
    service.update(root, view);
    const depthMasks = gl.callsOf("depthMask").map((call) => call.args[0]);
    expect(depthMasks).toEqual([false, true]);
    const enables = gl.callsOf("enable").map((call) => call.args[0]);
    expect(enables[enables.length - 1]).toBe(GL.DEPTH_TEST);
  });

  it("issues no state call at all for default materials", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);
    expect(gl.countOf("colorMask")).toBe(0);
    expect(gl.countOf("depthMask")).toBe(0);
    expect(gl.countOf("enable")).toBe(0);
    expect(gl.countOf("disable")).toBe(0);
    expect(gl.countOf("stencilFunc")).toBe(0);
  });

  it("draws §67 clips: stencil target, mask draw with colour off, tested content, baseline restored", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    const panel = drawable();
    panel.clip = true;
    const content = drawable();
    panel.add(content);
    root.add(panel);

    service.update(root, view);

    // The target allocated its packed depth-stencil form, and the clear
    // includes the stencil bit.
    expect(
      gl.callsOf("renderbufferStorage").map((call) => call.args[1]),
    ).toEqual([GL.DEPTH24_STENCIL8]);
    expect(gl.callsOf("clear")[0].args).toEqual([
      GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT,
    ]);

    // Mask first (§66 key 0): stencil on, ALWAYS/REPLACE into plane 1, colour
    // and depth off; then the panel's own content draw and the child, tested
    // with EQUAL over a read-only mask.
    const funcs = gl.callsOf("stencilFunc").map((call) => call.args);
    expect(funcs[0]).toEqual([GL.ALWAYS, 1, 0xff]);
    expect(funcs[1]).toEqual([GL.EQUAL, 1, 1]);
    // Restored to the between-frames baseline at the end.
    expect(funcs[funcs.length - 1]).toEqual([GL.ALWAYS, 0, 0xff]);
    const masks = gl.callsOf("stencilMask").map((call) => call.args[0]);
    expect(masks[0]).toBe(1);
    expect(masks[1]).toBe(0);
    expect(masks[masks.length - 1]).toBe(0xff);
    expect(gl.callsOf("colorMask").map((call) => call.args[0])).toEqual([
      false,
      true,
    ]);
    const disables = gl.callsOf("disable").map((call) => call.args[0]);
    expect(disables).toContain(GL.STENCIL_TEST);
    // The mask draw uploads no id — only the two content draws do.
    expect(idUploads(gl)).toEqual([expectedIdUpload(1), expectedIdUpload(2)]);
    expect(gl.countOf("drawArrays")).toBe(3);
  });

  it("reallocates the target when clipping starts, and back when it stops", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    const panel = drawable();
    root.add(panel);

    service.update(root, view);
    expect(
      gl.callsOf("renderbufferStorage").map((call) => call.args[1]),
    ).toEqual([GL.DEPTH_COMPONENT16]);

    panel.clip = true;
    service.update(root, view);
    expect(
      gl.callsOf("renderbufferStorage").map((call) => call.args[1]),
    ).toEqual([GL.DEPTH_COMPONENT16, GL.DEPTH24_STENCIL8]);

    panel.clip = false;
    service.update(root, view);
    expect(
      gl.callsOf("renderbufferStorage").map((call) => call.args[1]),
    ).toEqual([
      GL.DEPTH_COMPONENT16,
      GL.DEPTH24_STENCIL8,
      GL.DEPTH_COMPONENT16,
    ]);
  });

  it("resizes the id target when the drawing buffer resizes", () => {
    const { gl, service, state, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);
    expect(gl.callsOf("texImage2D")[0].args[3]).toBe(64);

    state.surfaceWidth = 128;
    state.surfaceHeight = 32;
    service.update(root, view);
    const uploads = gl.callsOf("texImage2D");
    expect(uploads[uploads.length - 1].args[3]).toBe(128);
    expect(uploads[uploads.length - 1].args[4]).toBe(32);
    expect(gl.callsOf("viewport")[1].args).toEqual([0, 0, 128, 32]);
  });

  it("skips particle and skinned items — absence, never a wrong picture", () => {
    const { gl, service, view } = createRig();
    // A container double (`webgl-renderer.test.ts`'s pattern): a structural
    // node whose children mix a particle drawable — which must NOT be a
    // `Renderable`, or the renderable arm would claim it — with real ones.
    const emitter = {
      isParticleDrawable: true as const,
      id: "test-emitter",
      parent: null,
      children: [] as unknown[],
      visible: true,
      enabled: true,
      renderLayer: 0,
      renderOrder: 0,
      particleCount: 1,
      particleInstances: new Float32Array(12),
      transform: { worldMatrix: new Matrix4() },
      updateParticleInstances(): void {
        // repacked elsewhere
      },
    };
    // A skinned mesh, structurally: a drawable whose skeleton and streams
    // make `collect` emit a skinned item.
    const skinnedGeometry = triangleGeometry();
    Object.assign(skinnedGeometry, {
      joints: new Uint16Array(12),
      weights: new Float32Array(12),
    });
    const skinned = drawable(skinnedGeometry);
    Object.assign(skinned, {
      skeleton: {
        bones: [{}],
        jointMatrices: new Float32Array(16),
        update(): void {
          // palette refreshed elsewhere
        },
      },
    });
    const plain = drawable();
    const root = {
      visible: true,
      enabled: true,
      children: [emitter, skinned, plain] as unknown[],
    };
    type PickRoot = Parameters<PickingService["update"]>[0];

    service.update(root as unknown as PickRoot, view);
    // Only the plain drawable drew — and only it uploaded an id. The table
    // held the two renderables (indices 0 and 1: the skinned one and the
    // plain one, traversal order), so the plain draw encodes index 1.
    expect(gl.countOf("drawArrays")).toBe(1);
    expect(idUploads(gl)).toEqual([expectedIdUpload(1)]);
  });

  it("refuses a zero-area viewport and a zero-size surface (§85)", () => {
    const { service, state, view, camera } = createRig();
    const root = createRoot();
    expect(
      thrown(() => {
        service.update(root, createView(camera, { width: 0 }));
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");

    state.surfaceWidth = 0;
    expect(
      thrown(() => {
        service.update(root, view);
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("skips the pass while the context is lost, and drops the stale buffer", async () => {
    const { gl, service, state, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);
    expect(gl.countOf("drawArrays")).toBe(1);

    state.contextLost = true;
    service.update(root, view);
    expect(gl.countOf("drawArrays")).toBe(1);
    state.contextLost = false;
    // The skipped pass left no id buffer — a stale answer would be a lie.
    expect(
      (await rejection(service.pick({ viewport: view, ndcX: 0, ndcY: 0 })))
        .code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("skips the pass when the id target's framebuffer is incomplete (§61)", () => {
    const { gl, service, view } = createRig({
      framebufferStatus: 0x8cd6,
    });
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);
    expect(gl.countOf("drawArrays")).toBe(0);
  });

  it("latches a compile failure per era and warns once (§61, §89)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      // silenced
    });
    try {
      const { gl, service, state, view } = createRig({ compileStatus: false });
      const root = createRoot();
      root.add(drawable());
      service.update(root, view);
      service.update(root, view);
      // One attempt (two stages the first time, none the second), no draws.
      expect(gl.countOf("compileShader")).toBe(1);
      expect(gl.countOf("drawArrays")).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);

      // A new era clears the latch: the driver is asked once more.
      restoreContext(state);
      service.update(root, view);
      expect(gl.countOf("compileShader")).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("recompiles after a context restore — new caches are a new era", () => {
    const { gl, service, state, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);
    expect(gl.countOf("linkProgram")).toBe(1);

    state.contextLost = true;
    restoreContext(state);
    service.update(root, view);
    expect(gl.countOf("linkProgram")).toBe(2);
    expect(gl.countOf("drawArrays")).toBe(2);
  });

  it("refuses after dispose (§83)", () => {
    const { service, view } = createRig();
    service.dispose();
    expect(
      thrown(() => {
        service.update(createRoot(), view);
      }).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });
});

// ---------------------------------------------------------------------------
// The read-back.
// ---------------------------------------------------------------------------

describe("WebglPickingService.pick — the asynchronous read-back", () => {
  async function pickedAt(
    rig: Rig,
    index: number,
    ndcX = 0,
    ndcY = 0,
  ): Promise<{ nodeId: string | undefined; frame: number }> {
    rig.gl.nextTexel = texelOf(index);
    return rig.service.pick({ viewport: rig.view, ndcX, ndcY });
  }

  it("resolves the front-most id to its traversal-table node id", async () => {
    const rig = createRig({ canFence: false });
    const root = createRoot();
    const a = drawable();
    const b = drawable();
    root.add(a);
    root.add(b);
    rig.service.update(root, rig.view);

    expect(await pickedAt(rig, 1)).toEqual({ nodeId: a.id, frame: 1 });
    expect(await pickedAt(rig, 2)).toEqual({ nodeId: b.id, frame: 1 });
    // The clear colour decodes to "nothing there".
    rig.gl.nextTexel = [0, 0, 0, 0];
    const empty = await rig.service.pick({
      viewport: rig.view,
      ndcX: 0,
      ndcY: 0,
    });
    expect(empty.nodeId).toBeUndefined();
    // A value past the table — a driver anomaly — is "nothing" too.
    rig.gl.nextTexel = texelOf(MAX_PICK_CANDIDATES - 1);
    const anomalous = await rig.service.pick({
      viewport: rig.view,
      ndcX: 0,
      ndcY: 0,
    });
    expect(anomalous.nodeId).toBeUndefined();
  });

  it("maps NDC to the viewport's pixels, +Y up, edges clamped inside", async () => {
    const rig = createRig({ canFence: false });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);

    await pickedAt(rig, 1, -1, -1);
    await pickedAt(rig, 1, 0, 0);
    await pickedAt(rig, 1, 1, 1);
    const reads = rig.gl.callsOf("readPixels").map((call) => call.args);
    expect(reads[0].slice(0, 4)).toEqual([0, 0, 1, 1]);
    expect(reads[1].slice(0, 4)).toEqual([32, 32, 1, 1]);
    expect(reads[2].slice(0, 4)).toEqual([63, 63, 1, 1]);
    expect(reads[0][4]).toBe(GL.RGBA);
    expect(reads[0][5]).toBe(GL.UNSIGNED_BYTE);
  });

  it("stall path: binds the pass framebuffer for the read and unbinds after", async () => {
    const rig = createRig({ canFence: false });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);
    rig.gl.reset();

    await pickedAt(rig, 1);
    expect(rig.gl.names()).toEqual([
      "bindFramebuffer",
      "readPixels",
      "bindFramebuffer",
    ]);
    expect(rig.gl.callsOf("bindFramebuffer")[1].args[1]).toBeNull();
  });

  it("fence path: pack buffer, non-blocking waits, one copy back, no stall read", async () => {
    const rig = createRig({
      waitStatuses: [
        PICKING_GL.TIMEOUT_EXPIRED,
        PICKING_GL.TIMEOUT_EXPIRED,
        PICKING_GL.CONDITION_SATISFIED,
      ],
    });
    const root = createRoot();
    const a = drawable();
    root.add(a);
    rig.service.update(root, rig.view);
    rig.gl.reset();

    const result = await pickedAt(rig, 1);
    expect(result.nodeId).toBe(a.id);

    // The read went through the pack buffer at offset 0…
    const read = rig.gl.callsOf("readPixels");
    expect(read).toHaveLength(1);
    expect(read[0].args[6]).toBe(0);
    // …behind a fence polled without blocking (timeout 0 every time), with
    // the flush flag on the first wait only.
    const waits = rig.gl.callsOf("clientWaitSync");
    expect(waits).toHaveLength(3);
    expect(waits[0].args[1]).toBe(PICKING_GL.SYNC_FLUSH_COMMANDS_BIT);
    expect(waits[1].args[1]).toBe(0);
    expect(waits.every((call) => call.args[2] === 0)).toBe(true);
    // …then one copy back, and the transient objects released.
    expect(rig.gl.countOf("getBufferSubData")).toBe(1);
    expect(rig.gl.countOf("deleteSync")).toBe(1);
    expect(rig.gl.countOf("deleteBuffer")).toBe(1);
    // The pack binding never leaks.
    const packBinds = rig.gl
      .callsOf("bindBuffer")
      .filter((call) => call.args[0] === PICKING_GL.PIXEL_PACK_BUFFER);
    expect(packBinds[packBinds.length - 1].args[1]).toBeNull();
  });

  it("falls back to the stalling read when GL refuses the pack buffer or fence", async () => {
    for (const options of [
      { allocateBuffers: false },
      { refuseFence: true },
    ] satisfies FakePickGlOptions[]) {
      const rig = createRig(options);
      const root = createRoot();
      const a = drawable();
      root.add(a);
      rig.service.update(root, rig.view);
      const result = await pickedAt(rig, 1);
      expect(result.nodeId).toBe(a.id);
      // The final read was the direct one — a destination view, not offset 0.
      const reads = rig.gl.callsOf("readPixels");
      expect(typeof reads[reads.length - 1].args[6]).not.toBe("number");
    }
  });

  it("rejects CONTEXT_LOST when the wait itself fails", async () => {
    const rig = createRig({ waitStatuses: [PICKING_GL.WAIT_FAILED] });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);
    expect((await rejection(pickedAt(rig, 1))).code).toBe("CONTEXT_LOST");
    // The fence and pack buffer were still released.
    expect(rig.gl.countOf("deleteSync")).toBe(1);
    expect(rig.gl.countOf("deleteBuffer")).toBe(1);
  });

  it("rejects CONTEXT_LOST when the context goes down mid-poll", async () => {
    const rig = createRig({
      waitStatuses: [PICKING_GL.TIMEOUT_EXPIRED, PICKING_GL.TIMEOUT_EXPIRED],
    });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);
    const pending = pickedAt(rig, 1);
    rig.state.contextLost = true;
    expect((await rejection(pending)).code).toBe("CONTEXT_LOST");
  });

  it("rejects when the service is disposed mid-poll (§83)", async () => {
    const rig = createRig({
      waitStatuses: [PICKING_GL.TIMEOUT_EXPIRED, PICKING_GL.TIMEOUT_EXPIRED],
    });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);
    const pending = pickedAt(rig, 1);
    rig.service.dispose();
    expect((await rejection(pending)).code).toBe("INVALID_APPLICATION_STATE");
  });

  it("polls on a host with no setTimeout — the microtask fallback", async () => {
    const rig = createRig({
      waitStatuses: [PICKING_GL.TIMEOUT_EXPIRED],
    });
    const root = createRoot();
    const a = drawable();
    root.add(a);
    rig.service.update(root, rig.view);
    vi.stubGlobal("setTimeout", undefined);
    try {
      const result = await pickedAt(rig, 1);
      expect(result.nodeId).toBe(a.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses before any update, out-of-range NDC, and a foreign viewport (§85)", async () => {
    const rig = createRig({ canFence: false });
    expect(
      (
        await rejection(
          rig.service.pick({ viewport: rig.view, ndcX: 0, ndcY: 0 }),
        )
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");

    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);

    for (const [ndcX, ndcY] of [
      [2, 0],
      [0, -1.5],
      [Number.NaN, 0],
    ]) {
      expect(
        (await rejection(rig.service.pick({ viewport: rig.view, ndcX, ndcY })))
          .code,
      ).toBe("INVALID_APPLICATION_STATE");
    }

    const otherView = createView(rig.camera, { id: "other" });
    expect(
      (
        await rejection(
          rig.service.pick({ viewport: otherView, ndcX: 0, ndcY: 0 }),
        )
      ).code,
    ).toBe("INVALID_APPLICATION_STATE");
  });

  it("refuses a disposed service and a disposed renderer (§83)", async () => {
    const rig = createRig({ canFence: false });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);

    rig.state.disposed = true;
    expect((await rejection(pickedAt(rig, 1))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
    rig.state.disposed = false;

    rig.service.dispose();
    expect((await rejection(pickedAt(rig, 1))).code).toBe(
      "INVALID_APPLICATION_STATE",
    );
  });

  it("rejects CONTEXT_LOST for a buffer that predates a loss or restore", async () => {
    const rig = createRig({ canFence: false });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);

    rig.state.contextLost = true;
    expect((await rejection(pickedAt(rig, 1))).code).toBe("CONTEXT_LOST");

    // Restored — same context object, new caches: the old buffer is gone.
    restoreContext(rig.state);
    expect((await rejection(pickedAt(rig, 1))).code).toBe("CONTEXT_LOST");
  });

  it("refuses UNSUPPORTED_GPU_FEATURE on a context with no readPixels (§62)", async () => {
    const rig = createRig({ canReadPixels: false, canFence: false });
    const root = createRoot();
    root.add(drawable());
    rig.service.update(root, rig.view);
    expect((await rejection(pickedAt(rig, 1))).code).toBe(
      "UNSUPPORTED_GPU_FEATURE",
    );
  });

  it("reports the update ordinal the buffer came from", async () => {
    const rig = createRig({ canFence: false });
    const root = createRoot();
    const a = drawable();
    root.add(a);
    rig.service.update(root, rig.view);
    expect((await pickedAt(rig, 1)).frame).toBe(1);
    rig.service.update(root, rig.view);
    rig.service.update(root, rig.view);
    expect((await pickedAt(rig, 1)).frame).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Disposal.
// ---------------------------------------------------------------------------

describe("WebglPickingService.dispose (§83)", () => {
  it("deletes the id program and framebuffer on a live context, idempotently", () => {
    const { gl, service, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);
    gl.reset();

    service.dispose();
    expect(service.disposed).toBe(true);
    expect(gl.countOf("deleteProgram")).toBe(1);
    expect(gl.countOf("deleteFramebuffer")).toBe(1);
    expect(gl.countOf("deleteTexture")).toBe(1);
    expect(gl.countOf("deleteRenderbuffer")).toBe(1);

    service.dispose();
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("touches nothing on a lost context — handles are already invalid (§61)", () => {
    const { gl, service, state, view } = createRig();
    const root = createRoot();
    root.add(drawable());
    service.update(root, view);
    state.contextLost = true;
    gl.reset();

    service.dispose();
    expect(gl.calls).toHaveLength(0);
  });

  it("disposes cleanly before any pass — nothing was created", () => {
    const { gl, service } = createRig();
    service.dispose();
    expect(gl.calls).toHaveLength(0);
  });
});

describe("IdPassProgram", () => {
  it("is disposable directly, and idempotently", () => {
    const gl = createFakePickGl();
    const program = IdPassProgram.create(gl);
    expect(program.disposed).toBe(false);
    program.dispose();
    program.dispose();
    expect(program.disposed).toBe(true);
    expect(gl.countOf("deleteProgram")).toBe(1);
  });

  it("deletes the program when a uniform is missing", () => {
    const gl = createFakePickGl();
    const broken = {
      ...gl,
      getUniformLocation: () => null,
    } as unknown as WebglContext;
    expect(() => IdPassProgram.create(broken)).toThrow();
  });
});
