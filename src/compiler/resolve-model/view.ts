import type {
  PartialEditSectionModel,
  PartialObjectModel,
  PartialRelationshipPickerModel,
  PartialViewContextModel,
  PartialViewModel,
  ResolvedComputedField,
  ResolvedEditSection,
  ResolvedField,
  ResolvedRelationshipPicker,
  ResolvedSort,
  ResolvedView,
  ResolvedViewContext,
} from "../../model/resolved-model.js";
import { orderedComputedFieldNames } from "./object-field.js";
import { resolveViewPresentation } from "./presentation-core.js";

export function resolveViews(
  input: PartialObjectModel,
  fields: ResolvedField[],
  computedFields: ResolvedComputedField[],
): ResolvedView[] {
  if (input.views !== undefined && input.views.length > 0) {
    return input.views.map((view) => resolveView(view, input.name, fields, computedFields));
  }

  return createDefaultViews(input, fields, computedFields);
}
function createDefaultViews(
  input: PartialObjectModel,
  fields: ResolvedField[],
  computedFields: ResolvedComputedField[],
): ResolvedView[] {
  const fieldNames = [
    ...fields.map((field) => field.name),
    ...orderedComputedFieldNames(computedFields),
  ];
  const searchFields = getDefaultSearchFields(input, fields);

  return [
    {
      name: `${input.name}List`,
      object: input.name,
      kind: "list",
      editContainer: "modal",
      fields: fieldNames,
      searchFields,
      sort: [],
      actions: ["create", "read", "update", "delete"],
      editSections: [{ name: "Fields", kind: "fields", fields: fieldNames }],
    },
    {
      name: `${input.name}Form`,
      object: input.name,
      kind: "form",
      editContainer: "modal",
      fields: fieldNames,
      searchFields: [],
      sort: [],
      actions: ["save", "delete"],
      editSections: [{ name: "Fields", kind: "fields", fields: fieldNames }],
    },
  ];
}
function getDefaultSearchFields(input: PartialObjectModel, fields: ResolvedField[]): string[] {
  const fieldByName = new Map(fields.map((field) => [field.name, field]));
  const preferred = [input.displayField, input.businessKey]
    .filter((name): name is string => name !== undefined)
    .filter((name) => fieldByName.get(name)?.type === "text");

  if (preferred.length > 0) {
    return [...new Set(preferred)];
  }

  const firstTextField = fields.find((field) => field.type === "text");
  return firstTextField === undefined ? [] : [firstTextField.name];
}
function resolveView(
  input: PartialViewModel,
  objectName: string,
  fields: ResolvedField[],
  computedFields: ResolvedComputedField[],
): ResolvedView {
  const viewFields = [
    ...(input.fields ?? [
      ...fields.map((field) => field.name),
      ...orderedComputedFieldNames(computedFields),
    ]),
  ];

  return {
    name: input.name,
    object: input.object ?? objectName,
    kind: input.kind,
    ...(input.context === undefined ? {} : { context: resolveViewContext(input.context) }),
    ...(input.readModel === undefined ? {} : { readModel: input.readModel }),
    editContainer: input.editContainer ?? "modal",
    fields: viewFields,
    searchFields: [...(input.searchFields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    actions: [...(input.actions ?? [])],
    editSections: resolveEditSections(input.editSections, viewFields),
    ...(input.presentation === undefined
      ? {}
      : { presentation: resolveViewPresentation(input.presentation) }),
  };
}
function resolveEditSections(
  input: PartialEditSectionModel[] | undefined,
  viewFields: string[],
): ResolvedEditSection[] {
  if (input === undefined || input.length === 0) {
    return [{ name: "Fields", kind: "fields", fields: [...viewFields] }];
  }

  return input.map((section) => {
    const base = {
      name: section.name,
      ...(section.heading === undefined ? {} : { heading: section.heading }),
    };

    if (section.kind === "fields") {
      return {
        ...base,
        kind: "fields",
        fields: [...(section.fields ?? viewFields)],
      };
    }

    return {
      ...base,
      kind: "childCollection",
      childObject: section.childObject,
      parentField: section.parentField,
      ...(section.childView === undefined ? {} : { childView: section.childView }),
      /*
       * The default set must be one every child collection can honour.
       * `unlink` clears the child's lookup back to its parent, which a required
       * parent field -- the common case -- can never accept, so defaulting to
       * it made the unauthored declaration invalid by construction. `remove`
       * takes a child out of the collection in a way any model can satisfy, and
       * is still gated by the child object's `delete` policy.
       */
      operations: [...(section.operations ?? ["createChild", "updateChild", "remove"])],
      staged: section.staged ?? true,
      ...(section.orderField === undefined ? {} : { orderField: section.orderField }),
      emptyState: {
        text: section.emptyState?.text ?? "",
      },
      ...(section.picker === undefined
        ? {}
        : { picker: resolveRelationshipPicker(section.picker, section) }),
    };
  });
}
function resolveRelationshipPicker(
  input: PartialRelationshipPickerModel,
  section: Extract<PartialEditSectionModel, { kind: "childCollection" }>,
): ResolvedRelationshipPicker {
  const sourceKind = input.sourceKind ?? "object";
  return {
    name: input.name ?? `${section.name}Picker`,
    sourceKind,
    source: input.source ?? (sourceKind === "object" ? section.childObject : ""),
    // Present only when the picker mints children rather than linking them. It
    // is not defaulted: which field receives the candidate is a modelling
    // decision, and guessing it would silently pick one when a child has two.
    ...(input.candidateField === undefined ? {} : { candidateField: input.candidateField }),
    selection: input.selection ?? "multiple",
    displayFields: [...(input.displayFields ?? [])],
    searchFields: [...(input.searchFields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    excludeAlreadyLinked: input.excludeAlreadyLinked ?? true,
    emptyState: {
      text: input.emptyState?.text ?? "No records available to link.",
    },
  };
}
export function resolveViewContext(input: PartialViewContextModel): ResolvedViewContext {
  return {
    mode: input.mode,
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}
export function resolveSort(input: ResolvedSort): ResolvedSort {
  return {
    field: input.field,
    direction: input.direction,
  };
}
