import { describe, expect, it } from "vitest";

import { UnlitMaterial } from "../src/index.js";

describe("UnlitMaterial", () => {
  it("defaults to opaque white at version 0", () => {
    const material = new UnlitMaterial();

    expect(material.color).toEqual([1, 1, 1, 1]);
    expect(material.version).toBe(0);
    expect(material.disposed).toBe(false);
  });

  it("copies the supplied color instead of holding the caller's array", () => {
    const source: [number, number, number, number] = [0.25, 0.5, 0.75, 0.5];
    const material = new UnlitMaterial({ color: source });

    expect(material.color).toEqual(source);
    expect(material.color).not.toBe(source);

    source[0] = 1;
    expect(material.color[0]).toBe(0.25);
  });

  it("assigns monotonic, unique ids", () => {
    const first = new UnlitMaterial();
    const second = new UnlitMaterial();

    expect(first.id).toMatch(/^material-\d+$/);
    expect(second.id).not.toBe(first.id);

    const ordinal = (m: UnlitMaterial): number =>
      Number(m.id.slice("material-".length));
    expect(ordinal(second)).toBe(ordinal(first) + 1);
  });

  it("writes the color in place and bumps the version once", () => {
    const material = new UnlitMaterial();
    const color = material.color;

    expect(material.setColor(0.1, 0.2, 0.3, 0.4)).toBe(material);
    // The array instance is never replaced — a backend may hold a reference.
    expect(material.color).toBe(color);
    expect(material.color).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(material.version).toBe(1);
  });

  it("resets alpha to opaque when setColor is given three components", () => {
    const material = new UnlitMaterial({ color: [1, 1, 1, 0.2] });

    material.setColor(0, 0, 0);
    expect(material.color[3]).toBe(1);
  });

  it("announces in-place edits through markDirty", () => {
    const material = new UnlitMaterial();

    material.color[3] = 0.5;
    expect(material.version).toBe(0);

    material.markDirty();
    expect(material.version).toBe(1);
    expect(material.color[3]).toBe(0.5);
  });

  it("passes values outside 0…1 through unchanged", () => {
    const material = new UnlitMaterial({ color: [2, -1, 0.5, 1] });

    expect(material.color[0]).toBe(2);
    expect(material.color[1]).toBe(-1);

    material.setColor(4, 0, 0, 3);
    expect(material.color[0]).toBe(4);
    expect(material.color[3]).toBe(3);
  });

  it("rejects non-finite components (§85)", () => {
    expect(() => new UnlitMaterial({ color: [Number.NaN, 0, 0, 1] })).toThrow(
      RangeError,
    );
    expect(
      () => new UnlitMaterial({ color: [0, Number.POSITIVE_INFINITY, 0, 1] }),
    ).toThrow(/must be finite/);

    const material = new UnlitMaterial();
    expect(() => material.setColor(0, 0, Number.NaN)).toThrow(RangeError);
    expect(() => material.setColor(0, 0, 0, Number.NaN)).toThrow(RangeError);
    expect(material.version).toBe(0);
  });

  it("disposes once, keeps the color, and bumps the version (§83)", () => {
    const material = new UnlitMaterial({ color: [0, 0.5, 1, 1] });

    material.dispose();
    expect(material.disposed).toBe(true);
    expect(material.version).toBe(1);
    expect(material.color).toEqual([0, 0.5, 1, 1]);

    material.dispose();
    expect(material.version).toBe(1);
  });
});
