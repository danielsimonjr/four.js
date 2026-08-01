/**
 * `Group` (§6, §104) — a concrete {@link Node} with no behavior of its own.
 *
 * It exists because `Node` is abstract (plan D1): a group is the plain
 * container used to give a subtree a shared transform and a name, and adding
 * anything else to it would defeat the point of keeping the base node
 * lightweight (§6).
 */

import { Node } from "./node.js";

export class Group extends Node {}
