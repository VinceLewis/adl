import type { FieldType, JsonValue } from "./shared.js";
import type { ResolvedExpression } from "./expression.js";
import type { PartialLifecycleModel, ResolvedLifecycle } from "./lifecycle.js";
import type { PartialPolicyConditionModel } from "./policy.js";
import type { PartialViewModel, ResolvedView } from "./view.js";
import type {
  PartialObjectAuditPolicyModel,
  PartialObjectSyncPolicyModel,
  ResolvedObjectAuditPolicy,
  ResolvedObjectSyncPolicy,
} from "./sync.js";

export type ValidatorKind =
  | "email"
  | "min"
  | "max"
  | "minLength"
  | "maxLength"
  | "in"
  | "regexp"
  | "currencyCode"
  | "maxSize"
  | "mimeType"
  | "predicate";
export type ObjectConstraintKind = "unique" | "ordered" | "protectedRole";
export type OrderedCollectionReorder = "strict" | "shift";
export type OrderedCollectionCompaction = "none" | "onDelete";
export interface ResolvedObject {
  name: string;
  schemaVersion: number;
  tableName: string;
  systemIdField: string;
  businessKey?: string;
  displayField?: string;
  fields: ResolvedField[];
  computedFields: ResolvedComputedField[];
  metadataFields: ResolvedMetadataField[];
  scope?: ResolvedObjectScope;
  constraints: ResolvedObjectConstraint[];
  validations: ResolvedObjectValidation[];
  lifecycle?: ResolvedLifecycle;
  policies: string[];
  views: ResolvedView[];
  sync: ResolvedObjectSyncPolicy;
  audit: ResolvedObjectAuditPolicy;
}
export interface ResolvedObjectScope {
  context: string;
  field: string;
}
export interface ResolvedField {
  name: string;
  storageName: string;
  type: FieldType;
  required: boolean;
  defaultValue?: JsonValue;
  validators: ResolvedValidator[];
  readonly: boolean;
  hidden: boolean;
  lookup?: ResolvedLookup;
  autoId?: ResolvedAutoId;
  systemManaged: boolean;
}
export type ComputedFieldStrategy = "readTime";
export interface ResolvedComputedField {
  name: string;
  storageName: string;
  type: FieldType;
  expression: ResolvedExpression;
  strategy: ComputedFieldStrategy;
  dependencies: string[];
  evaluationOrder: number;
  readonly: true;
  hidden: false;
  systemManaged: true;
}
export interface ResolvedMetadataField {
  name: string;
  storageName: string;
  type: FieldType;
  required: boolean;
  readonly: true;
  hidden: true;
  systemManaged: true;
  description: string;
}
export type ResolvedValidator = ResolvedNamedValidator | ResolvedPredicateValidator;
export type ResolvedNamedValidatorKind = Exclude<ValidatorKind, "predicate">;
export interface ResolvedNamedValidator {
  kind: ResolvedNamedValidatorKind;
  value?: JsonValue;
}
export interface ResolvedPredicateValidator {
  kind: "predicate";
  expression: ResolvedExpression;
  message?: string;
}
export interface ResolvedLookup {
  targetObject: string;
  targetField?: string;
  displayField: string;
}
export interface ResolvedAutoId {
  prefix?: string;
  pad?: number;
  scopeField?: string;
}
export type ResolvedObjectConstraint =
  | ResolvedUniqueObjectConstraint
  | ResolvedOrderedObjectConstraint
  | ResolvedProtectedRoleObjectConstraint;
export interface ResolvedUniqueObjectConstraint {
  name: string;
  kind: "unique";
  fields: string[];
  scopeFields: string[];
}
export interface ResolvedOrderedObjectConstraint {
  name: string;
  kind: "ordered";
  parentField: string;
  positionField: string;
  scopeFields: string[];
  minPosition: number;
  /**
   * What happens when a write lands on a position a sibling already holds.
   *
   * `strict` refuses it, which is the original behaviour and stays the default:
   * a duplicate position is a genuine error in a collection nobody reorders.
   * `shift` makes the collection reorderable — the platform moves the
   * intervening siblings in the same transaction, so an author can express
   * "put this third" without also having to express every consequence of it.
   */
  reorder: OrderedCollectionReorder;
  /**
   * Whether removing an item closes the gap it leaves.
   *
   * `none` keeps the hole, which is what deleting has always done. `onDelete`
   * renumbers the later siblings down in the same transaction as the delete, so
   * positions stay contiguous from {@link minPosition} without a caller having
   * to walk the collection itself.
   */
  compaction: OrderedCollectionCompaction;
}
/**
 * The "last admin standing" guard: refuses a delete or an update that would
 * leave fewer than {@link ResolvedProtectedRoleObjectConstraint.minCount}
 * active records whose {@link ResolvedProtectedRoleObjectConstraint.roleField}
 * holds one of {@link ResolvedProtectedRoleObjectConstraint.roleValues} within
 * the same {@link ResolvedProtectedRoleObjectConstraint.scopeFields} key.
 *
 * It is declared once, on the membership-shaped object itself, and enforced by
 * every write path that reaches {@link ResolvedObject.constraints} —
 * direct CRUD and command steps alike — never only by UI affordance. An empty
 * `scopeFields` guards the whole object rather than a scoped subset of it.
 */
export interface ResolvedProtectedRoleObjectConstraint {
  name: string;
  kind: "protectedRole";
  scopeFields: string[];
  roleField: string;
  roleValues: JsonValue[];
  minCount: number;
}
export interface ResolvedObjectValidation {
  name: string;
  expression: ResolvedExpression;
  message: string;
}
export interface PartialObjectModel {
  name: string;
  schemaVersion?: number;
  tableName?: string;
  systemIdField?: string;
  businessKey?: string;
  displayField?: string;
  fields?: PartialFieldModel[];
  computedFields?: PartialComputedFieldModel[];
  scope?: PartialObjectScopeModel;
  constraints?: PartialObjectConstraintModel[];
  validations?: PartialObjectValidationModel[];
  lifecycle?: PartialLifecycleModel;
  policies?: string[];
  views?: PartialViewModel[];
  sync?: PartialObjectSyncPolicyModel;
  audit?: PartialObjectAuditPolicyModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialComputedFieldModel {
  name: string;
  storageName?: string;
  type: FieldType;
  expression: ResolvedExpression;
  strategy?: ComputedFieldStrategy;
}
export interface PartialObjectScopeModel {
  context: string;
  field: string;
}
export interface PartialFieldModel {
  name: string;
  storageName?: string;
  type?: FieldType;
  required?: boolean;
  defaultValue?: JsonValue;
  validators?: PartialValidatorModel[];
  readonly?: boolean;
  hidden?: boolean;
  lookup?: PartialLookupModel;
  autoId?: PartialAutoIdModel;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export type PartialValidatorModel = PartialNamedValidatorModel | PartialPredicateValidatorModel;
export interface PartialNamedValidatorModel {
  kind: ResolvedNamedValidatorKind;
  value?: JsonValue;
}
export interface PartialPredicateValidatorModel {
  kind: "predicate";
  expression: ResolvedExpression;
  message?: string;
}
export interface PartialLookupModel {
  targetObject: string;
  targetField?: string;
  displayField: string;
}
export interface PartialAutoIdModel {
  prefix?: string;
  pad?: number;
  scopeField?: string;
}
export type PartialObjectConstraintModel =
  | PartialUniqueObjectConstraintModel
  | PartialOrderedObjectConstraintModel
  | PartialProtectedRoleObjectConstraintModel;
export interface PartialUniqueObjectConstraintModel {
  name: string;
  kind: "unique";
  fields: string[];
  scopeFields?: string[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialOrderedObjectConstraintModel {
  name: string;
  kind: "ordered";
  parentField: string;
  positionField: string;
  scopeFields?: string[];
  minPosition?: number;
  reorder?: OrderedCollectionReorder;
  compaction?: OrderedCollectionCompaction;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialProtectedRoleObjectConstraintModel {
  name: string;
  kind: "protectedRole";
  scopeFields?: string[];
  roleField: string;
  roleValues: JsonValue[];
  minCount?: number;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialObjectValidationModel {
  name: string;
  expression: PartialPolicyConditionModel;
  message?: string;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
