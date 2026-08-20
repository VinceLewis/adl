/**
 * Resource/date matrices: row and cell evaluation, and the planning and
 * application of a cell write, including its policy and sync gating.
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
  ResolvedSort,
  ResolvedView,
  StoredObjectRecord,
} from "../../model/resolved-model.js";
import { cloneJson } from "../runtime-types.js";
import type { PolicyDecision, RuntimeContext } from "../runtime-types.js";
import { primitiveToText } from "./format.js";
import {
  buildDateColumns,
  matrixCellKey,
  matrixEditOperation,
  matrixEditOperationForRecord,
  matrixEditPatch,
  nextMatrixCycleValue,
  primitiveKey,
} from "./matrix-edit.js";
import {
  objectRecordToPresentationRow,
  readModelRowToPresentationRow,
  sortPresentationRows,
} from "./row-binding.js";
import type {
  BoundPresentationRow,
  DiagnosticLocation,
  PlannedMatrixCellWrite,
  RuntimePresentationDiagnostic,
  RuntimePresentationMatrix,
  RuntimePresentationMatrixCell,
  RuntimePresentationMatrixCellEdit,
  RuntimePresentationMatrixColumn,
  RuntimePresentationMatrixEditedCell,
} from "./types.js";
import { CalendarRuntime } from "./calendar-runtime.js";

export class MatrixRuntime extends CalendarRuntime {
  protected async evaluateMatrix(
    matrix: ResolvedPresentationMatrix,
    view: ResolvedView,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<RuntimePresentationMatrix> {
    const rows = sortPresentationRows(
      await this.bindMatrixSourceRows(
        matrix.name,
        matrix.rowSource.sourceKind,
        matrix.rowSource.source,
        matrix.rowSource.sort,
        context,
        diagnostics,
        `${path}.rowSource`,
        section,
      ),
      matrix.rowSource.sort,
    );
    const cells = await this.bindMatrixSourceRows(
      matrix.name,
      matrix.cellSource.sourceKind,
      matrix.cellSource.source,
      [],
      context,
      diagnostics,
      `${path}.cellSource`,
      section,
    );
    const columns = buildDateColumns(matrix, diagnostics, path, section);
    const cellByCoordinate = new Map<string, BoundPresentationRow>();
    for (const cell of cells) {
      const rowKey = primitiveKey(cell.values[matrix.cellSource.rowField]);
      const columnKey = primitiveKey(cell.values[matrix.cellSource.columnField]);
      if (rowKey !== undefined && columnKey !== undefined) {
        cellByCoordinate.set(matrixCellKey(rowKey, columnKey), cell);
      }
    }

    return {
      name: matrix.name,
      density: matrix.density,
      columns,
      rows: rows.map((row, rowIndex) => {
        const rowKey = this.resolveMatrixRowKey(matrix, row);
        const label = primitiveToText(
          row.values[matrix.rowSource.labelField] ?? rowKey,
          diagnostics,
          {
            path: `${path}.rows[${rowIndex}].label`,
            section,
          },
        );
        return {
          key: rowKey,
          label,
          values: cloneJson(row.values),
          sources: row.sources.map((source) => ({ ...source })),
          cells: columns.map((column, columnIndex) =>
            this.evaluateMatrixCell(
              matrix,
              view,
              row,
              rowKey,
              column,
              cellByCoordinate.get(matrixCellKey(rowKey, column.key)),
              state,
              context,
              diagnostics,
              {
                path: `${path}.rows[${rowIndex}].cells[${columnIndex}]`,
                section,
              },
            ),
          ),
        };
      }),
      ...(matrix.edit === undefined
        ? {}
        : {
            edit: {
              object: matrix.edit.object,
              valueField: matrix.edit.valueField,
              cycle: matrix.edit.cycle.map((value) => cloneJson(value)),
              ...(matrix.edit.unsetValue === undefined
                ? {}
                : { unsetValue: cloneJson(matrix.edit.unsetValue) }),
              unsetAsAbsence: matrix.edit.unsetAsAbsence,
              bulkBehavior: matrix.edit.bulkBehavior,
            },
          }),
    };
  }

  private async bindMatrixSourceRows(
    matrixName: string,
    sourceKind: ResolvedPresentationMatrix["rowSource"]["sourceKind"],
    source: string,
    sort: ResolvedSort[],
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    path: string,
    section: string,
  ): Promise<BoundPresentationRow[]> {
    try {
      if (sourceKind === "readModel") {
        const result = await this.dataSource.executeReadModel(source, context, { sort });
        return result.rows.map(readModelRowToPresentationRow);
      }

      const records = await this.dataSource.search(source, { sort }, context);
      return records.map(objectRecordToPresentationRow);
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "ADL_PRESENTATION_MATRIX_BINDING_FAILED",
        message: `Matrix '${matrixName}' could not bind source '${source}'.`,
        path,
        section,
      });
      this.logger.debug("PresentationRuntime matrix binding failed", {
        matrix: matrixName,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private resolveMatrixRowKey(
    matrix: ResolvedPresentationMatrix,
    row: BoundPresentationRow,
  ): string {
    const keyField = matrix.rowSource.keyField;
    if (keyField === undefined) {
      return row.id;
    }
    return primitiveKey(row.values[keyField]) ?? row.id;
  }

  private evaluateMatrixCell(
    matrix: ResolvedPresentationMatrix,
    view: ResolvedView,
    row: BoundPresentationRow,
    rowKey: string,
    column: RuntimePresentationMatrixColumn,
    cell: BoundPresentationRow | undefined,
    state: Record<string, JsonValue>,
    context: RuntimeContext,
    diagnostics: RuntimePresentationDiagnostic[],
    location: DiagnosticLocation,
  ): RuntimePresentationMatrixCell {
    const values = cloneJson(cell?.values ?? {});
    const statusBinding = matrix.cell.status ?? matrix.cellSource.status;
    const status =
      cell === undefined && matrix.cell.unsetStatus !== undefined
        ? this.resolveStatus(matrix.cell.unsetStatus, view, state, diagnostics, location, {
            kind: "direct",
          })
        : statusBinding === undefined
          ? undefined
          : this.evaluateStatusCandidates(
              matrix.name,
              statusBinding.candidates,
              view,
              values,
              state,
              diagnostics,
              location,
            );
    const edit =
      matrix.edit === undefined
        ? undefined
        : this.evaluateMatrixCellEdit(matrix, row, rowKey, column.key, cell, context);
    const accessibleLabel =
      matrix.cell.accessibleLabel ??
      `${row.values[matrix.rowSource.labelField] ?? rowKey}, ${column.label}: ${
        status?.accessibleLabel ?? "Unset"
      }`;

    return {
      rowKey,
      columnKey: column.key,
      values,
      sources: cell?.sources.map((source) => ({ ...source })) ?? [],
      ...(status === undefined ? {} : { status }),
      accessibleLabel,
      ...(edit === undefined ? {} : { edit }),
    };
  }

  private evaluateMatrixCellEdit(
    matrix: ResolvedPresentationMatrix,
    row: BoundPresentationRow,
    rowKey: string,
    columnKey: string,
    cell: BoundPresentationRow | undefined,
    context: RuntimeContext,
  ): RuntimePresentationMatrixCellEdit {
    const edit = matrix.edit;
    if (edit === undefined) {
      throw new Error(`Presentation matrix '${matrix.name}' does not declare edit behavior.`);
    }
    const currentValue = cell?.values[edit.valueField];
    const nextValue = nextMatrixCycleValue(edit, currentValue);
    const operation = matrixEditOperation(edit, cell, nextValue);
    const patch = matrixEditPatch(edit, rowKey, columnKey, nextValue);
    const sync = this.dataSource.canWrite(edit.object, operation, context);
    const reasons: string[] = [];
    let policy: PolicyDecision;

    try {
      const record = cell === undefined ? undefined : this.matrixCellRecord(edit.object, cell);
      policy = this.dataSource.evaluatePolicy(
        edit.object,
        operation,
        context,
        record === undefined ? { patch } : { record, patch },
      );
    } catch (error) {
      policy = {
        effect: "deny",
        reasons: [
          {
            policyName: `PresentationMatrix:${matrix.name}`,
            effect: "deny",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }

    if (policy.effect !== "allow") {
      reasons.push(...policy.reasons.map((reason) => reason.message));
    }
    if (!sync.allowed) {
      reasons.push(sync.reason);
    }

    return {
      enabled: policy.effect === "allow" && sync.allowed,
      reasons,
      nextValue,
      operation,
      syncMode: sync.mode,
      bulkBehavior: edit.bulkBehavior,
    };
  }

  private matrixCellRecord(
    objectName: string,
    cell: BoundPresentationRow,
  ): StoredObjectRecord | undefined {
    const source = cell.sources.find((candidate) => candidate.objectName === objectName);
    if (source === undefined) {
      return undefined;
    }
    return {
      meta: {
        guid: source.recordId,
        object: objectName,
        schemaVersion: 1,
        revision: "",
        createdAt: "",
        createdBy: "",
        updatedAt: "",
        updatedBy: "",
        syncStatus: "local",
      },
      values: cloneJson(cell.values),
    };
  }

  protected requireMatrix(
    objectName: string,
    viewName: string,
    matrixName: string,
  ): { view: ResolvedView; matrix: ResolvedPresentationMatrix } {
    const object = this.index.getObject(objectName);
    const view = object.views.find((candidate) => candidate.name === viewName);
    const matrix = view?.presentation?.sections
      .flatMap((section) => section.matrices)
      .find((candidate) => candidate.name === matrixName);
    if (view === undefined || matrix === undefined) {
      throw new Error(`Presentation matrix '${matrixName}' does not exist on view '${viewName}'.`);
    }
    return { view, matrix };
  }

  protected async planMatrixCellWrite(input: {
    objectName: string;
    viewName: string;
    matrixName: string;
    rowKey: string;
    columnKey: string;
    value: JsonPrimitive | null | undefined;
    useNextCycleValue: boolean;
    context: RuntimeContext;
  }): Promise<PlannedMatrixCellWrite> {
    const { view, matrix } = this.requireMatrix(input.objectName, input.viewName, input.matrixName);
    const edit = matrix.edit;
    if (edit === undefined) {
      throw new Error(`Presentation matrix '${matrix.name}' does not declare edit behavior.`);
    }
    return this.planMatrixCellWriteFor(view, matrix, edit, input);
  }

  protected async planMatrixCellWriteFor(
    view: ResolvedView,
    matrix: ResolvedPresentationMatrix,
    edit: ResolvedPresentationMatrixEdit,
    input: {
      rowKey: string;
      columnKey: string;
      value: JsonPrimitive | null | undefined;
      useNextCycleValue: boolean;
      context: RuntimeContext;
    },
  ): Promise<PlannedMatrixCellWrite> {
    void view;
    const existing = await this.findMatrixEditRecord(
      edit,
      input.rowKey,
      input.columnKey,
      input.context,
    );
    const currentValue = existing?.values[edit.valueField];
    const value = input.useNextCycleValue ? nextMatrixCycleValue(edit, currentValue) : input.value;
    const operation = matrixEditOperationForRecord(edit, existing, value);
    const patch = matrixEditPatch(edit, input.rowKey, input.columnKey, value);
    const sync = this.dataSource.canWrite(edit.object, operation, input.context);
    const policy = this.dataSource.evaluatePolicy(edit.object, operation, input.context, {
      ...(existing === null ? {} : { record: existing }),
      patch,
    });
    if (policy.effect !== "allow" || !sync.allowed) {
      throw new Error(
        `Presentation matrix '${matrix.name}' edit is not permitted for row '${input.rowKey}' and column '${input.columnKey}'.`,
      );
    }
    return {
      edit,
      rowKey: input.rowKey,
      columnKey: input.columnKey,
      value: value ?? null,
      operation,
      existing,
      patch,
    };
  }

  private async findMatrixEditRecord(
    edit: ResolvedPresentationMatrixEdit,
    rowKey: string,
    columnKey: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord | null> {
    const records = await this.dataSource.search(edit.object, {}, context);
    const match = records.find(
      (record) =>
        record.values[edit.rowField] === rowKey && record.values[edit.columnField] === columnKey,
    );
    if (match === undefined) {
      return null;
    }
    return this.dataSource.getRecordForRuntime(edit.object, match.meta.guid);
  }

  protected async applyMatrixCellWrite(
    planned: PlannedMatrixCellWrite,
    context: RuntimeContext,
  ): Promise<RuntimePresentationMatrixEditedCell> {
    if (planned.operation === "delete") {
      if (planned.existing === null) {
        return {
          rowKey: planned.rowKey,
          columnKey: planned.columnKey,
          operation: "noop",
        };
      }
      const record = await this.dataSource.delete(
        planned.edit.object,
        planned.existing.meta.guid,
        context,
      );
      return {
        rowKey: planned.rowKey,
        columnKey: planned.columnKey,
        operation: "delete",
        recordId: record.meta.guid,
        record,
      };
    }

    if (planned.existing === null || planned.operation === "create") {
      const record = await this.dataSource.create(planned.edit.object, planned.patch, context);
      return {
        rowKey: planned.rowKey,
        columnKey: planned.columnKey,
        operation: "create",
        recordId: record.meta.guid,
        record,
      };
    }

    const record = await this.dataSource.update(
      planned.edit.object,
      planned.existing.meta.guid,
      { [planned.edit.valueField]: planned.value },
      context,
    );
    return {
      rowKey: planned.rowKey,
      columnKey: planned.columnKey,
      operation: "update",
      recordId: record.meta.guid,
      record,
    };
  }
}
