import { createDefaultDenyPolicy, createEveryonePrincipal } from "../../model/defaults.js";
import type {
  PartialPolicyModel,
  PartialPolicyRuleModel,
  PartialPrincipalSelectorModel,
  ResolvedExpression,
  ResolvedObject,
  ResolvedPolicy,
  ResolvedPolicyCondition,
  ResolvedPolicyConditionOperand,
  ResolvedPolicyRule,
  ResolvedPrincipalSelector,
} from "../../model/resolved-model.js";
import { asArray } from "./shared.js";
import { resolveExpression } from "./expression.js";

export function resolvePolicies(
  objects: ResolvedObject[],
  inputPolicies: PartialPolicyModel[],
): ResolvedPolicy[] {
  return [
    ...objects.map((object) => createDefaultDenyPolicy(object.name)),
    ...inputPolicies.map(resolvePolicy),
  ];
}
function resolvePolicy(input: PartialPolicyModel): ResolvedPolicy {
  return {
    name: input.name,
    object: input.object,
    defaultEffect: "deny",
    rules: (input.rules ?? []).map(resolvePolicyRule),
  };
}
function resolvePolicyRule(input: PartialPolicyRuleModel): ResolvedPolicyRule {
  return {
    name: input.name,
    effect: input.effect,
    principal: resolvePrincipal(input.principal),
    action: input.action,
    state: asArray(input.state),
    fields: [...(input.fields ?? [])],
    ...(input.lifecycleAction === undefined ? {} : { lifecycleAction: input.lifecycleAction }),
    ...(input.condition === undefined ? {} : { condition: resolveExpression(input.condition) }),
    channels: [...(input.channels ?? ["ui", "api", "sync", "import", "test"])],
  };
}
export function foldConditions(
  conditions: (ResolvedExpression | ResolvedPolicyCondition)[],
  operator: "and" | "or",
  emptyValue: boolean,
): ResolvedExpression {
  const [first, ...rest] = conditions;
  if (first === undefined) {
    return { kind: "literal", value: emptyValue };
  }

  return rest.reduce<ResolvedExpression>(
    (left, condition) => ({
      kind: "binary",
      operator,
      left,
      right: resolveExpression(condition),
    }),
    resolveExpression(first),
  );
}
export function resolvePolicyConditionOperand(
  operand: ResolvedPolicyConditionOperand,
): ResolvedExpression {
  switch (operand.kind) {
    case "field":
      return { kind: "field", field: operand.field };
    case "runtime":
      return { kind: "runtime", property: operand.property };
    case "literal":
      if (
        typeof operand.value === "string" ||
        typeof operand.value === "number" ||
        typeof operand.value === "boolean" ||
        operand.value === null
      ) {
        return { kind: "literal", value: operand.value };
      }

      return { kind: "literal", value: JSON.stringify(operand.value) };
  }
}
function resolvePrincipal(
  input: PartialPrincipalSelectorModel | undefined,
): ResolvedPrincipalSelector {
  const defaults = createEveryonePrincipal();
  return {
    match: input?.match ?? defaults.match,
    roles: [...(input?.roles ?? defaults.roles)],
    groupRoles: [...(input?.groupRoles ?? defaults.groupRoles)],
    users: [...(input?.users ?? defaults.users)],
    owner: input?.owner ?? defaults.owner,
    ...(input?.contextMember === undefined
      ? {}
      : {
          contextMember: {
            context: input.contextMember.context,
            field: input.contextMember.field,
          },
        }),
  };
}
export function groupPolicyNamesByObject(policies: ResolvedPolicy[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const policy of policies) {
    grouped.set(policy.object, [...(grouped.get(policy.object) ?? []), policy.name]);
  }

  return grouped;
}
