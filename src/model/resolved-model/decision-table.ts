import type { JsonValue } from "./shared.js";
import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";

export type DecisionTableMatchPolicy = "first" | "single";
export interface ResolvedDecisionTable {
  name: string;
  object: string;
  match: DecisionTableMatchPolicy;
  inputs: ResolvedDecisionTableInput[];
  rows: ResolvedDecisionTableRow[];
  defaultOutputs?: Record<string, JsonValue>;
}
export interface ResolvedDecisionTableInput {
  name: string;
  expression: ResolvedExpression;
}
export interface ResolvedDecisionTableRow {
  name: string;
  condition: ResolvedExpression;
  outputs: Record<string, JsonValue>;
}
export interface PartialDecisionTableModel {
  name: string;
  object: string;
  match?: DecisionTableMatchPolicy;
  inputs?: PartialDecisionTableInputModel[];
  rows?: PartialDecisionTableRowModel[];
  defaultOutputs?: Record<string, JsonValue>;
}
export interface PartialDecisionTableInputModel {
  name: string;
  expression: PartialPolicyConditionModel;
}
export interface PartialDecisionTableRowModel {
  name: string;
  condition: PartialPolicyConditionModel;
  outputs?: Record<string, JsonValue>;
}
