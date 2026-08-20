import type {
  PresentationMatrixBulkBehavior,
  PresentationMatrixColumnKind,
  ResolvedPresentationMatrix,
  ResolvedPresentationMatrixAxisSource,
  ResolvedPresentationMatrixCellSource,
  ResolvedPresentationStatus,
  ResolvedPresentationStatusBinding,
  ResolvedPresentationStatusMap,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic, indexByName } from "./shared.js";
import type { ExpressionFieldReference, ModelIndexes, NamedReference } from "./shared.js";
import { getPresentationMatrixSourceFieldReferences, isValidIsoDate } from "./presentation-core.js";
import {
  validatePresentationDensity,
  validatePresentationFormat,
} from "./presentation-row-format.js";

const PRESENTATION_MATRIX_COLUMN_KINDS = new Set<PresentationMatrixColumnKind>(["dateRange"]);
const PRESENTATION_MATRIX_BULK_BEHAVIORS = new Set<PresentationMatrixBulkBehavior>([
  "sequentialValidatedWrites",
]);
export function validatePresentationMatrix(
  matrix: ResolvedPresentationMatrix,
  matrixPath: string,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  statusMapByName: Map<string, NamedReference<ResolvedPresentationStatusMap>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  validatePresentationDensity(matrix.density, `${matrixPath}.density`, diagnostics);
  const rowFields = validatePresentationMatrixAxisSource(
    matrix,
    matrix.rowSource,
    `${matrixPath}.rowSource`,
    indexes,
    diagnostics,
  );
  const cellFields = validatePresentationMatrixCellSource(
    matrix,
    matrix.cellSource,
    `${matrixPath}.cellSource`,
    statusByName,
    statusMapByName,
    indexes,
    diagnostics,
  );

  if (!PRESENTATION_MATRIX_COLUMN_KINDS.has(matrix.columnAxis.kind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_COLUMN_INVALID,
        `Presentation matrix '${matrix.name}' has unsupported column axis kind '${String(
          matrix.columnAxis.kind,
        )}'.`,
        `${matrixPath}.columnAxis.kind`,
      ),
    );
  }
  if (!isValidIsoDate(matrix.columnAxis.start)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_COLUMN_INVALID,
        `Presentation matrix '${matrix.name}' column start must be an ISO date.`,
        `${matrixPath}.columnAxis.start`,
      ),
    );
  }
  if (!isValidIsoDate(matrix.columnAxis.end)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_COLUMN_INVALID,
        `Presentation matrix '${matrix.name}' column end must be an ISO date.`,
        `${matrixPath}.columnAxis.end`,
      ),
    );
  }
  if (!Number.isInteger(matrix.columnAxis.stepDays) || matrix.columnAxis.stepDays < 1) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_COLUMN_INVALID,
        `Presentation matrix '${matrix.name}' column stepDays must be a positive integer.`,
        `${matrixPath}.columnAxis.stepDays`,
      ),
    );
  }
  validatePresentationFormat(
    matrix.columnAxis.labelFormat,
    `${matrixPath}.columnAxis.labelFormat`,
    diagnostics,
  );

  const statusBinding = matrix.cell.status ?? matrix.cellSource.status;
  if (statusBinding !== undefined) {
    validatePresentationMatrixStatusBinding(
      matrix.name,
      statusBinding,
      `${matrixPath}.${matrix.cell.status === undefined ? "cellSource.status" : "cell.status"}`,
      cellFields,
      statusByName,
      statusMapByName,
      diagnostics,
    );
  }
  if (matrix.cell.unsetStatus !== undefined && !statusByName.has(matrix.cell.unsetStatus)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_STATUS_UNKNOWN,
        `Presentation matrix '${matrix.name}' references unknown unset status '${matrix.cell.unsetStatus}'.`,
        `${matrixPath}.cell.unsetStatus`,
      ),
    );
  }

  validatePresentationMatrixEdit(matrix, matrixPath, rowFields, indexes, diagnostics);
}
function validatePresentationMatrixAxisSource(
  matrix: ResolvedPresentationMatrix,
  source: ResolvedPresentationMatrixAxisSource,
  sourcePath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): Map<string, NamedReference<ExpressionFieldReference>> {
  const fields = getPresentationMatrixSourceFieldReferences(
    matrix.name,
    source.sourceKind,
    source.source,
    sourcePath,
    indexes,
    diagnostics,
  );
  if (!fields.has(source.labelField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
        `Presentation matrix '${matrix.name}' row source references unknown label field '${source.labelField}'.`,
        `${sourcePath}.labelField`,
      ),
    );
  }
  if (source.keyField !== undefined && !fields.has(source.keyField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
        `Presentation matrix '${matrix.name}' row source references unknown key field '${source.keyField}'.`,
        `${sourcePath}.keyField`,
      ),
    );
  }
  for (let fieldIndex = 0; fieldIndex < source.fields.length; fieldIndex += 1) {
    const field = source.fields[fieldIndex];
    if (field !== undefined && !fields.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
          `Presentation matrix '${matrix.name}' row source references unknown field '${field}'.`,
          `${sourcePath}.fields[${fieldIndex}]`,
        ),
      );
    }
  }
  for (let sortIndex = 0; sortIndex < source.sort.length; sortIndex += 1) {
    const sort = source.sort[sortIndex];
    if (sort !== undefined && !fields.has(sort.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
          `Presentation matrix '${matrix.name}' row source sorts by unknown field '${sort.field}'.`,
          `${sourcePath}.sort[${sortIndex}].field`,
        ),
      );
    }
  }
  return fields;
}
function validatePresentationMatrixCellSource(
  matrix: ResolvedPresentationMatrix,
  source: ResolvedPresentationMatrixCellSource,
  sourcePath: string,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  statusMapByName: Map<string, NamedReference<ResolvedPresentationStatusMap>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): Map<string, NamedReference<ExpressionFieldReference>> {
  const fields = getPresentationMatrixSourceFieldReferences(
    matrix.name,
    source.sourceKind,
    source.source,
    sourcePath,
    indexes,
    diagnostics,
  );
  for (const [fieldName, pathSuffix] of [
    [source.rowField, "rowField"],
    [source.columnField, "columnField"],
  ] as const) {
    if (!fields.has(fieldName)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
          `Presentation matrix '${matrix.name}' cell source references unknown field '${fieldName}'.`,
          `${sourcePath}.${pathSuffix}`,
        ),
      );
    }
  }
  for (let fieldIndex = 0; fieldIndex < source.fields.length; fieldIndex += 1) {
    const field = source.fields[fieldIndex];
    if (field !== undefined && !fields.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
          `Presentation matrix '${matrix.name}' cell source references unknown field '${field}'.`,
          `${sourcePath}.fields[${fieldIndex}]`,
        ),
      );
    }
  }
  if (source.status !== undefined) {
    validatePresentationMatrixStatusBinding(
      matrix.name,
      source.status,
      `${sourcePath}.status`,
      fields,
      statusByName,
      statusMapByName,
      diagnostics,
    );
  }
  return fields;
}
function validatePresentationMatrixStatusBinding(
  matrixName: string,
  binding: ResolvedPresentationStatusBinding,
  bindingPath: string,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  statusMapByName: Map<string, NamedReference<ResolvedPresentationStatusMap>>,
  diagnostics: Diagnostic[],
): void {
  for (let candidateIndex = 0; candidateIndex < binding.candidates.length; candidateIndex += 1) {
    const candidate = binding.candidates[candidateIndex];
    if (candidate === undefined) {
      continue;
    }
    const candidatePath = `${bindingPath}.candidates[${candidateIndex}]`;
    if (candidate.kind === "status") {
      if (!statusByName.has(candidate.status)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_STATUS_UNKNOWN,
            `Presentation matrix '${matrixName}' references unknown status '${candidate.status}'.`,
            `${candidatePath}.status`,
          ),
        );
      }
      continue;
    }
    const statusMapRef = statusMapByName.get(candidate.map);
    if (statusMapRef === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_STATUS_MAP_UNKNOWN,
          `Presentation matrix '${matrixName}' references unknown status map '${candidate.map}'.`,
          `${candidatePath}.map`,
        ),
      );
    }
    if (
      candidate.field === undefined &&
      statusMapRef !== undefined &&
      !fieldsByName.has(statusMapRef.item.field)
    ) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
          `Presentation status map '${statusMapRef.item.name}' references field '${statusMapRef.item.field}' that is not available in matrix '${matrixName}'.`,
          `${candidatePath}.map`,
        ),
      );
    }
    if (candidate.field !== undefined && !fieldsByName.has(candidate.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
          `Presentation matrix '${matrixName}' status candidate references unknown field '${candidate.field}'.`,
          `${candidatePath}.field`,
        ),
      );
    }
  }
}
function validatePresentationMatrixEdit(
  matrix: ResolvedPresentationMatrix,
  matrixPath: string,
  rowFields: Map<string, NamedReference<ExpressionFieldReference>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const edit = matrix.edit;
  if (edit === undefined) {
    return;
  }
  const object = indexes.objectsByName.get(edit.object)?.item;
  if (object === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_EDIT_OBJECT_UNKNOWN,
        `Presentation matrix '${matrix.name}' edit references unknown object '${edit.object}'.`,
        `${matrixPath}.edit.object`,
      ),
    );
    return;
  }
  const objectFields = indexByName(object.fields);
  for (const [fieldName, pathSuffix] of [
    [edit.rowField, "rowField"],
    [edit.columnField, "columnField"],
    [edit.valueField, "valueField"],
  ] as const) {
    if (!objectFields.has(fieldName)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_EDIT_FIELD_UNKNOWN,
          `Presentation matrix '${matrix.name}' edit references unknown field '${fieldName}' on object '${edit.object}'.`,
          `${matrixPath}.edit.${pathSuffix}`,
        ),
      );
    }
  }
  if (matrix.rowSource.keyField !== undefined && !rowFields.has(matrix.rowSource.keyField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_FIELD_UNKNOWN,
        `Presentation matrix '${matrix.name}' edit cannot use unknown row key field '${matrix.rowSource.keyField}'.`,
        `${matrixPath}.rowSource.keyField`,
      ),
    );
  }
  if (edit.cycle.length === 0 && edit.unsetValue === undefined && !edit.unsetAsAbsence) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_EDIT_CYCLE_EMPTY,
        `Presentation matrix '${matrix.name}' edit must declare cycle values or a clear behavior.`,
        `${matrixPath}.edit.cycle`,
      ),
    );
  }
  if (!PRESENTATION_MATRIX_BULK_BEHAVIORS.has(edit.bulkBehavior)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_BULK_BEHAVIOR_INVALID,
        `Presentation matrix '${matrix.name}' edit has unsupported bulk behavior '${String(
          edit.bulkBehavior,
        )}'.`,
        `${matrixPath}.edit.bulkBehavior`,
      ),
    );
  }
}
