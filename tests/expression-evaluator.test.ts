import { describe, expect, it } from "vitest";
import {
  EXPRESSION_DECIMAL_SEMANTICS,
  evaluateExpression,
  evaluateExpressionAsBoolean,
} from "../src/index.js";
import type { ResolvedExpression, RuntimeContext } from "../src/index.js";

const context = {
  userId: "user-1",
  roles: [],
  channel: "api",
  now: new Date("2026-07-17T12:30:00.000Z"),
} satisfies RuntimeContext;

describe("expression evaluator", () => {
  it("evaluates comparisons and boolean logic deterministically", () => {
    const expression: ResolvedExpression = {
      kind: "binary",
      operator: "and",
      left: {
        kind: "binary",
        operator: ">",
        left: { kind: "field", field: "Value" },
        right: { kind: "literal", value: 10000 },
      },
      right: {
        kind: "binary",
        operator: "==",
        left: { kind: "field", field: "Status" },
        right: { kind: "literal", value: "Submitted" },
      },
    };

    expect(
      evaluateExpressionAsBoolean(expression, {
        values: { Value: 10001, Status: "Submitted" },
        context,
      }),
    ).toEqual({ ok: true, value: { kind: "boolean", value: true } });
  });

  it("uses fixed-scale decimal arithmetic and documented rounding", () => {
    expect(EXPRESSION_DECIMAL_SEMANTICS).toEqual({
      scale: 4,
      rounding: "halfAwayFromZero",
      maxAbs: "999999999999.9999",
    });

    const result = evaluateExpression(
      {
        kind: "binary",
        operator: "/",
        left: { kind: "literal", value: 1 },
        right: { kind: "literal", value: 3 },
      },
      { values: {}, context },
    );

    expect(result).toEqual({ ok: true, value: { kind: "number", value: 0.3333 } });
  });

  it("returns structured errors for divide by zero and type mismatches", () => {
    expect(
      evaluateExpression(
        {
          kind: "binary",
          operator: "/",
          left: { kind: "literal", value: 10 },
          right: { kind: "literal", value: 0 },
        },
        { values: {}, context },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ADL_EXPRESSION_DIVIDE_BY_ZERO" },
    });

    expect(
      evaluateExpressionAsBoolean(
        { kind: "literal", value: "not boolean" },
        { values: {}, context },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ADL_EXPRESSION_TYPE_MISMATCH" },
    });
  });

  it("compares date, time, and runtime.now values without reading hidden clocks", () => {
    expect(
      evaluateExpressionAsBoolean(
        {
          kind: "binary",
          operator: "<",
          left: { kind: "field", field: "StartDate" },
          right: { kind: "literal", value: "2026-07-18", valueType: "date" },
        },
        { values: { StartDate: "2026-07-17" }, context },
      ),
    ).toEqual({ ok: true, value: { kind: "boolean", value: true } });

    expect(
      evaluateExpression(
        { kind: "runtime", property: "now" },
        { values: {}, context: { userId: "user-1", roles: [], channel: "api" } },
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "ADL_EXPRESSION_RUNTIME_REFERENCE_MISSING" },
    });
  });

  it("short-circuits boolean operators", () => {
    const result = evaluateExpressionAsBoolean(
      {
        kind: "binary",
        operator: "and",
        left: { kind: "literal", value: false },
        right: {
          kind: "binary",
          operator: "/",
          left: { kind: "literal", value: 1 },
          right: { kind: "literal", value: 0 },
        },
      },
      { values: {}, context },
    );

    expect(result).toEqual({ ok: true, value: { kind: "boolean", value: false } });
  });
});
