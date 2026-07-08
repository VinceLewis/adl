import { DEFAULT_LIFECYCLE_STATE_FIELD } from "../model/defaults.js";
import type {
  ConflictStrategy,
  CommandRuntimeProperty,
  CommandStepAuthority,
  CommandStepMetaProperty,
  ContextSelectionMode,
  ContextSelectionPersistence,
  ContextSelectionSource,
  FieldType,
  PolicyAction,
  PolicyConditionRuntimeProperty,
  ReadModelSourceScope,
  ResolvedApplicationModel,
  ResolvedBusinessContext,
  ResolvedCommand,
  ResolvedCommandInput,
  ResolvedCommandStep,
  ResolvedCommandValueExpression,
  ResolvedContextMembership,
  ResolvedField,
  ResolvedHookRefs,
  ResolvedLifecycle,
  ResolvedObject,
  ResolvedObjectConstraint,
  ResolvedObjectScope,
  ResolvedPolicy,
  ResolvedPolicyCondition,
  ResolvedPolicyConditionOperand,
  ResolvedPolicyRule,
  ResolvedReadModel,
  ResolvedSyncPolicy,
  ResolvedSyncWindow,
  ResolvedTheme,
  ResolvedThemeTokens,
  ResolvedView,
  ResolvedViewContext,
  RuntimeChannel,
  SyncMode,
  SyncScope,
  ViewContextMode,
  ViewKind,
} from "../model/resolved-model.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface SourcePosition {
  line: number;
  column: number;
  offset?: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
  sourceRange?: SourceRange;
}

export const MODEL_VALIDATION_CODES = {
  APP_START_VIEW_UNKNOWN: "ADL_APP_START_VIEW_UNKNOWN",
  APP_THEME_UNKNOWN: "ADL_APP_THEME_UNKNOWN",
  AUTO_ID_NON_TEXT: "ADL_AUTO_ID_NON_TEXT",
  AUTO_ID_SCOPE_FIELD_UNKNOWN: "ADL_AUTO_ID_SCOPE_FIELD_UNKNOWN",
  CONTEXT_DUPLICATE: "ADL_CONTEXT_DUPLICATE",
  CONTEXT_MEMBERSHIP_CONTEXT_FIELD_INVALID: "ADL_CONTEXT_MEMBERSHIP_CONTEXT_FIELD_INVALID",
  CONTEXT_MEMBERSHIP_FIELD_UNKNOWN: "ADL_CONTEXT_MEMBERSHIP_FIELD_UNKNOWN",
  CONTEXT_MEMBERSHIP_OBJECT_UNKNOWN: "ADL_CONTEXT_MEMBERSHIP_OBJECT_UNKNOWN",
  CONTEXT_MEMBERSHIP_ROLE_FIELD_INVALID: "ADL_CONTEXT_MEMBERSHIP_ROLE_FIELD_INVALID",
  CONTEXT_OBJECT_UNKNOWN: "ADL_CONTEXT_OBJECT_UNKNOWN",
  CONTEXT_SELECTION_MODE_INVALID: "ADL_CONTEXT_SELECTION_MODE_INVALID",
  CONTEXT_SELECTION_PERSISTENCE_INVALID: "ADL_CONTEXT_SELECTION_PERSISTENCE_INVALID",
  CONTEXT_SELECTION_ROUTE_PARAM_INVALID: "ADL_CONTEXT_SELECTION_ROUTE_PARAM_INVALID",
  CONTEXT_SELECTION_SOURCE_INVALID: "ADL_CONTEXT_SELECTION_SOURCE_INVALID",
  FIELD_DEFAULT_INCOMPATIBLE: "ADL_FIELD_DEFAULT_INCOMPATIBLE",
  FIELD_DUPLICATE: "ADL_FIELD_DUPLICATE",
  HOOK_REFERENCE_INVALID: "ADL_HOOK_REFERENCE_INVALID",
  LIFECYCLE_ACTION_DUPLICATE: "ADL_LIFECYCLE_ACTION_DUPLICATE",
  LIFECYCLE_ACTION_FROM_UNKNOWN: "ADL_LIFECYCLE_ACTION_FROM_UNKNOWN",
  LIFECYCLE_ACTION_POLICY_MISMATCH: "ADL_LIFECYCLE_ACTION_POLICY_MISMATCH",
  LIFECYCLE_ACTION_POLICY_UNKNOWN: "ADL_LIFECYCLE_ACTION_POLICY_UNKNOWN",
  LIFECYCLE_ACTION_TO_UNKNOWN: "ADL_LIFECYCLE_ACTION_TO_UNKNOWN",
  LIFECYCLE_INITIAL_STATE_UNKNOWN: "ADL_LIFECYCLE_INITIAL_STATE_UNKNOWN",
  LIFECYCLE_STATE_DUPLICATE: "ADL_LIFECYCLE_STATE_DUPLICATE",
  LIFECYCLE_STATE_FIELD_TYPE_INVALID: "ADL_LIFECYCLE_STATE_FIELD_TYPE_INVALID",
  LIFECYCLE_STATE_FIELD_UNKNOWN: "ADL_LIFECYCLE_STATE_FIELD_UNKNOWN",
  LOOKUP_DISPLAY_FIELD_UNKNOWN: "ADL_LOOKUP_DISPLAY_FIELD_UNKNOWN",
  LOOKUP_TARGET_FIELD_UNKNOWN: "ADL_LOOKUP_TARGET_FIELD_UNKNOWN",
  LOOKUP_TARGET_OBJECT_UNKNOWN: "ADL_LOOKUP_TARGET_OBJECT_UNKNOWN",
  OBJECT_BUSINESS_KEY_UNKNOWN: "ADL_OBJECT_BUSINESS_KEY_UNKNOWN",
  COMMAND_AUTHORITY_INVALID: "ADL_COMMAND_AUTHORITY_INVALID",
  COMMAND_DUPLICATE: "ADL_COMMAND_DUPLICATE",
  COMMAND_INPUT_DEFAULT_INCOMPATIBLE: "ADL_COMMAND_INPUT_DEFAULT_INCOMPATIBLE",
  COMMAND_INPUT_DUPLICATE: "ADL_COMMAND_INPUT_DUPLICATE",
  COMMAND_INPUT_TYPE_INVALID: "ADL_COMMAND_INPUT_TYPE_INVALID",
  COMMAND_PRECONDITION_FIELD_UNKNOWN: "ADL_COMMAND_PRECONDITION_FIELD_UNKNOWN",
  COMMAND_PRECONDITION_INVALID: "ADL_COMMAND_PRECONDITION_INVALID",
  COMMAND_PRECONDITION_RUNTIME_PROPERTY_INVALID:
    "ADL_COMMAND_PRECONDITION_RUNTIME_PROPERTY_INVALID",
  COMMAND_STEP_ACTION_INVALID: "ADL_COMMAND_STEP_ACTION_INVALID",
  COMMAND_STEP_DUPLICATE: "ADL_COMMAND_STEP_DUPLICATE",
  COMMAND_STEP_FIELD_UNKNOWN: "ADL_COMMAND_STEP_FIELD_UNKNOWN",
  COMMAND_STEP_INPUT_UNKNOWN: "ADL_COMMAND_STEP_INPUT_UNKNOWN",
  COMMAND_STEP_META_PROPERTY_INVALID: "ADL_COMMAND_STEP_META_PROPERTY_INVALID",
  COMMAND_STEP_OBJECT_UNKNOWN: "ADL_COMMAND_STEP_OBJECT_UNKNOWN",
  COMMAND_STEP_REFERENCE_UNKNOWN: "ADL_COMMAND_STEP_REFERENCE_UNKNOWN",
  COMMAND_STEP_RUNTIME_PROPERTY_INVALID: "ADL_COMMAND_STEP_RUNTIME_PROPERTY_INVALID",
  OBJECT_DISPLAY_FIELD_UNKNOWN: "ADL_OBJECT_DISPLAY_FIELD_UNKNOWN",
  OBJECT_CONSTRAINT_DUPLICATE: "ADL_OBJECT_CONSTRAINT_DUPLICATE",
  OBJECT_CONSTRAINT_FIELD_UNKNOWN: "ADL_OBJECT_CONSTRAINT_FIELD_UNKNOWN",
  OBJECT_CONSTRAINT_KIND_INVALID: "ADL_OBJECT_CONSTRAINT_KIND_INVALID",
  OBJECT_CONSTRAINT_MIN_POSITION_INVALID: "ADL_OBJECT_CONSTRAINT_MIN_POSITION_INVALID",
  OBJECT_CONSTRAINT_POSITION_FIELD_TYPE_INVALID:
    "ADL_OBJECT_CONSTRAINT_POSITION_FIELD_TYPE_INVALID",
  OBJECT_DUPLICATE: "ADL_OBJECT_DUPLICATE",
  OBJECT_POLICY_MISMATCH: "ADL_OBJECT_POLICY_MISMATCH",
  OBJECT_POLICY_UNKNOWN: "ADL_OBJECT_POLICY_UNKNOWN",
  OBJECT_SCOPE_CONTEXT_UNKNOWN: "ADL_OBJECT_SCOPE_CONTEXT_UNKNOWN",
  OBJECT_SCOPE_FIELD_CONTEXT_MISMATCH: "ADL_OBJECT_SCOPE_FIELD_CONTEXT_MISMATCH",
  OBJECT_SCOPE_FIELD_UNKNOWN: "ADL_OBJECT_SCOPE_FIELD_UNKNOWN",
  OBJECT_SYNC_CONFLICT_INVALID: "ADL_OBJECT_SYNC_CONFLICT_INVALID",
  OBJECT_SYNC_MODE_INVALID: "ADL_OBJECT_SYNC_MODE_INVALID",
  OBJECT_SYNC_SCOPE_INVALID: "ADL_OBJECT_SYNC_SCOPE_INVALID",
  OBJECT_SYNC_WINDOW_DAYS_INVALID: "ADL_OBJECT_SYNC_WINDOW_DAYS_INVALID",
  OBJECT_SYNC_WINDOW_FIELD_UNKNOWN: "ADL_OBJECT_SYNC_WINDOW_FIELD_UNKNOWN",
  OBJECT_SYNC_WINDOW_LIMIT_INVALID: "ADL_OBJECT_SYNC_WINDOW_LIMIT_INVALID",
  POLICY_ACTION_INVALID: "ADL_POLICY_ACTION_INVALID",
  POLICY_DEFAULT_EFFECT_INVALID: "ADL_POLICY_DEFAULT_EFFECT_INVALID",
  POLICY_DUPLICATE: "ADL_POLICY_DUPLICATE",
  POLICY_FIELD_UNKNOWN: "ADL_POLICY_FIELD_UNKNOWN",
  POLICY_CONDITION_FIELD_UNKNOWN: "ADL_POLICY_CONDITION_FIELD_UNKNOWN",
  POLICY_CONDITION_INVALID: "ADL_POLICY_CONDITION_INVALID",
  POLICY_CONDITION_RUNTIME_PROPERTY_INVALID: "ADL_POLICY_CONDITION_RUNTIME_PROPERTY_INVALID",
  POLICY_LIFECYCLE_ACTION_UNKNOWN: "ADL_POLICY_LIFECYCLE_ACTION_UNKNOWN",
  POLICY_OBJECT_UNKNOWN: "ADL_POLICY_OBJECT_UNKNOWN",
  POLICY_STATE_UNKNOWN: "ADL_POLICY_STATE_UNKNOWN",
  POLICY_CHANNEL_INVALID: "ADL_POLICY_CHANNEL_INVALID",
  READ_MODEL_CONTEXT_MODE_INVALID: "ADL_READ_MODEL_CONTEXT_MODE_INVALID",
  READ_MODEL_CONTEXT_REQUIRED: "ADL_READ_MODEL_CONTEXT_REQUIRED",
  READ_MODEL_CONTEXT_UNKNOWN: "ADL_READ_MODEL_CONTEXT_UNKNOWN",
  READ_MODEL_DUPLICATE: "ADL_READ_MODEL_DUPLICATE",
  READ_MODEL_FIELD_DUPLICATE: "ADL_READ_MODEL_FIELD_DUPLICATE",
  READ_MODEL_FIELD_SOURCE_UNKNOWN: "ADL_READ_MODEL_FIELD_SOURCE_UNKNOWN",
  READ_MODEL_FIELD_TYPE_INVALID: "ADL_READ_MODEL_FIELD_TYPE_INVALID",
  READ_MODEL_FIELD_UNKNOWN: "ADL_READ_MODEL_FIELD_UNKNOWN",
  READ_MODEL_SOURCE_DUPLICATE: "ADL_READ_MODEL_SOURCE_DUPLICATE",
  READ_MODEL_SOURCE_OBJECT_UNKNOWN: "ADL_READ_MODEL_SOURCE_OBJECT_UNKNOWN",
  READ_MODEL_SOURCE_SCOPE_INVALID: "ADL_READ_MODEL_SOURCE_SCOPE_INVALID",
  READ_MODEL_SORT_FIELD_UNKNOWN: "ADL_READ_MODEL_SORT_FIELD_UNKNOWN",
  SYNC_CONFLICT_INVALID: "ADL_SYNC_CONFLICT_INVALID",
  SYNC_MODE_INVALID: "ADL_SYNC_MODE_INVALID",
  SYNC_OBJECT_UNKNOWN: "ADL_SYNC_OBJECT_UNKNOWN",
  SYNC_SCOPE_INVALID: "ADL_SYNC_SCOPE_INVALID",
  SYNC_WINDOW_DAYS_INVALID: "ADL_SYNC_WINDOW_DAYS_INVALID",
  SYNC_WINDOW_FIELD_UNKNOWN: "ADL_SYNC_WINDOW_FIELD_UNKNOWN",
  SYNC_WINDOW_LIMIT_INVALID: "ADL_SYNC_WINDOW_LIMIT_INVALID",
  THEME_BASE_SELF_REFERENCE: "ADL_THEME_BASE_SELF_REFERENCE",
  THEME_BASE_CYCLE: "ADL_THEME_BASE_CYCLE",
  THEME_BASE_UNKNOWN: "ADL_THEME_BASE_UNKNOWN",
  THEME_DUPLICATE: "ADL_THEME_DUPLICATE",
  THEME_TOKEN_INVALID: "ADL_THEME_TOKEN_INVALID",
  VIEW_FIELD_UNKNOWN: "ADL_VIEW_FIELD_UNKNOWN",
  VIEW_CONTEXT_MODE_INVALID: "ADL_VIEW_CONTEXT_MODE_INVALID",
  VIEW_CONTEXT_REQUIRED: "ADL_VIEW_CONTEXT_REQUIRED",
  VIEW_CONTEXT_UNKNOWN: "ADL_VIEW_CONTEXT_UNKNOWN",
  VIEW_KIND_INVALID: "ADL_VIEW_KIND_INVALID",
  VIEW_OBJECT_UNKNOWN: "ADL_VIEW_OBJECT_UNKNOWN",
  VIEW_READ_MODEL_UNKNOWN: "ADL_VIEW_READ_MODEL_UNKNOWN",
  VIEW_SEARCH_FIELD_UNKNOWN: "ADL_VIEW_SEARCH_FIELD_UNKNOWN",
  VIEW_SORT_FIELD_UNKNOWN: "ADL_VIEW_SORT_FIELD_UNKNOWN",
} as const;

export type ModelValidationCode =
  (typeof MODEL_VALIDATION_CODES)[keyof typeof MODEL_VALIDATION_CODES];

const FIELD_TYPES = new Set<FieldType>([
  "text",
  "number",
  "date",
  "datetime",
  "time",
  "boolean",
  "attachment",
]);

const VIEW_KINDS = new Set<ViewKind>([
  "list",
  "detail",
  "form",
  "dashboard",
  "masterDetail",
  "grid",
  "composite",
]);

const CONTEXT_SELECTION_MODES = new Set<ContextSelectionMode>(["required", "optional"]);
const CONTEXT_SELECTION_PERSISTENCE = new Set<ContextSelectionPersistence>([
  "none",
  "session",
  "local",
]);
const CONTEXT_SELECTION_SOURCES = new Set<ContextSelectionSource>(["runtime", "route"]);
const VIEW_CONTEXT_MODES = new Set<ViewContextMode>(["none", "required", "optional", "all"]);
const READ_MODEL_SOURCE_SCOPES = new Set<ReadModelSourceScope>([
  "all",
  "currentContext",
  "allAvailableContexts",
  "currentUser",
]);

const POLICY_ACTIONS = new Set<PolicyAction>([
  "*",
  "create",
  "read",
  "update",
  "delete",
  "search",
  "transition",
  "export",
  "import",
]);

const RUNTIME_CHANNELS = new Set<RuntimeChannel>(["ui", "api", "sync", "import", "test"]);
const POLICY_CONDITION_RUNTIME_PROPERTIES = new Set<PolicyConditionRuntimeProperty>(["userId"]);
const COMMAND_RUNTIME_PROPERTIES = new Set<CommandRuntimeProperty>(["userId", "nowIso", "today"]);
const COMMAND_STEP_AUTHORITIES = new Set<CommandStepAuthority>(["caller", "command"]);
const COMMAND_STEP_META_PROPERTIES = new Set<CommandStepMetaProperty>([
  "guid",
  "createdAt",
  "updatedAt",
]);
const SYNC_MODES = new Set<SyncMode>([
  "localFirst",
  "cacheReadonly",
  "onlineRequired",
  "localPrivate",
]);
const SYNC_SCOPES = new Set<SyncScope>([
  "all",
  "currentUser",
  "assignedToUser",
  "ownedByUser",
  "currentContext",
  "allAvailableContexts",
  "recent",
  "custom",
]);
const CONFLICT_STRATEGIES = new Set<ConflictStrategy>([
  "serverWins",
  "clientWins",
  "stateTransitionWins",
  "manual",
]);

const THEME_RADIUS_VALUES = new Set(["none", "small", "medium", "large"]);
const THEME_DENSITY_VALUES = new Set(["compact", "comfortable", "spacious"]);
const THEME_NAV_VALUES = new Set(["top", "side", "bottom"]);
const THEME_STRING_TOKENS = [
  "colorPrimary",
  "colorAccent",
  "colorBackground",
  "colorSurface",
  "colorSurfaceAlt",
  "colorText",
  "colorTextMuted",
  "colorTextInverted",
  "colorBorder",
  "colorDanger",
  "colorSuccess",
  "colorInfo",
  "fontFamily",
  "logoUrl",
] as const satisfies readonly (keyof ResolvedThemeTokens)[];
const HOOK_REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

interface NamedReference<T> {
  item: T;
  index: number;
}

interface ModelIndexes {
  contextsByName: Map<string, NamedReference<ResolvedBusinessContext>>;
  commandsByName: Map<string, NamedReference<ResolvedCommand>>;
  objectsByName: Map<string, NamedReference<ResolvedObject>>;
  policiesByName: Map<string, NamedReference<ResolvedPolicy>>;
  readModelsByName: Map<string, NamedReference<ResolvedReadModel>>;
  themesByName: Map<string, NamedReference<ResolvedTheme>>;
  viewNames: Set<string>;
}

export function validateApplicationModel(model: ResolvedApplicationModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const indexes: ModelIndexes = {
    contextsByName: indexByName(model.contexts ?? []),
    commandsByName: indexByName(model.commands ?? []),
    objectsByName: indexByName(model.objects),
    policiesByName: indexByName(model.policies),
    readModelsByName: indexByName(model.readModels ?? []),
    themesByName: indexByName(model.themes),
    viewNames: new Set(model.objects.flatMap((object) => object.views.map((view) => view.name))),
  };

  reportDuplicateNames(
    model.contexts ?? [],
    "contexts",
    MODEL_VALIDATION_CODES.CONTEXT_DUPLICATE,
    diagnostics,
    "Business context names must be unique.",
  );
  reportDuplicateNames(
    model.objects,
    "objects",
    MODEL_VALIDATION_CODES.OBJECT_DUPLICATE,
    diagnostics,
    "Object names must be unique.",
  );
  reportDuplicateNames(
    model.policies,
    "policies",
    MODEL_VALIDATION_CODES.POLICY_DUPLICATE,
    diagnostics,
    "Policy names must be unique.",
  );
  reportDuplicateNames(
    model.readModels ?? [],
    "readModels",
    MODEL_VALIDATION_CODES.READ_MODEL_DUPLICATE,
    diagnostics,
    "Read model names must be unique.",
  );
  reportDuplicateNames(
    model.commands ?? [],
    "commands",
    MODEL_VALIDATION_CODES.COMMAND_DUPLICATE,
    diagnostics,
    "Command names must be unique.",
  );
  reportDuplicateNames(
    model.themes,
    "themes",
    MODEL_VALIDATION_CODES.THEME_DUPLICATE,
    diagnostics,
    "Theme names must be unique.",
  );

  validateApplicationReferences(model, indexes, diagnostics);

  for (let contextIndex = 0; contextIndex < (model.contexts ?? []).length; contextIndex += 1) {
    const context = model.contexts?.[contextIndex];
    if (context === undefined) {
      continue;
    }
    validateBusinessContext(context, contextIndex, indexes, diagnostics);
  }

  for (let objectIndex = 0; objectIndex < model.objects.length; objectIndex += 1) {
    const object = model.objects[objectIndex];
    if (object === undefined) {
      continue;
    }
    validateObject(object, objectIndex, indexes, diagnostics);
  }

  for (let policyIndex = 0; policyIndex < model.policies.length; policyIndex += 1) {
    const policy = model.policies[policyIndex];
    if (policy === undefined) {
      continue;
    }
    validatePolicy(policy, policyIndex, indexes, diagnostics);
  }

  for (
    let readModelIndex = 0;
    readModelIndex < (model.readModels ?? []).length;
    readModelIndex += 1
  ) {
    const readModel = model.readModels?.[readModelIndex];
    if (readModel === undefined) {
      continue;
    }
    validateReadModel(readModel, readModelIndex, indexes, diagnostics);
  }

  for (let commandIndex = 0; commandIndex < (model.commands ?? []).length; commandIndex += 1) {
    const command = model.commands?.[commandIndex];
    if (command === undefined) {
      continue;
    }
    validateCommand(command, commandIndex, indexes, diagnostics);
  }

  for (let themeIndex = 0; themeIndex < model.themes.length; themeIndex += 1) {
    const theme = model.themes[themeIndex];
    if (theme === undefined) {
      continue;
    }
    validateTheme(theme, themeIndex, indexes, diagnostics);
  }

  for (let syncIndex = 0; syncIndex < model.sync.length; syncIndex += 1) {
    const sync = model.sync[syncIndex];
    if (sync === undefined) {
      continue;
    }
    validateSyncPolicy(sync, `sync[${syncIndex}]`, indexes, diagnostics);
  }

  return diagnostics;
}

function validateApplicationReferences(
  model: ResolvedApplicationModel,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (model.app.startView !== "" && !indexes.viewNames.has(model.app.startView)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.APP_START_VIEW_UNKNOWN,
        `Application start view '${model.app.startView}' does not exist.`,
        "app.startView",
      ),
    );
  }

  if (!indexes.themesByName.has(model.app.theme)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.APP_THEME_UNKNOWN,
        `Application theme '${model.app.theme}' does not exist.`,
        "app.theme",
      ),
    );
  }
}

function validateBusinessContext(
  context: ResolvedBusinessContext,
  contextIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const contextPath = `contexts[${contextIndex}]`;

  if (!indexes.objectsByName.has(context.object)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_OBJECT_UNKNOWN,
        `Business context '${context.name}' references unknown object '${context.object}'.`,
        `${contextPath}.object`,
      ),
    );
  }

  if (!CONTEXT_SELECTION_MODES.has(context.selection.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_MODE_INVALID,
        `Business context '${context.name}' has invalid selection mode '${String(context.selection.mode)}'.`,
        `${contextPath}.selection.mode`,
      ),
    );
  }

  if (!CONTEXT_SELECTION_PERSISTENCE.has(context.selection.persistence)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_PERSISTENCE_INVALID,
        `Business context '${context.name}' has invalid selection persistence '${String(context.selection.persistence)}'.`,
        `${contextPath}.selection.persistence`,
      ),
    );
  }

  if (!CONTEXT_SELECTION_SOURCES.has(context.selection.source)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_SOURCE_INVALID,
        `Business context '${context.name}' has invalid selection source '${String(context.selection.source)}'.`,
        `${contextPath}.selection.source`,
      ),
    );
  }

  if (
    context.selection.routeParam !== undefined &&
    (typeof context.selection.routeParam !== "string" || context.selection.routeParam.trim() === "")
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_SELECTION_ROUTE_PARAM_INVALID,
        `Business context '${context.name}' route parameter must not be empty.`,
        `${contextPath}.selection.routeParam`,
      ),
    );
  }

  if (context.membership !== undefined) {
    validateContextMembership(
      context.membership,
      context,
      `${contextPath}.membership`,
      indexes,
      diagnostics,
    );
  }
}

function validateContextMembership(
  membership: ResolvedContextMembership,
  context: ResolvedBusinessContext,
  membershipPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const membershipObject = indexes.objectsByName.get(membership.object)?.item;

  if (membershipObject === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_OBJECT_UNKNOWN,
        `Business context '${context.name}' membership references unknown object '${membership.object}'.`,
        `${membershipPath}.object`,
      ),
    );
    return;
  }

  const fieldsByName = indexByName(membershipObject.fields);
  validateMembershipField(
    membership.userField,
    "userField",
    context,
    membershipObject,
    fieldsByName,
    membershipPath,
    diagnostics,
  );
  const contextField = validateMembershipField(
    membership.contextField,
    "contextField",
    context,
    membershipObject,
    fieldsByName,
    membershipPath,
    diagnostics,
  );
  const roleField = validateMembershipField(
    membership.roleField,
    "roleField",
    context,
    membershipObject,
    fieldsByName,
    membershipPath,
    diagnostics,
  );

  if (contextField !== undefined && contextField.lookup?.targetObject !== context.object) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_CONTEXT_FIELD_INVALID,
        `Business context '${context.name}' membership context field '${membership.contextField}' must look up '${context.object}'.`,
        `${membershipPath}.contextField`,
      ),
    );
  }

  if (roleField !== undefined && roleField.type !== "text") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_ROLE_FIELD_INVALID,
        `Business context '${context.name}' membership role field '${membership.roleField}' must be a text field.`,
        `${membershipPath}.roleField`,
      ),
    );
  }
}

function validateMembershipField(
  fieldName: string,
  propertyName: "userField" | "contextField" | "roleField",
  context: ResolvedBusinessContext,
  membershipObject: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  membershipPath: string,
  diagnostics: Diagnostic[],
): ResolvedField | undefined {
  const field = fieldsByName.get(fieldName)?.item;

  if (field === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.CONTEXT_MEMBERSHIP_FIELD_UNKNOWN,
        `Business context '${context.name}' membership field '${fieldName}' does not exist on object '${membershipObject.name}'.`,
        `${membershipPath}.${propertyName}`,
      ),
    );
  }

  return field;
}

function validateObjectScope(
  scope: ResolvedObjectScope,
  object: ResolvedObject,
  objectPath: string,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const context = indexes.contextsByName.get(scope.context)?.item;
  const scopeField = fieldsByName.get(scope.field)?.item;

  if (context === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SCOPE_CONTEXT_UNKNOWN,
        `Object '${object.name}' scope references unknown context '${scope.context}'.`,
        `${objectPath}.scope.context`,
      ),
    );
  }

  if (scopeField === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SCOPE_FIELD_UNKNOWN,
        `Object '${object.name}' scope field '${scope.field}' does not exist.`,
        `${objectPath}.scope.field`,
      ),
    );
    return;
  }

  if (context !== undefined && scopeField.lookup?.targetObject !== context.object) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_SCOPE_FIELD_CONTEXT_MISMATCH,
        `Object '${object.name}' scope field '${scope.field}' must look up context object '${context.object}'.`,
        `${objectPath}.scope.field`,
      ),
    );
  }
}

function validateObject(
  object: ResolvedObject,
  objectIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const objectPath = `objects[${objectIndex}]`;
  const fieldsByName = indexByName(object.fields);

  reportDuplicateNames(
    object.fields,
    `${objectPath}.fields`,
    MODEL_VALIDATION_CODES.FIELD_DUPLICATE,
    diagnostics,
    `Field names must be unique within object '${object.name}'.`,
  );

  if (object.businessKey !== undefined && !fieldsByName.has(object.businessKey)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_BUSINESS_KEY_UNKNOWN,
        `Business key field '${object.businessKey}' does not exist on object '${object.name}'.`,
        `${objectPath}.businessKey`,
      ),
    );
  }

  if (object.displayField !== undefined && !fieldsByName.has(object.displayField)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_DISPLAY_FIELD_UNKNOWN,
        `Display field '${object.displayField}' does not exist on object '${object.name}'.`,
        `${objectPath}.displayField`,
      ),
    );
  }

  if (object.scope !== undefined) {
    validateObjectScope(object.scope, object, objectPath, fieldsByName, indexes, diagnostics);
  }

  reportDuplicateNames(
    object.constraints,
    `${objectPath}.constraints`,
    MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_DUPLICATE,
    diagnostics,
    `Constraint names must be unique within object '${object.name}'.`,
  );

  for (let constraintIndex = 0; constraintIndex < object.constraints.length; constraintIndex += 1) {
    const constraint = object.constraints[constraintIndex];
    if (constraint === undefined) {
      continue;
    }
    validateObjectConstraint(
      constraint,
      `${objectPath}.constraints[${constraintIndex}]`,
      object,
      fieldsByName,
      diagnostics,
    );
  }

  for (let fieldIndex = 0; fieldIndex < object.fields.length; fieldIndex += 1) {
    const field = object.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    validateField(field, fieldIndex, object, objectPath, indexes, diagnostics);
  }

  if (object.lifecycle !== undefined) {
    validateLifecycle(object.lifecycle, object, objectPath, indexes, diagnostics);
  }

  validateObjectPolicyReferences(object, objectPath, indexes, diagnostics);
  validateObjectSyncPolicy(object, objectPath, diagnostics);

  for (let viewIndex = 0; viewIndex < object.views.length; viewIndex += 1) {
    const view = object.views[viewIndex];
    if (view === undefined) {
      continue;
    }
    const viewPath = `${objectPath}.views[${viewIndex}]`;
    validateView(view, viewPath, indexes, diagnostics);
  }
}

function validateObjectConstraint(
  constraint: ResolvedObjectConstraint,
  constraintPath: string,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): void {
  if (constraint.kind === "unique") {
    if (constraint.fields.length === 0) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_FIELD_UNKNOWN,
          `Unique constraint '${constraint.name}' on object '${object.name}' must reference at least one field.`,
          `${constraintPath}.fields`,
        ),
      );
    }

    validateConstraintFieldList(
      constraint.fields,
      `${constraintPath}.fields`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    validateConstraintFieldList(
      constraint.scopeFields,
      `${constraintPath}.scopeFields`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    return;
  }

  if (constraint.kind === "ordered") {
    const parentField = validateConstraintField(
      constraint.parentField,
      `${constraintPath}.parentField`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    const positionField = validateConstraintField(
      constraint.positionField,
      `${constraintPath}.positionField`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );

    void parentField;

    if (positionField !== undefined && positionField.type !== "number") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_POSITION_FIELD_TYPE_INVALID,
          `Ordered constraint '${constraint.name}' on object '${object.name}' position field '${constraint.positionField}' must be a number field.`,
          `${constraintPath}.positionField`,
        ),
      );
    }

    if (!isPositiveInteger(constraint.minPosition)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_MIN_POSITION_INVALID,
          `Ordered constraint '${constraint.name}' on object '${object.name}' minPosition must be a positive integer.`,
          `${constraintPath}.minPosition`,
        ),
      );
    }

    validateConstraintFieldList(
      constraint.scopeFields,
      `${constraintPath}.scopeFields`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
    return;
  }

  diagnostics.push(
    diagnostic(
      MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_KIND_INVALID,
      `Object '${object.name}' has invalid constraint kind '${String((constraint as { kind?: unknown }).kind)}'.`,
      `${constraintPath}.kind`,
    ),
  );
}

function validateConstraintFieldList(
  fieldNames: string[],
  fieldListPath: string,
  constraint: ResolvedObjectConstraint,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): void {
  for (let fieldIndex = 0; fieldIndex < fieldNames.length; fieldIndex += 1) {
    const fieldName = fieldNames[fieldIndex];
    if (fieldName === undefined) {
      continue;
    }
    validateConstraintField(
      fieldName,
      `${fieldListPath}[${fieldIndex}]`,
      constraint,
      object,
      fieldsByName,
      diagnostics,
    );
  }
}

function validateConstraintField(
  fieldName: string,
  fieldPath: string,
  constraint: ResolvedObjectConstraint,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): ResolvedField | undefined {
  const field = fieldsByName.get(fieldName)?.item;
  if (field === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.OBJECT_CONSTRAINT_FIELD_UNKNOWN,
        `Constraint '${constraint.name}' references unknown field '${fieldName}' on object '${object.name}'.`,
        fieldPath,
      ),
    );
  }

  return field;
}

function validateField(
  field: ResolvedField,
  fieldIndex: number,
  object: ResolvedObject,
  objectPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const fieldPath = `${objectPath}.fields[${fieldIndex}]`;
  const fieldNames = new Set(object.fields.map((candidate) => candidate.name));

  if (field.defaultValue !== undefined && !isDefaultCompatible(field, field.defaultValue)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.FIELD_DEFAULT_INCOMPATIBLE,
        `Default value for field '${field.name}' is not compatible with ${field.type} field requirements.`,
        `${fieldPath}.defaultValue`,
      ),
    );
  }

  if (field.autoId !== undefined) {
    if (field.type !== "text") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.AUTO_ID_NON_TEXT,
          `Auto ID field '${field.name}' on object '${object.name}' must be a text field.`,
          `${fieldPath}.autoId`,
        ),
      );
    }

    if (field.autoId.scopeField !== undefined && !fieldNames.has(field.autoId.scopeField)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.AUTO_ID_SCOPE_FIELD_UNKNOWN,
          `Auto ID scope field '${field.autoId.scopeField}' does not exist on object '${object.name}'.`,
          `${fieldPath}.autoId.scopeField`,
        ),
      );
    }
  }

  if (field.lookup !== undefined) {
    const target = indexes.objectsByName.get(field.lookup.targetObject);

    if (target === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.LOOKUP_TARGET_OBJECT_UNKNOWN,
          `Lookup target object '${field.lookup.targetObject}' does not exist.`,
          `${fieldPath}.lookup.targetObject`,
        ),
      );
      return;
    }

    const targetFieldNames = new Set(target.item.fields.map((candidate) => candidate.name));
    if (field.lookup.targetField !== undefined && !targetFieldNames.has(field.lookup.targetField)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.LOOKUP_TARGET_FIELD_UNKNOWN,
          `Lookup target field '${field.lookup.targetField}' does not exist on object '${target.item.name}'.`,
          `${fieldPath}.lookup.targetField`,
        ),
      );
    }

    if (!targetFieldNames.has(field.lookup.displayField)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.LOOKUP_DISPLAY_FIELD_UNKNOWN,
          `Lookup display field '${field.lookup.displayField}' does not exist on object '${target.item.name}'.`,
          `${fieldPath}.lookup.displayField`,
        ),
      );
    }
  }
}

function validateLifecycle(
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

function validateObjectPolicyReferences(
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

function validateObjectSyncPolicy(
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
      days: MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_DAYS_INVALID,
      limit: MODEL_VALIDATION_CODES.OBJECT_SYNC_WINDOW_LIMIT_INVALID,
    });
  }
}

function validatePolicy(
  policy: ResolvedPolicy,
  policyIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const policyPath = `policies[${policyIndex}]`;
  const object = indexes.objectsByName.get(policy.object)?.item;

  if (policy.defaultEffect !== "deny") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_DEFAULT_EFFECT_INVALID,
        `Policy '${policy.name}' has invalid default effect '${String(policy.defaultEffect)}'.`,
        `${policyPath}.defaultEffect`,
      ),
    );
  }

  if (object === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_OBJECT_UNKNOWN,
        `Policy '${policy.name}' references unknown object '${policy.object}'.`,
        `${policyPath}.object`,
      ),
    );
    return;
  }

  const fieldsByName = indexByName(object.fields);
  const statesByName =
    object.lifecycle === undefined
      ? new Map<string, NamedReference<unknown>>()
      : indexByName(object.lifecycle.states);
  const actionsByName =
    object.lifecycle === undefined
      ? new Map<string, NamedReference<unknown>>()
      : indexByName(object.lifecycle.actions);

  for (let ruleIndex = 0; ruleIndex < policy.rules.length; ruleIndex += 1) {
    const rule = policy.rules[ruleIndex];
    if (rule === undefined) {
      continue;
    }
    validatePolicyRule(
      rule,
      `${policyPath}.rules[${ruleIndex}]`,
      object,
      fieldsByName,
      statesByName,
      actionsByName,
      diagnostics,
    );
  }
}

function validatePolicyRule(
  rule: ResolvedPolicyRule,
  rulePath: string,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  statesByName: Map<string, NamedReference<unknown>>,
  actionsByName: Map<string, NamedReference<unknown>>,
  diagnostics: Diagnostic[],
): void {
  if (!POLICY_ACTIONS.has(rule.action)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_ACTION_INVALID,
        `Policy rule '${rule.name}' has invalid action '${String(rule.action)}'.`,
        `${rulePath}.action`,
      ),
    );
  }

  for (let fieldIndex = 0; fieldIndex < rule.fields.length; fieldIndex += 1) {
    const field = rule.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    if (!fieldsByName.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_FIELD_UNKNOWN,
          `Policy rule '${rule.name}' references unknown field '${field}' on object '${object.name}'.`,
          `${rulePath}.fields[${fieldIndex}]`,
        ),
      );
    }
  }

  for (let stateIndex = 0; stateIndex < rule.state.length; stateIndex += 1) {
    const state = rule.state[stateIndex];
    if (state === undefined) {
      continue;
    }
    if (!statesByName.has(state)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_STATE_UNKNOWN,
          `Policy rule '${rule.name}' references unknown lifecycle state '${state}' on object '${object.name}'.`,
          `${rulePath}.state[${stateIndex}]`,
        ),
      );
    }
  }

  if (rule.lifecycleAction !== undefined && !actionsByName.has(rule.lifecycleAction)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_LIFECYCLE_ACTION_UNKNOWN,
        `Policy rule '${rule.name}' references unknown lifecycle action '${rule.lifecycleAction}' on object '${object.name}'.`,
        `${rulePath}.lifecycleAction`,
      ),
    );
  }

  if (rule.condition !== undefined) {
    validatePolicyCondition(
      rule.condition,
      `${rulePath}.condition`,
      fieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.POLICY_CONDITION_INVALID,
        field: MODEL_VALIDATION_CODES.POLICY_CONDITION_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.POLICY_CONDITION_RUNTIME_PROPERTY_INVALID,
      },
      diagnostics,
    );
  }

  for (let channelIndex = 0; channelIndex < rule.channels.length; channelIndex += 1) {
    const channel = rule.channels[channelIndex];
    if (channel === undefined) {
      continue;
    }
    if (!RUNTIME_CHANNELS.has(channel)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_CHANNEL_INVALID,
          `Policy rule '${rule.name}' has invalid runtime channel '${String(channel)}'.`,
          `${rulePath}.channels[${channelIndex}]`,
        ),
      );
    }
  }
}

function validatePolicyCondition(
  condition: ResolvedPolicyCondition,
  conditionPath: string,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  codes: {
    invalid: ModelValidationCode;
    field: ModelValidationCode;
    runtime: ModelValidationCode;
  },
  diagnostics: Diagnostic[],
): void {
  switch (condition.kind) {
    case "equals":
      validatePolicyConditionOperand(
        condition.left,
        `${conditionPath}.left`,
        fieldsByName,
        codes,
        diagnostics,
      );
      validatePolicyConditionOperand(
        condition.right,
        `${conditionPath}.right`,
        fieldsByName,
        codes,
        diagnostics,
      );
      return;
    case "all":
    case "any":
      if (condition.conditions.length === 0) {
        diagnostics.push(
          diagnostic(
            codes.invalid,
            `Policy condition '${condition.kind}' must contain at least one nested condition.`,
            `${conditionPath}.conditions`,
          ),
        );
      }

      for (
        let conditionIndex = 0;
        conditionIndex < condition.conditions.length;
        conditionIndex += 1
      ) {
        const nested = condition.conditions[conditionIndex];
        if (nested === undefined) {
          continue;
        }
        validatePolicyCondition(
          nested,
          `${conditionPath}.conditions[${conditionIndex}]`,
          fieldsByName,
          codes,
          diagnostics,
        );
      }
      return;
    case "not":
      validatePolicyCondition(
        condition.condition,
        `${conditionPath}.condition`,
        fieldsByName,
        codes,
        diagnostics,
      );
      return;
  }

  diagnostics.push(
    diagnostic(
      codes.invalid,
      `Policy condition has invalid kind '${String((condition as { kind?: unknown }).kind)}'.`,
      `${conditionPath}.kind`,
    ),
  );
}

function validatePolicyConditionOperand(
  operand: ResolvedPolicyConditionOperand,
  operandPath: string,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  codes: {
    invalid: ModelValidationCode;
    field: ModelValidationCode;
    runtime: ModelValidationCode;
  },
  diagnostics: Diagnostic[],
): void {
  switch (operand.kind) {
    case "field":
      if (!fieldsByName.has(operand.field)) {
        diagnostics.push(
          diagnostic(
            codes.field,
            `Policy condition references unknown field '${operand.field}'.`,
            `${operandPath}.field`,
          ),
        );
      }
      return;
    case "runtime":
      if (!POLICY_CONDITION_RUNTIME_PROPERTIES.has(operand.property)) {
        diagnostics.push(
          diagnostic(
            codes.runtime,
            `Policy condition references unsupported runtime property '${String(operand.property)}'.`,
            `${operandPath}.property`,
          ),
        );
      }
      return;
    case "literal":
      return;
  }

  diagnostics.push(
    diagnostic(
      codes.invalid,
      `Policy condition operand has invalid kind '${String((operand as { kind?: unknown }).kind)}'.`,
      `${operandPath}.kind`,
    ),
  );
}

function validateView(
  view: ResolvedView,
  viewPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const targetObject = indexes.objectsByName.get(view.object)?.item;

  if (!VIEW_KINDS.has(view.kind)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_KIND_INVALID,
        `View has invalid kind '${String(view.kind)}'.`,
        `${viewPath}.kind`,
      ),
    );
  }

  validateViewContext(view.context, `${viewPath}.context`, indexes, diagnostics);

  if (targetObject === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_OBJECT_UNKNOWN,
        `View references unknown object '${view.object}'.`,
        `${viewPath}.object`,
      ),
    );
    return;
  }

  const readModel =
    view.readModel === undefined ? undefined : indexes.readModelsByName.get(view.readModel)?.item;
  if (view.readModel !== undefined && readModel === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_READ_MODEL_UNKNOWN,
        `View '${view.name}' references unknown read model '${view.readModel}'.`,
        `${viewPath}.readModel`,
      ),
    );
  }

  const fieldNames =
    readModel === undefined
      ? new Set(targetObject.fields.map((field) => field.name))
      : new Set(readModel.fields.map((field) => field.name));
  const fieldOwner =
    readModel === undefined ? `object '${targetObject.name}'` : `read model '${readModel.name}'`;

  for (let fieldIndex = 0; fieldIndex < view.fields.length; fieldIndex += 1) {
    const field = view.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    if (!fieldNames.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_FIELD_UNKNOWN,
          `View references unknown field '${field}' on ${fieldOwner}.`,
          `${viewPath}.fields[${fieldIndex}]`,
        ),
      );
    }
  }

  for (let fieldIndex = 0; fieldIndex < view.searchFields.length; fieldIndex += 1) {
    const field = view.searchFields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    if (!fieldNames.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_SEARCH_FIELD_UNKNOWN,
          `View references unknown search field '${field}' on ${fieldOwner}.`,
          `${viewPath}.searchFields[${fieldIndex}]`,
        ),
      );
    }
  }

  for (let sortIndex = 0; sortIndex < view.sort.length; sortIndex += 1) {
    const sortItem = view.sort[sortIndex];
    if (sortItem === undefined) {
      continue;
    }
    if (!fieldNames.has(sortItem.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.VIEW_SORT_FIELD_UNKNOWN,
          `View references unknown sort field '${sortItem.field}' on ${fieldOwner}.`,
          `${viewPath}.sort[${sortIndex}].field`,
        ),
      );
    }
  }
}

function validateViewContext(
  context: ResolvedViewContext | undefined,
  contextPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (context === undefined) {
    return;
  }

  if (!VIEW_CONTEXT_MODES.has(context.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_CONTEXT_MODE_INVALID,
        `View has invalid context mode '${String(context.mode)}'.`,
        `${contextPath}.mode`,
      ),
    );
  }

  if (context.mode !== "none" && context.context === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_CONTEXT_REQUIRED,
        `View context mode '${String(context.mode)}' must reference a business context.`,
        `${contextPath}.context`,
      ),
    );
    return;
  }

  if (context.context !== undefined && !indexes.contextsByName.has(context.context)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.VIEW_CONTEXT_UNKNOWN,
        `View references unknown context '${context.context}'.`,
        `${contextPath}.context`,
      ),
    );
  }
}

function validateReadModel(
  readModel: ResolvedReadModel,
  readModelIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const readModelPath = `readModels[${readModelIndex}]`;
  const sourcesByName = indexByName(readModel.sources);

  validateReadModelContext(readModel.context, `${readModelPath}.context`, indexes, diagnostics);
  reportDuplicateNames(
    readModel.sources,
    `${readModelPath}.sources`,
    MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_DUPLICATE,
    diagnostics,
    `Source names must be unique within read model '${readModel.name}'.`,
  );
  reportDuplicateNames(
    readModel.fields,
    `${readModelPath}.fields`,
    MODEL_VALIDATION_CODES.READ_MODEL_FIELD_DUPLICATE,
    diagnostics,
    `Output field names must be unique within read model '${readModel.name}'.`,
  );

  for (let sourceIndex = 0; sourceIndex < readModel.sources.length; sourceIndex += 1) {
    const source = readModel.sources[sourceIndex];
    if (source === undefined) {
      continue;
    }

    if (!READ_MODEL_SOURCE_SCOPES.has(source.scope)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_SCOPE_INVALID,
          `Read model '${readModel.name}' source '${source.name}' has invalid scope '${String(source.scope)}'.`,
          `${readModelPath}.sources[${sourceIndex}].scope`,
        ),
      );
    }

    if (!indexes.objectsByName.has(source.object)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_SOURCE_OBJECT_UNKNOWN,
          `Read model '${readModel.name}' source '${source.name}' references unknown object '${source.object}'.`,
          `${readModelPath}.sources[${sourceIndex}].object`,
        ),
      );
    }
  }

  const fieldNames = new Set(readModel.fields.map((field) => field.name));
  for (let sortIndex = 0; sortIndex < readModel.sort.length; sortIndex += 1) {
    const sortItem = readModel.sort[sortIndex];
    if (sortItem === undefined) {
      continue;
    }
    if (!fieldNames.has(sortItem.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_SORT_FIELD_UNKNOWN,
          `Read model '${readModel.name}' sorts by unknown output field '${sortItem.field}'.`,
          `${readModelPath}.sort[${sortIndex}].field`,
        ),
      );
    }
  }

  for (let fieldIndex = 0; fieldIndex < readModel.fields.length; fieldIndex += 1) {
    const field = readModel.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    const fieldPath = `${readModelPath}.fields[${fieldIndex}]`;

    if (field.type !== undefined && !FIELD_TYPES.has(field.type)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_TYPE_INVALID,
          `Read model '${readModel.name}' output field '${field.name}' has invalid type '${String(field.type)}'.`,
          `${fieldPath}.type`,
        ),
      );
    }

    if (field.field !== undefined && field.source === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_SOURCE_UNKNOWN,
          `Read model '${readModel.name}' output field '${field.name}' must name a source before referencing field '${field.field}'.`,
          `${fieldPath}.source`,
        ),
      );
      continue;
    }

    if (field.source === undefined) {
      continue;
    }

    const source = sourcesByName.get(field.source)?.item;
    if (source === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_SOURCE_UNKNOWN,
          `Read model '${readModel.name}' output field '${field.name}' references unknown source '${field.source}'.`,
          `${fieldPath}.source`,
        ),
      );
      continue;
    }

    const sourceObject = indexes.objectsByName.get(source.object)?.item;
    if (sourceObject === undefined || field.field === undefined) {
      continue;
    }

    const sourceFieldNames = new Set(sourceObject.fields.map((candidate) => candidate.name));
    if (!sourceFieldNames.has(field.field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.READ_MODEL_FIELD_UNKNOWN,
          `Read model '${readModel.name}' output field '${field.name}' references unknown field '${field.field}' on source '${source.name}'.`,
          `${fieldPath}.field`,
        ),
      );
    }
  }
}

function validateCommand(
  command: ResolvedCommand,
  commandIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const commandPath = `commands[${commandIndex}]`;
  const inputsByName = indexByName(command.inputs);
  const previousStepsByName = new Map<string, ResolvedCommandStep>();

  reportDuplicateNames(
    command.inputs,
    `${commandPath}.inputs`,
    MODEL_VALIDATION_CODES.COMMAND_INPUT_DUPLICATE,
    diagnostics,
    `Input names must be unique within command '${command.name}'.`,
  );
  reportDuplicateNames(
    command.steps,
    `${commandPath}.steps`,
    MODEL_VALIDATION_CODES.COMMAND_STEP_DUPLICATE,
    diagnostics,
    `Step names must be unique within command '${command.name}'.`,
  );

  for (let inputIndex = 0; inputIndex < command.inputs.length; inputIndex += 1) {
    const input = command.inputs[inputIndex];
    if (input === undefined) {
      continue;
    }
    validateCommandInput(input, `${commandPath}.inputs[${inputIndex}]`, command, diagnostics);
  }

  for (let stepIndex = 0; stepIndex < command.steps.length; stepIndex += 1) {
    const step = command.steps[stepIndex];
    if (step === undefined) {
      continue;
    }
    validateCommandStep(
      step,
      `${commandPath}.steps[${stepIndex}]`,
      command,
      inputsByName,
      previousStepsByName,
      indexes,
      diagnostics,
    );
    previousStepsByName.set(step.name, step);
  }
}

function validateCommandInput(
  input: ResolvedCommandInput,
  inputPath: string,
  command: ResolvedCommand,
  diagnostics: Diagnostic[],
): void {
  if (!FIELD_TYPES.has(input.type)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_INPUT_TYPE_INVALID,
        `Command '${command.name}' input '${input.name}' has invalid type '${String(input.type)}'.`,
        `${inputPath}.type`,
      ),
    );
  }

  if (
    input.defaultValue !== undefined &&
    !isValueCompatibleWithFieldType(input.type, input.defaultValue)
  ) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_INPUT_DEFAULT_INCOMPATIBLE,
        `Default value for command '${command.name}' input '${input.name}' is not compatible with ${input.type}.`,
        `${inputPath}.defaultValue`,
      ),
    );
  }
}

function validateCommandStep(
  step: ResolvedCommandStep,
  stepPath: string,
  command: ResolvedCommand,
  inputsByName: Map<string, NamedReference<ResolvedCommandInput>>,
  previousStepsByName: Map<string, ResolvedCommandStep>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const rawStep = step as { name?: string; action?: unknown };
  if (step.action !== "create" && step.action !== "update") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_STEP_ACTION_INVALID,
        `Command '${command.name}' step '${rawStep.name ?? "<unnamed>"}' has invalid action '${String(rawStep.action)}'.`,
        `${stepPath}.action`,
      ),
    );
    return;
  }

  if (!COMMAND_STEP_AUTHORITIES.has(step.authority)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_AUTHORITY_INVALID,
        `Command '${command.name}' step '${step.name}' has invalid authority '${String(step.authority)}'.`,
        `${stepPath}.authority`,
      ),
    );
  }

  const object = indexes.objectsByName.get(step.object)?.item;
  if (object === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_STEP_OBJECT_UNKNOWN,
        `Command '${command.name}' step '${step.name}' references unknown object '${step.object}'.`,
        `${stepPath}.object`,
      ),
    );
    return;
  }

  const fieldsByName = indexByName(object.fields);
  const values = step.action === "create" ? step.values : step.patch;
  const valuesProperty = step.action === "create" ? "values" : "patch";

  for (const [fieldName, expression] of Object.entries(values)) {
    if (!fieldsByName.has(fieldName)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.COMMAND_STEP_FIELD_UNKNOWN,
          `Command '${command.name}' step '${step.name}' references unknown field '${fieldName}' on object '${object.name}'.`,
          `${stepPath}.${valuesProperty}.${fieldName}`,
        ),
      );
    }

    validateCommandValueExpression(
      expression,
      `${stepPath}.${valuesProperty}.${fieldName}`,
      command,
      inputsByName,
      previousStepsByName,
      indexes,
      diagnostics,
    );
  }

  if (step.action === "update") {
    validateCommandValueExpression(
      step.recordId,
      `${stepPath}.recordId`,
      command,
      inputsByName,
      previousStepsByName,
      indexes,
      diagnostics,
    );
  }

  for (
    let preconditionIndex = 0;
    preconditionIndex < step.preconditions.length;
    preconditionIndex += 1
  ) {
    const precondition = step.preconditions[preconditionIndex];
    if (precondition === undefined) {
      continue;
    }
    validatePolicyCondition(
      precondition,
      `${stepPath}.preconditions[${preconditionIndex}]`,
      fieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
        field: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_RUNTIME_PROPERTY_INVALID,
      },
      diagnostics,
    );
  }
}

function validateCommandValueExpression(
  expression: ResolvedCommandValueExpression,
  expressionPath: string,
  command: ResolvedCommand,
  inputsByName: Map<string, NamedReference<ResolvedCommandInput>>,
  previousStepsByName: Map<string, ResolvedCommandStep>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  switch (expression.kind) {
    case "literal":
      return;
    case "input":
      if (!inputsByName.has(expression.name)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_INPUT_UNKNOWN,
            `Command '${command.name}' expression references unknown input '${expression.name}'.`,
            `${expressionPath}.name`,
          ),
        );
      }
      return;
    case "runtime":
      if (!COMMAND_RUNTIME_PROPERTIES.has(expression.property)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_RUNTIME_PROPERTY_INVALID,
            `Command '${command.name}' expression references unsupported runtime property '${String(expression.property)}'.`,
            `${expressionPath}.property`,
          ),
        );
      }
      return;
    case "stepField": {
      const step = previousStepsByName.get(expression.step);
      if (step === undefined) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_REFERENCE_UNKNOWN,
            `Command '${command.name}' expression references unknown or later step '${expression.step}'.`,
            `${expressionPath}.step`,
          ),
        );
        return;
      }

      const object = indexes.objectsByName.get(step.object)?.item;
      if (object !== undefined && !object.fields.some((field) => field.name === expression.field)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_FIELD_UNKNOWN,
            `Command '${command.name}' expression references unknown field '${expression.field}' on step '${expression.step}'.`,
            `${expressionPath}.field`,
          ),
        );
      }
      return;
    }
    case "stepMeta":
      if (!previousStepsByName.has(expression.step)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_REFERENCE_UNKNOWN,
            `Command '${command.name}' expression references unknown or later step '${expression.step}'.`,
            `${expressionPath}.step`,
          ),
        );
      }
      if (!COMMAND_STEP_META_PROPERTIES.has(expression.property)) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_META_PROPERTY_INVALID,
            `Command '${command.name}' expression references unsupported step metadata property '${String(expression.property)}'.`,
            `${expressionPath}.property`,
          ),
        );
      }
      return;
  }

  diagnostics.push(
    diagnostic(
      MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
      `Command '${command.name}' expression has invalid kind '${String((expression as { kind?: unknown }).kind)}'.`,
      `${expressionPath}.kind`,
    ),
  );
}

function validateReadModelContext(
  context: ResolvedViewContext | undefined,
  contextPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (context === undefined) {
    return;
  }

  if (!VIEW_CONTEXT_MODES.has(context.mode)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_CONTEXT_MODE_INVALID,
        `Read model has invalid context mode '${String(context.mode)}'.`,
        `${contextPath}.mode`,
      ),
    );
  }

  if (context.mode !== "none" && context.context === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_CONTEXT_REQUIRED,
        `Read model context mode '${String(context.mode)}' must reference a business context.`,
        `${contextPath}.context`,
      ),
    );
    return;
  }

  if (context.context !== undefined && !indexes.contextsByName.has(context.context)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.READ_MODEL_CONTEXT_UNKNOWN,
        `Read model references unknown context '${context.context}'.`,
        `${contextPath}.context`,
      ),
    );
  }
}

function validateTheme(
  theme: ResolvedTheme,
  themeIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const themePath = `themes[${themeIndex}]`;

  if (theme.base !== undefined) {
    if (theme.base === theme.name) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.THEME_BASE_SELF_REFERENCE,
          `Theme '${theme.name}' cannot use itself as its base theme.`,
          `${themePath}.base`,
        ),
      );
    } else if (!indexes.themesByName.has(theme.base)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.THEME_BASE_UNKNOWN,
          `Theme '${theme.name}' references unknown base theme '${theme.base}'.`,
          `${themePath}.base`,
        ),
      );
    }
  }

  const baseCycle = findThemeBaseCycle(theme, indexes);
  if (baseCycle !== undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_BASE_CYCLE,
        `Theme '${theme.name}' has a base theme cycle: ${baseCycle.join(" -> ")}.`,
        `${themePath}.base`,
      ),
    );
  }

  for (const tokenName of THEME_STRING_TOKENS) {
    const token = theme.tokens[tokenName];
    if (token !== undefined && (typeof token !== "string" || token.trim().length === 0)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
          `Theme '${theme.name}' has invalid ${tokenName} token '${String(token)}'.`,
          `${themePath}.tokens.${tokenName}`,
        ),
      );
    }
  }

  if (!THEME_RADIUS_VALUES.has(theme.tokens.radius)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
        `Theme '${theme.name}' has invalid radius token '${String(theme.tokens.radius)}'.`,
        `${themePath}.tokens.radius`,
      ),
    );
  }

  if (!THEME_DENSITY_VALUES.has(theme.tokens.density)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
        `Theme '${theme.name}' has invalid density token '${String(theme.tokens.density)}'.`,
        `${themePath}.tokens.density`,
      ),
    );
  }

  if (!THEME_NAV_VALUES.has(theme.tokens.nav)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.THEME_TOKEN_INVALID,
        `Theme '${theme.name}' has invalid navigation token '${String(theme.tokens.nav)}'.`,
        `${themePath}.tokens.nav`,
      ),
    );
  }
}

function findThemeBaseCycle(theme: ResolvedTheme, indexes: ModelIndexes): string[] | undefined {
  const seen = new Set<string>([theme.name]);
  const path = [theme.name];
  let current: ResolvedTheme | undefined = theme;

  while (current?.base !== undefined) {
    path.push(current.base);
    if (seen.has(current.base)) {
      return path;
    }

    seen.add(current.base);
    current = indexes.themesByName.get(current.base)?.item;
  }

  return undefined;
}

function validateSyncPolicy(
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
  if (sync.window !== undefined && object !== undefined) {
    validateSyncWindow(sync.window, object, `${syncPath}.window`, diagnostics, {
      field: MODEL_VALIDATION_CODES.SYNC_WINDOW_FIELD_UNKNOWN,
      days: MODEL_VALIDATION_CODES.SYNC_WINDOW_DAYS_INVALID,
      limit: MODEL_VALIDATION_CODES.SYNC_WINDOW_LIMIT_INVALID,
    });
  }
}

function validateSyncWindow(
  window: ResolvedSyncWindow,
  object: ResolvedObject,
  windowPath: string,
  diagnostics: Diagnostic[],
  codes: {
    field: ModelValidationCode;
    days: ModelValidationCode;
    limit: ModelValidationCode;
  },
): void {
  const knownFields = new Set([
    ...object.fields.map((field) => field.name),
    ...object.metadataFields.map((field) => field.name),
  ]);

  if (!knownFields.has(window.field)) {
    diagnostics.push(
      diagnostic(
        codes.field,
        `Sync window field '${window.field}' does not exist on object '${object.name}'.`,
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

function reportDuplicateNames(
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

function indexByName<T extends { name: string }>(items: T[]): Map<string, NamedReference<T>> {
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

function isDefaultCompatible(field: ResolvedField, value: unknown): boolean {
  if (!FIELD_TYPES.has(field.type)) {
    return false;
  }

  if (value === null) {
    return !field.required;
  }

  return isValueCompatibleWithFieldType(field.type, value);
}

function isValueCompatibleWithFieldType(type: FieldType, value: unknown): boolean {
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

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function diagnostic(code: ModelValidationCode, message: string, path?: string): Diagnostic {
  return {
    severity: "error",
    code,
    message,
    ...(path === undefined ? {} : { path }),
  };
}
