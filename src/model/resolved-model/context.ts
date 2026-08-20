import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";

export type ContextSelectionMode = "required" | "optional";
export type ContextSelectionPersistence = "none" | "session" | "local";
export type ContextSelectionSource = "runtime" | "route";
export interface ResolvedRole {
  name: string;
  description?: string;
  inherits: string[];
}
export interface ResolvedBusinessContext {
  name: string;
  object: string;
  selection: ResolvedContextSelectionPolicy;
  membership?: ResolvedContextMembership;
  /**
   * Records that put a context instance *in reach* of a user without making
   * them a member of it.
   *
   * Membership is the only thing that confers context roles, and it stays that
   * way. A grant does one narrower thing: it lets the runtime's object-scope
   * gate accept a record belonging to that context instance, so the object's own
   * policy is the thing that finally decides. Without this, a person holding a
   * pending invitation to a context they have not joined is refused upstream of
   * policy entirely — the invitation is scoped to the very context the
   * invitation is what would get them into — and the rule the model wrote to let
   * an invitee read and accept their own invitation can never be reached.
   */
  grants: ResolvedContextGrant[];
}
/**
 * One declared route into a context that is not membership.
 *
 * A grant names an object whose records associate a user with a context
 * instance, plus an optional condition those records must satisfy. It confers
 * **no roles**: `contextRoles` stays derived from membership alone, so a
 * grant-holder passes the scope gate and then meets exactly the policy rules
 * written for a non-member, never a role-gated one.
 */
export interface ResolvedContextGrant {
  name: string;
  /** The object whose records carry the grant, e.g. an invitation. */
  object: string;
  /** The field naming the granted user. */
  userField: string;
  /** The field naming the context instance the grant reaches. */
  contextField: string;
  /** Evaluated against the grant record; absent means every record grants. */
  condition?: ResolvedExpression;
}
export interface ResolvedContextSelectionPolicy {
  mode: ContextSelectionMode;
  autoSelect: boolean;
  persistence: ContextSelectionPersistence;
  source: ContextSelectionSource;
  routeParam?: string;
}
export interface ResolvedContextMembership {
  object: string;
  userField: string;
  contextField: string;
  roleField: string;
  roles: string[];
}
export interface PartialRoleModel {
  name: string;
  description?: string;
  inherits?: string[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialBusinessContextModel {
  name: string;
  object?: string;
  selection?: PartialContextSelectionPolicyModel;
  membership?: PartialContextMembershipModel;
  grants?: PartialContextGrantModel[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialContextGrantModel {
  name: string;
  object: string;
  userField: string;
  contextField: string;
  condition?: PartialPolicyConditionModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialContextSelectionPolicyModel {
  mode?: ContextSelectionMode;
  autoSelect?: boolean;
  persistence?: ContextSelectionPersistence;
  source?: ContextSelectionSource;
  routeParam?: string;
}
export interface PartialContextMembershipModel {
  object: string;
  userField: string;
  contextField: string;
  roleField: string;
  roles?: string[];
}
