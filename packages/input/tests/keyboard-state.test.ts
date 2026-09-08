/**
 * `KeyboardState` (§72) — the polled key-state helper.
 *
 * Driven without a DOM through the same `KeySurface` seam `keyboard.test.ts`
 * uses, so the blur case below is testable rather than a comment.
 */

import { describe, expect, it } from "vitest";

import {
  KeyboardState,
  type KeySurface,
  type SurfaceKeyListener,
} from "../src/index.js";

/** A key surface with no DOM behind it. */
class FakeSurface implements KeySurface {
  readonly listeners = new Map<string, SurfaceKeyListener[]>();

  addEventListener(type: string, listener: SurfaceKeyListener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: SurfaceKeyListener): void {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((candidate) => candidate !== listener),
    );
  }

  /** Delivers one synthetic event of `type` to every listener for it. */
  emit(type: string, code: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({
        key: code,
        code,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        repeat: false,
        preventDefault: () => undefined,
      } as never);
    }
  }

  /** Delivers a listener-shaped event carrying no key, as `blur` does. */
  emitBare(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(undefined as never);
    }
  }

  /** Every listener still registered, across all types. */
  get count(): number {
    return [...this.listeners.values()].reduce((n, l) => n + l.length, 0);
  }
}

describe("KeyboardState (§72)", () => {
  it("reports a key as held between keydown and keyup", () => {
    const surface = new FakeSurface();
    const keys = new KeyboardState(surface);

    expect(keys.isDown("KeyW")).toBe(false);
    surface.emit("keydown", "KeyW");
    expect(keys.isDown("KeyW")).toBe(true);
    surface.emit("keyup", "KeyW");
    expect(keys.isDown("KeyW")).toBe(false);
  });

  it("keys on `code`, not `key`, so the layout cannot change the answer", () => {
    const surface = new FakeSurface();
    const keys = new KeyboardState(surface);

    surface.emit("keydown", "KeyZ");
    // A French keyboard produces `key: "w"` from the physical Z. Game input
    // wants the position, so `code` is the identity and `key` is not consulted.
    expect(keys.isDown("KeyZ")).toBe(true);
    expect(keys.isDown("w")).toBe(false);
  });

  it("releases everything when the surface loses focus", () => {
    // The bug every hand-rolled version of this has, including the two in this
    // repo's own examples: focus leaves while a key is held, the keyup lands on
    // another window, and the key is held forever. Alt-Tab while walking and
    // the character never stops.
    const surface = new FakeSurface();
    const keys = new KeyboardState(surface);

    surface.emit("keydown", "KeyW");
    surface.emit("keydown", "ShiftLeft");
    expect(keys.held.size).toBe(2);

    surface.emitBare("blur");
    expect(keys.held.size, "held keys survived a focus loss").toBe(0);
    expect(keys.isDown("KeyW")).toBe(false);
  });

  it("exposes held as a read-only view a caller cannot corrupt", () => {
    const surface = new FakeSurface();
    const keys = new KeyboardState(surface);
    surface.emit("keydown", "KeyA");

    const view = keys.held;
    expect([...view]).toEqual(["KeyA"]);
    // The set is the live one, so a caller must not be able to edit it.
    expect(() => (view as Set<string>).add("KeyB")).toThrow();
  });

  it("removes every listener on dispose, and stops tracking", () => {
    const surface = new FakeSurface();
    const keys = new KeyboardState(surface);
    expect(surface.count).toBeGreaterThan(0);

    surface.emit("keydown", "KeyW");
    keys.dispose();

    expect(surface.count, "listeners outlived dispose").toBe(0);
    expect(keys.held.size, "state survived dispose").toBe(0);
  });

  it("is idempotent on dispose", () => {
    const surface = new FakeSurface();
    const keys = new KeyboardState(surface);
    keys.dispose();
    expect(() => keys.dispose()).not.toThrow();
  });
});
