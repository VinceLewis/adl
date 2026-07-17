export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type FieldType = "text" | "number" | "date" | "datetime" | "time" | "boolean" | "attachment";
export type ExpressionValueType = Exclude<FieldType, "attachment"> | "null";
export type ExpressionRuntimeProperty = "userId" | "now";
export type ExpressionUnaryOperator = "not" | "negate";
export type ExpressionBinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "in"
  | "??";

export type ValidatorKind =
  | "email"
  | "min"
  | "max"
  | "minLength"
  | "maxLength"
  | "in"
  | "regexp"
  | "currencyCode"
  | "maxSize"
  | "mimeType"
  | "predicate";

export type ViewKind =
  | "list"
  | "detail"
  | "form"
  | "dashboard"
  | "masterDetail"
  | "grid"
  | "composite";

export type PolicyEffect = "allow" | "deny" | "readonly" | "mask" | "hidden";
export type PolicyAction =
  | "*"
  | "create"
  | "read"
  | "update"
  | "delete"
  | "search"
  | "transition"
  | "export"
  | "import";

export type PrincipalMatch = "everyone" | "authenticated" | "anonymous" | "owner" | "specific";

export type RuntimeChannel = "ui" | "api" | "sync" | "import" | "test";
export type SyncMode = "localFirst" | "cacheReadonly" | "onlineRequired" | "localPrivate";
export type SyncScope =
  | "all"
  | "currentUser"
  | "assignedToUser"
  | "ownedByUser"
  | "currentContext"
  | "allAvailableContexts"
  | "recent"
  | "custom";
export type ConflictStrategy = "serverWins" | "clientWins" | "stateTransitionWins" | "manual";
export type SyncStatus = "local" | "pending" | "synced" | "conflict" | "rejected";
export type LocalOperationKind = "create" | "update" | "delete" | "transition";
export type LocalOperationStatus = "pending" | "sent" | "accepted" | "rejected" | "conflict";
export type AuditOperation = LocalOperationKind | "read" | "search";
export type ThemeRadius = "none" | "small" | "medium" | "large";
export type ThemeDensity = "compact" | "comfortable" | "spacious";
export type ThemeNav = "top" | "side" | "bottom";
export type ContextSelectionMode = "required" | "optional";
export type ContextSelectionPersistence = "none" | "session" | "local";
export type ContextSelectionSource = "runtime" | "route";
export type ViewContextMode = "none" | "required" | "optional" | "all";
export type ReadModelSourceScope =
  | "all"
  | "currentContext"
  | "allAvailableContexts"
  | "currentUser";
export type ObjectConstraintKind = "unique" | "ordered";
export type PolicyConditionKind = "equals" | "all" | "any" | "not";
export type PolicyConditionRuntimeProperty = "userId";
export type DecisionTableMatchPolicy = "first" | "single";
export type CommandStepAction = "create" | "update";
export type CommandStepAuthority = "caller" | "command";
export type CommandRuntimeProperty = "userId" | "nowIso" | "today";
export type CommandStepMetaProperty = "guid" | "createdAt" | "updatedAt";

export interface ResolvedApplicationModel {
  modelVersion: string;
  generatedAt?: string;
  app: ResolvedApp;
  roles: ResolvedRole[];
  contexts?: ResolvedBusinessContext[];
  objects: ResolvedObject[];
  readModels?: ResolvedReadModel[];
  decisionTables?: ResolvedDecisionTable[];
  commands?: ResolvedCommand[];
  policies: ResolvedPolicy[];
  themes: ResolvedTheme[];
  sync: ResolvedSyncPolicy[];
  audit: ResolvedAuditModel;
  operationLog: ResolvedOperationLogModel;
  defaults: ResolvedModelDefaults;
}

export interface ResolvedModelDefaults {
  systemIdField: string;
  objectSchemaVersion: number;
  metadataFields: string[];
  syncMode: SyncMode;
  policyEffect: "deny";
  theme: string;
  tableNaming: "snakeCaseObjectName";
  fieldStorageNaming: "snakeCaseFieldName";
}

export interface ResolvedApp {
  name: string;
  startView: string;
  theme: string;
}

export interface ResolvedRole {
  name: string;
  description?: string;
  inherits: string[];
}

export interface ResolvedBusinessContext {
  name: string;
  object: string;
  selection: ResolvedContextSelectionPolicy;
  membership?: ResolvedContextMembership;
}

export interface ResolvedContextSelectionPolicy {
  mode: ContextSelectionMode;
  autoSelect: boolean;
  persistence: ContextSelectionPersistence;
  source: ContextSelectionSource;
  routeParam?: string;
}

export interface ResolvedContextMembership {
  object: string;
  userField: string;
  contextField: string;
  roleField: string;
  roles: string[];
}

export interface ResolvedObject {
  name: string;
  schemaVersion: number;
  tableName: string;
  systemIdField: string;
  businessKey?: string;
  displayField?: string;
  fields: ResolvedField[];
  computedFields: ResolvedComputedField[];
  metadataFields: ResolvedMetadataField[];
  scope?: ResolvedObjectScope;
  constraints: ResolvedObjectConstraint[];
  validations: ResolvedObjectValidation[];
  lifecycle?: ResolvedLifecycle;
  policies: string[];
  views: ResolvedView[];
  sync: ResolvedObjectSyncPolicy;
  audit: ResolvedObjectAuditPolicy;
}

export interface ResolvedObjectScope {
  context: string;
  field: string;
}

export interface ResolvedField {
  name: string;
  storageName: string;
  type: FieldType;
  required: boolean;
  defaultValue?: JsonValue;
  validators: ResolvedValidator[];
  readonly: boolean;
  hidden: boolean;
  lookup?: ResolvedLookup;
  autoId?: ResolvedAutoId;
  systemManaged: boolean;
}

export type ComputedFieldStrategy = "readTime";

export interface ResolvedComputedField {
  name: string;
  storageName: string;
  type: FieldType;
  expression: ResolvedExpression;
  strategy: ComputedFieldStrategy;
  dependencies: string[];
  evaluationOrder: number;
  readonly: true;
  hidden: false;
  systemManaged: true;
}

export interface ResolvedMetadataField {
  name: string;
  storageName: string;
  type: FieldType;
  required: boolean;
  readonly: true;
  hidden: true;
  systemManaged: true;
  description: string;
}

export type ResolvedValidator = ResolvedNamedValidator | ResolvedPredicateValidator;

export type ResolvedNamedValidatorKind = Exclude<ValidatorKind, "predicate">;

export interface ResolvedNamedValidator {
  kind: ResolvedNamedValidatorKind;
  value?: JsonValue;
}

export interface ResolvedPredicateValidator {
  kind: "predicate";
  expression: ResolvedExpression;
  message?: string;
}

export type ResolvedExpression =
  | ResolvedLiteralExpression
  | ResolvedFieldExpression
  | ResolvedRuntimeExpression
  | ResolvedUnaryExpression
  | ResolvedBinaryExpression;

export interface ResolvedLiteralExpression {
  kind: "literal";
  value: JsonPrimitive;
  valueType?: ExpressionValueType;
}

export interface ResolvedFieldExpression {
  kind: "field";
  field: string;
}

export interface ResolvedRuntimeExpression {
  kind: "runtime";
  property: ExpressionRuntimeProperty;
}

export interface ResolvedUnaryExpression {
  kind: "unary";
  operator: ExpressionUnaryOperator;
  operand: ResolvedExpression;
}

export interface ResolvedBinaryExpression {
  kind: "binary";
  operator: ExpressionBinaryOperator;
  left: ResolvedExpression;
  right: ResolvedExpression;
}

export interface ResolvedLookup {
  targetObject: string;
  targetField?: string;
  displayField: string;
}

export interface ResolvedAutoId {
  prefix?: string;
  pad?: number;
  scopeField?: string;
}

export type ResolvedObjectConstraint =
  | ResolvedUniqueObjectConstraint
  | ResolvedOrderedObjectConstraint;

export interface ResolvedUniqueObjectConstraint {
  name: string;
  kind: "unique";
  fields: string[];
  scopeFields: string[];
}

export interface ResolvedOrderedObjectConstraint {
  name: string;
  kind: "ordered";
  parentField: string;
  positionField: string;
  scopeFields: string[];
  minPosition: number;
}

export interface ResolvedObjectValidation {
  name: string;
  expression: ResolvedExpression;
  message: string;
}

export interface ResolvedLifecycle {
  name: string;
  stateField: string;
  initialState?: string;
  states: ResolvedState[];
  actions: ResolvedLifecycleAction[];
}

export interface ResolvedState {
  name: string;
  terminal: boolean;
}

export interface ResolvedLifecycleAction {
  name: string;
  from: string[];
  to: string;
  label?: string;
  guards: ResolvedLifecycleGuard[];
  policyRefs: string[];
  hooks: ResolvedHookRefs;
}

export interface ResolvedLifecycleGuard {
  name: string;
  expression: ResolvedExpression;
  message: string;
}

export interface ResolvedHookRefs {
  before: string[];
  after: string[];
  onError: string[];
}

export interface ResolvedPolicy {
  name: string;
  object: string;
  defaultEffect: "deny";
  rules: ResolvedPolicyRule[];
}

export interface ResolvedPolicyRule {
  name: string;
  effect: PolicyEffect;
  principal: ResolvedPrincipalSelector;
  action: PolicyAction;
  state: string[];
  fields: string[];
  lifecycleAction?: string;
  condition?: ResolvedExpression;
  channels: RuntimeChannel[];
}

export type ResolvedPolicyCondition =
  | ResolvedEqualsPolicyCondition
  | ResolvedAllPolicyCondition
  | ResolvedAnyPolicyCondition
  | ResolvedNotPolicyCondition;

export interface ResolvedEqualsPolicyCondition {
  kind: "equals";
  left: ResolvedPolicyConditionOperand;
  right: ResolvedPolicyConditionOperand;
}

export interface ResolvedAllPolicyCondition {
  kind: "all";
  conditions: (ResolvedPolicyCondition | ResolvedExpression)[];
}

export interface ResolvedAnyPolicyCondition {
  kind: "any";
  conditions: (ResolvedPolicyCondition | ResolvedExpression)[];
}

export interface ResolvedNotPolicyCondition {
  kind: "not";
  condition: ResolvedPolicyCondition;
}

export type ResolvedPolicyConditionOperand =
  | { kind: "field"; field: string }
  | { kind: "runtime"; property: PolicyConditionRuntimeProperty }
  | { kind: "literal"; value: JsonValue };

export interface ResolvedPrincipalSelector {
  match: PrincipalMatch;
  roles: string[];
  groupRoles: string[];
  users: string[];
  owner: boolean;
}

export interface ResolvedView {
  name: string;
  object: string;
  kind: ViewKind;
  context?: ResolvedViewContext;
  readModel?: string;
  fields: string[];
  searchFields: string[];
  sort: ResolvedSort[];
  actions: string[];
}

export interface ResolvedViewContext {
  mode: ViewContextMode;
  context?: string;
}

export interface ResolvedSort {
  field: string;
  direction: "asc" | "desc";
}

export interface ResolvedReadModel {
  name: string;
  context?: ResolvedViewContext;
  sources: ResolvedReadModelSource[];
  fields: ResolvedReadModelField[];
  sort: ResolvedSort[];
}

export interface ResolvedReadModelSource {
  name: string;
  object: string;
  scope: ReadModelSourceScope;
}

export interface ResolvedReadModelField {
  name: string;
  type?: FieldType;
  source?: string;
  field?: string;
  expression?: ResolvedExpression;
}

export interface ResolvedDecisionTable {
  name: string;
  object: string;
  match: DecisionTableMatchPolicy;
  inputs: ResolvedDecisionTableInput[];
  rows: ResolvedDecisionTableRow[];
  defaultOutputs?: Record<string, JsonValue>;
}

export interface ResolvedDecisionTableInput {
  name: string;
  expression: ResolvedExpression;
}

export interface ResolvedDecisionTableRow {
  name: string;
  condition: ResolvedExpression;
  outputs: Record<string, JsonValue>;
}

export interface ResolvedCommand {
  name: string;
  label?: string;
  preconditions: ResolvedCommandPrecondition[];
  inputs: ResolvedCommandInput[];
  steps: ResolvedCommandStep[];
}

export interface ResolvedCommandPrecondition {
  name: string;
  expression: ResolvedExpression;
  message: string;
}

export interface ResolvedCommandInput {
  name: string;
  type: FieldType;
  required: boolean;
  defaultValue?: JsonValue;
}

export type ResolvedCommandStep = ResolvedCommandCreateStep | ResolvedCommandUpdateStep;

export interface ResolvedCommandCreateStep {
  name: string;
  action: "create";
  object: string;
  authority: CommandStepAuthority;
  values: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
}

export interface ResolvedCommandUpdateStep {
  name: string;
  action: "update";
  object: string;
  authority: CommandStepAuthority;
  recordId: ResolvedCommandValueExpression;
  patch: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
}

export type ResolvedCommandValueExpression =
  | { kind: "literal"; value: JsonValue }
  | { kind: "input"; name: string }
  | { kind: "runtime"; property: CommandRuntimeProperty }
  | { kind: "stepField"; step: string; field: string }
  | { kind: "stepMeta"; step: string; property: CommandStepMetaProperty };

export interface ResolvedTheme {
  name: string;
  base?: string;
  tokens: ResolvedThemeTokens;
}

export interface ResolvedThemeTokens {
  colorPrimary: string;
  colorAccent: string;
  colorBackground: string;
  colorSurface: string;
  colorSurfaceAlt: string;
  colorText: string;
  colorTextMuted: string;
  colorTextInverted: string;
  colorBorder: string;
  colorDanger: string;
  colorSuccess: string;
  colorInfo: string;
  radius: ThemeRadius;
  density: ThemeDensity;
  nav: ThemeNav;
  fontFamily?: string;
  logoUrl?: string;
}

export interface ResolvedSyncPolicy {
  object: string;
  mode: SyncMode;
  scope: SyncScope;
  window?: ResolvedSyncWindow;
  conflict: ConflictStrategy;
}

export type ResolvedObjectSyncPolicy = Omit<ResolvedSyncPolicy, "object">;

export interface ResolvedSyncWindow {
  field: string;
  days?: number;
  limit?: number;
}

export interface ResolvedObjectAuditPolicy {
  enabled: boolean;
  operations: AuditOperation[];
}

export interface ResolvedAuditModel {
  enabled: boolean;
  operations: AuditOperation[];
  metadataFields: string[];
}

export interface PlatformRecordMetadata {
  guid: string;
  object: string;
  schemaVersion: number;
  revision: string;
  state?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string;
  deletedBy?: string;
  syncStatus: SyncStatus;
}

export interface StoredObjectRecord {
  meta: PlatformRecordMetadata;
  values: Record<string, JsonValue>;
}

export interface AuditEvent {
  auditId: string;
  object: string;
  recordId: string;
  operation: AuditOperation;
  lifecycleAction?: string;
  fromState?: string;
  toState?: string;
  actorId: string;
  occurredAt: string;
  before?: Record<string, JsonValue>;
  after?: Record<string, JsonValue>;
  metadata: PlatformRecordMetadata;
}

export interface ResolvedOperationLogModel {
  enabled: boolean;
  operations: LocalOperationKind[];
  statuses: LocalOperationStatus[];
}

export interface LocalOperation {
  opId: string;
  object: string;
  recordId: string;
  baseRevision?: string;
  operation: LocalOperationKind;
  patch?: Record<string, JsonValue>;
  lifecycleAction?: string;
  fromState?: string;
  toState?: string;
  createdAt: string;
  createdBy: string;
  contextSnapshot: {
    roles: string[];
    channel: Extract<RuntimeChannel, "ui" | "api" | "sync">;
  };
  status: LocalOperationStatus;
  serverMessage?: string;
}

export interface PartialApplicationModel {
  modelVersion?: string;
  app: PartialAppModel;
  roles?: PartialRoleModel[];
  contexts?: PartialBusinessContextModel[];
  objects: PartialObjectModel[];
  readModels?: PartialReadModelModel[];
  decisionTables?: PartialDecisionTableModel[];
  commands?: PartialCommandModel[];
  policies?: PartialPolicyModel[];
  themes?: PartialThemeModel[];
  sync?: PartialSyncPolicyModel[];
}

export interface PartialAppModel {
  name: string;
  startView?: string;
  theme?: string;
}

export interface PartialRoleModel {
  name: string;
  description?: string;
  inherits?: string[];
}

export interface PartialBusinessContextModel {
  name: string;
  object?: string;
  selection?: PartialContextSelectionPolicyModel;
  membership?: PartialContextMembershipModel;
}

export interface PartialContextSelectionPolicyModel {
  mode?: ContextSelectionMode;
  autoSelect?: boolean;
  persistence?: ContextSelectionPersistence;
  source?: ContextSelectionSource;
  routeParam?: string;
}

export interface PartialContextMembershipModel {
  object: string;
  userField: string;
  contextField: string;
  roleField: string;
  roles?: string[];
}

export interface PartialObjectModel {
  name: string;
  schemaVersion?: number;
  tableName?: string;
  systemIdField?: string;
  businessKey?: string;
  displayField?: string;
  fields?: PartialFieldModel[];
  computedFields?: PartialComputedFieldModel[];
  scope?: PartialObjectScopeModel;
  constraints?: PartialObjectConstraintModel[];
  validations?: PartialObjectValidationModel[];
  lifecycle?: PartialLifecycleModel;
  policies?: string[];
  views?: PartialViewModel[];
  sync?: PartialObjectSyncPolicyModel;
  audit?: PartialObjectAuditPolicyModel;
}

export interface PartialComputedFieldModel {
  name: string;
  storageName?: string;
  type: FieldType;
  expression: ResolvedExpression;
  strategy?: ComputedFieldStrategy;
}

export interface PartialObjectScopeModel {
  context: string;
  field: string;
}

export interface PartialFieldModel {
  name: string;
  storageName?: string;
  type?: FieldType;
  required?: boolean;
  defaultValue?: JsonValue;
  validators?: PartialValidatorModel[];
  readonly?: boolean;
  hidden?: boolean;
  lookup?: PartialLookupModel;
  autoId?: PartialAutoIdModel;
}

export type PartialValidatorModel = PartialNamedValidatorModel | PartialPredicateValidatorModel;

export interface PartialNamedValidatorModel {
  kind: ResolvedNamedValidatorKind;
  value?: JsonValue;
}

export interface PartialPredicateValidatorModel {
  kind: "predicate";
  expression: ResolvedExpression;
  message?: string;
}

export interface PartialLookupModel {
  targetObject: string;
  targetField?: string;
  displayField: string;
}

export interface PartialAutoIdModel {
  prefix?: string;
  pad?: number;
  scopeField?: string;
}

export type PartialObjectConstraintModel =
  | PartialUniqueObjectConstraintModel
  | PartialOrderedObjectConstraintModel;

export interface PartialUniqueObjectConstraintModel {
  name: string;
  kind: "unique";
  fields: string[];
  scopeFields?: string[];
}

export interface PartialOrderedObjectConstraintModel {
  name: string;
  kind: "ordered";
  parentField: string;
  positionField: string;
  scopeFields?: string[];
  minPosition?: number;
}

export interface PartialObjectValidationModel {
  name: string;
  expression: PartialPolicyConditionModel;
  message?: string;
}

export interface PartialLifecycleModel {
  name: string;
  stateField?: string;
  initialState?: string;
  states: PartialStateModel[];
  actions?: PartialLifecycleActionModel[];
}

export interface PartialStateModel {
  name: string;
  terminal?: boolean;
}

export interface PartialLifecycleActionModel {
  name: string;
  from: string | string[];
  to: string;
  label?: string;
  guards?: PartialLifecycleGuardModel[];
  policyRefs?: string[];
  hooks?: PartialHookRefsModel;
}

export interface PartialLifecycleGuardModel {
  name: string;
  expression: PartialPolicyConditionModel;
  message?: string;
}

export interface PartialHookRefsModel {
  before?: string[];
  after?: string[];
  onError?: string[];
}

export interface PartialPolicyModel {
  name: string;
  object: string;
  defaultEffect?: "deny";
  rules?: PartialPolicyRuleModel[];
}

export interface PartialPolicyRuleModel {
  name: string;
  effect: PolicyEffect;
  principal?: PartialPrincipalSelectorModel;
  action: PolicyAction;
  state?: string | string[];
  fields?: string[];
  lifecycleAction?: string;
  condition?: PartialPolicyConditionModel;
  channels?: RuntimeChannel[];
}

export type PartialPolicyConditionModel = ResolvedExpression | ResolvedPolicyCondition;

export interface PartialPrincipalSelectorModel {
  match?: PrincipalMatch;
  roles?: string[];
  groupRoles?: string[];
  users?: string[];
  owner?: boolean;
}

export interface PartialViewModel {
  name: string;
  object?: string;
  kind: ViewKind;
  context?: PartialViewContextModel;
  readModel?: string;
  fields?: string[];
  searchFields?: string[];
  sort?: ResolvedSort[];
  actions?: string[];
}

export interface PartialViewContextModel {
  mode: ViewContextMode;
  context?: string;
}

export interface PartialReadModelModel {
  name: string;
  context?: PartialViewContextModel;
  sources: PartialReadModelSourceModel[];
  fields: PartialReadModelFieldModel[];
  sort?: ResolvedSort[];
}

export interface PartialReadModelSourceModel {
  name?: string;
  object: string;
  scope?: ReadModelSourceScope;
}

export interface PartialReadModelFieldModel {
  name: string;
  type?: FieldType;
  source?: string;
  field?: string;
  expression?: PartialPolicyConditionModel;
}

export interface PartialDecisionTableModel {
  name: string;
  object: string;
  match?: DecisionTableMatchPolicy;
  inputs?: PartialDecisionTableInputModel[];
  rows?: PartialDecisionTableRowModel[];
  defaultOutputs?: Record<string, JsonValue>;
}

export interface PartialDecisionTableInputModel {
  name: string;
  expression: PartialPolicyConditionModel;
}

export interface PartialDecisionTableRowModel {
  name: string;
  condition: PartialPolicyConditionModel;
  outputs?: Record<string, JsonValue>;
}

export interface PartialCommandModel {
  name: string;
  label?: string;
  preconditions?: PartialCommandPreconditionModel[];
  inputs?: PartialCommandInputModel[];
  steps?: PartialCommandStepModel[];
}

export interface PartialCommandPreconditionModel {
  name: string;
  expression: PartialPolicyConditionModel;
  message?: string;
}

export interface PartialCommandInputModel {
  name: string;
  type?: FieldType;
  required?: boolean;
  defaultValue?: JsonValue;
}

export type PartialCommandStepModel = PartialCommandCreateStepModel | PartialCommandUpdateStepModel;

export interface PartialCommandCreateStepModel {
  name: string;
  action: "create";
  object: string;
  authority?: CommandStepAuthority;
  values?: Record<string, ResolvedCommandValueExpression>;
  preconditions?: PartialPolicyConditionModel[];
}

export interface PartialCommandUpdateStepModel {
  name: string;
  action: "update";
  object: string;
  authority?: CommandStepAuthority;
  recordId: ResolvedCommandValueExpression;
  patch?: Record<string, ResolvedCommandValueExpression>;
  preconditions?: PartialPolicyConditionModel[];
}

export interface PartialThemeModel {
  name: string;
  base?: string;
  tokens?: Partial<ResolvedThemeTokens>;
}

export interface PartialSyncPolicyModel {
  object: string;
  mode?: SyncMode;
  scope?: SyncScope;
  window?: PartialSyncWindowModel;
  conflict?: ConflictStrategy;
}

export type PartialObjectSyncPolicyModel = Omit<PartialSyncPolicyModel, "object">;

export interface PartialSyncWindowModel {
  field?: string;
  days?: number;
  limit?: number;
}

export interface PartialObjectAuditPolicyModel {
  enabled?: boolean;
  operations?: AuditOperation[];
}
