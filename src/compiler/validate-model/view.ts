import type {
  EditChildOperationKind,
  EditContainerMode,
  RelationshipPickerSelectionMode,
  RelationshipPickerSourceKind,
  ResolvedEditSection,
  ResolvedObject,
  ResolvedRelationshipPicker,
  ResolvedView,
  ResolvedViewContext,
  ViewKind,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import {
  VIEW_CONTEXT_MODES,
  diagnostic,
  indexObjectExpressionFields,
  reportDuplicateNames,
} from "./shared.js";
import type { ModelIndexes } from "./shared.js";
import { validateViewPresentation } from "./presentation-core.js";

const VIEW_KINDS = new Set<ViewKind>([
  "list",
  "detail",
  "form",
  "dashboard",
  "masterDetail",
  "grid",
  "composite",
]);
const EDIT_CONTAINER_MODES = new Set<EditContainerMode>(["modal", "drawer", "page", "splitPane"]);
const EDIT_SECTION_KINDS = new Set(["fields", "childCollection"]);
const EDIT_CHILD_OPERATION_KINDS = new Set<EditChildOperationKind>([
  "createChild",
  "linkExisting",
  "updateChild",
  "unlink",
  "remove",
  "reorder",
]);
const RELATIONSHIP_PICKER_SOURCE_KINDS = new Set<RelationshipPickerSourceKind>([
  "object",
  "readModel",
]);
const RELATIONSHIP_PICKER_SELECTION_MODES = new Set<RelationshipPickerSelectionMode>([
  "single",
  "multiple",
]);
export function validateView(
  view: ResolvedView,
  viewPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const targetObject = indexes.objectsByName.get(view.object)?.item;

  if (!VIEW_KINDS.has(view.kind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_KIND_INVALID,
        `View has invalid kind '${String(view.kind)}'.`,
        `${viewPath}.kind`,
      ),
    );
  }

  validateViewContext(view.context, `${viewPath}.context`, indexes, diagnostics);
  validateEditContainerMode(view.editContainer, `${viewPath}.editContainer`, diagnostics);

  if (targetObject === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_OBJECT_UNKNOWN,
        `View references unknown object '${view.object}'.`,
        `${viewPath}.object`,
      ),
    );
    return;
  }

  const readModel =
    view.readModel === undefined ? undefined : indexes.readModelsByName.get(view.readModel)?.item;
  if (view.readModel !== undefined && readModel === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_READ_MODEL_UNKNOWN,
        `View '${view.name}' references unknown read model '${view.readModel}'.`,
        `${viewPath}.readModel`,
      ),
    );
  }

  const fieldNames =
    readModel === undefined
      ? new Set([
          ...targetObject.fields.map((field) => field.name),
          ...targetObject.computedFields.map((field) => field.name),
        ])
      : new Set(readModel.fields.map((field) => field.name));
  const fieldOwner =
    readModel === undefined ? `object '${targetObject.name}'` : `read model '${readModel.name}'`;

  for (let fieldIndex = 0; fieldIndex < view.fields.length; fieldIndex += 1) {
    const field = view.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    if (!fieldNames.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_FIELD_UNKNOWN,
          `View references unknown field '${field}' on ${fieldOwner}.`,
          `${viewPath}.fields[${fieldIndex}]`,
        ),
      );
    }
  }

  for (let fieldIndex = 0; fieldIndex < view.searchFields.length; fieldIndex += 1) {
    const field = view.searchFields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    if (!fieldNames.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_SEARCH_FIELD_UNKNOWN,
          `View references unknown search field '${field}' on ${fieldOwner}.`,
          `${viewPath}.searchFields[${fieldIndex}]`,
        ),
      );
    }
  }

  for (let sortIndex = 0; sortIndex < view.sort.length; sortIndex += 1) {
    const sortItem = view.sort[sortIndex];
    if (sortItem === undefined) {
      continue;
    }
    if (!fieldNames.has(sortItem.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_SORT_FIELD_UNKNOWN,
          `View references unknown sort field '${sortItem.field}' on ${fieldOwner}.`,
          `${viewPath}.sort[${sortIndex}].field`,
        ),
      );
    }
  }

  validateViewEditSections(
    view.editSections,
    `${viewPath}.editSections`,
    targetObject,
    fieldNames,
    new Set(view.fields),
    indexes,
    diagnostics,
  );

  if (view.presentation !== undefined) {
    validateViewPresentation(view.presentation, view, viewPath, targetObject, indexes, diagnostics);
  }
}
function validateViewEditSections(
  sections: ResolvedEditSection[],
  sectionsPath: string,
  parentObject: ResolvedObject,
  parentFieldNames: Set<string>,
  viewFields: Set<string>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  reportDuplicateNames(
    sections,
    sectionsPath,
    MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_DUPLICATE,
    diagnostics,
    `Edit section names must be unique within object '${parentObject.name}' views.`,
  );

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    if (section === undefined) {
      continue;
    }

    const sectionPath = `${sectionsPath}[${sectionIndex}]`;
    if (!EDIT_SECTION_KINDS.has(section.kind)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_KIND_INVALID,
          `Edit section '${section.name}' has invalid kind '${String(section.kind)}'.`,
          `${sectionPath}.kind`,
        ),
      );
      continue;
    }

    if (section.kind === "fields") {
      for (let fieldIndex = 0; fieldIndex < section.fields.length; fieldIndex += 1) {
        const field = section.fields[fieldIndex];
        if (field === undefined || parentFieldNames.has(field)) {
          continue;
        }
        if (viewFields.has(field)) {
          continue;
        }

        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_FIELD_UNKNOWN,
            `Edit field section '${section.name}' references unknown field '${field}' on object '${parentObject.name}'.`,
            `${sectionPath}.fields[${fieldIndex}]`,
          ),
        );
      }
      continue;
    }

    const childObject = indexes.objectsByName.get(section.childObject)?.item;
    if (childObject === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_CHILD_OBJECT_UNKNOWN,
          `Edit child collection '${section.name}' references unknown child object '${section.childObject}'.`,
          `${sectionPath}.childObject`,
        ),
      );
    } else {
      const parentField = childObject.fields.find((field) => field.name === section.parentField);
      if (parentField === undefined) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_PARENT_FIELD_UNKNOWN,
            `Edit child collection '${section.name}' references unknown parent field '${section.parentField}' on child object '${childObject.name}'.`,
            `${sectionPath}.parentField`,
          ),
        );
      } else if (parentField.lookup?.targetObject !== parentObject.name) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_PARENT_FIELD_INVALID,
            `Edit child collection '${section.name}' parent field '${section.parentField}' must lookup parent object '${parentObject.name}'.`,
            `${sectionPath}.parentField`,
          ),
        );
      }

      /*
       * `unlink` detaches a child by clearing its lookup back to the parent, so
       * a required parent field can never honour it: the write the operation
       * plans is refused by the child object's own validation. The language
       * could declare it and the model could not satisfy it, with nothing
       * saying why until a user clicked the control.
       */
      if (
        parentField !== undefined &&
        parentField.required &&
        section.operations.includes("unlink")
      ) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_UNLINK_PARENT_FIELD_REQUIRED,
            `Edit child collection '${section.name}' supports 'unlink' but parent field '${section.parentField}' on child object '${childObject.name}' is required, so a child can never be detached from its parent. Use 'remove' instead, or make the field optional.`,
            `${sectionPath}.operations`,
          ),
        );
      }

      if (section.childView !== undefined) {
        const childView = childObject.views.find((view) => view.name === section.childView);
        if (childView === undefined) {
          diagnostics.push(
            diagnostic(
              MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_CHILD_VIEW_UNKNOWN,
              `Edit child collection '${section.name}' references unknown child view '${section.childView}' on object '${childObject.name}'.`,
              `${sectionPath}.childView`,
            ),
          );
        }
      }

      if (
        section.orderField !== undefined &&
        !childObject.fields.some((field) => field.name === section.orderField)
      ) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_ORDER_FIELD_UNKNOWN,
            `Edit child collection '${section.name}' references unknown order field '${section.orderField}' on child object '${childObject.name}'.`,
            `${sectionPath}.orderField`,
          ),
        );
      }

      if (section.picker !== undefined) {
        validateRelationshipPicker(
          section.picker,
          `${sectionPath}.picker`,
          section,
          childObject,
          indexes,
          diagnostics,
        );
      }
    }

    for (let operationIndex = 0; operationIndex < section.operations.length; operationIndex += 1) {
      const operation = section.operations[operationIndex];
      if (operation === undefined || EDIT_CHILD_OPERATION_KINDS.has(operation)) {
        continue;
      }

      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_OPERATION_INVALID,
          `Edit child collection '${section.name}' has unsupported operation '${String(operation)}'.`,
          `${sectionPath}.operations[${operationIndex}]`,
        ),
      );
    }

    if (section.operations.includes("reorder") && section.orderField === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_EDIT_SECTION_ORDER_FIELD_UNKNOWN,
          `Edit child collection '${section.name}' requires orderField when reorder is supported.`,
          `${sectionPath}.orderField`,
        ),
      );
    }
  }
}
function validateRelationshipPicker(
  picker: ResolvedRelationshipPicker,
  pickerPath: string,
  section: Extract<ResolvedEditSection, { kind: "childCollection" }>,
  childObject: ResolvedObject,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  /*
   * A picker naming a candidate field creates children; one without links
   * existing ones. They therefore need different operations declared, and
   * requiring `linkExisting` of a minting picker would refuse the very
   * declaration this exists to allow.
   */
  const candidateTarget = validateRelationshipPickerCandidateField(
    picker,
    pickerPath,
    childObject,
    diagnostics,
  );
  const mints = picker.candidateField !== undefined;

  if (mints && !section.operations.includes("createChild")) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_CREATE_OPERATION_REQUIRED,
        `Relationship picker '${picker.name}' names candidate field '${String(picker.candidateField)}', so edit child collection '${section.name}' must support createChild.`,
        `${pickerPath}.name`,
      ),
    );
  }

  if (!mints && !section.operations.includes("linkExisting")) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_LINK_OPERATION_REQUIRED,
        `Relationship picker '${picker.name}' requires edit child collection '${section.name}' to support linkExisting.`,
        `${pickerPath}.name`,
      ),
    );
  }

  if (!RELATIONSHIP_PICKER_SOURCE_KINDS.has(picker.sourceKind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_KIND_INVALID,
        `Relationship picker '${picker.name}' has invalid source kind '${String(picker.sourceKind)}'.`,
        `${pickerPath}.sourceKind`,
      ),
    );
    return;
  }

  if (!RELATIONSHIP_PICKER_SELECTION_MODES.has(picker.selection)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SELECTION_INVALID,
        `Relationship picker '${picker.name}' has invalid selection mode '${String(picker.selection)}'.`,
        `${pickerPath}.selection`,
      ),
    );
  }

  const fields =
    picker.sourceKind === "object"
      ? validateObjectRelationshipPickerSource(
          picker,
          pickerPath,
          mints ? candidateTarget : childObject.name,
          indexes,
          diagnostics,
        )
      : validateReadModelRelationshipPickerSource(
          picker,
          pickerPath,
          mints ? candidateTarget : childObject.name,
          indexes,
          diagnostics,
        );

  if (fields === undefined) {
    return;
  }

  for (let fieldIndex = 0; fieldIndex < picker.displayFields.length; fieldIndex += 1) {
    const field = picker.displayFields[fieldIndex];
    if (field === undefined || fields.has(field)) {
      continue;
    }

    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_DISPLAY_FIELD_UNKNOWN,
        `Relationship picker '${picker.name}' displays unknown candidate field '${field}'.`,
        `${pickerPath}.displayFields[${fieldIndex}]`,
      ),
    );
  }

  for (let fieldIndex = 0; fieldIndex < picker.searchFields.length; fieldIndex += 1) {
    const field = picker.searchFields[fieldIndex];
    if (field === undefined || fields.has(field)) {
      continue;
    }

    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SEARCH_FIELD_UNKNOWN,
        `Relationship picker '${picker.name}' searches unknown candidate field '${field}'.`,
        `${pickerPath}.searchFields[${fieldIndex}]`,
      ),
    );
  }

  for (let sortIndex = 0; sortIndex < picker.sort.length; sortIndex += 1) {
    const sort = picker.sort[sortIndex];
    if (sort === undefined || fields.has(sort.field)) {
      continue;
    }

    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SORT_FIELD_UNKNOWN,
        `Relationship picker '${picker.name}' sorts by unknown candidate field '${sort.field}'.`,
        `${pickerPath}.sort[${sortIndex}].field`,
      ),
    );
  }
}
/**
 * The child field a minting picker writes its chosen candidate into, and the
 * object those candidates must therefore come from.
 *
 * Returns the field's lookup target, or `undefined` when there is nothing sound
 * to check the source against — either because the picker links rather than
 * mints, or because the field itself is already wrong and reporting a second
 * failure about its target would only bury the first.
 */
function validateRelationshipPickerCandidateField(
  picker: ResolvedRelationshipPicker,
  pickerPath: string,
  childObject: ResolvedObject,
  diagnostics: Diagnostic[],
): string | undefined {
  if (picker.candidateField === undefined) {
    return undefined;
  }

  const field = childObject.fields.find((candidate) => candidate.name === picker.candidateField);
  if (field === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_CANDIDATE_FIELD_UNKNOWN,
        `Relationship picker '${picker.name}' references unknown candidate field '${picker.candidateField}' on child object '${childObject.name}'.`,
        `${pickerPath}.candidateField`,
      ),
    );
    return undefined;
  }

  if (field.lookup === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_CANDIDATE_FIELD_INVALID,
        `Relationship picker '${picker.name}' candidate field '${field.name}' must be a lookup field, because the picker writes a chosen record's id into it.`,
        `${pickerPath}.candidateField`,
      ),
    );
    return undefined;
  }

  return field.lookup.targetObject;
}
function validateObjectRelationshipPickerSource(
  picker: ResolvedRelationshipPicker,
  pickerPath: string,
  requiredObjectName: string | undefined,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): Set<string> | undefined {
  const source = indexes.objectsByName.get(picker.source)?.item;
  if (source === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_UNKNOWN,
        `Relationship picker '${picker.name}' references unknown object source '${picker.source}'.`,
        `${pickerPath}.source`,
      ),
    );
    return undefined;
  }

  if (requiredObjectName !== undefined && source.name !== requiredObjectName) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_UNKNOWN,
        `Relationship picker '${picker.name}' object source '${picker.source}' must be '${requiredObjectName}'.`,
        `${pickerPath}.source`,
      ),
    );
  }

  return new Set(indexObjectExpressionFields(source).keys());
}
function validateReadModelRelationshipPickerSource(
  picker: ResolvedRelationshipPicker,
  pickerPath: string,
  requiredObjectName: string | undefined,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): Set<string> | undefined {
  const readModel = indexes.readModelsByName.get(picker.source)?.item;
  if (readModel === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_UNKNOWN,
        `Relationship picker '${picker.name}' references unknown read model source '${picker.source}'.`,
        `${pickerPath}.source`,
      ),
    );
    return undefined;
  }

  if (
    requiredObjectName !== undefined &&
    !readModel.sources.some((source) => source.object === requiredObjectName)
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.RELATIONSHIP_PICKER_SOURCE_UNKNOWN,
        `Relationship picker '${picker.name}' read model '${picker.source}' must include '${requiredObjectName}' as a source.`,
        `${pickerPath}.source`,
      ),
    );
  }

  return new Set(readModel.fields.map((field) => field.name));
}
function validateEditContainerMode(
  editContainer: EditContainerMode,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (!EDIT_CONTAINER_MODES.has(editContainer)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_EDIT_CONTAINER_INVALID,
        `View has invalid edit container '${String(editContainer)}'.`,
        path,
      ),
    );
  }
}
function validateViewContext(
  context: ResolvedViewContext | undefined,
  contextPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (context === undefined) {
    return;
  }

  if (!VIEW_CONTEXT_MODES.has(context.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_CONTEXT_MODE_INVALID,
        `View has invalid context mode '${String(context.mode)}'.`,
        `${contextPath}.mode`,
      ),
    );
  }

  if (context.mode !== "none" && context.context === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_CONTEXT_REQUIRED,
        `View context mode '${String(context.mode)}' must reference a business context.`,
        `${contextPath}.context`,
      ),
    );
    return;
  }

  if (context.context !== undefined && !indexes.contextsByName.has(context.context)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_CONTEXT_UNKNOWN,
        `View references unknown context '${context.context}'.`,
        `${contextPath}.context`,
      ),
    );
  }
}
