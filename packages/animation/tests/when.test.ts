import { isFourError } from "@four/core";
import { describe, expect, it } from "vitest";

import {
  compileWhenExpression,
  type WhenParameterLookup,
} from "../src/when.js";

const declared: WhenParameterLookup = {
  hasNumber: (name) => name === "speed",
  hasBoolean: (name) => name === "grounded",
  hasTrigger: (name) => name === "jump",
};

function expectInvalid(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(isFourError(thrown)).toBe(true);
  const error = thrown as { code: string } & Error;
  expect(error.code).toBe("INVALID_APPLICATION_STATE");
  return error;
}

describe("compileWhenExpression", () => {
  it("compiles a bare Boolean to a true test", () => {
    expect(compileWhenExpression("grounded", declared, { index: 0 })).toEqual({
      parameter: "grounded",
      is: "true",
    });
  });

  it("compiles a bare trigger to a latch test", () => {
    expect(compileWhenExpression("jump", declared, { index: 0 })).toEqual({
      parameter: "jump",
      is: "triggered",
    });
  });

  it("compiles numeric comparisons including scientific literals", () => {
    expect(
      compileWhenExpression("speed > 0.1", declared, { index: 0 }),
    ).toEqual({
      parameter: "speed",
      is: "greater",
      value: 0.1,
    });
    expect(compileWhenExpression("speed >= 5", declared, { index: 0 })).toEqual(
      {
        parameter: "speed",
        is: "greaterOrEqual",
        value: 5,
      },
    );
    expect(
      compileWhenExpression("speed < 1e-2", declared, { index: 0 }),
    ).toEqual({
      parameter: "speed",
      is: "less",
      value: 0.01,
    });
    expect(
      compileWhenExpression("speed <= -3", declared, { index: 0 }),
    ).toEqual({
      parameter: "speed",
      is: "lessOrEqual",
      value: -3,
    });
    expect(compileWhenExpression("speed == 2", declared, { index: 0 })).toEqual(
      {
        parameter: "speed",
        is: "equal",
        value: 2,
      },
    );
    expect(
      compileWhenExpression("speed !== 2", declared, { index: 0 }),
    ).toEqual({
      parameter: "speed",
      is: "notEqual",
      value: 2,
    });
  });

  it("compiles Boolean equality and inequality", () => {
    expect(
      compileWhenExpression("grounded == true", declared, { index: 0 }),
    ).toEqual({
      parameter: "grounded",
      is: "true",
    });
    expect(
      compileWhenExpression("grounded != true", declared, { index: 0 }),
    ).toEqual({
      parameter: "grounded",
      is: "false",
    });
    expect(
      compileWhenExpression("grounded === false", declared, { index: 0 }),
    ).toEqual({
      parameter: "grounded",
      is: "false",
    });
    expect(
      compileWhenExpression("grounded !== false", declared, { index: 0 }),
    ).toEqual({
      parameter: "grounded",
      is: "true",
    });
  });

  it("rejects syntax errors, kind mismatches, and undeclared names", () => {
    expectInvalid(() =>
      compileWhenExpression("speed && 1", declared, { index: 2 }),
    );
    expectInvalid(() => compileWhenExpression("speed", declared, { index: 0 }));
    expectInvalid(() =>
      compileWhenExpression("nope > 1", declared, { index: 0 }),
    );
    expectInvalid(() =>
      compileWhenExpression("speed == true", declared, { index: 0 }),
    );
    expectInvalid(() =>
      compileWhenExpression("grounded > 1", declared, { index: 0 }),
    );
    expectInvalid(() =>
      compileWhenExpression("grounded > true", declared, { index: 0 }),
    );
  });
});
