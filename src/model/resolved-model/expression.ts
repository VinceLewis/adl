import type { FieldType, JsonPrimitive } from "./shared.js";

export type ExpressionValueType = Exclude<FieldType, "attachment"> | "null";
export type ExpressionRuntimeProperty = "userId" | "now";
export type ExpressionUnaryOperator = "not" | "negate";
export type ExpressionBinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "in"
  | "??";
export type ResolvedExpression =
  | ResolvedLiteralExpression
  | ResolvedFieldExpression
  | ResolvedRuntimeExpression
  | ResolvedUnaryExpression
  | ResolvedBinaryExpression;
export interface ResolvedLiteralExpression {
  kind: "literal";
  value: JsonPrimitive;
  valueType?: ExpressionValueType;
}
export interface ResolvedFieldExpression {
  kind: "field";
  field: string;
}
export interface ResolvedRuntimeExpression {
  kind: "runtime";
  property: ExpressionRuntimeProperty;
}
export interface ResolvedUnaryExpression {
  kind: "unary";
  operator: ExpressionUnaryOperator;
  operand: ResolvedExpression;
}
export interface ResolvedBinaryExpression {
  kind: "binary";
  operator: ExpressionBinaryOperator;
  left: ResolvedExpression;
  right: ResolvedExpression;
}
