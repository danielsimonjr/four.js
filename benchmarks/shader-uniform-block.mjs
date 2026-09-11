/** Deterministic upload-call/payload measurement; no GPU timing claims. */
import { NodeMaterialBuilder } from "../packages/materials/dist/index.js";
import {
  GlNodeProgram,
  emitShaderGraphGlsl,
} from "../packages/render-webgl/dist/index.js";

import { hostRecord, writeResult } from "./harness.mjs";

const uniformCount = 16;
const draws = 1000;
function measure(block) {
  const builder = new NodeMaterialBuilder();
  if (block) builder.useUniformBlock();
  let value = builder.uniform("u0", "float");
  for (let i = 1; i < uniformCount; i++)
    value = value.add(builder.uniform(`u${i}`, "float"));
  builder.output.color = builder.vec4(value, value, value, 1);
  const material = builder.build();
  let calls = 0;
  let bytes = 0;
  const gl = {
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader() {},
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    deleteProgram() {},
    getUniformLocation: () => ({}),
    useProgram() {},
    uniform1i() {},
    uniform1f() {
      calls++;
      bytes += 4;
    },
    getUniformBlockIndex: () => 0,
    uniformBlockBinding() {},
    bindBufferBase() {},
    createBuffer: () => ({}),
    bindBuffer() {},
    deleteBuffer() {},
    bufferData(_target, data) {
      calls++;
      bytes += data.byteLength;
    },
  };
  const program = GlNodeProgram.create(gl, emitShaderGraphGlsl(material.graph));
  program.use();
  program.setMaterial(material); // exclude allocation and first opacity upload
  calls = 0;
  bytes = 0;
  for (let draw = 0; draw < draws; draw++) program.setMaterial(material);
  program.dispose();
  material.dispose();
  return { uploadCalls: calls, payloadBytes: bytes };
}
const result = {
  benchmark: "shader-uniform-block",
  recordedAt: new Date().toISOString(),
  host: hostRecord(),
  uniformCount,
  draws,
  individual: measure(false),
  std140: measure(true),
  scope: "instrumented WebGL calls; excludes driver overhead and GPU timing",
};
writeResult("shader-uniform-block", result);
console.log(JSON.stringify(result, null, 2));
