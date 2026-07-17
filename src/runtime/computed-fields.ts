import type {
  JsonPrimitive,
  JsonValue,
  ResolvedComputedField,
  ResolvedObject,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { evaluateExpression } from "./expression-evaluator.js";
import { cloneJson } from "./runtime-types.js";
import type { RuntimeContext } from "./runtime-types.js";

export function applyComputedFieldsToRecord(
  object: ResolvedObject,
  record: StoredObjectRecord,
  context: RuntimeContext,
): StoredObjectRecord {
  if (object.computedFields.length === 0) {
    return cloneJson(record);
  }

  const values = cloneJson(record.values);
  for (const field of getComputedFieldsInEvaluationOrder(object)) {
    values[field.name] = evaluateComputedField(field, values, context);
  }

  return {
    meta: cloneJson(record.meta),
    values,
  };
}

export function stripComputedFieldValues(
  object: ResolvedObject,
  values: Record<string, JsonValue>,
): Record<string, JsonValue> {
  if (object.computedFields.length === 0) {
    return values;
  }

  const computedNames = new Set(object.computedFields.map((field) => field.name));
  return Object.fromEntries(
    Object.entries(values).filter(([fieldName]) => !computedNames.has(fieldName)),
  );
}

function getComputedFieldsInEvaluationOrder(object: ResolvedObject): ResolvedComputedField[] {
  return object.computedFields
    .slice()
    .sort(
      (left, right) =>
        left.evaluationOrder - right.evaluationOrder || left.name.localeCompare(right.name),
    );
}

function evaluateComputedField(
  field: ResolvedComputedField,
  values: Record<string, JsonValue>,
  context: RuntimeContext,
): JsonPrimitive {
  const result = evaluateExpression(field.expression, { values, context });
  return result.ok ? result.value.value : null;
}
