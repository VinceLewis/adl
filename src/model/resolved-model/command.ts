import type { FieldType, JsonValue } from "./shared.js";
import type { ResolvedExpression } from "./expression.js";
import type { PartialPolicyConditionModel } from "./policy.js";

export type CommandStepAction = "create" | "update";
export type CommandStepAuthority = "caller" | "command";
export type CommandRuntimeProperty = "userId" | "nowIso" | "today";
export type CommandStepMetaProperty = "guid" | "createdAt" | "updatedAt";
export interface ResolvedCommand {
  name: string;
  label?: string;
  preconditions: ResolvedCommandPrecondition[];
  inputs: ResolvedCommandInput[];
  steps: ResolvedCommandStep[];
}
export interface ResolvedCommandPrecondition {
  name: string;
  expression: ResolvedExpression;
  message: string;
}
export interface ResolvedCommandInput {
  name: string;
  type: FieldType;
  required: boolean;
  defaultValue?: JsonValue;
  /**
   * Whether this input carries a list rather than one value.
   *
   * A command's steps are fixed at authoring time, so without this the number
   * of records a command can write is fixed too, and importing fifty songs
   * means fifty independent transactions with no shared success or failure.
   */
  repeated: boolean;
  /**
   * The shape of one item, when items are records rather than scalars. Empty
   * means the list carries plain {@link ResolvedCommandInput.type} values.
   */
  itemFields: ResolvedCommandInputItemField[];
}
export interface ResolvedCommandInputItemField {
  name: string;
  type: FieldType;
  required: boolean;
}
export type ResolvedCommandStep =
  | ResolvedCommandCreateStep
  | ResolvedCommandUpdateStep
  | ResolvedCommandReadStep;
export interface ResolvedCommandCreateStep {
  name: string;
  action: "create";
  object: string;
  authority: CommandStepAuthority;
  values: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
  /**
   * Names a repeated input this step iterates. The step then plans one write
   * per item into the same transaction, so a batch either lands whole or not at
   * all — the guarantee a caller looping over single writes cannot get.
   */
  forEach?: string;
  /**
   * Names the business context this step's new record *becomes an instance of*.
   *
   * Creating a context and its first membership in one transaction is otherwise
   * impossible: the membership record is scoped to a context instance that did
   * not exist when the transaction began, so the object-scope gate refuses it,
   * and the context is left with no members and therefore no way in. Declaring
   * this puts the new instance in reach **for the rest of this transaction
   * only**. It reaches no context that already existed, so it cannot hand a
   * caller anything they did not just create.
   */
  establishesContext?: string;
}
export interface ResolvedCommandUpdateStep {
  name: string;
  action: "update";
  object: string;
  authority: CommandStepAuthority;
  recordId: ResolvedCommandValueExpression;
  patch: Record<string, ResolvedCommandValueExpression>;
  preconditions: ResolvedExpression[];
  /** See {@link ResolvedCommandCreateStep.forEach}. */
  forEach?: string;
}
/**
 * Reads one existing record by id and binds it under this step's name, so a
 * later `create`/`update` step's value expressions can reference its fields
 * with the same `{ kind: "stepField" }`/`{ kind: "stepMeta" }` expressions an
 * earlier `create`/`update` step's own written record already supports —
 * seeding a new record from an existing one ("duplicate this record, but with
 * a blank date") without a second expression kind.
 *
 * Goes through the identical policy-gated read path a direct API/UI read
 * would (`ObjectStore.read`): object scope, row policy, and field-level read
 * shaping (mask/hidden) all apply, so a command cannot see more of the source
 * record than the caller could see by reading it directly. A denied read or a
 * record that does not exist fails the whole command before any write is
 * planned, exactly as any other step failure does.
 *
 * Deliberately has no `authority`, `values`/`patch`, or `forEach`: a read
 * step writes nothing, so there is no write to authorize or iterate, and no
 * bypass of the caller's own read policy is offered the way `authority:
 * "command"` offers one for a write.
 */
export interface ResolvedCommandReadStep {
  name: string;
  action: "read";
  object: string;
  recordId: ResolvedCommandValueExpression;
  preconditions: ResolvedExpression[];
  /**
   * Always absent. A read step never iterates (there is no repeated input to
   * plan one read per item for), so `reportIteratingStepReference` and
   * `validateCommandStepIteration` can keep treating {@link
   * ResolvedCommandStep.forEach} as a plain optional field across every step
   * kind rather than narrowing by `action` at each call site.
   */
  forEach?: never;
}
export type ResolvedCommandValueExpression =
  | { kind: "literal"; value: JsonValue }
  | { kind: "input"; name: string }
  | { kind: "runtime"; property: CommandRuntimeProperty }
  | { kind: "stepField"; step: string; field: string }
  | { kind: "stepMeta"; step: string; property: CommandStepMetaProperty }
  /** The current item of an iterating step, or one of its fields. */
  | { kind: "item"; field?: string }
  /** The current item's zero-based position in the list. */
  | { kind: "itemIndex" };
export interface PartialCommandModel {
  name: string;
  label?: string;
  preconditions?: PartialCommandPreconditionModel[];
  inputs?: PartialCommandInputModel[];
  steps?: PartialCommandStepModel[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialCommandPreconditionModel {
  name: string;
  expression: PartialPolicyConditionModel;
  message?: string;
}
export interface PartialCommandInputModel {
  name: string;
  type?: FieldType;
  required?: boolean;
  defaultValue?: JsonValue;
  repeated?: boolean;
  itemFields?: PartialCommandInputItemFieldModel[];
}
export interface PartialCommandInputItemFieldModel {
  name: string;
  type?: FieldType;
  required?: boolean;
}
export type PartialCommandStepModel =
  | PartialCommandCreateStepModel
  | PartialCommandUpdateStepModel
  | PartialCommandReadStepModel;
export interface PartialCommandCreateStepModel {
  name: string;
  action: "create";
  object: string;
  authority?: CommandStepAuthority;
  values?: Record<string, ResolvedCommandValueExpression>;
  preconditions?: PartialPolicyConditionModel[];
  forEach?: string;
  establishesContext?: string;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialCommandUpdateStepModel {
  name: string;
  action: "update";
  object: string;
  authority?: CommandStepAuthority;
  recordId: ResolvedCommandValueExpression;
  patch?: Record<string, ResolvedCommandValueExpression>;
  preconditions?: PartialPolicyConditionModel[];
  forEach?: string;
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
export interface PartialCommandReadStepModel {
  name: string;
  action: "read";
  object: string;
  recordId: ResolvedCommandValueExpression;
  preconditions?: PartialPolicyConditionModel[];
  /** A leading `#`/`//` comment block from `.adl` text, or `.adlj`'s `"comment"` key. */
  comment?: string;
}
