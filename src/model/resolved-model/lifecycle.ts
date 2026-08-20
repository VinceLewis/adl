import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";

export interface ResolvedLifecycle {
  name: string;
  stateField: string;
  initialState?: string;
  states: ResolvedState[];
  actions: ResolvedLifecycleAction[];
}
export interface ResolvedState {
  name: string;
  terminal: boolean;
}
export interface ResolvedLifecycleAction {
  name: string;
  from: string[];
  to: string;
  label?: string;
  guards: ResolvedLifecycleGuard[];
  policyRefs: string[];
  hooks: ResolvedHookRefs;
}
export interface ResolvedLifecycleGuard {
  name: string;
  expression: ResolvedExpression;
  message: string;
}
export interface ResolvedHookRefs {
  before: string[];
  after: string[];
  onError: string[];
}
export interface PartialLifecycleModel {
  name: string;
  stateField?: string;
  initialState?: string;
  states: PartialStateModel[];
  actions?: PartialLifecycleActionModel[];
}
export interface PartialStateModel {
  name: string;
  terminal?: boolean;
}
export interface PartialLifecycleActionModel {
  name: string;
  from: string | string[];
  to: string;
  label?: string;
  guards?: PartialLifecycleGuardModel[];
  policyRefs?: string[];
  hooks?: PartialHookRefsModel;
}
export interface PartialLifecycleGuardModel {
  name: string;
  expression: PartialPolicyConditionModel;
  message?: string;
}
export interface PartialHookRefsModel {
  before?: string[];
  after?: string[];
  onError?: string[];
}
