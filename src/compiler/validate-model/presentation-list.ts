import { RECORD_ID_JOIN_FIELD } from "../../model/resolved-model.js";
import type {
  PresentationListRenderStyle,
  PresentationListSourceKind,
  ResolvedPresentationList,
  ResolvedPresentationState,
  ResolvedPresentationStatus,
  ResolvedPresentationStatusMap,
  ResolvedView,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic, expressionTypeField, reportDuplicateNames } from "./shared.js";
import type { ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";
import {
  getPresentationListFieldReferences,
  mergePresentationExpressionFields,
  validatePresentationStatusBinding,
} from "./presentation-core.js";
import {
  validatePresentationActionControl,
  validatePresentationDensity,
  validatePresentationIconRef,
  validatePresentationRowTemplate,
} from "./presentation-row-format.js";

const PRESENTATION_LIST_SOURCE_KINDS = new Set<PresentationListSourceKind>(["readModel", "object"]);
const PRESENTATION_LIST_RENDER_STYLES = new Set<PresentationListRenderStyle>([
  "table",
  "feed",
  "compactFeed",
  "cards",
]);
export function validatePresentationList(
  list: ResolvedPresentationList,
  listPath: string,
  view: ResolvedView,
  stateByName: Map<string, NamedReference<ResolvedPresentationState>>,
  iconMapByName: Map<string, NamedReference<{ name: string }>>,
  statusByName: Map<string, NamedReference<ResolvedPresentationStatus>>,
  statusMapByName: Map<string, NamedReference<ResolvedPresentationStatusMap>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!PRESENTATION_LIST_SOURCE_KINDS.has(list.sourceKind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_SOURCE_KIND_INVALID,
        `Presentation list '${list.name}' has invalid source kind '${String(list.sourceKind)}'.`,
        `${listPath}.sourceKind`,
      ),
    );
  }

  if (!PRESENTATION_LIST_RENDER_STYLES.has(list.renderAs)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_RENDER_STYLE_INVALID,
        `Presentation list '${list.name}' has unsupported render style '${String(list.renderAs)}'.`,
        `${listPath}.renderAs`,
      ),
    );
  }

  validatePresentationDensity(list.density, `${listPath}.density`, diagnostics);

  const fieldsByName = getPresentationListFieldReferences(list, indexes, listPath, diagnostics);
  const expressionFieldsByName = mergePresentationExpressionFields(fieldsByName, stateByName);

  for (let fieldIndex = 0; fieldIndex < list.fields.length; fieldIndex += 1) {
    const field = list.fields[fieldIndex];
    if (field === undefined || fieldsByName.has(field)) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_FIELD_UNKNOWN,
        `Presentation list '${list.name}' references unknown field '${field}'.`,
        `${listPath}.fields[${fieldIndex}]`,
      ),
    );
  }

  for (let sortIndex = 0; sortIndex < list.sort.length; sortIndex += 1) {
    const sortItem = list.sort[sortIndex];
    if (sortItem === undefined || fieldsByName.has(sortItem.field)) {
      continue;
    }
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.PRESENTATION_LIST_FIELD_UNKNOWN,
        `Presentation list '${list.name}' sorts by unknown field '${sortItem.field}'.`,
        `${listPath}.sort[${sortIndex}].field`,
      ),
    );
  }

  if (list.filter !== undefined) {
    const filterType = validateExpression(
      list.filter,
      `${listPath}.filter`,
      expressionFieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.PRESENTATION_FILTER_INVALID,
        field: MODEL_VALIDATION_CODES.PRESENTATION_FILTER_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.PRESENTATION_FILTER_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.PRESENTATION_FILTER_TYPE,
      },
      diagnostics,
    );
    if (filterType !== "boolean" && filterType !== "unknown") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.PRESENTATION_FILTER_TYPE,
          `Presentation list '${list.name}' filter must resolve to boolean, not ${filterType}.`,
          `${listPath}.filter`,
        ),
      );
    }
  }

  validatePresentationIconRef(
    list.emptyState.icon,
    `${listPath}.emptyState.icon`,
    view,
    iconMapByName,
    fieldsByName,
    diagnostics,
  );
  validatePresentationStatusBinding(
    list,
    listPath,
    fieldsByName,
    statusByName,
    statusMapByName,
    diagnostics,
  );
  validatePresentationRowTemplate(
    list.row,
    `${listPath}.row`,
    view,
    fieldsByName,
    expressionFieldsByName,
    iconMapByName,
    diagnostics,
  );

  reportDuplicateNames(
    list.actions,
    `${listPath}.actions`,
    MODEL_VALIDATION_CODES.PRESENTATION_CONTROL_DUPLICATE,
    diagnostics,
    `Presentation row action names must be unique within list '${list.name}'.`,
  );

  // Row actions alone get `id` added to their legal expression vocabulary:
  // `evaluateRow` (`presentation-runtime.ts`) merges the row's own record
  // identity into the values scope only when evaluating a row's `ACTION`
  // `INPUT`/`visibleWhen`, not for `list.filter` or `list.row` fragments
  // above, which still see only projected field values. Adding `id` to the
  // shared `expressionFieldsByName` instead would let a filter or row
  // fragment compile against a field the runtime never populates for them.
  const rowActionExpressionFieldsByName = new Map(expressionFieldsByName).set(
    RECORD_ID_JOIN_FIELD,
    {
      item: expressionTypeField(RECORD_ID_JOIN_FIELD, "text"),
      index: expressionFieldsByName.size,
    },
  );

  for (let actionIndex = 0; actionIndex < list.actions.length; actionIndex += 1) {
    const action = list.actions[actionIndex];
    if (action === undefined) {
      continue;
    }
    validatePresentationActionControl(
      action,
      `${listPath}.actions[${actionIndex}]`,
      rowActionExpressionFieldsByName,
      indexes,
      diagnostics,
    );
    validatePresentationIconRef(
      action.icon,
      `${listPath}.actions[${actionIndex}].icon`,
      view,
      iconMapByName,
      fieldsByName,
      diagnostics,
    );
  }
}
