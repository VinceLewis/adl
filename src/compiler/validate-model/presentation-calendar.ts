import type {
  PresentationCalendarWeekStart,
  ResolvedPresentationCalendar,
  ResolvedPresentationState,
  ResolvedPresentationStatus,
  ResolvedPresentationStatusBinding,
  ResolvedPresentationStatusMap,
  ResolvedView,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic, indexReadModelExpressionFields, reportDuplicateNames } from "./shared.js";
import type { ExpressionFieldReference, ModelIndexes, NamedReference } from "./shared.js";
import {
  createCalendarActionFieldReferences,
  getPresentationCalendarFieldReferences,
  isValidIsoMonthOrDate,
  mergeFieldReferences,
  mergePresentationExpressionFields,
} from "./presentation-core.js";
import {
  validatePresentationActionControl,
  validatePresentationDensity,
  validatePresentationFormat,
  validatePresentationIconRef,
} from "./presentation-row-format.js";

const PRESENTATION_CALENDAR_WEEK_STARTS = new Set<PresentationCalendarWeekStart>([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
]);
export function validatePresentationCalendar(
  calendar: ResolvedPresentationCalendar,
  calendarPath: string,
  view: ResolvedView,
  stateByName: Map<string, NamedReference<ResolvedPresentationState>>,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  statusMapByName: Map<string, NamedReference<ResolvedPresentationStatusMap>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  validatePresentationDensity(calendar.density, `${calendarPath}.density`, diagnostics);
  const fieldsByName = getPresentationCalendarFieldReferences(
    calendar,
    calendarPath,
    indexes,
    diagnostics,
  );
  const actionFieldsByName = mergePresentationExpressionFields(
    mergeFieldReferences(fieldsByName, createCalendarActionFieldReferences()),
    stateByName,
  );

  if (!fieldsByName.has(calendar.dateField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
        `Presentation calendar '${calendar.name}' references unknown date field '${calendar.dateField}'.`,
        `${calendarPath}.dateField`,
      ),
    );
  }
  if (calendar.titleField !== undefined && !fieldsByName.has(calendar.titleField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
        `Presentation calendar '${calendar.name}' references unknown title field '${calendar.titleField}'.`,
        `${calendarPath}.titleField`,
      ),
    );
  }
  for (let fieldIndex = 0; fieldIndex < calendar.fields.length; fieldIndex += 1) {
    const field = calendar.fields[fieldIndex];
    if (field !== undefined && !fieldsByName.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
          `Presentation calendar '${calendar.name}' references unknown field '${field}'.`,
          `${calendarPath}.fields[${fieldIndex}]`,
        ),
      );
    }
  }
  for (let fieldIndex = 0; fieldIndex < calendar.summaryFields.length; fieldIndex += 1) {
    const field = calendar.summaryFields[fieldIndex];
    if (field !== undefined && !fieldsByName.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
          `Presentation calendar '${calendar.name}' references unknown summary field '${field}'.`,
          `${calendarPath}.summaryFields[${fieldIndex}]`,
        ),
      );
    }
  }
  for (let sortIndex = 0; sortIndex < calendar.sort.length; sortIndex += 1) {
    const sort = calendar.sort[sortIndex];
    if (sort !== undefined && !fieldsByName.has(sort.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
          `Presentation calendar '${calendar.name}' sorts by unknown field '${sort.field}'.`,
          `${calendarPath}.sort[${sortIndex}].field`,
        ),
      );
    }
  }

  if (calendar.status !== undefined) {
    validatePresentationCalendarStatusBinding(
      calendar.name,
      calendar.status,
      `${calendarPath}.status`,
      fieldsByName,
      statusByName,
      statusMapByName,
      diagnostics,
    );
  }

  if (calendar.conflictOverlay !== undefined) {
    validatePresentationCalendarConflictOverlay(
      calendar,
      calendarPath,
      statusByName,
      indexes,
      diagnostics,
    );
  }

  validatePresentationCalendarMonth(calendar, calendarPath, stateByName, diagnostics);
  validatePresentationIconRef(
    calendar.emptyState.icon,
    `${calendarPath}.emptyState.icon`,
    view,
    iconMapByName,
    fieldsByName,
    diagnostics,
  );

  reportDuplicateNames(
    calendar.actions,
    `${calendarPath}.actions`,
    MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_DUPLICATE,
    diagnostics,
    `Presentation calendar action names must be unique within calendar '${calendar.name}'.`,
  );

  for (let actionIndex = 0; actionIndex < calendar.actions.length; actionIndex += 1) {
    const action = calendar.actions[actionIndex];
    if (action === undefined) {
      continue;
    }
    validatePresentationActionControl(
      action,
      `${calendarPath}.actions[${actionIndex}]`,
      actionFieldsByName,
      indexes,
      diagnostics,
    );
    validatePresentationIconRef(
      action.icon,
      `${calendarPath}.actions[${actionIndex}].icon`,
      view,
      iconMapByName,
      fieldsByName,
      diagnostics,
    );
  }
}
function validatePresentationCalendarConflictOverlay(
  calendar: ResolvedPresentationCalendar,
  calendarPath: string,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const overlay = calendar.conflictOverlay;
  if (overlay === undefined) {
    return;
  }
  const overlayPath = `${calendarPath}.conflictOverlay`;

  const readModel = indexes.readModelsByName.get(overlay.readModel)?.item;
  if (readModel === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_CONFLICT_OVERLAY_READ_MODEL_UNKNOWN,
        `Presentation calendar '${calendar.name}' conflict overlay references unknown read model '${overlay.readModel}'.`,
        `${overlayPath}.readModel`,
      ),
    );
    return;
  }

  const overlayFieldsByName = indexReadModelExpressionFields(readModel);
  if (!overlayFieldsByName.has(overlay.dateField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
        `Presentation calendar '${calendar.name}' conflict overlay references unknown date field '${overlay.dateField}' on read model '${overlay.readModel}'.`,
        `${overlayPath}.dateField`,
      ),
    );
  }
  if (!overlayFieldsByName.has(overlay.flagField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
        `Presentation calendar '${calendar.name}' conflict overlay references unknown flag field '${overlay.flagField}' on read model '${overlay.readModel}'.`,
        `${overlayPath}.flagField`,
      ),
    );
  }
  if (!statusByName.has(overlay.status)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_STATUS_UNKNOWN,
        `Presentation calendar '${calendar.name}' conflict overlay references unknown status '${overlay.status}'.`,
        `${overlayPath}.status`,
      ),
    );
  }
}
function validatePresentationCalendarMonth(
  calendar: ResolvedPresentationCalendar,
  calendarPath: string,
  stateByName: Map<string, NamedReference<ResolvedPresentationState>>,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_CALENDAR_WEEK_STARTS.has(calendar.month.weekStart)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_WEEK_START_INVALID,
        `Presentation calendar '${calendar.name}' has unsupported week start '${String(
          calendar.month.weekStart,
        )}'.`,
        `${calendarPath}.month.weekStart`,
      ),
    );
  }
  for (const [fieldName, pathSuffix] of [
    [calendar.month.value, "value"],
    [calendar.month.minDate, "minDate"],
    [calendar.month.maxDate, "maxDate"],
  ] as const) {
    if (fieldName !== undefined && !isValidIsoMonthOrDate(fieldName)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_DATE_INVALID,
          `Presentation calendar '${calendar.name}' month ${pathSuffix} must be an ISO month or date.`,
          `${calendarPath}.month.${pathSuffix}`,
        ),
      );
    }
  }
  if (calendar.month.state !== undefined) {
    const state = stateByName.get(calendar.month.state)?.item;
    if (state === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_STATE_UNKNOWN,
          `Presentation calendar '${calendar.name}' references unknown month state '${calendar.month.state}'.`,
          `${calendarPath}.month.state`,
        ),
      );
    } else if (state.type !== "date" && state.type !== "text") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_STATE_TYPE_INVALID,
          `Presentation calendar '${calendar.name}' month state must be date or text.`,
          `${calendarPath}.month.state`,
        ),
      );
    }
  }
  validatePresentationFormat(
    calendar.month.labelFormat,
    `${calendarPath}.month.labelFormat`,
    diagnostics,
  );
}
function validatePresentationCalendarStatusBinding(
  calendarName: string,
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
            MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_STATUS_UNKNOWN,
            `Presentation calendar '${calendarName}' references unknown status '${candidate.status}'.`,
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
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_STATUS_MAP_UNKNOWN,
          `Presentation calendar '${calendarName}' references unknown status map '${candidate.map}'.`,
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
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
          `Presentation status map '${statusMapRef.item.name}' references field '${statusMapRef.item.field}' that is not available in calendar '${calendarName}'.`,
          `${candidatePath}.map`,
        ),
      );
    }
    if (candidate.field !== undefined && !fieldsByName.has(candidate.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_FIELD_UNKNOWN,
          `Presentation calendar '${calendarName}' status candidate references unknown field '${candidate.field}'.`,
          `${candidatePath}.field`,
        ),
      );
    }
  }
}
