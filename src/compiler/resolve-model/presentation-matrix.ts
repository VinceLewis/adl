import type {
  PartialPresentationMatrixAxisSourceModel,
  PartialPresentationMatrixCellModel,
  PartialPresentationMatrixCellSourceModel,
  PartialPresentationMatrixDateColumnAxisModel,
  PartialPresentationMatrixEditModel,
  PartialPresentationMatrixModel,
  ResolvedPresentationMatrix,
  ResolvedPresentationMatrixAxisSource,
  ResolvedPresentationMatrixCell,
  ResolvedPresentationMatrixCellSource,
  ResolvedPresentationMatrixDateColumnAxis,
  ResolvedPresentationMatrixEdit,
} from "../../model/resolved-model.js";
import { resolveSort } from "./view.js";
import { resolvePresentationStatusCandidate } from "./presentation-core.js";
import { resolvePresentationFormat } from "./presentation-row-format.js";

export function resolvePresentationMatrix(
  input: PartialPresentationMatrixModel,
): ResolvedPresentationMatrix {
  return {
    name: input.name,
    density: input.density ?? "comfortable",
    rowSource: resolvePresentationMatrixAxisSource(input.rowSource),
    columnAxis: resolvePresentationMatrixDateColumnAxis(input.columnAxis),
    cellSource: resolvePresentationMatrixCellSource(input.cellSource),
    cell: resolvePresentationMatrixCell(input.cell),
    ...(input.edit === undefined ? {} : { edit: resolvePresentationMatrixEdit(input.edit) }),
  };
}
function resolvePresentationMatrixAxisSource(
  input: PartialPresentationMatrixAxisSourceModel,
): ResolvedPresentationMatrixAxisSource {
  return {
    sourceKind: input.sourceKind ?? "readModel",
    source: input.source,
    ...(input.keyField === undefined ? {} : { keyField: input.keyField }),
    labelField: input.labelField,
    fields: [...(input.fields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
  };
}
function resolvePresentationMatrixDateColumnAxis(
  input: PartialPresentationMatrixDateColumnAxisModel,
): ResolvedPresentationMatrixDateColumnAxis {
  return {
    kind: input.kind ?? "dateRange",
    start: input.start,
    end: input.end,
    stepDays: input.stepDays ?? 1,
    ...(input.labelFormat === undefined
      ? {}
      : { labelFormat: resolvePresentationFormat(input.labelFormat) }),
  };
}
function resolvePresentationMatrixCellSource(
  input: PartialPresentationMatrixCellSourceModel,
): ResolvedPresentationMatrixCellSource {
  return {
    sourceKind: input.sourceKind ?? "readModel",
    source: input.source,
    rowField: input.rowField,
    columnField: input.columnField,
    fields: [...(input.fields ?? [])],
    ...(input.status === undefined
      ? {}
      : {
          status: {
            candidates: (input.status.candidates ?? []).map(resolvePresentationStatusCandidate),
          },
        }),
    ...(input.recordSource === undefined ? {} : { recordSource: input.recordSource }),
  };
}
function resolvePresentationMatrixCell(
  input: PartialPresentationMatrixCellModel | undefined,
): ResolvedPresentationMatrixCell {
  return {
    ...(input?.status === undefined
      ? {}
      : {
          status: {
            candidates: (input.status.candidates ?? []).map(resolvePresentationStatusCandidate),
          },
        }),
    ...(input?.unsetStatus === undefined ? {} : { unsetStatus: input.unsetStatus }),
    ...(input?.accessibleLabel === undefined ? {} : { accessibleLabel: input.accessibleLabel }),
  };
}
function resolvePresentationMatrixEdit(
  input: PartialPresentationMatrixEditModel,
): ResolvedPresentationMatrixEdit {
  return {
    object: input.object,
    rowField: input.rowField,
    columnField: input.columnField,
    valueField: input.valueField,
    cycle: [...(input.cycle ?? [])],
    ...(input.unsetValue === undefined ? {} : { unsetValue: input.unsetValue }),
    unsetAsAbsence: input.unsetAsAbsence ?? false,
    bulkBehavior: input.bulkBehavior ?? "sequentialValidatedWrites",
  };
}
