import type {
  ComputedFieldStrategy,
  FieldType,
  OrderedCollectionCompaction,
  OrderedCollectionReorder,
  ResolvedComputedField,
  ResolvedField,
  ResolvedObject,
  ResolvedObjectConstraint,
  ResolvedObjectScope,
  ResolvedObjectValidation,
  ValidatorKind,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import {
  FIELD_TYPES,
  diagnostic,
  expressionTypeToFieldType,
  indexByName,
  indexObjectExpressionFields,
  isDefaultCompatible,
  isPositiveInteger,
  reportDuplicateNames,
} from "./shared.js";
import type { ExpressionFieldReference, ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";
import {
  validateLifecycle,
  validateObjectPolicyReferences,
  validateObjectSyncPolicy,
} from "./lifecycle.js";
import { validateView } from "./view.js";

const ORDERED_COLLECTION_REORDERS = new Set<OrderedCollectionReorder>(["strict", "shift"]);
const ORDERED_COLLECTION_COMPACTIONS = new Set<OrderedCollectionCompaction>(["none", "onDelete"]);
const COMPUTED_FIELD_STRATEGIES = new Set<ComputedFieldStrategy>(["readTime"]);
function validateObjectScope(
  scope: ResolvedObjectScope,
  object: ResolvedObject,
  objectPath: string,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const context = indexes.contextsByName.get(scope.context)?.item;
  const scopeField = fieldsByName.get(scope.field)?.item;

  if (context === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SCOPE_CONTEXT_UNKNOWN,
        `Object '${object.name}' scope references unknown context '${scope.context}'.`,
        `${objectPath}.scope.context`,
      ),
    );
  }

  if (scopeField === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SCOPE_FIELD_UNKNOWN,
        `Object '${object.name}' scope field '${scope.field}' does not exist.`,
        `${objectPath}.scope.field`,
      ),
    );
    return;
  }

  if (context !== undefined && scopeField.lookup?.targetObject !== context.object) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SCOPE_FIELD_CONTEXT_MISMATCH,
        `Object '${object.name}' scope field '${scope.field}' must look up context object '${context.object}'.`,
        `${objectPath}.scope.field`,
      ),
    );
  }
}
export function validateObject(
  object: ResolvedObject,
  objectIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const objectPath = `objects[${objectIndex}]`;
  const fieldsByName = indexByName(object.fields);
  const computedFieldsByName = indexByName(object.computedFields);
  const expressionFieldsByName = indexObjectExpressionFields(object);

  reportDuplicateNames(
    object.fields,
    `${objectPath}.fields`,
    MODEL_VALIDATION_CODES.FIELD_DUPLICATE,
    diagnostics,
    `Field names must be unique within object '${object.name}'.`,
  );
  reportDuplicateNames(
    object.computedFields,
    `${objectPath}.computedFields`,
    MODEL_VALIDATION_CODES.COMPUTED_FIELD_DUPLICATE,
    diagnostics,
    `Computed field names must be unique within object '${object.name}'.`,
  );

  for (let fieldIndex = 0; fieldIndex < object.computedFields.length; fieldIndex += 1) {
    const computedField = object.computedFields[fieldIndex];
    if (computedField === undefined) {
      continue;
    }
    if (fieldsByName.has(computedField.name)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.COMPUTED_FIELD_NAME_CONFLICT,
          `Computed field '${computedField.name}' conflicts with a stored field on object '${object.name}'.`,
          `${objectPath}.computedFields[${fieldIndex}].name`,
        ),
      );
    }
  }

  if (object.businessKey !== undefined && !fieldsByName.has(object.businessKey)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_BUSINESS_KEY_UNKNOWN,
        `Business key field '${object.businessKey}' does not exist on object '${object.name}'.`,
        `${objectPath}.businessKey`,
      ),
    );
  }

  if (object.displayField !== undefined && !fieldsByName.has(object.displayField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_DISPLAY_FIELD_UNKNOWN,
        `Display field '${object.displayField}' does not exist on object '${object.name}'.`,
        `${objectPath}.displayField`,
      ),
    );
  }

  if (object.scope !== undefined) {
    validateObjectScope(object.scope, object, objectPath, fieldsByName, indexes, diagnostics);
  }

  reportDuplicateNames(
    object.constraints,
    `${objectPath}.constraints`,
    MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_DUPLICATE,
    diagnostics,
    `Constraint names must be unique within object '${object.name}'.`,
  );
  reportDuplicateNames(
    object.validations,
    `${objectPath}.validations`,
    MODEL_VALIDATION_CODES.OBJECT_VALIDATION_DUPLICATE,
    diagnostics,
    `Validation names must be unique within object '${object.name}'.`,
  );

  for (let constraintIndex = 0; constraintIndex < object.constraints.length; constraintIndex += 1) {
    const constraint = object.constraints[constraintIndex];
    if (constraint === undefined) {
      continue;
    }
    validateObjectConstraint(
      constraint,
      `${objectPath}.constraints[${constraintIndex}]`,
      object,
      fieldsByName,
      diagnostics,
    );
  }

  for (let fieldIndex = 0; fieldIndex < object.fields.length; fieldIndex += 1) {
    const field = object.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    validateField(field, fieldIndex, object, objectPath, indexes, diagnostics);
  }

  for (
    let computedFieldIndex = 0;
    computedFieldIndex < object.computedFields.length;
    computedFieldIndex += 1
  ) {
    const computedField = object.computedFields[computedFieldIndex];
    if (computedField === undefined) {
      continue;
    }
    validateComputedField(
      computedField,
      computedFieldIndex,
      object,
      objectPath,
      expressionFieldsByName,
      diagnostics,
    );
  }
  validateComputedFieldCycles(object, objectPath, computedFieldsByName, diagnostics);

  for (let validationIndex = 0; validationIndex < object.validations.length; validationIndex += 1) {
    const validation = object.validations[validationIndex];
    if (validation === undefined) {
      continue;
    }
    validateObjectValidation(
      validation,
      `${objectPath}.validations[${validationIndex}]`,
      object,
      fieldsByName,
      diagnostics,
    );
  }

  if (object.lifecycle !== undefined) {
    validateLifecycle(object.lifecycle, object, objectPath, indexes, diagnostics);
  }

  validateObjectPolicyReferences(object, objectPath, indexes, diagnostics);
  validateObjectSyncPolicy(object, objectPath, diagnostics);

  for (let viewIndex = 0; viewIndex < object.views.length; viewIndex += 1) {
    const view = object.views[viewIndex];
    if (view === undefined) {
      continue;
    }
    const viewPath = `${objectPath}.views[${viewIndex}]`;
    validateView(view, viewPath, indexes, diagnostics);
  }
}
function validateObjectConstraint(
  constraint: ResolvedObjectConstraint,
  constraintPath: string,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): void {
  if (constraint.kind === "unique") {
    if (constraint.fields.length === 0) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_FIELD_UNKNOWN,
          `Unique constraint '${constraint.name}' on object '${object.name}' must reference at least one field.`,
          `${constraintPath}.fields`,
        ),
      );
    }

    validateConstraintFieldList(
      constraint.fields,
      `${constraintPath}.fields`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    validateConstraintFieldList(
      constraint.scopeFields,
      `${constraintPath}.scopeFields`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    return;
  }

  if (constraint.kind === "ordered") {
    const parentField = validateConstraintField(
      constraint.parentField,
      `${constraintPath}.parentField`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    const positionField = validateConstraintField(
      constraint.positionField,
      `${constraintPath}.positionField`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );

    void parentField;

    if (positionField !== undefined && positionField.type !== "number") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_POSITION_FIELD_TYPE_INVALID,
          `Ordered constraint '${constraint.name}' on object '${object.name}' position field '${constraint.positionField}' must be a number field.`,
          `${constraintPath}.positionField`,
        ),
      );
    }

    if (!isPositiveInteger(constraint.minPosition)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_MIN_POSITION_INVALID,
          `Ordered constraint '${constraint.name}' on object '${object.name}' minPosition must be a positive integer.`,
          `${constraintPath}.minPosition`,
        ),
      );
    }

    /*
     * Both of these decide what the platform does to *sibling* records inside
     * the same transaction, so an unrecognised value cannot be treated as a
     * harmless default: it would silently pick one of two different write
     * behaviours for every reorder or delete in the collection.
     */
    if (!ORDERED_COLLECTION_REORDERS.has(constraint.reorder)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_REORDER_INVALID,
          `Ordered constraint '${constraint.name}' on object '${object.name}' has invalid reorder behaviour '${String(constraint.reorder)}'.`,
          `${constraintPath}.reorder`,
        ),
      );
    }

    if (!ORDERED_COLLECTION_COMPACTIONS.has(constraint.compaction)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_COMPACTION_INVALID,
          `Ordered constraint '${constraint.name}' on object '${object.name}' has invalid compaction behaviour '${String(constraint.compaction)}'.`,
          `${constraintPath}.compaction`,
        ),
      );
    }

    validateConstraintFieldList(
      constraint.scopeFields,
      `${constraintPath}.scopeFields`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    return;
  }

  if (constraint.kind === "protectedRole") {
    validateConstraintField(
      constraint.roleField,
      `${constraintPath}.roleField`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );

    if (constraint.roleValues.length === 0) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_PROTECTED_ROLE_VALUES_EMPTY,
          `Protected role constraint '${constraint.name}' on object '${object.name}' must declare at least one guarded value.`,
          `${constraintPath}.roleValues`,
        ),
      );
    }

    if (!isPositiveInteger(constraint.minCount)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_PROTECTED_ROLE_MIN_INVALID,
          `Protected role constraint '${constraint.name}' on object '${object.name}' minCount must be a positive integer.`,
          `${constraintPath}.minCount`,
        ),
      );
    }

    validateConstraintFieldList(
      constraint.scopeFields,
      `${constraintPath}.scopeFields`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    return;
  }

  diagnostics.push(
    diagnostic(
      MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_KIND_INVALID,
      `Object '${object.name}' has invalid constraint kind '${String((constraint as { kind?: unknown }).kind)}'.`,
      `${constraintPath}.kind`,
    ),
  );
}
function validateConstraintFieldList(
  fieldNames: string[],
  fieldListPath: string,
  constraint: ResolvedObjectConstraint,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): void {
  for (let fieldIndex = 0; fieldIndex < fieldNames.length; fieldIndex += 1) {
    const fieldName = fieldNames[fieldIndex];
    if (fieldName === undefined) {
      continue;
    }
    validateConstraintField(
      fieldName,
      `${fieldListPath}[${fieldIndex}]`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
  }
}
function validateConstraintField(
  fieldName: string,
  fieldPath: string,
  constraint: ResolvedObjectConstraint,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): ResolvedField | undefined {
  const field = fieldsByName.get(fieldName)?.item;
  if (field === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_FIELD_UNKNOWN,
        `Constraint '${constraint.name}' references unknown field '${fieldName}' on object '${object.name}'.`,
        fieldPath,
      ),
    );
  }

  return field;
}
function validateObjectValidation(
  validation: ResolvedObjectValidation,
  validationPath: string,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): void {
  const expressionType = validateExpression(
    validation.expression,
    `${validationPath}.expression`,
    fieldsByName,
    {
      invalid: MODEL_VALIDATION_CODES.OBJECT_VALIDATION_INVALID,
      field: MODEL_VALIDATION_CODES.OBJECT_VALIDATION_FIELD_UNKNOWN,
      runtime: MODEL_VALIDATION_CODES.OBJECT_VALIDATION_RUNTIME_PROPERTY_INVALID,
      type: MODEL_VALIDATION_CODES.OBJECT_VALIDATION_TYPE,
    },
    diagnostics,
  );

  if (expressionType !== "boolean" && expressionType !== "unknown") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_VALIDATION_TYPE,
        `Object validation '${validation.name}' on '${object.name}' must resolve to boolean, not ${expressionType}.`,
        `${validationPath}.expression`,
      ),
    );
  }
}
/**
 * What a named validator needs to do anything at all: the field types it can
 * apply to, and whether it needs a declared value and of what shape.
 *
 * The runtime guards each named validator with a type test on the value *and*
 * on the validator's own bound, and passes when either fails. That is the right
 * runtime behaviour — a validator should not throw on unexpected data — but it
 * meant `MIN 5` on a text field, `MIN` with no bound, and `REGEXP` on a number
 * were all silently inert with nothing reported at any layer. A second runtime
 * could implement `min` on text as a length check and be equally "conforming".
 * These are compile-time errors so the model says what it means.
 */
const NAMED_VALIDATOR_RULES: Record<
  Exclude<ValidatorKind, "predicate">,
  { fieldTypes: readonly FieldType[]; value: "number" | "text" | "list" | "none" }
> = {
  email: { fieldTypes: ["text"], value: "none" },
  min: { fieldTypes: ["number"], value: "number" },
  max: { fieldTypes: ["number"], value: "number" },
  minLength: { fieldTypes: ["text"], value: "number" },
  maxLength: { fieldTypes: ["text"], value: "number" },
  in: { fieldTypes: ["text", "number", "boolean"], value: "list" },
  regexp: { fieldTypes: ["text"], value: "text" },
  currencyCode: { fieldTypes: ["text"], value: "none" },
  maxSize: { fieldTypes: ["attachment"], value: "number" },
  mimeType: { fieldTypes: ["attachment"], value: "list" },
};
function validateNamedFieldValidator(
  validator: { kind: ValidatorKind; value?: unknown },
  field: ResolvedField,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const rule = NAMED_VALIDATOR_RULES[validator.kind as Exclude<ValidatorKind, "predicate">];
  if (rule === undefined) {
    return;
  }

  if (!rule.fieldTypes.includes(field.type)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.FIELD_VALIDATOR_KIND_INVALID,
        `Validator '${validator.kind}' cannot apply to ${field.type} field '${field.name}'; it applies to ${rule.fieldTypes.join(", ")} fields.`,
        `${path}.kind`,
      ),
    );
    return;
  }

  if (rule.value === "none") {
    return;
  }

  const value = validator.value;
  const satisfied =
    rule.value === "number"
      ? typeof value === "number"
      : rule.value === "text"
        ? typeof value === "string"
        : Array.isArray(value) && value.length > 0;

  if (!satisfied) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.FIELD_VALIDATOR_VALUE_INVALID,
        `Validator '${validator.kind}' on field '${field.name}' needs a ${rule.value === "list" ? "non-empty list" : rule.value} value; without one it can never fail.`,
        `${path}.value`,
      ),
    );
  }
}
function validateField(
  field: ResolvedField,
  fieldIndex: number,
  object: ResolvedObject,
  objectPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const fieldPath = `${objectPath}.fields[${fieldIndex}]`;
  const fieldNames = new Set(object.fields.map((candidate) => candidate.name));
  const fieldsByName = indexByName(object.fields);

  if (field.defaultValue !== undefined && !isDefaultCompatible(field, field.defaultValue)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.FIELD_DEFAULT_INCOMPATIBLE,
        `Default value for field '${field.name}' is not compatible with ${field.type} field requirements.`,
        `${fieldPath}.defaultValue`,
      ),
    );
  }

  if (field.autoId !== undefined) {
    if (field.type !== "text") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.AUTO_ID_NON_TEXT,
          `Auto ID field '${field.name}' on object '${object.name}' must be a text field.`,
          `${fieldPath}.autoId`,
        ),
      );
    }

    // AUTO_ID no longer requires a DEFAULT: ObjectStore.planCreateForTransaction
    // mints a value for it on create when the caller supplies none (Phase 74).
    // See learnings/implementation/auto-id-minting.md.

    if (field.autoId.scopeField !== undefined && !fieldNames.has(field.autoId.scopeField)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.AUTO_ID_SCOPE_FIELD_UNKNOWN,
          `Auto ID scope field '${field.autoId.scopeField}' does not exist on object '${object.name}'.`,
          `${fieldPath}.autoId.scopeField`,
        ),
      );
    }
  }

  if (field.lookup !== undefined) {
    const target = indexes.objectsByName.get(field.lookup.targetObject);

    if (target === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.LOOKUP_TARGET_OBJECT_UNKNOWN,
          `Lookup target object '${field.lookup.targetObject}' does not exist.`,
          `${fieldPath}.lookup.targetObject`,
        ),
      );
      return;
    }

    const targetFieldNames = new Set(target.item.fields.map((candidate) => candidate.name));
    if (field.lookup.targetField !== undefined && !targetFieldNames.has(field.lookup.targetField)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.LOOKUP_TARGET_FIELD_UNKNOWN,
          `Lookup target field '${field.lookup.targetField}' does not exist on object '${target.item.name}'.`,
          `${fieldPath}.lookup.targetField`,
        ),
      );
    }

    if (!targetFieldNames.has(field.lookup.displayField)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.LOOKUP_DISPLAY_FIELD_UNKNOWN,
          `Lookup display field '${field.lookup.displayField}' does not exist on object '${target.item.name}'.`,
          `${fieldPath}.lookup.displayField`,
        ),
      );
    }
  }

  for (let validatorIndex = 0; validatorIndex < field.validators.length; validatorIndex += 1) {
    const validator = field.validators[validatorIndex];
    if (validator === undefined) {
      continue;
    }

    if (validator.kind !== "predicate") {
      validateNamedFieldValidator(
        validator,
        field,
        `${fieldPath}.validators[${validatorIndex}]`,
        diagnostics,
      );
      continue;
    }

    const expressionType = validateExpression(
      validator.expression,
      `${fieldPath}.validators[${validatorIndex}].expression`,
      fieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.FIELD_VALIDATOR_EXPRESSION_INVALID,
        field: MODEL_VALIDATION_CODES.FIELD_VALIDATOR_EXPRESSION_INVALID,
        runtime: MODEL_VALIDATION_CODES.FIELD_VALIDATOR_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.FIELD_VALIDATOR_EXPRESSION_TYPE,
      },
      diagnostics,
    );

    if (expressionType !== "boolean" && expressionType !== "unknown") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.FIELD_VALIDATOR_EXPRESSION_TYPE,
          `Predicate validator on field '${field.name}' must resolve to boolean, not ${expressionType}.`,
          `${fieldPath}.validators[${validatorIndex}].expression`,
        ),
      );
    }
  }
}
function validateComputedField(
  field: ResolvedComputedField,
  fieldIndex: number,
  object: ResolvedObject,
  objectPath: string,
  fieldsByName: Map<string, NamedReference<ExpressionFieldReference>>,
  diagnostics: Diagnostic[],
): void {
  const fieldPath = `${objectPath}.computedFields[${fieldIndex}]`;

  if (!FIELD_TYPES.has(field.type)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMPUTED_FIELD_TYPE_INVALID,
        `Computed field '${field.name}' on object '${object.name}' has invalid type '${String(field.type)}'.`,
        `${fieldPath}.type`,
      ),
    );
  }

  if (!COMPUTED_FIELD_STRATEGIES.has(field.strategy)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMPUTED_FIELD_STRATEGY_INVALID,
        `Computed field '${field.name}' on object '${object.name}' has invalid strategy '${String(field.strategy)}'.`,
        `${fieldPath}.strategy`,
      ),
    );
  }

  const expressionType = validateExpression(
    field.expression,
    `${fieldPath}.expression`,
    fieldsByName,
    {
      invalid: MODEL_VALIDATION_CODES.COMPUTED_FIELD_EXPRESSION_INVALID,
      field: MODEL_VALIDATION_CODES.COMPUTED_FIELD_EXPRESSION_FIELD_UNKNOWN,
      runtime: MODEL_VALIDATION_CODES.COMPUTED_FIELD_RUNTIME_PROPERTY_INVALID,
      type: MODEL_VALIDATION_CODES.COMPUTED_FIELD_EXPRESSION_TYPE,
    },
    diagnostics,
  );

  if (
    expressionType !== "unknown" &&
    expressionType !== "null" &&
    expressionTypeToFieldType(expressionType) !== field.type
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMPUTED_FIELD_EXPRESSION_TYPE,
        `Computed field '${field.name}' on object '${object.name}' declares ${field.type} but expression resolves to ${expressionType}.`,
        `${fieldPath}.expression`,
      ),
    );
  }
}
function validateComputedFieldCycles(
  object: ResolvedObject,
  objectPath: string,
  computedFieldsByName: Map<string, NamedReference<ResolvedComputedField>>,
  diagnostics: Diagnostic[],
): void {
  const visiting: string[] = [];
  const visited = new Set<string>();
  const reported = new Set<string>();

  const visit = (field: ResolvedComputedField): void => {
    if (visited.has(field.name)) {
      return;
    }

    const existingIndex = visiting.indexOf(field.name);
    if (existingIndex >= 0) {
      const cycle = [...visiting.slice(existingIndex), field.name];
      const key = cycle.join(" -> ");
      if (!reported.has(key)) {
        reported.add(key);
        const fieldIndex = computedFieldsByName.get(field.name)?.index ?? 0;
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMPUTED_FIELD_CYCLE,
            `Computed field cycle detected on object '${object.name}': ${cycle.join(" -> ")}.`,
            `${objectPath}.computedFields[${fieldIndex}].expression`,
          ),
        );
      }
      return;
    }

    visiting.push(field.name);
    for (const dependency of field.dependencies) {
      const dependencyField = computedFieldsByName.get(dependency)?.item;
      if (dependencyField !== undefined) {
        visit(dependencyField);
      }
    }
    visiting.pop();
    visited.add(field.name);
  };

  for (const field of object.computedFields) {
    visit(field);
  }
}
