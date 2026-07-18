import type {
  FieldType,
  JsonValue,
  ResolvedApplicationModel,
  ResolvedCommand,
  ResolvedCommandInput,
  ResolvedCommandPrecondition,
  ResolvedCommandStep,
  ResolvedCommandValueExpression,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { evaluateRuntimeCondition } from "./condition-evaluator.js";
import { RuntimeModelIndex } from "./model-helpers.js";
import type { ObjectStore, PlannedObjectWrite } from "./object-store.js";
import {
  PolicyDeniedError,
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
  objectName: string;
  recordId: string;
  record: StoredObjectRecord;
}

export interface RuntimeCommandResult {
  command: ResolvedCommand;
  steps: RuntimeCommandStepResult[];
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
    const stepRecords = new Map<string, StoredObjectRecord>();

    for (const step of command.steps) {
      if (step.action === "update") {
        const recordId = this.evaluateRecordIdExpression(
          step.recordId,
          values,
          stepRecords,
          context,
        );
        const existing = await this.objectStore.getRecordForRuntime(step.object, recordId);
        if (existing === null) {
          throw new StorageError(
            `Command '${command.name}' step '${step.name}' could not find '${step.object}' record '${recordId}'.`,
            { commandName: command.name, step: step.name, objectName: step.object, recordId },
          );
        }
        this.requireStepPreconditions(command, step, existing.values, context);
        const patch = this.evaluateExpressionMap(step.patch, values, stepRecords, context);
        const write = await this.objectStore.planUpdateForTransaction(
          step.object,
          recordId,
          patch,
          context,
          step.authority,
        );
        plannedWrites.push(write);
        stepRecords.set(step.name, cloneJson(write.record));
        continue;
      }

      const recordValues = this.evaluateExpressionMap(step.values, values, stepRecords, context);
      this.requireStepPreconditions(command, step, recordValues, context);
      const write = await this.objectStore.planCreateForTransaction(
        step.object,
        recordValues,
        context,
        step.authority,
      );
      plannedWrites.push(write);
      stepRecords.set(step.name, cloneJson(write.record));
    }

    const committed = await this.objectStore.commitPlannedTransaction(plannedWrites, context, {
      command: {
        name: command.name,
        ...(command.label === undefined ? {} : { label: command.label }),
        steps: command.steps.map((step) => step.name),
      },
    });
    const result: RuntimeCommandResult = {
      command,
      steps: committed.map((record, index) => ({
        step: command.steps[index]?.name ?? `step${index + 1}`,
        objectName: record.meta.object,
        recordId: record.meta.guid,
        record,
      })),
    };
    this.logger.debug("EXIT CommandService.execute", {
      commandName,
      count: result.steps.length,
    });
    return result;
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

      if (!isValueCompatible(commandInput.type, value)) {
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
  ): Record<string, JsonValue> {
    return Object.fromEntries(
      Object.entries(expressions).map(([field, expression]) => [
        field,
        this.evaluateExpression(expression, input, stepRecords, context),
      ]),
    );
  }

  private evaluateRecordIdExpression(
    expression: ResolvedCommandValueExpression,
    input: Record<string, JsonValue>,
    stepRecords: Map<string, StoredObjectRecord>,
    context: RuntimeContext,
  ): string {
    const value = this.evaluateExpression(expression, input, stepRecords, context);
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
    }
  }
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
