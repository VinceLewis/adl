/**
 * `.adlj`: a JSON-encoded ADL source format (Phase 73). `AdljSourceDocument`
 * mirrors `PartialApplicationModel` field-for-field — same top-level keys,
 * same arrays and optional fields — except every field that holds a
 * `ResolvedExpression` (or a union including one) as authored content is
 * typed `string` here instead: the identical infix expression syntax `.adl`
 * text already uses (`"EndDate >= StartDate"`), parsed as a leaf conversion
 * by `parseExpressionSource`. This is deliberate: nested `{"kind":"binary",
 * ...}` expression trees would be more error-prone to hand-author than one
 * infix line, working against the format's own purpose. JSON structure is
 * used everywhere else — the declarative skeleton — because that is where it
 * removes ambiguity that free text would otherwise carry.
 *
 * A `COMMAND STEP`'s `VALUE`/`SET`/`PATCH` assignments
 * (`ResolvedCommandValueExpression`) are the one expression-shaped surface
 * that stays JSON, not a string: unlike `VALIDATE`/`WHEN`/`WHERE`, that
 * vocabulary was never free-text infix syntax to begin with — `VALUE Owner
 * INPUT Owner` is already a small closed keyword grammar mapping cleanly onto
 * `{"kind":"input","name":"Owner"}` — so there is no ambiguity for JSON to
 * remove and no readability cost to leaving it structured.
 *
 * Every type here is derived from its `Partial*Model` counterpart with
 * `Omit`/intersection rather than hand-copied, so a new field added to the
 * `.adl` text pipeline appears here automatically; only the expression-typed
 * fields need to be named explicitly. See `docs/spec/adlj.md`.
 */
import type {
  PartialAppModel,
  PartialBusinessContextModel,
  PartialCommandModel,
  PartialCommandCreateStepModel,
  PartialCommandPreconditionModel,
  PartialCommandReadStepModel,
  PartialCommandUpdateStepModel,
  PartialComputedFieldModel,
  PartialContextGrantModel,
  PartialDecisionTableInputModel,
  PartialDecisionTableModel,
  PartialDecisionTableRowModel,
  PartialEditSectionModel,
  PartialFieldModel,
  PartialLifecycleActionModel,
  PartialLifecycleGuardModel,
  PartialLifecycleModel,
  PartialModelMigrationModel,
  PartialNamedValidatorModel,
  PartialObjectModel,
  PartialObjectSyncPolicyModel,
  PartialObjectValidationModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialPredicateValidatorModel,
  PartialPresentationActionControlModel,
  PartialPresentationCalendarModel,
  PartialPresentationConditionalFragmentModel,
  PartialPresentationControlModel,
  PartialPresentationFieldTextFragmentModel,
  PartialPresentationIconFragmentModel,
  PartialPresentationListModel,
  PartialPresentationLiteralTextFragmentModel,
  PartialPresentationRowFragmentModel,
  PartialPresentationRowTemplateModel,
  PartialPresentationSectionModel,
  PartialReadModelFieldModel,
  PartialReadModelModel,
  PartialRoleModel,
  PartialShellModel,
  PartialSyncPolicyModel,
  PartialThemeModel,
  PartialViewModel,
  PartialViewPresentationModel,
} from "./resolved-model.js";

// --- Objects ---------------------------------------------------------------

export type AdljComputedFieldModel = Omit<PartialComputedFieldModel, "expression"> & {
  expression: string;
};

export type AdljPredicateValidatorModel = Omit<PartialPredicateValidatorModel, "expression"> & {
  expression: string;
};

export type AdljValidatorModel = PartialNamedValidatorModel | AdljPredicateValidatorModel;

export type AdljFieldModel = Omit<PartialFieldModel, "validators"> & {
  validators?: AdljValidatorModel[];
};

export type AdljObjectValidationModel = Omit<PartialObjectValidationModel, "expression"> & {
  expression: string;
};

export type AdljLifecycleGuardModel = Omit<PartialLifecycleGuardModel, "expression"> & {
  expression: string;
};

export type AdljLifecycleActionModel = Omit<PartialLifecycleActionModel, "guards"> & {
  guards?: AdljLifecycleGuardModel[];
};

export type AdljLifecycleModel = Omit<PartialLifecycleModel, "actions"> & {
  actions?: AdljLifecycleActionModel[];
};

export type AdljPresentationActionControlModel = Omit<
  PartialPresentationActionControlModel,
  "input" | "visibleWhen"
> & {
  input?: Record<string, string>;
  visibleWhen?: string;
};

export type AdljPresentationConditionalFragmentModel = Omit<
  PartialPresentationConditionalFragmentModel,
  "when" | "fragments"
> & {
  when: string;
  fragments?: AdljPresentationRowFragmentModel[];
};

export type AdljPresentationRowFragmentModel =
  | PartialPresentationLiteralTextFragmentModel
  | PartialPresentationFieldTextFragmentModel
  | PartialPresentationIconFragmentModel
  | AdljPresentationConditionalFragmentModel;

export type AdljPresentationRowTemplateModel = Omit<
  PartialPresentationRowTemplateModel,
  "fragments"
> & {
  fragments?: AdljPresentationRowFragmentModel[];
};

export type AdljPresentationListModel = Omit<
  PartialPresentationListModel,
  "filter" | "actions" | "row"
> & {
  filter?: string;
  actions?: AdljPresentationActionControlModel[];
  row?: AdljPresentationRowTemplateModel;
};

export type AdljPresentationCalendarModel = Omit<PartialPresentationCalendarModel, "actions"> & {
  actions?: AdljPresentationActionControlModel[];
};

export type AdljPresentationControlModel =
  | Exclude<PartialPresentationControlModel, PartialPresentationActionControlModel>
  | AdljPresentationActionControlModel;

export type AdljPresentationSectionModel = Omit<
  PartialPresentationSectionModel,
  "controls" | "lists" | "calendars"
> & {
  controls?: AdljPresentationControlModel[];
  lists?: AdljPresentationListModel[];
  calendars?: AdljPresentationCalendarModel[];
};

export type AdljViewPresentationModel = Omit<PartialViewPresentationModel, "sections"> & {
  sections?: AdljPresentationSectionModel[];
};

export type AdljViewModel = Omit<PartialViewModel, "presentation" | "editSections"> & {
  editSections?: PartialEditSectionModel[];
  presentation?: AdljViewPresentationModel;
};

export type AdljObjectSyncPolicyModel = Omit<PartialObjectSyncPolicyModel, "predicate"> & {
  predicate?: string;
};

export type AdljObjectModel = Omit<
  PartialObjectModel,
  "computedFields" | "fields" | "validations" | "lifecycle" | "views" | "sync"
> & {
  fields?: AdljFieldModel[];
  computedFields?: AdljComputedFieldModel[];
  validations?: AdljObjectValidationModel[];
  lifecycle?: AdljLifecycleModel;
  views?: AdljViewModel[];
  sync?: AdljObjectSyncPolicyModel;
};

// --- Policies ----------------------------------------------------------------

export type AdljPolicyRuleModel = Omit<PartialPolicyRuleModel, "condition"> & {
  condition?: string;
};

export type AdljPolicyModel = Omit<PartialPolicyModel, "rules"> & {
  rules?: AdljPolicyRuleModel[];
};

// --- Contexts ------------------------------------------------------------

export type AdljContextGrantModel = Omit<PartialContextGrantModel, "condition"> & {
  condition?: string;
};

export type AdljBusinessContextModel = Omit<PartialBusinessContextModel, "grants"> & {
  grants?: AdljContextGrantModel[];
};

// --- Read models -----------------------------------------------------------

export type AdljReadModelFieldModel = Omit<PartialReadModelFieldModel, "expression"> & {
  expression?: string;
};

export type AdljReadModelModel = Omit<PartialReadModelModel, "fields"> & {
  fields: AdljReadModelFieldModel[];
};

// --- Decision tables ---------------------------------------------------------

export type AdljDecisionTableInputModel = Omit<PartialDecisionTableInputModel, "expression"> & {
  expression: string;
};

export type AdljDecisionTableRowModel = Omit<PartialDecisionTableRowModel, "condition"> & {
  condition: string;
};

export type AdljDecisionTableModel = Omit<PartialDecisionTableModel, "inputs" | "rows"> & {
  inputs?: AdljDecisionTableInputModel[];
  rows?: AdljDecisionTableRowModel[];
};

// --- Commands ----------------------------------------------------------------

export type AdljCommandPreconditionModel = Omit<PartialCommandPreconditionModel, "expression"> & {
  expression: string;
};

export type AdljCommandCreateStepModel = Omit<PartialCommandCreateStepModel, "preconditions"> & {
  preconditions?: string[];
};

export type AdljCommandUpdateStepModel = Omit<PartialCommandUpdateStepModel, "preconditions"> & {
  preconditions?: string[];
};

export type AdljCommandReadStepModel = Omit<PartialCommandReadStepModel, "preconditions"> & {
  preconditions?: string[];
};

export type AdljCommandStepModel =
  | AdljCommandCreateStepModel
  | AdljCommandUpdateStepModel
  | AdljCommandReadStepModel;

export type AdljCommandModel = Omit<PartialCommandModel, "preconditions" | "steps"> & {
  preconditions?: AdljCommandPreconditionModel[];
  steps?: AdljCommandStepModel[];
};

// --- Sync ----------------------------------------------------------------

export type AdljSyncPolicyModel = Omit<PartialSyncPolicyModel, "predicate"> & {
  predicate?: string;
};

// --- Root --------------------------------------------------------------------

/**
 * The `.adlj` document root. `app`, `shell`, `roles`, `themes`, and
 * `migrations` carry no expression-bearing content, so they reuse their
 * `Partial*Model` counterparts unchanged.
 */
export interface AdljSourceDocument {
  modelVersion?: string;
  app: PartialAppModel;
  shell?: PartialShellModel;
  roles?: PartialRoleModel[];
  contexts?: AdljBusinessContextModel[];
  objects: AdljObjectModel[];
  readModels?: AdljReadModelModel[];
  decisionTables?: AdljDecisionTableModel[];
  commands?: AdljCommandModel[];
  policies?: AdljPolicyModel[];
  themes?: PartialThemeModel[];
  sync?: AdljSyncPolicyModel[];
  migrations?: PartialModelMigrationModel[];
}
