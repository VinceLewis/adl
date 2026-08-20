/**
 * The pure part of a matrix: its date column axis, cell keys, and what a cell
 * edit means — the next value in the declared cycle, whether that is a create,
 * update or delete, and the patch it writes.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonPrimitive,
  JsonValue,
  ResolvedPresentationMatrix,
  ResolvedPresentationMatrixEdit,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import { formatPresentationValue } from "./format.js";
import { addUtcDays, parseIsoDate } from "./iso-date.js";
import type {
  BoundPresentationRow,
  RuntimePresentationDiagnostic,
  RuntimePresentationMatrixColumn,
} from "./types.js";

export function buildDateColumns(
  matrix: ResolvedPresentationMatrix,
  diagnostics: RuntimePresentationDiagnostic[] = [],
  path = "presentation.matrix.columnAxis",
  section?: string,
): RuntimePresentationMatrixColumn[] {
  const start = parseIsoDate(matrix.columnAxis.start);
  const end = parseIsoDate(matrix.columnAxis.end);
  if (start === undefined || end === undefined || start.getTime() > end.getTime()) {
    diagnostics.push({
      severity: "error",
      code: "ADL_PRESENTATION_MATRIX_COLUMN_INVALID",
      message: `Matrix '${matrix.name}' has an invalid date column range.`,
      path,
      section,
    });
    return [];
  }

  const columns: RuntimePresentationMatrixColumn[] = [];
  for (
    let current = start;
    current.getTime() <= end.getTime();
    current = addUtcDays(current, matrix.columnAxis.stepDays)
  ) {
    const value = current.toISOString().slice(0, 10);
    columns.push({
      key: value,
      value,
      label:
        matrix.columnAxis.labelFormat === undefined
          ? value
          : formatPresentationValue(value, matrix.columnAxis.labelFormat, diagnostics, {
              path: `${path}.labelFormat`,
              section,
            }),
    });
  }
  return columns;
}

export function matrixCellKey(rowKey: string, columnKey: string): string {
  return `${rowKey}\u0000${columnKey}`;
}

export function primitiveKey(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function nextMatrixCycleValue(
  edit: ResolvedPresentationMatrixEdit,
  currentValue: JsonValue | undefined,
): JsonPrimitive | null {
  const currentIndex = edit.cycle.findIndex((value) => value === currentValue);
  if (currentIndex < 0) {
    return edit.cycle[0] ?? edit.unsetValue ?? null;
  }
  const next = edit.cycle[currentIndex + 1];
  if (next !== undefined) {
    return next;
  }
  return edit.unsetAsAbsence ? null : (edit.unsetValue ?? edit.cycle[0] ?? null);
}

export function matrixEditOperation(
  edit: ResolvedPresentationMatrixEdit,
  cell: BoundPresentationRow | undefined,
  value: JsonPrimitive | null,
): "create" | "update" | "delete" {
  return matrixEditOperationForRecord(
    edit,
    cell === undefined
      ? null
      : {
          meta: {
            guid: cell.id,
            object: edit.object,
            schemaVersion: 1,
            revision: "",
            createdAt: "",
            createdBy: "",
            updatedAt: "",
            updatedBy: "",
            syncStatus: "local",
          },
          values: cell.values,
        },
    value,
  );
}

export function matrixEditOperationForRecord(
  edit: ResolvedPresentationMatrixEdit,
  existing: StoredObjectRecord | null,
  value: JsonPrimitive | null | undefined,
): "create" | "update" | "delete" {
  if (edit.unsetAsAbsence && (value === null || value === edit.unsetValue)) {
    return "delete";
  }
  return existing === null ? "create" : "update";
}

export function matrixEditPatch(
  edit: ResolvedPresentationMatrixEdit,
  rowKey: string,
  columnKey: string,
  value: JsonPrimitive | null | undefined,
): Record<string, JsonValue> {
  return {
    [edit.rowField]: rowKey,
    [edit.columnField]: columnKey,
    [edit.valueField]: value ?? null,
  };
}
