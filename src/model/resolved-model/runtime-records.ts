import type { JsonValue } from "./shared.js";
import type {
  AuditOperation,
  LocalOperationKind,
  LocalOperationStatus,
  RuntimeChannel,
  SyncStatus,
} from "./sync.js";

export interface PlatformRecordMetadata {
  guid: string;
  object: string;
  schemaVersion: number;
  revision: string;
  state?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt?: string;
  deletedBy?: string;
  syncStatus: SyncStatus;
  /**
   * Set when the write the authority refused was this record's own create, so
   * the authority never accepted this record and holds nothing the device would
   * be destroying by throwing the row away. That is what licenses a local
   * discard; removing a row whose *update* was refused would instead delete
   * something the authority still has and the next bootstrap would restore.
   *
   * Only the authority spends it — by accepting the operation, or by producing a
   * record under that id. The second case matters: a collision is refused
   * *because* the id already names a record the authority holds, and the
   * reconciliation that discloses that record ends the licence, because
   * discarding the row would then remove the authority's record rather than the
   * user's refused work. A local write does not spend it: editing a refused
   * create does not give the authority a copy.
   *
   * Device-local bookkeeping. It is deliberately not a declared `_`-metadata
   * field: a model has no business addressing it, and unlike `_syncStatus` it
   * describes the last verdict rather than the record's state.
   */
  syncRejectedCreate?: boolean;
}
export interface StoredObjectRecord {
  meta: PlatformRecordMetadata;
  values: Record<string, JsonValue>;
}
export interface AuditEvent {
  auditId: string;
  object: string;
  recordId: string;
  operation: AuditOperation;
  commandName?: string;
  commandLabel?: string;
  commandStep?: string;
  commandTransactionId?: string;
  lifecycleAction?: string;
  fromState?: string;
  toState?: string;
  actorId: string;
  occurredAt: string;
  before?: Record<string, JsonValue>;
  after?: Record<string, JsonValue>;
  metadata: PlatformRecordMetadata;
}
export interface ResolvedOperationLogModel {
  enabled: boolean;
  operations: LocalOperationKind[];
  statuses: LocalOperationStatus[];
}
/**
 * One record a locally executed command created, and the id the device already
 * holds for it.
 *
 * A command intent is re-executed by the authority, so without this every record
 * it creates would be named server-side and arrive as a second row beside the
 * one the device is already showing — the Phase 48 duplication defect, returned
 * by a different route. The step name and item index are carried because a
 * `FOR EACH` step writes one record per item, so "the id for step N" is really
 * "the id for item M of step N", and an id adopted against the wrong write would
 * be worse than one that was never supplied.
 *
 * Only creates appear here. An update step names an existing record through its
 * own `ID` expression, and any such expression that reaches for a created
 * record's id resolves to the adopted id for free.
 */
export interface LocalCommandRecordId {
  step: string;
  /** Present only for a step that iterates: which item of that step this id names. */
  itemIndex?: number;
  objectName: string;
  recordId: string;
}
/**
 * A model-declared command as one queued unit of work.
 *
 * The input rather than the resulting writes is what crosses the wire: the
 * authority re-executes the command so that policy, validation, lifecycle,
 * scope, constraints and preconditions all run server-side exactly as they ran
 * locally. The ids are a name for what that re-execution produces, never an
 * authorisation for producing it.
 */
export interface LocalCommandOperation {
  name: string;
  label?: string;
  input: Record<string, JsonValue>;
  /** In planned order, so re-execution can match each id to the write it names. */
  recordIds: LocalCommandRecordId[];
  /** Every record the command wrote, so a verdict can be reported over all of them. */
  records: Array<{ objectName: string; recordId: string }>;
}
/**
 * One record write inside a batched transaction, as the authority must be told
 * about it.
 *
 * A create carries the id the device already minted, for the same reason a
 * create intent does: an authority-minted id would come back naming a record the
 * device does not have. An update or delete carries the revision it was planned
 * against, so a stale write is a visible conflict rather than a silent
 * overwrite.
 */
export interface LocalBatchWrite {
  operation: "create" | "update" | "delete";
  objectName: string;
  recordId: string;
  /** Present for a create: the values the record was created with locally. */
  values?: Record<string, JsonValue>;
  /** Present for an update: the fields the caller asked to change. */
  patch?: Record<string, JsonValue>;
  /** Present for an update or delete: the revision the write was planned against. */
  baseRevision?: string;
}
/**
 * An ad-hoc multi-record transaction as one queued unit of work.
 *
 * Unlike a command, there is no model declaration to re-execute, so the writes
 * themselves cross the wire in planned order. That is not a licence: the
 * authority applies each one through the ordinary runtime write path, so every
 * policy, validation, lifecycle, scope and constraint check runs server-side
 * exactly as it ran on the device — and, because they run inside one authority
 * transaction, a batch that fails at any write lands none of them.
 */
export interface LocalBatchOperation {
  /** What produced the batch, for local history and operator-facing surfaces. */
  label?: string;
  /**
   * The wire payload: the writes the caller *requested*, which is what the
   * authority is told about. A write the platform derived — an ordered-collection
   * shift — is deliberately absent, because the authority re-derives it from the
   * same constraint and being told about it twice would apply it twice.
   */
  writes: LocalBatchWrite[];
  /**
   * Every record the transaction wrote, derived writes included, so a verdict can
   * be reported over all of them.
   *
   * Separate from `writes` for exactly the reason a command's `records` is
   * separate from its `recordIds`: the wire payload and the record-coverage list
   * answer different questions. Deriving coverage from `writes` left the siblings
   * an ordered-collection shift moved reporting `pending` for ever after a
   * refusal — waiting on an answer that nothing queued could ever give.
   */
  records: Array<{ objectName: string; recordId: string }>;
}
export interface LocalOperation {
  opId: string;
  object: string;
  recordId: string;
  baseRevision?: string;
  operation: LocalOperationKind;
  patch?: Record<string, JsonValue>;
  commandName?: string;
  commandLabel?: string;
  commandStep?: string;
  commandTransactionId?: string;
  /**
   * Present only when `operation` is `"command"`: the whole command, queued as
   * one entry. The per-step writes are still recorded in the operation log for
   * local history; they are simply not queued separately, because the authority
   * has to be told about the transaction rather than about its pieces.
   */
  command?: LocalCommandOperation;
  /**
   * Present only when `operation` is `"batch"`: every write of an ad-hoc
   * transaction, queued as one entry. As with a command, the per-record writes
   * are still recorded in the operation log for local history and are simply not
   * queued separately.
   */
  batch?: LocalBatchOperation;
  /**
   * The business contexts selected when this operation executed.
   *
   * Replay used to read the selection in force when the queue drained, so a
   * queue drained after the user switched contexts — or after a reload — replayed
   * writes against a selection that was not in force when they were made. The
   * selection belongs to the operation, not to the moment it is sent.
   *
   * An empty object means nothing was selected, which is a selection and is
   * replayed as one. Absent means the entry was queued before operations began
   * carrying this, and only such an entry falls back to the drain-time
   * selection — the old behaviour, for exactly the entries written under it.
   */
  selectedContexts?: Record<string, string>;
  lifecycleAction?: string;
  fromState?: string;
  toState?: string;
  createdAt: string;
  createdBy: string;
  contextSnapshot: {
    roles: string[];
    channel: Extract<RuntimeChannel, "ui" | "api" | "sync">;
  };
  status: LocalOperationStatus;
  serverMessage?: string;
}
