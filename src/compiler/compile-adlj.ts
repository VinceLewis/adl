/**
 * `.adlj`: a second front-end into the same pipeline `compileAdl` already
 * uses (Phase 73). Only `parseAdljDocument` and
 * `adljSourceToPartialApplicationModel` are new — `resolveApplicationModel`
 * and `validateApplicationModel` are reused completely unchanged, so a
 * `.adlj` app and an equivalent `.adl` app that resolve to the same
 * `PartialApplicationModel` are indistinguishable to everything downstream.
 *
 *   parseAdljDocument(jsonText)              -> AdljSourceDocument
 *   adljSourceToPartialApplicationModel(doc) -> PartialApplicationModel
 *   resolveApplicationModel(partialModel)    -> ResolvedApplicationModel   (reused)
 *   validateApplicationModel(model)          -> Diagnostic[]              (reused)
 *
 * See `src/model/adlj-source.ts` for why expression-bearing fields are kept
 * as strings, and `docs/spec/adlj.md` for the format overall.
 */
import { Ajv } from "ajv";
import type { ErrorObject } from "ajv";
import adljSchema from "../model/adlj-schema.json" with { type: "json" };
import { parseExpressionSource } from "../parser/parser.js";
import { resolveApplicationModel } from "./resolve-model.js";
import { validateApplicationModel } from "./validate-model.js";
import { MODEL_VALIDATION_CODES } from "./validate-model.js";
import type { Diagnostic } from "./validate-model.js";
import type {
  AdljBusinessContextModel,
  AdljCommandModel,
  AdljCommandStepModel,
  AdljComputedFieldModel,
  AdljContextGrantModel,
  AdljDecisionTableModel,
  AdljFieldModel,
  AdljLifecycleActionModel,
  AdljLifecycleModel,
  AdljObjectModel,
  AdljObjectSyncPolicyModel,
  AdljPolicyModel,
  AdljPolicyRuleModel,
  AdljPresentationActionControlModel,
  AdljPresentationCalendarModel,
  AdljPresentationControlModel,
  AdljPresentationListModel,
  AdljPresentationRowFragmentModel,
  AdljPresentationRowTemplateModel,
  AdljPresentationSectionModel,
  AdljReadModelModel,
  AdljSourceDocument,
  AdljSyncPolicyModel,
  AdljValidatorModel,
  AdljViewModel,
  AdljViewPresentationModel,
} from "../model/adlj-source.js";
import type {
  PartialBusinessContextModel,
  PartialCommandModel,
  PartialCommandStepModel,
  PartialComputedFieldModel,
  PartialContextGrantModel,
  PartialDecisionTableModel,
  PartialFieldModel,
  PartialLifecycleActionModel,
  PartialLifecycleModel,
  PartialObjectModel,
  PartialObjectSyncPolicyModel,
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialPresentationActionControlModel,
  PartialPresentationCalendarModel,
  PartialPresentationControlModel,
  PartialPresentationListModel,
  PartialPresentationRowFragmentModel,
  PartialPresentationRowTemplateModel,
  PartialPresentationSectionModel,
  PartialReadModelModel,
  PartialApplicationModel,
  PartialSyncPolicyModel,
  PartialValidatorModel,
  PartialViewModel,
  PartialViewPresentationModel,
  ResolvedApplicationModel,
} from "../model/resolved-model.js";

// `strict: false` because the generated schema legitimately uses union
// `type` keywords (e.g. `JsonPrimitive`) that ajv's strict mode warns about;
// none of those warnings indicate a schema authoring mistake here.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
const validateAdljSchema = ajv.compile(adljSchema);

/**
 * Thrown by `parseAdljDocument` when `.adlj` source is not valid JSON or
 * does not match the generated schema — the `.adlj` analogue of `ParseError`
 * for `.adl` text. Carries one `Diagnostic` rather than a raw `JSON.parse`
 * or `ajv` exception, so the "compile-check ADL source before presenting
 * it" rule in `AGENTS.md`/`CLAUDE.md` applies to `.adlj` the same way it
 * already applies to `.adl`.
 */
export class AdljParseError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "AdljParseError";
    this.diagnostic = diagnostic;
  }
}

export interface CompileAdljResult {
  source: AdljSourceDocument;
  partialModel: PartialApplicationModel;
  model: ResolvedApplicationModel;
  diagnostics: Diagnostic[];
}

/**
 * Compiles one self-contained `.adlj` document into a `ResolvedApplicationModel`
 * — the JSON analogue of `compileAdl` on a single `.adl` file, not of
 * `compileAdlProject`. See `src/model/adlj-source.ts` for why mixing `.adl`
 * and `.adlj` sources, or merging several `.adlj` files, is out of scope.
 */
export function compileAdlj(jsonText: string): CompileAdljResult {
  const source = parseAdljDocument(jsonText);
  const partialModel = adljSourceToPartialApplicationModel(source);
  const model = resolveApplicationModel(partialModel);
  const diagnostics = validateApplicationModel(model);

  return { source, partialModel, model, diagnostics };
}

export function parseAdljDocument(jsonText: string): AdljSourceDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new AdljParseError({
      severity: "error",
      code: MODEL_VALIDATION_CODES.ADLJ_JSON_INVALID,
      message: `.adlj source is not valid JSON: ${describeJsonError(error)}.`,
    });
  }

  if (!validateAdljSchema(parsed)) {
    throw new AdljParseError(schemaViolationDiagnostic(validateAdljSchema.errors ?? []));
  }

  return parsed as AdljSourceDocument;
}

function describeJsonError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function schemaViolationDiagnostic(errors: ErrorObject[]): Diagnostic {
  const [firstError] = errors;
  if (firstError === undefined) {
    return {
      severity: "error",
      code: MODEL_VALIDATION_CODES.ADLJ_SCHEMA_INVALID,
      message: ".adlj source does not match the ADL JSON schema.",
    };
  }

  const path = firstError.instancePath.length === 0 ? "/" : firstError.instancePath;
  return {
    severity: "error",
    code: MODEL_VALIDATION_CODES.ADLJ_SCHEMA_INVALID,
    message: `.adlj source does not match the ADL JSON schema at '${path}': ${firstError.message ?? "invalid"}.`,
    path,
  };
}

// --- AdljSourceDocument -> PartialApplicationModel --------------------------

export function adljSourceToPartialApplicationModel(
  source: AdljSourceDocument,
): PartialApplicationModel {
  const { objects, contexts, readModels, decisionTables, commands, policies, sync, ...rest } =
    source;
  return {
    ...rest,
    objects: objects.map(objectToPartial),
    ...(contexts === undefined ? {} : { contexts: contexts.map(contextToPartial) }),
    ...(readModels === undefined ? {} : { readModels: readModels.map(readModelToPartial) }),
    ...(decisionTables === undefined
      ? {}
      : { decisionTables: decisionTables.map(decisionTableToPartial) }),
    ...(commands === undefined ? {} : { commands: commands.map(commandToPartial) }),
    ...(policies === undefined ? {} : { policies: policies.map(policyToPartial) }),
    ...(sync === undefined ? {} : { sync: sync.map(syncPolicyToPartial) }),
  };
}

function objectToPartial(object: AdljObjectModel): PartialObjectModel {
  const { fields, computedFields, validations, lifecycle, views, sync, ...rest } = object;
  return {
    ...rest,
    ...(fields === undefined ? {} : { fields: fields.map(fieldToPartial) }),
    ...(computedFields === undefined
      ? {}
      : { computedFields: computedFields.map(computedFieldToPartial) }),
    ...(validations === undefined
      ? {}
      : {
          validations: validations.map((validation) => ({
            ...validation,
            expression: parseExpressionSource(validation.expression),
          })),
        }),
    ...(lifecycle === undefined ? {} : { lifecycle: lifecycleToPartial(lifecycle) }),
    ...(views === undefined ? {} : { views: views.map(viewToPartial) }),
    ...(sync === undefined ? {} : { sync: objectSyncToPartial(sync) }),
  };
}

function computedFieldToPartial(field: AdljComputedFieldModel): PartialComputedFieldModel {
  const { expression, ...rest } = field;
  return { ...rest, expression: parseExpressionSource(expression) };
}

function fieldToPartial(field: AdljFieldModel): PartialFieldModel {
  const { validators, ...rest } = field;
  return {
    ...rest,
    ...(validators === undefined ? {} : { validators: validators.map(validatorToPartial) }),
  };
}

function validatorToPartial(validator: AdljValidatorModel): PartialValidatorModel {
  if (validator.kind !== "predicate") {
    return validator;
  }

  const { expression, ...rest } = validator;
  return { ...rest, expression: parseExpressionSource(expression) };
}

function lifecycleToPartial(lifecycle: AdljLifecycleModel): PartialLifecycleModel {
  const { actions, ...rest } = lifecycle;
  return {
    ...rest,
    ...(actions === undefined ? {} : { actions: actions.map(lifecycleActionToPartial) }),
  };
}

function lifecycleActionToPartial(action: AdljLifecycleActionModel): PartialLifecycleActionModel {
  const { guards, ...rest } = action;
  return {
    ...rest,
    ...(guards === undefined
      ? {}
      : {
          guards: guards.map((guard) => ({
            ...guard,
            expression: parseExpressionSource(guard.expression),
          })),
        }),
  };
}

function objectSyncToPartial(sync: AdljObjectSyncPolicyModel): PartialObjectSyncPolicyModel {
  const { predicate, ...rest } = sync;
  return {
    ...rest,
    ...(predicate === undefined ? {} : { predicate: parseExpressionSource(predicate) }),
  };
}

function syncPolicyToPartial(sync: AdljSyncPolicyModel): PartialSyncPolicyModel {
  const { predicate, ...rest } = sync;
  return {
    ...rest,
    ...(predicate === undefined ? {} : { predicate: parseExpressionSource(predicate) }),
  };
}

function viewToPartial(view: AdljViewModel): PartialViewModel {
  const { presentation, ...rest } = view;
  return {
    ...rest,
    ...(presentation === undefined
      ? {}
      : { presentation: viewPresentationToPartial(presentation) }),
  };
}

function viewPresentationToPartial(
  presentation: AdljViewPresentationModel,
): PartialViewPresentationModel {
  const { sections, ...rest } = presentation;
  return {
    ...rest,
    ...(sections === undefined ? {} : { sections: sections.map(presentationSectionToPartial) }),
  };
}

function presentationSectionToPartial(
  section: AdljPresentationSectionModel,
): PartialPresentationSectionModel {
  const { controls, lists, calendars, ...rest } = section;
  return {
    ...rest,
    ...(controls === undefined ? {} : { controls: controls.map(presentationControlToPartial) }),
    ...(lists === undefined ? {} : { lists: lists.map(presentationListToPartial) }),
    ...(calendars === undefined ? {} : { calendars: calendars.map(presentationCalendarToPartial) }),
  };
}

function presentationControlToPartial(
  control: AdljPresentationControlModel,
): PartialPresentationControlModel {
  if (control.kind !== "action") {
    return control;
  }

  return presentationActionToPartial(control);
}

function presentationActionToPartial(
  action: AdljPresentationActionControlModel,
): PartialPresentationActionControlModel {
  const { input, visibleWhen, ...rest } = action;
  return {
    ...rest,
    ...(input === undefined
      ? {}
      : {
          input: Object.fromEntries(
            Object.entries(input).map(([name, expression]) => [
              name,
              parseExpressionSource(expression),
            ]),
          ),
        }),
    ...(visibleWhen === undefined ? {} : { visibleWhen: parseExpressionSource(visibleWhen) }),
  };
}

function presentationListToPartial(list: AdljPresentationListModel): PartialPresentationListModel {
  const { filter, actions, row, ...rest } = list;
  return {
    ...rest,
    ...(filter === undefined ? {} : { filter: parseExpressionSource(filter) }),
    ...(actions === undefined ? {} : { actions: actions.map(presentationActionToPartial) }),
    ...(row === undefined ? {} : { row: presentationRowTemplateToPartial(row) }),
  };
}

function presentationCalendarToPartial(
  calendar: AdljPresentationCalendarModel,
): PartialPresentationCalendarModel {
  const { actions, ...rest } = calendar;
  return {
    ...rest,
    ...(actions === undefined ? {} : { actions: actions.map(presentationActionToPartial) }),
  };
}

function presentationRowTemplateToPartial(
  row: AdljPresentationRowTemplateModel,
): PartialPresentationRowTemplateModel {
  const { fragments, ...rest } = row;
  return {
    ...rest,
    ...(fragments === undefined
      ? {}
      : { fragments: fragments.map(presentationRowFragmentToPartial) }),
  };
}

function presentationRowFragmentToPartial(
  fragment: AdljPresentationRowFragmentModel,
): PartialPresentationRowFragmentModel {
  if (fragment.kind !== "conditional") {
    return fragment;
  }

  const { when, fragments, ...rest } = fragment;
  return {
    ...rest,
    when: parseExpressionSource(when),
    ...(fragments === undefined
      ? {}
      : { fragments: fragments.map(presentationRowFragmentToPartial) }),
  };
}

function contextToPartial(context: AdljBusinessContextModel): PartialBusinessContextModel {
  const { grants, ...rest } = context;
  return {
    ...rest,
    ...(grants === undefined ? {} : { grants: grants.map(contextGrantToPartial) }),
  };
}

function contextGrantToPartial(grant: AdljContextGrantModel): PartialContextGrantModel {
  const { condition, ...rest } = grant;
  return {
    ...rest,
    ...(condition === undefined ? {} : { condition: parseExpressionSource(condition) }),
  };
}

function readModelToPartial(readModel: AdljReadModelModel): PartialReadModelModel {
  const { fields, ...rest } = readModel;
  return {
    ...rest,
    fields: fields.map((field) => {
      const { expression, ...fieldRest } = field;
      return {
        ...fieldRest,
        ...(expression === undefined ? {} : { expression: parseExpressionSource(expression) }),
      };
    }),
  };
}

function decisionTableToPartial(table: AdljDecisionTableModel): PartialDecisionTableModel {
  const { inputs, rows, ...rest } = table;
  return {
    ...rest,
    ...(inputs === undefined
      ? {}
      : {
          inputs: inputs.map((input) => {
            const { expression, ...inputRest } = input;
            return { ...inputRest, expression: parseExpressionSource(expression) };
          }),
        }),
    ...(rows === undefined
      ? {}
      : {
          rows: rows.map((row) => {
            const { condition, ...rowRest } = row;
            return { ...rowRest, condition: parseExpressionSource(condition) };
          }),
        }),
  };
}

function commandToPartial(command: AdljCommandModel): PartialCommandModel {
  const { preconditions, steps, ...rest } = command;
  return {
    ...rest,
    ...(preconditions === undefined
      ? {}
      : {
          preconditions: preconditions.map((precondition) => {
            const { expression, ...preconditionRest } = precondition;
            return { ...preconditionRest, expression: parseExpressionSource(expression) };
          }),
        }),
    ...(steps === undefined ? {} : { steps: steps.map(commandStepToPartial) }),
  };
}

function commandStepToPartial(step: AdljCommandStepModel): PartialCommandStepModel {
  const { preconditions, ...rest } = step;
  return {
    ...rest,
    ...(preconditions === undefined
      ? {}
      : {
          preconditions: preconditions.map((precondition) => parseExpressionSource(precondition)),
        }),
  };
}

function policyToPartial(policy: AdljPolicyModel): PartialPolicyModel {
  const { rules, ...rest } = policy;
  return {
    ...rest,
    ...(rules === undefined ? {} : { rules: rules.map(policyRuleToPartial) }),
  };
}

function policyRuleToPartial(rule: AdljPolicyRuleModel): PartialPolicyRuleModel {
  const { condition, ...rest } = rule;
  return {
    ...rest,
    ...(condition === undefined ? {} : { condition: parseExpressionSource(condition) }),
  };
}
