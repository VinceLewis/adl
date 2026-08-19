/**
 * `.adl` text -> `.adlj` JSON: the inverse of `adljSourceToPartialApplicationModel`
 * (Phase 77). `printPartialApplicationModelAsAdl`/Phase 73 already goes
 * `PartialApplicationModel -> .adl text`. This module goes
 * `PartialApplicationModel -> AdljSourceDocument`, which `JSON.stringify`s
 * directly into a `.adlj` file. Combined with `compileAdl` (`.adl text ->
 * PartialApplicationModel`), `importAdlAsAdlj` below gives a full
 * `.adl text -> .adlj JSON` pipeline.
 *
 * This file mirrors `compile-adlj.ts`'s `adljSourceToPartialApplicationModel`
 * structure exactly, but inverted: everywhere that file calls
 * `parseExpressionSource(someString)` to go string -> tree, this file calls
 * `printExpression`/`printCondition` (imported from `print-adl.ts`, not
 * reimplemented) to go tree -> string. Every other field passes through
 * unchanged, using the same destructure-before-spread idiom the rest of the
 * `.adlj` surface uses to stay safe under `exactOptionalPropertyTypes` (see
 * `learnings/implementation/adlj-json-authoring-surface.md`).
 *
 * `COMMAND STEP` `values`/`patch`/`recordId` (`ResolvedCommandValueExpression`)
 * are left untouched, exactly as `adljSourceToPartialApplicationModel` leaves
 * them: that vocabulary was never infix text to begin with, so there is
 * nothing to print.
 */
import { compileAdl } from "./compile-adl.js";
import { printCondition, printExpression } from "./print-adl.js";
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
} from "../model/resolved-model.js";

export interface ImportAdlAsAdljResult {
  document?: AdljSourceDocument;
  diagnostics: Diagnostic[];
}

/**
 * Compiles `.adl` source with `compileAdl` and, only if the result carries no
 * error diagnostics (warnings pass through unchanged), converts the resulting
 * `partialModel` into an `AdljSourceDocument`. When there are blocking
 * errors, `document` is left `undefined` and no conversion is attempted.
 */
export function importAdlAsAdlj(adlSource: string): ImportAdlAsAdljResult {
  const { partialModel, diagnostics } = compileAdl(adlSource);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics };
  }

  return { document: partialApplicationModelToAdljSource(partialModel), diagnostics };
}

// --- PartialApplicationModel -> AdljSourceDocument --------------------------

export function partialApplicationModelToAdljSource(
  model: PartialApplicationModel,
): AdljSourceDocument {
  const { objects, contexts, readModels, decisionTables, commands, policies, sync, ...rest } =
    model;
  return {
    ...rest,
    objects: objects.map(objectToAdlj),
    ...(contexts === undefined ? {} : { contexts: contexts.map(contextToAdlj) }),
    ...(readModels === undefined ? {} : { readModels: readModels.map(readModelToAdlj) }),
    ...(decisionTables === undefined
      ? {}
      : { decisionTables: decisionTables.map(decisionTableToAdlj) }),
    ...(commands === undefined ? {} : { commands: commands.map(commandToAdlj) }),
    ...(policies === undefined ? {} : { policies: policies.map(policyToAdlj) }),
    ...(sync === undefined ? {} : { sync: sync.map(syncPolicyToAdlj) }),
  };
}

function objectToAdlj(object: PartialObjectModel): AdljObjectModel {
  const { fields, computedFields, validations, lifecycle, views, sync, ...rest } = object;
  return {
    ...rest,
    ...(fields === undefined ? {} : { fields: fields.map(fieldToAdlj) }),
    ...(computedFields === undefined
      ? {}
      : { computedFields: computedFields.map(computedFieldToAdlj) }),
    ...(validations === undefined
      ? {}
      : {
          validations: validations.map((validation) => ({
            ...validation,
            expression: printCondition(validation.expression, true),
          })),
        }),
    ...(lifecycle === undefined ? {} : { lifecycle: lifecycleToAdlj(lifecycle) }),
    ...(views === undefined ? {} : { views: views.map(viewToAdlj) }),
    ...(sync === undefined ? {} : { sync: objectSyncToAdlj(sync) }),
  };
}

function computedFieldToAdlj(field: PartialComputedFieldModel): AdljComputedFieldModel {
  const { expression, ...rest } = field;
  return { ...rest, expression: printExpression(expression, true) };
}

function fieldToAdlj(field: PartialFieldModel): AdljFieldModel {
  const { validators, ...rest } = field;
  return {
    ...rest,
    ...(validators === undefined ? {} : { validators: validators.map(validatorToAdlj) }),
  };
}

function validatorToAdlj(validator: PartialValidatorModel): AdljValidatorModel {
  if (validator.kind !== "predicate") {
    return validator;
  }

  const { expression, ...rest } = validator;
  return { ...rest, expression: printCondition(expression, true) };
}

function lifecycleToAdlj(lifecycle: PartialLifecycleModel): AdljLifecycleModel {
  const { actions, ...rest } = lifecycle;
  return {
    ...rest,
    ...(actions === undefined ? {} : { actions: actions.map(lifecycleActionToAdlj) }),
  };
}

function lifecycleActionToAdlj(action: PartialLifecycleActionModel): AdljLifecycleActionModel {
  const { guards, ...rest } = action;
  return {
    ...rest,
    ...(guards === undefined
      ? {}
      : {
          guards: guards.map((guard) => ({
            ...guard,
            expression: printCondition(guard.expression, true),
          })),
        }),
  };
}

function objectSyncToAdlj(sync: PartialObjectSyncPolicyModel): AdljObjectSyncPolicyModel {
  const { predicate, ...rest } = sync;
  return {
    ...rest,
    ...(predicate === undefined ? {} : { predicate: printExpression(predicate, true) }),
  };
}

function syncPolicyToAdlj(sync: PartialSyncPolicyModel): AdljSyncPolicyModel {
  const { predicate, ...rest } = sync;
  return {
    ...rest,
    ...(predicate === undefined ? {} : { predicate: printExpression(predicate, true) }),
  };
}

function viewToAdlj(view: PartialViewModel): AdljViewModel {
  const { presentation, ...rest } = view;
  return {
    ...rest,
    ...(presentation === undefined ? {} : { presentation: viewPresentationToAdlj(presentation) }),
  };
}

function viewPresentationToAdlj(
  presentation: PartialViewPresentationModel,
): AdljViewPresentationModel {
  const { sections, ...rest } = presentation;
  return {
    ...rest,
    ...(sections === undefined ? {} : { sections: sections.map(presentationSectionToAdlj) }),
  };
}

function presentationSectionToAdlj(
  section: PartialPresentationSectionModel,
): AdljPresentationSectionModel {
  const { controls, lists, calendars, ...rest } = section;
  return {
    ...rest,
    ...(controls === undefined ? {} : { controls: controls.map(presentationControlToAdlj) }),
    ...(lists === undefined ? {} : { lists: lists.map(presentationListToAdlj) }),
    ...(calendars === undefined ? {} : { calendars: calendars.map(presentationCalendarToAdlj) }),
  };
}

function presentationControlToAdlj(
  control: PartialPresentationControlModel,
): AdljPresentationControlModel {
  if (control.kind !== "action") {
    return control;
  }

  return presentationActionToAdlj(control);
}

function presentationActionToAdlj(
  action: PartialPresentationActionControlModel,
): AdljPresentationActionControlModel {
  const { input, visibleWhen, ...rest } = action;
  return {
    ...rest,
    ...(input === undefined
      ? {}
      : {
          input: Object.fromEntries(
            Object.entries(input).map(([name, expression]) => [
              name,
              printExpression(expression, true),
            ]),
          ),
        }),
    ...(visibleWhen === undefined ? {} : { visibleWhen: printCondition(visibleWhen, true) }),
  };
}

function presentationListToAdlj(list: PartialPresentationListModel): AdljPresentationListModel {
  const { filter, actions, row, ...rest } = list;
  return {
    ...rest,
    ...(filter === undefined ? {} : { filter: printCondition(filter, true) }),
    ...(actions === undefined ? {} : { actions: actions.map(presentationActionToAdlj) }),
    ...(row === undefined ? {} : { row: presentationRowTemplateToAdlj(row) }),
  };
}

function presentationCalendarToAdlj(
  calendar: PartialPresentationCalendarModel,
): AdljPresentationCalendarModel {
  const { actions, ...rest } = calendar;
  return {
    ...rest,
    ...(actions === undefined ? {} : { actions: actions.map(presentationActionToAdlj) }),
  };
}

function presentationRowTemplateToAdlj(
  row: PartialPresentationRowTemplateModel,
): AdljPresentationRowTemplateModel {
  const { fragments, ...rest } = row;
  return {
    ...rest,
    ...(fragments === undefined ? {} : { fragments: fragments.map(presentationRowFragmentToAdlj) }),
  };
}

function presentationRowFragmentToAdlj(
  fragment: PartialPresentationRowFragmentModel,
): AdljPresentationRowFragmentModel {
  if (fragment.kind !== "conditional") {
    return fragment;
  }

  const { when, fragments, ...rest } = fragment;
  return {
    ...rest,
    when: printCondition(when, true),
    ...(fragments === undefined ? {} : { fragments: fragments.map(presentationRowFragmentToAdlj) }),
  };
}

function contextToAdlj(context: PartialBusinessContextModel): AdljBusinessContextModel {
  const { grants, ...rest } = context;
  return {
    ...rest,
    ...(grants === undefined ? {} : { grants: grants.map(contextGrantToAdlj) }),
  };
}

function contextGrantToAdlj(grant: PartialContextGrantModel): AdljContextGrantModel {
  const { condition, ...rest } = grant;
  return {
    ...rest,
    ...(condition === undefined ? {} : { condition: printCondition(condition, true) }),
  };
}

function readModelToAdlj(readModel: PartialReadModelModel): AdljReadModelModel {
  const { fields, ...rest } = readModel;
  return {
    ...rest,
    fields: fields.map((field) => {
      const { expression, ...fieldRest } = field;
      return {
        ...fieldRest,
        ...(expression === undefined ? {} : { expression: printCondition(expression, true) }),
      };
    }),
  };
}

function decisionTableToAdlj(table: PartialDecisionTableModel): AdljDecisionTableModel {
  const { inputs, rows, ...rest } = table;
  return {
    ...rest,
    ...(inputs === undefined
      ? {}
      : {
          inputs: inputs.map((input) => {
            const { expression, ...inputRest } = input;
            return { ...inputRest, expression: printCondition(expression, true) };
          }),
        }),
    ...(rows === undefined
      ? {}
      : {
          rows: rows.map((row) => {
            const { condition, ...rowRest } = row;
            return { ...rowRest, condition: printCondition(condition, true) };
          }),
        }),
  };
}

function commandToAdlj(command: PartialCommandModel): AdljCommandModel {
  const { preconditions, steps, ...rest } = command;
  return {
    ...rest,
    ...(preconditions === undefined
      ? {}
      : {
          preconditions: preconditions.map((precondition) => {
            const { expression, ...preconditionRest } = precondition;
            return { ...preconditionRest, expression: printCondition(expression, true) };
          }),
        }),
    ...(steps === undefined ? {} : { steps: steps.map(commandStepToAdlj) }),
  };
}

function commandStepToAdlj(step: PartialCommandStepModel): AdljCommandStepModel {
  const { preconditions, ...rest } = step;
  return {
    ...rest,
    ...(preconditions === undefined
      ? {}
      : {
          preconditions: preconditions.map((precondition) => printCondition(precondition, true)),
        }),
  };
}

function policyToAdlj(policy: PartialPolicyModel): AdljPolicyModel {
  const { rules, ...rest } = policy;
  return {
    ...rest,
    ...(rules === undefined ? {} : { rules: rules.map(policyRuleToAdlj) }),
  };
}

function policyRuleToAdlj(rule: PartialPolicyRuleModel): AdljPolicyRuleModel {
  const { condition, ...rest } = rule;
  return {
    ...rest,
    ...(condition === undefined ? {} : { condition: printCondition(condition, true) }),
  };
}
