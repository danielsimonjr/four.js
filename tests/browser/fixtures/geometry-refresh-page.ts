/** Real-driver comparison: queue old and new geometry draws before readback. */
import { BufferGeometry } from "@four/geometry";
import { GeometryCache, type WebglContext } from "@four/render-webgl";

const WIDTH = 448;
const HEIGHT = 64;
const triangle = () =>
  new Float32Array([-0.8, -0.8, 0, 0.8, -0.8, 0, 0, 0.8, 0]);
const square = () =>
  new Float32Array([
    -0.8, -0.8, 0, 0.8, -0.8, 0, 0.8, 0.8, 0, -0.8, -0.8, 0, 0.8, 0.8, 0, -0.8,
    0.8, 0,
  ]);

function probe(reuse: boolean, indexed: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const gl = canvas.getContext("webgl2", { antialias: false });
  if (gl === null) throw new Error("WebGL 2 unavailable");
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error("shader allocation failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(
        gl.getShaderInfoLog(shader) ?? "shader compilation failed",
      );
    return shader;
  };
  const vertex = compile(
    gl.VERTEX_SHADER,
    `#version 300 es
    layout(location=0) in vec3 position;
    void main() { gl_Position = vec4(position, 1.0); }`,
  );
  const fragment = compile(
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision highp float;
    out vec4 color;
    void main() { color = vec4(1.0, 0.4, 0.2, 1.0); }`,
  );
  const program = gl.createProgram();
  if (program === null) throw new Error("program allocation failed");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.useProgram(program);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const geometry = new BufferGeometry({
    positions: triangle(),
    ...(indexed ? { indices: new Uint16Array([0, 1, 2]) } : {}),
  });
  const caches: GeometryCache[] = [];
  const reused: boolean[] = [];
  let previous: object | null = null;
  for (let step = 0; step < 7; step++) {
    switch (step) {
      case 1:
        geometry.positions[0] = 0;
        geometry.markDirty();
        break;
      case 2:
        geometry.positions = square();
        if (indexed) geometry.indices = new Uint32Array([0, 1, 2, 3, 4, 5]);
        break;
      case 3:
        if (indexed) geometry.indices = new Uint16Array([0, 1, 2]);
        geometry.positions = triangle();
        break;
      case 4:
        geometry.normals = new Float32Array(9).fill(1);
        break;
      case 5:
        geometry.positions[7] = 0;
        geometry.normals![0] = 0;
        geometry.markDirty();
        break;
      case 6:
        geometry.normals = undefined;
        break;
    }
    const cache =
      reuse && caches.length > 0
        ? caches[0]
        : new GeometryCache(gl as unknown as WebglContext);
    if (cache !== caches[0]) caches.push(cache);
    const record = cache.acquire(geometry);
    if (record === null) throw new Error("geometry upload failed");
    if (previous !== null) reused.push(record.vertexArray === previous);
    previous = record.vertexArray;
    gl.viewport(step * 64, 0, 64, HEIGHT);
    gl.bindVertexArray(record.vertexArray);
    if (record.indexType === null) gl.drawArrays(record.mode, 0, record.count);
    else gl.drawElements(record.mode, record.count, record.indexType, 0);
  }
  // No intervening flush, finish, readPixels, or GL-state queries: this tests
  // whether replacing a store preserves earlier queued draws as well as new ones.
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const error = gl.getError();
  for (const cache of caches) cache.dispose();
  geometry.dispose();
  gl.deleteProgram(program);
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { pixels: Array.from(pixels), reused, error };
}

declare global {
  interface Window {
    fourGeometryRefreshProbe?: typeof probe;
  }
}
window.fourGeometryRefreshProbe = probe;
document.body.dataset.geometryRefreshReady = "1";
