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
export type EditContainerMode = "modal" | "drawer" | "page" | "splitPane";
export type PresentationLayout = "stack" | "grid" | "split" | "sidebar";
export type PresentationDensity = "compact" | "comfortable" | "spacious";
export type PresentationStateType = Exclude<FieldType, "attachment">;
export type PresentationStatePersistence = "memory" | "session" | "local";
export type PresentationControlKind = "toggle" | "select" | "action" | "contextSelector";
export type PresentationActionPlacement = "primary" | "secondary" | "row";
export type PresentationListSourceKind = "readModel" | "object";
export type PresentationMatrixSourceKind = "readModel" | "object";
export type PresentationCalendarSourceKind = "readModel" | "object";
export type PresentationMatrixColumnKind = "dateRange";
export type PresentationMatrixBulkBehavior = "sequentialValidatedWrites";
export type PresentationCalendarWeekStart =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";
export type RelationshipPickerSourceKind = "object" | "readModel";
export type RelationshipPickerSelectionMode = "single" | "multiple";
export type PresentationListRenderStyle = "table" | "feed" | "compactFeed" | "cards";
export type PresentationRowLayout = "inline" | "stack";
export type PresentationFragmentStyle = "plain" | "bold" | "muted" | "caption";
export type PresentationFormatKind = "text" | "number" | "date" | "datetime" | "time";
export type PresentationShellRegion = "topBar" | "bottomBar" | "sidebar";
export type PresentationStatusThemeToken =
  | "colorStatusEvent"
  | "colorStatusAlternate"
  | "colorStatusAvailable"
  | "colorStatusUnavailable"
  | "colorStatusBusyElsewhere"
  | "colorStatusConflict"
  | "colorStatusUnset"
  | "colorInfo";
export type PresentationLegendInclude = "present" | "all";
export type EditSectionKind = "fields" | "childCollection";
export type EditChildOperationKind =
  | "createChild"
  | "linkExisting"
  | "updateChild"
  | "unlink"
  | "remove"
  | "reorder";
/**
 * `syncStatus` reports the sync state of the device's *records*; `connectivity`
 * reports whether the device can reach the authority. They were one control
 * until Phase 58, which is why a control named for record state rendered
 * "Online"/"Offline" and no surface answered the question it was named after.
 */
export type ShellControlKind =
  | "contextSelector"
  | "themeSwitch"
  | "logout"
  | "pwaInstall"
  | "syncStatus"
  | "connectivity";
export type ShellControlPlacement = "topBar" | "navDrawer";
export type ShellContextSelectorPlacement = "topBar" | "navDrawer" | "hidden";
export type ShellMobileContextSelectorMode = "dropdown" | "sheet";
export type ShellVisibilityKind =
  | "always"
  | "contextAvailable"
  | "contextSelected"
  | "online"
  | "offline";

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

export type PrincipalMatch =
  | "everyone"
  | "authenticated"
  | "anonymous"
  | "owner"
  | "specific"
  | "contextMember";

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
/**
 * A record's device-local synchronisation state. Every value has a producer:
 *
 * - `local` — the record has no delivery path at all, because its object's sync
 *   mode is not queueable. It is not waiting for anything.
 * - `pending` — a local write was accepted and queued, and the authority has not
 *   answered it yet.
 * - `synced` — the authority's accepted state, either written by the authority
 *   itself or reconciled onto the device from it.
 * - `conflict` — the authority answered the operation covering this record with
 *   a conflict, and no strategy or person has resolved it yet.
 * - `rejected` — the authority refused the operation covering this record. The
 *   record is still here, and this is what says so.
 *
 * It is device-local in both directions: a client never asserts it to the
 * authority, and never adopts one the authority sent.
 */
export type SyncStatus = "local" | "pending" | "synced" | "conflict" | "rejected";
/**
 * `command` is the whole of a model-declared command, not one of its writes. A
 * command's steps commit in one transaction, and replaying them as separate
 * per-record operations destroys that transaction across the sync boundary: a
 * step writing into a context an earlier step established has no context to
 * write into, and a batch lands partially. The command kind is what lets the
 * queue carry the transaction rather than its pieces.
 *
 * `batch` is the same idea for a transaction no command declares: an edit
 * surface's staged child changes, which the user made as one act of editing and
 * which must therefore land as one. It differs from `command` in what crosses
 * the wire. A command is re-executed from its input, because a command exists in
 * the model and the authority can run it again. A batch has no such declaration,
 * so it crosses as the writes themselves — each one still checked server-side by
 * the same policy, validation, scope and constraint path an individual intent
 * takes, but all of them inside one transaction.
 */
export type LocalOperationKind =
  | "create"
  | "update"
  | "delete"
  | "transition"
  | "command"
  | "batch";
export type LocalOperationStatus = "pending" | "sent" | "accepted" | "rejected" | "conflict";
/**
 * Audit stays per record: a command is audited as the writes it made, step by
 * step, and so is a batch. Only the queue needs the transaction as one thing.
 */
export type AuditOperation = Exclude<LocalOperationKind, "command" | "batch"> | "read" | "search";
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
export type ReadModelStrategy = "join" | "union";
export type ObjectConstraintKind = "unique" | "ordered";
export type OrderedCollectionReorder = "strict" | "shift";
export type OrderedCollectionCompaction = "none" | "onDelete";
export type ReadModelJoinCardinality = "one" | "many";
export type PolicyConditionKind = "equals" | "all" | "any" | "not";
export type PolicyConditionRuntimeProperty = "userId";
export type DecisionTableMatchPolicy = "first" | "single";
export type CommandStepAction = "create" | "update";
export type CommandStepAuthority = "caller" | "command";
export type CommandRuntimeProperty = "userId" | "nowIso" | "today";
export type CommandStepMetaProperty = "guid" | "createdAt" | "updatedAt";

export interface ResolvedApplicationModel {
  /**
   * The version the model declares (`APP ... MODEL_VERSION "1.1.0"`), defaulting
   * to {@link ADL_MODEL_VERSION} when undeclared. It selects migrations; it is
   * not evidence that the content is unchanged, which is what
   * {@link ResolvedApplicationModel.modelFingerprint} is for.
   */
  modelVersion: string;
  /**
   * A deterministic digest of this model's own content, computed during
   * resolution. Two resolutions of the same content always agree, and any
   * content change changes it — including one an author forgot to declare, which
   * is refused at startup rather than absorbed silently.
   */
  modelFingerprint: string;
  generatedAt?: string;
  app: ResolvedApp;
  shell: ResolvedShell;
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
  /**
   * How persisted records reach this model's version from an earlier one. Each
   * entry is one hop; the runtime chains them. Declaring a migration is the only
   * thing that makes a model version change appliable rather than fail-closed.
   */
  migrations: ResolvedModelMigration[];
  defaults: ResolvedModelDefaults;
}

/**
 * One version hop. Migrations are a persistence concern expressed declaratively,
 * so the same hop runs identically over the authority's accepted-record
 * projection and a browser's IndexedDB records. They never describe SQL, storage
 * engines or table shape: the projection stores whole records as JSON, and the
 * projection's own tables migrate out of band through ordered SQL files.
 */
export interface ResolvedModelMigration {
  from: string;
  to: string;
  objects: ResolvedModelMigrationObject[];
}

export interface ResolvedModelMigrationObject {
  object: string;
  /**
   * The `meta.schemaVersion` a record of this object carries once the hop has
   * been applied. Undeclared means the hop does not change it.
   */
  schemaVersion?: number;
  steps: ResolvedModelMigrationStep[];
}

/**
 * The whole step vocabulary. It is deliberately small: every step is total (it
 * cannot fail on a well-formed record), reversible to inspect, and expressible
 * against any conforming runtime. Anything an author cannot say with these is a
 * model change that needs a different shape, not a bigger vocabulary.
 */
export type ResolvedModelMigrationStep =
  | ResolvedModelMigrationRenameFieldStep
  | ResolvedModelMigrationAddFieldStep
  | ResolvedModelMigrationDropFieldStep;

export interface ResolvedModelMigrationRenameFieldStep {
  kind: "renameField";
  from: string;
  to: string;
}

export interface ResolvedModelMigrationAddFieldStep {
  kind: "addField";
  field: string;
  /** Written to every record that does not already carry the field. */
  defaultValue: JsonValue;
}

export interface ResolvedModelMigrationDropFieldStep {
  kind: "dropField";
  field: string;
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
  /**
   * How long a device may sync since its last successful authentication to the
   * authority before a fresh logon is required. It is a sync-policy property,
   * not an identity one: it never declares how a credential is verified, and it
   * never gates local operation, which works offline indefinitely either side
   * of the grace. The authority loads the same resolved model and remains the
   * enforcement point; the client-side check is only an affordance.
   */
  offlineGraceDays: number;
}

export interface ResolvedShell {
  nav: ResolvedShellNavigation;
  topBar: ResolvedShellTopBar;
  navDrawer: ResolvedShellNavDrawer;
  controls: ResolvedShellControl[];
}

export interface ResolvedShellNavigation {
  items: ResolvedShellNavItem[];
}

export interface ResolvedShellNavItem {
  name: string;
  view: string;
  label: string;
  icon?: string;
  group?: string;
  order: number;
  activeWhen: string[];
  visibility: ResolvedShellVisibility;
}

export interface ResolvedShellVisibility {
  kind: ShellVisibilityKind;
  context?: string;
}

export interface ResolvedShellTopBar {
  contextSelector: ShellContextSelectorPlacement;
  mobileContextSelector: ShellMobileContextSelectorMode;
  controls: string[];
}

/**
 * The navigation drawer's own chrome, symmetrical with {@link ResolvedShellTopBar}.
 *
 * `navDrawer` was already a legal {@link ShellControlPlacement}, so a control
 * could be placed in the drawer and then never rendered anywhere: the drawer had
 * no declared control list for a renderer to consume. This is that list.
 */
export interface ResolvedShellNavDrawer {
  /** Drawer heading. Undeclared means the renderer falls back to the app name. */
  title?: string;
  /** Ordered control names rendered inside the drawer. */
  controls: string[];
}

export interface ResolvedShellControl {
  name: string;
  kind: ShellControlKind;
  label?: string;
  icon?: string;
  placement: ShellControlPlacement;
  visibility: ResolvedShellVisibility;
  context?: string;
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
  /**
   * Records that put a context instance *in reach* of a user without making
   * them a member of it.
   *
   * Membership is the only thing that confers context roles, and it stays that
   * way. A grant does one narrower thing: it lets the runtime's object-scope
   * gate accept a record belonging to that context instance, so the object's own
   * policy is the thing that finally decides. Without this, a person holding a
   * pending invitation to a context they have not joined is refused upstream of
   * policy entirely — the invitation is scoped to the very context the
   * invitation is what would get them into — and the rule the model wrote to let
   * an invitee read and accept their own invitation can never be reached.
   */
  grants: ResolvedContextGrant[];
}

/**
 * One declared route into a context that is not membership.
 *
 * A grant names an object whose records associate a user with a context
 * instance, plus an optional condition those records must satisfy. It confers
 * **no roles**: `contextRoles` stays derived from membership alone, so a
 * grant-holder passes the scope gate and then meets exactly the policy rules
 * written for a non-member, never a role-gated one.
 */
export interface ResolvedContextGrant {
  name: string;
  /** The object whose records carry the grant, e.g. an invitation. */
  object: string;
  /** The field naming the granted user. */
  userField: string;
  /** The field naming the context instance the grant reaches. */
  contextField: string;
  /** Evaluated against the grant record; absent means every record grants. */
  condition?: ResolvedExpression;
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
  /**
   * What happens when a write lands on a position a sibling already holds.
   *
   * `strict` refuses it, which is the original behaviour and stays the default:
   * a duplicate position is a genuine error in a collection nobody reorders.
   * `shift` makes the collection reorderable — the platform moves the
   * intervening siblings in the same transaction, so an author can express
   * "put this third" without also having to express every consequence of it.
   */
  reorder: OrderedCollectionReorder;
  /**
   * Whether removing an item closes the gap it leaves.
   *
   * `none` keeps the hole, which is what deleting has always done. `onDelete`
   * renumbers the later siblings down in the same transaction as the delete, so
   * positions stay contiguous from {@link minPosition} without a caller having
   * to walk the collection itself.
   */
  compaction: OrderedCollectionCompaction;
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
  contextMember?: ResolvedContextMemberPrincipal;
}

/**
 * "Whoever this record belongs to is in a context with me."
 *
 * `owner` says a record is the caller's own and roles say what a caller may do
 * inside a context. Neither says the thing a shared roster needs: that a record
 * belonging to *somebody else* is visible because the two of them are in the
 * same context instance. Expressing that with a role instead would grant it
 * over every record of the object, including those of people the caller shares
 * nothing with.
 *
 * It is evaluated against {@link RuntimeContext.contextMembers}, which the
 * runtime resolves from the same accepted membership records
 * `listAvailableContexts` reads. Absent membership data never matches, so the
 * principal fails closed.
 */
export interface ResolvedContextMemberPrincipal {
  /** The business context whose members match. */
  context: string;
  /** The field on the target record naming the user who must be a co-member. */
  field: string;
}

export interface ResolvedView {
  name: string;
  object: string;
  kind: ViewKind;
  context?: ResolvedViewContext;
  readModel?: string;
  editContainer: EditContainerMode;
  fields: string[];
  searchFields: string[];
  sort: ResolvedSort[];
  actions: string[];
  editSections: ResolvedEditSection[];
  presentation?: ResolvedViewPresentation;
}

export interface ResolvedViewContext {
  mode: ViewContextMode;
  context?: string;
}

export interface ResolvedSort {
  field: string;
  direction: "asc" | "desc";
}

export type ResolvedEditSection = ResolvedEditFieldsSection | ResolvedEditChildCollectionSection;

export interface ResolvedEditSectionBase {
  name: string;
  kind: EditSectionKind;
  heading?: string;
}

export interface ResolvedEditFieldsSection extends ResolvedEditSectionBase {
  kind: "fields";
  fields: string[];
}

export interface ResolvedEditChildCollectionSection extends ResolvedEditSectionBase {
  kind: "childCollection";
  childObject: string;
  parentField: string;
  childView?: string;
  operations: EditChildOperationKind[];
  staged: boolean;
  orderField?: string;
  emptyState: ResolvedEditChildCollectionEmptyState;
  picker?: ResolvedRelationshipPicker;
}

export interface ResolvedEditChildCollectionEmptyState {
  text: string;
}

export interface ResolvedRelationshipPicker {
  name: string;
  sourceKind: RelationshipPickerSourceKind;
  source: string;
  /**
   * The child field that receives the chosen candidate's record id, which turns
   * the picker from one that *links* into one that *creates*.
   *
   * Without it a picker offers existing child records and sets their parent
   * field — "move a set-list item into this set list". With it the candidates are
   * a related object and each choice mints a new child naming it — "add this
   * song to this set list", which is the operation a person actually performs and
   * which was previously inexpressible.
   *
   * The candidates are then the field's own lookup target, so what is offered is
   * decided by the model rather than by the picker's source alone.
   */
  candidateField?: string;
  selection: RelationshipPickerSelectionMode;
  displayFields: string[];
  searchFields: string[];
  sort: ResolvedSort[];
  excludeAlreadyLinked: boolean;
  emptyState: ResolvedRelationshipPickerEmptyState;
}

export interface ResolvedRelationshipPickerEmptyState {
  text: string;
}

export interface ResolvedViewPresentation {
  layout: PresentationLayout;
  density: PresentationDensity;
  state: ResolvedPresentationState[];
  iconMaps: ResolvedPresentationIconMap[];
  statuses: ResolvedPresentationStatus[];
  statusMaps: ResolvedPresentationStatusMap[];
  legends: ResolvedPresentationLegend[];
  sections: ResolvedPresentationSection[];
  shell?: ResolvedPresentationShell;
}

export interface ResolvedPresentationState {
  name: string;
  type: PresentationStateType;
  defaultValue: JsonValue;
  persistence: PresentationStatePersistence;
}

export interface ResolvedPresentationIconMap {
  name: string;
  field: string;
  values: ResolvedPresentationIconMapValue[];
  defaultIcon?: string;
}

export interface ResolvedPresentationIconMapValue {
  value: JsonPrimitive;
  icon: string;
}

export interface ResolvedPresentationStatus {
  name: string;
  label: string;
  accessibleLabel: string;
  icon?: ResolvedPresentationIconRef;
  themeToken: PresentationStatusThemeToken;
  precedence: number;
}

export interface ResolvedPresentationStatusMap {
  name: string;
  field: string;
  values: ResolvedPresentationStatusMapValue[];
  defaultStatus?: string;
}

export interface ResolvedPresentationStatusMapValue {
  value: JsonPrimitive;
  status: string;
}

export interface ResolvedPresentationLegend {
  name: string;
  title?: string;
  statuses: string[];
  include: PresentationLegendInclude;
}

export interface ResolvedPresentationSection {
  name: string;
  heading?: string;
  layout: PresentationLayout;
  density: PresentationDensity;
  controls: ResolvedPresentationControl[];
  lists: ResolvedPresentationList[];
  matrices: ResolvedPresentationMatrix[];
  calendars: ResolvedPresentationCalendar[];
}

export type ResolvedPresentationControl =
  | ResolvedPresentationToggleControl
  | ResolvedPresentationSelectControl
  | ResolvedPresentationActionControl
  | ResolvedPresentationContextSelectorControl;

export interface ResolvedPresentationControlBase {
  name: string;
  kind: PresentationControlKind;
  label?: string;
  icon?: ResolvedPresentationIconRef;
}

export interface ResolvedPresentationToggleControl extends ResolvedPresentationControlBase {
  kind: "toggle";
  state: string;
}

export interface ResolvedPresentationSelectControl extends ResolvedPresentationControlBase {
  kind: "select";
  state: string;
  options: ResolvedPresentationSelectOption[];
}

export interface ResolvedPresentationSelectOption {
  value: JsonPrimitive;
  label: string;
  icon?: ResolvedPresentationIconRef;
}

export interface ResolvedPresentationActionControl extends ResolvedPresentationControlBase {
  kind: "action";
  placement: PresentationActionPlacement;
  command?: string;
  view?: string;
  create?: ResolvedPresentationCreateTarget;
  input: Record<string, ResolvedExpression>;
  visibleWhen?: ResolvedExpression;
}

export interface ResolvedPresentationCreateTarget {
  object?: string;
  view?: string;
}

export interface ResolvedPresentationContextSelectorControl
  extends ResolvedPresentationControlBase {
  kind: "contextSelector";
  context?: string;
}

export interface ResolvedPresentationList {
  name: string;
  sourceKind: PresentationListSourceKind;
  source: string;
  renderAs: PresentationListRenderStyle;
  density: PresentationDensity;
  fields: string[];
  sort: ResolvedSort[];
  filter?: ResolvedExpression;
  emptyState: ResolvedPresentationEmptyState;
  status?: ResolvedPresentationStatusBinding;
  actions: ResolvedPresentationActionControl[];
  row: ResolvedPresentationRowTemplate;
}

export interface ResolvedPresentationMatrix {
  name: string;
  density: PresentationDensity;
  rowSource: ResolvedPresentationMatrixAxisSource;
  columnAxis: ResolvedPresentationMatrixDateColumnAxis;
  cellSource: ResolvedPresentationMatrixCellSource;
  cell: ResolvedPresentationMatrixCell;
  edit?: ResolvedPresentationMatrixEdit;
}

export interface ResolvedPresentationMatrixAxisSource {
  sourceKind: PresentationMatrixSourceKind;
  source: string;
  keyField?: string;
  labelField: string;
  fields: string[];
  sort: ResolvedSort[];
}

export interface ResolvedPresentationMatrixDateColumnAxis {
  kind: "dateRange";
  start: string;
  end: string;
  stepDays: number;
  labelFormat?: ResolvedPresentationFormat;
}

export interface ResolvedPresentationMatrixCellSource {
  sourceKind: PresentationMatrixSourceKind;
  source: string;
  rowField: string;
  columnField: string;
  fields: string[];
  status?: ResolvedPresentationStatusBinding;
  recordSource?: string;
}

export interface ResolvedPresentationMatrixCell {
  status?: ResolvedPresentationStatusBinding;
  unsetStatus?: string;
  accessibleLabel?: string;
}

export interface ResolvedPresentationMatrixEdit {
  object: string;
  rowField: string;
  columnField: string;
  valueField: string;
  cycle: JsonPrimitive[];
  unsetValue?: JsonPrimitive | null;
  unsetAsAbsence: boolean;
  bulkBehavior: PresentationMatrixBulkBehavior;
}

export interface ResolvedPresentationCalendar {
  name: string;
  density: PresentationDensity;
  sourceKind: PresentationCalendarSourceKind;
  source: string;
  dateField: string;
  titleField?: string;
  summaryFields: string[];
  fields: string[];
  sort: ResolvedSort[];
  month: ResolvedPresentationCalendarMonth;
  status?: ResolvedPresentationStatusBinding;
  actions: ResolvedPresentationActionControl[];
  emptyState: ResolvedPresentationEmptyState;
}

export interface ResolvedPresentationCalendarMonth {
  value?: string;
  state?: string;
  weekStart: PresentationCalendarWeekStart;
  minDate?: string;
  maxDate?: string;
  labelFormat?: ResolvedPresentationFormat;
}

export interface ResolvedPresentationStatusBinding {
  candidates: ResolvedPresentationStatusCandidate[];
}

export type ResolvedPresentationStatusCandidate =
  | { kind: "status"; status: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };

export interface ResolvedPresentationEmptyState {
  text: string;
  icon?: ResolvedPresentationIconRef;
}

export interface ResolvedPresentationRowTemplate {
  layout: PresentationRowLayout;
  density: PresentationDensity;
  fragments: ResolvedPresentationRowFragment[];
}

export type ResolvedPresentationRowFragment =
  | ResolvedPresentationLiteralTextFragment
  | ResolvedPresentationFieldTextFragment
  | ResolvedPresentationIconFragment
  | ResolvedPresentationConditionalFragment;

export interface ResolvedPresentationLiteralTextFragment {
  kind: "text";
  text: string;
  style: PresentationFragmentStyle;
}

export interface ResolvedPresentationFieldTextFragment {
  kind: "field";
  field: string;
  style: PresentationFragmentStyle;
  format?: ResolvedPresentationFormat;
  fallback?: string;
}

export interface ResolvedPresentationIconFragment {
  kind: "icon";
  icon: ResolvedPresentationIconRef;
  label?: string;
}

export interface ResolvedPresentationConditionalFragment {
  kind: "conditional";
  when: ResolvedExpression;
  fragments: ResolvedPresentationRowFragment[];
}

export interface ResolvedPresentationFormat {
  kind: PresentationFormatKind;
  pattern?: string;
}

export type ResolvedPresentationIconRef =
  | { kind: "named"; name: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };

export interface ResolvedPresentationShell {
  regions: ResolvedPresentationShellRegion[];
}

export interface ResolvedPresentationShellRegion {
  region: PresentationShellRegion;
  title?: string;
  controls: string[];
}

export interface ResolvedReadModel {
  name: string;
  context?: ResolvedViewContext;
  strategy: ReadModelStrategy;
  sources: ResolvedReadModelSource[];
  fields: ResolvedReadModelField[];
  sort: ResolvedSort[];
}

export interface ResolvedReadModelSource {
  name: string;
  object: string;
  scope: ReadModelSourceScope;
  /**
   * How this source reaches an earlier one.
   *
   * Undeclared keeps the original behaviour: the runtime follows whatever
   * lookup field an already-loaded record declares toward this source's object,
   * and reads exactly one record by id. That only ever walks a foreign key
   * forwards, so it cannot express "the records that point *at* what I already
   * have" — the shape every projection through a junction object needs.
   */
  join?: ResolvedReadModelSourceJoin;
}

/**
 * An explicit equality join between two read-model sources.
 *
 * Naming both sides makes the hop sayable when no lookup field connects the two
 * objects directly, which is what a junction object always looks like: two
 * records that share a third object's id rather than referencing each other.
 * `many` additionally lets one upstream row produce several rows, which the
 * id-based lookup join structurally could not.
 */
export interface ResolvedReadModelSourceJoin {
  /** An earlier source in the same read model. */
  source: string;
  /** The field on this source's object. {@link RECORD_ID_JOIN_FIELD} means the record id. */
  localField: string;
  /** The field on the joined source's object. {@link RECORD_ID_JOIN_FIELD} means the record id. */
  sourceField: string;
  cardinality: ReadModelJoinCardinality;
}

/**
 * The join-field name that means "this record's own id" rather than a declared
 * field, so a join can key on identity without an object having to carry a
 * duplicate of its own id as a business field.
 */
export const RECORD_ID_JOIN_FIELD = "id";

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
  /**
   * Whether this input carries a list rather than one value.
   *
   * A command's steps are fixed at authoring time, so without this the number
   * of records a command can write is fixed too, and importing fifty songs
   * means fifty independent transactions with no shared success or failure.
   */
  repeated: boolean;
  /**
   * The shape of one item, when items are records rather than scalars. Empty
   * means the list carries plain {@link ResolvedCommandInput.type} values.
   */
  itemFields: ResolvedCommandInputItemField[];
}

export interface ResolvedCommandInputItemField {
  name: string;
  type: FieldType;
  required: boolean;
}

export type ResolvedCommandStep = ResolvedCommandCreateStep | ResolvedCommandUpdateStep;

export interface ResolvedCommandCreateStep {
  name: string;
  action: "create";
  object: string;
  authority: CommandStepAuthority;
  values: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
  /**
   * Names a repeated input this step iterates. The step then plans one write
   * per item into the same transaction, so a batch either lands whole or not at
   * all — the guarantee a caller looping over single writes cannot get.
   */
  forEach?: string;
  /**
   * Names the business context this step's new record *becomes an instance of*.
   *
   * Creating a context and its first membership in one transaction is otherwise
   * impossible: the membership record is scoped to a context instance that did
   * not exist when the transaction began, so the object-scope gate refuses it,
   * and the context is left with no members and therefore no way in. Declaring
   * this puts the new instance in reach **for the rest of this transaction
   * only**. It reaches no context that already existed, so it cannot hand a
   * caller anything they did not just create.
   */
  establishesContext?: string;
}

export interface ResolvedCommandUpdateStep {
  name: string;
  action: "update";
  object: string;
  authority: CommandStepAuthority;
  recordId: ResolvedCommandValueExpression;
  patch: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
  /** See {@link ResolvedCommandCreateStep.forEach}. */
  forEach?: string;
}

export type ResolvedCommandValueExpression =
  | { kind: "literal"; value: JsonValue }
  | { kind: "input"; name: string }
  | { kind: "runtime"; property: CommandRuntimeProperty }
  | { kind: "stepField"; step: string; field: string }
  | { kind: "stepMeta"; step: string; property: CommandStepMetaProperty }
  /** The current item of an iterating step, or one of its fields. */
  | { kind: "item"; field?: string }
  /** The current item's zero-based position in the list. */
  | { kind: "itemIndex" };

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
  colorStatusEvent: string;
  colorStatusAlternate: string;
  colorStatusAvailable: string;
  colorStatusUnavailable: string;
  colorStatusBusyElsewhere: string;
  colorStatusConflict: string;
  colorStatusUnset: string;
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
  /**
   * Set when the write the authority refused was this record's own create, so
   * the authority never accepted this record and holds nothing the device would
   * be destroying by throwing the row away. That is what licenses a local
   * discard; removing a row whose *update* was refused would instead delete
   * something the authority still has and the next bootstrap would restore.
   *
   * Only the authority spends it — by accepting the operation, or by producing a
   * record under that id. The second case matters: a collision is refused
   * *because* the id already names a record the authority holds, and the
   * reconciliation that discloses that record ends the licence, because
   * discarding the row would then remove the authority's record rather than the
   * user's refused work. A local write does not spend it: editing a refused
   * create does not give the authority a copy.
   *
   * Device-local bookkeeping. It is deliberately not a declared `_`-metadata
   * field: a model has no business addressing it, and unlike `_syncStatus` it
   * describes the last verdict rather than the record's state.
   */
  syncRejectedCreate?: boolean;
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
  commandName?: string;
  commandLabel?: string;
  commandStep?: string;
  commandTransactionId?: string;
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

/**
 * One record a locally executed command created, and the id the device already
 * holds for it.
 *
 * A command intent is re-executed by the authority, so without this every record
 * it creates would be named server-side and arrive as a second row beside the
 * one the device is already showing — the Phase 48 duplication defect, returned
 * by a different route. The step name and item index are carried because a
 * `FOR EACH` step writes one record per item, so "the id for step N" is really
 * "the id for item M of step N", and an id adopted against the wrong write would
 * be worse than one that was never supplied.
 *
 * Only creates appear here. An update step names an existing record through its
 * own `ID` expression, and any such expression that reaches for a created
 * record's id resolves to the adopted id for free.
 */
export interface LocalCommandRecordId {
  step: string;
  /** Present only for a step that iterates: which item of that step this id names. */
  itemIndex?: number;
  objectName: string;
  recordId: string;
}

/**
 * A model-declared command as one queued unit of work.
 *
 * The input rather than the resulting writes is what crosses the wire: the
 * authority re-executes the command so that policy, validation, lifecycle,
 * scope, constraints and preconditions all run server-side exactly as they ran
 * locally. The ids are a name for what that re-execution produces, never an
 * authorisation for producing it.
 */
export interface LocalCommandOperation {
  name: string;
  label?: string;
  input: Record<string, JsonValue>;
  /** In planned order, so re-execution can match each id to the write it names. */
  recordIds: LocalCommandRecordId[];
  /** Every record the command wrote, so a verdict can be reported over all of them. */
  records: Array<{ objectName: string; recordId: string }>;
}

/**
 * One record write inside a batched transaction, as the authority must be told
 * about it.
 *
 * A create carries the id the device already minted, for the same reason a
 * create intent does: an authority-minted id would come back naming a record the
 * device does not have. An update or delete carries the revision it was planned
 * against, so a stale write is a visible conflict rather than a silent
 * overwrite.
 */
export interface LocalBatchWrite {
  operation: "create" | "update" | "delete";
  objectName: string;
  recordId: string;
  /** Present for a create: the values the record was created with locally. */
  values?: Record<string, JsonValue>;
  /** Present for an update: the fields the caller asked to change. */
  patch?: Record<string, JsonValue>;
  /** Present for an update or delete: the revision the write was planned against. */
  baseRevision?: string;
}

/**
 * An ad-hoc multi-record transaction as one queued unit of work.
 *
 * Unlike a command, there is no model declaration to re-execute, so the writes
 * themselves cross the wire in planned order. That is not a licence: the
 * authority applies each one through the ordinary runtime write path, so every
 * policy, validation, lifecycle, scope and constraint check runs server-side
 * exactly as it ran on the device — and, because they run inside one authority
 * transaction, a batch that fails at any write lands none of them.
 */
export interface LocalBatchOperation {
  /** What produced the batch, for local history and operator-facing surfaces. */
  label?: string;
  /**
   * The wire payload: the writes the caller *requested*, which is what the
   * authority is told about. A write the platform derived — an ordered-collection
   * shift — is deliberately absent, because the authority re-derives it from the
   * same constraint and being told about it twice would apply it twice.
   */
  writes: LocalBatchWrite[];
  /**
   * Every record the transaction wrote, derived writes included, so a verdict can
   * be reported over all of them.
   *
   * Separate from `writes` for exactly the reason a command's `records` is
   * separate from its `recordIds`: the wire payload and the record-coverage list
   * answer different questions. Deriving coverage from `writes` left the siblings
   * an ordered-collection shift moved reporting `pending` for ever after a
   * refusal — waiting on an answer that nothing queued could ever give.
   */
  records: Array<{ objectName: string; recordId: string }>;
}

export interface LocalOperation {
  opId: string;
  object: string;
  recordId: string;
  baseRevision?: string;
  operation: LocalOperationKind;
  patch?: Record<string, JsonValue>;
  commandName?: string;
  commandLabel?: string;
  commandStep?: string;
  commandTransactionId?: string;
  /**
   * Present only when `operation` is `"command"`: the whole command, queued as
   * one entry. The per-step writes are still recorded in the operation log for
   * local history; they are simply not queued separately, because the authority
   * has to be told about the transaction rather than about its pieces.
   */
  command?: LocalCommandOperation;
  /**
   * Present only when `operation` is `"batch"`: every write of an ad-hoc
   * transaction, queued as one entry. As with a command, the per-record writes
   * are still recorded in the operation log for local history and are simply not
   * queued separately.
   */
  batch?: LocalBatchOperation;
  /**
   * The business contexts selected when this operation executed.
   *
   * Replay used to read the selection in force when the queue drained, so a
   * queue drained after the user switched contexts — or after a reload — replayed
   * writes against a selection that was not in force when they were made. The
   * selection belongs to the operation, not to the moment it is sent.
   *
   * An empty object means nothing was selected, which is a selection and is
   * replayed as one. Absent means the entry was queued before operations began
   * carrying this, and only such an entry falls back to the drain-time
   * selection — the old behaviour, for exactly the entries written under it.
   */
  selectedContexts?: Record<string, string>;
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
  shell?: PartialShellModel;
  roles?: PartialRoleModel[];
  contexts?: PartialBusinessContextModel[];
  objects: PartialObjectModel[];
  readModels?: PartialReadModelModel[];
  decisionTables?: PartialDecisionTableModel[];
  commands?: PartialCommandModel[];
  policies?: PartialPolicyModel[];
  themes?: PartialThemeModel[];
  sync?: PartialSyncPolicyModel[];
  migrations?: PartialModelMigrationModel[];
}

export interface PartialModelMigrationModel {
  from: string;
  to: string;
  objects?: PartialModelMigrationObjectModel[];
}

export interface PartialModelMigrationObjectModel {
  object: string;
  schemaVersion?: number;
  steps?: ResolvedModelMigrationStep[];
}

export interface PartialAppModel {
  name: string;
  startView?: string;
  theme?: string;
  offlineGraceDays?: number;
}

export interface PartialShellModel {
  nav?: PartialShellNavigationModel;
  topBar?: PartialShellTopBarModel;
  navDrawer?: PartialShellNavDrawerModel;
  controls?: PartialShellControlModel[];
}

export interface PartialShellNavDrawerModel {
  title?: string;
  controls?: string[];
}

export interface PartialShellNavigationModel {
  items?: PartialShellNavItemModel[];
}

export interface PartialShellNavItemModel {
  name?: string;
  view: string;
  label?: string;
  icon?: string;
  group?: string;
  order?: number;
  activeWhen?: string[];
  visibility?: PartialShellVisibilityModel;
}

export interface PartialShellVisibilityModel {
  kind?: ShellVisibilityKind;
  context?: string;
}

export interface PartialShellTopBarModel {
  contextSelector?: ShellContextSelectorPlacement;
  mobileContextSelector?: ShellMobileContextSelectorMode;
  controls?: string[];
}

export interface PartialShellControlModel {
  name: string;
  kind: ShellControlKind;
  label?: string;
  icon?: string;
  placement?: ShellControlPlacement;
  visibility?: PartialShellVisibilityModel;
  context?: string;
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
  grants?: PartialContextGrantModel[];
}

export interface PartialContextGrantModel {
  name: string;
  object: string;
  userField: string;
  contextField: string;
  condition?: PartialPolicyConditionModel;
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
  reorder?: OrderedCollectionReorder;
  compaction?: OrderedCollectionCompaction;
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
  contextMember?: ResolvedContextMemberPrincipal;
}

export interface PartialViewModel {
  name: string;
  object?: string;
  kind: ViewKind;
  context?: PartialViewContextModel;
  readModel?: string;
  editContainer?: EditContainerMode;
  fields?: string[];
  searchFields?: string[];
  sort?: ResolvedSort[];
  actions?: string[];
  editSections?: PartialEditSectionModel[];
  presentation?: PartialViewPresentationModel;
}

export interface PartialViewContextModel {
  mode: ViewContextMode;
  context?: string;
}

export type PartialEditSectionModel =
  | PartialEditFieldsSectionModel
  | PartialEditChildCollectionSectionModel;

export interface PartialEditSectionBaseModel {
  name: string;
  kind: EditSectionKind;
  heading?: string;
}

export interface PartialEditFieldsSectionModel extends PartialEditSectionBaseModel {
  kind: "fields";
  fields?: string[];
}

export interface PartialEditChildCollectionSectionModel extends PartialEditSectionBaseModel {
  kind: "childCollection";
  childObject: string;
  parentField: string;
  childView?: string;
  operations?: EditChildOperationKind[];
  staged?: boolean;
  orderField?: string;
  emptyState?: PartialEditChildCollectionEmptyStateModel;
  picker?: PartialRelationshipPickerModel;
}

export interface PartialEditChildCollectionEmptyStateModel {
  text?: string;
}

export interface PartialRelationshipPickerModel {
  name?: string;
  sourceKind?: RelationshipPickerSourceKind;
  source?: string;
  candidateField?: string;
  selection?: RelationshipPickerSelectionMode;
  displayFields?: string[];
  searchFields?: string[];
  sort?: ResolvedSort[];
  excludeAlreadyLinked?: boolean;
  emptyState?: PartialRelationshipPickerEmptyStateModel;
}

export interface PartialRelationshipPickerEmptyStateModel {
  text?: string;
}

export interface PartialViewPresentationModel {
  layout?: PresentationLayout;
  density?: PresentationDensity;
  state?: PartialPresentationStateModel[];
  iconMaps?: PartialPresentationIconMapModel[];
  statuses?: PartialPresentationStatusModel[];
  statusMaps?: PartialPresentationStatusMapModel[];
  legends?: PartialPresentationLegendModel[];
  sections?: PartialPresentationSectionModel[];
  shell?: PartialPresentationShellModel;
}

export interface PartialPresentationStateModel {
  name: string;
  type?: PresentationStateType;
  defaultValue?: JsonValue;
  persistence?: PresentationStatePersistence;
}

export interface PartialPresentationIconMapModel {
  name: string;
  field: string;
  values?: PartialPresentationIconMapValueModel[];
  defaultIcon?: string;
}

export interface PartialPresentationIconMapValueModel {
  value: JsonPrimitive;
  icon: string;
}

export interface PartialPresentationStatusModel {
  name: string;
  label?: string;
  accessibleLabel?: string;
  icon?: PartialPresentationIconRefModel;
  themeToken?: PresentationStatusThemeToken;
  precedence?: number;
}

export interface PartialPresentationStatusMapModel {
  name: string;
  field: string;
  values?: PartialPresentationStatusMapValueModel[];
  defaultStatus?: string;
}

export interface PartialPresentationStatusMapValueModel {
  value: JsonPrimitive;
  status: string;
}

export interface PartialPresentationLegendModel {
  name: string;
  title?: string;
  statuses?: string[];
  include?: PresentationLegendInclude;
}

export interface PartialPresentationSectionModel {
  name: string;
  heading?: string;
  layout?: PresentationLayout;
  density?: PresentationDensity;
  controls?: PartialPresentationControlModel[];
  lists?: PartialPresentationListModel[];
  matrices?: PartialPresentationMatrixModel[];
  calendars?: PartialPresentationCalendarModel[];
}

export type PartialPresentationControlModel =
  | PartialPresentationToggleControlModel
  | PartialPresentationSelectControlModel
  | PartialPresentationActionControlModel
  | PartialPresentationContextSelectorControlModel;

export interface PartialPresentationControlBaseModel {
  name: string;
  kind: PresentationControlKind;
  label?: string;
  icon?: PartialPresentationIconRefModel;
}

export interface PartialPresentationToggleControlModel extends PartialPresentationControlBaseModel {
  kind: "toggle";
  state: string;
}

export interface PartialPresentationSelectControlModel extends PartialPresentationControlBaseModel {
  kind: "select";
  state: string;
  options?: PartialPresentationSelectOptionModel[];
}

export interface PartialPresentationSelectOptionModel {
  value: JsonPrimitive;
  label: string;
  icon?: PartialPresentationIconRefModel;
}

export interface PartialPresentationActionControlModel extends PartialPresentationControlBaseModel {
  kind: "action";
  placement?: PresentationActionPlacement;
  command?: string;
  view?: string;
  create?: PartialPresentationCreateTargetModel;
  input?: Record<string, ResolvedExpression>;
  visibleWhen?: PartialPolicyConditionModel;
}

export interface PartialPresentationCreateTargetModel {
  object?: string;
  view?: string;
}

export interface PartialPresentationContextSelectorControlModel
  extends PartialPresentationControlBaseModel {
  kind: "contextSelector";
  context?: string;
}

export interface PartialPresentationListModel {
  name: string;
  sourceKind?: PresentationListSourceKind;
  source: string;
  renderAs?: PresentationListRenderStyle;
  density?: PresentationDensity;
  fields?: string[];
  sort?: ResolvedSort[];
  filter?: PartialPolicyConditionModel;
  emptyState?: PartialPresentationEmptyStateModel;
  status?: PartialPresentationStatusBindingModel;
  actions?: PartialPresentationActionControlModel[];
  row?: PartialPresentationRowTemplateModel;
}

export interface PartialPresentationMatrixModel {
  name: string;
  density?: PresentationDensity;
  rowSource: PartialPresentationMatrixAxisSourceModel;
  columnAxis: PartialPresentationMatrixDateColumnAxisModel;
  cellSource: PartialPresentationMatrixCellSourceModel;
  cell?: PartialPresentationMatrixCellModel;
  edit?: PartialPresentationMatrixEditModel;
}

export interface PartialPresentationMatrixAxisSourceModel {
  sourceKind?: PresentationMatrixSourceKind;
  source: string;
  keyField?: string;
  labelField: string;
  fields?: string[];
  sort?: ResolvedSort[];
}

export interface PartialPresentationMatrixDateColumnAxisModel {
  kind?: PresentationMatrixColumnKind;
  start: string;
  end: string;
  stepDays?: number;
  labelFormat?: PartialPresentationFormatModel;
}

export interface PartialPresentationMatrixCellSourceModel {
  sourceKind?: PresentationMatrixSourceKind;
  source: string;
  rowField: string;
  columnField: string;
  fields?: string[];
  status?: PartialPresentationStatusBindingModel;
  recordSource?: string;
}

export interface PartialPresentationMatrixCellModel {
  status?: PartialPresentationStatusBindingModel;
  unsetStatus?: string;
  accessibleLabel?: string;
}

export interface PartialPresentationMatrixEditModel {
  object: string;
  rowField: string;
  columnField: string;
  valueField: string;
  cycle?: JsonPrimitive[];
  unsetValue?: JsonPrimitive | null;
  unsetAsAbsence?: boolean;
  bulkBehavior?: PresentationMatrixBulkBehavior;
}

export interface PartialPresentationCalendarModel {
  name: string;
  density?: PresentationDensity;
  sourceKind?: PresentationCalendarSourceKind;
  source: string;
  dateField: string;
  titleField?: string;
  summaryFields?: string[];
  fields?: string[];
  sort?: ResolvedSort[];
  month?: PartialPresentationCalendarMonthModel;
  status?: PartialPresentationStatusBindingModel;
  actions?: PartialPresentationActionControlModel[];
  emptyState?: PartialPresentationEmptyStateModel;
}

export interface PartialPresentationCalendarMonthModel {
  value?: string;
  state?: string;
  weekStart?: PresentationCalendarWeekStart;
  minDate?: string;
  maxDate?: string;
  labelFormat?: PartialPresentationFormatModel;
}

export interface PartialPresentationStatusBindingModel {
  candidates?: PartialPresentationStatusCandidateModel[];
}

export type PartialPresentationStatusCandidateModel =
  | { kind: "status"; status: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };

export interface PartialPresentationEmptyStateModel {
  text?: string;
  icon?: PartialPresentationIconRefModel;
}

export interface PartialPresentationRowTemplateModel {
  layout?: PresentationRowLayout;
  density?: PresentationDensity;
  fragments?: PartialPresentationRowFragmentModel[];
}

export type PartialPresentationRowFragmentModel =
  | PartialPresentationLiteralTextFragmentModel
  | PartialPresentationFieldTextFragmentModel
  | PartialPresentationIconFragmentModel
  | PartialPresentationConditionalFragmentModel;

export interface PartialPresentationLiteralTextFragmentModel {
  kind: "text";
  text: string;
  style?: PresentationFragmentStyle;
}

export interface PartialPresentationFieldTextFragmentModel {
  kind: "field";
  field: string;
  style?: PresentationFragmentStyle;
  format?: PartialPresentationFormatModel;
  fallback?: string;
}

export interface PartialPresentationIconFragmentModel {
  kind: "icon";
  icon: PartialPresentationIconRefModel;
  label?: string;
}

export interface PartialPresentationConditionalFragmentModel {
  kind: "conditional";
  when: PartialPolicyConditionModel;
  fragments?: PartialPresentationRowFragmentModel[];
}

export interface PartialPresentationFormatModel {
  kind: PresentationFormatKind;
  pattern?: string;
}

export type PartialPresentationIconRefModel =
  | { kind: "named"; name: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };

export interface PartialPresentationShellModel {
  regions?: PartialPresentationShellRegionModel[];
}

export interface PartialPresentationShellRegionModel {
  region: PresentationShellRegion;
  title?: string;
  controls?: string[];
}

export interface PartialReadModelModel {
  name: string;
  context?: PartialViewContextModel;
  strategy?: ReadModelStrategy;
  sources: PartialReadModelSourceModel[];
  fields: PartialReadModelFieldModel[];
  sort?: ResolvedSort[];
}

export interface PartialReadModelSourceModel {
  name?: string;
  object: string;
  scope?: ReadModelSourceScope;
  join?: PartialReadModelSourceJoinModel;
}

export interface PartialReadModelSourceJoinModel {
  source: string;
  localField: string;
  sourceField: string;
  cardinality?: ReadModelJoinCardinality;
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
  repeated?: boolean;
  itemFields?: PartialCommandInputItemFieldModel[];
}

export interface PartialCommandInputItemFieldModel {
  name: string;
  type?: FieldType;
  required?: boolean;
}

export type PartialCommandStepModel = PartialCommandCreateStepModel | PartialCommandUpdateStepModel;

export interface PartialCommandCreateStepModel {
  name: string;
  action: "create";
  object: string;
  authority?: CommandStepAuthority;
  values?: Record<string, ResolvedCommandValueExpression>;
  preconditions?: PartialPolicyConditionModel[];
  forEach?: string;
  establishesContext?: string;
}

export interface PartialCommandUpdateStepModel {
  name: string;
  action: "update";
  object: string;
  authority?: CommandStepAuthority;
  recordId: ResolvedCommandValueExpression;
  patch?: Record<string, ResolvedCommandValueExpression>;
  preconditions?: PartialPolicyConditionModel[];
  forEach?: string;
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
