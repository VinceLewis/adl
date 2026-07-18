import { parseAdl } from "../parser/parser.js";
import { resolveApplicationModel } from "./resolve-model.js";
import { validateApplicationModel } from "./validate-model.js";
import type { Diagnostic } from "./validate-model.js";
import type {
  ActionDeclarationAst,
  AdlDocumentAst,
  BusinessContextDeclarationAst,
  CommandDeclarationAst,
  CommandStepDeclarationAst,
  DecisionTableDeclarationAst,
  FieldDeclarationAst,
  ObjectConstraintDeclarationAst,
  ObjectDeclarationAst,
  PolicyDeclarationAst,
  PolicyRuleDeclarationAst,
  PresentationActionControlDeclarationAst,
  PresentationControlDeclarationAst,
  PresentationIconMapDeclarationAst,
  PresentationIconRefDeclarationAst,
  PresentationLegendDeclarationAst,
  PresentationListDeclarationAst,
  PresentationRowFragmentDeclarationAst,
  PresentationRowTemplateDeclarationAst,
  PresentationSectionDeclarationAst,
  PresentationStatusCandidateDeclarationAst,
  PresentationStatusDeclarationAst,
  PresentationStatusMapDeclarationAst,
  PresentationStateDeclarationAst,
  PresentationToggleControlDeclarationAst,
  PrincipalSelectorAst,
  ReadModelDeclarationAst,
  ShellControlDeclarationAst,
  ShellDeclarationAst,
  ShellNavItemDeclarationAst,
  ShellTopBarDeclarationAst,
  ShellVisibilityDeclarationAst,
  SyncDeclarationAst,
  ThemeDeclarationAst,
  ViewDeclarationAst,
} from "../parser/ast.js";
import type {
  PartialApplicationModel,
  PartialBusinessContextModel,
  PartialCommandModel,
  PartialCommandStepModel,
  PartialDecisionTableModel,
  PartialFieldModel,
  PartialLifecycleModel,
  PartialLifecycleActionModel,
  PartialObjectModel,
  PartialObjectConstraintModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialPresentationControlModel,
  PartialPresentationIconMapModel,
  PartialPresentationIconRefModel,
  PartialPresentationLegendModel,
  PartialPresentationListModel,
  PartialPresentationRowFragmentModel,
  PartialPresentationRowTemplateModel,
  PartialPresentationSectionModel,
  PartialPresentationStatusCandidateModel,
  PartialPresentationStatusMapModel,
  PartialPresentationStatusModel,
  PartialPresentationStateModel,
  PartialPrincipalSelectorModel,
  PartialReadModelModel,
  PartialShellControlModel,
  PartialShellModel,
  PartialShellNavItemModel,
  PartialShellTopBarModel,
  PartialShellVisibilityModel,
  PartialSyncPolicyModel,
  PartialThemeModel,
  PartialViewModel,
  PartialViewContextModel,
  ResolvedApplicationModel,
  ResolvedThemeTokens,
} from "../model/resolved-model.js";

export interface CompileAdlResult {
  ast: AdlDocumentAst;
  partialModel: PartialApplicationModel;
  model: ResolvedApplicationModel;
  diagnostics: Diagnostic[];
}

export function compileAdl(source: string): CompileAdlResult {
  const ast = parseAdl(source);
  const partialModel = adlAstToPartialApplicationModel(ast);
  const model = resolveApplicationModel(partialModel);
  const diagnostics = validateApplicationModel(model);

  return {
    ast,
    partialModel,
    model,
    diagnostics,
  };
}

export function adlAstToPartialApplicationModel(ast: AdlDocumentAst): PartialApplicationModel {
  const generatedPolicies: PartialPolicyModel[] = [];
  const objects = mergeViewOnlyObjectDeclarations(ast.objects).map((object) =>
    objectToPartial(object, generatedPolicies),
  );

  return {
    app: {
      name: ast.app.name,
      ...(ast.app.startView === undefined ? {} : { startView: ast.app.startView }),
      ...(ast.app.theme === undefined ? {} : { theme: ast.app.theme }),
    },
    ...(ast.shell === undefined ? {} : { shell: shellToPartial(ast.shell) }),
    roles: ast.roles.map((role) => ({
      name: role.name,
      ...(role.description === undefined ? {} : { description: role.description }),
      inherits: [...role.inherits],
    })),
    contexts: ast.contexts.map(contextToPartial),
    objects,
    readModels: ast.readModels.map(readModelToPartial),
    decisionTables: ast.decisionTables.map(decisionTableToPartial),
    commands: ast.commands.map(commandToPartial),
    policies: [...ast.policies.map(policyToPartial), ...generatedPolicies],
    themes: ast.themes.map(themeToPartial),
    sync: ast.sync.map(syncToPartial),
  };
}

function shellToPartial(shell: ShellDeclarationAst): PartialShellModel {
  return {
    nav: {
      items: shell.navItems.map(shellNavItemToPartial),
    },
    ...(shell.topBar === undefined ? {} : { topBar: shellTopBarToPartial(shell.topBar) }),
    controls: shell.controls.map(shellControlToPartial),
  };
}

function shellNavItemToPartial(item: ShellNavItemDeclarationAst): PartialShellNavItemModel {
  return {
    ...(item.name === undefined ? {} : { name: item.name }),
    view: item.view,
    ...(item.label === undefined ? {} : { label: item.label }),
    ...(item.icon === undefined ? {} : { icon: item.icon }),
    ...(item.group === undefined ? {} : { group: item.group }),
    ...(item.order === undefined ? {} : { order: item.order }),
    ...(item.activeWhen.length === 0 ? {} : { activeWhen: [...item.activeWhen] }),
    ...(item.visibility === undefined
      ? {}
      : { visibility: shellVisibilityToPartial(item.visibility) }),
  };
}

function shellControlToPartial(control: ShellControlDeclarationAst): PartialShellControlModel {
  return {
    name: control.name,
    kind: control.controlKind,
    ...(control.label === undefined ? {} : { label: control.label }),
    ...(control.icon === undefined ? {} : { icon: control.icon }),
    ...(control.placement === undefined ? {} : { placement: control.placement }),
    ...(control.visibility === undefined
      ? {}
      : { visibility: shellVisibilityToPartial(control.visibility) }),
    ...(control.context === undefined ? {} : { context: control.context }),
  };
}

function shellTopBarToPartial(topBar: ShellTopBarDeclarationAst): PartialShellTopBarModel {
  return {
    ...(topBar.contextSelector === undefined ? {} : { contextSelector: topBar.contextSelector }),
    ...(topBar.mobileContextSelector === undefined
      ? {}
      : { mobileContextSelector: topBar.mobileContextSelector }),
    controls: [...topBar.controls],
  };
}

function shellVisibilityToPartial(
  visibility: ShellVisibilityDeclarationAst,
): PartialShellVisibilityModel {
  return {
    kind: visibility.kind,
    ...(visibility.context === undefined ? {} : { context: visibility.context }),
  };
}

function mergeViewOnlyObjectDeclarations(objects: ObjectDeclarationAst[]): ObjectDeclarationAst[] {
  const merged: ObjectDeclarationAst[] = [];

  for (const object of objects) {
    const existing = merged.find((candidate) => candidate.name === object.name);
    if (existing !== undefined && isViewOnlyObjectDeclaration(object)) {
      existing.views.push(...object.views);
      existing.range = {
        start: existing.range.start,
        end: object.range.end,
      };
      continue;
    }

    merged.push(object);
  }

  return merged;
}

function isViewOnlyObjectDeclaration(object: ObjectDeclarationAst): boolean {
  return (
    object.businessKey === undefined &&
    object.displayField === undefined &&
    object.fields.length === 0 &&
    object.computedFields.length === 0 &&
    object.scope === undefined &&
    object.constraints.length === 0 &&
    object.validations.length === 0 &&
    object.lifecycle === undefined &&
    object.sync === undefined &&
    object.policyRefs.length === 0 &&
    object.views.length > 0
  );
}

function objectToPartial(
  object: ObjectDeclarationAst,
  generatedPolicies: PartialPolicyModel[],
): PartialObjectModel {
  return {
    name: object.name,
    ...(object.businessKey === undefined ? {} : { businessKey: object.businessKey }),
    ...(object.displayField === undefined ? {} : { displayField: object.displayField }),
    fields: object.fields.map(fieldToPartial),
    computedFields: object.computedFields.map((field) => ({
      name: field.name,
      type: field.type,
      expression: field.expression,
    })),
    ...(object.scope === undefined
      ? {}
      : { scope: { context: object.scope.context, field: object.scope.field } }),
    constraints: object.constraints.map(objectConstraintToPartial),
    validations: object.validations.map((validation) => ({
      name: validation.name,
      expression: validation.expression,
      ...(validation.message === undefined ? {} : { message: validation.message }),
    })),
    ...(object.lifecycle === undefined
      ? {}
      : { lifecycle: lifecycleToPartial(object, generatedPolicies) }),
    policies: [...object.policyRefs],
    views: object.views.map(viewToPartial),
    ...(object.sync === undefined ? {} : { sync: objectSyncToPartial(object.sync) }),
  };
}

function contextToPartial(context: BusinessContextDeclarationAst): PartialBusinessContextModel {
  return {
    name: context.name,
    ...(context.object === undefined ? {} : { object: context.object }),
    ...(context.selection === undefined
      ? {}
      : {
          selection: {
            ...(context.selection.mode === undefined ? {} : { mode: context.selection.mode }),
            ...(context.selection.autoSelect === undefined
              ? {}
              : { autoSelect: context.selection.autoSelect }),
            ...(context.selection.persistence === undefined
              ? {}
              : { persistence: context.selection.persistence }),
            ...(context.selection.source === undefined ? {} : { source: context.selection.source }),
            ...(context.selection.routeParam === undefined
              ? {}
              : { routeParam: context.selection.routeParam }),
          },
        }),
    ...(context.membership === undefined
      ? {}
      : {
          membership: {
            object: context.membership.object,
            userField: context.membership.userField,
            contextField: context.membership.contextField,
            roleField: context.membership.roleField,
            roles: [...context.membership.roles],
          },
        }),
  };
}

function objectConstraintToPartial(
  constraint: ObjectConstraintDeclarationAst,
): PartialObjectConstraintModel {
  if (constraint.kind === "UniqueObjectConstraintDeclaration") {
    return {
      name: constraint.name,
      kind: "unique",
      fields: [...constraint.fields],
      scopeFields: [...constraint.scopeFields],
    };
  }

  return {
    name: constraint.name,
    kind: "ordered",
    parentField: constraint.parentField,
    positionField: constraint.positionField,
    scopeFields: [...constraint.scopeFields],
    ...(constraint.minPosition === undefined ? {} : { minPosition: constraint.minPosition }),
  };
}

function fieldToPartial(field: FieldDeclarationAst): PartialFieldModel {
  return {
    name: field.name,
    type: field.type,
    required: field.required,
    ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue }),
    validators: field.validators.map((validator) =>
      validator.validatorKind === "predicate"
        ? {
            kind: "predicate",
            expression: validator.expression ?? { kind: "literal", value: true },
            ...(validator.message === undefined ? {} : { message: validator.message }),
          }
        : {
            kind: validator.validatorKind,
            ...(validator.value === undefined ? {} : { value: validator.value }),
          },
    ),
    readonly: field.readonly,
    hidden: field.hidden,
    ...(field.lookup === undefined
      ? {}
      : {
          lookup: {
            targetObject: field.lookup.targetObject,
            ...(field.lookup.targetField === undefined
              ? {}
              : { targetField: field.lookup.targetField }),
            displayField: field.lookup.displayField,
          },
        }),
    ...(field.autoId === undefined
      ? {}
      : {
          autoId: {
            ...(field.autoId.prefix === undefined ? {} : { prefix: field.autoId.prefix }),
            ...(field.autoId.pad === undefined ? {} : { pad: field.autoId.pad }),
            ...(field.autoId.scopeField === undefined
              ? {}
              : { scopeField: field.autoId.scopeField }),
          },
        }),
  };
}

function readModelToPartial(readModel: ReadModelDeclarationAst): PartialReadModelModel {
  return {
    name: readModel.name,
    ...(readModel.context === undefined
      ? {}
      : { context: viewContextToPartial(readModel.context) }),
    sources: readModel.sources.map((source) => ({
      name: source.name,
      object: source.object,
      ...(source.scope === undefined ? {} : { scope: source.scope }),
    })),
    fields: readModel.fields.map((field) => ({
      name: field.name,
      ...(field.type === undefined ? {} : { type: field.type }),
      ...(field.source === undefined ? {} : { source: field.source }),
      ...(field.field === undefined ? {} : { field: field.field }),
      ...(field.expression === undefined ? {} : { expression: field.expression }),
    })),
    sort: readModel.sort.map((sort) => ({
      field: sort.field,
      direction: sort.direction,
    })),
  };
}

function lifecycleToPartial(
  object: ObjectDeclarationAst,
  generatedPolicies: PartialPolicyModel[],
): PartialLifecycleModel {
  const lifecycle = object.lifecycle;

  if (lifecycle === undefined) {
    throw new Error(`Object '${object.name}' has no lifecycle to compile.`);
  }

  return {
    name: lifecycle.name,
    ...(lifecycle.stateField === undefined ? {} : { stateField: lifecycle.stateField }),
    ...(lifecycle.initialState === undefined ? {} : { initialState: lifecycle.initialState }),
    states: lifecycle.states.map((state) => ({
      name: state.name,
      terminal: state.terminal,
    })),
    actions: lifecycle.actions.map((action) =>
      actionToPartial(object.name, action, generatedPolicies),
    ),
  };
}

function actionToPartial(
  objectName: string,
  action: ActionDeclarationAst,
  generatedPolicies: PartialPolicyModel[],
): PartialLifecycleActionModel {
  const generatedPolicyName = createInlineActionPolicy(objectName, action, generatedPolicies);
  const policyRefs = uniqueStrings([
    ...action.policyRefs,
    ...(generatedPolicyName === undefined ? [] : [generatedPolicyName]),
  ]);

  return {
    name: action.name,
    from: action.from.length === 1 ? (action.from[0] ?? "") : [...action.from],
    to: action.to,
    ...(action.label === undefined ? {} : { label: action.label }),
    guards: action.guards.map((guard, index) => ({
      name: guard.name === `${action.name}Guard` ? `${action.name}Guard${index + 1}` : guard.name,
      expression: guard.expression,
      ...(guard.message === undefined ? {} : { message: guard.message }),
    })),
    policyRefs,
    hooks: {
      before: [...action.hooks.before],
      after: [...action.hooks.after],
      onError: [...action.hooks.onError],
    },
  };
}

function createInlineActionPolicy(
  objectName: string,
  action: ActionDeclarationAst,
  generatedPolicies: PartialPolicyModel[],
): string | undefined {
  if (action.allowRules.length === 0) {
    return undefined;
  }

  const policyName = `${objectName}${pascalCase(action.name)}Policy`;
  generatedPolicies.push({
    name: policyName,
    object: objectName,
    rules: action.allowRules.map((allowRule, index) => ({
      name: `allow${allowRule.roles.map(pascalCase).join("") || "Everyone"}${pascalCase(action.name)}${index + 1}`,
      effect: "allow",
      principal:
        allowRule.roles.length === 0
          ? { match: "everyone" }
          : { match: "specific", roles: [...allowRule.roles] },
      action: "transition",
      state: allowRule.states.length > 0 ? [...allowRule.states] : [...action.from],
      lifecycleAction: action.name,
    })),
  });

  return policyName;
}

function decisionTableToPartial(table: DecisionTableDeclarationAst): PartialDecisionTableModel {
  return {
    name: table.name,
    object: table.object,
    match: table.match,
    inputs: table.inputs.map((input) => ({
      name: input.name,
      expression: input.expression,
    })),
    rows: table.rows.map((row) => ({
      name: row.name,
      condition: row.condition,
      outputs: { ...row.outputs },
    })),
    ...(table.defaultOutputs === undefined ? {} : { defaultOutputs: { ...table.defaultOutputs } }),
  };
}

function commandToPartial(command: CommandDeclarationAst): PartialCommandModel {
  return {
    name: command.name,
    ...(command.label === undefined ? {} : { label: command.label }),
    inputs: command.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      required: input.required,
      ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
    })),
    preconditions: command.preconditions.map((precondition) => ({
      name: precondition.name,
      expression: precondition.expression,
      ...(precondition.message === undefined ? {} : { message: precondition.message }),
    })),
    steps: command.steps.map(commandStepToPartial),
  };
}

function commandStepToPartial(step: CommandStepDeclarationAst): PartialCommandStepModel {
  if (step.action === "update") {
    return {
      name: step.name,
      action: "update",
      object: step.object,
      ...(step.authority === undefined ? {} : { authority: step.authority }),
      recordId: step.recordId ?? { kind: "literal", value: null },
      patch: { ...step.values },
      preconditions: [...step.preconditions],
    };
  }

  return {
    name: step.name,
    action: "create",
    object: step.object,
    ...(step.authority === undefined ? {} : { authority: step.authority }),
    values: { ...step.values },
    preconditions: [...step.preconditions],
  };
}

function viewToPartial(view: ViewDeclarationAst): PartialViewModel {
  return {
    name: view.name,
    kind: view.viewKind,
    ...(view.context === undefined ? {} : { context: viewContextToPartial(view.context) }),
    ...(view.readModel === undefined ? {} : { readModel: view.readModel }),
    fields: [...view.fields],
    searchFields: [...view.searchFields],
    sort: view.sort.map((sort) => ({
      field: sort.field,
      direction: sort.direction,
    })),
    actions: [...view.actions],
    ...(view.presentation === undefined
      ? {}
      : {
          presentation: {
            ...(view.presentation.layout === undefined ? {} : { layout: view.presentation.layout }),
            ...(view.presentation.density === undefined
              ? {}
              : { density: view.presentation.density }),
            state: view.presentation.state.map(presentationStateToPartial),
            iconMaps: view.presentation.iconMaps.map(presentationIconMapToPartial),
            statuses: view.presentation.statuses.map(presentationStatusToPartial),
            statusMaps: view.presentation.statusMaps.map(presentationStatusMapToPartial),
            legends: view.presentation.legends.map(presentationLegendToPartial),
            sections: view.presentation.sections.map(presentationSectionToPartial),
          },
        }),
  };
}

function presentationStateToPartial(
  state: PresentationStateDeclarationAst,
): PartialPresentationStateModel {
  return {
    name: state.name,
    ...(state.type === undefined ? {} : { type: state.type }),
    ...(state.defaultValue === undefined ? {} : { defaultValue: state.defaultValue }),
    ...(state.persistence === undefined ? {} : { persistence: state.persistence }),
  };
}

function presentationIconMapToPartial(
  iconMap: PresentationIconMapDeclarationAst,
): PartialPresentationIconMapModel {
  return {
    name: iconMap.name,
    field: iconMap.field,
    values: iconMap.values.map((value) => ({ value: value.value, icon: value.icon })),
    ...(iconMap.defaultIcon === undefined ? {} : { defaultIcon: iconMap.defaultIcon }),
  };
}

function presentationStatusToPartial(
  status: PresentationStatusDeclarationAst,
): PartialPresentationStatusModel {
  return {
    name: status.name,
    ...(status.label === undefined ? {} : { label: status.label }),
    ...(status.accessibleLabel === undefined ? {} : { accessibleLabel: status.accessibleLabel }),
    ...(status.icon === undefined ? {} : { icon: presentationIconRefToPartial(status.icon) }),
    ...(status.themeToken === undefined ? {} : { themeToken: status.themeToken }),
    ...(status.precedence === undefined ? {} : { precedence: status.precedence }),
  };
}

function presentationStatusMapToPartial(
  statusMap: PresentationStatusMapDeclarationAst,
): PartialPresentationStatusMapModel {
  return {
    name: statusMap.name,
    field: statusMap.field,
    values: statusMap.values.map((value) => ({ value: value.value, status: value.status })),
    ...(statusMap.defaultStatus === undefined ? {} : { defaultStatus: statusMap.defaultStatus }),
  };
}

function presentationLegendToPartial(
  legend: PresentationLegendDeclarationAst,
): PartialPresentationLegendModel {
  return {
    name: legend.name,
    ...(legend.title === undefined ? {} : { title: legend.title }),
    statuses: [...legend.statuses],
    ...(legend.include === undefined ? {} : { include: legend.include }),
  };
}

function presentationSectionToPartial(
  section: PresentationSectionDeclarationAst,
): PartialPresentationSectionModel {
  return {
    name: section.name,
    ...(section.heading === undefined ? {} : { heading: section.heading }),
    ...(section.layout === undefined ? {} : { layout: section.layout }),
    ...(section.density === undefined ? {} : { density: section.density }),
    controls: section.controls.map(presentationControlToPartial),
    lists: section.lists.map(presentationListToPartial),
  };
}

function presentationControlToPartial(
  control: PresentationControlDeclarationAst,
): PartialPresentationControlModel {
  if (control.kind === "PresentationActionControlDeclaration") {
    return presentationActionToPartial(control);
  }

  return {
    name: control.name,
    kind: "toggle",
    state: control.state,
    ...(control.label === undefined ? {} : { label: control.label }),
    ...(control.icon === undefined ? {} : { icon: presentationIconRefToPartial(control.icon) }),
  };
}

function presentationActionToPartial(
  action: PresentationActionControlDeclarationAst,
): Extract<PartialPresentationControlModel, { kind: "action" }> {
  return {
    name: action.name,
    kind: "action",
    ...(action.label === undefined ? {} : { label: action.label }),
    ...(action.icon === undefined ? {} : { icon: presentationIconRefToPartial(action.icon) }),
    ...(action.placement === undefined ? {} : { placement: action.placement }),
    ...(action.command === undefined ? {} : { command: action.command }),
    ...(action.view === undefined ? {} : { view: action.view }),
    ...(action.input.length === 0
      ? {}
      : {
          input: Object.fromEntries(action.input.map((input) => [input.name, input.expression])),
        }),
    ...(action.visibleWhen === undefined ? {} : { visibleWhen: action.visibleWhen }),
  };
}

function presentationListToPartial(
  list: PresentationListDeclarationAst,
): PartialPresentationListModel {
  return {
    name: list.name,
    ...(list.sourceKind === undefined ? {} : { sourceKind: list.sourceKind }),
    source: list.source,
    ...(list.renderAs === undefined ? {} : { renderAs: list.renderAs }),
    ...(list.density === undefined ? {} : { density: list.density }),
    sort: list.sort.map((sort) => ({
      field: sort.field,
      direction: sort.direction,
    })),
    ...(list.filter === undefined ? {} : { filter: list.filter }),
    ...(list.emptyText === undefined ? {} : { emptyState: { text: list.emptyText } }),
    ...(list.statusCandidates.length === 0
      ? {}
      : {
          status: { candidates: list.statusCandidates.map(presentationStatusCandidateToPartial) },
        }),
    ...(list.actions.length === 0
      ? {}
      : { actions: list.actions.map((action) => presentationActionToPartial(action)) }),
    ...(list.row === undefined ? {} : { row: presentationRowTemplateToPartial(list.row) }),
  };
}

function presentationStatusCandidateToPartial(
  candidate: PresentationStatusCandidateDeclarationAst,
): PartialPresentationStatusCandidateModel {
  if (candidate.kind === "direct") {
    return { kind: "status", status: candidate.status };
  }

  return {
    kind: "map",
    map: candidate.map,
    ...(candidate.field === undefined ? {} : { field: candidate.field }),
    ...(candidate.value === undefined ? {} : { value: candidate.value }),
  };
}

function presentationRowTemplateToPartial(
  row: PresentationRowTemplateDeclarationAst,
): PartialPresentationRowTemplateModel {
  return {
    ...(row.layout === undefined ? {} : { layout: row.layout }),
    ...(row.density === undefined ? {} : { density: row.density }),
    fragments: row.fragments.map(presentationRowFragmentToPartial),
  };
}

function presentationRowFragmentToPartial(
  fragment: PresentationRowFragmentDeclarationAst,
): PartialPresentationRowFragmentModel {
  if (fragment.kind === "PresentationLiteralTextFragmentDeclaration") {
    return {
      kind: "text",
      text: fragment.text,
      ...(fragment.style === undefined ? {} : { style: fragment.style }),
    };
  }

  if (fragment.kind === "PresentationFieldTextFragmentDeclaration") {
    return {
      kind: "field",
      field: fragment.field,
      ...(fragment.style === undefined ? {} : { style: fragment.style }),
      ...(fragment.format === undefined ? {} : { format: fragment.format }),
    };
  }

  return {
    kind: "icon",
    icon: presentationIconRefToPartial(fragment.icon),
    ...(fragment.label === undefined ? {} : { label: fragment.label }),
  };
}

function presentationIconRefToPartial(
  icon: PresentationIconRefDeclarationAst,
): PartialPresentationIconRefModel {
  if (icon.kind === "named") {
    return { kind: "named", name: icon.name };
  }

  return {
    kind: "map",
    map: icon.map,
    ...(icon.field === undefined ? {} : { field: icon.field }),
    ...(icon.value === undefined ? {} : { value: icon.value }),
  };
}

function viewContextToPartial(
  context: NonNullable<ViewDeclarationAst["context"]>,
): PartialViewContextModel {
  return {
    mode: context.mode,
    ...(context.context === undefined ? {} : { context: context.context }),
  };
}

function policyToPartial(policy: PolicyDeclarationAst): PartialPolicyModel {
  return {
    name: policy.name,
    object: policy.object,
    rules: policy.rules.map(policyRuleToPartial),
  };
}

function policyRuleToPartial(rule: PolicyRuleDeclarationAst): PartialPolicyRuleModel {
  return {
    name: rule.name,
    effect: rule.effect,
    principal: principalToPartial(rule.principal),
    action: rule.action,
    state: [...rule.state],
    fields: [...rule.fields],
    ...(rule.lifecycleAction === undefined ? {} : { lifecycleAction: rule.lifecycleAction }),
    ...(rule.condition === undefined ? {} : { condition: rule.condition }),
    ...(rule.channels.length === 0 ? {} : { channels: [...rule.channels] }),
  };
}

function principalToPartial(principal: PrincipalSelectorAst): PartialPrincipalSelectorModel {
  const hasSpecificPrincipal =
    principal.roles.length > 0 ||
    principal.groupRoles.length > 0 ||
    principal.users.length > 0 ||
    principal.owner;

  return {
    match: principal.match ?? (hasSpecificPrincipal ? "specific" : "everyone"),
    roles: [...principal.roles],
    groupRoles: [...principal.groupRoles],
    users: [...principal.users],
    owner: principal.owner,
  };
}

function themeToPartial(theme: ThemeDeclarationAst): PartialThemeModel {
  return {
    name: theme.name,
    ...(theme.base === undefined ? {} : { base: theme.base }),
    tokens: Object.fromEntries(
      theme.tokens.map((token) => [token.token, token.value]),
    ) as Partial<ResolvedThemeTokens>,
  };
}

function syncToPartial(sync: SyncDeclarationAst): PartialSyncPolicyModel {
  return {
    object: sync.object ?? "",
    mode: sync.mode,
    ...(sync.scope === undefined ? {} : { scope: sync.scope }),
    ...(sync.conflict === undefined ? {} : { conflict: sync.conflict }),
  };
}

function objectSyncToPartial(sync: SyncDeclarationAst): Omit<PartialSyncPolicyModel, "object"> {
  return {
    mode: sync.mode,
    ...(sync.scope === undefined ? {} : { scope: sync.scope }),
    ...(sync.conflict === undefined ? {} : { conflict: sync.conflict }),
  };
}

function uniqueStrings(input: string[]): string[] {
  return [...new Set(input)];
}

function pascalCase(value: string): string {
  const parts = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0);

  return parts
    .map((part) => part.toLowerCase())
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
