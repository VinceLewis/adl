import type {
  PartialDecisionTableInputModel,
  PartialDecisionTableModel,
  PartialDecisionTableRowModel,
  ResolvedDecisionTable,
  ResolvedDecisionTableInput,
  ResolvedDecisionTableRow,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";
import { cloneJsonValue } from "./command.js";

export function resolveDecisionTables(input: PartialDecisionTableModel[]): ResolvedDecisionTable[] {
  return input.map(resolveDecisionTable);
}
function resolveDecisionTable(input: PartialDecisionTableModel): ResolvedDecisionTable {
  return {
    name: input.name,
    object: input.object,
    match: input.match ?? "first",
    inputs: (input.inputs ?? []).map(resolveDecisionTableInput),
    rows: (input.rows ?? []).map(resolveDecisionTableRow),
    ...(input.defaultOutputs === undefined
      ? {}
      : { defaultOutputs: cloneJsonValue(input.defaultOutputs) }),
  };
}
function resolveDecisionTableInput(
  input: PartialDecisionTableInputModel,
): ResolvedDecisionTableInput {
  return {
    name: input.name,
    expression: resolveExpression(input.expression),
  };
}
function resolveDecisionTableRow(input: PartialDecisionTableRowModel): ResolvedDecisionTableRow {
  return {
    name: input.name,
    condition: resolveExpression(input.condition),
    outputs: cloneJsonValue(input.outputs ?? {}),
  };
}
