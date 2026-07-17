import type {
  ConflictStrategy,
  FieldType,
  JsonValue,
  PolicyAction,
  PolicyEffect,
  ResolvedExpression,
  ResolvedCommandValueExpression,
  RuntimeChannel,
  SyncMode,
  SyncScope,
  ThemeDensity,
  ThemeNav,
  ThemeRadius,
  ValidatorKind,
  ViewKind,
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
  | "STEP";

export interface EndMarkerNode {
  kind: "EndMarker";
  name: BlockName;
  range: SourceRange;
}

export interface AdlDocumentAst {
  kind: "AdlDocument";
  app: AppDeclarationAst;
  roles: RoleDeclarationAst[];
  objects: ObjectDeclarationAst[];
  decisionTables: DecisionTableDeclarationAst[];
  commands: CommandDeclarationAst[];
  policies: PolicyDeclarationAst[];
  themes: ThemeDeclarationAst[];
  sync: SyncDeclarationAst[];
  range: SourceRange;
}

export interface AppDeclarationAst {
  kind: "AppDeclaration";
  name: string;
  theme?: string;
  startView?: string;
  end: EndMarkerNode;
  range: SourceRange;
}

export interface RoleDeclarationAst {
  kind: "RoleDeclaration";
  name: string;
  inherits: string[];
  description?: string;
  range: SourceRange;
}

export interface ObjectDeclarationAst {
  kind: "ObjectDeclaration";
  name: string;
  businessKey?: string;
  displayField?: string;
  fields: FieldDeclarationAst[];
  validations: ObjectValidationDeclarationAst[];
  lifecycle?: LifecycleDeclarationAst;
  views: ViewDeclarationAst[];
  sync?: SyncDeclarationAst;
  policyRefs: string[];
  end: EndMarkerNode;
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
  fields: string[];
  searchFields: string[];
  sort: SortDeclarationAst[];
  actions: string[];
  end: EndMarkerNode;
  range: SourceRange;
}

export interface SortDeclarationAst {
  kind: "SortDeclaration";
  field: string;
  direction: "asc" | "desc";
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
  match?: "everyone" | "authenticated" | "anonymous" | "owner" | "specific";
  roles: string[];
  groupRoles: string[];
  users: string[];
  owner: boolean;
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
  | "radius"
  | "density"
  | "nav"
  | "fontFamily"
  | "logoUrl";

export interface SyncDeclarationAst {
  kind: "SyncDeclaration";
  object?: string;
  mode: SyncMode;
  scope?: SyncScope;
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
  type: FieldType;
  required: boolean;
  defaultValue?: JsonValue;
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
  action: "create" | "update";
  object: string;
  authority?: "caller" | "command";
  recordId?: ResolvedCommandValueExpression;
  values: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
  end: EndMarkerNode;
  range: SourceRange;
}
