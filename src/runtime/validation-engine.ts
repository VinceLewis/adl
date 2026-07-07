import type {
  JsonValue,
  ResolvedApplicationModel,
  ResolvedField,
  ResolvedObject,
  ResolvedValidator,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import {
  RuntimeModelIndex,
  getInitialLifecycleState,
  getValuesState,
  isLifecycleStateBusinessField,
  setValuesState,
} from "./model-helpers.js";
import { RuntimeValidationError, cloneJson, noopRuntimeLogger } from "./runtime-types.js";
import type { RuntimeLogger, RuntimeValidationIssue } from "./runtime-types.js";

export class ValidationEngine {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  prepareCreateValues(
    objectName: string,
    values: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    this.logger.debug("ENTER ValidationEngine.prepareCreateValues", { objectName });
    const object = this.index.getObject(objectName);
    const issues: RuntimeValidationIssue[] = [];
    const output: Record<string, JsonValue> = {};

    this.copyProvidedValues(object, values, output, issues, "values", true);
    this.applyFieldDefaults(object, output);
    this.applyInitialLifecycleState(object, output, values, issues);
    this.validateRecordValues(object, output, issues, "values");
    this.throwIfInvalid(issues, `Record for object '${objectName}' is invalid.`);
    this.logger.debug("EXIT ValidationEngine.prepareCreateValues", { objectName });

    return output;
  }

  prepareUpdateValues(
    objectName: string,
    record: StoredObjectRecord,
    patch: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    this.logger.debug("ENTER ValidationEngine.prepareUpdateValues", {
      objectName,
      recordId: record.meta.guid,
    });
    const object = this.index.getObject(objectName);
    const issues: RuntimeValidationIssue[] = [];
    const output = cloneJson(record.values);

    this.copyProvidedValues(object, patch, output, issues, "patch", false);
    this.validateRecordValues(object, output, issues, "values");
    this.throwIfInvalid(issues, `Patch for object '${objectName}' is invalid.`);
    this.logger.debug("EXIT ValidationEngine.prepareUpdateValues", {
      objectName,
      recordId: record.meta.guid,
    });

    return output;
  }

  prepareTransitionValues(
    objectName: string,
    record: StoredObjectRecord,
    targetState: string,
  ): Record<string, JsonValue> {
    this.logger.debug("ENTER ValidationEngine.prepareTransitionValues", {
      objectName,
      recordId: record.meta.guid,
      targetState,
    });
    const object = this.index.getObject(objectName);
    const issues: RuntimeValidationIssue[] = [];
    const output = setValuesState(object, record.values, targetState);

    this.validateLifecycleStateValue(object, targetState, issues, "lifecycle.to");
    this.validateRecordValues(object, output, issues, "values");
    this.throwIfInvalid(issues, `Lifecycle transition for object '${objectName}' is invalid.`);
    this.logger.debug("EXIT ValidationEngine.prepareTransitionValues", {
      objectName,
      recordId: record.meta.guid,
      targetState,
    });

    return output;
  }

  private copyProvidedValues(
    object: ResolvedObject,
    source: Record<string, JsonValue>,
    target: Record<string, JsonValue>,
    issues: RuntimeValidationIssue[],
    path: string,
    isCreate: boolean,
  ): void {
    for (const [fieldName, value] of Object.entries(source)) {
      const field = this.index.getBusinessField(object, fieldName);

      if (field === undefined) {
        issues.push({
          code: "ADL_RUNTIME_FIELD_UNKNOWN",
          message: `Field '${fieldName}' does not exist on object '${object.name}'.`,
          path: `${path}.${fieldName}`,
          field: fieldName,
        });
        continue;
      }

      if (field.readonly) {
        issues.push({
          code: "ADL_RUNTIME_FIELD_READONLY",
          message: `Field '${fieldName}' is readonly on object '${object.name}'.`,
          path: `${path}.${fieldName}`,
          field: fieldName,
        });
        continue;
      }

      if (!isCreate && object.lifecycle?.stateField === fieldName) {
        issues.push({
          code: "ADL_RUNTIME_LIFECYCLE_STATE_DIRECT_UPDATE",
          message: `Lifecycle state field '${fieldName}' must be changed through a transition.`,
          path: `${path}.${fieldName}`,
          field: fieldName,
        });
        continue;
      }

      target[fieldName] = cloneJson(value);
    }
  }

  private applyFieldDefaults(object: ResolvedObject, values: Record<string, JsonValue>): void {
    for (const field of object.fields) {
      if (values[field.name] === undefined && field.defaultValue !== undefined) {
        values[field.name] = cloneJson(field.defaultValue);
      }
    }
  }

  private applyInitialLifecycleState(
    object: ResolvedObject,
    output: Record<string, JsonValue>,
    providedValues: Record<string, JsonValue>,
    issues: RuntimeValidationIssue[],
  ): void {
    if (object.lifecycle === undefined || !isLifecycleStateBusinessField(object)) {
      return;
    }

    const initialState = getInitialLifecycleState(object);
    const stateField = object.lifecycle.stateField;
    const providedState = providedValues[stateField];

    if (initialState === undefined) {
      return;
    }

    if (providedState === undefined || providedState === null || providedState === "") {
      output[stateField] = initialState;
      return;
    }

    if (providedState !== initialState) {
      issues.push({
        code: "ADL_RUNTIME_LIFECYCLE_INITIAL_STATE",
        message: `Lifecycle state field '${stateField}' must start in '${initialState}'.`,
        path: `values.${stateField}`,
        field: stateField,
      });
    }
  }

  private validateRecordValues(
    object: ResolvedObject,
    values: Record<string, JsonValue>,
    issues: RuntimeValidationIssue[],
    path: string,
  ): void {
    for (const field of object.fields) {
      const value = values[field.name];

      if (field.required && isMissingRequiredValue(value)) {
        issues.push({
          code: "ADL_RUNTIME_FIELD_REQUIRED",
          message: `Field '${field.name}' is required on object '${object.name}'.`,
          path: `${path}.${field.name}`,
          field: field.name,
        });
        continue;
      }

      if (value === undefined || value === null) {
        continue;
      }

      if (!isValueCompatible(field, value)) {
        issues.push({
          code: "ADL_RUNTIME_FIELD_TYPE",
          message: `Field '${field.name}' expects a ${field.type} value.`,
          path: `${path}.${field.name}`,
          field: field.name,
        });
        continue;
      }

      for (const validator of field.validators) {
        const validatorIssue = validateFieldValue(field, value, validator, `${path}.${field.name}`);
        if (validatorIssue !== undefined) {
          issues.push(validatorIssue);
        }
      }
    }

    const state = getValuesState(object, values);
    if (state !== undefined) {
      this.validateLifecycleStateValue(
        object,
        state,
        issues,
        `${path}.${object.lifecycle?.stateField}`,
      );
    }
  }

  private validateLifecycleStateValue(
    object: ResolvedObject,
    state: string,
    issues: RuntimeValidationIssue[],
    path: string,
  ): void {
    const lifecycle = object.lifecycle;

    if (lifecycle === undefined) {
      return;
    }

    if (!lifecycle.states.some((candidate) => candidate.name === state)) {
      issues.push({
        code: "ADL_RUNTIME_LIFECYCLE_STATE_INVALID",
        message: `Lifecycle state '${state}' is not valid for object '${object.name}'.`,
        path,
        field: lifecycle.stateField,
      });
    }
  }

  private throwIfInvalid(issues: RuntimeValidationIssue[], message: string): void {
    if (issues.length > 0) {
      throw new RuntimeValidationError(message, issues);
    }
  }
}

function isMissingRequiredValue(value: JsonValue | undefined): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

function isValueCompatible(field: ResolvedField, value: JsonValue): boolean {
  switch (field.type) {
    case "text":
    case "date":
    case "datetime":
    case "time":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "attachment":
      return typeof value === "string" || Array.isArray(value) || isJsonObject(value);
  }
}

function validateFieldValue(
  field: ResolvedField,
  value: JsonValue,
  validator: ResolvedValidator,
  path: string,
): RuntimeValidationIssue | undefined {
  const invalid = (message: string): RuntimeValidationIssue => ({
    code: "ADL_RUNTIME_FIELD_VALIDATOR",
    message,
    path,
    field: field.name,
  });

  switch (validator.kind) {
    case "email":
      return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? undefined
        : invalid(`Field '${field.name}' must contain an email address.`);
    case "min":
      return typeof value === "number" &&
        typeof validator.value === "number" &&
        value < validator.value
        ? invalid(`Field '${field.name}' must be at least ${validator.value}.`)
        : undefined;
    case "max":
      return typeof value === "number" &&
        typeof validator.value === "number" &&
        value > validator.value
        ? invalid(`Field '${field.name}' must be at most ${validator.value}.`)
        : undefined;
    case "minLength":
      return typeof value === "string" &&
        typeof validator.value === "number" &&
        value.length < validator.value
        ? invalid(`Field '${field.name}' is shorter than ${validator.value} characters.`)
        : undefined;
    case "maxLength":
      return typeof value === "string" &&
        typeof validator.value === "number" &&
        value.length > validator.value
        ? invalid(`Field '${field.name}' is longer than ${validator.value} characters.`)
        : undefined;
    case "in":
      return Array.isArray(validator.value) &&
        !validator.value.some((candidate) => jsonEquals(candidate, value))
        ? invalid(`Field '${field.name}' contains a value outside the allowed set.`)
        : undefined;
    case "regexp":
      return typeof value === "string" &&
        typeof validator.value === "string" &&
        !new RegExp(validator.value).test(value)
        ? invalid(`Field '${field.name}' does not match the required pattern.`)
        : undefined;
    case "currencyCode":
      return typeof value === "string" && /^[A-Z]{3}$/.test(value)
        ? undefined
        : invalid(`Field '${field.name}' must contain an ISO-style currency code.`);
    case "maxSize":
      return getApproximateSize(value) > getNumericValidatorValue(validator)
        ? invalid(`Field '${field.name}' is larger than the allowed size.`)
        : undefined;
    case "mimeType":
      return hasAllowedMimeType(value, validator.value)
        ? undefined
        : invalid(`Field '${field.name}' has a disallowed MIME type.`);
  }
}

function getNumericValidatorValue(validator: ResolvedValidator): number {
  return typeof validator.value === "number" ? validator.value : Number.POSITIVE_INFINITY;
}

function getApproximateSize(value: JsonValue): number {
  return typeof value === "string" ? value.length : JSON.stringify(value).length;
}

function hasAllowedMimeType(value: JsonValue, allowed: JsonValue | undefined): boolean {
  if (!isJsonObject(value) || typeof value.mimeType !== "string") {
    return true;
  }

  if (typeof allowed === "string") {
    return value.mimeType === allowed;
  }

  return Array.isArray(allowed) && allowed.includes(value.mimeType);
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
