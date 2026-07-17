import type {
  JsonValue,
  ResolvedExpression,
  ResolvedPolicyCondition,
  ResolvedPolicyConditionOperand,
} from "../model/resolved-model.js";
import { evaluateExpressionAsBoolean } from "./expression-evaluator.js";
import type { RuntimeContext } from "./runtime-types.js";

export interface RuntimeConditionInput {
  values: Record<string, JsonValue>;
  context: RuntimeContext;
}

export function evaluateRuntimeCondition(
  condition: ResolvedExpression | ResolvedPolicyCondition,
  input: RuntimeConditionInput,
): boolean {
  const expression = conditionToExpression(condition);
  const result = evaluateExpressionAsBoolean(expression, input);
  return result.ok ? result.value.value === true : false;
}

function conditionToExpression(
  condition: ResolvedExpression | ResolvedPolicyCondition,
): ResolvedExpression {
  switch (condition.kind) {
    case "literal":
    case "field":
    case "runtime":
    case "unary":
    case "binary":
      return condition;
    case "equals":
      return {
        kind: "binary",
        operator: "==",
        left: conditionOperandToExpression(condition.left),
        right: conditionOperandToExpression(condition.right),
      };
    case "all":
      return condition.conditions.reduce<ResolvedExpression>(
        (left, nested) => ({
          kind: "binary",
          operator: "and",
          left,
          right: conditionToExpression(nested),
        }),
        { kind: "literal", value: true },
      );
    case "any":
      return condition.conditions.reduce<ResolvedExpression>(
        (left, nested) => ({
          kind: "binary",
          operator: "or",
          left,
          right: conditionToExpression(nested),
        }),
        { kind: "literal", value: false },
      );
    case "not":
      return {
        kind: "unary",
        operator: "not",
        operand: conditionToExpression(condition.condition),
      };
  }
}

function conditionOperandToExpression(operand: ResolvedPolicyConditionOperand): ResolvedExpression {
  switch (operand.kind) {
    case "field":
      return { kind: "field", field: operand.field };
    case "runtime":
      return { kind: "runtime", property: operand.property };
    case "literal":
      if (
        typeof operand.value === "string" ||
        typeof operand.value === "number" ||
        typeof operand.value === "boolean" ||
        operand.value === null
      ) {
        return { kind: "literal", value: operand.value };
      }
      return { kind: "literal", value: JSON.stringify(operand.value) };
  }
}
