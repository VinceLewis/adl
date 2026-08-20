import type {
  PolicyAction,
  ResolvedField,
  ResolvedObject,
  ResolvedPolicy,
  ResolvedPolicyRule,
  ResolvedPrincipalSelector,
  RuntimeChannel,
} from "../../model/resolved-model.js";
import { MODEL_VALIDATION_CODES } from "./codes.js";
import type { Diagnostic } from "./codes.js";
import { diagnostic, indexByName } from "./shared.js";
import type { ModelIndexes, NamedReference } from "./shared.js";
import { validateExpression } from "./expression.js";

const POLICY_ACTIONS = new Set<PolicyAction>([
  "*",
  "create",
  "read",
  "update",
  "delete",
  "search",
  "transition",
  "export",
  "import",
]);
const RUNTIME_CHANNELS = new Set<RuntimeChannel>(["ui", "api", "sync", "import", "test"]);
export function validatePolicy(
  policy: ResolvedPolicy,
  policyIndex: number,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const policyPath = `policies[${policyIndex}]`;
  const object = indexes.objectsByName.get(policy.object)?.item;

  if (policy.defaultEffect !== "deny") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_DEFAULT_EFFECT_INVALID,
        `Policy '${policy.name}' has invalid default effect '${String(policy.defaultEffect)}'.`,
        `${policyPath}.defaultEffect`,
      ),
    );
  }

  if (object === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_OBJECT_UNKNOWN,
        `Policy '${policy.name}' references unknown object '${policy.object}'.`,
        `${policyPath}.object`,
      ),
    );
    return;
  }

  const fieldsByName = indexByName(object.fields);
  const statesByName =
    object.lifecycle === undefined
      ? new Map<string, NamedReference<unknown>>()
      : indexByName(object.lifecycle.states);
  const actionsByName =
    object.lifecycle === undefined
      ? new Map<string, NamedReference<unknown>>()
      : indexByName(object.lifecycle.actions);

  for (let ruleIndex = 0; ruleIndex < policy.rules.length; ruleIndex += 1) {
    const rule = policy.rules[ruleIndex];
    if (rule === undefined) {
      continue;
    }
    validatePolicyRule(
      rule,
      `${policyPath}.rules[${ruleIndex}]`,
      object,
      fieldsByName,
      statesByName,
      actionsByName,
      indexes,
      diagnostics,
    );
  }
}
function validatePolicyRule(
  rule: ResolvedPolicyRule,
  rulePath: string,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  statesByName: Map<string, NamedReference<unknown>>,
  actionsByName: Map<string, NamedReference<unknown>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  if (!POLICY_ACTIONS.has(rule.action)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_ACTION_INVALID,
        `Policy rule '${rule.name}' has invalid action '${String(rule.action)}'.`,
        `${rulePath}.action`,
      ),
    );
  }

  // A `contextMember` principal is matched against a record
  // (`recordBelongsToContextMember`); `search` is an object-level check
  // evaluated with no record, so there is nothing for the principal to read
  // from and a rule combining the two can never fire. That is worse than a
  // parse error: it looks like a working grant. See
  // learnings/implementation/policy-engine.md.
  if (rule.principal.match === "contextMember" && rule.action === "search") {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_CONTEXT_MEMBER_SEARCH_UNREACHABLE,
        `Policy rule '${rule.name}' grants SEARCH to a CONTEXT_MEMBER principal, which can never match: the object-level search check has no record for the principal to read a context roster from. Grant SEARCH to a wider principal and let per-record read policy restrict rows instead.`,
        `${rulePath}.principal`,
      ),
    );
  }

  // Generalizes the CONTEXT_MEMBER case above to any principal: a `WHEN`
  // condition evaluates against `getCandidateValues(request)` (the record's
  // values overlaid with any patch), and the coarse "may this principal
  // search this object at all" gate that runs before any row is fetched
  // supplies neither -- every field reference resolves to `null`, so the
  // condition can never be true and the rule can never match, no matter which
  // principal it names. This is what let `ALLOW SEARCH AUTHENTICATED WHEN
  // Invitee == runtime.userId` compile clean and be silently dead at runtime
  // in the Jointly Care reference app. See
  // learnings/implementation/policy-engine.md. `EXPORT` does not share this
  // defect: its one call site (`AuthorityReportingService.requireExportAllowed`)
  // always supplies a `record`, one per exported row.
  if (rule.action === "search" && rule.condition !== undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_SEARCH_CONDITION_UNREACHABLE,
        `Policy rule '${rule.name}' has a WHEN condition on SEARCH, which can never match: the object-level search check has no record or patch for the condition to evaluate against. Grant SEARCH unconditionally to this principal and let a paired READ rule's WHEN do the per-row shaping instead.`,
        `${rulePath}.condition`,
      ),
    );
  }

  for (let fieldIndex = 0; fieldIndex < rule.fields.length; fieldIndex += 1) {
    const field = rule.fields[fieldIndex];
    if (field === undefined) {
      continue;
    }
    if (!fieldsByName.has(field)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_FIELD_UNKNOWN,
          `Policy rule '${rule.name}' references unknown field '${field}' on object '${object.name}'.`,
          `${rulePath}.fields[${fieldIndex}]`,
        ),
      );
    }
  }

  for (let stateIndex = 0; stateIndex < rule.state.length; stateIndex += 1) {
    const state = rule.state[stateIndex];
    if (state === undefined) {
      continue;
    }
    if (!statesByName.has(state)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_STATE_UNKNOWN,
          `Policy rule '${rule.name}' references unknown lifecycle state '${state}' on object '${object.name}'.`,
          `${rulePath}.state[${stateIndex}]`,
        ),
      );
    }
  }

  if (rule.lifecycleAction !== undefined && !actionsByName.has(rule.lifecycleAction)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_LIFECYCLE_ACTION_UNKNOWN,
        `Policy rule '${rule.name}' references unknown lifecycle action '${rule.lifecycleAction}' on object '${object.name}'.`,
        `${rulePath}.lifecycleAction`,
      ),
    );
  }

  if (rule.condition !== undefined) {
    const conditionType = validateExpression(
      rule.condition,
      `${rulePath}.condition`,
      fieldsByName,
      {
        invalid: MODEL_VALIDATION_CODES.POLICY_CONDITION_INVALID,
        field: MODEL_VALIDATION_CODES.POLICY_CONDITION_FIELD_UNKNOWN,
        runtime: MODEL_VALIDATION_CODES.POLICY_CONDITION_RUNTIME_PROPERTY_INVALID,
        type: MODEL_VALIDATION_CODES.POLICY_CONDITION_TYPE,
      },
      diagnostics,
    );
    if (conditionType !== "boolean" && conditionType !== "unknown") {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_CONDITION_TYPE,
          `Policy rule '${rule.name}' condition must resolve to boolean, not ${conditionType}.`,
          `${rulePath}.condition`,
        ),
      );
    }
  }

  for (let channelIndex = 0; channelIndex < rule.channels.length; channelIndex += 1) {
    const channel = rule.channels[channelIndex];
    if (channel === undefined) {
      continue;
    }
    if (!RUNTIME_CHANNELS.has(channel)) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_CHANNEL_INVALID,
          `Policy rule '${rule.name}' has invalid runtime channel '${String(channel)}'.`,
          `${rulePath}.channels[${channelIndex}]`,
        ),
      );
    }
  }

  validatePolicyPrincipal(
    rule.principal,
    rule,
    rulePath,
    object,
    fieldsByName,
    indexes,
    diagnostics,
  );
}
/**
 * The `contextMember` principal fails closed at runtime when it cannot resolve a
 * roster, which is right for a request and wrong for a model: a rule that can
 * never match is not a safe default, it is a rule the author believed they had
 * written. A context with no declared membership has no roster to read, so the
 * mismatch is decidable here rather than as an access denial nobody can explain.
 */
function validatePolicyPrincipal(
  principal: ResolvedPrincipalSelector,
  rule: ResolvedPolicyRule,
  rulePath: string,
  object: ResolvedObject,
  fieldsByName: Map<string, NamedReference<ResolvedField>>,
  indexes: ModelIndexes,
  diagnostics: Diagnostic[],
): void {
  const principalPath = `${rulePath}.principal`;

  if (principal.match !== "contextMember") {
    if (principal.contextMember !== undefined) {
      diagnostics.push(
        diagnostic(
          MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBER_UNEXPECTED,
          `Policy rule '${rule.name}' declares a context member principal but matches '${String(principal.match)}', so the declaration is never read.`,
          `${principalPath}.contextMember`,
        ),
      );
    }
    return;
  }

  const contextMember = principal.contextMember;
  if (contextMember === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBER_MISSING,
        `Policy rule '${rule.name}' matches context members but declares no context member selector.`,
        `${principalPath}.contextMember`,
      ),
    );
    return;
  }

  const context = indexes.contextsByName.get(contextMember.context)?.item;
  if (context === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_UNKNOWN,
        `Policy rule '${rule.name}' context member principal references unknown business context '${contextMember.context}'.`,
        `${principalPath}.contextMember.context`,
      ),
    );
  } else if (context.membership === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBERSHIP_MISSING,
        `Policy rule '${rule.name}' matches members of business context '${contextMember.context}', which declares no membership, so the rule can never match.`,
        `${principalPath}.contextMember.context`,
      ),
    );
  }

  if (!fieldsByName.has(contextMember.field)) {
    diagnostics.push(
      diagnostic(
        MODEL_VALIDATION_CODES.POLICY_PRINCIPAL_CONTEXT_MEMBER_FIELD_UNKNOWN,
        `Policy rule '${rule.name}' context member principal references unknown field '${contextMember.field}' on object '${object.name}'.`,
        `${principalPath}.contextMember.field`,
      ),
    );
  }
}
