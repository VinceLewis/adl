import {
  ADL_MODEL_VERSION,
  DEFAULT_LIFECYCLE_STATE_FIELD,
  DEFAULT_OBJECT_SCHEMA_VERSION,
  DEFAULT_THEME_NAME,
  SYSTEM_ID_FIELD,
  createBuiltInThemes,
  createDefaultAuditModel,
  createDefaultDenyPolicy,
  createDefaultModelDefaults,
  createDefaultObjectAuditPolicy,
  createDefaultObjectSyncPolicy,
  createDefaultOperationLogModel,
  createDefaultTheme,
  createEveryonePrincipal,
  createMetadataFields,
  getBuiltInTheme,
  toStorageName,
  toTableName,
} from "../model/defaults.js";
import type {
  PartialApplicationModel,
  PartialAutoIdModel,
  PartialBusinessContextModel,
  PartialCommandInputModel,
  PartialCommandModel,
  PartialCommandStepModel,
  PartialContextMembershipModel,
  PartialContextSelectionPolicyModel,
  PartialFieldModel,
  PartialHookRefsModel,
  PartialLifecycleActionModel,
  PartialLifecycleModel,
  PartialLookupModel,
  PartialObjectConstraintModel,
  PartialObjectModel,
  PartialObjectScopeModel,
  PartialObjectSyncPolicyModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialPrincipalSelectorModel,
  PartialReadModelFieldModel,
  PartialReadModelModel,
  PartialReadModelSourceModel,
  PartialStateModel,
  PartialSyncPolicyModel,
  PartialSyncWindowModel,
  PartialThemeModel,
  PartialValidatorModel,
  PartialViewModel,
  PartialViewContextModel,
  ReadModelSourceScope,
  ResolvedApplicationModel,
  ResolvedAutoId,
  ResolvedBusinessContext,
  ResolvedCommand,
  ResolvedCommandInput,
  ResolvedCommandStep,
  ResolvedContextMembership,
  ResolvedContextSelectionPolicy,
  ResolvedField,
  ResolvedHookRefs,
  ResolvedLifecycle,
  ResolvedLifecycleAction,
  ResolvedLookup,
  ResolvedObject,
  ResolvedObjectAuditPolicy,
  ResolvedObjectConstraint,
  ResolvedObjectScope,
  ResolvedObjectSyncPolicy,
  ResolvedPolicyCondition,
  ResolvedPolicy,
  ResolvedPolicyRule,
  ResolvedPrincipalSelector,
  ResolvedReadModel,
  ResolvedReadModelField,
  ResolvedReadModelSource,
  ResolvedRole,
  ResolvedSort,
  ResolvedState,
  ResolvedSyncPolicy,
  ResolvedSyncWindow,
  ResolvedTheme,
  ResolvedThemeTokens,
  ResolvedValidator,
  ResolvedView,
  ResolvedViewContext,
} from "../model/resolved-model.js";

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
  const commands =
    input.commands === undefined || input.commands.length === 0
      ? undefined
      : resolveCommands(input.commands);
  const sync = objectsWithPolicies.map((object) => ({
    object: object.name,
    ...object.sync,
  }));
  const startView = input.app.startView ?? objectsWithPolicies[0]?.views[0]?.name ?? "";

  return {
    modelVersion: input.modelVersion ?? ADL_MODEL_VERSION,
    app: {
      name: input.app.name,
      startView,
      theme: input.app.theme ?? DEFAULT_THEME_NAME,
    },
    roles: resolveRoles(input.roles ?? []),
    ...(contexts === undefined ? {} : { contexts }),
    objects: objectsWithPolicies,
    ...(readModels === undefined ? {} : { readModels }),
    ...(commands === undefined ? {} : { commands }),
    policies,
    themes,
    sync,
    audit: createDefaultAuditModel(),
    operationLog: createDefaultOperationLogModel(),
    defaults: createDefaultModelDefaults(),
  };
}

function resolveRoles(roles: ResolvedRole[] | PartialApplicationModel["roles"]): ResolvedRole[] {
  return (roles ?? []).map((role) => ({
    name: role.name,
    ...(role.description === undefined ? {} : { description: role.description }),
    inherits: [...(role.inherits ?? [])],
  }));
}

function resolveBusinessContexts(
  contexts: PartialBusinessContextModel[],
): ResolvedBusinessContext[] {
  return contexts.map(resolveBusinessContext);
}

function resolveBusinessContext(input: PartialBusinessContextModel): ResolvedBusinessContext {
  return {
    name: input.name,
    object: input.object ?? input.name,
    selection: resolveContextSelection(input.selection),
    ...(input.membership === undefined
      ? {}
      : { membership: resolveContextMembership(input.membership) }),
  };
}

function resolveContextSelection(
  input: PartialContextSelectionPolicyModel | undefined,
): ResolvedContextSelectionPolicy {
  return {
    mode: input?.mode ?? "optional",
    autoSelect: input?.autoSelect ?? true,
    persistence: input?.persistence ?? "none",
    source: input?.source ?? "runtime",
    ...(input?.routeParam === undefined ? {} : { routeParam: input.routeParam }),
  };
}

function resolveContextMembership(input: PartialContextMembershipModel): ResolvedContextMembership {
  return {
    object: input.object,
    userField: input.userField,
    contextField: input.contextField,
    roleField: input.roleField,
    roles: [...(input.roles ?? [])],
  };
}

function resolveObject(
  input: PartialObjectModel,
  topLevelSync: PartialSyncPolicyModel | undefined,
  policies: PartialPolicyModel[],
): ResolvedObject {
  const fields = (input.fields ?? []).map(resolveField);
  const lifecycle = input.lifecycle === undefined ? undefined : resolveLifecycle(input.lifecycle);
  const sync = resolveObjectSync(input.sync ?? stripObjectFromSync(topLevelSync));
  const views = resolveViews(input, fields);
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
    metadataFields: createMetadataFields(),
    ...(input.scope === undefined ? {} : { scope: resolveObjectScope(input.scope) }),
    constraints: (input.constraints ?? []).map(resolveObjectConstraint),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    policies: [...(input.policies ?? []), ...objectPolicies],
    views,
    sync,
    audit: resolveObjectAudit(input.audit),
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
    };
  }

  return {
    name: input.name,
    kind: "unique",
    fields: [...input.fields],
    scopeFields: [...(input.scopeFields ?? [])],
  };
}

function resolveLifecycle(input: PartialLifecycleModel): ResolvedLifecycle {
  const states = input.states.map(resolveState);
  const initialState = input.initialState ?? states[0]?.name;

  return {
    name: input.name,
    stateField: input.stateField ?? DEFAULT_LIFECYCLE_STATE_FIELD,
    ...(initialState === undefined ? {} : { initialState }),
    states,
    actions: (input.actions ?? []).map(resolveLifecycleAction),
  };
}

function resolveState(input: PartialStateModel): ResolvedState {
  return {
    name: input.name,
    terminal: input.terminal ?? false,
  };
}

function resolveLifecycleAction(input: PartialLifecycleActionModel): ResolvedLifecycleAction {
  return {
    name: input.name,
    from: Array.isArray(input.from) ? [...input.from] : [input.from],
    to: input.to,
    ...(input.label === undefined ? {} : { label: input.label }),
    policyRefs: [...(input.policyRefs ?? [])],
    hooks: resolveHookRefs(input.hooks),
  };
}

function resolveHookRefs(input: PartialHookRefsModel | undefined): ResolvedHookRefs {
  return {
    before: [...(input?.before ?? [])],
    after: [...(input?.after ?? [])],
    onError: [...(input?.onError ?? [])],
  };
}

function resolveObjectSync(
  input: PartialObjectSyncPolicyModel | undefined,
): ResolvedObjectSyncPolicy {
  const defaults = createDefaultObjectSyncPolicy();
  const scope = input?.scope ?? defaults.scope;
  const window = resolveSyncWindow(input?.window, scope);
  return {
    mode: input?.mode ?? defaults.mode,
    scope,
    ...(window === undefined ? {} : { window }),
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
    };
  }

  return scope === "recent" ? { field: "_updatedAt", days: 30 } : undefined;
}

function resolveObjectAudit(
  input: PartialObjectModel["audit"] | undefined,
): ResolvedObjectAuditPolicy {
  const defaults = createDefaultObjectAuditPolicy();
  return {
    enabled: input?.enabled ?? defaults.enabled,
    operations: [...(input?.operations ?? defaults.operations)],
  };
}

function resolveViews(input: PartialObjectModel, fields: ResolvedField[]): ResolvedView[] {
  if (input.views !== undefined && input.views.length > 0) {
    return input.views.map((view) => resolveView(view, input.name, fields));
  }

  return createDefaultViews(input, fields);
}

function createDefaultViews(input: PartialObjectModel, fields: ResolvedField[]): ResolvedView[] {
  const fieldNames = fields.map((field) => field.name);
  const searchFields = getDefaultSearchFields(input, fields);

  return [
    {
      name: `${input.name}List`,
      object: input.name,
      kind: "list",
      fields: fieldNames,
      searchFields,
      sort: [],
      actions: ["create", "read", "update", "delete"],
    },
    {
      name: `${input.name}Form`,
      object: input.name,
      kind: "form",
      fields: fieldNames,
      searchFields: [],
      sort: [],
      actions: ["save", "delete"],
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
): ResolvedView {
  return {
    name: input.name,
    object: input.object ?? objectName,
    kind: input.kind,
    ...(input.context === undefined ? {} : { context: resolveViewContext(input.context) }),
    ...(input.readModel === undefined ? {} : { readModel: input.readModel }),
    fields: [...(input.fields ?? fields.map((field) => field.name))],
    searchFields: [...(input.searchFields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    actions: [...(input.actions ?? [])],
  };
}

function resolveViewContext(input: PartialViewContextModel): ResolvedViewContext {
  return {
    mode: input.mode,
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}

function resolveSort(input: ResolvedSort): ResolvedSort {
  return {
    field: input.field,
    direction: input.direction,
  };
}

function resolveReadModels(
  input: PartialReadModelModel[],
  objects: ResolvedObject[],
): ResolvedReadModel[] {
  const objectsByName = new Map(objects.map((object) => [object.name, object]));
  return input.map((readModel) => resolveReadModel(readModel, objectsByName));
}

function resolveReadModel(
  input: PartialReadModelModel,
  objectsByName: Map<string, ResolvedObject>,
): ResolvedReadModel {
  const defaultScope = defaultReadModelSourceScope(input.context);
  const sources = input.sources.map((source) => resolveReadModelSource(source, defaultScope));
  const sourcesByName = new Map(sources.map((source) => [source.name, source]));

  return {
    name: input.name,
    ...(input.context === undefined ? {} : { context: resolveViewContext(input.context) }),
    sources,
    fields: input.fields.map((field) =>
      resolveReadModelField(field, sources, sourcesByName, objectsByName),
    ),
    sort: [...(input.sort ?? [])].map(resolveSort),
  };
}

function resolveReadModelSource(
  input: PartialReadModelSourceModel,
  defaultScope: ReadModelSourceScope,
): ResolvedReadModelSource {
  return {
    name: input.name ?? input.object,
    object: input.object,
    scope: input.scope ?? defaultScope,
  };
}

function defaultReadModelSourceScope(
  context: PartialViewContextModel | undefined,
): ReadModelSourceScope {
  if (context?.mode === "all") {
    return "allAvailableContexts";
  }

  if (context?.mode === "required" || context?.mode === "optional") {
    return "currentContext";
  }

  return "all";
}

function resolveReadModelField(
  input: PartialReadModelFieldModel,
  sources: ResolvedReadModelSource[],
  sourcesByName: Map<string, ResolvedReadModelSource>,
  objectsByName: Map<string, ResolvedObject>,
): ResolvedReadModelField {
  const sourceName = input.source ?? (sources.length === 1 ? sources[0]?.name : undefined);
  const source = sourceName === undefined ? undefined : sourcesByName.get(sourceName);
  const sourceObject = source === undefined ? undefined : objectsByName.get(source.object);
  const sourceField =
    input.field === undefined
      ? undefined
      : sourceObject?.fields.find((field) => field.name === input.field);
  const fieldType = input.type ?? sourceField?.type;

  return {
    name: input.name,
    ...(fieldType === undefined ? {} : { type: fieldType }),
    ...(sourceName === undefined ? {} : { source: sourceName }),
    ...(input.field === undefined ? {} : { field: input.field }),
  };
}

function resolveCommands(input: PartialCommandModel[]): ResolvedCommand[] {
  return input.map(resolveCommand);
}

function resolveCommand(input: PartialCommandModel): ResolvedCommand {
  return {
    name: input.name,
    ...(input.label === undefined ? {} : { label: input.label }),
    inputs: (input.inputs ?? []).map(resolveCommandInput),
    steps: (input.steps ?? []).map(resolveCommandStep),
  };
}

function resolveCommandInput(input: PartialCommandInputModel): ResolvedCommandInput {
  return {
    name: input.name,
    type: input.type ?? "text",
    required: input.required ?? true,
    ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
  };
}

function resolveCommandStep(input: PartialCommandStepModel): ResolvedCommandStep {
  if (input.action === "update") {
    return {
      name: input.name,
      action: "update",
      object: input.object,
      authority: input.authority ?? "caller",
      recordId: cloneCommandValueExpression(input.recordId),
      patch: cloneCommandValueExpressionMap(input.patch ?? {}),
      preconditions: (input.preconditions ?? []).map(resolvePolicyCondition),
    };
  }

  return {
    name: input.name,
    action: "create",
    object: input.object,
    authority: input.authority ?? "caller",
    values: cloneCommandValueExpressionMap(input.values ?? {}),
    preconditions: (input.preconditions ?? []).map(resolvePolicyCondition),
  };
}

function resolvePolicies(
  objects: ResolvedObject[],
  inputPolicies: PartialPolicyModel[],
): ResolvedPolicy[] {
  return [
    ...objects.map((object) => createDefaultDenyPolicy(object.name)),
    ...inputPolicies.map(resolvePolicy),
  ];
}

function resolvePolicy(input: PartialPolicyModel): ResolvedPolicy {
  return {
    name: input.name,
    object: input.object,
    defaultEffect: "deny",
    rules: (input.rules ?? []).map(resolvePolicyRule),
  };
}

function resolvePolicyRule(input: PartialPolicyRuleModel): ResolvedPolicyRule {
  return {
    name: input.name,
    effect: input.effect,
    principal: resolvePrincipal(input.principal),
    action: input.action,
    state: asArray(input.state),
    fields: [...(input.fields ?? [])],
    ...(input.lifecycleAction === undefined ? {} : { lifecycleAction: input.lifecycleAction }),
    ...(input.condition === undefined
      ? {}
      : { condition: resolvePolicyCondition(input.condition) }),
    channels: [...(input.channels ?? ["ui", "api", "sync", "import", "test"])],
  };
}

function resolvePolicyCondition(input: ResolvedPolicyCondition): ResolvedPolicyCondition {
  switch (input.kind) {
    case "equals":
      return {
        kind: "equals",
        left: cloneJsonValue(input.left),
        right: cloneJsonValue(input.right),
      };
    case "all":
      return {
        kind: "all",
        conditions: input.conditions.map(resolvePolicyCondition),
      };
    case "any":
      return {
        kind: "any",
        conditions: input.conditions.map(resolvePolicyCondition),
      };
    case "not":
      return {
        kind: "not",
        condition: resolvePolicyCondition(input.condition),
      };
  }
}

function resolvePrincipal(
  input: PartialPrincipalSelectorModel | undefined,
): ResolvedPrincipalSelector {
  const defaults = createEveryonePrincipal();
  return {
    match: input?.match ?? defaults.match,
    roles: [...(input?.roles ?? defaults.roles)],
    groupRoles: [...(input?.groupRoles ?? defaults.groupRoles)],
    users: [...(input?.users ?? defaults.users)],
    owner: input?.owner ?? defaults.owner,
  };
}

function resolveThemes(input: PartialThemeModel[]): ResolvedTheme[] {
  const inputThemeNames = new Set(input.map((theme) => theme.name));
  const themes = [
    ...createBuiltInThemes().filter((theme) => !inputThemeNames.has(theme.name)),
    ...input,
  ];
  const themesByName = new Map<string, PartialThemeModel | ResolvedTheme>();

  for (const theme of themes) {
    if (!themesByName.has(theme.name)) {
      themesByName.set(theme.name, theme);
    }
  }

  return themes.map((theme) => resolveTheme(theme, themesByName, []));
}

function resolveTheme(
  input: PartialThemeModel | ResolvedTheme,
  themesByName: Map<string, PartialThemeModel | ResolvedTheme>,
  resolutionPath: string[],
): ResolvedTheme {
  const baseTokens = resolveThemeBaseTokens(input, themesByName, resolutionPath);

  return {
    name: input.name,
    ...(input.base === undefined ? {} : { base: input.base }),
    tokens: {
      ...baseTokens,
      ...(input.tokens ?? {}),
    },
  };
}

function resolveThemeBaseTokens(
  input: PartialThemeModel | ResolvedTheme,
  themesByName: Map<string, PartialThemeModel | ResolvedTheme>,
  resolutionPath: string[],
): ResolvedThemeTokens {
  const builtInTheme = getBuiltInTheme(input.name);
  const defaultTokens = builtInTheme?.tokens ?? createDefaultTheme().tokens;

  if (
    input.base === undefined ||
    input.base === input.name ||
    resolutionPath.includes(input.base)
  ) {
    return defaultTokens;
  }

  const baseTheme = themesByName.get(input.base);
  if (baseTheme === undefined) {
    return defaultTokens;
  }

  return resolveTheme(baseTheme, themesByName, [...resolutionPath, input.name]).tokens;
}

function stripObjectFromSync(
  input: PartialSyncPolicyModel | undefined,
): PartialObjectSyncPolicyModel | undefined {
  if (input === undefined) {
    return undefined;
  }

  return {
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.scope === undefined ? {} : { scope: input.scope }),
    ...(input.window === undefined ? {} : { window: input.window }),
    ...(input.conflict === undefined ? {} : { conflict: input.conflict }),
  };
}

function groupPolicyNamesByObject(policies: ResolvedPolicy[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const policy of policies) {
    grouped.set(policy.object, [...(grouped.get(policy.object) ?? []), policy.name]);
  }

  return grouped;
}

function asArray(input: string | string[] | undefined): string[] {
  if (input === undefined) {
    return [];
  }

  return Array.isArray(input) ? [...input] : [input];
}

function uniqueStrings(input: string[]): string[] {
  return [...new Set(input)];
}

function cloneCommandValueExpressionMap<T extends Record<string, unknown>>(input: T): T {
  return cloneJsonValue(input);
}

function cloneCommandValueExpression<T>(input: T): T {
  return cloneJsonValue(input);
}

function cloneJsonValue<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
