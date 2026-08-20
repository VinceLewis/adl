/**
 * Presentation state: the defaults a view's `STATE` declarations initialise to,
 * and the type-checked application of a state update.
 *
 * One area of `presentation-runtime.ts`; see
 * `learnings/implementation/presentation-runtime-file-map.md` for the file map
 * and the rules that keep it working.
 */
import type {
  JsonValue,
  ResolvedPresentationState,
  ResolvedView,
} from "../../model/resolved-model.js";
import { cloneJson } from "../runtime-types.js";
import type { RuntimePresentationDiagnostic } from "./types.js";

export function initializePresentationState(view: ResolvedView): Record<string, JsonValue> {
  if (view.presentation === undefined) {
    return {};
  }

  return Object.fromEntries(
    view.presentation.state.map((state) => [state.name, cloneJson(state.defaultValue)]),
  );
}

export function applyPresentationStateUpdates(
  view: ResolvedView,
  currentState: Record<string, JsonValue>,
  updates: Record<string, JsonValue>,
): { state: Record<string, JsonValue>; diagnostics: RuntimePresentationDiagnostic[] } {
  const diagnostics: RuntimePresentationDiagnostic[] = [];
  const stateDefinitions = new Map(
    (view.presentation?.state ?? []).map((definition) => [definition.name, definition]),
  );
  const next = cloneJson(currentState);

  for (const [name, value] of Object.entries(updates)) {
    const definition = stateDefinitions.get(name);
    if (definition === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_STATE_UNKNOWN",
        message: `Presentation state '${name}' is not declared on view '${view.name}'.`,
        path: `presentation.state.${name}`,
      });
      continue;
    }

    if (!valueMatchesPresentationStateType(value, definition)) {
      diagnostics.push({
        severity: "warning",
        code: "ADL_PRESENTATION_STATE_TYPE_MISMATCH",
        message: `Presentation state '${name}' expected ${definition.type}.`,
        path: `presentation.state.${name}`,
      });
      continue;
    }

    next[name] = cloneJson(value);
  }

  return { state: next, diagnostics };
}

export function valueMatchesPresentationStateType(
  value: JsonValue,
  definition: ResolvedPresentationState,
): boolean {
  if (value === null) {
    return (
      definition.type === "date" || definition.type === "datetime" || definition.type === "time"
    );
  }

  switch (definition.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "text":
    case "date":
    case "datetime":
    case "time":
      return typeof value === "string";
  }
}
