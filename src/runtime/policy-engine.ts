import type {
  ResolvedApplicationModel,
  ResolvedPolicy,
  ResolvedPolicyRule,
  StoredObjectRecord,
} from "../model/resolved-model.js";
import { RuntimeModelIndex, getRecordState } from "./model-helpers.js";
import { PolicyDeniedError, noopRuntimeLogger } from "./runtime-types.js";
import type {
  PolicyDecision,
  PolicyRequest,
  RuntimeContext,
  RuntimeLogger,
} from "./runtime-types.js";

interface MatchingRule {
  policy: ResolvedPolicy;
  rule: ResolvedPolicyRule;
}

export class PolicyEngine {
  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly index = new RuntimeModelIndex(model),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
  ) {}

  evaluate(request: PolicyRequest, context: RuntimeContext): PolicyDecision {
    this.logger.debug("ENTER PolicyEngine.evaluate", {
      objectName: request.objectName,
      action: request.action,
      field: request.field,
      lifecycleAction: request.lifecycleAction,
    });
    const object = this.index.getObject(request.objectName);
    const currentState = request.currentState ?? getRequestRecordState(this.index, request);
    const matches = this.index
      .getPoliciesForObject(object.name)
      .flatMap((policy) =>
        policy.rules
          .filter((rule) => this.ruleMatches(rule, request, context, currentState))
          .map((rule) => ({ policy, rule })),
      );

    const deny = matches.find((match) => match.rule.effect === "deny");
    if (deny !== undefined) {
      const decision: PolicyDecision = {
        effect: "deny",
        reasons: [
          {
            policyName: deny.policy.name,
            ruleName: deny.rule.name,
            message: `Policy rule '${deny.rule.name}' explicitly denied ${request.action}.`,
          },
        ],
      };
      this.logger.debug("EXIT PolicyEngine.evaluate", { effect: decision.effect });
      return decision;
    }

    const restrictive = findMostRestrictivePresentationRule(matches);
    if (restrictive !== undefined) {
      const decision: PolicyDecision = {
        effect: restrictive.rule.effect,
        reasons: [
          {
            policyName: restrictive.policy.name,
            ruleName: restrictive.rule.name,
            message: `Policy rule '${restrictive.rule.name}' returned ${restrictive.rule.effect}.`,
          },
        ],
      };
      this.logger.debug("EXIT PolicyEngine.evaluate", { effect: decision.effect });
      return decision;
    }

    const allow = matches.find((match) => match.rule.effect === "allow");
    if (allow !== undefined) {
      const decision: PolicyDecision = {
        effect: "allow",
        reasons: [
          {
            policyName: allow.policy.name,
            ruleName: allow.rule.name,
            message: `Policy rule '${allow.rule.name}' allowed ${request.action}.`,
          },
        ],
      };
      this.logger.debug("EXIT PolicyEngine.evaluate", { effect: decision.effect });
      return decision;
    }

    const defaultPolicyName =
      this.index.getPoliciesForObject(object.name).find((policy) => policy.rules.length === 0)
        ?.name ?? `${object.name}DefaultDeny`;
    const decision: PolicyDecision = {
      effect: "deny",
      reasons: [
        {
          policyName: defaultPolicyName,
          message: `No policy rule allowed ${request.action}; default deny applies.`,
        },
      ],
    };
    this.logger.debug("EXIT PolicyEngine.evaluate", { effect: decision.effect });
    return decision;
  }

  requireAllowed(request: PolicyRequest, context: RuntimeContext): PolicyDecision {
    const decision = this.evaluate(request, context);

    if (decision.effect !== "allow") {
      throw new PolicyDeniedError(
        `Policy denied ${request.action} on object '${request.objectName}'.`,
        decision,
      );
    }

    return decision;
  }

  private ruleMatches(
    rule: ResolvedPolicyRule,
    request: PolicyRequest,
    context: RuntimeContext,
    currentState: string | undefined,
  ): boolean {
    const channel = request.channel ?? context.channel;

    if (rule.action !== "*" && rule.action !== request.action) {
      return false;
    }

    if (!rule.channels.includes(channel)) {
      return false;
    }

    if (
      rule.state.length > 0 &&
      (currentState === undefined || !rule.state.includes(currentState))
    ) {
      return false;
    }

    if (rule.lifecycleAction !== undefined && rule.lifecycleAction !== request.lifecycleAction) {
      return false;
    }

    if (request.field === undefined && rule.fields.length > 0) {
      return false;
    }

    if (
      request.field !== undefined &&
      rule.fields.length > 0 &&
      !rule.fields.includes(request.field)
    ) {
      return false;
    }

    if (rule.condition !== undefined) {
      return false;
    }

    return this.principalMatches(rule, request.record, context);
  }

  private principalMatches(
    rule: ResolvedPolicyRule,
    record: StoredObjectRecord | undefined,
    context: RuntimeContext,
  ): boolean {
    const principal = rule.principal;

    switch (principal.match) {
      case "everyone":
        return true;
      case "authenticated":
        return context.userId.length > 0;
      case "anonymous":
        return context.userId.length === 0;
      case "owner":
        return isOwner(record, context.userId);
      case "specific":
        return (
          principal.users.includes(context.userId) ||
          principal.roles.some((role) => this.contextHasRole(context, role)) ||
          principal.groupRoles.some((role) => this.contextHasGroupRole(context, role)) ||
          (principal.owner && isOwner(record, context.userId))
        );
    }
  }

  private contextHasRole(context: RuntimeContext, role: string): boolean {
    return this.index.expandRoles(context.roles).includes(role);
  }

  private contextHasGroupRole(context: RuntimeContext, role: string): boolean {
    return Object.values(context.groups ?? {}).some((roles) => roles.includes(role));
  }
}

function getRequestRecordState(
  index: RuntimeModelIndex,
  request: PolicyRequest,
): string | undefined {
  if (request.record === undefined) {
    return undefined;
  }

  return getRecordState(index.getObject(request.objectName), request.record);
}

function isOwner(record: StoredObjectRecord | undefined, userId: string): boolean {
  if (record === undefined || userId.length === 0) {
    return false;
  }

  return (
    record.meta.createdBy === userId ||
    record.values.OwnerId === userId ||
    record.values.ownerId === userId ||
    record.values.CreatedBy === userId
  );
}

function findMostRestrictivePresentationRule(matches: MatchingRule[]): MatchingRule | undefined {
  return (
    matches.find((match) => match.rule.effect === "hidden") ??
    matches.find((match) => match.rule.effect === "mask") ??
    matches.find((match) => match.rule.effect === "readonly")
  );
}
