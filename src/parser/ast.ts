import type {
  ConflictStrategy,
  EditChildOperationKind,
  EditContainerMode,
  FieldType,
  JsonValue,
  JsonPrimitive,
  PresentationDensity,
  PresentationFormatKind,
  PresentationFragmentStyle,
  PresentationCalendarSourceKind,
  PresentationCalendarWeekStart,
  PresentationLegendInclude,
  PresentationLayout,
  PresentationActionPlacement,
  PresentationListRenderStyle,
  PresentationListSourceKind,
  PresentationRowLayout,
  PresentationStatusThemeToken,
  PresentationStatePersistence,
  PresentationStateType,
  OrderedCollectionCompaction,
  OrderedCollectionReorder,
  PolicyAction,
  PolicyEffect,
  ReadModelJoinCardinality,
  ReadModelSourceScope,
  ReadModelStrategy,
  RelationshipPickerSelectionMode,
  RelationshipPickerSourceKind,
  ResolvedContextMemberPrincipal,
  ResolvedExpression,
  ResolvedCommandValueExpression,
  RuntimeChannel,
  ShellContextSelectorPlacement,
  ShellControlKind,
  ShellControlPlacement,
  ShellMobileContextSelectorMode,
  ShellVisibilityKind,
  SyncMode,
  SyncScope,
  ContextSelectionMode,
  ContextSelectionPersistence,
  ContextSelectionSource,
  ThemeDensity,
  ThemeNav,
  ThemeRadius,
  ValidatorKind,
  ViewKind,
  ViewContextMode,
} from "../model/resolved-model.js";

export interface SourcePosition {
  line: number;
  column: number;
  offset: number;
}

export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

export type BlockName =
  | "APP"
  | "OBJECT"
  | "LIFECYCLE"
  | "ACTION"
  | "VIEW"
  | "POLICY"
  | "THEME"
  | "DECISION_TABLE"
  | "COMMAND"
  | "STEP"
  | "INPUT"
  | "READ_MODEL"
  | "SECTION"
  | "TOGGLE"
  | "LIST"
  | "CALENDAR"
  | "ROW"
  | "ICON_MAP"
  | "STATUS_MAP"
  | "MIGRATION"
  | "SHELL"
  | "EDIT_SECTION"
  | "CHILD_COLLECTION"
  | "PICKER";

export interface EndMarkerNode {
  kind: "EndMarker";
  name: BlockName;
  range: SourceRange;
}

export interface AdlDocumentAst {
  kind: "AdlDocument";
  app: AppDeclarationAst;
  shell?: ShellDeclarationAst;
  roles: RoleDeclarationAst[];
  contexts: BusinessContextDeclarationAst[];
  contextGrants: ContextGrantDeclarationAst[];
  objects: ObjectDeclarationAst[];
  readModels: ReadModelDeclarationAst[];
  decisionTables: DecisionTableDeclarationAst[];
  commands: CommandDeclarationAst[];
  policies: PolicyDeclarationAst[];
  themes: ThemeDeclarationAst[];
  sync: SyncDeclarationAst[];
  migrations: MigrationDeclarationAst[];
  /**
   * Every use of a deprecated-but-still-accepted spelling encountered while
   * parsing this document (a bare modifier value where parentheses are now
   * canonical, an alias keyword, a dotted `X.Y` spelling of an `X_Y`
   * keyword, or an omitted `WHEN`). The parser never refuses these — see
   * Phase 72 — `compileAdl` turns each into a warning-severity
   * `ADL_STYLE_DEPRECATED_SPELLING` diagnostic.
   */
  styleWarnings: StyleWarningAst[];
  range: SourceRange;
}

export interface StyleWarningAst {
  /** What construct this deprecated spelling was used on, e.g. "FIELD MIN value". */
  construct: string;
  /** The spelling actually written. */
  deprecated: string;
  /** The spelling that should be used instead going forward. */
  canonical: string;
  range: SourceRange;
}

export interface MigrationDeclarationAst {
  kind: "MigrationDeclaration";
  from: string;
  to: string;
  objects: MigrationObjectDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface MigrationObjectDeclarationAst {
  kind: "MigrationObjectDeclaration";
  object: string;
  schemaVersion?: number;
  steps: MigrationStepAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export type MigrationStepAst =
  | { kind: "renameField"; from: string; to: string; range: SourceRange }
  | { kind: "addField"; field: string; defaultValue: JsonValue; range: SourceRange }
  | { kind: "dropField"; field: string; range: SourceRange };

export interface AppDeclarationAst {
  kind: "AppDeclaration";
  name: string;
  theme?: string;
  startView?: string;
  /** Declared by `MODEL_VERSION "<dotted number>"`. */
  modelVersion?: string;
  /** Declared by `OFFLINE_GRACE <days> DAYS`; the unit word is required. */
  offlineGraceDays?: number;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface ShellDeclarationAst {
  kind: "ShellDeclaration";
  navItems: ShellNavItemDeclarationAst[];
  controls: ShellControlDeclarationAst[];
  topBar?: ShellTopBarDeclarationAst;
  navDrawer?: ShellNavDrawerDeclarationAst;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface ShellNavItemDeclarationAst {
  kind: "ShellNavItemDeclaration";
  name?: string;
  view: string;
  label?: string;
  icon?: string;
  group?: string;
  order?: number;
  activeWhen: string[];
  visibility?: ShellVisibilityDeclarationAst;
  range: SourceRange;
}

export interface ShellVisibilityDeclarationAst {
  kind: ShellVisibilityKind;
  context?: string;
}

export interface ShellControlDeclarationAst {
  kind: "ShellControlDeclaration";
  name: string;
  controlKind: ShellControlKind;
  label?: string;
  icon?: string;
  placement?: ShellControlPlacement;
  visibility?: ShellVisibilityDeclarationAst;
  context?: string;
  range: SourceRange;
}

export interface ShellTopBarDeclarationAst {
  kind: "ShellTopBarDeclaration";
  contextSelector?: ShellContextSelectorPlacement;
  mobileContextSelector?: ShellMobileContextSelectorMode;
  controls?: string[];
  range: SourceRange;
}

/**
 * `NAV_DRAWER TITLE 'Giggle Band' CONTROLS themeSwitch logout`, symmetrical with
 * {@link ShellTopBarDeclarationAst}.
 *
 * `controls` stays optional rather than defaulting to an empty array: an absent
 * `CONTROLS` clause must let resolution fall back to the controls that declared
 * `PLACEMENT navDrawer`, whereas an empty list would mean "render none".
 */
export interface ShellNavDrawerDeclarationAst {
  kind: "ShellNavDrawerDeclaration";
  title?: string;
  controls?: string[];
  range: SourceRange;
}

export interface RoleDeclarationAst {
  kind: "RoleDeclaration";
  name: string;
  inherits: string[];
  description?: string;
  range: SourceRange;
}

export interface BusinessContextDeclarationAst {
  kind: "BusinessContextDeclaration";
  name: string;
  object?: string;
  selection?: ContextSelectionDeclarationAst;
  membership?: ContextMembershipDeclarationAst;
  range: SourceRange;
}

export interface ContextSelectionDeclarationAst {
  mode?: ContextSelectionMode;
  autoSelect?: boolean;
  persistence?: ContextSelectionPersistence;
  source?: ContextSelectionSource;
  routeParam?: string;
}

/**
 * `CONTEXT_GRANT pendingBandInvitation ON Band OBJECT BandInvitation USER Invitee CONTEXT_FIELD Band WHEN Status == 'Pending'`
 *
 * Declared at top level rather than inside `CONTEXT` because a grant names an
 * object the context declaration itself never mentions, and there may be several
 * of them; `ON` says which context the grant attaches to.
 */
export interface ContextGrantDeclarationAst {
  kind: "ContextGrantDeclaration";
  name: string;
  /** The business context this grant reaches, named by the `ON` clause. */
  context: string;
  object: string;
  userField: string;
  contextField: string;
  condition?: ResolvedExpression;
  range: SourceRange;
}

export interface ContextMembershipDeclarationAst {
  object: string;
  userField: string;
  contextField: string;
  roleField: string;
  roles: string[];
}

export interface ObjectDeclarationAst {
  kind: "ObjectDeclaration";
  name: string;
  businessKey?: string;
  displayField?: string;
  /** Declared by `SCHEMA_VERSION <n>`; defaults to 1 when absent. */
  schemaVersion?: number;
  fields: FieldDeclarationAst[];
  computedFields: ComputedFieldDeclarationAst[];
  scope?: ObjectScopeDeclarationAst;
  constraints: ObjectConstraintDeclarationAst[];
  validations: ObjectValidationDeclarationAst[];
  lifecycle?: LifecycleDeclarationAst;
  views: ViewDeclarationAst[];
  sync?: SyncDeclarationAst;
  policyRefs: string[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface ObjectScopeDeclarationAst {
  kind: "ObjectScopeDeclaration";
  context: string;
  field: string;
  range: SourceRange;
}

export type ObjectConstraintDeclarationAst =
  | UniqueObjectConstraintDeclarationAst
  | OrderedObjectConstraintDeclarationAst
  | ProtectedRoleObjectConstraintDeclarationAst;

export interface UniqueObjectConstraintDeclarationAst {
  kind: "UniqueObjectConstraintDeclaration";
  name: string;
  fields: string[];
  scopeFields: string[];
  range: SourceRange;
}

export interface OrderedObjectConstraintDeclarationAst {
  kind: "OrderedObjectConstraintDeclaration";
  name: string;
  parentField: string;
  positionField: string;
  scopeFields: string[];
  minPosition?: number;
  /** `REORDER strict|shift`; absent leaves the resolved default (`strict`). */
  reorder?: OrderedCollectionReorder;
  /** `COMPACT none|onDelete`; absent leaves the resolved default (`none`). */
  compaction?: OrderedCollectionCompaction;
  range: SourceRange;
}

/**
 * `PROTECTED_ROLE` guards a privileged role within a scope: it refuses a
 * delete or an update that would leave fewer than `minCount` active records
 * whose `roleField` holds one of `roleValues` within the same `scopeFields`
 * key. This is the "last admin standing" guard — declared once on a
 * membership-shaped object, it applies to every write path (direct CRUD and
 * command steps) that reaches it.
 */
export interface ProtectedRoleObjectConstraintDeclarationAst {
  kind: "ProtectedRoleObjectConstraintDeclaration";
  name: string;
  scopeFields: string[];
  roleField: string;
  roleValues: JsonValue[];
  /** `MIN <n>`; absent leaves the resolved default (`1`). */
  minCount?: number;
  range: SourceRange;
}

export interface ObjectValidationDeclarationAst {
  kind: "ObjectValidationDeclaration";
  name: string;
  expression: ResolvedExpression;
  message?: string;
  range: SourceRange;
}

export interface FieldDeclarationAst {
  kind: "FieldDeclaration";
  name: string;
  type: FieldType;
  required: boolean;
  defaultValue?: JsonValue;
  validators: ValidatorDeclarationAst[];
  readonly: boolean;
  hidden: boolean;
  lookup?: LookupDeclarationAst;
  autoId?: AutoIdDeclarationAst;
  range: SourceRange;
}

export interface ComputedFieldDeclarationAst {
  kind: "ComputedFieldDeclaration";
  name: string;
  type: FieldType;
  expression: ResolvedExpression;
  range: SourceRange;
}

export interface ValidatorDeclarationAst {
  kind: "ValidatorDeclaration";
  validatorKind: ValidatorKind;
  value?: JsonValue;
  expression?: ResolvedExpression;
  message?: string;
  range: SourceRange;
}

export interface LookupDeclarationAst {
  kind: "LookupDeclaration";
  targetObject: string;
  targetField?: string;
  displayField: string;
  range: SourceRange;
}

export interface AutoIdDeclarationAst {
  kind: "AutoIdDeclaration";
  prefix?: string;
  pad?: number;
  scopeField?: string;
  range: SourceRange;
}

export interface LifecycleDeclarationAst {
  kind: "LifecycleDeclaration";
  name: string;
  stateField?: string;
  initialState?: string;
  states: StateDeclarationAst[];
  actions: ActionDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface StateDeclarationAst {
  kind: "StateDeclaration";
  name: string;
  terminal: boolean;
  range: SourceRange;
}

export interface ActionDeclarationAst {
  kind: "ActionDeclaration";
  name: string;
  from: string[];
  to: string;
  label?: string;
  guards: LifecycleGuardDeclarationAst[];
  policyRefs: string[];
  allowRules: ActionAllowDeclarationAst[];
  hooks: HookRefsAst;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface LifecycleGuardDeclarationAst {
  kind: "LifecycleGuardDeclaration";
  name: string;
  expression: ResolvedExpression;
  message?: string;
  range: SourceRange;
}

export interface ActionAllowDeclarationAst {
  kind: "ActionAllowDeclaration";
  roles: string[];
  states: string[];
  range: SourceRange;
}

export interface HookRefsAst {
  before: string[];
  after: string[];
  onError: string[];
}

export interface ViewDeclarationAst {
  kind: "ViewDeclaration";
  name: string;
  viewKind: ViewKind;
  context?: ViewContextDeclarationAst;
  readModel?: string;
  editContainer?: EditContainerMode;
  fields: string[];
  searchFields: string[];
  sort: SortDeclarationAst[];
  actions: string[];
  /**
   * Authored edit sections, empty when the view declares none. An empty list is
   * not "no sections": resolution turns it into the default `fields` section
   * over `view.fields`, which is what every view has always had.
   */
  editSections: EditSectionDeclarationAst[];
  presentation?: ViewPresentationDeclarationAst;
  end: EndMarkerNode;
  range: SourceRange;
}

export type EditSectionDeclarationAst =
  | EditFieldsSectionDeclarationAst
  | EditChildCollectionDeclarationAst;

export interface EditFieldsSectionDeclarationAst {
  kind: "EditFieldsSectionDeclaration";
  name: string;
  heading?: string;
  /**
   * Omitted when the section declares no `FIELDS`, which resolves to the view's
   * own field list. That is a different statement from an empty list, which no
   * syntax can produce.
   */
  fields?: string[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface EditChildCollectionDeclarationAst {
  kind: "EditChildCollectionDeclaration";
  name: string;
  heading?: string;
  childObject: string;
  parentField: string;
  childView?: string;
  operations?: EditChildOperationKind[];
  staged?: boolean;
  orderField?: string;
  emptyText?: string;
  picker?: RelationshipPickerDeclarationAst;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface RelationshipPickerDeclarationAst {
  kind: "RelationshipPickerDeclaration";
  name: string;
  sourceKind?: RelationshipPickerSourceKind;
  source?: string;
  candidateField?: string;
  selection?: RelationshipPickerSelectionMode;
  displayFields: string[];
  searchFields: string[];
  sort: SortDeclarationAst[];
  excludeAlreadyLinked?: boolean;
  emptyText?: string;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface ViewPresentationDeclarationAst {
  kind: "ViewPresentationDeclaration";
  layout?: PresentationLayout;
  density?: PresentationDensity;
  state: PresentationStateDeclarationAst[];
  iconMaps: PresentationIconMapDeclarationAst[];
  statuses: PresentationStatusDeclarationAst[];
  statusMaps: PresentationStatusMapDeclarationAst[];
  legends: PresentationLegendDeclarationAst[];
  sections: PresentationSectionDeclarationAst[];
  range: SourceRange;
}

export interface PresentationStateDeclarationAst {
  kind: "PresentationStateDeclaration";
  name: string;
  type?: PresentationStateType;
  defaultValue?: JsonValue;
  persistence?: PresentationStatePersistence;
  range: SourceRange;
}

export interface PresentationIconMapDeclarationAst {
  kind: "PresentationIconMapDeclaration";
  name: string;
  field: string;
  values: PresentationIconMapValueDeclarationAst[];
  defaultIcon?: string;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface PresentationIconMapValueDeclarationAst {
  kind: "PresentationIconMapValueDeclaration";
  value: JsonPrimitive;
  icon: string;
  range: SourceRange;
}

export interface PresentationStatusDeclarationAst {
  kind: "PresentationStatusDeclaration";
  name: string;
  label?: string;
  accessibleLabel?: string;
  icon?: PresentationIconRefDeclarationAst;
  themeToken?: PresentationStatusThemeToken;
  precedence?: number;
  range: SourceRange;
}

export interface PresentationStatusMapDeclarationAst {
  kind: "PresentationStatusMapDeclaration";
  name: string;
  field: string;
  values: PresentationStatusMapValueDeclarationAst[];
  defaultStatus?: string;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface PresentationStatusMapValueDeclarationAst {
  kind: "PresentationStatusMapValueDeclaration";
  value: JsonPrimitive;
  status: string;
  range: SourceRange;
}

export interface PresentationLegendDeclarationAst {
  kind: "PresentationLegendDeclaration";
  name: string;
  title?: string;
  statuses: string[];
  include?: PresentationLegendInclude;
  range: SourceRange;
}

export interface PresentationSectionDeclarationAst {
  kind: "PresentationSectionDeclaration";
  name: string;
  heading?: string;
  layout?: PresentationLayout;
  density?: PresentationDensity;
  controls: PresentationControlDeclarationAst[];
  lists: PresentationListDeclarationAst[];
  calendars: PresentationCalendarDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export type PresentationControlDeclarationAst =
  | PresentationToggleControlDeclarationAst
  | PresentationActionControlDeclarationAst;

export interface PresentationToggleControlDeclarationAst {
  kind: "PresentationToggleControlDeclaration";
  name: string;
  state: string;
  label?: string;
  icon?: PresentationIconRefDeclarationAst;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface PresentationActionControlDeclarationAst {
  kind: "PresentationActionControlDeclaration";
  name: string;
  label?: string;
  icon?: PresentationIconRefDeclarationAst;
  placement?: PresentationActionPlacement;
  command?: string;
  view?: string;
  createObject?: string;
  createView?: string;
  input: PresentationActionInputDeclarationAst[];
  visibleWhen?: ResolvedExpression;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface PresentationActionInputDeclarationAst {
  kind: "PresentationActionInputDeclaration";
  name: string;
  expression: ResolvedExpression;
  range: SourceRange;
}

export interface PresentationListDeclarationAst {
  kind: "PresentationListDeclaration";
  name: string;
  sourceKind?: PresentationListSourceKind;
  source: string;
  renderAs?: PresentationListRenderStyle;
  density?: PresentationDensity;
  sort: SortDeclarationAst[];
  filter?: ResolvedExpression;
  emptyText?: string;
  statusCandidates: PresentationStatusCandidateDeclarationAst[];
  actions: PresentationActionControlDeclarationAst[];
  row?: PresentationRowTemplateDeclarationAst;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface PresentationCalendarDeclarationAst {
  kind: "PresentationCalendarDeclaration";
  name: string;
  sourceKind?: PresentationCalendarSourceKind;
  source: string;
  dateField?: string;
  titleField?: string;
  summaryFields: string[];
  fields: string[];
  sort: SortDeclarationAst[];
  density?: PresentationDensity;
  monthValue?: string;
  monthState?: string;
  weekStart?: PresentationCalendarWeekStart;
  minDate?: string;
  maxDate?: string;
  statusCandidates: PresentationStatusCandidateDeclarationAst[];
  actions: PresentationActionControlDeclarationAst[];
  emptyText?: string;
  end: EndMarkerNode;
  range: SourceRange;
}

export type PresentationStatusCandidateDeclarationAst =
  | { kind: "direct"; status: string; range: SourceRange }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive; range: SourceRange };

export interface PresentationRowTemplateDeclarationAst {
  kind: "PresentationRowTemplateDeclaration";
  layout?: PresentationRowLayout;
  density?: PresentationDensity;
  fragments: PresentationRowFragmentDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export type PresentationRowFragmentDeclarationAst =
  | PresentationLiteralTextFragmentDeclarationAst
  | PresentationFieldTextFragmentDeclarationAst
  | PresentationIconFragmentDeclarationAst;

export interface PresentationLiteralTextFragmentDeclarationAst {
  kind: "PresentationLiteralTextFragmentDeclaration";
  text: string;
  style?: PresentationFragmentStyle;
  range: SourceRange;
}

export interface PresentationFieldTextFragmentDeclarationAst {
  kind: "PresentationFieldTextFragmentDeclaration";
  field: string;
  style?: PresentationFragmentStyle;
  format?: PresentationFormatDeclarationAst;
  range: SourceRange;
}

export interface PresentationIconFragmentDeclarationAst {
  kind: "PresentationIconFragmentDeclaration";
  icon: PresentationIconRefDeclarationAst;
  label?: string;
  range: SourceRange;
}

export interface PresentationFormatDeclarationAst {
  kind: PresentationFormatKind;
  pattern?: string;
}

export type PresentationIconRefDeclarationAst =
  | { kind: "named"; name: string }
  | { kind: "map"; map: string; field?: string; value?: JsonPrimitive };

export interface ViewContextDeclarationAst {
  mode: ViewContextMode;
  context?: string;
}

export interface SortDeclarationAst {
  kind: "SortDeclaration";
  field: string;
  direction: "asc" | "desc";
  range: SourceRange;
}

export interface ReadModelDeclarationAst {
  kind: "ReadModelDeclaration";
  name: string;
  context?: ViewContextDeclarationAst;
  strategy?: ReadModelStrategy;
  sources: ReadModelSourceDeclarationAst[];
  fields: ReadModelFieldDeclarationAst[];
  sort: SortDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface ReadModelSourceDeclarationAst {
  kind: "ReadModelSourceDeclaration";
  name: string;
  object: string;
  scope?: ReadModelSourceScope;
  join?: ReadModelSourceJoinDeclarationAst;
  range: SourceRange;
}

/**
 * `JOIN member ON User == member.User CARDINALITY many`.
 *
 * The local side is a bare field on this source's object; the joined side is
 * qualified by the joined source's name so the hop reads the way it resolves.
 * Either side may be `id`, meaning the record's own identity rather than a
 * declared field.
 */
export interface ReadModelSourceJoinDeclarationAst {
  kind: "ReadModelSourceJoinDeclaration";
  source: string;
  localField: string;
  sourceField: string;
  cardinality?: ReadModelJoinCardinality;
  range: SourceRange;
}

export interface ReadModelFieldDeclarationAst {
  kind: "ReadModelFieldDeclaration";
  name: string;
  type?: FieldType;
  source?: string;
  field?: string;
  expression?: ResolvedExpression;
  range: SourceRange;
}

export interface PolicyDeclarationAst {
  kind: "PolicyDeclaration";
  name: string;
  object: string;
  rules: PolicyRuleDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface PolicyRuleDeclarationAst {
  kind: "PolicyRuleDeclaration";
  name: string;
  effect: PolicyEffect;
  action: PolicyAction;
  principal: PrincipalSelectorAst;
  state: string[];
  fields: string[];
  lifecycleAction?: string;
  condition?: ResolvedExpression;
  channels: RuntimeChannel[];
  range: SourceRange;
}

export interface PrincipalSelectorAst {
  match?: "everyone" | "authenticated" | "anonymous" | "owner" | "specific" | "contextMember";
  roles: string[];
  groupRoles: string[];
  users: string[];
  owner: boolean;
  /** Declared by `CONTEXT_MEMBER <Context> FIELD <field>`. */
  contextMember?: ResolvedContextMemberPrincipal;
}

export interface ThemeDeclarationAst {
  kind: "ThemeDeclaration";
  name: string;
  base?: string;
  tokens: ThemeTokenDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface ThemeTokenDeclarationAst {
  kind: "ThemeTokenDeclaration";
  token: ThemeTokenName;
  value: string | ThemeRadius | ThemeDensity | ThemeNav;
  range: SourceRange;
}

export type ThemeTokenName =
  | "colorPrimary"
  | "colorAccent"
  | "colorBackground"
  | "colorSurface"
  | "colorSurfaceAlt"
  | "colorText"
  | "colorTextMuted"
  | "colorTextInverted"
  | "colorBorder"
  | "colorDanger"
  | "colorSuccess"
  | "colorInfo"
  | "colorStatusEvent"
  | "colorStatusAlternate"
  | "colorStatusAvailable"
  | "colorStatusUnavailable"
  | "colorStatusBusyElsewhere"
  | "colorStatusConflict"
  | "colorStatusUnset"
  | "radius"
  | "density"
  | "nav"
  | "fontFamily"
  | "logoUrl";

export interface SyncWindowDeclarationAst {
  kind: "SyncWindowDeclaration";
  field?: string;
  days?: number;
  limit?: number;
  range: SourceRange;
}

export interface SyncDeclarationAst {
  kind: "SyncDeclaration";
  object?: string;
  mode: SyncMode;
  scope?: SyncScope;
  window?: SyncWindowDeclarationAst;
  predicate?: ResolvedExpression;
  conflict?: ConflictStrategy;
  range: SourceRange;
}

export interface DecisionTableDeclarationAst {
  kind: "DecisionTableDeclaration";
  name: string;
  object: string;
  match: "first" | "single";
  inputs: DecisionTableInputDeclarationAst[];
  rows: DecisionTableRowDeclarationAst[];
  defaultOutputs?: Record<string, JsonValue>;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface DecisionTableInputDeclarationAst {
  kind: "DecisionTableInputDeclaration";
  name: string;
  expression: ResolvedExpression;
  range: SourceRange;
}

export interface DecisionTableRowDeclarationAst {
  kind: "DecisionTableRowDeclaration";
  name: string;
  condition: ResolvedExpression;
  outputs: Record<string, JsonValue>;
  range: SourceRange;
}

export interface CommandDeclarationAst {
  kind: "CommandDeclaration";
  name: string;
  label?: string;
  inputs: CommandInputDeclarationAst[];
  preconditions: CommandPreconditionDeclarationAst[];
  steps: CommandStepDeclarationAst[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface CommandInputDeclarationAst {
  kind: "CommandInputDeclaration";
  name: string;
  /** For a repeated input this is the type of one *item*, not of the list. */
  type: FieldType;
  required: boolean;
  defaultValue?: JsonValue;
  /** Declared by `LIST`; the input then carries many values rather than one. */
  repeated: boolean;
  /**
   * The declared shape of one item, from the `LIST` block form. Empty means the
   * items are plain {@link CommandInputDeclarationAst.type} scalars.
   */
  itemFields: CommandInputItemFieldDeclarationAst[];
  end?: EndMarkerNode;
  range: SourceRange;
}

export interface CommandInputItemFieldDeclarationAst {
  kind: "CommandInputItemFieldDeclaration";
  name: string;
  type: FieldType;
  required: boolean;
  range: SourceRange;
}

export interface CommandPreconditionDeclarationAst {
  kind: "CommandPreconditionDeclaration";
  name: string;
  expression: ResolvedExpression;
  message?: string;
  range: SourceRange;
}

export interface CommandStepDeclarationAst {
  kind: "CommandStepDeclaration";
  name: string;
  action: "create" | "update" | "read";
  object: string;
  authority?: "caller" | "command";
  recordId?: ResolvedCommandValueExpression;
  /** Declared by `FOR EACH <inputName>`; names the repeated input to iterate. */
  forEach?: string;
  /** Declared by `ESTABLISHES CONTEXT <ContextName>`; create steps only. */
  establishesContext?: string;
  values: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
  end: EndMarkerNode;
  range: SourceRange;
}
