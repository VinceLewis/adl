import type {
  PartialApplicationModel,
  PartialBusinessContextModel,
  PartialContextGrantModel,
  PartialContextMembershipModel,
  PartialContextSelectionPolicyModel,
  ResolvedBusinessContext,
  ResolvedContextGrant,
  ResolvedContextMembership,
  ResolvedContextSelectionPolicy,
  ResolvedRole,
} from "../../model/resolved-model.js";
import { resolveExpression } from "./expression.js";

export function resolveRoles(
  roles: ResolvedRole[] | PartialApplicationModel["roles"],
): ResolvedRole[] {
  return (roles ?? []).map((role) => ({
    name: role.name,
    ...(role.description === undefined ? {} : { description: role.description }),
    inherits: [...(role.inherits ?? [])],
  }));
}
export function resolveBusinessContexts(
  contexts: PartialBusinessContextModel[],
): ResolvedBusinessContext[] {
  return contexts.map(resolveBusinessContext);
}
function resolveBusinessContext(input: PartialBusinessContextModel): ResolvedBusinessContext {
  return {
    name: input.name,
    object: input.object ?? input.name,
    selection: resolveContextSelection(input.selection),
    ...(input.membership === undefined
      ? {}
      : { membership: resolveContextMembership(input.membership) }),
    grants: (input.grants ?? []).map(resolveContextGrant),
  };
}
function resolveContextGrant(input: PartialContextGrantModel): ResolvedContextGrant {
  return {
    name: input.name,
    object: input.object,
    userField: input.userField,
    contextField: input.contextField,
    ...(input.condition === undefined ? {} : { condition: resolveExpression(input.condition) }),
  };
}
function resolveContextSelection(
  input: PartialContextSelectionPolicyModel | undefined,
): ResolvedContextSelectionPolicy {
  return {
    mode: input?.mode ?? "optional",
    autoSelect: input?.autoSelect ?? true,
    persistence: input?.persistence ?? "none",
    source: input?.source ?? "runtime",
    ...(input?.routeParam === undefined ? {} : { routeParam: input.routeParam }),
  };
}
function resolveContextMembership(input: PartialContextMembershipModel): ResolvedContextMembership {
  return {
    object: input.object,
    userField: input.userField,
    contextField: input.contextField,
    roleField: input.roleField,
    roles: [...(input.roles ?? [])],
  };
}
