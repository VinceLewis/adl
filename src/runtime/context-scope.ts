import type { JsonValue, ResolvedObject, StoredObjectRecord } from "../model/resolved-model.js";
import type { RuntimeModelIndex } from "./model-helpers.js";
import { PolicyDeniedError } from "./runtime-types.js";
import type {
  PolicyDecision,
  PolicyRequest,
  RuntimeAction,
  RuntimeContext,
  RuntimeContextRole,
} from "./runtime-types.js";

export interface RuntimeContextTarget {
  context: string;
  contextId: string;
}

export function getSelectedContextId(
  context: RuntimeContext,
  contextName: string,
): string | undefined {
  const selected = context.selectedContexts?.[contextName];
  return selected === undefined || selected.length === 0 ? undefined : selected;
}

export function getAllowedContextIds(context: RuntimeContext, contextName: string): string[] {
  const selected = getSelectedContextId(context, contextName);
  if (selected !== undefined) {
    return [selected];
  }

  return uniqueStrings(
    (context.contextRoles ?? [])
      .filter((entry) => entry.context === contextName && entry.contextId.length > 0)
      .map((entry) => entry.contextId),
  );
}

export function runtimeContextHasScopedRole(
  index: RuntimeModelIndex,
  context: RuntimeContext,
  target: RuntimeContextTarget,
  role: string,
): boolean {
  const selected = getSelectedContextId(context, target.context);
  if (selected !== undefined && selected !== target.contextId) {
    return false;
  }

  return (context.contextRoles ?? []).some(
    (entry) =>
      entry.context === target.context &&
      entry.contextId === target.contextId &&
      contextRoleIncludes(index, entry, role),
  );
}

export function getPolicyRequestContextTargets(
  index: RuntimeModelIndex,
  request: PolicyRequest,
  context: RuntimeContext,
): RuntimeContextTarget[] {
  const object = index.getObject(request.objectName);

  const scope = object.scope;
  if (scope !== undefined) {
    const contextId =
      request.record === undefined
        ? getStringValue(request.patch?.[scope.field])
        : getStringValue(request.record.values[scope.field]);

    if (contextId !== undefined) {
      return [{ context: scope.context, contextId }];
    }

    if (request.action === "search") {
      return getAllowedContextIds(context, scope.context).map((id) => ({
        context: scope.context,
        contextId: id,
      }));
    }

    return [];
  }

  if (request.record !== undefined) {
    return index
      .getBusinessContextsForObject(object.name)
      .map((businessContext) => ({
        context: businessContext.name,
        contextId: request.record?.meta.guid ?? "",
      }))
      .filter((target) => target.contextId.length > 0);
  }

  if (request.action === "search") {
    return index.getBusinessContextsForObject(object.name).flatMap((businessContext) =>
      getAllowedContextIds(context, businessContext.name).map((contextId) => ({
        context: businessContext.name,
        contextId,
      })),
    );
  }

  return [];
}

export function requireObjectScopeForValues(
  index: RuntimeModelIndex,
  objectName: string,
  values: Record<string, JsonValue>,
  context: RuntimeContext,
  action: RuntimeAction,
): void {
  const object = index.getObject(objectName);
  if (object.scope === undefined) {
    return;
  }

  const contextId = getStringValue(values[object.scope.field]);
  if (objectScopeAllowsContextId(object, context, contextId)) {
    return;
  }

  throw createObjectScopeDeniedError(object, action, contextId, context);
}

export function requireObjectScopeForRecord(
  index: RuntimeModelIndex,
  objectName: string,
  record: StoredObjectRecord,
  context: RuntimeContext,
  action: RuntimeAction,
): void {
  const object = index.getObject(objectName);
  if (object.scope === undefined) {
    return;
  }

  const contextId = getStringValue(record.values[object.scope.field]);
  if (objectScopeAllowsContextId(object, context, contextId)) {
    return;
  }

  throw createObjectScopeDeniedError(object, action, contextId, context);
}

export function requireObjectScopeForSearch(
  index: RuntimeModelIndex,
  objectName: string,
  context: RuntimeContext,
): void {
  const object = index.getObject(objectName);
  if (
    object.scope === undefined ||
    getAllowedContextIds(context, object.scope.context).length > 0
  ) {
    return;
  }

  throw createObjectScopeDeniedError(object, "search", undefined, context);
}

export function recordMatchesObjectScope(
  index: RuntimeModelIndex,
  objectName: string,
  record: StoredObjectRecord,
  context: RuntimeContext,
): boolean {
  const object = index.getObject(objectName);
  if (object.scope === undefined) {
    return true;
  }

  return objectScopeAllowsContextId(
    object,
    context,
    getStringValue(record.values[object.scope.field]),
  );
}

function objectScopeAllowsContextId(
  object: ResolvedObject,
  context: RuntimeContext,
  contextId: string | undefined,
): boolean {
  return (
    contextId !== undefined &&
    object.scope !== undefined &&
    getAllowedContextIds(context, object.scope.context).includes(contextId)
  );
}

function contextRoleIncludes(
  index: RuntimeModelIndex,
  entry: RuntimeContextRole,
  requestedRole: string,
): boolean {
  return index.expandRoles([entry.role]).includes(requestedRole);
}

function createObjectScopeDeniedError(
  object: ResolvedObject,
  action: RuntimeAction,
  targetContextId: string | undefined,
  context: RuntimeContext,
): PolicyDeniedError {
  const decision: PolicyDecision = {
    effect: "deny",
    reasons: [
      {
        policyName: `${object.name}ContextScope`,
        ruleName: "requireRuntimeContextScope",
        effect: "deny",
        message: contextScopeDeniedMessage(object, action, targetContextId, context),
      },
    ],
  };

  return new PolicyDeniedError(
    `Policy denied ${action} on object '${object.name}' outside its runtime context scope.`,
    decision,
  );
}

function contextScopeDeniedMessage(
  object: ResolvedObject,
  action: RuntimeAction,
  targetContextId: string | undefined,
  context: RuntimeContext,
): string {
  const scope = object.scope;
  if (scope === undefined) {
    return `Object '${object.name}' has no runtime context scope for ${action}.`;
  }

  const allowed = getAllowedContextIds(context, scope.context);
  if (allowed.length === 0) {
    return `Object '${object.name}' is scoped to context '${scope.context}', but the runtime context has no selected or resolved context instance for ${action}.`;
  }

  if (targetContextId === undefined) {
    return `Object '${object.name}' is scoped to context '${scope.context}', but field '${scope.field}' did not contain a string context id.`;
  }

  return `Object '${object.name}' is scoped to context '${scope.context}' instance '${targetContextId}', which is outside the runtime context.`;
}

function getStringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
