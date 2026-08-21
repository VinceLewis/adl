import {
  ADL_MODEL_VERSION,
  DEFAULT_OFFLINE_GRACE_DAYS,
  DEFAULT_THEME_NAME,
  createDefaultAuditModel,
  createDefaultModelDefaults,
  createDefaultOperationLogModel,
} from "../../model/defaults.js";
import { computeModelFingerprint } from "../../model/fingerprint.js";
import type {
  PartialApplicationModel,
  ResolvedApplicationModel,
} from "../../model/resolved-model.js";
import { uniqueStrings } from "./shared.js";
import { resolveModelMigrations } from "./core.js";
import { resolveShell } from "./shell.js";
import { resolveBusinessContexts, resolveRoles } from "./context.js";
import { resolveObject } from "./object-field.js";
import { groupPolicyNamesByObject, resolvePolicies } from "./policy.js";
import { resolveReadModels } from "./read-model.js";
import { resolveDecisionTables } from "./decision-table.js";
import { resolveCommands } from "./command.js";
import { resolveThemes } from "./theme.js";

export function resolveApplicationModel(input: PartialApplicationModel): ResolvedApplicationModel {
  const themes = resolveThemes(input.themes ?? []);
  const topLevelSync = new Map((input.sync ?? []).map((policy) => [policy.object, policy]));
  const partialPolicies = input.policies ?? [];
  const contexts =
    input.contexts === undefined ? undefined : resolveBusinessContexts(input.contexts);
  const objects = input.objects.map((object) =>
    resolveObject(object, topLevelSync.get(object.name), partialPolicies),
  );
  const policies = resolvePolicies(objects, partialPolicies);
  const objectNamesToPolicies = groupPolicyNamesByObject(policies);
  const objectsWithPolicies = objects.map((object) => ({
    ...object,
    policies: uniqueStrings([
      ...(objectNamesToPolicies.get(object.name) ?? []),
      ...object.policies,
    ]),
  }));
  const readModels =
    input.readModels === undefined
      ? undefined
      : resolveReadModels(input.readModels, objectsWithPolicies);
  const decisionTables =
    input.decisionTables === undefined || input.decisionTables.length === 0
      ? undefined
      : resolveDecisionTables(input.decisionTables);
  const commands =
    input.commands === undefined || input.commands.length === 0
      ? undefined
      : resolveCommands(input.commands);
  const sync = objectsWithPolicies.map((object) => ({
    object: object.name,
    ...object.sync,
  }));
  const startView = input.app.startView ?? objectsWithPolicies[0]?.views[0]?.name ?? "";
  const shell = resolveShell(input.shell, objectsWithPolicies);

  const withoutFingerprint: Omit<ResolvedApplicationModel, "modelFingerprint"> = {
    modelVersion: input.modelVersion ?? ADL_MODEL_VERSION,
    app: {
      name: input.app.name,
      startView,
      theme: input.app.theme ?? DEFAULT_THEME_NAME,
      offlineGraceDays: input.app.offlineGraceDays ?? DEFAULT_OFFLINE_GRACE_DAYS,
      // Deliberately *not* defaulted the way `offlineGraceDays` is. Absent
      // means `inviteOnly`, and materialising that would put a new key in
      // every resolved model in the repository and move every
      // `modelFingerprint` — including apps whose behaviour did not change.
      // Same precedent as context/read-model optional top-level properties.
      ...(input.app.registration === undefined ? {} : { registration: input.app.registration }),
    },
    shell,
    roles: resolveRoles(input.roles ?? []),
    ...(contexts === undefined ? {} : { contexts }),
    objects: objectsWithPolicies,
    ...(readModels === undefined ? {} : { readModels }),
    ...(decisionTables === undefined ? {} : { decisionTables }),
    ...(commands === undefined ? {} : { commands }),
    policies,
    themes,
    sync,
    audit: createDefaultAuditModel(),
    operationLog: createDefaultOperationLogModel(),
    migrations: resolveModelMigrations(input.migrations ?? []),
    defaults: createDefaultModelDefaults(),
  };

  // Computed last and over everything else, so the digest covers exactly the
  // content that was resolved, and excluding the field itself so it is never
  // its own input.
  return {
    ...withoutFingerprint,
    modelFingerprint: computeModelFingerprint(withoutFingerprint),
  };
}
