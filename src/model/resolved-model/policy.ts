import type { JsonValue } from "./shared.js";
import type { ResolvedExpression } from "./expression.js";
import type { RuntimeChannel } from "./sync.js";

export type PolicyEffect = "allow" | "deny" | "readonly" | "mask" | "hidden";
export type PolicyAction =
  | "*"
  | "create"
  | "read"
  | "update"
  | "delete"
  | "search"
  | "transition"
  | "export"
  | "import";
/**
 * What the caller's relationship to the record must be for a rule to match.
 *
 * `self` is "this record *is* the caller": it matches when the record's own id
 * equals `RuntimeContext.userId`, and nothing else. It is distinct from `owner`
 * ("I created this", or a declared owner field names me) and from
 * `authenticated` ("I am somebody"), and it is the only principal that grants a
 * whole row to exactly one caller. Because the object-level `search` check is
 * evaluated with no record at all, a `self` rule can never widen enumeration —
 * which is why `ADL_POLICY_SELF_SEARCH_UNREACHABLE` refuses that combination at
 * compile time rather than shipping a grant that looks live and is dead.
 */
export type PrincipalMatch =
  | "everyone"
  | "authenticated"
  | "anonymous"
  | "owner"
  | "self"
  | "specific"
  | "contextMember";
export type PolicyConditionKind = "equals" | "all" | "any" | "not";
export type PolicyConditionRuntimeProperty = "userId";
export interface ResolvedPolicy {
  name: string;
  object: string;
  defaultEffect: "deny";
  rules: ResolvedPolicyRule[];
}
export interface ResolvedPolicyRule {
  name: string;
  effect: PolicyEffect;
  principal: ResolvedPrincipalSelector;
  action: PolicyAction;
  state: string[];
  fields: string[];
  lifecycleAction?: string;
  condition?: ResolvedExpression;
  channels: RuntimeChannel[];
}
export type ResolvedPolicyCondition =
  | ResolvedEqualsPolicyCondition
  | ResolvedAllPolicyCondition
  | ResolvedAnyPolicyCondition
  | ResolvedNotPolicyCondition;
export interface ResolvedEqualsPolicyCondition {
  kind: "equals";
  left: ResolvedPolicyConditionOperand;
  right: ResolvedPolicyConditionOperand;
}
export interface ResolvedAllPolicyCondition {
  kind: "all";
  conditions: (ResolvedPolicyCondition | ResolvedExpression)[];
}
export interface ResolvedAnyPolicyCondition {
  kind: "any";
  conditions: (ResolvedPolicyCondition | ResolvedExpression)[];
}
export interface ResolvedNotPolicyCondition {
  kind: "not";
  condition: ResolvedPolicyCondition;
}
export type ResolvedPolicyConditionOperand =
  | { kind: "field"; field: string }
  | { kind: "runtime"; property: PolicyConditionRuntimeProperty }
  | { kind: "literal"; value: JsonValue };
export interface ResolvedPrincipalSelector {
  match: PrincipalMatch;
  roles: string[];
  groupRoles: string[];
  users: string[];
  owner: boolean;
  contextMember?: ResolvedContextMemberPrincipal;
}
/**
 * "Whoever this record belongs to is in a context with me."
 *
 * `owner` says a record is the caller's own and roles say what a caller may do
 * inside a context. Neither says the thing a shared roster needs: that a record
 * belonging to *somebody else* is visible because the two of them are in the
 * same context instance. Expressing that with a role instead would grant it
 * over every record of the object, including those of people the caller shares
 * nothing with.
 *
 * It is evaluated against {@link RuntimeContext.contextMembers}, which the
 * runtime resolves from the same accepted membership records
 * `listAvailableContexts` reads. Absent membership data never matches, so the
 * principal fails closed.
 */
export interface ResolvedContextMemberPrincipal {
  /** The business context whose members match. */
  context: string;
  /** The field on the target record naming the user who must be a co-member. */
  field: string;
}
export interface PartialPolicyModel {
  name: string;
  object: string;
  defaultEffect?: "deny";
  rules?: PartialPolicyRuleModel[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialPolicyRuleModel {
  name: string;
  effect: PolicyEffect;
  principal?: PartialPrincipalSelectorModel;
  action: PolicyAction;
  state?: string | string[];
  fields?: string[];
  lifecycleAction?: string;
  condition?: PartialPolicyConditionModel;
  channels?: RuntimeChannel[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export type PartialPolicyConditionModel = ResolvedExpression | ResolvedPolicyCondition;
export interface PartialPrincipalSelectorModel {
  match?: PrincipalMatch;
  roles?: string[];
  groupRoles?: string[];
  users?: string[];
  owner?: boolean;
  contextMember?: ResolvedContextMemberPrincipal;
}
