export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type FieldType = "text" | "number" | "date" | "datetime" | "time" | "boolean" | "attachment";

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
  | "mimeType";

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
export type SyncScope = "all" | "assignedToUser" | "ownedByUser" | "recent" | "custom";
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

export interface ResolvedApplicationModel {
  modelVersion: string;
  generatedAt?: string;
  app: ResolvedApp;
  roles: ResolvedRole[];
  contexts?: ResolvedBusinessContext[];
  objects: ResolvedObject[];
  readModels?: ResolvedReadModel[];
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
  metadataFields: ResolvedMetadataField[];
  scope?: ResolvedObjectScope;
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

export interface ResolvedValidator {
  kind: ValidatorKind;
  value?: JsonValue;
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
  policyRefs: string[];
  hooks: ResolvedHookRefs;
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
  condition?: string;
  channels: RuntimeChannel[];
}

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
}

export interface ResolvedReadModelSource {
  name: string;
  object: string;
}

export interface ResolvedReadModelField {
  name: string;
  type?: FieldType;
  source?: string;
  field?: string;
}

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
  conflict: ConflictStrategy;
}

export type ResolvedObjectSyncPolicy = Omit<ResolvedSyncPolicy, "object">;

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
  scope?: PartialObjectScopeModel;
  lifecycle?: PartialLifecycleModel;
  policies?: string[];
  views?: PartialViewModel[];
  sync?: PartialObjectSyncPolicyModel;
  audit?: PartialObjectAuditPolicyModel;
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

export interface PartialValidatorModel {
  kind: ValidatorKind;
  value?: JsonValue;
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
  policyRefs?: string[];
  hooks?: PartialHookRefsModel;
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
  condition?: string;
  channels?: RuntimeChannel[];
}

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
}

export interface PartialReadModelSourceModel {
  name?: string;
  object: string;
}

export interface PartialReadModelFieldModel {
  name: string;
  type?: FieldType;
  source?: string;
  field?: string;
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
  conflict?: ConflictStrategy;
}

export type PartialObjectSyncPolicyModel = Omit<PartialSyncPolicyModel, "object">;

export interface PartialObjectAuditPolicyModel {
  enabled?: boolean;
  operations?: AuditOperation[];
}
