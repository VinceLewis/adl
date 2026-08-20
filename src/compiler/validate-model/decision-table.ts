import type {
  ResolvedDecisionTable,
  ResolvedDecisionTableRow,
  ResolvedExpression,
  ResolvedField,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic, expressionTypeField, indexByName, reportDuplicateNames } from "./shared.js";
import type { ModelIndexes } from "./shared.js";
import { validateExpression } from "./expression.js";

export function validateDecisionTable(
  table: ResolvedDecisionTable,
  tableIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const tablePath = `decisionTables[${tableIndex}]`;
  const object = indexes.objectsByName.get(table.object)?.item;

  if (table.match !== "first" && table.match !== "single") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.DECISION_TABLE_MATCH_INVALID,
        `Decision table '${table.name}' has invalid match policy '${String(table.match)}'.`,
        `${tablePath}.match`,
      ),
    );
  }

  reportDuplicateNames(
    table.inputs,
    `${tablePath}.inputs`,
    MODEL_VALIDATION_CODES.DECISION_TABLE_INPUT_DUPLICATE,
    diagnostics,
    `Input names must be unique within decision table '${table.name}'.`,
  );
  reportDuplicateNames(
    table.rows,
    `${tablePath}.rows`,
    MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_DUPLICATE,
    diagnostics,
    `Row names must be unique within decision table '${table.name}'.`,
  );

  if (table.defaultOutputs === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.DECISION_TABLE_DEFAULT_MISSING,
        `Decision table '${table.name}' must declare an explicit default output.`,
        `${tablePath}.defaultOutputs`,
      ),
    );
  }

  if (object === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.DECISION_TABLE_OBJECT_UNKNOWN,
        `Decision table '${table.name}' references unknown object '${table.object}'.`,
        `${tablePath}.object`,
      ),
    );
    return;
  }

  const objectFieldsByName = indexByName(object.fields);
  const inputFields: ResolvedField[] = [];

  for (let inputIndex = 0; inputIndex < table.inputs.length; inputIndex += 1) {
    const input = table.inputs[inputIndex];
    if (input === undefined) {
      continue;
    }
    const inputType = validateExpression(
      input.expression,
      `${tablePath}.inputs[${inputIndex}].expression`,
      objectFieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.DECISION_TABLE_INPUT_INVALID,
        field: MODEL_VALIDATION_CODES.DECISION_TABLE_INPUT_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.DECISION_TABLE_INPUT_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.DECISION_TABLE_INPUT_INVALID,
      },
      diagnostics,
    );
    inputFields.push(expressionTypeField(input.name, inputType));
  }

  const inputFieldsByName = indexByName(inputFields);
  const analyzedRows: DecisionTableAnalyzedRow[] = [];

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    if (row === undefined) {
      continue;
    }
    const rowPath = `${tablePath}.rows[${rowIndex}]`;
    const rowType = validateExpression(
      row.condition,
      `${rowPath}.condition`,
      inputFieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_CONDITION_INVALID,
        field: MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_CONDITION_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_CONDITION_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_CONDITION_TYPE,
      },
      diagnostics,
    );
    if (rowType !== "boolean" && rowType !== "unknown") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_CONDITION_TYPE,
          `Decision table '${table.name}' row '${row.name}' condition must resolve to boolean, not ${rowType}.`,
          `${rowPath}.condition`,
        ),
      );
    }

    const analyzed = analyzeDecisionTableRow(row, rowPath, diagnostics);
    analyzedRows.push({ row, rowIndex, rowPath, analysis: analyzed });
  }

  analyzeDecisionTableRows(table, analyzedRows, diagnostics);
}
interface DecisionTableAnalyzedRow {
  row: ResolvedDecisionTableRow;
  rowIndex: number;
  rowPath: string;
  analysis: DecisionTableAnalysis;
}
interface DecisionTableAnalysis {
  analyzable: boolean;
  impossible: boolean;
  constraints: Map<string, DecisionConstraint>;
}
type DecisionConstraint =
  | { kind: "any" }
  | { kind: "never" }
  | {
      kind: "range";
      exact?: string | number | boolean | null;
      min?: number;
      minInclusive?: boolean;
      max?: number;
      maxInclusive?: boolean;
    };
function analyzeDecisionTableRow(
  row: ResolvedDecisionTableRow,
  rowPath: string,
  diagnostics: Diagnostic[],
): DecisionTableAnalysis {
  const analysis = analyzeDecisionExpression(row.condition);
  if (!analysis.analyzable) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_CONDITION_UNANALYZABLE,
        `Decision table row '${row.name}' condition is valid at runtime but outside the compile-time analyzable subset.`,
        `${rowPath}.condition`,
        "warning",
      ),
    );
  }
  if (analysis.impossible) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_UNREACHABLE,
        `Decision table row '${row.name}' cannot match because its condition is contradictory.`,
        `${rowPath}.condition`,
        "warning",
      ),
    );
  }
  return analysis;
}
function analyzeDecisionTableRows(
  table: ResolvedDecisionTable,
  rows: DecisionTableAnalyzedRow[],
  diagnostics: Diagnostic[],
): void {
  const analyzableRows = rows.filter((row) => row.analysis.analyzable && !row.analysis.impossible);

  for (let rowIndex = 0; rowIndex < analyzableRows.length; rowIndex += 1) {
    const row = analyzableRows[rowIndex];
    if (row === undefined) {
      continue;
    }

    for (let previousIndex = 0; previousIndex < rowIndex; previousIndex += 1) {
      const previous = analyzableRows[previousIndex];
      if (previous === undefined) {
        continue;
      }

      if (constraintsOverlap(previous.analysis.constraints, row.analysis.constraints)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_OVERLAP,
            `Decision table '${table.name}' row '${row.row.name}' overlaps earlier row '${previous.row.name}'.`,
            `${row.rowPath}.condition`,
            table.match === "single" ? "error" : "warning",
          ),
        );
      }

      if (constraintsSubsume(previous.analysis.constraints, row.analysis.constraints)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.DECISION_TABLE_ROW_UNREACHABLE,
            `Decision table '${table.name}' row '${row.row.name}' is unreachable because earlier row '${previous.row.name}' matches all of its cases.`,
            `${row.rowPath}.condition`,
            "warning",
          ),
        );
        break;
      }
    }
  }
}
function analyzeDecisionExpression(expression: ResolvedExpression): DecisionTableAnalysis {
  if (expression.kind === "literal") {
    if (expression.value === true) {
      return { analyzable: true, impossible: false, constraints: new Map() };
    }
    if (expression.value === false) {
      return { analyzable: true, impossible: true, constraints: new Map() };
    }
    return { analyzable: false, impossible: false, constraints: new Map() };
  }

  if (expression.kind === "binary" && expression.operator === "and") {
    return mergeDecisionAnalyses(
      analyzeDecisionExpression(expression.left),
      analyzeDecisionExpression(expression.right),
    );
  }

  if (expression.kind === "binary") {
    return analyzeDecisionComparison(expression);
  }

  return { analyzable: false, impossible: false, constraints: new Map() };
}
function analyzeDecisionComparison(
  expression: Extract<ResolvedExpression, { kind: "binary" }>,
): DecisionTableAnalysis {
  if (expression.left.kind === "field" && expression.right.kind === "literal") {
    const constraint = constraintForOperator(expression.operator, expression.right.value, false);
    return constraint === undefined
      ? { analyzable: false, impossible: false, constraints: new Map() }
      : {
          analyzable: true,
          impossible: false,
          constraints: new Map([[expression.left.field, constraint]]),
        };
  }

  if (expression.right.kind === "field" && expression.left.kind === "literal") {
    const constraint = constraintForOperator(expression.operator, expression.left.value, true);
    return constraint === undefined
      ? { analyzable: false, impossible: false, constraints: new Map() }
      : {
          analyzable: true,
          impossible: false,
          constraints: new Map([[expression.right.field, constraint]]),
        };
  }

  return { analyzable: false, impossible: false, constraints: new Map() };
}
function constraintForOperator(
  operator: string,
  literal: string | number | boolean | null,
  reversed: boolean,
): DecisionConstraint | undefined {
  if (operator === "==") {
    return { kind: "range", exact: literal };
  }

  if (typeof literal !== "number") {
    return undefined;
  }

  switch (reverseComparisonOperator(operator, reversed)) {
    case ">":
      return { kind: "range", min: literal, minInclusive: false };
    case ">=":
      return { kind: "range", min: literal, minInclusive: true };
    case "<":
      return { kind: "range", max: literal, maxInclusive: false };
    case "<=":
      return { kind: "range", max: literal, maxInclusive: true };
    default:
      return undefined;
  }
}
function reverseComparisonOperator(operator: string, reversed: boolean): string {
  if (!reversed) {
    return operator;
  }
  switch (operator) {
    case ">":
      return "<";
    case ">=":
      return "<=";
    case "<":
      return ">";
    case "<=":
      return ">=";
    default:
      return operator;
  }
}
function mergeDecisionAnalyses(
  left: DecisionTableAnalysis,
  right: DecisionTableAnalysis,
): DecisionTableAnalysis {
  const constraints = new Map(left.constraints);
  let impossible = left.impossible || right.impossible;

  for (const [field, rightConstraint] of right.constraints) {
    const merged = intersectConstraint(constraints.get(field) ?? { kind: "any" }, rightConstraint);
    constraints.set(field, merged);
    impossible = impossible || merged.kind === "never";
  }

  return {
    analyzable: left.analyzable && right.analyzable,
    impossible,
    constraints,
  };
}
function intersectConstraint(
  left: DecisionConstraint,
  right: DecisionConstraint,
): DecisionConstraint {
  if (left.kind === "never" || right.kind === "never") {
    return { kind: "never" };
  }
  if (left.kind === "any") {
    return right;
  }
  if (right.kind === "any") {
    return left;
  }
  if (left.exact !== undefined && right.exact !== undefined) {
    return left.exact === right.exact ? left : { kind: "never" };
  }
  if (left.exact !== undefined) {
    return exactFitsRange(left.exact, right) ? left : { kind: "never" };
  }
  if (right.exact !== undefined) {
    return exactFitsRange(right.exact, left) ? right : { kind: "never" };
  }

  const min = stricterMin(left, right);
  const max = stricterMax(left, right);
  const merged = rangeConstraint(min, max);
  return rangeIsContradictory(merged) ? { kind: "never" } : merged;
}
function constraintsOverlap(
  left: Map<string, DecisionConstraint>,
  right: Map<string, DecisionConstraint>,
): boolean {
  for (const field of new Set([...left.keys(), ...right.keys()])) {
    if (
      !constraintOverlap(left.get(field) ?? { kind: "any" }, right.get(field) ?? { kind: "any" })
    ) {
      return false;
    }
  }
  return true;
}
function constraintsSubsume(
  possibleSuperset: Map<string, DecisionConstraint>,
  possibleSubset: Map<string, DecisionConstraint>,
): boolean {
  for (const field of new Set([...possibleSuperset.keys(), ...possibleSubset.keys()])) {
    if (
      !constraintSubsumes(
        possibleSuperset.get(field) ?? { kind: "any" },
        possibleSubset.get(field) ?? { kind: "any" },
      )
    ) {
      return false;
    }
  }
  return true;
}
function constraintOverlap(left: DecisionConstraint, right: DecisionConstraint): boolean {
  return intersectConstraint(left, right).kind !== "never";
}
function constraintSubsumes(superset: DecisionConstraint, subset: DecisionConstraint): boolean {
  if (superset.kind === "any" || subset.kind === "never") {
    return true;
  }
  if (superset.kind === "never") {
    return false;
  }
  if (subset.kind === "any") {
    return false;
  }
  if (subset.exact !== undefined) {
    return superset.exact !== undefined
      ? superset.exact === subset.exact
      : exactFitsRange(subset.exact, superset);
  }
  if (superset.exact !== undefined) {
    return false;
  }
  return rangeContainsRange(superset, subset);
}
function exactFitsRange(
  exact: string | number | boolean | null,
  range: DecisionConstraint,
): boolean {
  if (range.kind !== "range") {
    return range.kind === "any";
  }
  if (range.exact !== undefined) {
    return range.exact === exact;
  }
  if (typeof exact !== "number") {
    return range.min === undefined && range.max === undefined;
  }
  if (
    range.min !== undefined &&
    (exact < range.min || (exact === range.min && !range.minInclusive))
  ) {
    return false;
  }
  if (
    range.max !== undefined &&
    (exact > range.max || (exact === range.max && !range.maxInclusive))
  ) {
    return false;
  }
  return true;
}
function rangeContainsRange(superset: DecisionConstraint, subset: DecisionConstraint): boolean {
  if (superset.kind !== "range" || subset.kind !== "range") {
    return false;
  }
  const minOk =
    superset.min === undefined ||
    (subset.min !== undefined &&
      (subset.min > superset.min ||
        (subset.min === superset.min &&
          (Boolean(subset.minInclusive) || !Boolean(superset.minInclusive)))));
  const maxOk =
    superset.max === undefined ||
    (subset.max !== undefined &&
      (subset.max < superset.max ||
        (subset.max === superset.max &&
          (Boolean(subset.maxInclusive) || !Boolean(superset.maxInclusive)))));
  return minOk && maxOk;
}
function rangeConstraint(
  min: { value: number | undefined; inclusive: boolean | undefined },
  max: { value: number | undefined; inclusive: boolean | undefined },
): DecisionConstraint {
  return {
    kind: "range",
    ...(min.value === undefined
      ? {}
      : {
          min: min.value,
          ...(min.inclusive === undefined ? {} : { minInclusive: min.inclusive }),
        }),
    ...(max.value === undefined
      ? {}
      : {
          max: max.value,
          ...(max.inclusive === undefined ? {} : { maxInclusive: max.inclusive }),
        }),
  };
}
function stricterMin(
  left: DecisionConstraint,
  right: DecisionConstraint,
): { value: number | undefined; inclusive: boolean | undefined } {
  const leftMin = left.kind === "range" ? left.min : undefined;
  const rightMin = right.kind === "range" ? right.min : undefined;
  if (leftMin === undefined) {
    return { value: rightMin, inclusive: right.kind === "range" ? right.minInclusive : undefined };
  }
  if (rightMin === undefined) {
    return { value: leftMin, inclusive: left.kind === "range" ? left.minInclusive : undefined };
  }
  if (leftMin > rightMin) {
    return { value: leftMin, inclusive: left.kind === "range" ? left.minInclusive : undefined };
  }
  if (rightMin > leftMin) {
    return { value: rightMin, inclusive: right.kind === "range" ? right.minInclusive : undefined };
  }
  return {
    value: leftMin,
    inclusive:
      Boolean(left.kind === "range" && left.minInclusive) &&
      Boolean(right.kind === "range" && right.minInclusive),
  };
}
function stricterMax(
  left: DecisionConstraint,
  right: DecisionConstraint,
): { value: number | undefined; inclusive: boolean | undefined } {
  const leftMax = left.kind === "range" ? left.max : undefined;
  const rightMax = right.kind === "range" ? right.max : undefined;
  if (leftMax === undefined) {
    return { value: rightMax, inclusive: right.kind === "range" ? right.maxInclusive : undefined };
  }
  if (rightMax === undefined) {
    return { value: leftMax, inclusive: left.kind === "range" ? left.maxInclusive : undefined };
  }
  if (leftMax < rightMax) {
    return { value: leftMax, inclusive: left.kind === "range" ? left.maxInclusive : undefined };
  }
  if (rightMax < leftMax) {
    return { value: rightMax, inclusive: right.kind === "range" ? right.maxInclusive : undefined };
  }
  return {
    value: leftMax,
    inclusive:
      Boolean(left.kind === "range" && left.maxInclusive) &&
      Boolean(right.kind === "range" && right.maxInclusive),
  };
}
function rangeIsContradictory(range: DecisionConstraint): boolean {
  if (range.kind !== "range" || range.min === undefined || range.max === undefined) {
    return false;
  }
  return (
    range.min > range.max ||
    (range.min === range.max && (!range.minInclusive || !range.maxInclusive))
  );
}
