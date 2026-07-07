import {
  HookError,
  LifecycleError,
  ModelValidationError,
  PolicyDeniedError,
  RuntimeError,
  RuntimeValidationError,
  StorageError,
} from "../runtime/runtime-types.js";
import type { UiMessage, UiMessageKind } from "./types.js";

let nextMessageId = 1;

export function successMessage(title: string, details: string[] = []): UiMessage {
  return createMessage("success", title, details);
}

export function infoMessage(title: string, details: string[] = []): UiMessage {
  return createMessage("info", title, details);
}

export function messageFromRuntimeError(error: unknown): UiMessage {
  if (error instanceof ModelValidationError) {
    return createMessage(
      "error",
      "Resolved model failed validation.",
      error.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      error.code,
    );
  }

  if (error instanceof RuntimeValidationError) {
    return createMessage(
      "error",
      error.message,
      error.issues.map((issue) => `${issue.field ?? issue.path ?? issue.code}: ${issue.message}`),
      error.code,
    );
  }

  if (error instanceof PolicyDeniedError) {
    return createMessage(
      "error",
      error.message,
      error.decision.reasons.map((reason) => reason.message),
      error.code,
    );
  }

  if (
    error instanceof LifecycleError ||
    error instanceof StorageError ||
    error instanceof HookError ||
    error instanceof RuntimeError
  ) {
    return createMessage("error", error.message, [], error.code);
  }

  if (error instanceof Error) {
    return createMessage("error", error.message);
  }

  return createMessage("error", "An unknown runtime error occurred.");
}

function createMessage(
  kind: UiMessageKind,
  title: string,
  details: string[] = [],
  code?: string,
): UiMessage {
  const message = {
    id: `ui-message-${nextMessageId++}`,
    kind,
    title,
    details,
  };

  return code === undefined ? message : { ...message, code };
}
