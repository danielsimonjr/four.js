import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { HarfBuzzShapingEngine } from "../src/harfbuzz/index.js";
const wasm = readFileSync(
  new URL("../node_modules/harfbuzzjs/hb.wasm", import.meta.url),
);
it("pins wasm and wraps content/lifecycle errors", async () => {
  expect(createHash("sha256").update(wasm).digest("hex")).toBe(
    "508aa149f78663744e6ad3e513aaac1728688f77b53dad3c46160b150d2af102",
  );
  await expect(
    HarfBuzzShapingEngine.create({ wasm: new Uint8Array(1) }),
  ).rejects.toMatchObject({ code: "UNTRUSTED_INPUT_REJECTED" });
  const e = await HarfBuzzShapingEngine.create({ wasm });
  expect(() => e.addFont(new Uint8Array(2), { maximumFontBytes: 1 })).toThrow(
    expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }),
  );
  expect(() => e.addFont(new Uint8Array(16))).toThrow(
    expect.objectContaining({ code: "UNTRUSTED_INPUT_REJECTED" }),
  );
  const fontId = e.addFont(
    readFileSync(
      new URL(
        "../../../tests/fixtures/fonts/NotoSans-Regular.ttf",
        import.meta.url,
      ),
    ),
  );
  expect(
    e.shape({ text: "fi", fontId, features: { liga: 1 } })[0].glyphs,
  ).toHaveLength(1);
  expect(
    e.shape({ text: "fi", fontId, features: { liga: 0 } })[0].glyphs,
  ).toHaveLength(2);
  expect(() => e.shape({ text: "fi", fontId, direction: "ttb" })).toThrow(
    expect.objectContaining({ code: "NOT_IMPLEMENTED" }),
  );
  e.dispose();
  e.dispose();
  expect(() => e.shape({ text: "fi", fontId })).toThrow(
    expect.objectContaining({ code: "INVALID_APPLICATION_STATE" }),
  );
});
