import type {
  PresentationCalendarSourceKind,
  PresentationLegendInclude,
  PresentationMatrixSourceKind,
  PresentationStatePersistence,
  PresentationStateType,
  PresentationStatusThemeToken,
  ResolvedObject,
  ResolvedPresentationCalendar,
  ResolvedPresentationControl,
  ResolvedPresentationLegend,
  ResolvedPresentationList,
  ResolvedPresentationSection,
  ResolvedPresentationState,
  ResolvedPresentationStatus,
  ResolvedPresentationStatusMap,
  ResolvedView,
  ResolvedViewPresentation,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import {
  diagnostic,
  expressionTypeField,
  indexByName,
  indexObjectExpressionFields,
  indexReadModelExpressionFields,
  reportDuplicateNames,
} from "./shared.js";
import type { ExpressionFieldReference, ModelIndexes, NamedReference } from "./shared.js";
import { isValueCompatibleWithExpressionType } from "./expression.js";
import { validateIconName } from "./icon.js";
import { validatePresentationList } from "./presentation-list.js";
import { validatePresentationMatrix } from "./presentation-matrix.js";
import { validatePresentationCalendar } from "./presentation-calendar.js";
import {
  validatePresentationActionControl,
  validatePresentationDensity,
  validatePresentationIconRef,
  validatePresentationLayout,
} from "./presentation-row-format.js";

const PRESENTATION_STATE_TYPES = new Set<PresentationStateType>([
  "text",
  "number",
  "date",
  "datetime",
  "time",
  "boolean",
]);
const PRESENTATION_STATE_PERSISTENCE = new Set<PresentationStatePersistence>([
  "memory",
  "session",
  "local",
]);
const PRESENTATION_CONTROL_KINDS = new Set(["toggle", "select", "action", "contextSelector"]);
const PRESENTATION_CALENDAR_SOURCE_KINDS = new Set<PresentationCalendarSourceKind>([
  "readModel",
  "object",
]);
const PRESENTATION_MATRIX_SOURCE_KINDS = new Set<PresentationMatrixSourceKind>([
  "readModel",
  "object",
]);
const PRESENTATION_STATUS_THEME_TOKENS = new Set<PresentationStatusThemeToken>([
  "colorStatusEvent",
  "colorStatusAlternate",
  "colorStatusAvailable",
  "colorStatusUnavailable",
  "colorStatusBusyElsewhere",
  "colorStatusConflict",
  "colorStatusUnset",
  "colorInfo",
]);
const PRESENTATION_LEGEND_INCLUDES = new Set<PresentationLegendInclude>(["present", "all"]);
export function validateViewPresentation(
  presentation: ResolvedViewPresentation,
  view: ResolvedView,
  viewPath: string,
  targetObject: ResolvedObject,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const presentationPath = `${viewPath}.presentation`;
  const stateByName = indexByName(presentation.state);
  const iconMapByName = indexByName(presentation.iconMaps);
  const statusByName = indexByName(presentation.statuses);
  const statusMapByName = indexByName(presentation.statusMaps);
  const viewFieldRefs = getViewFieldReferences(view, targetObject, indexes);
  const statusMapFieldRefs = mergeFieldReferences(
    mergeFieldReferences(
      viewFieldRefs,
      getPresentationMatrixStatusMapFieldReferences(presentation, indexes),
    ),
    getPresentationCalendarStatusMapFieldReferences(presentation, indexes),
  );

  validatePresentationLayout(presentation.layout, `${presentationPath}.layout`, diagnostics);
  validatePresentationDensity(presentation.density, `${presentationPath}.density`, diagnostics);
  reportDuplicateNames(
    presentation.state,
    `${presentationPath}.state`,
    MODEL_VALIDATION_CODES.PRESENTATION_STATE_DUPLICATE,
    diagnostics,
    `Presentation state names must be unique within view '${view.name}'.`,
  );
  reportDuplicateNames(
    presentation.iconMaps,
    `${presentationPath}.iconMaps`,
    MODEL_VALIDATION_CODES.PRESENTATION_ICON_MAP_DUPLICATE,
    diagnostics,
    `Presentation icon map names must be unique within view '${view.name}'.`,
  );
  reportDuplicateNames(
    presentation.statuses,
    `${presentationPath}.statuses`,
    MODEL_VALIDATION_CODES.PRESENTATION_STATUS_DUPLICATE,
    diagnostics,
    `Presentation status names must be unique within view '${view.name}'.`,
  );
  reportDuplicateNames(
    presentation.statusMaps,
    `${presentationPath}.statusMaps`,
    MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_DUPLICATE,
    diagnostics,
    `Presentation status map names must be unique within view '${view.name}'.`,
  );
  reportDuplicateNames(
    presentation.legends,
    `${presentationPath}.legends`,
    MODEL_VALIDATION_CODES.PRESENTATION_LEGEND_DUPLICATE,
    diagnostics,
    `Presentation legend names must be unique within view '${view.name}'.`,
  );
  reportDuplicateNames(
    presentation.sections,
    `${presentationPath}.sections`,
    MODEL_VALIDATION_CODES.PRESENTATION_SECTION_DUPLICATE,
    diagnostics,
    `Presentation section names must be unique within view '${view.name}'.`,
  );

  for (let stateIndex = 0; stateIndex < presentation.state.length; stateIndex += 1) {
    const state = presentation.state[stateIndex];
    if (state === undefined) {
      continue;
    }
    validatePresentationState(state, `${presentationPath}.state[${stateIndex}]`, diagnostics);
  }

  for (let iconMapIndex = 0; iconMapIndex < presentation.iconMaps.length; iconMapIndex += 1) {
    const iconMap = presentation.iconMaps[iconMapIndex];
    if (iconMap === undefined) {
      continue;
    }
    if (!viewFieldRefs.has(iconMap.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_ICON_MAP_FIELD_UNKNOWN,
          `Presentation icon map '${iconMap.name}' references unknown field '${iconMap.field}' in view '${view.name}'.`,
          `${presentationPath}.iconMaps[${iconMapIndex}].field`,
        ),
      );
    }

    // An icon map names icons directly rather than through a
    // `ResolvedPresentationIconRef`, so it needs its own vocabulary check: this
    // is where most of an app's icon names actually live.
    for (let valueIndex = 0; valueIndex < iconMap.values.length; valueIndex += 1) {
      const mappedValue = iconMap.values[valueIndex];
      if (mappedValue === undefined) {
        continue;
      }
      validateIconName(
        mappedValue.icon,
        `${presentationPath}.iconMaps[${iconMapIndex}].values[${valueIndex}].icon`,
        diagnostics,
      );
    }

    if (iconMap.defaultIcon !== undefined) {
      validateIconName(
        iconMap.defaultIcon,
        `${presentationPath}.iconMaps[${iconMapIndex}].defaultIcon`,
        diagnostics,
      );
    }
  }

  for (let statusIndex = 0; statusIndex < presentation.statuses.length; statusIndex += 1) {
    const status = presentation.statuses[statusIndex];
    if (status === undefined) {
      continue;
    }
    validatePresentationStatus(
      status,
      `${presentationPath}.statuses[${statusIndex}]`,
      view,
      iconMapByName,
      diagnostics,
    );
  }

  for (
    let statusMapIndex = 0;
    statusMapIndex < presentation.statusMaps.length;
    statusMapIndex += 1
  ) {
    const statusMap = presentation.statusMaps[statusMapIndex];
    if (statusMap === undefined) {
      continue;
    }
    validatePresentationStatusMap(
      statusMap,
      `${presentationPath}.statusMaps[${statusMapIndex}]`,
      view,
      statusMapFieldRefs,
      statusByName,
      diagnostics,
    );
  }

  for (let legendIndex = 0; legendIndex < presentation.legends.length; legendIndex += 1) {
    const legend = presentation.legends[legendIndex];
    if (legend === undefined) {
      continue;
    }
    validatePresentationLegend(
      legend,
      `${presentationPath}.legends[${legendIndex}]`,
      statusByName,
      diagnostics,
    );
  }

  for (let sectionIndex = 0; sectionIndex < presentation.sections.length; sectionIndex += 1) {
    const section = presentation.sections[sectionIndex];
    if (section === undefined) {
      continue;
    }
    validatePresentationSection(
      section,
      `${presentationPath}.sections[${sectionIndex}]`,
      view,
      stateByName,
      iconMapByName,
      statusByName,
      statusMapByName,
      indexes,
      diagnostics,
    );
  }
}
function validatePresentationState(
  state: ResolvedPresentationState,
  statePath: string,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_STATE_TYPES.has(state.type)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_STATE_TYPE_INVALID,
        `Presentation state '${state.name}' has invalid type '${String(state.type)}'.`,
        `${statePath}.type`,
      ),
    );
  }

  if (!PRESENTATION_STATE_PERSISTENCE.has(state.persistence)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_STATE_PERSISTENCE_INVALID,
        `Presentation state '${state.name}' has invalid persistence '${String(state.persistence)}'.`,
        `${statePath}.persistence`,
      ),
    );
  }

  if (
    state.defaultValue !== null &&
    !isValueCompatibleWithExpressionType(state.type, state.defaultValue)
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_STATE_DEFAULT_INCOMPATIBLE,
        `Presentation state '${state.name}' default value is not compatible with ${state.type}.`,
        `${statePath}.defaultValue`,
      ),
    );
  }
}
function validatePresentationStatus(
  status: ResolvedPresentationStatus,
  statusPath: string,
  view: ResolvedView,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_STATUS_THEME_TOKENS.has(status.themeToken)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_THEME_TOKEN_INVALID,
        `Presentation status '${status.name}' uses unsupported theme token '${String(status.themeToken)}'.`,
        `${statusPath}.themeToken`,
      ),
    );
  }

  if (!Number.isFinite(status.precedence) || !Number.isInteger(status.precedence)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_PRECEDENCE_INVALID,
        `Presentation status '${status.name}' precedence must be an integer.`,
        `${statusPath}.precedence`,
      ),
    );
  }

  validatePresentationIconRef(
    status.icon,
    `${statusPath}.icon`,
    view,
    iconMapByName,
    undefined,
    diagnostics,
    MODEL_VALIDATION_CODES.PRESENTATION_STATUS_ICON_MAP_UNKNOWN,
  );
}
function validatePresentationStatusMap(
  statusMap: ResolvedPresentationStatusMap,
  statusMapPath: string,
  view: ResolvedView,
  viewFieldRefs: Map<string, NamedReference<ExpressionFieldReference>>,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  diagnostics: Diagnostic[],
): void {
  if (!viewFieldRefs.has(statusMap.field)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_FIELD_UNKNOWN,
        `Presentation status map '${statusMap.name}' references unknown field '${statusMap.field}' in view '${view.name}'.`,
        `${statusMapPath}.field`,
      ),
    );
  }

  const firstSeen = new Map<string, number>();
  for (let valueIndex = 0; valueIndex < statusMap.values.length; valueIndex += 1) {
    const value = statusMap.values[valueIndex];
    if (value === undefined) {
      continue;
    }

    const key = JSON.stringify(value.value);
    const firstIndex = firstSeen.get(key);
    if (firstIndex === undefined) {
      firstSeen.set(key, valueIndex);
    } else {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_VALUE_DUPLICATE,
          `Presentation status map '${statusMap.name}' maps value '${String(value.value)}' more than once.`,
          `${statusMapPath}.values[${valueIndex}].value`,
        ),
      );
    }

    if (!statusByName.has(value.status)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_STATUS_UNKNOWN,
          `Presentation status map '${statusMap.name}' references unknown status '${value.status}'.`,
          `${statusMapPath}.values[${valueIndex}].status`,
        ),
      );
    }
  }

  if (statusMap.defaultStatus !== undefined && !statusByName.has(statusMap.defaultStatus)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_STATUS_UNKNOWN,
        `Presentation status map '${statusMap.name}' references unknown default status '${statusMap.defaultStatus}'.`,
        `${statusMapPath}.defaultStatus`,
      ),
    );
  }
}
function validatePresentationLegend(
  legend: ResolvedPresentationLegend,
  legendPath: string,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_LEGEND_INCLUDES.has(legend.include)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_LEGEND_INCLUDE_INVALID,
        `Presentation legend '${legend.name}' has unsupported include mode '${String(legend.include)}'.`,
        `${legendPath}.include`,
      ),
    );
  }

  for (let statusIndex = 0; statusIndex < legend.statuses.length; statusIndex += 1) {
    const status = legend.statuses[statusIndex];
    if (status === undefined || statusByName.has(status)) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_LEGEND_STATUS_UNKNOWN,
        `Presentation legend '${legend.name}' references unknown status '${status}'.`,
        `${legendPath}.statuses[${statusIndex}]`,
      ),
    );
  }
}
function validatePresentationSection(
  section: ResolvedPresentationSection,
  sectionPath: string,
  view: ResolvedView,
  stateByName: Map<string, NamedReference<ResolvedPresentationState>>,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  statusMapByName: Map<string, NamedReference<ResolvedPresentationStatusMap>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  validatePresentationLayout(section.layout, `${sectionPath}.layout`, diagnostics);
  validatePresentationDensity(section.density, `${sectionPath}.density`, diagnostics);
  const sectionExpressionFields = mergePresentationExpressionFields(new Map(), stateByName);
  reportDuplicateNames(
    section.controls,
    `${sectionPath}.controls`,
    MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_DUPLICATE,
    diagnostics,
    `Presentation control names must be unique within section '${section.name}'.`,
  );
  reportDuplicateNames(
    section.lists,
    `${sectionPath}.lists`,
    MODEL_VALIDATION_CODES.PRESENTATION_LIST_DUPLICATE,
    diagnostics,
    `Presentation list names must be unique within section '${section.name}'.`,
  );
  reportDuplicateNames(
    section.matrices,
    `${sectionPath}.matrices`,
    MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_DUPLICATE,
    diagnostics,
    `Presentation matrix names must be unique within section '${section.name}'.`,
  );
  reportDuplicateNames(
    section.calendars,
    `${sectionPath}.calendars`,
    MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_DUPLICATE,
    diagnostics,
    `Presentation calendar names must be unique within section '${section.name}'.`,
  );

  for (let controlIndex = 0; controlIndex < section.controls.length; controlIndex += 1) {
    const control = section.controls[controlIndex];
    if (control === undefined) {
      continue;
    }
    validatePresentationControl(
      control,
      `${sectionPath}.controls[${controlIndex}]`,
      view,
      stateByName,
      iconMapByName,
      sectionExpressionFields,
      indexes,
      diagnostics,
    );
  }

  for (let listIndex = 0; listIndex < section.lists.length; listIndex += 1) {
    const list = section.lists[listIndex];
    if (list === undefined) {
      continue;
    }
    validatePresentationList(
      list,
      `${sectionPath}.lists[${listIndex}]`,
      view,
      stateByName,
      iconMapByName,
      statusByName,
      statusMapByName,
      indexes,
      diagnostics,
    );
  }

  for (let matrixIndex = 0; matrixIndex < section.matrices.length; matrixIndex += 1) {
    const matrix = section.matrices[matrixIndex];
    if (matrix === undefined) {
      continue;
    }
    validatePresentationMatrix(
      matrix,
      `${sectionPath}.matrices[${matrixIndex}]`,
      statusByName,
      statusMapByName,
      indexes,
      diagnostics,
    );
  }

  for (let calendarIndex = 0; calendarIndex < section.calendars.length; calendarIndex += 1) {
    const calendar = section.calendars[calendarIndex];
    if (calendar === undefined) {
      continue;
    }
    validatePresentationCalendar(
      calendar,
      `${sectionPath}.calendars[${calendarIndex}]`,
      view,
      stateByName,
      iconMapByName,
      statusByName,
      statusMapByName,
      indexes,
      diagnostics,
    );
  }
}
function validatePresentationControl(
  control: ResolvedPresentationControl,
  controlPath: string,
  view: ResolvedView,
  stateByName: Map<string, NamedReference<ResolvedPresentationState>>,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  expressionFieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_CONTROL_KINDS.has(control.kind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_KIND_INVALID,
        `Presentation control '${control.name}' has invalid kind '${String(control.kind)}'.`,
        `${controlPath}.kind`,
      ),
    );
  }

  if ((control.kind === "toggle" || control.kind === "select") && !stateByName.has(control.state)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_STATE_UNKNOWN,
        `Presentation control '${control.name}' references unknown local state '${control.state}'.`,
        `${controlPath}.state`,
      ),
    );
  }

  if (control.kind === "action") {
    validatePresentationActionControl(
      control,
      controlPath,
      expressionFieldsByName,
      indexes,
      diagnostics,
    );
  }

  if (control.kind === "contextSelector" && control.context !== undefined) {
    if (!indexes.contextsByName.has(control.context)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_CONTEXT_UNKNOWN,
          `Presentation context selector '${control.name}' references unknown context '${control.context}'.`,
          `${controlPath}.context`,
        ),
      );
    }
  }

  validatePresentationIconRef(
    control.icon,
    `${controlPath}.icon`,
    view,
    iconMapByName,
    undefined,
    diagnostics,
  );

  if (control.kind === "select") {
    for (let optionIndex = 0; optionIndex < control.options.length; optionIndex += 1) {
      const option = control.options[optionIndex];
      if (option === undefined) {
        continue;
      }
      validatePresentationIconRef(
        option.icon,
        `${controlPath}.options[${optionIndex}].icon`,
        view,
        iconMapByName,
        undefined,
        diagnostics,
      );
    }
  }
}
export function validatePresentationStatusBinding(
  list: ResolvedPresentationList,
  listPath: string,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  statusMapByName: Map<string, NamedReference<ResolvedPresentationStatusMap>>,
  diagnostics: Diagnostic[],
): void {
  if (list.status === undefined) {
    return;
  }

  for (
    let candidateIndex = 0;
    candidateIndex < list.status.candidates.length;
    candidateIndex += 1
  ) {
    const candidate = list.status.candidates[candidateIndex];
    if (candidate === undefined) {
      continue;
    }
    const candidatePath = `${listPath}.status.candidates[${candidateIndex}]`;

    if (candidate.kind === "status") {
      if (!statusByName.has(candidate.status)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.PRESENTATION_LIST_STATUS_UNKNOWN,
            `Presentation list '${list.name}' references unknown status '${candidate.status}'.`,
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
          MODEL_VALIDATION_CODES.PRESENTATION_LIST_STATUS_MAP_UNKNOWN,
          `Presentation list '${list.name}' references unknown status map '${candidate.map}'.`,
          `${candidatePath}.map`,
        ),
      );
    }

    if (candidate.field !== undefined && !fieldsByName.has(candidate.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_FIELD_UNKNOWN,
          `Presentation status candidate references unknown field '${candidate.field}' in list '${list.name}'.`,
          `${candidatePath}.field`,
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
          MODEL_VALIDATION_CODES.PRESENTATION_STATUS_MAP_FIELD_UNKNOWN,
          `Presentation status map '${statusMapRef.item.name}' references field '${statusMapRef.item.field}' that is not available in list '${list.name}'.`,
          `${candidatePath}.map`,
        ),
      );
    }
  }
}
function getViewFieldReferences(
  view: ResolvedView,
  targetObject: ResolvedObject,
  indexes: ModelIndexes,
): Map<string, NamedReference<ExpressionFieldReference>> {
  if (view.readModel !== undefined) {
    const readModel = indexes.readModelsByName.get(view.readModel)?.item;
    if (readModel !== undefined) {
      return indexReadModelExpressionFields(readModel);
    }
  }

  return indexObjectExpressionFields(targetObject);
}
export function getPresentationListFieldReferences(
  list: ResolvedPresentationList,
  indexes: ModelIndexes,
  listPath: string,
  diagnostics: Diagnostic[],
): Map<string, NamedReference<ExpressionFieldReference>> {
  if (list.sourceKind === "object") {
    const object = indexes.objectsByName.get(list.source)?.item;
    if (object === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_LIST_SOURCE_UNKNOWN,
          `Presentation list '${list.name}' references unknown object '${list.source}'.`,
          `${listPath}.source`,
        ),
      );
      return new Map();
    }
    return indexObjectExpressionFields(object);
  }

  if (list.sourceKind === "readModel") {
    const readModel = indexes.readModelsByName.get(list.source)?.item;
    if (readModel === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_LIST_SOURCE_UNKNOWN,
          `Presentation list '${list.name}' references unknown read model '${list.source}'.`,
          `${listPath}.source`,
        ),
      );
      return new Map();
    }
    return indexReadModelExpressionFields(readModel);
  }

  return new Map();
}
export function getPresentationMatrixSourceFieldReferences(
  matrixName: string,
  sourceKind: PresentationMatrixSourceKind,
  source: string,
  sourcePath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): Map<string, NamedReference<ExpressionFieldReference>> {
  if (!PRESENTATION_MATRIX_SOURCE_KINDS.has(sourceKind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_SOURCE_KIND_INVALID,
        `Presentation matrix '${matrixName}' has unsupported source kind '${String(sourceKind)}'.`,
        `${sourcePath}.sourceKind`,
      ),
    );
    return new Map();
  }

  if (sourceKind === "object") {
    const object = indexes.objectsByName.get(source)?.item;
    if (object === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_SOURCE_UNKNOWN,
          `Presentation matrix '${matrixName}' references unknown object '${source}'.`,
          `${sourcePath}.source`,
        ),
      );
      return new Map();
    }
    return indexObjectExpressionFields(object);
  }

  const readModel = indexes.readModelsByName.get(source)?.item;
  if (readModel === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_MATRIX_SOURCE_UNKNOWN,
        `Presentation matrix '${matrixName}' references unknown read model '${source}'.`,
        `${sourcePath}.source`,
      ),
    );
    return new Map();
  }
  return indexReadModelExpressionFields(readModel);
}
export function getPresentationCalendarFieldReferences(
  calendar: ResolvedPresentationCalendar,
  calendarPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): Map<string, NamedReference<ExpressionFieldReference>> {
  if (!PRESENTATION_CALENDAR_SOURCE_KINDS.has(calendar.sourceKind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_SOURCE_KIND_INVALID,
        `Presentation calendar '${calendar.name}' has unsupported source kind '${String(
          calendar.sourceKind,
        )}'.`,
        `${calendarPath}.sourceKind`,
      ),
    );
    return new Map();
  }

  if (calendar.sourceKind === "object") {
    const object = indexes.objectsByName.get(calendar.source)?.item;
    if (object === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_SOURCE_UNKNOWN,
          `Presentation calendar '${calendar.name}' references unknown object '${calendar.source}'.`,
          `${calendarPath}.source`,
        ),
      );
      return new Map();
    }
    return indexObjectExpressionFields(object);
  }

  const readModel = indexes.readModelsByName.get(calendar.source)?.item;
  if (readModel === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_CALENDAR_SOURCE_UNKNOWN,
        `Presentation calendar '${calendar.name}' references unknown read model '${calendar.source}'.`,
        `${calendarPath}.source`,
      ),
    );
    return new Map();
  }
  return indexReadModelExpressionFields(readModel);
}
function getPresentationMatrixStatusMapFieldReferences(
  presentation: ResolvedViewPresentation,
  indexes: ModelIndexes,
): Map<string, NamedReference<ExpressionFieldReference>> {
  let fields = new Map<string, NamedReference<ExpressionFieldReference>>();
  for (const section of presentation.sections) {
    for (const matrix of section.matrices) {
      fields = mergeFieldReferences(
        fields,
        getPresentationMatrixSourceFieldReferencesWithoutDiagnostics(
          matrix.cellSource.sourceKind,
          matrix.cellSource.source,
          indexes,
        ),
      );
    }
  }
  return fields;
}
function getPresentationCalendarStatusMapFieldReferences(
  presentation: ResolvedViewPresentation,
  indexes: ModelIndexes,
): Map<string, NamedReference<ExpressionFieldReference>> {
  let fields = new Map<string, NamedReference<ExpressionFieldReference>>();
  for (const section of presentation.sections) {
    for (const calendar of section.calendars) {
      fields = mergeFieldReferences(
        fields,
        getPresentationCalendarFieldReferencesWithoutDiagnostics(
          calendar.sourceKind,
          calendar.source,
          indexes,
        ),
      );
    }
  }
  return fields;
}
function getPresentationMatrixSourceFieldReferencesWithoutDiagnostics(
  sourceKind: PresentationMatrixSourceKind,
  source: string,
  indexes: ModelIndexes,
): Map<string, NamedReference<ExpressionFieldReference>> {
  if (sourceKind === "object") {
    const object = indexes.objectsByName.get(source)?.item;
    return object === undefined ? new Map() : indexObjectExpressionFields(object);
  }
  const readModel = indexes.readModelsByName.get(source)?.item;
  return readModel === undefined ? new Map() : indexReadModelExpressionFields(readModel);
}
function getPresentationCalendarFieldReferencesWithoutDiagnostics(
  sourceKind: PresentationCalendarSourceKind,
  source: string,
  indexes: ModelIndexes,
): Map<string, NamedReference<ExpressionFieldReference>> {
  if (sourceKind === "object") {
    const object = indexes.objectsByName.get(source)?.item;
    return object === undefined ? new Map() : indexObjectExpressionFields(object);
  }
  const readModel = indexes.readModelsByName.get(source)?.item;
  return readModel === undefined ? new Map() : indexReadModelExpressionFields(readModel);
}
export function createCalendarActionFieldReferences(): Map<
  string,
  NamedReference<ExpressionFieldReference>
> {
  return indexByName([
    expressionTypeField("Date", "date"),
    expressionTypeField("EventCount", "number"),
    expressionTypeField("HasEvents", "boolean"),
    expressionTypeField("HasConflict", "boolean"),
  ]);
}
export function mergeFieldReferences(
  left: Map<string, NamedReference<ExpressionFieldReference>>,
  right: Map<string, NamedReference<ExpressionFieldReference>>,
): Map<string, NamedReference<ExpressionFieldReference>> {
  const result = new Map(left);
  for (const [name, reference] of right) {
    if (!result.has(name)) {
      result.set(name, reference);
    }
  }
  return result;
}
export function mergePresentationExpressionFields(
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  stateByName: Map<string, NamedReference<ResolvedPresentationState>>,
): Map<string, NamedReference<ExpressionFieldReference>> {
  const result = new Map(fieldsByName);
  for (const [name, state] of stateByName) {
    result.set(name, {
      item: expressionTypeField(name, state.item.type),
      index: state.index,
    });
  }
  return result;
}
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isValidIsoMonthOrDate(value: string): boolean {
  if (/^\d{4}-\d{2}$/.test(value)) {
    return isValidIsoDate(`${value}-01`);
  }
  return isValidIsoDate(value);
}
