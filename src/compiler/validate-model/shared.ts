import type {
  ConflictStrategy,
  ExpressionValueType,
  FieldType,
  ResolvedBusinessContext,
  ResolvedCommand,
  ResolvedCommandInput,
  ResolvedComputedField,
  ResolvedDecisionTable,
  ResolvedField,
  ResolvedObject,
  ResolvedPolicy,
  ResolvedReadModel,
  ResolvedTheme,
  SyncMode,
  SyncScope,
  ViewContextMode,
} from "../../model/resolved-model.js";
import type { Diagnostic, DiagnosticSeverity, ModelValidationCode } from "./codes.js";
import { isQueueableSyncMode } from "./sync.js";

export const FIELD_TYPES = new Set<FieldType>([
  "text",
  "number",
  "date",
  "datetime",
  "time",
  "boolean",
  "attachment",
]);
export const VIEW_CONTEXT_MODES = new Set<ViewContextMode>(["none", "required", "optional", "all"]);
export const SYNC_MODES = new Set<SyncMode>([
  "localFirst",
  "cacheReadonly",
  "onlineRequired",
  "localPrivate",
]);
/*
 * Whether an accepted write of this mode is handed to the sync queue for
 * delivery to the authority. This deliberately restates `isQueueableSyncMode`
 * from `src/runtime/sync-policy-service.ts` rather than importing it: the
 * compiler depends on the model only, and inverting that layering for two lines
 * would cost more than the duplication does. The two must change together, so
 * the set of queueing modes is stated in both places or neither.
 */
export const SYNC_SCOPES = new Set<SyncScope>([
  "all",
  "currentUser",
  "assignedToUser",
  "ownedByUser",
  "currentContext",
  "allAvailableContexts",
  "recent",
  "custom",
]);
export const CONFLICT_STRATEGIES = new Set<ConflictStrategy>([
  "serverWins",
  "clientWins",
  "stateTransitionWins",
  "manual",
]);
export interface NamedReference<T> {
  item: T;
  index: number;
}
export type ExpressionFieldReference = Pick<ResolvedField | ResolvedComputedField, "type">;
export interface ModelIndexes {
  contextsByName: Map<string, NamedReference<ResolvedBusinessContext>>;
  commandsByName: Map<string, NamedReference<ResolvedCommand>>;
  decisionTablesByName: Map<string, NamedReference<ResolvedDecisionTable>>;
  objectsByName: Map<string, NamedReference<ResolvedObject>>;
  policiesByName: Map<string, NamedReference<ResolvedPolicy>>;
  readModelsByName: Map<string, NamedReference<ResolvedReadModel>>;
  themesByName: Map<string, NamedReference<ResolvedTheme>>;
  viewNames: Set<string>;
}
export type ExpressionStaticType = ExpressionValueType | "unknown";
export function reportDuplicateNames(
  items: { name: string }[],
  path: string,
  code: ModelValidationCode,
  diagnostics: Diagnostic[],
  message: string,
): void {
  const firstSeen = new Map<string, number>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) {
      continue;
    }

    const firstIndex = firstSeen.get(item.name);
    if (firstIndex === undefined) {
      firstSeen.set(item.name, index);
      continue;
    }

    diagnostics.push(
      diagnostic(
        code,
        `${message} '${item.name}' also appears at ${path}[${firstIndex}].`,
        `${path}[${index}].name`,
      ),
    );
  }
}
export function indexByName<T extends { name: string }>(
  items: T[],
): Map<string, NamedReference<T>> {
  const byName = new Map<string, NamedReference<T>>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined || byName.has(item.name)) {
      continue;
    }
    byName.set(item.name, { item, index });
  }

  return byName;
}
export function indexObjectExpressionFields(
  object: ResolvedObject,
): Map<string, NamedReference<ExpressionFieldReference>> {
  const fields = new Map<string, NamedReference<ExpressionFieldReference>>();

  for (const [name, reference] of indexByName(object.fields)) {
    fields.set(name, reference);
  }
  for (const [name, reference] of indexByName(object.computedFields)) {
    fields.set(name, reference);
  }

  return fields;
}
export function indexReadModelExpressionFields(
  readModel: ResolvedReadModel,
): Map<string, NamedReference<ExpressionFieldReference>> {
  const fields = new Map<string, NamedReference<ExpressionFieldReference>>();

  for (let fieldIndex = 0; fieldIndex < readModel.fields.length; fieldIndex += 1) {
    const field = readModel.fields[fieldIndex];
    if (field === undefined || fields.has(field.name)) {
      continue;
    }
    fields.set(field.name, {
      item: expressionTypeField(field.name, field.type ?? "text"),
      index: fieldIndex,
    });
  }

  return fields;
}
export function commandInputFieldsByName(
  inputs: ResolvedCommandInput[],
): Map<string, NamedReference<ResolvedField>> {
  return indexByName(inputs.map((input) => expressionTypeField(input.name, input.type)));
}
export function expressionTypeField(
  name: string,
  type: ExpressionStaticType | FieldType,
): ResolvedField {
  const fieldType: FieldType =
    type === "number" ||
    type === "date" ||
    type === "datetime" ||
    type === "time" ||
    type === "boolean"
      ? type
      : "text";

  return {
    name,
    storageName: name,
    type: fieldType,
    required: false,
    validators: [],
    readonly: false,
    hidden: false,
    systemManaged: false,
  };
}
export function expressionTypeToFieldType(type: ExpressionStaticType): FieldType | undefined {
  switch (type) {
    case "text":
    case "number":
    case "date":
    case "datetime":
    case "time":
    case "boolean":
      return type;
    case "null":
    case "unknown":
      return undefined;
  }
}
export function isDefaultCompatible(field: ResolvedField, value: unknown): boolean {
  if (!FIELD_TYPES.has(field.type)) {
    return false;
  }

  if (value === null) {
    return !field.required;
  }

  return isValueCompatibleWithFieldType(field.type, value);
}
export function isValueCompatibleWithFieldType(type: FieldType, value: unknown): boolean {
  if (!FIELD_TYPES.has(type)) {
    return false;
  }

  if (value === null) {
    return true;
  }

  switch (type) {
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
      return typeof value === "string" || isJsonObject(value) || Array.isArray(value);
  }
}
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
export function diagnostic(
  code: ModelValidationCode,
  message: string,
  path?: string,
  severity: DiagnosticSeverity = "error",
): Diagnostic {
  return {
    severity,
    code,
    message,
    ...(path === undefined ? {} : { path }),
  };
}
