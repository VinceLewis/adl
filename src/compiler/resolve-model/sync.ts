import {
  createDefaultObjectAuditPolicy,
  createDefaultObjectSyncPolicy,
} from "../../model/defaults.js";
import type {
  PartialObjectModel,
  PartialObjectSyncPolicyModel,
  PartialSyncPolicyModel,
  PartialSyncWindowModel,
  ResolvedObjectAuditPolicy,
  ResolvedObjectSyncPolicy,
  ResolvedSyncWindow,
} from "../../model/resolved-model.js";

export function resolveObjectSync(
  input: PartialObjectSyncPolicyModel | undefined,
): ResolvedObjectSyncPolicy {
  const defaults = createDefaultObjectSyncPolicy();
  const scope = input?.scope ?? defaults.scope;
  const window = resolveSyncWindow(input?.window, scope);
  return {
    mode: input?.mode ?? defaults.mode,
    scope,
    ...(window === undefined ? {} : { window }),
    // The predicate is carried through untouched: a `custom` scope has no
    // default record selection to fall back on, which is why validation refuses
    // the scope without one rather than resolving a permissive stand-in.
    ...(input?.predicate === undefined ? {} : { predicate: input.predicate }),
    conflict: input?.conflict ?? defaults.conflict,
  };
}
function resolveSyncWindow(
  input: PartialSyncWindowModel | undefined,
  scope: ResolvedObjectSyncPolicy["scope"],
): ResolvedSyncWindow | undefined {
  if (input !== undefined) {
    return {
      field: input.field ?? "_updatedAt",
      ...(input.days === undefined ? {} : { days: input.days }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      windowSource: "authored",
    };
  }

  // A window may accompany any scope, so this is not "the scope that has a
  // window" — it is the one scope that *implies* one. `recent` is retained as a
  // spelling for available-contexts plus a default 30-day window over
  // `_updatedAt`, which is what a bare `SCOPE recent` has always meant. Every
  // other scope bounds nothing unless the model says so.
  return scope === "recent"
    ? { field: "_updatedAt", days: 30, windowSource: "impliedByScope" }
    : undefined;
}
export function resolveObjectAudit(
  input: PartialObjectModel["audit"] | undefined,
): ResolvedObjectAuditPolicy {
  const defaults = createDefaultObjectAuditPolicy();
  return {
    enabled: input?.enabled ?? defaults.enabled,
    operations: [...(input?.operations ?? defaults.operations)],
  };
}
export function stripObjectFromSync(
  input: PartialSyncPolicyModel | undefined,
): PartialObjectSyncPolicyModel | undefined {
  if (input === undefined) {
    return undefined;
  }

  return {
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.window === undefined ? {} : { window: input.window }),
    ...(input.predicate === undefined ? {} : { predicate: input.predicate }),
    ...(input.conflict === undefined ? {} : { conflict: input.conflict }),
  };
}
