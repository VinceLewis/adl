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
  PrincipalSelectorAst,
  ReadModelDeclarationAst,
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
  PartialPrincipalSelectorModel,
  PartialReadModelModel,
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
  const objects = ast.objects.map((object) => objectToPartial(object, generatedPolicies));

  return {
    app: {
      name: ast.app.name,
      ...(ast.app.startView === undefined ? {} : { startView: ast.app.startView }),
      ...(ast.app.theme === undefined ? {} : { theme: ast.app.theme }),
    },
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
