import type {
  JsonValue,
  ResolvedPolicyCondition,
  ResolvedPolicyConditionOperand,
} from "../model/resolved-model.js";
import type { RuntimeContext } from "./runtime-types.js";

export interface RuntimeConditionInput {
  values: Record<string, JsonValue>;
  context: RuntimeContext;
}

export function evaluateRuntimeCondition(
  condition: ResolvedPolicyCondition,
  input: RuntimeConditionInput,
): boolean {
  switch (condition.kind) {
    case "equals":
      return jsonValuesEqual(
        resolveConditionOperand(condition.left, input),
        resolveConditionOperand(condition.right, input),
      );
    case "all":
      return condition.conditions.every((nested) => evaluateRuntimeCondition(nested, input));
    case "any":
      return condition.conditions.some((nested) => evaluateRuntimeCondition(nested, input));
    case "not":
      return !evaluateRuntimeCondition(condition.condition, input);
  }
}

function resolveConditionOperand(
  operand: ResolvedPolicyConditionOperand,
  input: RuntimeConditionInput,
): JsonValue | undefined {
  switch (operand.kind) {
    case "field":
      return input.values[operand.field];
    case "runtime":
      switch (operand.property) {
        case "userId":
          return input.context.userId;
      }
      return undefined;
    case "literal":
      return operand.value;
  }
}

function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}
