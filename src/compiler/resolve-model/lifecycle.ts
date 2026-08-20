import { DEFAULT_LIFECYCLE_STATE_FIELD } from "../../model/defaults.js";
import type {
  PartialHookRefsModel,
  PartialLifecycleActionModel,
  PartialLifecycleGuardModel,
  PartialLifecycleModel,
  PartialStateModel,
  ResolvedHookRefs,
  ResolvedLifecycle,
  ResolvedLifecycleAction,
  ResolvedLifecycleGuard,
  ResolvedState,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";

export function resolveLifecycle(input: PartialLifecycleModel): ResolvedLifecycle {
  const states = input.states.map(resolveState);
  const initialState = input.initialState ?? states[0]?.name;

  return {
    name: input.name,
    stateField: input.stateField ?? DEFAULT_LIFECYCLE_STATE_FIELD,
    ...(initialState === undefined ? {} : { initialState }),
    states,
    actions: (input.actions ?? []).map(resolveLifecycleAction),
  };
}
function resolveState(input: PartialStateModel): ResolvedState {
  return {
    name: input.name,
    terminal: input.terminal ?? false,
  };
}
function resolveLifecycleAction(input: PartialLifecycleActionModel): ResolvedLifecycleAction {
  return {
    name: input.name,
    from: Array.isArray(input.from) ? [...input.from] : [input.from],
    to: input.to,
    ...(input.label === undefined ? {} : { label: input.label }),
    guards: (input.guards ?? []).map(resolveLifecycleGuard),
    policyRefs: [...(input.policyRefs ?? [])],
    hooks: resolveHookRefs(input.hooks),
  };
}
function resolveLifecycleGuard(input: PartialLifecycleGuardModel): ResolvedLifecycleGuard {
  return {
    name: input.name,
    expression: resolveExpression(input.expression),
    message: input.message ?? `Lifecycle guard '${input.name}' failed.`,
  };
}
function resolveHookRefs(input: PartialHookRefsModel | undefined): ResolvedHookRefs {
  return {
    before: [...(input?.before ?? [])],
    after: [...(input?.after ?? [])],
    onError: [...(input?.onError ?? [])],
  };
}
