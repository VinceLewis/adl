import type {
  FieldType,
  JsonValue,
  LocalCommandRecordId,
  ResolvedApplicationModel,
  ResolvedCommand,
  ResolvedCommandCreateStep,
  ResolvedCommandInput,
  ResolvedCommandPrecondition,
  ResolvedCommandReadStep,
  ResolvedCommandStep,
  ResolvedCommandUpdateStep,
  ResolvedCommandValueExpression,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { evaluateRuntimeCondition } from "./condition-evaluator.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import type { ObjectStore, PlannedObjectWrite } from "./object-store.js";
import {
  CommandRecordIdsMismatchError,
  PolicyDeniedError,
  RecordIdUnavailableError,
  RuntimeValidationError,
  StorageError,
  cloneJson,
  getContextNowIso,
  noopRuntimeLogger,
  safeContextLog,
} from "./runtime-types.js";
import type {
  PolicyDecision,
  RuntimeContext,
  RuntimeLogger,
  RuntimeValidationIssue,
} from "./runtime-types.js";

export interface RuntimeCommandStepResult {
  step: string;
  /** Which write of the step this is, for a step that iterates; absent otherwise. */
  itemIndex?: number;
  /** Whether the step created this record or updated an existing one. */
  operation: "create" | "update";
  objectName: string;
  recordId: string;
  record: StoredObjectRecord;
}

export interface RuntimeCommandResult {
  command: ResolvedCommand;
  steps: RuntimeCommandStepResult[];
}

export interface CommandExecutionOptions {
  /**
   * Ids the originating device already holds for the records this command
   * creates, in planned order.
   *
   * Supplied when the authority re-executes a command a device executed offline:
   * without them the re-execution mints its own ids and every created record
   * comes back naming a row the device does not have. Absent for a local
   * execution, which mints its own.
   */
  recordIds?: LocalCommandRecordId[];
}

export class CommandService {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly objectStore: ObjectStore,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
    private readonly startupGuard: () => Promise<void> = async () => undefined,
  ) {}

  async execute(
    commandName: string,
    input: Record<string, JsonValue>,
    context: RuntimeContext,
    options: CommandExecutionOptions = {},
  ): Promise<RuntimeCommandResult> {
    await this.startupGuard();
    this.logger.debug("ENTER CommandService.execute", {
      commandName,
      context: safeContextLog(context),
    });
    const command = this.index.getCommand(commandName);
    const values = this.prepareInput(command, input);
    this.requireCommandPreconditions(command, values, context);
    const plannedWrites: PlannedObjectWrite[] = [];
    // Parallel to `plannedWrites`: an iterating step contributes several writes,
    // so the committed records can no longer be matched to steps by index.
    const writeSteps: string[] = [];
    const writeFrames: (number | undefined)[] = [];
    // Consumed in planning order by every create, which is the only order in
    // which the two executions can be checked against each other at all.
    const supplied = new SuppliedRecordIds(command, options.recordIds);
    const stepRecords = new Map<string, StoredObjectRecord>();
    // Grows as steps establish contexts, so a later step writing into a context
    // an earlier step just created passes the scope gate. It is discarded with
    // this call; nothing outside the transaction ever sees it.
    let stepContext = context;

    for (const step of command.steps) {
      for (const frame of this.iterationFrames(command, step, values)) {
        if (step.action === "read") {
          // A read step writes nothing: it never joins `plannedWrites`, is
          // never committed, and never appears in the command's result. It
          // exists only to bind a record for a later step's value
          // expressions, exactly as a `create`/`update` step's own written
          // record already does.
          const record = await this.planStepRead(
            command,
            step,
            values,
            frame,
            stepRecords,
            context,
            stepContext,
          );
          if (frame === undefined) {
            stepRecords.set(step.name, cloneJson(record));
          }
          continue;
        }

        const write = await this.planStepWrite(
          command,
          step,
          values,
          frame,
          stepRecords,
          {
            callerContext: context,
            stepContext,
          },
          supplied,
        );
        plannedWrites.push(write);
        writeSteps.push(step.name);
        writeFrames.push(frame?.index);
        // An iterating step produces many records, so binding its name to the
        // last one would silently mislead a later `STEP x FIELD y` reference.
        // Validation refuses those references; not recording the binding is
        // what makes that refusal true at runtime rather than merely declared.
        if (frame === undefined) {
          stepRecords.set(step.name, cloneJson(write.record));
        }

        if (step.action === "create" && step.establishesContext !== undefined) {
          stepContext = withEstablishedContext(
            stepContext,
            step.establishesContext,
            write.record.meta.guid,
          );
        }
      }
    }

    // An unconsumed entry means the caller's execution planned a write this one
    // did not, which is the same disagreement as a mismatched entry and is
    // refused for the same reason.
    supplied.requireExhausted();

    const committed = await this.objectStore.commitPlannedTransaction(plannedWrites, context, {
      command: {
        name: command.name,
        ...(command.label === undefined ? {} : { label: command.label }),
        steps: [...writeSteps],
        frames: [...writeFrames],
        input: cloneJson(values),
      },
    });
    const result: RuntimeCommandResult = {
      command,
      steps: committed.map((record, index) => {
        const frame = writeFrames[index];
        return {
          step: writeSteps[index] ?? `step${index + 1}`,
          ...(frame === undefined ? {} : { itemIndex: frame }),
          operation: plannedWrites[index]?.operation === "update" ? "update" : "create",
          objectName: record.meta.object,
          recordId: record.meta.guid,
          record,
        } satisfies RuntimeCommandStepResult;
      }),
    };
    this.logger.debug("EXIT CommandService.execute", {
      commandName,
      count: result.steps.length,
    });
    return result;
  }

  /**
   * One frame per write the step will plan.
   *
   * A non-iterating step yields a single `undefined` frame, which keeps the
   * ordinary path free of any list concept rather than making every step
   * pretend to be a list of one.
   */
  private iterationFrames(
    command: ResolvedCommand,
    step: ResolvedCommandStep,
    values: Record<string, JsonValue>,
  ): (CommandIterationFrame | undefined)[] {
    if (step.forEach === undefined) {
      return [undefined];
    }

    const list = values[step.forEach];
    if (!Array.isArray(list)) {
      throw new RuntimeValidationError(
        `Command '${command.name}' step '${step.name}' expects input '${step.forEach}' to be a list.`,
        [
          {
            code: "ADL_RUNTIME_COMMAND_INPUT_NOT_A_LIST",
            message: `Command '${command.name}' input '${step.forEach}' must be a list to iterate.`,
            path: `input.${step.forEach}`,
            field: step.forEach,
          },
        ],
      );
    }

    return list.map((item, index) => ({ item, index }));
  }

  private async planStepWrite(
    command: ResolvedCommand,
    step: ResolvedCommandCreateStep | ResolvedCommandUpdateStep,
    values: Record<string, JsonValue>,
    frame: CommandIterationFrame | undefined,
    stepRecords: Map<string, StoredObjectRecord>,
    contexts: { callerContext: RuntimeContext; stepContext: RuntimeContext },
    supplied: SuppliedRecordIds,
  ): Promise<PlannedObjectWrite> {
    const { callerContext, stepContext } = contexts;

    if (step.action === "update") {
      const recordId = this.evaluateRecordIdExpression(
        step.recordId,
        values,
        stepRecords,
        callerContext,
        frame,
      );
      const existing = await this.objectStore.getRecordForRuntime(step.object, recordId);
      if (existing === null) {
        throw new StorageError(
          `Command '${command.name}' step '${step.name}' could not find '${step.object}' record '${recordId}'.`,
          { commandName: command.name, step: step.name, objectName: step.object, recordId },
        );
      }
      this.requireStepPreconditions(command, step, existing.values, callerContext);
      const patch = this.evaluateExpressionMap(
        step.patch,
        values,
        stepRecords,
        callerContext,
        frame,
      );
      return this.objectStore.planUpdateForTransaction(
        step.object,
        recordId,
        patch,
        stepContext,
        step.authority,
      );
    }

    const recordValues = this.evaluateExpressionMap(
      step.values,
      values,
      stepRecords,
      callerContext,
      frame,
    );
    this.requireStepPreconditions(command, step, recordValues, callerContext);
    // The id is adopted, never trusted: `planCreateForTransaction` shape-checks
    // it and refuses one that already names a record, after scope, policy and
    // field policy have allowed the create. Naming a record grants nothing.
    const recordId = supplied.take(step, frame);
    return this.objectStore.planCreateForTransaction(
      step.object,
      recordValues,
      stepContext,
      step.authority,
      recordId === undefined ? {} : { recordId },
    );
  }

  /**
   * Reads one existing record for a `read` step, through the identical
   * policy-gated path (`ObjectStore.read`) a direct API/UI read of the same
   * record would go through: object scope, row policy, and field-level read
   * shaping (mask/hidden) all apply. A command step gets no more of the
   * record than the caller could see by reading it directly, and a denial
   * throws `PolicyDeniedError` exactly as a direct read would — failing this
   * whole command before any write is planned or committed, since planning
   * happens before `commitPlannedTransaction` is ever called.
   *
   * A missing record is a `StorageError`, matching how an `update` step's own
   * "does the target still exist" check already fails the command (see
   * `planStepWrite`) — a read step is not a new failure shape, only a new
   * reason to reach the existing one.
   */
  private async planStepRead(
    command: ResolvedCommand,
    step: ResolvedCommandReadStep,
    values: Record<string, JsonValue>,
    frame: CommandIterationFrame | undefined,
    stepRecords: Map<string, StoredObjectRecord>,
    callerContext: RuntimeContext,
    stepContext: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    const recordId = this.evaluateRecordIdExpression(
      step.recordId,
      values,
      stepRecords,
      callerContext,
      frame,
    );
    const record = await this.objectStore.read(step.object, recordId, stepContext);
    if (record === null) {
      throw new StorageError(
        `Command '${command.name}' step '${step.name}' could not find '${step.object}' record '${recordId}'.`,
        { commandName: command.name, step: step.name, objectName: step.object, recordId },
      );
    }
    this.requireStepPreconditions(command, step, record.values, callerContext);
    return record;
  }

  private prepareInput(
    command: ResolvedCommand,
    input: Record<string, JsonValue>,
  ): Record<string, JsonValue> {
    const output: Record<string, JsonValue> = {};
    const issues: RuntimeValidationIssue[] = [];
    const inputsByName = new Map(
      command.inputs.map((commandInput) => [commandInput.name, commandInput]),
    );

    for (const [name, value] of Object.entries(input)) {
      const commandInput = inputsByName.get(name);
      if (commandInput === undefined) {
        issues.push({
          code: "ADL_RUNTIME_COMMAND_INPUT_UNKNOWN",
          message: `Command '${command.name}' does not define input '${name}'.`,
          path: `input.${name}`,
          field: name,
        });
        continue;
      }

      if (commandInput.repeated) {
        issues.push(...repeatedInputIssues(command, commandInput, value));
      } else if (!isValueCompatible(commandInput.type, value)) {
        issues.push(commandInputTypeIssue(command, commandInput, value));
        continue;
      }

      output[name] = cloneJson(value);
    }

    for (const commandInput of command.inputs) {
      if (output[commandInput.name] === undefined && commandInput.defaultValue !== undefined) {
        output[commandInput.name] = cloneJson(commandInput.defaultValue);
      }

      if (commandInput.required && isMissingRequiredValue(output[commandInput.name])) {
        issues.push({
          code: "ADL_RUNTIME_COMMAND_INPUT_REQUIRED",
          message: `Command '${command.name}' requires input '${commandInput.name}'.`,
          path: `input.${commandInput.name}`,
          field: commandInput.name,
        });
      }
    }

    if (issues.length > 0) {
      throw new RuntimeValidationError(`Command '${command.name}' input is invalid.`, issues);
    }

    return output;
  }

  private requireStepPreconditions(
    command: ResolvedCommand,
    step: ResolvedCommandStep,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): void {
    const failed = step.preconditions.find(
      (condition) => !evaluateRuntimeCondition(condition, { values, context }),
    );

    if (failed === undefined) {
      return;
    }

    const decision: PolicyDecision = {
      effect: "deny",
      reasons: [
        {
          policyName: `Command:${command.name}`,
          ruleName: `${step.name}Precondition`,
          effect: "deny",
          message: `Command '${command.name}' step '${step.name}' precondition failed.`,
        },
      ],
    };

    throw new PolicyDeniedError(
      `Command '${command.name}' step '${step.name}' was denied.`,
      decision,
    );
  }

  private requireCommandPreconditions(
    command: ResolvedCommand,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
  ): void {
    const failed = command.preconditions.find(
      (precondition) => !evaluateRuntimeCondition(precondition.expression, { values, context }),
    );

    if (failed === undefined) {
      return;
    }

    throw new PolicyDeniedError(
      `Command '${command.name}' was denied.`,
      commandPreconditionDecision(command, failed),
    );
  }

  private evaluateExpressionMap(
    expressions: Record<string, ResolvedCommandValueExpression>,
    input: Record<string, JsonValue>,
    stepRecords: Map<string, StoredObjectRecord>,
    context: RuntimeContext,
    frame: CommandIterationFrame | undefined,
  ): Record<string, JsonValue> {
    return Object.fromEntries(
      Object.entries(expressions).map(([field, expression]) => [
        field,
        this.evaluateExpression(expression, input, stepRecords, context, frame),
      ]),
    );
  }

  private evaluateRecordIdExpression(
    expression: ResolvedCommandValueExpression,
    input: Record<string, JsonValue>,
    stepRecords: Map<string, StoredObjectRecord>,
    context: RuntimeContext,
    frame: CommandIterationFrame | undefined,
  ): string {
    const value = this.evaluateExpression(expression, input, stepRecords, context, frame);
    if (typeof value !== "string" || value.length === 0) {
      throw new RuntimeValidationError("Command record id expression did not resolve to text.", [
        {
          code: "ADL_RUNTIME_COMMAND_RECORD_ID_INVALID",
          message: "Command record id expression must resolve to a non-empty text value.",
        },
      ]);
    }

    return value;
  }

  private evaluateExpression(
    expression: ResolvedCommandValueExpression,
    input: Record<string, JsonValue>,
    stepRecords: Map<string, StoredObjectRecord>,
    context: RuntimeContext,
    frame: CommandIterationFrame | undefined,
  ): JsonValue {
    switch (expression.kind) {
      case "literal":
        return cloneJson(expression.value);
      case "input":
        return cloneJson(input[expression.name] ?? null);
      case "runtime":
        switch (expression.property) {
          case "userId":
            return context.userId;
          case "nowIso":
            return getContextNowIso(context);
          case "today":
            return getContextNowIso(context).slice(0, 10);
        }
        return null;
      case "stepField":
        return cloneJson(stepRecords.get(expression.step)?.values[expression.field] ?? null);
      case "stepMeta": {
        const record = stepRecords.get(expression.step);
        switch (expression.property) {
          case "guid":
            return record?.meta.guid ?? null;
          case "createdAt":
            return record?.meta.createdAt ?? null;
          case "updatedAt":
            return record?.meta.updatedAt ?? null;
        }
        return null;
      }
      case "item": {
        if (frame === undefined) {
          return null;
        }
        if (expression.field === undefined) {
          return cloneJson(frame.item);
        }
        return isJsonObject(frame.item) ? cloneJson(frame.item[expression.field] ?? null) : null;
      }
      case "itemIndex":
        return frame?.index ?? null;
    }
  }
}

/** The item an iterating step is currently planning a write for. */
interface CommandIterationFrame {
  item: JsonValue;
  index: number;
}

/**
 * The caller-supplied record-id manifest, consumed in planning order.
 *
 * Matching is positional *and* named. Positional alone would silently attach
 * the id for item 3 to item 4 if the two executions disagreed about a list;
 * named alone could not distinguish two writes of the same iterating step. Both
 * together mean an adopted id is either the id for exactly the write it names or
 * a refusal, with no third outcome.
 *
 * With no manifest every `take` returns undefined, which is the ordinary local
 * execution: the runtime mints its own ids and nothing here applies.
 */
class SuppliedRecordIds {
  private cursor = 0;

  constructor(
    private readonly command: ResolvedCommand,
    private readonly entries: LocalCommandRecordId[] | undefined,
  ) {
    this.requireDistinct();
  }

  /**
   * Refuses a manifest that names one id twice for the same object, before any
   * write is planned.
   *
   * `planCreateForTransaction` detects a taken id by reading storage, and every
   * write in a command is planned *before* any of them is committed — so the
   * second plan's lookup cannot see the first plan's id. Both plans passed and
   * the duplicate landed as a PostgreSQL primary-key violation at commit, which
   * is not a `RuntimeError`: `AuthorityService.classifyFailure` returned null,
   * `replay` rethrew, the client saw a transport failure, and the queue entry
   * stayed replayable for ever. This is exactly the failure
   * `learnings/implementation/offline-operation-identity.md` describes — "a
   * durable rejection is only reachable by detecting the collision first" —
   * reached by a route Phase 48 did not have.
   *
   * It is checked here rather than alongside the storage lookup because it is
   * pure input validation: the caller supplied both ids, so refusing them
   * discloses nothing about what exists, and the existence-oracle ordering that
   * governs the storage check does not apply. The code is the same one a taken
   * id raises, because the question and the caller's remedy are the same.
   *
   * An honest client cannot produce one — `ObjectStore` mints a distinct id per
   * write — so this is hardening against a manifest that arrives over the wire.
   */
  private requireDistinct(): void {
    if (this.entries === undefined) {
      return;
    }

    const seen = new Set<string>();
    for (const entry of this.entries) {
      // Keyed by object as well as id: storage is keyed per object, so the same
      // id under two different objects is not a collision and must not be
      // refused as one. Neither part can contain a NUL, so the separator is
      // unambiguous.
      const key = `${entry.objectName}\0${entry.recordId}`;
      if (seen.has(key)) {
        throw new RecordIdUnavailableError(
          `Command '${this.command.name}' names the same '${entry.objectName}' record id more than once.`,
          { commandName: this.command.name, objectName: entry.objectName },
        );
      }
      seen.add(key);
    }
  }

  take(step: ResolvedCommandStep, frame: CommandIterationFrame | undefined): string | undefined {
    if (this.entries === undefined) {
      return undefined;
    }

    const entry = this.entries[this.cursor];
    this.cursor += 1;
    if (entry === undefined) {
      throw new CommandRecordIdsMismatchError(
        `Command '${this.command.name}' plans more records than the supplied record ids describe.`,
        { commandName: this.command.name, step: step.name },
      );
    }
    if (
      entry.step !== step.name ||
      entry.objectName !== step.object ||
      entry.itemIndex !== frame?.index
    ) {
      throw new CommandRecordIdsMismatchError(
        `Command '${this.command.name}' step '${step.name}' does not match the supplied record id at position ${this.cursor - 1}.`,
        { commandName: this.command.name, step: step.name, position: this.cursor - 1 },
      );
    }

    return entry.recordId;
  }

  requireExhausted(): void {
    if (this.entries === undefined || this.cursor === this.entries.length) {
      return;
    }

    throw new CommandRecordIdsMismatchError(
      `Command '${this.command.name}' plans fewer records than the supplied record ids describe.`,
      {
        commandName: this.command.name,
        planned: this.cursor,
        supplied: this.entries.length,
      },
    );
  }
}

/**
 * Puts a just-created context instance in reach for the remainder of a command
 * transaction. It adds a grant, never a role, so the steps that follow still
 * face every policy rule; what changes is only that the object-scope gate stops
 * refusing a context that did not exist when the transaction opened.
 */
function withEstablishedContext(
  context: RuntimeContext,
  contextName: string,
  contextId: string,
): RuntimeContext {
  return {
    ...context,
    contextGrants: [...(context.contextGrants ?? []), { context: contextName, contextId }],
  };
}

function commandInputTypeIssue(
  command: ResolvedCommand,
  input: ResolvedCommandInput,
  value: JsonValue,
): RuntimeValidationIssue {
  return {
    code: "ADL_RUNTIME_COMMAND_INPUT_TYPE",
    message: `Command '${command.name}' input '${input.name}' expects a ${input.type} value, received '${String(value)}'.`,
    path: `input.${input.name}`,
    field: input.name,
  };
}

function commandPreconditionDecision(
  command: ResolvedCommand,
  precondition: ResolvedCommandPrecondition,
): PolicyDecision {
  return {
    effect: "deny",
    reasons: [
      {
        policyName: `Command:${command.name}`,
        ruleName: precondition.name,
        effect: "deny",
        message: precondition.message,
      },
    ],
  };
}

/**
 * Checks a repeated input item by item.
 *
 * Every item is reported rather than only the first, because a fifty-song
 * import that fails one row at a time is fifty round trips to discover what a
 * single reply could have said.
 */
function repeatedInputIssues(
  command: ResolvedCommand,
  input: ResolvedCommandInput,
  value: JsonValue,
): RuntimeValidationIssue[] {
  if (!Array.isArray(value)) {
    return [
      {
        code: "ADL_RUNTIME_COMMAND_INPUT_NOT_A_LIST",
        message: `Command '${command.name}' input '${input.name}' expects a list.`,
        path: `input.${input.name}`,
        field: input.name,
      },
    ];
  }

  const issues: RuntimeValidationIssue[] = [];
  value.forEach((item, index) => {
    const path = `input.${input.name}[${index}]`;

    if (input.itemFields.length === 0) {
      if (!isValueCompatible(input.type, item)) {
        issues.push({
          code: "ADL_RUNTIME_COMMAND_INPUT_TYPE",
          message: `Command '${command.name}' input '${input.name}' expects ${input.type} items.`,
          path,
          field: input.name,
        });
      }
      return;
    }

    if (!isJsonObject(item)) {
      issues.push({
        code: "ADL_RUNTIME_COMMAND_INPUT_ITEM_INVALID",
        message: `Command '${command.name}' input '${input.name}' expects record items.`,
        path,
        field: input.name,
      });
      return;
    }

    for (const itemField of input.itemFields) {
      const fieldValue = item[itemField.name];
      if (fieldValue === undefined || fieldValue === null) {
        if (itemField.required) {
          issues.push({
            code: "ADL_RUNTIME_COMMAND_INPUT_ITEM_REQUIRED",
            message: `Command '${command.name}' input '${input.name}' requires item field '${itemField.name}'.`,
            path: `${path}.${itemField.name}`,
            field: itemField.name,
          });
        }
        continue;
      }

      if (!isValueCompatible(itemField.type, fieldValue)) {
        issues.push({
          code: "ADL_RUNTIME_COMMAND_INPUT_ITEM_TYPE",
          message: `Command '${command.name}' input '${input.name}' item field '${itemField.name}' expects a ${itemField.type} value.`,
          path: `${path}.${itemField.name}`,
          field: itemField.name,
        });
      }
    }
  });

  return issues;
}

function isMissingRequiredValue(value: JsonValue | undefined): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

function isValueCompatible(type: FieldType, value: JsonValue): boolean {
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
      return typeof value === "string" || Array.isArray(value) || isJsonObject(value);
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
