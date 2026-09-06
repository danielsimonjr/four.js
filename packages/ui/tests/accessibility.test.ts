/**
 * §75's hidden DOM accessibility mirror (A-13 remainder): the opt-in
 * installer, the duck-typed DocumentLike, and the push of label / role /
 * disabled / slider values into a visually-hidden tree.
 *
 * No real DOM — the document is a tiny fake that implements the three
 * members the installer names (`createElement`, `body`, `getElementById`).
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  accessibilityElementId,
  installAccessibilityMirror,
  prefersReducedMotion,
  type DocumentLike,
  type ElementLike,
} from "../src/accessibility.js";
import { Button } from "../src/button.js";
import { Checkbox, Toggle } from "../src/checkable.js";
import { Panel } from "../src/panel.js";
import { ProgressIndicator } from "../src/progress.js";
import { RadioButton } from "../src/radio.js";
import { Slider } from "../src/slider.js";
import { UIWidget } from "../src/widget.js";

class FakeElement implements ElementLike {
  readonly tagName: string;
  id = "";
  tabIndex = 0;
  disabled = false;
  checked = false;
  type = "";
  textContent = "";
  style: {
    position?: string;
    width?: string;
    height?: string;
    padding?: string;
    margin?: string;
    overflow?: string;
    clip?: string;
    clipPath?: string;
    whiteSpace?: string;
    border?: string;
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
    if (child.parentNode !== null) {
      child.parentNode.removeChild(child);
    }
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
    this.#document.unregisterTree(this);
  }
}

class FakeDocument implements DocumentLike {
  readonly body: FakeElement;
  matchMediaResult: { matches: boolean } | null = null;
  defaultView: { matchMedia: (query: string) => { matches: boolean } } | null =
    null;
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

  matchMedia(): { matches: boolean } {
    if (this.matchMediaResult !== null) {
      return this.matchMediaResult;
    }
    return { matches: false };
  }

  register(element: FakeElement): void {
    if (element.id !== "") this.#byId.set(element.id, element);
  }

  unregisterTree(element: FakeElement): void {
    if (element.id !== "") this.#byId.delete(element.id);
    for (const child of element.children) {
      this.unregisterTree(child);
    }
  }
}

class TestWidget extends UIWidget {}

function projected(
  document: FakeDocument,
  widget: UIWidget,
): FakeElement | null {
  return document.getElementById(accessibilityElementId(widget));
}

describe("installAccessibilityMirror (§75)", () => {
  const installed: Array<{ dispose(): void }> = [];

  afterEach(() => {
    for (const mirror of installed) mirror.dispose();
    installed.length = 0;
  });

  function install(
    root: UIWidget | readonly UIWidget[],
    options: Parameters<typeof installAccessibilityMirror>[1] = {},
  ) {
    const document =
      (options.document as FakeDocument | undefined) ?? new FakeDocument();
    const mirror = installAccessibilityMirror(root, { ...options, document });
    installed.push(mirror);
    return { mirror, document };
  }

  it("projects a button's label, role, disabled, and tabIndex", () => {
    const button = new Button({
      accessibility: { role: "button", label: "Start", tabIndex: 2 },
    });
    const { document, mirror } = install(button);
    const node = projected(document, button);
    expect(node).not.toBeNull();
    expect(node?.tagName).toBe("button");
    expect(node?.getAttribute("role")).toBe("button");
    expect(node?.getAttribute("aria-label")).toBe("Start");
    expect(node?.getAttribute("aria-disabled")).toBeNull();
    expect(node?.tabIndex).toBe(2);
    expect(node?.getAttribute("tabindex")).toBe("2");
    expect(mirror.elementFor(button)).toBe(node);
  });

  it("writes aria-disabled and disabled when the button is disabled", () => {
    const button = new Button({
      label: "Go",
      role: "button",
      disabled: true,
    });
    const { document } = install(button);
    const node = projected(document, button);
    expect(node?.getAttribute("aria-disabled")).toBe("true");
    expect(node?.disabled).toBe(true);
  });

  it("pushes a later disabled write without syncAll", () => {
    const button = new Button({ label: "Go", role: "button" });
    const { document } = install(button);
    expect(
      projected(document, button)?.getAttribute("aria-disabled"),
    ).toBeNull();
    button.disabled = true;
    expect(projected(document, button)?.getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("projects slider aria-valuenow/min/max and updates on assignment", () => {
    const slider = new Slider({
      min: -20,
      max: 0,
      value: -9.81,
      accessibility: { role: "slider", label: "Gravity" },
    });
    const { document } = install(slider);
    const node = projected(document, slider);
    expect(node?.tagName).toBe("input");
    expect(node?.type).toBe("range");
    expect(node?.getAttribute("role")).toBe("slider");
    expect(node?.getAttribute("aria-label")).toBe("Gravity");
    expect(node?.getAttribute("aria-valuemin")).toBe("-20");
    expect(node?.getAttribute("aria-valuemax")).toBe("0");
    expect(node?.getAttribute("aria-valuenow")).toBe("-9.81");
    slider.value = -5;
    expect(projected(document, slider)?.getAttribute("aria-valuenow")).toBe(
      "-5",
    );
  });

  it("projects a progress indicator and drops valuennow when indeterminate", () => {
    const bar = new ProgressIndicator({
      min: 0,
      max: 10,
      value: 4,
      accessibility: { role: "progressbar", label: "Loading" },
    });
    const { document } = install(bar);
    const node = projected(document, bar);
    expect(node?.tagName).toBe("progress");
    expect(node?.getAttribute("aria-valuenow")).toBe("4");
    bar.indeterminate = true;
    expect(projected(document, bar)?.getAttribute("aria-valuenow")).toBeNull();
  });

  it("marks a disabled checkbox aria-disabled and mirrors checked", () => {
    const box = new Checkbox({
      accessibility: { role: "checkbox", label: "Mute" },
      checked: true,
      disabled: true,
    });
    const { document } = install(box);
    const node = projected(document, box);
    expect(node?.getAttribute("role")).toBe("checkbox");
    expect(node?.getAttribute("aria-label")).toBe("Mute");
    expect(node?.getAttribute("aria-disabled")).toBe("true");
    expect(node?.disabled).toBe(true);
    expect(node?.getAttribute("aria-checked")).toBe("true");
    expect(node?.checked).toBe(true);
    box.checked = false;
    expect(projected(document, box)?.getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("infers roles for the shipped controls when none were authored", () => {
    const root = new Panel();
    const button = new Button();
    const box = new Checkbox();
    const toggle = new Toggle();
    const radio = new RadioButton({ group: "g" });
    const slider = new Slider();
    const bar = new ProgressIndicator();
    root.add(button, box, toggle, radio, slider, bar);
    const { document } = install(root);
    expect(projected(document, button)?.getAttribute("role")).toBe("button");
    expect(projected(document, box)?.getAttribute("role")).toBe("checkbox");
    expect(projected(document, toggle)?.getAttribute("role")).toBe("switch");
    expect(projected(document, radio)?.getAttribute("role")).toBe("radio");
    expect(projected(document, slider)?.getAttribute("role")).toBe("slider");
    expect(projected(document, bar)?.getAttribute("role")).toBe("progressbar");
  });

  it("skips an unlabelled, unfocusable panel", () => {
    const panel = new Panel();
    const { mirror } = install(panel);
    expect(mirror.elementFor(panel)).toBeUndefined();
  });

  it("includes a labelled panel even when it is not focusable", () => {
    const panel = new Panel({ label: "Settings", role: "group" });
    const { document } = install(panel);
    const node = projected(document, panel);
    expect(node?.tagName).toBe("div");
    expect(node?.getAttribute("role")).toBe("group");
    expect(node?.getAttribute("aria-label")).toBe("Settings");
  });

  it("writes aria-description from the accessibility record", () => {
    const button = new Button({
      accessibility: {
        role: "button",
        label: "Start",
        description: "Begins the motor simulation",
      },
    });
    const { document } = install(button);
    expect(projected(document, button)?.getAttribute("aria-description")).toBe(
      "Begins the motor simulation",
    );
  });

  it("dispose removes the container and every projected node", () => {
    const button = new Button({ label: "Go", role: "button" });
    const { document, mirror } = install(button);
    expect(document.body.children).toHaveLength(1);
    expect(projected(document, button)).not.toBeNull();
    mirror.dispose();
    expect(document.body.children).toHaveLength(0);
    expect(projected(document, button)).toBeNull();
    expect(document.getElementById("four-a11y-mirror")).toBeNull();
    mirror.dispose(); // idempotent
  });

  it("drops a widget from the tree when it is disposed", () => {
    const button = new Button({ label: "Go", role: "button" });
    const { document } = install(button);
    expect(projected(document, button)).not.toBeNull();
    button.dispose();
    expect(projected(document, button)).toBeNull();
  });

  it("syncAll picks up a widget added after install", () => {
    const root = new Panel();
    const first = new Button({ label: "A", role: "button" });
    root.add(first);
    const { document, mirror } = install(root);
    const second = new Button({ label: "B", role: "button" });
    root.add(second);
    expect(projected(document, second)).toBeNull();
    mirror.syncAll();
    expect(projected(document, second)?.getAttribute("aria-label")).toBe("B");
  });

  it("prunes an invisible or enabled=false subtree", () => {
    const root = new Panel();
    const hidden = new Panel({ visible: false });
    const hiddenButton = new Button({ label: "Hidden", role: "button" });
    hidden.add(hiddenButton);
    const off = new Panel({ enabled: false });
    const offButton = new Button({ label: "Off", role: "button" });
    off.add(offButton);
    const live = new Button({ label: "Live", role: "button" });
    root.add(hidden, off, live);
    const { document } = install(root);
    expect(projected(document, hiddenButton)).toBeNull();
    expect(projected(document, offButton)).toBeNull();
    expect(projected(document, live)?.getAttribute("aria-label")).toBe("Live");
  });

  it("accepts a forest of roots", () => {
    const a = new Button({ label: "A", role: "button" });
    const b = new Button({ label: "B", role: "button" });
    const { document } = install([a, b]);
    expect(projected(document, a)?.getAttribute("aria-label")).toBe("A");
    expect(projected(document, b)?.getAttribute("aria-label")).toBe("B");
  });

  it("writes data-high-contrast when asked, and font-size from fontScale", () => {
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button, { highContrast: true, fontScale: 1.5 });
    const root = mirror.root as FakeElement;
    expect(root.getAttribute("data-high-contrast")).toBe("true");
    expect(root.style.fontSize).toBe("1.5em");
    expect(root.style.clip).toBe("rect(0, 0, 0, 0)");
    expect(root.style.position).toBe("absolute");
    expect(root.getAttribute("aria-hidden")).toBeNull();
    expect(mirror.highContrast).toBe(true);
    expect(mirror.fontScale).toBe(1.5);
  });

  it("consults matchMedia('(prefers-contrast: more)') when highContrast is omitted", () => {
    const document = new FakeDocument();
    document.matchMediaResult = { matches: true };
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button, { document });
    expect(mirror.highContrast).toBe(true);
    expect(
      (mirror.root as FakeElement).getAttribute("data-high-contrast"),
    ).toBe("true");
  });

  it("consults defaultView.matchMedia when the document has no matchMedia of its own", () => {
    const document = new FakeDocument();
    document.defaultView = {
      matchMedia: (query: string) => ({
        matches: query === "(prefers-contrast: more)",
      }),
    };
    // Hide the document-level method so the installer has to go through defaultView.
    (document as { matchMedia?: unknown }).matchMedia = undefined;
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button, { document });
    expect(mirror.highContrast).toBe(true);
  });

  it("does not set high contrast when the option is explicitly false", () => {
    const document = new FakeDocument();
    document.matchMediaResult = { matches: true };
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button, { document, highContrast: false });
    expect(mirror.highContrast).toBe(false);
    expect(
      (mirror.root as FakeElement).getAttribute("data-high-contrast"),
    ).toBeNull();
  });

  it("accepts reducedMotion and exposes prefersReducedMotion while installed", () => {
    expect(prefersReducedMotion()).toBe(false);
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button, { reducedMotion: true });
    expect(mirror.reducedMotion).toBe(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(
      (mirror.root as FakeElement).getAttribute("data-reduced-motion"),
    ).toBe("true");
    mirror.dispose();
    expect(prefersReducedMotion()).toBe(false);
  });

  it("pushes a later label / role write", () => {
    const widget = new TestWidget({ focusable: true });
    const { document } = install(widget);
    widget.label = "OK";
    widget.role = "button";
    const node = projected(document, widget);
    expect(node?.getAttribute("aria-label")).toBe("OK");
    expect(node?.getAttribute("role")).toBe("button");
  });

  it("uses globalThis.document when options.document is omitted", () => {
    const fake = new FakeDocument();
    const host = globalThis as { document?: DocumentLike };
    const previous = host.document;
    host.document = fake;
    try {
      const button = new Button({ label: "Go", role: "button" });
      const mirror = installAccessibilityMirror(button);
      installed.push(mirror);
      expect(fake.body.children).toHaveLength(1);
      expect(projected(fake, button)?.getAttribute("aria-label")).toBe("Go");
    } finally {
      if (previous === undefined) {
        delete host.document;
      } else {
        host.document = previous;
      }
    }
  });

  it("throws when no DocumentLike is available", () => {
    const host = globalThis as { document?: DocumentLike };
    const previous = host.document;
    delete host.document;
    try {
      expect(() =>
        installAccessibilityMirror(new Button({ label: "Go" })),
      ).toThrow(/DocumentLike/);
    } finally {
      if (previous !== undefined) host.document = previous;
    }
  });

  it("does not put aria-hidden on the container", () => {
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button);
    expect((mirror.root as FakeElement).getAttribute("aria-hidden")).toBeNull();
    expect((mirror.root as FakeElement).getAttribute("data-four-a11y")).toBe(
      "mirror",
    );
  });

  it("falls back to parentNode.removeChild when Element.remove is missing", () => {
    const document = new FakeDocument();
    const button = new Button({ label: "Go", role: "button" });
    const mirror = installAccessibilityMirror(button, { document });
    const root = mirror.root as FakeElement;
    // Simulate a DocumentLike that only implements removeChild.
    (root as { remove?: unknown }).remove = undefined;
    mirror.dispose();
    expect(document.body.children).toHaveLength(0);
  });

  it("sync is a no-op after dispose", () => {
    const button = new Button({ label: "Go", role: "button" });
    const { document, mirror } = install(button);
    mirror.dispose();
    button.label = "Stop";
    expect(projected(document, button)).toBeNull();
    mirror.sync(button);
    mirror.syncAll();
    expect(document.body.children).toHaveLength(0);
  });

  it("drops a widget that loses its label and is not focusable", () => {
    const panel = new Panel({ label: "Tools", role: "group" });
    const { document } = install(panel);
    expect(projected(document, panel)).not.toBeNull();
    panel.label = undefined;
    panel.role = undefined;
    expect(projected(document, panel)).toBeNull();
  });

  it("infers a control role when the authored role is empty", () => {
    const button = new Button({ role: "" });
    const { document } = install(button);
    expect(projected(document, button)?.getAttribute("role")).toBe("button");
  });

  it("treats an empty label as unlabelled", () => {
    const widget = new TestWidget({ label: "", focusable: true });
    const { document } = install(widget);
    expect(projected(document, widget)?.getAttribute("aria-label")).toBeNull();
  });

  it("tolerates a document with no body", () => {
    const document = new FakeDocument();
    (document as { body: FakeElement | null }).body = null;
    const button = new Button({ label: "Go", role: "button" });
    const mirror = installAccessibilityMirror(button, { document });
    installed.push(mirror);
    expect(projected(document, button)?.getAttribute("aria-label")).toBe("Go");
    mirror.dispose();
  });

  it("projects a labelled generic widget as a div without a role", () => {
    const widget = new TestWidget({ label: "Nameless" });
    const { document } = install(widget);
    const node = projected(document, widget);
    expect(node?.tagName).toBe("div");
    expect(node?.getAttribute("role")).toBeNull();
    expect(node?.getAttribute("aria-label")).toBe("Nameless");
    expect(node?.tabIndex).toBe(-1);
  });

  it("drops a widget whose ancestor is disabled or hidden", () => {
    const root = new Panel();
    const button = new Button({ label: "Go", role: "button" });
    root.add(button);
    const { document } = install(root);
    expect(projected(document, button)).not.toBeNull();
    root.enabled = false;
    button.disabled = true;
    expect(projected(document, button)).toBeNull();
  });

  it("treats a document with no matchMedia as not high-contrast", () => {
    const document = new FakeDocument();
    (document as { matchMedia?: unknown }).matchMedia = undefined;
    document.defaultView = null;
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button, { document });
    expect(mirror.highContrast).toBe(false);
  });

  it("creates a style object when the host element has none", () => {
    const document = new FakeDocument();
    const original = document.createElement.bind(document);
    document.createElement = (tagName: string) => {
      const element = original(tagName);
      (element as { style?: unknown }).style = undefined;
      return element;
    };
    const button = new Button({ label: "Go", role: "button" });
    const { mirror } = install(button, { document, fontScale: 2 });
    expect(mirror.root.style?.fontSize).toBe("2em");
    expect(mirror.root.style?.clip).toBe("rect(0, 0, 0, 0)");
  });

  it("replacing accessibility pushes the new record", () => {
    const button = new Button({ label: "Go", role: "button" });
    const { document } = install(button);
    button.accessibility = {
      role: "button",
      label: "Stop",
      description: "Halts the motor",
      tabIndex: -1,
    };
    const node = projected(document, button);
    expect(node?.getAttribute("aria-label")).toBe("Stop");
    expect(node?.getAttribute("aria-description")).toBe("Halts the motor");
    expect(node?.tabIndex).toBe(-1);
  });
});
