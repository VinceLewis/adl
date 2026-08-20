import { DEFAULT_LIFECYCLE_STATE_FIELD } from "../../model/defaults.js";
import type {
  ResolvedField,
  ResolvedHookRefs,
  ResolvedLifecycle,
  ResolvedLifecycleGuard,
  ResolvedObject,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import {
  CONFLICT_STRATEGIES,
  SYNC_MODES,
  SYNC_SCOPES,
  diagnostic,
  indexByName,
  reportDuplicateNames,
} from "./shared.js";
import type { ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";
import { validateSyncScopeSelection, validateSyncWindow } from "./sync.js";

const HOOK_REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
export function validateLifecycle(
  lifecycle: ResolvedLifecycle,
  object: ResolvedObject,
  objectPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const lifecyclePath = `${objectPath}.lifecycle`;
  const fieldsByName = indexByName(object.fields);
  const metadataFieldsByName = indexByName(object.metadataFields);
  const lifecycleStateField = fieldsByName.get(lifecycle.stateField)?.item;
  const metadataStateField = metadataFieldsByName.get(lifecycle.stateField)?.item;
  const usesAllowedMetadataStateField =
    lifecycle.stateField === DEFAULT_LIFECYCLE_STATE_FIELD && metadataStateField !== undefined;

  if (lifecycleStateField === undefined && !usesAllowedMetadataStateField) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.LIFECYCLE_STATE_FIELD_UNKNOWN,
        `Lifecycle state field '${lifecycle.stateField}' does not exist on object '${object.name}'.`,
        `${lifecyclePath}.stateField`,
      ),
    );
  } else if (
    (lifecycleStateField !== undefined && lifecycleStateField.type !== "text") ||
    (usesAllowedMetadataStateField && metadataStateField?.type !== "text")
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.LIFECYCLE_STATE_FIELD_TYPE_INVALID,
        `Lifecycle state field '${lifecycle.stateField}' on object '${object.name}' must be a text field.`,
        `${lifecyclePath}.stateField`,
      ),
    );
  }

  reportDuplicateNames(
    lifecycle.states,
    `${lifecyclePath}.states`,
    MODEL_VALIDATION_CODES.LIFECYCLE_STATE_DUPLICATE,
    diagnostics,
    `Lifecycle state names must be unique on object '${object.name}'.`,
  );
  reportDuplicateNames(
    lifecycle.actions,
    `${lifecyclePath}.actions`,
    MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_DUPLICATE,
    diagnostics,
    `Lifecycle action names must be unique on object '${object.name}'.`,
  );

  const statesByName = indexByName(lifecycle.states);

  if (lifecycle.initialState !== undefined && !statesByName.has(lifecycle.initialState)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.LIFECYCLE_INITIAL_STATE_UNKNOWN,
        `Initial lifecycle state '${lifecycle.initialState}' does not exist on object '${object.name}'.`,
        `${lifecyclePath}.initialState`,
      ),
    );
  }

  for (let actionIndex = 0; actionIndex < lifecycle.actions.length; actionIndex += 1) {
    const action = lifecycle.actions[actionIndex];
    if (action === undefined) {
      continue;
    }
    const actionPath = `${lifecyclePath}.actions[${actionIndex}]`;

    for (let fromIndex = 0; fromIndex < action.from.length; fromIndex += 1) {
      const fromState = action.from[fromIndex];
      if (fromState === undefined) {
        continue;
      }
      if (!statesByName.has(fromState)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_FROM_UNKNOWN,
            `Lifecycle action '${action.name}' references unknown from-state '${fromState}'.`,
            `${actionPath}.from[${fromIndex}]`,
          ),
        );
      }
    }

    if (!statesByName.has(action.to)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_TO_UNKNOWN,
          `Lifecycle action '${action.name}' references unknown to-state '${action.to}'.`,
          `${actionPath}.to`,
        ),
      );
    }

    for (let guardIndex = 0; guardIndex < action.guards.length; guardIndex += 1) {
      const guard = action.guards[guardIndex];
      if (guard === undefined) {
        continue;
      }
      validateLifecycleGuard(
        guard,
        `${actionPath}.guards[${guardIndex}]`,
        action.name,
        fieldsByName,
        diagnostics,
      );
    }

    for (let policyRefIndex = 0; policyRefIndex < action.policyRefs.length; policyRefIndex += 1) {
      const policyRef = action.policyRefs[policyRefIndex];
      if (policyRef === undefined) {
        continue;
      }
      const policy = indexes.policiesByName.get(policyRef);
      if (policy === undefined) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_POLICY_UNKNOWN,
            `Lifecycle action '${action.name}' references unknown policy '${policyRef}'.`,
            `${actionPath}.policyRefs[${policyRefIndex}]`,
          ),
        );
      } else if (policy.item.object !== object.name) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_POLICY_MISMATCH,
            `Lifecycle action '${action.name}' references policy '${policyRef}', but that policy does not apply to object '${object.name}'.`,
            `${actionPath}.policyRefs[${policyRefIndex}]`,
          ),
        );
      }
    }

    validateHookRefs(action.hooks, `${actionPath}.hooks`, diagnostics);
  }
}
function validateLifecycleGuard(
  guard: ResolvedLifecycleGuard,
  guardPath: string,
  actionName: string,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): void {
  const expressionType = validateExpression(
    guard.expression,
    `${guardPath}.expression`,
    fieldsByName,
    {
      invalid: MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_GUARD_INVALID,
      field: MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_GUARD_FIELD_UNKNOWN,
      runtime: MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_GUARD_RUNTIME_PROPERTY_INVALID,
      type: MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_GUARD_TYPE,
    },
    diagnostics,
  );

  if (expressionType !== "boolean" && expressionType !== "unknown") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.LIFECYCLE_ACTION_GUARD_TYPE,
        `Lifecycle action '${actionName}' guard '${guard.name}' must resolve to boolean, not ${expressionType}.`,
        `${guardPath}.expression`,
      ),
    );
  }
}
export function validateObjectPolicyReferences(
  object: ResolvedObject,
  objectPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  for (let policyIndex = 0; policyIndex < object.policies.length; policyIndex += 1) {
    const policyName = object.policies[policyIndex];
    if (policyName === undefined) {
      continue;
    }
    const policy = indexes.policiesByName.get(policyName);

    if (policy === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_POLICY_UNKNOWN,
          `Object '${object.name}' references unknown policy '${policyName}'.`,
          `${objectPath}.policies[${policyIndex}]`,
        ),
      );
    } else if (policy.item.object !== object.name) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_POLICY_MISMATCH,
          `Object '${object.name}' references policy '${policyName}', but that policy applies to object '${policy.item.object}'.`,
          `${objectPath}.policies[${policyIndex}]`,
        ),
      );
    }
  }
}
export function validateObjectSyncPolicy(
  object: ResolvedObject,
  objectPath: string,
  diagnostics: Diagnostic[],
): void {
  if (!SYNC_MODES.has(object.sync.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SYNC_MODE_INVALID,
        `Object '${object.name}' has invalid sync mode '${String(object.sync.mode)}'.`,
        `${objectPath}.sync.mode`,
      ),
    );
  }

  if (!SYNC_SCOPES.has(object.sync.scope)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SYNC_SCOPE_INVALID,
        `Object '${object.name}' has invalid sync scope '${String(object.sync.scope)}'.`,
        `${objectPath}.sync.scope`,
      ),
    );
  }

  if (!CONFLICT_STRATEGIES.has(object.sync.conflict)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SYNC_CONFLICT_INVALID,
        `Object '${object.name}' has invalid conflict strategy '${String(object.sync.conflict)}'.`,
        `${objectPath}.sync.conflict`,
      ),
    );
  }

  if (object.sync.window !== undefined) {
    validateSyncWindow(object.sync.window, object, `${objectPath}.sync.window`, diagnostics, {
      field: MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_FIELD_UNKNOWN,
      fieldType: MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_FIELD_NOT_TEMPORAL,
      days: MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_DAYS_INVALID,
      limit: MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_LIMIT_INVALID,
    });
  }

  validateSyncScopeSelection(object.sync, object, `${objectPath}.sync`, diagnostics, {
    predicateMissing: MODEL_VALIDATION_CODES.OBJECT_SYNC_PREDICATE_MISSING,
    predicateInvalid: MODEL_VALIDATION_CODES.OBJECT_SYNC_PREDICATE_INVALID,
    predicateField: MODEL_VALIDATION_CODES.OBJECT_SYNC_PREDICATE_FIELD_UNKNOWN,
    predicateRuntime: MODEL_VALIDATION_CODES.OBJECT_SYNC_PREDICATE_RUNTIME_PROPERTY_INVALID,
    predicateType: MODEL_VALIDATION_CODES.OBJECT_SYNC_PREDICATE_TYPE,
  });
}
function validateHookRefs(
  hooks: ResolvedHookRefs,
  hookPath: string,
  diagnostics: Diagnostic[],
): void {
  validateHookRefList(hooks.before, `${hookPath}.before`, diagnostics);
  validateHookRefList(hooks.after, `${hookPath}.after`, diagnostics);
  validateHookRefList(hooks.onError, `${hookPath}.onError`, diagnostics);
}
function validateHookRefList(
  hookRefs: string[],
  hookRefsPath: string,
  diagnostics: Diagnostic[],
): void {
  for (let hookIndex = 0; hookIndex < hookRefs.length; hookIndex += 1) {
    const hookRef = hookRefs[hookIndex];
    if (hookRef === undefined) {
      continue;
    }
    if (!HOOK_REFERENCE_PATTERN.test(hookRef)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.HOOK_REFERENCE_INVALID,
          `Hook reference '${hookRef}' is not syntactically valid.`,
          `${hookRefsPath}[${hookIndex}]`,
        ),
      );
    }
  }
}
