import {
  DEFAULT_OBJECT_SCHEMA_VERSION,
  SYSTEM_ID_FIELD,
  createMetadataFields,
  toStorageName,
  toTableName,
} from "../../model/defaults.js";
import type {
  PartialAutoIdModel,
  PartialComputedFieldModel,
  PartialFieldModel,
  PartialLookupModel,
  PartialObjectConstraintModel,
  PartialObjectModel,
  PartialObjectScopeModel,
  PartialObjectValidationModel,
  PartialPolicyModel,
  PartialSyncPolicyModel,
  PartialValidatorModel,
  ResolvedAutoId,
  ResolvedComputedField,
  ResolvedField,
  ResolvedLookup,
  ResolvedObject,
  ResolvedObjectConstraint,
  ResolvedObjectScope,
  ResolvedObjectValidation,
  ResolvedValidator,
} from "../../model/resolved-model.js";
import { collectExpressionFieldReferences, resolveExpression } from "./expression.js";
import { resolveLifecycle } from "./lifecycle.js";
import { resolveViews } from "./view.js";
import { resolveObjectAudit, resolveObjectSync, stripObjectFromSync } from "./sync.js";

export function resolveObject(
  input: PartialObjectModel,
  topLevelSync: PartialSyncPolicyModel | undefined,
  policies: PartialPolicyModel[],
): ResolvedObject {
  const fields = (input.fields ?? []).map(resolveField);
  const computedFields = resolveComputedFields(input.computedFields ?? []);
  const lifecycle = input.lifecycle === undefined ? undefined : resolveLifecycle(input.lifecycle);
  const sync = resolveObjectSync(input.sync ?? stripObjectFromSync(topLevelSync));
  const views = resolveViews(input, fields, computedFields);
  const objectPolicies = policies
    .filter((policy) => policy.object === input.name)
    .map((policy) => policy.name);

  return {
    name: input.name,
    schemaVersion: input.schemaVersion ?? DEFAULT_OBJECT_SCHEMA_VERSION,
    tableName: input.tableName ?? toTableName(input.name),
    systemIdField: input.systemIdField ?? SYSTEM_ID_FIELD,
    ...(input.businessKey === undefined ? {} : { businessKey: input.businessKey }),
    ...(input.displayField === undefined ? {} : { displayField: input.displayField }),
    fields,
    computedFields,
    metadataFields: createMetadataFields(),
    ...(input.scope === undefined ? {} : { scope: resolveObjectScope(input.scope) }),
    constraints: (input.constraints ?? []).map(resolveObjectConstraint),
    validations: (input.validations ?? []).map(resolveObjectValidation),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    policies: [...(input.policies ?? []), ...objectPolicies],
    views,
    sync,
    audit: resolveObjectAudit(input.audit),
  };
}
function resolveComputedFields(input: PartialComputedFieldModel[]): ResolvedComputedField[] {
  const dependenciesByName = new Map(
    input.map((field) => [field.name, collectExpressionFieldReferences(field.expression)]),
  );
  const orderByName = computeComputedFieldEvaluationOrder(input, dependenciesByName);

  return input.map((field, index) => ({
    name: field.name,
    storageName: field.storageName ?? toStorageName(field.name),
    type: field.type,
    expression: resolveExpression(field.expression),
    strategy: field.strategy ?? "readTime",
    dependencies: [...(dependenciesByName.get(field.name) ?? [])],
    evaluationOrder: orderByName.get(field.name) ?? index,
    readonly: true,
    hidden: false,
    systemManaged: true,
  }));
}
function resolveObjectValidation(input: PartialObjectValidationModel): ResolvedObjectValidation {
  return {
    name: input.name,
    expression: resolveExpression(input.expression),
    message: input.message ?? `Object validation '${input.name}' failed.`,
  };
}
function resolveObjectScope(input: PartialObjectScopeModel): ResolvedObjectScope {
  return {
    context: input.context,
    field: input.field,
  };
}
function resolveField(input: PartialFieldModel): ResolvedField {
  return {
    name: input.name,
    storageName: input.storageName ?? toStorageName(input.name),
    type: input.type ?? "text",
    required: input.required ?? false,
    ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
    validators: (input.validators ?? []).map(resolveValidator),
    readonly: input.readonly ?? false,
    hidden: input.hidden ?? false,
    ...(input.lookup === undefined ? {} : { lookup: resolveLookup(input.lookup) }),
    ...(input.autoId === undefined ? {} : { autoId: resolveAutoId(input.autoId) }),
    systemManaged: false,
  };
}
function resolveValidator(input: PartialValidatorModel): ResolvedValidator {
  if (input.kind === "predicate") {
    return {
      kind: "predicate",
      expression: resolveExpression(input.expression),
      ...(input.message === undefined ? {} : { message: input.message }),
    };
  }

  return {
    kind: input.kind,
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}
function resolveLookup(input: PartialLookupModel): ResolvedLookup {
  return {
    targetObject: input.targetObject,
    ...(input.targetField === undefined ? {} : { targetField: input.targetField }),
    displayField: input.displayField,
  };
}
function resolveAutoId(input: PartialAutoIdModel): ResolvedAutoId {
  return {
    ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
    ...(input.pad === undefined ? {} : { pad: input.pad }),
    ...(input.scopeField === undefined ? {} : { scopeField: input.scopeField }),
  };
}
function resolveObjectConstraint(input: PartialObjectConstraintModel): ResolvedObjectConstraint {
  if (input.kind === "ordered") {
    return {
      name: input.name,
      kind: "ordered",
      parentField: input.parentField,
      positionField: input.positionField,
      scopeFields: [...(input.scopeFields ?? [])],
      minPosition: input.minPosition ?? 1,
      // Both default to the behaviour that already shipped, so an existing
      // ordered collection keeps refusing duplicates and keeps its gaps.
      reorder: input.reorder ?? "strict",
      compaction: input.compaction ?? "none",
    };
  }

  if (input.kind === "protectedRole") {
    return {
      name: input.name,
      kind: "protectedRole",
      scopeFields: [...(input.scopeFields ?? [])],
      roleField: input.roleField,
      roleValues: [...input.roleValues],
      minCount: input.minCount ?? 1,
    };
  }

  return {
    name: input.name,
    kind: "unique",
    fields: [...input.fields],
    scopeFields: [...(input.scopeFields ?? [])],
  };
}
export function orderedComputedFieldNames(fields: ResolvedComputedField[]): string[] {
  return fields
    .slice()
    .sort((left, right) => left.evaluationOrder - right.evaluationOrder)
    .map((field) => field.name);
}
function computeComputedFieldEvaluationOrder(
  fields: PartialComputedFieldModel[],
  dependenciesByName: Map<string, string[]>,
): Map<string, number> {
  const computedNames = new Set(fields.map((field) => field.name));
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (fieldName: string): void => {
    if (visited.has(fieldName) || visiting.has(fieldName)) {
      return;
    }

    visiting.add(fieldName);
    for (const dependency of dependenciesByName.get(fieldName) ?? []) {
      if (computedNames.has(dependency)) {
        visit(dependency);
      }
    }
    visiting.delete(fieldName);
    visited.add(fieldName);
    order.push(fieldName);
  };

  for (const field of fields) {
    visit(field.name);
  }

  return new Map(order.map((fieldName, index) => [fieldName, index]));
}
