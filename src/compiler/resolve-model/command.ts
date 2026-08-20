import type {
  PartialCommandInputModel,
  PartialCommandModel,
  PartialCommandPreconditionModel,
  PartialCommandStepModel,
  ResolvedCommand,
  ResolvedCommandInput,
  ResolvedCommandPrecondition,
  ResolvedCommandStep,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";

export function resolveCommands(input: PartialCommandModel[]): ResolvedCommand[] {
  return input.map(resolveCommand);
}
function resolveCommand(input: PartialCommandModel): ResolvedCommand {
  return {
    name: input.name,
    ...(input.label === undefined ? {} : { label: input.label }),
    preconditions: (input.preconditions ?? []).map(resolveCommandPrecondition),
    inputs: (input.inputs ?? []).map(resolveCommandInput),
    steps: (input.steps ?? []).map(resolveCommandStep),
  };
}
function resolveCommandPrecondition(
  input: PartialCommandPreconditionModel,
): ResolvedCommandPrecondition {
  return {
    name: input.name,
    expression: resolveExpression(input.expression),
    message: input.message ?? `Command precondition '${input.name}' failed.`,
  };
}
function resolveCommandInput(input: PartialCommandInputModel): ResolvedCommandInput {
  return {
    name: input.name,
    type: input.type ?? "text",
    required: input.required ?? true,
    ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
    repeated: input.repeated ?? false,
    itemFields: (input.itemFields ?? []).map((field) => ({
      name: field.name,
      type: field.type ?? "text",
      required: field.required ?? true,
    })),
  };
}
function resolveCommandStep(input: PartialCommandStepModel): ResolvedCommandStep {
  if (input.action === "update") {
    return {
      name: input.name,
      action: "update",
      object: input.object,
      authority: input.authority ?? "caller",
      recordId: cloneCommandValueExpression(input.recordId),
      patch: cloneCommandValueExpressionMap(input.patch ?? {}),
      preconditions: (input.preconditions ?? []).map(resolveExpression),
      ...(input.forEach === undefined ? {} : { forEach: input.forEach }),
    };
  }

  if (input.action === "read") {
    return {
      name: input.name,
      action: "read",
      object: input.object,
      recordId: cloneCommandValueExpression(input.recordId),
      preconditions: (input.preconditions ?? []).map(resolveExpression),
    };
  }

  return {
    name: input.name,
    action: "create",
    object: input.object,
    authority: input.authority ?? "caller",
    values: cloneCommandValueExpressionMap(input.values ?? {}),
    preconditions: (input.preconditions ?? []).map(resolveExpression),
    ...(input.forEach === undefined ? {} : { forEach: input.forEach }),
    ...(input.establishesContext === undefined
      ? {}
      : { establishesContext: input.establishesContext }),
  };
}
function cloneCommandValueExpressionMap<T extends Record<string, unknown>>(input: T): T {
  return cloneJsonValue(input);
}
function cloneCommandValueExpression<T>(input: T): T {
  return cloneJsonValue(input);
}
export function cloneJsonValue<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
