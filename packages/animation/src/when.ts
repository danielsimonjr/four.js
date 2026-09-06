/**
 * Optional `when` string sugar for {@link ./controller.js#AnimationTransition}
 * (PH-9). Compiles a restricted expression into the typed predicate records
 * the controller already evaluates.
 *
 * Grammar (no precedence, no boolean connectives, no calls):
 *
 * ```text
 *   ident
 *   ident  ( '>' | '>=' | '<' | '<=' | '==' | '===' | '!=' | '!==' )  (number | true | false)
 * ```
 *
 * A bare identifier compiles to a Boolean `true` test or a trigger latch,
 * whichever the name is declared as. A comparison against a number compiles
 * to a numeric predicate; a comparison against `true`/`false` compiles to a
 * Boolean predicate (`!=` / `!==` invert). Anything else — an undeclared
 * name, a kind mismatch, or a syntax error — throws at construction.
 */

import { FourError } from "@four/core";

import type { NumericComparison, TransitionCondition } from "./controller.js";

/** How the compiler looks up a name's declared kind. */
export interface WhenParameterLookup {
  hasNumber(name: string): boolean;
  hasBoolean(name: string): boolean;
  hasTrigger(name: string): boolean;
}

const IDENT = "([A-Za-z_][A-Za-z0-9_]*)";
const OPERATOR = "(>=|<=|!==|!=|===|==|>|<)";
const LITERAL = "(true|false|-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)";
const BARE = new RegExp(`^\\s*${IDENT}\\s*$`);
const COMPARE = new RegExp(`^\\s*${IDENT}\\s*${OPERATOR}\\s*${LITERAL}\\s*$`);

const NUMERIC_OPERATORS: Readonly<Record<string, NumericComparison>> = {
  ">": "greater",
  ">=": "greaterOrEqual",
  "<": "less",
  "<=": "lessOrEqual",
  "==": "equal",
  "===": "equal",
  "!=": "notEqual",
  "!==": "notEqual",
};

function invalidWhen(
  message: string,
  context: Record<string, unknown>,
): never {
  throw new FourError("INVALID_APPLICATION_STATE", message, { context });
}

/**
 * Compiles one `when` string into a typed {@link TransitionCondition}.
 *
 * @throws FourError `INVALID_APPLICATION_STATE` — the string does not match
 * the restricted grammar, names an undeclared parameter, or tests a parameter
 * with the wrong kind of predicate.
 */
export function compileWhenExpression(
  source: string,
  declared: WhenParameterLookup,
  context: { index: number },
): TransitionCondition {
  const bare = BARE.exec(source);
  if (bare !== null) {
    const parameter = bare[1];
    if (declared.hasBoolean(parameter)) {
      return { parameter, is: "true" };
    }
    if (declared.hasTrigger(parameter)) {
      return { parameter, is: "triggered" };
    }
    invalidWhen(
      `AnimationController transition ${String(context.index)} when "${source}" names "${parameter}", which is not a declared Boolean or trigger parameter.`,
      { index: context.index, source, parameter },
    );
  }

  const compare = COMPARE.exec(source);
  if (compare === null) {
    invalidWhen(
      `AnimationController transition ${String(context.index)} when "${source}" is not a restricted when-expression (parameter, optional operator, number | true | false).`,
      { index: context.index, source },
    );
  }

  const parameter = compare[1];
  const operator = compare[2];
  const raw = compare[3];
  if (raw === "true" || raw === "false") {
    if (!declared.hasBoolean(parameter)) {
      invalidWhen(
        `AnimationController transition ${String(context.index)} when "${source}" compares "${parameter}" to a Boolean, but it is not a declared Boolean parameter.`,
        { index: context.index, source, parameter },
      );
    }
    const literal = raw === "true";
    const inverted = operator === "!=" || operator === "!==";
    if (
      operator !== "==" &&
      operator !== "===" &&
      operator !== "!=" &&
      operator !== "!=="
    ) {
      invalidWhen(
        `AnimationController transition ${String(context.index)} when "${source}" cannot compare a Boolean with "${operator}".`,
        { index: context.index, source, operator },
      );
    }
    const truth = inverted ? !literal : literal;
    return { parameter, is: truth ? "true" : "false" };
  }

  if (!declared.hasNumber(parameter)) {
    invalidWhen(
      `AnimationController transition ${String(context.index)} when "${source}" compares "${parameter}" to a number, but it is not a declared number parameter.`,
      { index: context.index, source, parameter },
    );
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    invalidWhen(
      `AnimationController transition ${String(context.index)} when "${source}" has a non-finite numeric literal.`,
      { index: context.index, source },
    );
  }
  return {
    parameter,
    is: NUMERIC_OPERATORS[operator],
    value,
  };
}
