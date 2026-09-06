/**
 * A-13 remainder — the §75 hidden DOM accessibility mirror is reachable from
 * the public `@four/ui` surface, not only from a deep `src/` import.
 *
 * The document is a duck-typed fake: this suite runs in Node, the same way
 * the colocated unit tests do. A browser passes `window.document`.
 */

import {
  Button,
  Checkbox,
  Slider,
  accessibilityElementId,
  installAccessibilityMirror,
  type DocumentLike,
  type ElementLike,
} from "@four/ui";
import { describe, expect, it } from "vitest";

class FakeElement implements ElementLike {
  readonly tagName: string;
  id = "";
  tabIndex = 0;
  disabled = false;
  checked = false;
  type = "";
  style: {
    position?: string;
    width?: string;
    height?: string;
    clip?: string;
    fontSize?: string;
  } = { fontSize: "" };
  parentNode: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly #document: FakeDocument;

  constructor(tagName: string, document: FakeDocument) {
    this.tagName = tagName;
    this.#document = document;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") {
      this.id = value;
      this.#document.register(this);
    }
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    if (child.id !== "") this.#document.register(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index !== -1) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
    this.#document.unregister(this);
  }
}

class FakeDocument implements DocumentLike {
  readonly body: FakeElement;
  readonly #byId = new Map<string, FakeElement>();

  constructor() {
    this.body = new FakeElement("body", this);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  getElementById(id: string): FakeElement | null {
    return this.#byId.get(id) ?? null;
  }

  register(element: FakeElement): void {
    if (element.id !== "") this.#byId.set(element.id, element);
  }

  unregister(element: FakeElement): void {
    if (element.id !== "") this.#byId.delete(element.id);
    for (const child of element.children) this.unregister(child);
  }
}

describe("installAccessibilityMirror (public @four/ui surface)", () => {
  it("projects button label/role/disabled, slider values, and a disabled checkbox", () => {
    const document = new FakeDocument();
    const start = new Button({
      accessibility: { role: "button", label: "Start" },
    });
    const gravity = new Slider({
      min: 0,
      max: 10,
      value: 3,
      accessibility: { role: "slider", label: "Gravity" },
    });
    const mute = new Checkbox({
      accessibility: { role: "checkbox", label: "Mute" },
      disabled: true,
    });

    const mirror = installAccessibilityMirror([start, gravity, mute], {
      document,
    });

    const button = document.getElementById(accessibilityElementId(start));
    expect(button?.getAttribute("role")).toBe("button");
    expect(button?.getAttribute("aria-label")).toBe("Start");
    expect(button?.getAttribute("aria-disabled")).toBeNull();

    const slider = document.getElementById(accessibilityElementId(gravity));
    expect(slider?.getAttribute("aria-valuemin")).toBe("0");
    expect(slider?.getAttribute("aria-valuemax")).toBe("10");
    expect(slider?.getAttribute("aria-valuenow")).toBe("3");

    const checkbox = document.getElementById(accessibilityElementId(mute));
    expect(checkbox?.getAttribute("aria-disabled")).toBe("true");
    expect(checkbox?.disabled).toBe(true);

    start.disabled = true;
    expect(
      document
        .getElementById(accessibilityElementId(start))
        ?.getAttribute("aria-disabled"),
    ).toBe("true");

    gravity.value = 7;
    expect(
      document
        .getElementById(accessibilityElementId(gravity))
        ?.getAttribute("aria-valuenow"),
    ).toBe("7");

    mirror.dispose();
    expect(document.body.children).toHaveLength(0);
    expect(document.getElementById(accessibilityElementId(start))).toBeNull();
  });
});
