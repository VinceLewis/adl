import type {
  FieldType,
  ResolvedObject,
  ResolvedObjectSyncPolicy,
  ResolvedSyncPolicy,
  ResolvedSyncWindow,
  SyncMode,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic, ModelValidationCode } from "./codes.js";
import {
  CONFLICT_STRATEGIES,
  SYNC_MODES,
  SYNC_SCOPES,
  diagnostic,
  indexByName,
  isPositiveInteger,
} from "./shared.js";
import type { ModelIndexes } from "./shared.js";
import { validateExpression } from "./expression.js";

export function isQueueableSyncMode(mode: SyncMode): boolean {
  return mode === "localFirst" || mode === "onlineRequired";
}
export function validateSyncPolicy(
  sync: ResolvedSyncPolicy,
  syncPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!indexes.objectsByName.has(sync.object)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SYNC_OBJECT_UNKNOWN,
        `Sync policy references unknown object '${sync.object}'.`,
        `${syncPath}.object`,
      ),
    );
  }

  if (!SYNC_MODES.has(sync.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SYNC_MODE_INVALID,
        `Sync policy for object '${sync.object}' has invalid mode '${String(sync.mode)}'.`,
        `${syncPath}.mode`,
      ),
    );
  }

  if (!SYNC_SCOPES.has(sync.scope)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SYNC_SCOPE_INVALID,
        `Sync policy for object '${sync.object}' has invalid scope '${String(sync.scope)}'.`,
        `${syncPath}.scope`,
      ),
    );
  }

  if (!CONFLICT_STRATEGIES.has(sync.conflict)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.SYNC_CONFLICT_INVALID,
        `Sync policy for object '${sync.object}' has invalid conflict strategy '${String(sync.conflict)}'.`,
        `${syncPath}.conflict`,
      ),
    );
  }

  const object = indexes.objectsByName.get(sync.object)?.item;
  if (object === undefined) {
    return;
  }

  if (sync.window !== undefined) {
    validateSyncWindow(sync.window, object, `${syncPath}.window`, diagnostics, {
      field: MODEL_VALIDATION_CODES.SYNC_WINDOW_FIELD_UNKNOWN,
      fieldType: MODEL_VALIDATION_CODES.SYNC_WINDOW_FIELD_NOT_TEMPORAL,
      days: MODEL_VALIDATION_CODES.SYNC_WINDOW_DAYS_INVALID,
      limit: MODEL_VALIDATION_CODES.SYNC_WINDOW_LIMIT_INVALID,
    });
  }

  validateSyncScopeSelection(sync, object, syncPath, diagnostics, {
    predicateMissing: MODEL_VALIDATION_CODES.SYNC_PREDICATE_MISSING,
    predicateInvalid: MODEL_VALIDATION_CODES.SYNC_PREDICATE_INVALID,
    predicateField: MODEL_VALIDATION_CODES.SYNC_PREDICATE_FIELD_UNKNOWN,
    predicateRuntime: MODEL_VALIDATION_CODES.SYNC_PREDICATE_RUNTIME_PROPERTY_INVALID,
    predicateType: MODEL_VALIDATION_CODES.SYNC_PREDICATE_TYPE,
  });
}
/**
 * A sync scope selects *which context* an object is held for. A window and a
 * predicate are independent bounds saying *how much* of it a device keeps, and
 * either may accompany any scope: `SCOPE currentUser WINDOW Date 90 DAYS` is a
 * legal and useful thing to say. Phase 62 tied each bound to the one scope that
 * consulted it, which made "my records, recent" unsayable; Phase 64 untied them
 * and the runtime now gates on a bound's presence rather than on the scope word.
 *
 * What survives is the other direction of the same rule — a declared scope must
 * be one the runtime can honour. `custom` selects by a declared predicate and by
 * nothing else, so declaring it without one is still refused here rather than
 * silently selecting no records on every device.
 */
export function validateSyncScopeSelection(
  sync: ResolvedObjectSyncPolicy,
  object: ResolvedObject,
  syncPath: string,
  diagnostics: Diagnostic[],
  codes: {
    predicateMissing: ModelValidationCode;
    predicateInvalid: ModelValidationCode;
    predicateField: ModelValidationCode;
    predicateRuntime: ModelValidationCode;
    predicateType: ModelValidationCode;
  },
): void {
  if (sync.scope === "custom" && sync.predicate === undefined) {
    diagnostics.push(
      diagnostic(
        codes.predicateMissing,
        `Object '${object.name}' declares sync scope 'custom' without a predicate; declare 'SCOPE custom WHERE <expression>', or use scope 'currentUser', 'currentContext', 'allAvailableContexts', 'recent' or 'all'.`,
        `${syncPath}.scope`,
      ),
    );
  }

  if (sync.predicate === undefined) {
    return;
  }

  const predicateType = validateExpression(
    sync.predicate,
    `${syncPath}.predicate`,
    indexByName(object.fields),
    {
      invalid: codes.predicateInvalid,
      field: codes.predicateField,
      runtime: codes.predicateRuntime,
      type: codes.predicateType,
    },
    diagnostics,
  );

  if (predicateType !== "boolean" && predicateType !== "unknown") {
    diagnostics.push(
      diagnostic(
        codes.predicateType,
        `Object '${object.name}' sync predicate must resolve to boolean, not ${predicateType}.`,
        `${syncPath}.predicate`,
      ),
    );
  }
}
export function validateSyncWindow(
  window: ResolvedSyncWindow,
  object: ResolvedObject,
  windowPath: string,
  diagnostics: Diagnostic[],
  codes: {
    field: ModelValidationCode;
    fieldType: ModelValidationCode;
    days: ModelValidationCode;
    limit: ModelValidationCode;
  },
): void {
  const fieldTypes = new Map<string, FieldType>([
    ...object.fields.map((field) => [field.name, field.type] as const),
    ...object.metadataFields.map((field) => [field.name, field.type] as const),
  ]);
  const fieldType = fieldTypes.get(window.field);

  if (fieldType === undefined) {
    diagnostics.push(
      diagnostic(
        codes.field,
        `Sync window field '${window.field}' does not exist on object '${object.name}'.`,
        `${windowPath}.field`,
      ),
    );
  } else if (fieldType !== "date" && fieldType !== "datetime") {
    // A window is a span of days measured against a moment, so the field it
    // names has to hold one. Without this a model could declare a window over
    // any field it liked — `_syncStatus`, say — and get a silently empty
    // dataset, because the runtime parses the value as a date and a value that
    // is not one excludes the record.
    diagnostics.push(
      diagnostic(
        codes.fieldType,
        `Sync window field '${window.field}' on object '${object.name}' is '${fieldType}'; a window must be measured over a date or datetime field.`,
        `${windowPath}.field`,
      ),
    );
  }

  if (window.days !== undefined && !isPositiveInteger(window.days)) {
    diagnostics.push(
      diagnostic(
        codes.days,
        `Sync window days for object '${object.name}' must be a positive integer.`,
        `${windowPath}.days`,
      ),
    );
  }

  if (window.limit !== undefined && !isPositiveInteger(window.limit)) {
    diagnostics.push(
      diagnostic(
        codes.limit,
        `Sync window limit for object '${object.name}' must be a positive integer.`,
        `${windowPath}.limit`,
      ),
    );
  }
}
