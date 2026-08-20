import type {
  ExpressionBinaryOperator,
  ExpressionRuntimeProperty,
  ExpressionUnaryOperator,
  ExpressionValueType,
  ResolvedExpression,
} from "../../model/resolved-model.js";
import type { Diagnostic, ModelValidationCode } from "./codes.js";
import { diagnostic } from "./shared.js";
import type { ExpressionFieldReference, ExpressionStaticType, NamedReference } from "./shared.js";

const EXPRESSION_RUNTIME_PROPERTIES = new Set<ExpressionRuntimeProperty>(["userId", "now"]);
const EXPRESSION_UNARY_OPERATORS = new Set<ExpressionUnaryOperator>(["not", "negate"]);
const EXPRESSION_BINARY_OPERATORS = new Set<ExpressionBinaryOperator>([
  "+",
  "-",
  "*",
  "/",
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "and",
  "or",
  "in",
  "??",
]);
const EXPRESSION_VALUE_TYPES = new Set<ExpressionValueType>([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "time",
  "null",
]);
export function validateExpression(
  expression: ResolvedExpression,
  expressionPath: string,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  codes: {
    invalid: ModelValidationCode;
    field: ModelValidationCode;
    runtime: ModelValidationCode;
    type: ModelValidationCode;
  },
  diagnostics: Diagnostic[],
): ExpressionStaticType {
  switch (expression.kind) {
    case "literal":
      if (expression.valueType !== undefined) {
        if (!EXPRESSION_VALUE_TYPES.has(expression.valueType)) {
          diagnostics.push(
            diagnostic(
              codes.invalid,
              `Expression literal has invalid value type '${String(expression.valueType)}'.`,
              `${expressionPath}.valueType`,
            ),
          );
          return "unknown";
        }

        if (expression.valueType === "null" && expression.value !== null) {
          diagnostics.push(
            diagnostic(
              codes.type,
              "Expression literal valueType 'null' requires a null value.",
              `${expressionPath}.value`,
            ),
          );
          return "unknown";
        }

        if (
          expression.valueType !== "null" &&
          expression.valueType !== "date" &&
          expression.valueType !== "datetime" &&
          expression.valueType !== "time" &&
          !isValueCompatibleWithExpressionType(expression.valueType, expression.value)
        ) {
          diagnostics.push(
            diagnostic(
              codes.type,
              `Expression literal value is not compatible with ${expression.valueType}.`,
              `${expressionPath}.value`,
            ),
          );
          return "unknown";
        }

        return expression.valueType;
      }

      return expression.value === null
        ? "null"
        : typeof expression.value === "string"
          ? "text"
          : typeof expression.value === "number"
            ? "number"
            : "boolean";
    case "field": {
      const field = fieldsByName.get(expression.field)?.item;
      if (field === undefined) {
        diagnostics.push(
          diagnostic(
            codes.field,
            `Expression references unknown field '${expression.field}'.`,
            `${expressionPath}.field`,
          ),
        );
        return "unknown";
      }
      return field.type === "attachment" ? "unknown" : field.type;
    }
    case "runtime":
      if (!EXPRESSION_RUNTIME_PROPERTIES.has(expression.property)) {
        diagnostics.push(
          diagnostic(
            codes.runtime,
            `Expression references unsupported runtime property '${String(expression.property)}'.`,
            `${expressionPath}.property`,
          ),
        );
        return "unknown";
      }
      return expression.property === "now" ? "datetime" : "text";
    case "unary": {
      if (!EXPRESSION_UNARY_OPERATORS.has(expression.operator)) {
        diagnostics.push(
          diagnostic(
            codes.invalid,
            `Expression has invalid unary operator '${String(expression.operator)}'.`,
            `${expressionPath}.operator`,
          ),
        );
        return "unknown";
      }

      const operandType = validateExpression(
        expression.operand,
        `${expressionPath}.operand`,
        fieldsByName,
        codes,
        diagnostics,
      );
      if (expression.operator === "not") {
        requireExpressionType(
          operandType,
          ["boolean"],
          `${expressionPath}.operand`,
          codes,
          diagnostics,
        );
        return "boolean";
      }
      requireExpressionType(
        operandType,
        ["number"],
        `${expressionPath}.operand`,
        codes,
        diagnostics,
      );
      return "number";
    }
    case "binary":
      return validateBinaryExpression(expression, expressionPath, fieldsByName, codes, diagnostics);
  }

  diagnostics.push(
    diagnostic(
      codes.invalid,
      `Expression has invalid kind '${String((expression as { kind?: unknown }).kind)}'.`,
      `${expressionPath}.kind`,
    ),
  );
  return "unknown";
}
function validateBinaryExpression(
  expression: Extract<ResolvedExpression, { kind: "binary" }>,
  expressionPath: string,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  codes: {
    invalid: ModelValidationCode;
    field: ModelValidationCode;
    runtime: ModelValidationCode;
    type: ModelValidationCode;
  },
  diagnostics: Diagnostic[],
): ExpressionStaticType {
  if (!EXPRESSION_BINARY_OPERATORS.has(expression.operator)) {
    diagnostics.push(
      diagnostic(
        codes.invalid,
        `Expression has invalid binary operator '${String(expression.operator)}'.`,
        `${expressionPath}.operator`,
      ),
    );
    return "unknown";
  }

  const leftType = validateExpression(
    expression.left,
    `${expressionPath}.left`,
    fieldsByName,
    codes,
    diagnostics,
  );
  const rightType = validateExpression(
    expression.right,
    `${expressionPath}.right`,
    fieldsByName,
    codes,
    diagnostics,
  );

  switch (expression.operator) {
    case "+":
    case "-":
    case "*":
    case "/":
      requireExpressionType(leftType, ["number"], `${expressionPath}.left`, codes, diagnostics);
      requireExpressionType(rightType, ["number"], `${expressionPath}.right`, codes, diagnostics);
      return "number";
    case "and":
    case "or":
      requireExpressionType(leftType, ["boolean"], `${expressionPath}.left`, codes, diagnostics);
      requireExpressionType(rightType, ["boolean"], `${expressionPath}.right`, codes, diagnostics);
      return "boolean";
    case "==":
    case "!=":
      if (
        leftType !== "unknown" &&
        rightType !== "unknown" &&
        leftType !== "null" &&
        rightType !== "null" &&
        leftType !== rightType
      ) {
        diagnostics.push(
          diagnostic(
            codes.type,
            `Expression compares incompatible types ${leftType} and ${rightType}.`,
            expressionPath,
          ),
        );
      }
      return "boolean";
    case "<":
    case "<=":
    case ">":
    case ">=":
      if (
        !areComparableExpressionTypes(leftType, rightType) &&
        leftType !== "unknown" &&
        rightType !== "unknown"
      ) {
        diagnostics.push(
          diagnostic(
            codes.type,
            `Expression cannot compare ${leftType} with ${rightType}.`,
            expressionPath,
          ),
        );
      }
      return "boolean";
    case "in":
      diagnostics.push(
        diagnostic(
          codes.invalid,
          "Expression operator 'in' is reserved until list expressions are added.",
          `${expressionPath}.operator`,
        ),
      );
      return "boolean";
    case "??":
      return leftType === "null" ? rightType : leftType;
  }
}
function requireExpressionType(
  actual: ExpressionStaticType,
  expected: ExpressionStaticType[],
  path: string,
  codes: { type: ModelValidationCode },
  diagnostics: Diagnostic[],
): void {
  if (actual === "unknown" || expected.includes(actual)) {
    return;
  }

  diagnostics.push(
    diagnostic(
      codes.type,
      `Expression expected ${expected.join(" or ")} but received ${actual}.`,
      path,
    ),
  );
}
function areComparableExpressionTypes(
  left: ExpressionStaticType,
  right: ExpressionStaticType,
): boolean {
  return (
    left === right &&
    (left === "number" ||
      left === "text" ||
      left === "date" ||
      left === "datetime" ||
      left === "time")
  );
}
export function isValueCompatibleWithExpressionType(
  type: ExpressionValueType,
  value: unknown,
): boolean {
  switch (type) {
    case "text":
    case "date":
    case "datetime":
    case "time":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
}
