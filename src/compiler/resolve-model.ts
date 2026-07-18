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
  PartialCommandPreconditionModel,
  PartialCommandStepModel,
  PartialContextMembershipModel,
  PartialContextSelectionPolicyModel,
  PartialDecisionTableInputModel,
  PartialDecisionTableModel,
  PartialDecisionTableRowModel,
  PartialEditSectionModel,
  PartialComputedFieldModel,
  PartialFieldModel,
  PartialHookRefsModel,
  PartialLifecycleGuardModel,
  PartialLifecycleActionModel,
  PartialLifecycleModel,
  PartialLookupModel,
  PartialObjectConstraintModel,
  PartialObjectModel,
  PartialObjectValidationModel,
  PartialObjectScopeModel,
  PartialObjectSyncPolicyModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialRelationshipPickerModel,
  PartialPresentationControlModel,
  PartialPresentationEmptyStateModel,
  PartialPresentationFormatModel,
  PartialPresentationIconMapModel,
  PartialPresentationIconRefModel,
  PartialPresentationListModel,
  PartialPresentationRowFragmentModel,
  PartialPresentationRowTemplateModel,
  PartialPresentationSectionModel,
  PartialPresentationShellModel,
  PartialPresentationShellRegionModel,
  PartialPresentationStateModel,
  PartialPrincipalSelectorModel,
  PartialReadModelFieldModel,
  PartialReadModelModel,
  PartialReadModelSourceModel,
  PartialShellControlModel,
  PartialShellModel,
  PartialShellNavItemModel,
  PartialShellVisibilityModel,
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
  ResolvedCommandPrecondition,
  ResolvedCommandStep,
  ResolvedComputedField,
  ResolvedContextMembership,
  ResolvedContextSelectionPolicy,
  ResolvedDecisionTable,
  ResolvedDecisionTableInput,
  ResolvedDecisionTableRow,
  ResolvedEditSection,
  ResolvedField,
  ResolvedHookRefs,
  ResolvedLifecycleGuard,
  ResolvedLifecycle,
  ResolvedLifecycleAction,
  ResolvedLookup,
  ResolvedObject,
  ResolvedObjectAuditPolicy,
  ResolvedObjectConstraint,
  ResolvedObjectValidation,
  ResolvedObjectScope,
  ResolvedObjectSyncPolicy,
  ResolvedExpression,
  ResolvedPolicyCondition,
  ResolvedPolicyConditionOperand,
  ResolvedPolicy,
  ResolvedPolicyRule,
  ResolvedPresentationControl,
  ResolvedPresentationEmptyState,
  ResolvedPresentationFormat,
  ResolvedPresentationIconMap,
  ResolvedPresentationIconRef,
  ResolvedPresentationList,
  ResolvedPresentationRowFragment,
  ResolvedPresentationRowTemplate,
  ResolvedPresentationSection,
  ResolvedPresentationShell,
  ResolvedPresentationShellRegion,
  ResolvedPresentationState,
  ResolvedRelationshipPicker,
  ResolvedPrincipalSelector,
  ResolvedReadModel,
  ResolvedReadModelField,
  ResolvedReadModelSource,
  ResolvedRole,
  ResolvedShell,
  ResolvedShellControl,
  ResolvedShellNavItem,
  ResolvedShellVisibility,
  ResolvedSort,
  ResolvedState,
  ResolvedSyncPolicy,
  ResolvedSyncWindow,
  ResolvedTheme,
  ResolvedThemeTokens,
  ResolvedValidator,
  ResolvedView,
  ResolvedViewContext,
  ResolvedViewPresentation,
  PresentationStateType,
  PresentationActionPlacement,
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

  return {
    modelVersion: input.modelVersion ?? ADL_MODEL_VERSION,
    app: {
      name: input.app.name,
      startView,
      theme: input.app.theme ?? DEFAULT_THEME_NAME,
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
    defaults: createDefaultModelDefaults(),
  };
}

function resolveShell(
  input: PartialShellModel | undefined,
  objects: ResolvedObject[],
): ResolvedShell {
  const sourceItems = input?.nav?.items ?? [];
  const declaredViews = new Set(sourceItems.map((item) => item.view));
  const defaultItems = objects
    .flatMap((object) => object.views.map((view) => ({ object, view })))
    .filter(({ view }) => !declaredViews.has(view.name))
    .map(({ object, view }, index) =>
      resolveShellNavItem(
        {
          view: view.name,
          label: titleCaseIdentifier(view.name),
          group: titleCaseIdentifier(object.name),
          order: (sourceItems.length + index + 1) * 10,
        },
        sourceItems.length + index,
      ),
    );

  const navItems = [
    ...sourceItems.map((item, index) => resolveShellNavItem(item, index)),
    ...defaultItems,
  ].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  const controls = (input?.controls ?? createDefaultShellControls()).map(resolveShellControl);

  return {
    nav: { items: navItems },
    topBar: {
      contextSelector: input?.topBar?.contextSelector ?? "topBar",
      mobileContextSelector: input?.topBar?.mobileContextSelector ?? "sheet",
      controls: [...(input?.topBar?.controls ?? controls.map((control) => control.name))],
    },
    controls,
  };
}

function resolveShellNavItem(input: PartialShellNavItemModel, index: number): ResolvedShellNavItem {
  return {
    name: input.name ?? input.view,
    view: input.view,
    label: input.label ?? titleCaseIdentifier(input.view),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    ...(input.group === undefined ? {} : { group: input.group }),
    order: input.order ?? (index + 1) * 10,
    activeWhen: [...(input.activeWhen ?? [input.view])],
    visibility: resolveShellVisibility(input.visibility),
  };
}

function createDefaultShellControls(): PartialShellControlModel[] {
  return [
    {
      name: "contextSelector",
      kind: "contextSelector",
      placement: "topBar",
    },
    {
      name: "syncStatus",
      kind: "syncStatus",
      label: "Sync status",
      placement: "topBar",
    },
  ];
}

function resolveShellControl(input: PartialShellControlModel): ResolvedShellControl {
  return {
    name: input.name,
    kind: input.kind,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.icon === undefined ? {} : { icon: input.icon }),
    placement: input.placement ?? "topBar",
    visibility: resolveShellVisibility(input.visibility),
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}

function resolveShellVisibility(
  input: PartialShellVisibilityModel | undefined,
): ResolvedShellVisibility {
  return {
    kind: input?.kind ?? "always",
    ...(input?.context === undefined ? {} : { context: input.context }),
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
    guards: (input.guards ?? []).map(resolveLifecycleGuard),
    policyRefs: [...(input.policyRefs ?? [])],
    hooks: resolveHookRefs(input.hooks),
  };
}

function resolveLifecycleGuard(input: PartialLifecycleGuardModel): ResolvedLifecycleGuard {
  return {
    name: input.name,
    expression: resolveExpression(input.expression),
    message: input.message ?? `Lifecycle guard '${input.name}' failed.`,
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

function resolveViews(
  input: PartialObjectModel,
  fields: ResolvedField[],
  computedFields: ResolvedComputedField[],
): ResolvedView[] {
  if (input.views !== undefined && input.views.length > 0) {
    return input.views.map((view) => resolveView(view, input.name, fields, computedFields));
  }

  return createDefaultViews(input, fields, computedFields);
}

function createDefaultViews(
  input: PartialObjectModel,
  fields: ResolvedField[],
  computedFields: ResolvedComputedField[],
): ResolvedView[] {
  const fieldNames = [
    ...fields.map((field) => field.name),
    ...orderedComputedFieldNames(computedFields),
  ];
  const searchFields = getDefaultSearchFields(input, fields);

  return [
    {
      name: `${input.name}List`,
      object: input.name,
      kind: "list",
      editContainer: "modal",
      fields: fieldNames,
      searchFields,
      sort: [],
      actions: ["create", "read", "update", "delete"],
      editSections: [{ name: "Fields", kind: "fields", fields: fieldNames }],
    },
    {
      name: `${input.name}Form`,
      object: input.name,
      kind: "form",
      editContainer: "modal",
      fields: fieldNames,
      searchFields: [],
      sort: [],
      actions: ["save", "delete"],
      editSections: [{ name: "Fields", kind: "fields", fields: fieldNames }],
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
  computedFields: ResolvedComputedField[],
): ResolvedView {
  const viewFields = [
    ...(input.fields ?? [
      ...fields.map((field) => field.name),
      ...orderedComputedFieldNames(computedFields),
    ]),
  ];

  return {
    name: input.name,
    object: input.object ?? objectName,
    kind: input.kind,
    ...(input.context === undefined ? {} : { context: resolveViewContext(input.context) }),
    ...(input.readModel === undefined ? {} : { readModel: input.readModel }),
    editContainer: input.editContainer ?? "modal",
    fields: viewFields,
    searchFields: [...(input.searchFields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    actions: [...(input.actions ?? [])],
    editSections: resolveEditSections(input.editSections, viewFields),
    ...(input.presentation === undefined
      ? {}
      : { presentation: resolveViewPresentation(input.presentation) }),
  };
}

function resolveEditSections(
  input: PartialEditSectionModel[] | undefined,
  viewFields: string[],
): ResolvedEditSection[] {
  if (input === undefined || input.length === 0) {
    return [{ name: "Fields", kind: "fields", fields: [...viewFields] }];
  }

  return input.map((section) => {
    const base = {
      name: section.name,
      ...(section.heading === undefined ? {} : { heading: section.heading }),
    };

    if (section.kind === "fields") {
      return {
        ...base,
        kind: "fields",
        fields: [...(section.fields ?? viewFields)],
      };
    }

    return {
      ...base,
      kind: "childCollection",
      childObject: section.childObject,
      parentField: section.parentField,
      ...(section.childView === undefined ? {} : { childView: section.childView }),
      operations: [...(section.operations ?? ["createChild", "updateChild", "unlink"])],
      staged: section.staged ?? true,
      ...(section.orderField === undefined ? {} : { orderField: section.orderField }),
      emptyState: {
        text: section.emptyState?.text ?? "",
      },
      ...(section.picker === undefined
        ? {}
        : { picker: resolveRelationshipPicker(section.picker, section) }),
    };
  });
}

function resolveRelationshipPicker(
  input: PartialRelationshipPickerModel,
  section: Extract<PartialEditSectionModel, { kind: "childCollection" }>,
): ResolvedRelationshipPicker {
  const sourceKind = input.sourceKind ?? "object";
  return {
    name: input.name ?? `${section.name}Picker`,
    sourceKind,
    source: input.source ?? (sourceKind === "object" ? section.childObject : ""),
    selection: input.selection ?? "multiple",
    displayFields: [...(input.displayFields ?? [])],
    searchFields: [...(input.searchFields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    excludeAlreadyLinked: input.excludeAlreadyLinked ?? true,
    emptyState: {
      text: input.emptyState?.text ?? "No records available to link.",
    },
  };
}

function resolveViewPresentation(
  input: NonNullable<PartialViewModel["presentation"]>,
): ResolvedViewPresentation {
  return {
    layout: input.layout ?? "stack",
    density: input.density ?? "comfortable",
    state: (input.state ?? []).map(resolvePresentationState),
    iconMaps: (input.iconMaps ?? []).map(resolvePresentationIconMap),
    sections: (input.sections ?? []).map(resolvePresentationSection),
    ...(input.shell === undefined ? {} : { shell: resolvePresentationShell(input.shell) }),
  };
}

function resolvePresentationState(input: PartialPresentationStateModel): ResolvedPresentationState {
  const type = input.type ?? "boolean";

  return {
    name: input.name,
    type,
    defaultValue: input.defaultValue ?? defaultPresentationStateValue(type),
    persistence: input.persistence ?? "memory",
  };
}

function defaultPresentationStateValue(
  type: PresentationStateType,
): ResolvedPresentationState["defaultValue"] {
  switch (type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "text":
      return "";
    case "date":
    case "datetime":
    case "time":
      return null;
  }
}

function resolvePresentationIconMap(
  input: PartialPresentationIconMapModel,
): ResolvedPresentationIconMap {
  return {
    name: input.name,
    field: input.field,
    values: (input.values ?? []).map((value) => ({ value: value.value, icon: value.icon })),
    ...(input.defaultIcon === undefined ? {} : { defaultIcon: input.defaultIcon }),
  };
}

function resolvePresentationSection(
  input: PartialPresentationSectionModel,
): ResolvedPresentationSection {
  return {
    name: input.name,
    ...(input.heading === undefined ? {} : { heading: input.heading }),
    layout: input.layout ?? "stack",
    density: input.density ?? "comfortable",
    controls: (input.controls ?? []).map(resolvePresentationControl),
    lists: (input.lists ?? []).map(resolvePresentationList),
  };
}

function resolvePresentationControl(
  input: PartialPresentationControlModel,
): ResolvedPresentationControl {
  const base = {
    name: input.name,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.icon === undefined ? {} : { icon: resolvePresentationIconRef(input.icon) }),
  };

  if (input.kind === "toggle") {
    return {
      ...base,
      kind: "toggle",
      state: input.state,
    };
  }

  if (input.kind === "select") {
    return {
      ...base,
      kind: "select",
      state: input.state,
      options: (input.options ?? []).map((option) => ({
        value: option.value,
        label: option.label,
        ...(option.icon === undefined ? {} : { icon: resolvePresentationIconRef(option.icon) }),
      })),
    };
  }

  if (input.kind === "action") {
    return {
      ...base,
      kind: "action",
      placement: input.placement ?? "secondary",
      ...(input.command === undefined ? {} : { command: input.command }),
      ...(input.view === undefined ? {} : { view: input.view }),
      input:
        input.input === undefined
          ? {}
          : Object.fromEntries(
              Object.entries(input.input).map(([name, expression]) => [
                name,
                resolveExpression(expression),
              ]),
            ),
      ...(input.visibleWhen === undefined
        ? {}
        : { visibleWhen: resolveExpression(input.visibleWhen) }),
    };
  }

  return {
    ...base,
    kind: "contextSelector",
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}

function resolvePresentationList(input: PartialPresentationListModel): ResolvedPresentationList {
  return {
    name: input.name,
    sourceKind: input.sourceKind ?? "readModel",
    source: input.source,
    renderAs: input.renderAs ?? "table",
    density: input.density ?? "comfortable",
    fields: [...(input.fields ?? [])],
    sort: [...(input.sort ?? [])].map(resolveSort),
    ...(input.filter === undefined ? {} : { filter: resolveExpression(input.filter) }),
    emptyState: resolvePresentationEmptyState(input.emptyState),
    actions: (input.actions ?? []).map((action) =>
      resolvePresentationAction(action, action.placement ?? "row"),
    ),
    row: resolvePresentationRowTemplate(input.row),
  };
}

function resolvePresentationAction(
  input: Extract<PartialPresentationControlModel, { kind: "action" }>,
  placement: PresentationActionPlacement,
): Extract<ResolvedPresentationControl, { kind: "action" }> {
  const resolved = resolvePresentationControl({ ...input, placement });
  if (resolved.kind !== "action") {
    throw new Error("Expected presentation action control.");
  }
  return resolved;
}

function resolvePresentationEmptyState(
  input: PartialPresentationEmptyStateModel | undefined,
): ResolvedPresentationEmptyState {
  return {
    text: input?.text ?? "",
    ...(input?.icon === undefined ? {} : { icon: resolvePresentationIconRef(input.icon) }),
  };
}

function resolvePresentationRowTemplate(
  input: PartialPresentationRowTemplateModel | undefined,
): ResolvedPresentationRowTemplate {
  return {
    layout: input?.layout ?? "inline",
    density: input?.density ?? "comfortable",
    fragments: (input?.fragments ?? []).map(resolvePresentationRowFragment),
  };
}

function resolvePresentationRowFragment(
  input: PartialPresentationRowFragmentModel,
): ResolvedPresentationRowFragment {
  if (input.kind === "text") {
    return {
      kind: "text",
      text: input.text,
      style: input.style ?? "plain",
    };
  }

  if (input.kind === "field") {
    return {
      kind: "field",
      field: input.field,
      style: input.style ?? "plain",
      ...(input.format === undefined ? {} : { format: resolvePresentationFormat(input.format) }),
      ...(input.fallback === undefined ? {} : { fallback: input.fallback }),
    };
  }

  if (input.kind === "icon") {
    return {
      kind: "icon",
      icon: resolvePresentationIconRef(input.icon),
      ...(input.label === undefined ? {} : { label: input.label }),
    };
  }

  return {
    kind: "conditional",
    when: resolveExpression(input.when),
    fragments: (input.fragments ?? []).map(resolvePresentationRowFragment),
  };
}

function resolvePresentationFormat(
  input: PartialPresentationFormatModel,
): ResolvedPresentationFormat {
  return {
    kind: input.kind,
    ...(input.pattern === undefined ? {} : { pattern: input.pattern }),
  };
}

function resolvePresentationIconRef(
  input: PartialPresentationIconRefModel,
): ResolvedPresentationIconRef {
  if (input.kind === "named") {
    return { kind: "named", name: input.name };
  }

  return {
    kind: "map",
    map: input.map,
    ...(input.field === undefined ? {} : { field: input.field }),
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}

function resolvePresentationShell(input: PartialPresentationShellModel): ResolvedPresentationShell {
  return {
    regions: (input.regions ?? []).map(resolvePresentationShellRegion),
  };
}

function resolvePresentationShellRegion(
  input: PartialPresentationShellRegionModel,
): ResolvedPresentationShellRegion {
  return {
    region: input.region,
    ...(input.title === undefined ? {} : { title: input.title }),
    controls: [...(input.controls ?? [])],
  };
}

function orderedComputedFieldNames(fields: ResolvedComputedField[]): string[] {
  return fields
    .slice()
    .sort((left, right) => left.evaluationOrder - right.evaluationOrder)
    .map((field) => field.name);
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

function titleCaseIdentifier(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
  const sourceName =
    input.expression === undefined
      ? (input.source ?? (sources.length === 1 ? sources[0]?.name : undefined))
      : input.source;
  const source = sourceName === undefined ? undefined : sourcesByName.get(sourceName);
  const sourceObject = source === undefined ? undefined : objectsByName.get(source.object);
  const sourceField =
    input.field === undefined
      ? undefined
      : [...(sourceObject?.fields ?? []), ...(sourceObject?.computedFields ?? [])].find(
          (field) => field.name === input.field,
        );
  const fieldType = input.type ?? (input.expression === undefined ? sourceField?.type : undefined);

  return {
    name: input.name,
    ...(fieldType === undefined ? {} : { type: fieldType }),
    ...(sourceName === undefined ? {} : { source: sourceName }),
    ...(input.field === undefined ? {} : { field: input.field }),
    ...(input.expression === undefined ? {} : { expression: resolveExpression(input.expression) }),
  };
}

function resolveDecisionTables(input: PartialDecisionTableModel[]): ResolvedDecisionTable[] {
  return input.map(resolveDecisionTable);
}

function resolveDecisionTable(input: PartialDecisionTableModel): ResolvedDecisionTable {
  return {
    name: input.name,
    object: input.object,
    match: input.match ?? "first",
    inputs: (input.inputs ?? []).map(resolveDecisionTableInput),
    rows: (input.rows ?? []).map(resolveDecisionTableRow),
    ...(input.defaultOutputs === undefined
      ? {}
      : { defaultOutputs: cloneJsonValue(input.defaultOutputs) }),
  };
}

function resolveDecisionTableInput(
  input: PartialDecisionTableInputModel,
): ResolvedDecisionTableInput {
  return {
    name: input.name,
    expression: resolveExpression(input.expression),
  };
}

function resolveDecisionTableRow(input: PartialDecisionTableRowModel): ResolvedDecisionTableRow {
  return {
    name: input.name,
    condition: resolveExpression(input.condition),
    outputs: cloneJsonValue(input.outputs ?? {}),
  };
}

function resolveCommands(input: PartialCommandModel[]): ResolvedCommand[] {
  return input.map(resolveCommand);
}

function resolveCommand(input: PartialCommandModel): ResolvedCommand {
  return {
    name: input.name,
    ...(input.label === undefined ? {} : { label: input.label }),
    preconditions: (input.preconditions ?? []).map(resolveCommandPrecondition),
    inputs: (input.inputs ?? []).map(resolveCommandInput),
    steps: (input.steps ?? []).map(resolveCommandStep),
  };
}

function resolveCommandPrecondition(
  input: PartialCommandPreconditionModel,
): ResolvedCommandPrecondition {
  return {
    name: input.name,
    expression: resolveExpression(input.expression),
    message: input.message ?? `Command precondition '${input.name}' failed.`,
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
      preconditions: (input.preconditions ?? []).map(resolveExpression),
    };
  }

  return {
    name: input.name,
    action: "create",
    object: input.object,
    authority: input.authority ?? "caller",
    values: cloneCommandValueExpressionMap(input.values ?? {}),
    preconditions: (input.preconditions ?? []).map(resolveExpression),
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
    ...(input.condition === undefined ? {} : { condition: resolveExpression(input.condition) }),
    channels: [...(input.channels ?? ["ui", "api", "sync", "import", "test"])],
  };
}

function collectExpressionFieldReferences(expression: ResolvedExpression): string[] {
  const references = new Set<string>();
  visitExpressionFields(expression, references);
  return [...references].sort();
}

function visitExpressionFields(expression: ResolvedExpression, references: Set<string>): void {
  switch (expression.kind) {
    case "field":
      references.add(expression.field);
      return;
    case "unary":
      visitExpressionFields(expression.operand, references);
      return;
    case "binary":
      visitExpressionFields(expression.left, references);
      visitExpressionFields(expression.right, references);
      return;
    case "literal":
    case "runtime":
      return;
  }
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

function resolveExpression(
  input: ResolvedExpression | ResolvedPolicyCondition,
): ResolvedExpression {
  switch (input.kind) {
    case "literal":
      return {
        kind: "literal",
        value: cloneJsonValue(input.value),
        ...(input.valueType === undefined ? {} : { valueType: input.valueType }),
      };
    case "field":
      return {
        kind: "field",
        field: input.field,
      };
    case "runtime":
      return {
        kind: "runtime",
        property: input.property === "userId" ? "userId" : input.property,
      };
    case "unary":
      return {
        kind: "unary",
        operator: input.operator,
        operand: resolveExpression(input.operand),
      };
    case "binary":
      return {
        kind: "binary",
        operator: input.operator,
        left: resolveExpression(input.left),
        right: resolveExpression(input.right),
      };
    case "equals":
      return {
        kind: "binary",
        operator: "==",
        left: resolvePolicyConditionOperand(input.left),
        right: resolvePolicyConditionOperand(input.right),
      };
    case "all":
      return foldConditions(input.conditions, "and", true);
    case "any":
      return foldConditions(input.conditions, "or", false);
    case "not":
      return {
        kind: "unary",
        operator: "not",
        operand: resolveExpression(input.condition),
      };
  }
}

function foldConditions(
  conditions: (ResolvedExpression | ResolvedPolicyCondition)[],
  operator: "and" | "or",
  emptyValue: boolean,
): ResolvedExpression {
  const [first, ...rest] = conditions;
  if (first === undefined) {
    return { kind: "literal", value: emptyValue };
  }

  return rest.reduce<ResolvedExpression>(
    (left, condition) => ({
      kind: "binary",
      operator,
      left,
      right: resolveExpression(condition),
    }),
    resolveExpression(first),
  );
}

function resolvePolicyConditionOperand(
  operand: ResolvedPolicyConditionOperand,
): ResolvedExpression {
  switch (operand.kind) {
    case "field":
      return { kind: "field", field: operand.field };
    case "runtime":
      return { kind: "runtime", property: operand.property };
    case "literal":
      if (
        typeof operand.value === "string" ||
        typeof operand.value === "number" ||
        typeof operand.value === "boolean" ||
        operand.value === null
      ) {
        return { kind: "literal", value: operand.value };
      }

      return { kind: "literal", value: JSON.stringify(operand.value) };
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
