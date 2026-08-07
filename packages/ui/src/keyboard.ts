/**
 * §75's keyboard navigation: Tab traversal over a widget tree (2026-08-07,
 * A-13).
 *
 * ```ts
 * const keyboard = new KeyboardInput(window, { focusTarget: keyboardFocusTarget(uiRoot) });
 * const stopTraversal = installKeyboardTraversal(uiRoot);
 * // Tab / Shift-Tab now walk the focus; Enter and Space activate a focused
 * // Button (that half lives in `Button`, next to the click it mirrors).
 * ```
 *
 * This module is the half of §75's "keyboard navigation, focus order" that was
 * staged from 2026-08-02 until `@four/input` gained a key source. The staging
 * note named exactly one blocker — "§72 lists keyboard events and @four/input
 * implements none — it has no key source at all" — and A-10 removed it. Nothing
 * else about the design changed: focus was always this package's (`focus()`,
 * `blur()`, one owner per scene root), and `Button.activate()` was always
 * public "precisely so a keyboard layer can drive it".
 *
 * ## Why traversal is a function, not a widget method
 *
 * Tab is a property of a *tree*, not of a widget: it needs the ordered set of
 * everything focusable under a root, which no single widget knows. Making it a
 * free function over a root also keeps it opt-in — an application embedding a
 * UI panel inside a game that binds Tab to something else installs nothing and
 * loses nothing — and keeps `UIWidget` free of a listener that every widget
 * would pay for and one would use.
 *
 * ## Why the two halves live apart
 *
 * Tab belongs to the tree; Enter and Space belong to the control (`Button`
 * implements them, beside the `click` they mirror). That split is the DOM's,
 * for the DOM's reason: the platform owns focus movement, and each control owns
 * what activating it means. A toggle or a slider — §73 controls this MVP stages
 * — will read its own keys the same way, with nothing to add here.
 *
 * ## Dependency direction (plan §3.1)
 *
 * `ui` depends on `input`; `input` never depends on `ui`. So `KeyboardInput`
 * cannot look up the focused widget, and this module supplies the answer
 * instead: {@link keyboardFocusTarget} is the resolver to hand it. The seam is
 * one function type, which is why the frozen matrix needed no amendment.
 */

import type { Unsubscribe } from "@four/core";
import type { SceneKeyEvent } from "@four/input";
import type { Node } from "@four/scene";

import { UIWidget, focusedWidget } from "./widget.js";

/**
 * The `tabIndex` of a widget that declares none — the DOM's default, and the
 * value every widget sorts at unless it opts into an order.
 */
const DEFAULT_TAB_INDEX = 0;

/** `widget`'s declared traversal order, or {@link DEFAULT_TAB_INDEX}. */
function tabIndexOf(widget: UIWidget): number {
  return widget.accessibility?.tabIndex ?? DEFAULT_TAB_INDEX;
}

/** Ascending `tabIndex`; `Array.prototype.sort` is stable, so ties keep scene order. */
function byTabIndex(a: UIWidget, b: UIWidget): number {
  return tabIndexOf(a) - tabIndexOf(b);
}

/**
 * Whether Tab visits `widget`: it must be focusable, interactable, and not have
 * opted out with a negative `tabIndex`.
 *
 * `interactive` is deliberately **not** consulted. It governs whether *pointers*
 * reach a widget (it is what drops one from `collectPickables`), and a control
 * that is unreachable by mouse is precisely the one a keyboard user still needs
 * — the DOM makes the same distinction between `pointer-events: none` and
 * `tabindex="-1"`.
 */
function isTabbable(widget: UIWidget): boolean {
  return (
    widget.focusable &&
    widget.enabled &&
    !widget.disabled &&
    !widget.disposed &&
    tabIndexOf(widget) >= 0
  );
}

/**
 * Collects the widgets Tab visits under `root`, **in traversal order**, into
 * `out`, and returns it.
 *
 * The walk is `collectPickables`' walk, and prunes the same way: a subtree is
 * skipped entirely at any node that is `visible = false` or `enabled = false`,
 * so a hidden panel's buttons are not tabbable and a plain `Group` hides its UI
 * descendants too. A surviving widget joins the order when it is focusable,
 * enabled, not disabled, not disposed, and has not opted out with a negative
 * `tabIndex`.
 *
 * ## The order, and where it departs from the DOM (decision, A-13)
 *
 * Ascending `accessibility.tabIndex` (absent = `0`), ties broken by **scene
 * order** — which is what the stability of `Array.prototype.sort` gives, at no
 * extra cost. Negative values are excluded from the traversal but stay
 * focusable programmatically.
 *
 * The DOM instead visits *positive* `tabindex` values first, before everything
 * at `0`, and every accessibility guide since has told authors never to use a
 * positive value because of it. That rule exists because HTML's `tabindex` must
 * interleave with an implicit document order the attribute cannot see. Here the
 * traversal order **is** the widget tree's own, the numbers are the only
 * ordering an author can state, and a plain ascending sort is what
 * `tabIndex: 0, 1, 2` on three buttons plainly means. Stating the deviation is
 * cheaper than importing a rule whose own designers regret it.
 *
 * Zero-alloc when `out` is supplied: it is overwritten, truncated, and sorted
 * in place.
 */
export function collectFocusOrder(
  root: Node,
  out: UIWidget[] = [],
): UIWidget[] {
  const count = collectInto(root, out, 0);
  out.length = count;
  out.sort(byTabIndex);
  return out;
}

/** Depth-first fill of {@link collectFocusOrder}; returns the next free index. */
function collectInto(node: Node, out: UIWidget[], start: number): number {
  if (!node.visible || !node.enabled) {
    return start;
  }
  let count = start;
  if (node instanceof UIWidget && isTabbable(node)) {
    out[count] = node;
    count += 1;
  }
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    count = collectInto(children[i], out, count);
  }
  return count;
}

/**
 * The focus resolver to hand `KeyboardInput` for the tree rooted at `root`
 * (`new KeyboardInput(window, { focusTarget: keyboardFocusTarget(uiRoot) })`).
 *
 * It answers the focused widget of `root`'s tree, and **`root` itself when
 * nothing is focused** — which is the whole reason this helper exists rather
 * than `() => focusedWidget(root)`. A key event with no target is not
 * dispatched at all, so the plain version would make the very first Tab
 * unreachable: nothing is focused, so nothing receives the keystroke that would
 * focus something. Falling back to the root means the traversal listener
 * installed there still hears it, and every later keystroke goes to the focused
 * widget and bubbles up through the root as usual.
 */
export function keyboardFocusTarget(root: Node): () => Node | null {
  return () => focusedWidget(root) ?? root;
}

/** Options for {@link installKeyboardTraversal}. */
export interface KeyboardTraversalOptions {
  /**
   * Whether Tab past the last widget wraps to the first (and Shift-Tab past the
   * first wraps to the last). `true` by default.
   *
   * With `false`, the traversal instead **blurs** at each end and lets the
   * keystroke through with its platform default intact, so the focus leaves the
   * widget tree the way it would leave any other component of the host page.
   * That is the right default for a UI panel embedded in a larger document, and
   * the wrong one for a full-screen application, which is why it is a choice.
   */
  wrap?: boolean;
}

/**
 * Installs §75's Tab traversal on `root`, and returns the unsubscriber.
 *
 * Listens for `keydown` on `root` — the bubble phase, so it hears both the
 * keystrokes delivered to a focused descendant and the ones delivered to `root`
 * itself when nothing is focused (see {@link keyboardFocusTarget}). Tab moves
 * the focus forward, Shift-Tab backward, and both call
 * `SceneKeyEvent.preventDefault()` on the way out so the host's own focus ring
 * does not move at the same time.
 *
 * Everything else is ignored and left to propagate: this listener claims Tab
 * and nothing else. Auto-repeat is honoured (holding Tab keeps walking, as
 * everywhere else); a Tab chorded with Alt, Control, or Meta is not ours and is
 * passed through untouched.
 *
 * Nothing here writes a transform, and nothing here activates anything — a
 * focused `Button` reads its own Enter and Space.
 */
export function installKeyboardTraversal(
  root: Node,
  options: KeyboardTraversalOptions = {},
): Unsubscribe {
  const wrap = options.wrap ?? true;
  /** Traversal-order scratch, reused across keystrokes; see `collectFocusOrder`. */
  const order: UIWidget[] = [];

  return root.on("keydown", (event: SceneKeyEvent) => {
    if (event.key !== "Tab") {
      return;
    }
    const modifiers = event.modifiers;
    if (modifiers.alt || modifiers.ctrl || modifiers.meta) {
      return;
    }

    collectFocusOrder(root, order);
    if (order.length === 0) {
      return;
    }

    const backwards = modifiers.shift;
    const current = focusedWidget(root);
    const from = current === null ? -1 : order.indexOf(current);

    // Nothing focused (or the focused widget is not in this order — it may be
    // hidden, disabled, or opted out since it took the focus): enter the tree
    // at the end Tab arrives from.
    if (current === null || from === -1) {
      order[backwards ? order.length - 1 : 0].focus();
      event.preventDefault();
      return;
    }

    const next = from + (backwards ? -1 : 1);
    if (next < 0 || next >= order.length) {
      if (!wrap) {
        // The focus leaves the tree: drop it and let the host have the key.
        current.blur();
        return;
      }
      order[next < 0 ? order.length - 1 : 0].focus();
      event.preventDefault();
      return;
    }

    order[next].focus();
    event.preventDefault();
  });
}
