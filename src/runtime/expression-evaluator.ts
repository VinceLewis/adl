import type {
  ExpressionBinaryOperator,
  ExpressionRuntimeProperty,
  ExpressionUnaryOperator,
  JsonPrimitive,
  JsonValue,
  ResolvedExpression,
} from "../model/resolved-model.js";
import type { RuntimeContext } from "./runtime-types.js";

export type ExpressionValueKind =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "time"
  | "null";

export interface ExpressionValue {
  kind: ExpressionValueKind;
  value: JsonPrimitive;
}

export interface ExpressionEvaluationInput {
  values: Record<string, JsonValue>;
  context: RuntimeContext;
}

export interface ExpressionEvaluationError {
  code:
    | "ADL_EXPRESSION_FIELD_UNSUPPORTED_VALUE"
    | "ADL_EXPRESSION_RUNTIME_REFERENCE_MISSING"
    | "ADL_EXPRESSION_RUNTIME_REFERENCE_UNSUPPORTED"
    | "ADL_EXPRESSION_OPERATOR_UNSUPPORTED"
    | "ADL_EXPRESSION_TYPE_MISMATCH"
    | "ADL_EXPRESSION_DIVIDE_BY_ZERO"
    | "ADL_EXPRESSION_DECIMAL_OVERFLOW"
    | "ADL_EXPRESSION_INVALID_TEMPORAL_VALUE";
  message: string;
  path?: string;
}

export type ExpressionEvaluationResult =
  | { ok: true; value: ExpressionValue }
  | { ok: false; error: ExpressionEvaluationError };

const DECIMAL_SCALE_PLACES = 4;
const DECIMAL_SCALE = 10_000n;
const DECIMAL_MAX_ABS = 9_999_999_999_999_999n;

export const EXPRESSION_DECIMAL_SEMANTICS = {
  scale: DECIMAL_SCALE_PLACES,
  rounding: "halfAwayFromZero",
  maxAbs: "999999999999.9999",
} as const;

export function evaluateExpression(
  expression: ResolvedExpression,
  input: ExpressionEvaluationInput,
): ExpressionEvaluationResult {
  try {
    return evaluate(expression, input, "expression");
  } catch (error) {
    return failure(
      "ADL_EXPRESSION_OPERATOR_UNSUPPORTED",
      error instanceof Error ? error.message : "Expression evaluation failed.",
      "expression",
    );
  }
}

export function evaluateExpressionAsBoolean(
  expression: ResolvedExpression,
  input: ExpressionEvaluationInput,
): ExpressionEvaluationResult {
  const result = evaluateExpression(expression, input);
  if (!result.ok) {
    return result;
  }

  if (result.value.kind !== "boolean") {
    return failure(
      "ADL_EXPRESSION_TYPE_MISMATCH",
      `Expression produced ${result.value.kind}; expected boolean.`,
      "expression",
    );
  }

  return result;
}

function evaluate(
  expression: ResolvedExpression,
  input: ExpressionEvaluationInput,
  path: string,
): ExpressionEvaluationResult {
  switch (expression.kind) {
    case "literal":
      return success(valueFromPrimitive(expression.value, expression.valueType));
    case "field":
      return evaluateField(expression.field, input, path);
    case "runtime":
      return evaluateRuntime(expression.property, input.context, path);
    case "unary":
      return evaluateUnary(expression.operator, expression.operand, input, path);
    case "binary":
      return evaluateBinary(expression.operator, expression.left, expression.right, input, path);
  }
}

function evaluateField(
  field: string,
  input: ExpressionEvaluationInput,
  path: string,
): ExpressionEvaluationResult {
  const value = input.values[field] ?? null;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return success(valueFromPrimitive(value));
  }

  return failure(
    "ADL_EXPRESSION_FIELD_UNSUPPORTED_VALUE",
    `Expression field '${field}' resolved to a non-primitive value.`,
    path,
  );
}

function evaluateRuntime(
  property: ExpressionRuntimeProperty,
  context: RuntimeContext,
  path: string,
): ExpressionEvaluationResult {
  switch (property) {
    case "userId":
      return success({ kind: "text", value: context.userId });
    case "now":
      if (context.now === undefined) {
        return failure(
          "ADL_EXPRESSION_RUNTIME_REFERENCE_MISSING",
          "Expression runtime.now requires RuntimeContext.now.",
          path,
        );
      }
      return success({ kind: "datetime", value: context.now.toISOString() });
  }

  return failure(
    "ADL_EXPRESSION_RUNTIME_REFERENCE_UNSUPPORTED",
    `Unsupported runtime reference '${String(property)}'.`,
    path,
  );
}

function evaluateUnary(
  operator: ExpressionUnaryOperator,
  operandExpression: ResolvedExpression,
  input: ExpressionEvaluationInput,
  path: string,
): ExpressionEvaluationResult {
  const operand = evaluate(operandExpression, input, `${path}.operand`);
  if (!operand.ok) {
    return operand;
  }

  switch (operator) {
    case "not":
      return operand.value.kind === "boolean"
        ? success({ kind: "boolean", value: !operand.value.value })
        : typeFailure("boolean", operand.value.kind, path);
    case "negate": {
      const decimal = decimalFromValue(operand.value, path);
      if (!decimal.ok) {
        return decimal;
      }
      return decimalToResult(-decimal.value, path);
    }
  }
}

function evaluateBinary(
  operator: ExpressionBinaryOperator,
  leftExpression: ResolvedExpression,
  rightExpression: ResolvedExpression,
  input: ExpressionEvaluationInput,
  path: string,
): ExpressionEvaluationResult {
  if (operator === "and") {
    const left = evaluate(leftExpression, input, `${path}.left`);
    if (!left.ok || left.value.kind !== "boolean") {
      return left.ok ? typeFailure("boolean", left.value.kind, `${path}.left`) : left;
    }
    if (left.value.value === false) {
      return success({ kind: "boolean", value: false });
    }
    const right = evaluate(rightExpression, input, `${path}.right`);
    if (!right.ok || right.value.kind !== "boolean") {
      return right.ok ? typeFailure("boolean", right.value.kind, `${path}.right`) : right;
    }
    return success({ kind: "boolean", value: right.value.value });
  }

  if (operator === "or") {
    const left = evaluate(leftExpression, input, `${path}.left`);
    if (!left.ok || left.value.kind !== "boolean") {
      return left.ok ? typeFailure("boolean", left.value.kind, `${path}.left`) : left;
    }
    if (left.value.value === true) {
      return success({ kind: "boolean", value: true });
    }
    const right = evaluate(rightExpression, input, `${path}.right`);
    if (!right.ok || right.value.kind !== "boolean") {
      return right.ok ? typeFailure("boolean", right.value.kind, `${path}.right`) : right;
    }
    return success({ kind: "boolean", value: right.value.value });
  }

  if (operator === "??") {
    const left = evaluate(leftExpression, input, `${path}.left`);
    if (!left.ok) {
      return left;
    }
    return left.value.kind === "null" ? evaluate(rightExpression, input, `${path}.right`) : left;
  }

  const left = evaluate(leftExpression, input, `${path}.left`);
  if (!left.ok) {
    return left;
  }
  const right = evaluate(rightExpression, input, `${path}.right`);
  if (!right.ok) {
    return right;
  }

  switch (operator) {
    case "+":
    case "-":
    case "*":
    case "/":
      return evaluateArithmetic(operator, left.value, right.value, path);
    case "==":
      return success({ kind: "boolean", value: valuesEqual(left.value, right.value) });
    case "!=":
      return success({ kind: "boolean", value: !valuesEqual(left.value, right.value) });
    case "<":
    case "<=":
    case ">":
    case ">=":
      return evaluateComparison(operator, left.value, right.value, path);
    case "in":
      return failure(
        "ADL_EXPRESSION_OPERATOR_UNSUPPORTED",
        // No repository phase number here: this message is part of the
        // cross-runtime contract, and a second runtime has no phases.
        "Expression operator 'in' is reserved and not yet supported; it requires list-valued operands.",
        path,
      );
  }
}

function evaluateArithmetic(
  operator: "+" | "-" | "*" | "/",
  left: ExpressionValue,
  right: ExpressionValue,
  path: string,
): ExpressionEvaluationResult {
  const leftDecimal = decimalFromValue(left, `${path}.left`);
  if (!leftDecimal.ok) {
    return leftDecimal;
  }
  const rightDecimal = decimalFromValue(right, `${path}.right`);
  if (!rightDecimal.ok) {
    return rightDecimal;
  }

  switch (operator) {
    case "+":
      return decimalToResult(leftDecimal.value + rightDecimal.value, path);
    case "-":
      return decimalToResult(leftDecimal.value - rightDecimal.value, path);
    case "*":
      return decimalToResult(
        roundScaled(leftDecimal.value * rightDecimal.value, DECIMAL_SCALE),
        path,
      );
    case "/":
      if (rightDecimal.value === 0n) {
        return failure("ADL_EXPRESSION_DIVIDE_BY_ZERO", "Expression division by zero.", path);
      }
      return decimalToResult(
        roundScaled(leftDecimal.value * DECIMAL_SCALE, rightDecimal.value),
        path,
      );
  }
}

function evaluateComparison(
  operator: "<" | "<=" | ">" | ">=",
  left: ExpressionValue,
  right: ExpressionValue,
  path: string,
): ExpressionEvaluationResult {
  if (left.kind === "null" || right.kind === "null") {
    return success({ kind: "boolean", value: false });
  }

  const compared = compareValues(left, right, path);
  if (!compared.ok) {
    return compared;
  }

  switch (operator) {
    case "<":
      return success({ kind: "boolean", value: compared.value < 0 });
    case "<=":
      return success({ kind: "boolean", value: compared.value <= 0 });
    case ">":
      return success({ kind: "boolean", value: compared.value > 0 });
    case ">=":
      return success({ kind: "boolean", value: compared.value >= 0 });
  }
}

function compareValues(
  left: ExpressionValue,
  right: ExpressionValue,
  path: string,
): { ok: true; value: number } | { ok: false; error: ExpressionEvaluationError } {
  if (left.kind === "number" && right.kind === "number") {
    const leftDecimal = decimalFromValue(left, `${path}.left`);
    if (!leftDecimal.ok) {
      return leftDecimal;
    }
    const rightDecimal = decimalFromValue(right, `${path}.right`);
    if (!rightDecimal.ok) {
      return rightDecimal;
    }
    return {
      ok: true,
      value:
        leftDecimal.value < rightDecimal.value
          ? -1
          : leftDecimal.value > rightDecimal.value
            ? 1
            : 0,
    };
  }

  if (
    left.kind === right.kind &&
    typeof left.value === "string" &&
    typeof right.value === "string"
  ) {
    if (left.kind === "date" || left.kind === "datetime" || left.kind === "time") {
      const leftTemporal = temporalSortValue(left, path);
      if (!leftTemporal.ok) {
        return leftTemporal;
      }
      const rightTemporal = temporalSortValue(right, path);
      if (!rightTemporal.ok) {
        return rightTemporal;
      }
      return {
        ok: true,
        value:
          leftTemporal.value < rightTemporal.value
            ? -1
            : leftTemporal.value > rightTemporal.value
              ? 1
              : 0,
      };
    }

    return { ok: true, value: left.value.localeCompare(right.value) };
  }

  if (isTemporalKind(left.kind) && right.kind === "text" && typeof right.value === "string") {
    return compareValues(left, { kind: left.kind, value: right.value }, path);
  }

  if (left.kind === "text" && isTemporalKind(right.kind) && typeof left.value === "string") {
    return compareValues({ kind: right.kind, value: left.value }, right, path);
  }

  return {
    ok: false,
    error: {
      code: "ADL_EXPRESSION_TYPE_MISMATCH",
      message: `Cannot compare ${left.kind} with ${right.kind}.`,
      path,
    },
  };
}

function isTemporalKind(kind: ExpressionValueKind): kind is "date" | "datetime" | "time" {
  return kind === "date" || kind === "datetime" || kind === "time";
}

function temporalSortValue(
  value: ExpressionValue,
  path: string,
): { ok: true; value: string | number } | { ok: false; error: ExpressionEvaluationError } {
  if (typeof value.value !== "string") {
    return {
      ok: false,
      error: {
        code: "ADL_EXPRESSION_INVALID_TEMPORAL_VALUE",
        message: `${value.kind} expression value must be text.`,
        path,
      },
    };
  }

  switch (value.kind) {
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(value.value)
        ? { ok: true, value: value.value }
        : invalidTemporal(value.kind, path);
    case "time": {
      // Normalised to milliseconds-of-day rather than compared as raw text.
      // Comparing the accepted spellings lexicographically made `09:00` sort
      // before `09:00:00`, which are the same time of day — and `datetime` is
      // already normalised through `Date.parse`, so `time` was the one temporal
      // kind compared by how it was written rather than by what it denotes.
      const parts = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{3}))?)?$/.exec(value.value);
      if (parts === null) {
        return invalidTemporal(value.kind, path);
      }
      const hours = Number(parts[1]);
      const minutes = Number(parts[2]);
      const seconds = Number(parts[3] ?? "0");
      const milliseconds = Number(parts[4] ?? "0");
      if (hours > 23 || minutes > 59 || seconds > 59) {
        return invalidTemporal(value.kind, path);
      }
      return {
        ok: true,
        value: ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds,
      };
    }
    case "datetime": {
      const timestamp = Date.parse(value.value);
      return Number.isNaN(timestamp)
        ? invalidTemporal(value.kind, path)
        : { ok: true, value: timestamp };
    }
    default:
      return invalidTemporal(value.kind, path);
  }
}

function invalidTemporal(
  kind: ExpressionValueKind,
  path: string,
): { ok: false; error: ExpressionEvaluationError } {
  return {
    ok: false,
    error: {
      code: "ADL_EXPRESSION_INVALID_TEMPORAL_VALUE",
      message: `Invalid ${kind} expression value.`,
      path,
    },
  };
}

function valuesEqual(left: ExpressionValue, right: ExpressionValue): boolean {
  if (left.kind === "null" || right.kind === "null") {
    return left.kind === right.kind;
  }

  if (left.kind === "number" && right.kind === "number") {
    const leftDecimal = decimalFromValue(left, "expression.left");
    const rightDecimal = decimalFromValue(right, "expression.right");
    return leftDecimal.ok && rightDecimal.ok && leftDecimal.value === rightDecimal.value;
  }

  return left.kind === right.kind && left.value === right.value;
}

function valueFromPrimitive(value: JsonPrimitive, explicitKind?: string): ExpressionValue {
  if (value === null) {
    return { kind: "null", value: null };
  }

  if (explicitKind === "date" || explicitKind === "datetime" || explicitKind === "time") {
    return { kind: explicitKind, value };
  }

  switch (typeof value) {
    case "string":
      return { kind: "text", value };
    case "number":
      return { kind: "number", value };
    case "boolean":
      return { kind: "boolean", value };
  }
}

function decimalFromValue(
  value: ExpressionValue,
  path: string,
): { ok: true; value: bigint } | { ok: false; error: ExpressionEvaluationError } {
  if (value.kind !== "number" || typeof value.value !== "number" || !Number.isFinite(value.value)) {
    return {
      ok: false,
      error: {
        code: "ADL_EXPRESSION_TYPE_MISMATCH",
        message: `Expected number expression value; received ${value.kind}.`,
        path,
      },
    };
  }

  const parsed = decimalFromNumber(value.value);
  if (parsed === undefined) {
    return {
      ok: false,
      error: {
        code: "ADL_EXPRESSION_DECIMAL_OVERFLOW",
        message: "Expression decimal value exceeds supported precision.",
        path,
      },
    };
  }

  return { ok: true, value: parsed };
}

function decimalFromNumber(value: number): bigint | undefined {
  // `toFixed` rather than `toString`, because JavaScript switches to exponential
  // notation below 1e-6 and at or above 1e21, and neither form matches the
  // decimal pattern below. That made `0.0000001` — a magnitude comfortably
  // inside the supported range — parse as nothing and report itself as a
  // DECIMAL_OVERFLOW, the opposite of what had happened. It also made the whole
  // rule an artifact of one language's number formatting rather than of ADL, so
  // a second runtime would naturally round to zero here and diverge.
  //
  // One extra place is kept so the existing round-half-up on the digit after the
  // scale still sees it; a magnitude below that rounds to zero, as any other
  // value below the scale already does.
  const text = Number.isFinite(value)
    ? value.toFixed(Math.min(DECIMAL_SCALE_PLACES + 1, 100))
    : String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (match === null) {
    return undefined;
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2] ?? "0") * DECIMAL_SCALE;
  const rawFraction = match[3] ?? "";
  const keptFraction = rawFraction.slice(0, DECIMAL_SCALE_PLACES).padEnd(DECIMAL_SCALE_PLACES, "0");
  const nextDigit = Number(rawFraction[DECIMAL_SCALE_PLACES] ?? "0");
  const roundedFraction = BigInt(keptFraction) + (nextDigit >= 5 ? 1n : 0n);
  const scaled = sign * (whole + roundedFraction);

  return scaled > DECIMAL_MAX_ABS || scaled < -DECIMAL_MAX_ABS ? undefined : scaled;
}

function decimalToResult(value: bigint, path: string): ExpressionEvaluationResult {
  if (value > DECIMAL_MAX_ABS || value < -DECIMAL_MAX_ABS) {
    return failure(
      "ADL_EXPRESSION_DECIMAL_OVERFLOW",
      "Expression decimal value exceeds supported precision.",
      path,
    );
  }

  const sign = value < 0n ? -1 : 1;
  const absolute = value < 0n ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = absolute % DECIMAL_SCALE;
  return success({
    kind: "number",
    value: sign * Number(`${whole}.${fraction.toString().padStart(DECIMAL_SCALE_PLACES, "0")}`),
  });
}

function roundScaled(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;
  const rounded = remainder * 2n >= absoluteDenominator ? quotient + 1n : quotient;
  return sign * rounded;
}

function typeFailure(expected: string, actual: string, path: string): ExpressionEvaluationResult {
  return failure(
    "ADL_EXPRESSION_TYPE_MISMATCH",
    `Expected ${expected} expression value; received ${actual}.`,
    path,
  );
}

function success(value: ExpressionValue): ExpressionEvaluationResult {
  return { ok: true, value };
}

function failure(
  code: ExpressionEvaluationError["code"],
  message: string,
  path?: string,
): ExpressionEvaluationResult {
  return { ok: false, error: { code, message, ...(path === undefined ? {} : { path }) } };
}
