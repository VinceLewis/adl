import type { ResolvedExpression, ResolvedPolicyCondition } from "../../model/resolved-model.js";
import { foldConditions, resolvePolicyConditionOperand } from "./policy.js";
import { cloneJsonValue } from "./command.js";

export function collectExpressionFieldReferences(expression: ResolvedExpression): string[] {
  const references = new Set<string>();
  visitExpressionFields(expression, references);
  return [...references].sort();
}
function visitExpressionFields(expression: ResolvedExpression, references: Set<string>): void {
  switch (expression.kind) {
    case "field":
      references.add(expression.field);
      return;
    case "unary":
      visitExpressionFields(expression.operand, references);
      return;
    case "binary":
      visitExpressionFields(expression.left, references);
      visitExpressionFields(expression.right, references);
      return;
    case "literal":
    case "runtime":
      return;
  }
}
export function resolveExpression(
  input: ResolvedExpression | ResolvedPolicyCondition,
): ResolvedExpression {
  switch (input.kind) {
    case "literal":
      return {
        kind: "literal",
        value: cloneJsonValue(input.value),
        ...(input.valueType === undefined ? {} : { valueType: input.valueType }),
      };
    case "field":
      return {
        kind: "field",
        field: input.field,
      };
    case "runtime":
      return {
        kind: "runtime",
        property: input.property === "userId" ? "userId" : input.property,
      };
    case "unary":
      return {
        kind: "unary",
        operator: input.operator,
        operand: resolveExpression(input.operand),
      };
    case "binary":
      return {
        kind: "binary",
        operator: input.operator,
        left: resolveExpression(input.left),
        right: resolveExpression(input.right),
      };
    case "equals":
      return {
        kind: "binary",
        operator: "==",
        left: resolvePolicyConditionOperand(input.left),
        right: resolvePolicyConditionOperand(input.right),
      };
    case "all":
      return foldConditions(input.conditions, "and", true);
    case "any":
      return foldConditions(input.conditions, "or", false);
    case "not":
      return {
        kind: "unary",
        operator: "not",
        operand: resolveExpression(input.condition),
      };
  }
}
