import type {
  CommandRuntimeProperty,
  CommandStepAuthority,
  CommandStepMetaProperty,
  ResolvedCommand,
  ResolvedCommandInput,
  ResolvedCommandPrecondition,
  ResolvedCommandStep,
  ResolvedCommandValueExpression,
  ResolvedField,
  SyncMode,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import {
  FIELD_TYPES,
  SYNC_MODES,
  commandInputFieldsByName,
  diagnostic,
  indexByName,
  isValueCompatibleWithFieldType,
  reportDuplicateNames,
} from "./shared.js";
import type { ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";
import { isQueueableSyncMode } from "./sync.js";

const COMMAND_RUNTIME_PROPERTIES = new Set<CommandRuntimeProperty>(["userId", "nowIso", "today"]);
const COMMAND_STEP_AUTHORITIES = new Set<CommandStepAuthority>(["caller", "command"]);
const COMMAND_STEP_META_PROPERTIES = new Set<CommandStepMetaProperty>([
  "guid",
  "createdAt",
  "updatedAt",
]);
export function validateCommand(
  command: ResolvedCommand,
  commandIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const commandPath = `commands[${commandIndex}]`;
  const inputsByName = indexByName(command.inputs);
  const inputFieldsByName = commandInputFieldsByName(command.inputs);
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

  for (
    let preconditionIndex = 0;
    preconditionIndex < command.preconditions.length;
    preconditionIndex += 1
  ) {
    const precondition = command.preconditions[preconditionIndex];
    if (precondition === undefined) {
      continue;
    }
    validateCommandPrecondition(
      precondition,
      `${commandPath}.preconditions[${preconditionIndex}]`,
      command,
      inputFieldsByName,
      diagnostics,
    );
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

  validateCommandStepSyncCoherence(command, commandPath, indexes, diagnostics);
}
/**
 * A command replays to the authority as a single `command` intent, and a queue
 * entry carries exactly one object's sync declaration. So if a command's steps
 * disagree about whether their writes are delivered to the authority at all,
 * there is no delivery the runtime can choose that is not wrong: queue the
 * command and the authority refuses the write that was never meant to leave the
 * device, on this reconnect and on every one after it; withhold it and the steps
 * that were meant to reach the authority silently never do. Refusing the model
 * is the only answer that does not lose writes or wedge the queue.
 *
 * Mixing `localFirst` with `onlineRequired` is not this defect. Both queue, and
 * `commandModeRank` in the object store picks the more demanding of the two to
 * file the entry under. A command all of whose objects withhold their writes is
 * not this defect either: it simply never enters the queue.
 */
function validateCommandStepSyncCoherence(
  command: ResolvedCommand,
  commandPath: string,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const queued = new Map<string, SyncMode>();
  const withheld = new Map<string, SyncMode>();

  for (let stepIndex = 0; stepIndex < command.steps.length; stepIndex += 1) {
    const step = command.steps[stepIndex];
    if (step === undefined) {
      continue;
    }
    if (step.action === "read") {
      // A read step writes nothing, so it has no write-delivery mode to
      // disagree with the command's other steps about.
      continue;
    }
    const object = indexes.objectsByName.get(step.object)?.item;
    if (object === undefined) {
      // Already reported as an unknown step object, and an object that does not
      // resolve has no declared mode to disagree with.
      continue;
    }
    const mode = object.sync.mode;
    if (!SYNC_MODES.has(mode)) {
      // Same reasoning for an unreadable mode: it is already reported against
      // the object, and guessing which side of the split it belongs on would
      // stack a second, misleading error on top of the first.
      continue;
    }
    (isQueueableSyncMode(mode) ? queued : withheld).set(object.name, mode);
  }

  if (queued.size === 0 || withheld.size === 0) {
    return;
  }

  // One diagnostic for the whole command: the disagreement is a property of the
  // command, and no single step is the one at fault.
  diagnostics.push(
    diagnostic(
      MODEL_VALIDATION_CODES.COMMAND_STEP_SYNC_MODE_MIXED,
      `Command '${command.name}' replays to the authority as one transaction, so its steps cannot disagree about whether their writes are delivered to the authority at all. Steps write ${describeObjectSyncModes(queued)}, whose writes are queued for the authority, and ${describeObjectSyncModes(withheld)}, whose writes never leave the device.`,
      `${commandPath}.steps`,
    ),
  );
}
function describeObjectSyncModes(modesByObject: Map<string, SyncMode>): string {
  return [...modesByObject].map(([objectName, mode]) => `'${objectName}' (${mode})`).join(", ");
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

  if (input.repeated && input.defaultValue !== undefined) {
    /*
     * A default is one value and a repeated input carries a list, so there is
     * no reading of a declared default that is not either a silently wrapped
     * single-item list or a silently ignored declaration.
     */
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_INPUT_REPEATED_DEFAULT_INVALID,
        `Command '${command.name}' input '${input.name}' is repeated, so it must not declare a default value.`,
        `${inputPath}.defaultValue`,
      ),
    );
  } else if (
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

  if (!input.repeated && input.itemFields.length > 0) {
    // Item fields describe the shape of one element of a list. A single-valued
    // input has no elements, so the declaration would never be read.
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_INPUT_ITEM_FIELDS_INVALID,
        `Command '${command.name}' input '${input.name}' declares item fields but is not repeated.`,
        `${inputPath}.itemFields`,
      ),
    );
  }

  reportDuplicateNames(
    input.itemFields,
    `${inputPath}.itemFields`,
    MODEL_VALIDATION_CODES.COMMAND_INPUT_ITEM_FIELD_DUPLICATE,
    diagnostics,
    `Item field names must be unique within command '${command.name}' input '${input.name}'.`,
  );

  for (let itemFieldIndex = 0; itemFieldIndex < input.itemFields.length; itemFieldIndex += 1) {
    const itemField = input.itemFields[itemFieldIndex];
    if (itemField === undefined) {
      continue;
    }
    if (!FIELD_TYPES.has(itemField.type)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.COMMAND_INPUT_ITEM_FIELD_TYPE_INVALID,
          `Command '${command.name}' input '${input.name}' item field '${itemField.name}' has invalid type '${String(itemField.type)}'.`,
          `${inputPath}.itemFields[${itemFieldIndex}].type`,
        ),
      );
    }
  }
}
function validateCommandPrecondition(
  precondition: ResolvedCommandPrecondition,
  preconditionPath: string,
  command: ResolvedCommand,
  inputFieldsByName: Map<string, NamedReference<ResolvedField>>,
  diagnostics: Diagnostic[],
): void {
  const preconditionType = validateExpression(
    precondition.expression,
    `${preconditionPath}.expression`,
    inputFieldsByName,
    {
      invalid: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
      field: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_FIELD_UNKNOWN,
      runtime: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_RUNTIME_PROPERTY_INVALID,
      type: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
    },
    diagnostics,
  );

  if (preconditionType !== "boolean" && preconditionType !== "unknown") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
        `Command '${command.name}' precondition '${precondition.name}' must resolve to boolean, not ${preconditionType}.`,
        `${preconditionPath}.expression`,
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
  if (step.action !== "create" && step.action !== "update" && step.action !== "read") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_STEP_ACTION_INVALID,
        `Command '${command.name}' step '${rawStep.name ?? "<unnamed>"}' has invalid action '${String(rawStep.action)}'.`,
        `${stepPath}.action`,
      ),
    );
    return;
  }

  // A read step writes nothing, so `authority` (a write-authorization bypass)
  // does not apply to it: it always enforces the caller's own read policy,
  // the same gate a direct API/UI read would go through.
  if (step.action !== "read" && !COMMAND_STEP_AUTHORITIES.has(step.authority)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_AUTHORITY_INVALID,
        `Command '${command.name}' step '${step.name}' has invalid authority '${String(step.authority)}'.`,
        `${stepPath}.authority`,
      ),
    );
  }

  // A read step never iterates (see `ResolvedCommandReadStep`), so it is
  // never a valid `forEach` target and reads no item/index expression.
  const iteration: CommandStepIteration =
    step.action === "read"
      ? { iterates: false }
      : validateCommandStepIteration(step, stepPath, command, inputsByName, diagnostics);

  if (step.action === "create" && step.establishesContext !== undefined) {
    const establishedContext = indexes.contextsByName.get(step.establishesContext)?.item;
    if (establishedContext === undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.COMMAND_STEP_CONTEXT_UNKNOWN,
          `Command '${command.name}' step '${step.name}' establishes unknown business context '${step.establishesContext}'.`,
          `${stepPath}.establishesContext`,
        ),
      );
    } else if (establishedContext.object !== step.object) {
      /*
       * The step puts *its own new record* in reach for the rest of the
       * transaction. If the record is not an instance of the context's object,
       * there is no instance to put in reach, and the declaration would either
       * do nothing or reach a context instance the caller did not create.
       */
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.COMMAND_STEP_CONTEXT_OBJECT_MISMATCH,
          `Command '${command.name}' step '${step.name}' establishes business context '${step.establishesContext}', whose object is '${establishedContext.object}', but the step creates '${step.object}'.`,
          `${stepPath}.establishesContext`,
        ),
      );
    }
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
  // A read step writes nothing, so it has no values/patch map to check field
  // names against; the loop below runs zero times for it.
  const values =
    step.action === "create" ? step.values : step.action === "update" ? step.patch : {};
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
      iteration,
      indexes,
      diagnostics,
    );
  }

  if (step.action === "update" || step.action === "read") {
    validateCommandValueExpression(
      step.recordId,
      `${stepPath}.recordId`,
      command,
      inputsByName,
      previousStepsByName,
      iteration,
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
    const preconditionType = validateExpression(
      precondition,
      `${stepPath}.preconditions[${preconditionIndex}]`,
      fieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
        field: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
      },
      diagnostics,
    );
    if (preconditionType !== "boolean" && preconditionType !== "unknown") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.COMMAND_PRECONDITION_INVALID,
          `Command '${command.name}' step '${step.name}' precondition must resolve to boolean, not ${preconditionType}.`,
          `${stepPath}.preconditions[${preconditionIndex}]`,
        ),
      );
    }
  }
}
/**
 * What a step's value expressions are allowed to say about iteration.
 *
 * `iterates` is whether the step declared `forEach` at all, which is what
 * decides whether `item` and `itemIndex` mean anything. `input` is the declared
 * repeated input when it resolved, which is what `item.field` is checked
 * against; it stays undefined when `forEach` itself was already reported, so a
 * single mistake produces a single diagnostic.
 */
interface CommandStepIteration {
  iterates: boolean;
  input?: ResolvedCommandInput;
}
function validateCommandStepIteration(
  step: ResolvedCommandStep,
  stepPath: string,
  command: ResolvedCommand,
  inputsByName: Map<string, NamedReference<ResolvedCommandInput>>,
  diagnostics: Diagnostic[],
): CommandStepIteration {
  if (step.forEach === undefined) {
    return { iterates: false };
  }

  const input = inputsByName.get(step.forEach)?.item;

  if (input === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_STEP_FOR_EACH_UNKNOWN,
        `Command '${command.name}' step '${step.name}' iterates unknown input '${step.forEach}'.`,
        `${stepPath}.forEach`,
      ),
    );
    return { iterates: true };
  }

  if (!input.repeated) {
    // A single-valued input has one value, so "one write per item" has no
    // meaning; the step would silently become an ordinary single write.
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.COMMAND_STEP_FOR_EACH_NOT_REPEATED,
        `Command '${command.name}' step '${step.name}' iterates input '${step.forEach}', which is not repeated.`,
        `${stepPath}.forEach`,
      ),
    );
    return { iterates: true };
  }

  return { iterates: true, input };
}
function validateCommandValueExpression(
  expression: ResolvedCommandValueExpression,
  expressionPath: string,
  command: ResolvedCommand,
  inputsByName: Map<string, NamedReference<ResolvedCommandInput>>,
  previousStepsByName: Map<string, ResolvedCommandStep>,
  iteration: CommandStepIteration,
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

      reportIteratingStepReference(step, expressionPath, command, diagnostics);

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
    case "stepMeta": {
      const step = previousStepsByName.get(expression.step);
      if (step === undefined) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_REFERENCE_UNKNOWN,
            `Command '${command.name}' expression references unknown or later step '${expression.step}'.`,
            `${expressionPath}.step`,
          ),
        );
      } else {
        reportIteratingStepReference(step, expressionPath, command, diagnostics);
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
    case "item": {
      if (!iteration.iterates) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_ITEM_OUTSIDE_FOR_EACH,
            `Command '${command.name}' expression references the current item, but the step does not iterate an input.`,
            `${expressionPath}.kind`,
          ),
        );
        return;
      }

      const input = iteration.input;
      if (input === undefined) {
        // The iterated input itself was already reported; naming a field of an
        // item whose shape is unknown adds nothing.
        return;
      }

      if (input.itemFields.length === 0) {
        if (expression.field !== undefined) {
          diagnostics.push(
            diagnostic(
              MODEL_VALIDATION_CODES.COMMAND_STEP_ITEM_FIELD_UNKNOWN,
              `Command '${command.name}' expression reads item field '${expression.field}', but input '${input.name}' carries plain ${input.type} values and its items have no fields.`,
              `${expressionPath}.field`,
            ),
          );
        }
        return;
      }

      if (
        expression.field !== undefined &&
        !input.itemFields.some((itemField) => itemField.name === expression.field)
      ) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_ITEM_FIELD_UNKNOWN,
            `Command '${command.name}' expression reads unknown item field '${expression.field}' of input '${input.name}'.`,
            `${expressionPath}.field`,
          ),
        );
      }
      return;
    }
    case "itemIndex":
      if (!iteration.iterates) {
        diagnostics.push(
          diagnostic(
            MODEL_VALIDATION_CODES.COMMAND_STEP_ITEM_OUTSIDE_FOR_EACH,
            `Command '${command.name}' expression references the current item index, but the step does not iterate an input.`,
            `${expressionPath}.kind`,
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
/**
 * An iterating step writes one record per item, so "the record step X created"
 * names a set rather than a record. There is no single answer for a later step
 * to read, and picking one — the first, the last — would be a runtime invention
 * the model never asked for.
 */
function reportIteratingStepReference(
  step: ResolvedCommandStep,
  expressionPath: string,
  command: ResolvedCommand,
  diagnostics: Diagnostic[],
): void {
  if (step.forEach === undefined) {
    return;
  }

  diagnostics.push(
    diagnostic(
      MODEL_VALIDATION_CODES.COMMAND_STEP_ITERATING_REFERENCE,
      `Command '${command.name}' expression references step '${step.name}', which iterates input '${step.forEach}' and so produces many records rather than one.`,
      `${expressionPath}.step`,
    ),
  );
}
