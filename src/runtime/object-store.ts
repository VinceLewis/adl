import type {
  CommandStepAuthority,
  JsonValue,
  LocalBatchWrite,
  LocalCommandRecordId,
  LocalOperationKind,
  PlatformRecordMetadata,
  ResolvedApplicationModel,
  ResolvedField,
  ResolvedObject,
  ResolvedOrderedObjectConstraint,
  ResolvedProtectedRoleObjectConstraint,
  StoredObjectRecord,
  SyncMode,
  SyncStatus,
} from "../model/resolved-model.js";
import {
  recordMatchesObjectScope,
  requireObjectScopeForRecord,
  requireObjectScopeForSearch,
  requireObjectScopeForValues,
} from "./context-scope.js";
import { applyComputedFieldsToRecord } from "./computed-fields.js";
import { RuntimeModelIndex, getInitialLifecycleState, getRecordState } from "./model-helpers.js";
import type { AuditService } from "./audit-service.js";
import { InMemoryObjectStorageBackend } from "./object-storage-backend.js";
import type { ObjectStorageBackend } from "./object-storage-backend.js";
import type { OperationLog, OperationLogDetails } from "./operation-log.js";
import type { PolicyEngine } from "./policy-engine.js";
import {
  MAX_RECORD_ID_LENGTH,
  createRecordGuid,
  createRecordRevision,
  isValidRecordId,
} from "./record-identity.js";
import {
  StorageError,
  RecordIdInvalidError,
  RecordIdUnavailableError,
  RecordNotDiscardableError,
  RuntimeValidationError,
  cloneJson,
  getContextNowIso,
  noopRuntimeLogger,
  normaliseSearchQuery,
  safeContextLog,
} from "./runtime-types.js";
import type {
  RuntimeContext,
  RuntimeLogger,
  RuntimeSearchInput,
  RuntimeSearchQuery,
  RuntimeValidationIssue,
} from "./runtime-types.js";
import { isQueueableSyncMode } from "./sync-policy-service.js";
import type { SyncPolicyService } from "./sync-policy-service.js";
import type { SyncQueue } from "./sync-queue.js";
import type { ValidationEngine } from "./validation-engine.js";

export type ObjectStoreWriteAuthority = CommandStepAuthority;

export interface ObjectStoreCreateOptions {
  /**
   * Create the record under this id instead of a freshly minted one. Used when a
   * record already has an identity elsewhere that must survive the write — an
   * offline create replayed to the authority names the record the client already
   * holds, so the accepted record converges with it rather than duplicating it.
   *
   * The id is untrusted input: it is shape-checked, and an id that already names
   * a record is refused. It confers no authority over that record.
   */
  recordId?: string;
}

export type PlannedObjectWrite =
  | PlannedCreateObjectWrite
  | PlannedUpdateObjectWrite
  | PlannedDeleteObjectWrite;

export interface PlannedCreateObjectWrite {
  operation: "create";
  objectName: string;
  /**
   * The authority the write was planned under. It is retained so a write the
   * platform derives from this one — an ordered-collection shift, say — can be
   * planned under the same authority and never a wider one.
   */
  authority: ObjectStoreWriteAuthority;
  record: StoredObjectRecord;
  patch: Record<string, JsonValue>;
}

export interface PlannedUpdateObjectWrite {
  operation: "update";
  objectName: string;
  authority: ObjectStoreWriteAuthority;
  existing: StoredObjectRecord;
  record: StoredObjectRecord;
  patch: Record<string, JsonValue>;
}

export interface PlannedDeleteObjectWrite {
  operation: "delete";
  objectName: string;
  authority: ObjectStoreWriteAuthority;
  existing: StoredObjectRecord;
  /** The tombstone that will be persisted. Deletes carry no patch. */
  record: StoredObjectRecord;
}

/**
 * A record the authority refused that is still on the device, as metadata only.
 * `discardable` says whether the refused write was this record's own create, and
 * so whether removing it locally is safe; see `ObjectStore.discardRefusedRecord`.
 */
export interface RefusedLocalRecord {
  objectName: string;
  recordId: string;
  discardable: boolean;
}

/** How many live records are in each sync state. Tombstones are not counted. */
export type RecordSyncStateSummary = Record<SyncStatus, number>;

export interface PlannedTransactionCommitOptions {
  command?: {
    name: string;
    label?: string;
    /** The step that planned each requested write, positionally. */
    steps: string[];
    /** The iteration item each requested write belongs to, for a step that iterates. */
    frames: (number | undefined)[];
    /**
     * The prepared input the command ran on. It is what the authority replays —
     * a command crosses the sync boundary as the work it was asked to do, not as
     * the writes it happened to produce, so that re-execution runs every policy,
     * validation, lifecycle, scope and precondition check again server-side.
     */
    input: Record<string, JsonValue>;
  };
  /**
   * An ad-hoc transaction with no command behind it — today, an edit surface's
   * staged child changes.
   *
   * It is mutually exclusive with `command`: both mean "queue this as one entry",
   * and a transaction cannot be two units of work at once. What differs is what
   * the entry carries. A command carries its input, because the authority can
   * re-execute it. A batch has nothing to re-execute, so the entry carries the
   * requested writes themselves, which is why only the requested writes are
   * named: a derived ordered-collection write updates a record that already
   * exists, and re-planning it server-side reaches the same record through the
   * same constraint.
   */
  batch?: {
    label?: string;
  };
}

export class ObjectStore {
  private nextTransactionId = 1;

  constructor(
    private readonly model: ResolvedApplicationModel,
    private readonly validationEngine: ValidationEngine,
    private readonly policyEngine: PolicyEngine,
    private readonly auditService: AuditService,
    private readonly operationLog: OperationLog,
    private readonly syncPolicy: SyncPolicyService,
    private readonly syncQueue: SyncQueue,
    private readonly index = new RuntimeModelIndex(model),
    private readonly storage: ObjectStorageBackend = new InMemoryObjectStorageBackend(),
    private readonly logger: RuntimeLogger = noopRuntimeLogger,
    private readonly startupGuard: () => Promise<void> = async () => undefined,
  ) {}

  async create(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    options: ObjectStoreCreateOptions = {},
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.create", { objectName, context: safeContextLog(context) });
    const write = await this.planCreateForTransaction(
      objectName,
      values,
      context,
      "caller",
      options,
    );
    const [created] = await this.commitPlannedTransaction([write], context);
    if (created === undefined) {
      throw new StorageError(`Create for object '${objectName}' did not produce a record.`, {
        objectName,
      });
    }
    this.logger.debug("EXIT ObjectStore.create", {
      objectName,
      recordId: created.meta.guid,
    });
    return created;
  }

  async planCreateForTransaction(
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    authority: ObjectStoreWriteAuthority = "caller",
    options: ObjectStoreCreateOptions = {},
  ): Promise<PlannedCreateObjectWrite> {
    await this.startupGuard();
    const object = this.index.getObject(objectName);
    // Shape first: a malformed id is pure input validation and discloses nothing,
    // so it is refused before any work and long before storage sees it.
    if (options.recordId !== undefined && !isValidRecordId(options.recordId)) {
      throw new RecordIdInvalidError(
        `A supplied record id for object '${objectName}' must be 1 to ${MAX_RECORD_ID_LENGTH} characters with no surrounding whitespace or control characters.`,
        { objectName },
      );
    }
    const preparedValues = this.validationEngine.prepareCreateValues(objectName, values, context);
    await this.mintAutoIdFields(object, preparedValues, values);
    const currentState = getInitialLifecycleState(object);

    requireObjectScopeForValues(this.index, objectName, preparedValues, context, "create");
    if (authority === "caller") {
      this.policyEngine.requireAllowed(
        {
          objectName,
          action: "create",
          patch: preparedValues,
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      );
      this.requireFieldPolicy(
        "create",
        objectName,
        preparedValues,
        context,
        undefined,
        currentState,
      );
    }
    this.syncPolicy.requireLocalWriteAllowed(objectName, "create", context);

    // Collision is checked only after the create is otherwise authorised, so an
    // unauthorised caller is denied rather than told whether an id exists. The
    // lookup reads through tombstones: a deleted id is still taken, and a create
    // must never resurrect one.
    if (options.recordId !== undefined && (await this.storage.read(objectName, options.recordId))) {
      throw new RecordIdUnavailableError(
        `A record already exists for object '${objectName}' under the supplied id.`,
        { objectName },
      );
    }

    const record = this.buildNewRecord(
      object,
      preparedValues,
      context,
      currentState,
      options.recordId,
    );

    return {
      operation: "create",
      objectName,
      authority,
      record,
      patch: preparedValues,
    };
  }

  async read(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord | null> {
    await this.startupGuard();
    this.logger.debug("ENTER ObjectStore.read", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const record = await this.getActiveRecord(objectName, id);

    if (record === undefined) {
      this.logger.debug("EXIT ObjectStore.read", { objectName, recordId: id, found: false });
      return null;
    }

    const object = this.index.getObject(objectName);
    requireObjectScopeForRecord(this.index, objectName, record, context, "read");
    this.policyEngine.requireAllowed(
      {
        objectName,
        action: "read",
        record,
        ...stateProperty(this.getState(objectName, record)),
      },
      context,
    );
    this.auditService.record("read", objectName, record, context, record.values, record.values);
    this.logger.debug("EXIT ObjectStore.read", { objectName, recordId: id, found: true });

    return this.policyEngine.applyReadPolicy(
      objectName,
      applyComputedFieldsToRecord(object, record, context),
      context,
    );
  }

  /** Trusted sync projection write. It deliberately does not create local intent, audit, or queue side effects. */
  async reconcileRemoteRecord(objectName: string, record: StoredObjectRecord): Promise<void> {
    await this.startupGuard();
    this.index.getObject(objectName);
    const existing = await this.storage.read(objectName, record.meta.guid);
    /*
     * The status is imposed here, never adopted: whatever the authority's own
     * copy of this field said, a record reconciled onto this device is synced
     * *on this device*.
     *
     * Unless a verdict against it is still outstanding. `synchronize` is
     * reconcile → bootstrap → automatic recovery, so without this a conflict the
     * user must decide about would be marked on the record by the reconcile and
     * wiped by the bootstrap moments later, leaving `conflict` as unobservable
     * on a record as it was before it had a producer at all. The queue is asked
     * rather than the record remembering, because the queue is what knows
     * whether the question is still open.
     */
    const outstanding = this.syncQueue.getUnresolvedVerdict(objectName, record.meta.guid);
    const status: SyncStatus =
      outstanding === "rejected" ? "rejected" : outstanding === undefined ? "synced" : "conflict";
    // The discard licence is spent here and only here. It means "the authority
    // holds no copy of this record", and a record arriving *from* the authority
    // is that claim being disproved — including in the collision case, where the
    // create was refused precisely because the id already named a record the
    // authority does hold. Discarding that row would delete the authority's
    // record, not the user's refused work.
    const synced = cloneJson({
      ...record,
      meta: withoutRejectedCreate({ ...record.meta, syncStatus: status }),
    });
    if (existing === null) {
      await this.storage.create(objectName, synced);
      return;
    }
    if (synced.meta.deletedAt !== undefined) await this.storage.delete(objectName, synced);
    else await this.storage.update(objectName, synced);
  }

  async update(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.update", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    const write = await this.planUpdateForTransaction(objectName, id, patch, context);
    const [updated] = await this.commitPlannedTransaction([write], context);
    if (updated === undefined) {
      throw new StorageError(
        `Update for record '${id}' on object '${objectName}' did not produce a record.`,
        {
          objectName,
          id,
        },
      );
    }
    this.logger.debug("EXIT ObjectStore.update", { objectName, recordId: id });
    return updated;
  }

  async planUpdateForTransaction(
    objectName: string,
    id: string,
    patch: Record<string, JsonValue>,
    context: RuntimeContext,
    authority: ObjectStoreWriteAuthority = "caller",
  ): Promise<PlannedUpdateObjectWrite> {
    await this.startupGuard();
    const existing = await this.requireActiveRecord(objectName, id);
    requireObjectScopeForRecord(this.index, objectName, existing, context, "update");
    const currentState = this.getState(objectName, existing);
    const nextValues = this.validationEngine.prepareUpdateValues(
      objectName,
      existing,
      patch,
      context,
    );

    requireObjectScopeForValues(this.index, objectName, nextValues, context, "update");
    if (authority === "caller") {
      this.policyEngine.requireAllowed(
        {
          objectName,
          action: "update",
          record: existing,
          patch,
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      );
      this.requireFieldPolicy("update", objectName, patch, context, existing, currentState);
    }
    this.syncPolicy.requireLocalWriteAllowed(objectName, "update", context);

    const updated = this.updatedRecord(existing, nextValues, context, currentState);

    return {
      operation: "update",
      objectName,
      authority,
      existing,
      record: updated,
      patch,
    };
  }

  async delete(
    objectName: string,
    id: string,
    context: RuntimeContext,
  ): Promise<StoredObjectRecord> {
    this.logger.debug("ENTER ObjectStore.delete", {
      objectName,
      recordId: id,
      context: safeContextLog(context),
    });
    // A delete goes through the planned path so an ordered collection can
    // renumber the records the removal leaves behind inside the same
    // transaction. With nothing to compact this plans exactly one write, which
    // is the single-write storage call it has always made.
    const write = await this.planDeleteForTransaction(objectName, id, context);
    const [deleted] = await this.commitPlannedTransaction([write], context);
    if (deleted === undefined) {
      throw new StorageError(
        `Delete for record '${id}' on object '${objectName}' did not produce a record.`,
        {
          objectName,
          id,
        },
      );
    }
    this.logger.debug("EXIT ObjectStore.delete", { objectName, recordId: id });

    return deleted;
  }

  async planDeleteForTransaction(
    objectName: string,
    id: string,
    context: RuntimeContext,
    authority: ObjectStoreWriteAuthority = "caller",
  ): Promise<PlannedDeleteObjectWrite> {
    await this.startupGuard();
    const existing = await this.requireActiveRecord(objectName, id);
    requireObjectScopeForRecord(this.index, objectName, existing, context, "delete");
    const currentState = this.getState(objectName, existing);

    if (authority === "caller") {
      this.policyEngine.requireAllowed(
        {
          objectName,
          action: "delete",
          record: existing,
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      );
    }
    this.syncPolicy.requireLocalWriteAllowed(objectName, "delete", context);

    return {
      operation: "delete",
      objectName,
      authority,
      existing,
      record: this.deletedRecord(existing, context),
    };
  }

  async search(
    objectName: string,
    query: RuntimeSearchInput,
    context: RuntimeContext,
    recordFilter: (record: StoredObjectRecord) => boolean = () => true,
  ): Promise<StoredObjectRecord[]> {
    await this.startupGuard();
    this.logger.debug("ENTER ObjectStore.search", { objectName, context: safeContextLog(context) });
    const object = this.index.getObject(objectName);
    const searchQuery = normaliseSearchQuery(query);
    const fields = searchQuery.fields ?? object.fields.map((field) => field.name);

    for (const fieldName of fields) {
      if (!this.index.hasBusinessField(object, fieldName) && !hasComputedField(object, fieldName)) {
        throw new StorageError(
          `Search field '${fieldName}' does not exist on object '${objectName}'.`,
          {
            objectName,
            fieldName,
          },
        );
      }
    }
    const storageFields = fields.filter((fieldName) =>
      this.index.hasBusinessField(object, fieldName),
    );

    requireObjectScopeForSearch(this.index, objectName, context);
    this.policyEngine.requireAllowed({ objectName, action: "search" }, context);

    const records = (
      await this.storage.search({
        object,
        fields: storageFields,
        ...(searchQuery.text === undefined ? {} : { text: searchQuery.text }),
        ...(searchQuery.includeDeleted === undefined
          ? {}
          : { includeDeleted: searchQuery.includeDeleted }),
      })
    )
      .filter(recordFilter)
      .filter((record) => this.canReadSearchResult(objectName, record, context));
    const scopedRecords = records.filter((record) =>
      recordMatchesObjectScope(this.index, objectName, record, context),
    );
    const sortedRecords = sortRecords(scopedRecords, searchQuery.sort);
    const limited =
      searchQuery.limit === undefined || searchQuery.limit < 0
        ? sortedRecords
        : sortedRecords.slice(0, searchQuery.limit);

    const shaped = limited.map((record) =>
      this.policyEngine.applyReadPolicy(
        objectName,
        applyComputedFieldsToRecord(object, record, context),
        context,
      ),
    );

    this.logger.debug("EXIT ObjectStore.search", { objectName, count: shaped.length });
    return shaped;
  }

  async commitPlannedTransaction(
    writes: PlannedObjectWrite[],
    context: RuntimeContext,
    options: PlannedTransactionCommitOptions = {},
  ): Promise<StoredObjectRecord[]> {
    await this.startupGuard();
    if (options.command !== undefined && options.batch !== undefined) {
      throw new StorageError(
        "A planned transaction may be queued as a command or as a batch, never as both.",
        { commandName: options.command.name },
      );
    }
    // Ordered-collection consequences are planned here rather than by each
    // caller, so a reorder is one transaction and one storage commit however it
    // was requested: direct CRUD, a command step, or a replayed intent.
    const plan = await this.expandOrderedCollectionWrites(writes, context);
    await this.requireConstraintsForWrites(plan.writes);

    const commandTransactionId =
      options.command === undefined ? undefined : this.nextCommandTransactionId();
    // A command's or batch's writes are logged for local history but never queued
    // individually: the authority has to be told about the transaction, and one
    // entry per write is precisely the shape that loses it.
    const queueSteps = options.command === undefined && options.batch === undefined;
    const commandRecordIds: LocalCommandRecordId[] = [];
    const commandRecords: Array<{ objectName: string; recordId: string }> = [];
    const batchWrites: LocalBatchWrite[] = [];
    const batchRecords: Array<{ objectName: string; recordId: string }> = [];
    await this.commitStorageWrites(plan.writes);

    const committed: StoredObjectRecord[] = [];
    for (let index = 0; index < plan.writes.length; index += 1) {
      const write = plan.writes[index];
      if (write === undefined) {
        continue;
      }
      // A derived write belongs to the step that caused it, so command metadata
      // is taken from the originating write rather than from its own position.
      const originIndex = plan.originIndexes[index] ?? index;
      const commandDetails =
        options.command === undefined
          ? {}
          : {
              commandName: options.command.name,
              ...(options.command.label === undefined
                ? {}
                : { commandLabel: options.command.label }),
              commandStep: options.command.steps[originIndex] ?? `step${originIndex + 1}`,
              commandTransactionId,
            };

      if (write.operation === "create") {
        this.auditService.record(
          "create",
          write.objectName,
          write.record,
          context,
          undefined,
          write.record.values,
          commandDetails,
        );
        this.recordOperation(
          "create",
          write.objectName,
          write.record,
          context,
          {
            patch: write.record.values,
            ...commandDetails,
          },
          queueSteps,
        );
      } else if (write.operation === "delete") {
        this.auditService.record(
          "delete",
          write.objectName,
          write.record,
          context,
          write.existing.values,
          write.record.values,
          commandDetails,
        );
        this.recordOperation(
          "delete",
          write.objectName,
          write.record,
          context,
          {
            baseRevision: write.existing.meta.revision,
            ...commandDetails,
          },
          queueSteps,
        );
      } else {
        this.auditService.record(
          "update",
          write.objectName,
          write.record,
          context,
          write.existing.values,
          write.record.values,
          commandDetails,
        );
        this.recordOperation(
          "update",
          write.objectName,
          write.record,
          context,
          {
            baseRevision: write.existing.meta.revision,
            patch: write.patch,
            ...commandDetails,
          },
          queueSteps,
        );
      }

      if (options.command !== undefined) {
        commandRecords.push({ objectName: write.objectName, recordId: write.record.meta.guid });
        // Only the requested writes are named: a derived ordered-collection write
        // updates a record that already exists, so re-execution reaches it through
        // the same constraint rather than needing to be told its id.
        if (write.operation === "create" && index < writes.length) {
          const frame = options.command.frames[index];
          commandRecordIds.push({
            step: options.command.steps[index] ?? `step${index + 1}`,
            ...(frame === undefined ? {} : { itemIndex: frame }),
            objectName: write.objectName,
            recordId: write.record.meta.guid,
          });
        }
      }

      if (options.batch !== undefined) {
        // Every write, derived ones included: the verdict on this transaction is
        // equally true of every row it produced, and a sibling an ordered shift
        // moved would otherwise report `pending` for ever.
        batchRecords.push({ objectName: write.objectName, recordId: write.record.meta.guid });
        // Only the requested writes cross the wire. A derived ordered-collection
        // write updates a record that already exists, and the authority re-derives
        // it from the same constraint; sending it would apply it twice.
        if (index < writes.length) {
          batchWrites.push(toBatchWrite(write));
        }
      }

      // Only the requested writes are returned, positionally, so a caller still
      // gets exactly the records it asked for. Derived writes are visible where
      // side effects belong: audit, the operation log, and the sync queue.
      if (index < writes.length) {
        committed.push(this.applyComputedReadPolicy(write.objectName, write.record, context));
      }
    }

    if (options.batch !== undefined) {
      this.recordBatchOperation(options.batch, plan.writes, batchWrites, batchRecords, context);
    }

    if (options.command !== undefined && commandTransactionId !== undefined) {
      this.recordCommandOperation(
        options.command,
        plan.writes,
        commandRecordIds,
        commandRecords,
        commandTransactionId,
        context,
      );
    }

    return committed;
  }

  /**
   * Queues a locally executed command as one entry.
   *
   * The per-step writes above are logged but not queued, so exactly one entry
   * describes the whole transaction. Replaying the steps separately is what
   * destroys the command's atomicity across the sync boundary: a step writing
   * into a context an earlier step established is refused outright, because the
   * caller is not a member of a context whose only membership record is the one
   * being refused, and a batch lands partially.
   */
  private recordCommandOperation(
    command: NonNullable<PlannedTransactionCommitOptions["command"]>,
    writes: PlannedObjectWrite[],
    recordIds: LocalCommandRecordId[],
    records: Array<{ objectName: string; recordId: string }>,
    commandTransactionId: string,
    context: RuntimeContext,
  ): void {
    const representative = this.representativeTransactionWrite(writes);
    if (representative === undefined) {
      return;
    }

    this.recordOperation(
      "command",
      representative.objectName,
      representative.record,
      context,
      {
        commandName: command.name,
        ...(command.label === undefined ? {} : { commandLabel: command.label }),
        commandTransactionId,
        command: {
          name: command.name,
          ...(command.label === undefined ? {} : { label: command.label }),
          input: cloneJson(command.input),
          recordIds: cloneJson(recordIds),
          records: cloneJson(records),
        },
      },
      true,
    );
  }

  /**
   * Queues an ad-hoc multi-record transaction as one entry.
   *
   * The reason is the one Phase 57 established for commands: a transaction that
   * replays as independent per-record intents is not a transaction across the
   * sync boundary, and can land partially at the authority however carefully it
   * was committed locally. What differs is only the payload — a batch has no
   * declaration to re-execute, so the entry carries the writes.
   *
   * Nothing is queued when the batch produced no writes; an empty entry would
   * report an operation nobody performed.
   */
  private recordBatchOperation(
    batch: NonNullable<PlannedTransactionCommitOptions["batch"]>,
    writes: PlannedObjectWrite[],
    batchWrites: LocalBatchWrite[],
    batchRecords: Array<{ objectName: string; recordId: string }>,
    context: RuntimeContext,
  ): void {
    if (batchWrites.length === 0) {
      return;
    }

    const representative = this.representativeTransactionWrite(writes);
    if (representative === undefined) {
      return;
    }

    this.recordOperation(
      "batch",
      representative.objectName,
      representative.record,
      context,
      {
        batch: {
          ...(batch.label === undefined ? {} : { label: batch.label }),
          writes: cloneJson(batchWrites),
          // Every record the transaction wrote, not only the requested ones, so
          // one verdict answers for every row it produced.
          records: cloneJson(batchRecords),
        },
      },
      true,
    );
  }

  /**
   * The write whose object decides how the queued transaction is treated.
   *
   * A queue entry carries one object's sync declaration, and a transaction has
   * as many as it has writes. The most demanding mode wins: a command containing
   * an `onlineRequired` step was accepted on the belief that the authority was
   * reachable, so it must be delivered now rather than held like a `localFirst`
   * write. Model validation refuses a command whose steps disagree about
   * queueability at all, so this only ever chooses between modes that queue.
   *
   * A staged batch reaches this with the same question and the same answer. Its
   * writes are one child object's in practice, but nothing in the contract says
   * so, and picking the first write's mode would have let a `localFirst` child
   * decide the fate of an `onlineRequired` one beside it.
   */
  private representativeTransactionWrite(
    writes: PlannedObjectWrite[],
  ): PlannedObjectWrite | undefined {
    let best: PlannedObjectWrite | undefined;
    let bestRank = -1;
    for (const write of writes) {
      const rank = commandModeRank(this.index.getObject(write.objectName).sync.mode);
      if (rank > bestRank) {
        best = write;
        bestRank = rank;
      }
    }
    return best;
  }

  /**
   * Records the authority's answer about a record on the record itself.
   *
   * This is reporting, not resolving: no value changes, no revision is minted,
   * nothing is audited and nothing is queued. It exists because the queue entry
   * carrying the verdict is discarded the moment the user dismisses it, and a
   * refused write whose only trace was that entry became indistinguishable from
   * a write nobody had sent yet.
   *
   * It reads and writes through tombstones deliberately. A refused delete leaves
   * a tombstone behind, and that tombstone is exactly the record the verdict is
   * about.
   */
  async setRecordSyncState(
    objectName: string,
    recordId: string,
    status: SyncStatus,
    options: { rejectedCreate?: boolean } = {},
  ): Promise<void> {
    await this.startupGuard();
    this.index.getObject(objectName);
    const existing = await this.storage.read(objectName, recordId);
    if (existing === null) {
      return;
    }

    /*
     * The licence is set here and never cleared here. A record whose create was
     * refused is one the authority holds no copy of, and no later verdict about
     * it disproves that — the refused *update* that follows an edit of such a
     * row is refused precisely because the authority does not have it. Only
     * `reconcileRemoteRecord`, where the authority produces a copy, spends it.
     */
    const licensed = existing.meta.syncRejectedCreate === true || options.rejectedCreate === true;
    const meta = { ...existing.meta, syncStatus: status };
    const record = cloneJson({
      ...existing,
      meta:
        // `synced` is the authority saying it accepted the operation, so it now
        // holds the record and the licence is spent even when no record came
        // back with the outcome to reconcile.
        status === "synced"
          ? withoutRejectedCreate(meta)
          : licensed
            ? { ...meta, syncRejectedCreate: true }
            : meta,
    });
    // Straight to storage rather than through `update`: this is not a write of
    // the record, it is a note about what happened to one, and routing it
    // through the write path would audit it, queue it and mint a revision the
    // authority never issued.
    if (record.meta.deletedAt === undefined) await this.storage.update(objectName, record);
    else await this.storage.delete(objectName, record);
  }

  /**
   * Every record the device is holding that the authority refused, as metadata
   * only.
   *
   * No values are returned and no read policy is applied, for the same reason
   * `SyncRecoveryItem` carries none: this is a queue-and-verdict surface shown
   * without a runtime read behind it, so it may say *that* a record was refused
   * and never what is in it.
   */
  async listRefusedRecords(): Promise<RefusedLocalRecord[]> {
    await this.startupGuard();
    return (
      (await this.storage.listRecords())
        // Tombstones are excluded. A refused *delete* leaves one, and the record
        // the authority still holds comes back on the next bootstrap, which
        // restores the row and clears the mark; a discarded row leaves one too.
        // Neither is something the user can act on, and listing them would report
        // rows that are not there.
        .filter(
          (persisted) =>
            persisted.record.meta.syncStatus === "rejected" &&
            persisted.record.meta.deletedAt === undefined,
        )
        .map((persisted) => ({
          objectName: persisted.objectName,
          recordId: persisted.record.meta.guid,
          discardable: persisted.record.meta.syncRejectedCreate === true,
        }))
        .sort(
          (left, right) =>
            left.objectName.localeCompare(right.objectName) ||
            left.recordId.localeCompare(right.recordId),
        )
    );
  }

  /** How many records are in each sync state, for a surface that reports the whole device. */
  async summariseRecordSyncState(): Promise<RecordSyncStateSummary> {
    await this.startupGuard();
    const summary: RecordSyncStateSummary = {
      local: 0,
      pending: 0,
      synced: 0,
      conflict: 0,
      rejected: 0,
    };
    for (const persisted of await this.storage.listRecords()) {
      if (persisted.record.meta.deletedAt !== undefined) continue;
      summary[persisted.record.meta.syncStatus] += 1;
    }
    return summary;
  }

  /**
   * Removes a refused record the authority never accepted.
   *
   * Deliberately not a recovery primitive: it settles nothing with the authority
   * and sends nothing to it. It is the user saying "throw away the row my
   * refused change left here", and it is permitted only for a record whose own
   * create was refused, because that is the only case in which the authority has
   * no copy to contradict the removal.
   *
   * A tombstone is written rather than the row being erased, so a later create
   * cannot silently resurrect the id, and the tombstone is *not* queued: the
   * authority never had the record, so telling it to delete one would be a
   * request about a record that does not exist there.
   */
  async discardRefusedRecord(
    objectName: string,
    recordId: string,
    context: RuntimeContext,
  ): Promise<void> {
    await this.startupGuard();
    this.index.getObject(objectName);
    const existing = await this.storage.read(objectName, recordId);
    if (existing === null || existing.meta.deletedAt !== undefined) {
      return;
    }
    if (existing.meta.syncStatus !== "rejected" || existing.meta.syncRejectedCreate !== true) {
      throw new RecordNotDiscardableError(
        `Record '${recordId}' on object '${objectName}' is not a refused local create and cannot be discarded.`,
        { objectName, recordId, syncStatus: existing.meta.syncStatus },
      );
    }

    const now = getContextNowIso(context);
    const tombstone = cloneJson({
      ...existing,
      meta: withoutRejectedCreate({
        ...existing.meta,
        updatedAt: now,
        updatedBy: context.userId,
        deletedAt: now,
        deletedBy: context.userId,
        // Not `local`: the record has no delivery path *and* never will, which
        // is what `local` means for a row nothing is waiting on.
        syncStatus: "local" as const,
      }),
    });
    await this.storage.delete(objectName, tombstone);
    // Audited as local history — the device did remove a row — but never queued.
    this.auditService.record(
      "delete",
      objectName,
      tombstone,
      context,
      existing.values,
      tombstone.values,
    );
  }

  async getRecordForRuntime(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    await this.startupGuard();
    const record = await this.getActiveRecord(objectName, id);
    return record === undefined ? null : cloneJson(record);
  }

  /**
   * Trusted sync-projection lookup that includes tombstones. A queued delete has
   * no active record by definition, so replaying it must not depend on one; this
   * is deliberately not a user-facing read and applies no read policy.
   */
  async getRecordForSync(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    await this.startupGuard();
    this.index.getObject(objectName);
    const record = await this.storage.read(objectName, id);
    return record === null ? null : cloneJson(record);
  }

  async commitTransition(
    objectName: string,
    id: string,
    nextValues: Record<string, JsonValue>,
    context: RuntimeContext,
    details: Required<Pick<OperationLogDetails, "lifecycleAction" | "fromState" | "toState">>,
  ): Promise<StoredObjectRecord> {
    await this.startupGuard();
    this.logger.debug("ENTER ObjectStore.commitTransition", {
      objectName,
      recordId: id,
      lifecycleAction: details.lifecycleAction,
    });
    const existing = await this.requireActiveRecord(objectName, id);
    requireObjectScopeForRecord(this.index, objectName, existing, context, "transition");
    this.syncPolicy.requireLocalWriteAllowed(objectName, "transition", context);
    const updated = this.updatedRecord(existing, nextValues, context, details.toState);

    await this.storage.update(objectName, updated);
    this.auditService.record(
      "transition",
      objectName,
      updated,
      context,
      existing.values,
      updated.values,
      {
        lifecycleAction: details.lifecycleAction,
        fromState: details.fromState,
        toState: details.toState,
      },
    );
    this.recordOperation("transition", objectName, updated, context, {
      baseRevision: existing.meta.revision,
      lifecycleAction: details.lifecycleAction,
      fromState: details.fromState,
      toState: details.toState,
    });
    this.logger.debug("EXIT ObjectStore.commitTransition", {
      objectName,
      recordId: id,
      lifecycleAction: details.lifecycleAction,
    });

    return cloneJson(updated);
  }

  private applyComputedReadPolicy(
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): StoredObjectRecord {
    const object = this.index.getObject(objectName);
    return this.policyEngine.applyReadPolicy(
      objectName,
      applyComputedFieldsToRecord(object, record, context),
      context,
    );
  }

  /**
   * Mints a value for every `AUTO_ID` field on `object` that the caller did not
   * supply explicitly, mutating `values` (the prepared/defaulted create values)
   * in place. `originalValues` is the caller's own argument to `create`/
   * `planCreateForTransaction`, checked instead of `values` so a plain `DEFAULT`
   * applied by `prepareCreateValues` is never mistaken for an explicit caller
   * value and left in place — minting is meant to win over a placeholder
   * `DEFAULT` the same way it wins over "no value at all".
   *
   * This is local best-effort, not a coordination protocol: two offline devices
   * can independently mint the same value before either syncs, exactly as two
   * offline creates can independently pick colliding business-key values today.
   * The existing authority-side conflict/rejection machinery is the backstop —
   * see docs/spec/language.md's `AUTO_ID` section and
   * learnings/implementation/auto-id-minting.md for why no new cross-device
   * coordination mechanism is built here.
   */
  private async mintAutoIdFields(
    object: ResolvedObject,
    values: Record<string, JsonValue>,
    originalValues: Record<string, JsonValue>,
  ): Promise<void> {
    for (const field of object.fields) {
      if (field.autoId === undefined) {
        continue;
      }
      if (originalValues[field.name] !== undefined) {
        // The caller named this record's identity itself — an import or a
        // migration, most likely. Respect it, the same way a supplied
        // `options.recordId` overrides a minted `_guid`.
        continue;
      }
      values[field.name] = await this.mintAutoIdValue(object, field, values);
    }
  }

  private async mintAutoIdValue(
    object: ResolvedObject,
    field: ResolvedField,
    values: Record<string, JsonValue>,
  ): Promise<string> {
    const autoId = field.autoId;
    // Callers only reach this method when `field.autoId` is already set
    // (`mintAutoIdFields` filters on it); this is unreachable defensive code.
    if (autoId === undefined) {
      throw new StorageError(
        `mintAutoIdValue called for field '${field.name}' on object '${object.name}' with no AUTO_ID declaration.`,
        { objectName: object.name, field: field.name },
      );
    }

    const prefix = autoId.prefix ?? "";
    const scopeField = autoId.scopeField;
    const scopeValue = scopeField === undefined ? undefined : values[scopeField];

    const candidates = await this.storage.search({ object, fields: [], includeDeleted: true });
    let maxSequence = 0;
    for (const candidate of candidates) {
      if (scopeField !== undefined && candidate.values[scopeField] !== scopeValue) {
        continue;
      }

      const sequence = parseAutoIdSequence(candidate.values[field.name], prefix);
      if (sequence !== undefined && sequence > maxSequence) {
        maxSequence = sequence;
      }
    }

    const nextSequence = maxSequence + 1;
    const pad = autoId.pad ?? 0;
    return `${prefix}${String(nextSequence).padStart(pad, "0")}`;
  }

  private buildNewRecord(
    object: ResolvedObject,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    currentState: string | undefined,
    suppliedRecordId: string | undefined,
  ): StoredObjectRecord {
    const now = getContextNowIso(context);
    // A caller may name the record; every other meta field stays derived here.
    const guid = suppliedRecordId ?? createRecordGuid(object.name);

    return {
      meta: {
        guid,
        object: object.name,
        schemaVersion: object.schemaVersion,
        // A new record has no prior revision, so this starts a sequence. It is
        // still unique by construction, not the first value of a process
        // counter: two runtimes creating records over one backend must not mint
        // the same revision for two different versions of anything.
        revision: createRecordRevision(),
        ...(currentState === undefined ? {} : { state: currentState }),
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        syncStatus: this.writtenSyncStatus(object.name, context),
      },
      values: cloneJson(values),
    };
  }

  private updatedRecord(
    existing: StoredObjectRecord,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    state: string | undefined,
  ): StoredObjectRecord {
    return {
      /*
       * The discard licence is deliberately carried through a local write.
       *
       * It records that the authority holds no copy of this record, and editing
       * the row here does not change that. Clearing it on every write stranded
       * the record one edit after its create was refused: the edit was queued,
       * refused in turn as an update to a record the authority does not have,
       * and the row was then marked `rejected` with nothing left saying it could
       * be thrown away. Only the authority producing a copy spends it.
       */
      meta: {
        ...existing.meta,
        // Derived from the record's own prior revision, so this record's
        // revisions count up across process restarts instead of restarting at
        // the top of a fresh counter.
        revision: createRecordRevision(existing.meta.revision),
        ...(state === undefined ? {} : { state }),
        updatedAt: getContextNowIso(context),
        updatedBy: context.userId,
        syncStatus: this.writtenSyncStatus(existing.meta.object, context),
      },
      values: cloneJson(values),
    };
  }

  private deletedRecord(existing: StoredObjectRecord, context: RuntimeContext): StoredObjectRecord {
    const now = getContextNowIso(context);

    return {
      // The licence is carried through, for the reason `updatedRecord` gives.
      meta: {
        ...existing.meta,
        revision: createRecordRevision(existing.meta.revision),
        updatedAt: now,
        updatedBy: context.userId,
        deletedAt: now,
        deletedBy: context.userId,
        syncStatus: this.writtenSyncStatus(existing.meta.object, context),
      },
      values: cloneJson(existing.values),
    };
  }

  /**
   * The sync state a write leaves the record in.
   *
   * Three cases, and every one of them has to be stated or the field goes back
   * to meaning nothing:
   *
   * - On the `sync` channel the writer *is* the authority. Its own state is
   *   accepted state by definition, and it is waiting for nobody. This is the
   *   same signal `SyncPolicyService` already uses to recognise a write arriving
   *   through the authority rather than from a device.
   * - A device write on a queueable object is queued by the same commit, so it
   *   is `pending` until the authority answers it. This is true whether or not
   *   an authority is reachable, or configured at all: the write is queued and
   *   unanswered either way, and reporting it as settled would be a lie about
   *   work the device is still holding.
   * - A device write on any other object has no delivery path by design, so it
   *   is `local` — not waiting, not late.
   *
   * A command's steps are not queued individually but the command entry is, so
   * every record a queueable command wrote is `pending` too. Model validation
   * refuses a command whose steps disagree about queueability, so the step's own
   * object always answers for the transaction.
   */
  private writtenSyncStatus(objectName: string, context: RuntimeContext): SyncStatus {
    if (context.channel === "sync") {
      return "synced";
    }
    return isQueueableSyncMode(this.index.getObject(objectName).sync.mode) ? "pending" : "local";
  }

  private requireFieldPolicy(
    action: "create" | "update",
    objectName: string,
    values: Record<string, JsonValue>,
    context: RuntimeContext,
    record: StoredObjectRecord | undefined,
    currentState: string | undefined,
  ): void {
    for (const field of Object.keys(values)) {
      this.policyEngine.requireAllowed(
        {
          objectName,
          action,
          field,
          patch: values,
          ...(record === undefined ? {} : { record }),
          ...(currentState === undefined ? {} : { currentState }),
        },
        context,
      );
    }
  }

  private canReadSearchResult(
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
  ): boolean {
    return (
      this.policyEngine.evaluate(
        {
          objectName,
          action: "read",
          record,
          ...stateProperty(this.getState(objectName, record)),
        },
        context,
      ).effect === "allow"
    );
  }

  /**
   * Plans the sibling writes an ordered collection needs so the requested
   * writes can stand: `reorder: "shift"` moves colliding siblings aside, and
   * `compaction: "onDelete"` renumbers the survivors of a removal down.
   *
   * Derived writes are planned through {@link planUpdateForTransaction} under
   * the authority of the write that caused them, never a wider one. A
   * caller-authority reorder therefore re-runs the full object and field policy
   * check, the context-scope check, the sync-policy check and validation
   * against every sibling it moves: a sibling the caller may not update raises
   * from here, before anything is persisted, so the whole reorder is refused
   * rather than the record being moved silently. A command-authority write
   * derives command-authority sibling writes because the command's own
   * preconditions were already the authorisation boundary for landing a record
   * on that position — refusing the consequence while permitting the cause
   * would leave the collection incoherent, and it grants the caller nothing the
   * command did not already grant. Everything else — validation, scope, sync
   * policy, constraints, audit, operation log — runs for derived writes exactly
   * as it does for requested ones.
   */
  private async expandOrderedCollectionWrites(
    writes: PlannedObjectWrite[],
    context: RuntimeContext,
  ): Promise<{ writes: PlannedObjectWrite[]; originIndexes: number[] }> {
    const expanded = [...writes];
    const originIndexes = writes.map((_, index) => index);
    if (writes.length === 0) {
      return { writes: expanded, originIndexes };
    }

    for (const objectName of [...new Set(writes.map((write) => write.objectName))]) {
      const object = this.index.getObject(objectName);
      const constraints = object.constraints.filter(
        (constraint): constraint is ResolvedOrderedObjectConstraint =>
          constraint.kind === "ordered" &&
          (constraint.reorder === "shift" || constraint.compaction === "onDelete"),
      );
      if (constraints.length === 0) {
        continue;
      }

      const entries = writes
        .map((write, index) => ({ write, index }))
        .filter((entry) => entry.write.objectName === objectName);
      const liveRecords = await this.storage.search({ object, fields: [] });

      // Two ordered constraints on one object must not plan two writes for the
      // same record: the second would be planned against the pre-transaction
      // record and drop the first one's position.
      const movesByRecord = new Map<string, OrderedCollectionMove>();
      for (const constraint of constraints) {
        for (const move of planOrderedCollectionMoves(constraint, liveRecords, entries)) {
          const merged = movesByRecord.get(move.recordId);
          if (merged === undefined) {
            movesByRecord.set(move.recordId, move);
            continue;
          }
          merged.patch = { ...merged.patch, ...move.patch };
          merged.authority =
            merged.authority === "caller" || move.authority === "caller" ? "caller" : "command";
          merged.originIndex = Math.min(merged.originIndex, move.originIndex);
        }
      }

      for (const move of movesByRecord.values()) {
        expanded.push(
          await this.planUpdateForTransaction(
            objectName,
            move.recordId,
            move.patch,
            context,
            move.authority,
          ),
        );
        originIndexes.push(move.originIndex);
      }
    }

    return { writes: expanded, originIndexes };
  }

  private async requireConstraintsForWrites(writes: PlannedObjectWrite[]): Promise<void> {
    const issues: RuntimeValidationIssue[] = [];
    const affectedObjectNames = [...new Set(writes.map((write) => write.objectName))];

    for (const objectName of affectedObjectNames) {
      const object = this.index.getObject(objectName);
      const objectWrites = writes.filter((write) => write.objectName === objectName);
      if (object.constraints.length === 0 || objectWrites.length === 0) {
        continue;
      }

      const finalRecords = await this.getFinalConstraintRecords(object, objectWrites);
      const protectedRoleConstraints = object.constraints.filter(
        (constraint): constraint is ResolvedProtectedRoleObjectConstraint =>
          constraint.kind === "protectedRole",
      );

      for (const write of objectWrites) {
        // Unlike unique/ordered, a protected-role guard is exactly *about* the
        // writes that leave the collection or change out of the guarded role,
        // so it is checked before the delete short-circuit below, using the
        // write's own `existing` values rather than its (possibly absent)
        // final ones.
        for (const constraint of protectedRoleConstraints) {
          requireProtectedRoleConstraint(constraint, write, finalRecords, object, issues);
        }

        // A deleted record leaves the collection, so it has nothing left to
        // satisfy. It is already absent from `finalRecords`, which is what makes
        // the position it held free for the writes around it.
        if (write.operation === "delete") {
          continue;
        }
        for (const constraint of object.constraints) {
          if (constraint.kind === "protectedRole") {
            // Already checked above, for every write kind including delete.
            continue;
          }
          if (constraint.kind === "unique") {
            const fields = [...constraint.scopeFields, ...constraint.fields];
            if (hasMissingConstraintValue(write.record, fields)) {
              continue;
            }
            const duplicate = finalRecords.find(
              (candidate) =>
                candidate.meta.guid !== write.record.meta.guid &&
                fields.every((field) =>
                  jsonValuesEqual(candidate.values[field], write.record.values[field]),
                ),
            );
            if (duplicate !== undefined) {
              const field = constraint.fields[0] ?? fields[0] ?? "constraint";
              issues.push({
                code: "ADL_RUNTIME_CONSTRAINT_UNIQUE",
                message: `Constraint '${constraint.name}' requires fields ${fields.join(", ")} to be unique on object '${object.name}'.`,
                path: `values.${field}`,
                field,
              });
            }
            continue;
          }

          const position = write.record.values[constraint.positionField];
          if (
            typeof position !== "number" ||
            !Number.isInteger(position) ||
            position < constraint.minPosition
          ) {
            issues.push({
              code: "ADL_RUNTIME_CONSTRAINT_ORDERED_POSITION",
              message: `Constraint '${constraint.name}' requires '${constraint.positionField}' to be an integer greater than or equal to ${constraint.minPosition}.`,
              path: `values.${constraint.positionField}`,
              field: constraint.positionField,
            });
            continue;
          }

          const scopeFields = [...constraint.scopeFields, constraint.parentField];
          if (hasMissingConstraintValue(write.record, scopeFields)) {
            continue;
          }

          const duplicate = finalRecords.find(
            (candidate) =>
              candidate.meta.guid !== write.record.meta.guid &&
              scopeFields.every((field) =>
                jsonValuesEqual(candidate.values[field], write.record.values[field]),
              ) &&
              jsonValuesEqual(candidate.values[constraint.positionField], position),
          );
          if (duplicate !== undefined) {
            issues.push({
              code: "ADL_RUNTIME_CONSTRAINT_ORDERED_DUPLICATE",
              message: `Constraint '${constraint.name}' requires '${constraint.positionField}' to be unique within '${constraint.parentField}'.`,
              path: `values.${constraint.positionField}`,
              field: constraint.positionField,
            });
          }
        }
      }
    }

    if (issues.length > 0) {
      throw new RuntimeValidationError("Object constraints failed.", issues);
    }
  }

  private async getFinalConstraintRecords(
    object: ResolvedObject,
    writes: PlannedObjectWrite[],
  ): Promise<StoredObjectRecord[]> {
    const recordsById = new Map(
      (
        await this.storage.search({
          object,
          fields: [],
        })
      ).map((record) => [record.meta.guid, record]),
    );

    for (const write of writes) {
      if (write.operation === "delete") {
        recordsById.delete(write.record.meta.guid);
        continue;
      }
      recordsById.set(write.record.meta.guid, cloneJson(write.record));
    }

    return [...recordsById.values()];
  }

  private getState(objectName: string, record: StoredObjectRecord): string | undefined {
    return getRecordState(this.index.getObject(objectName), record);
  }

  private async requireActiveRecord(objectName: string, id: string): Promise<StoredObjectRecord> {
    const record = await this.getActiveRecord(objectName, id);

    if (record === undefined) {
      throw new StorageError(`Record '${id}' for object '${objectName}' does not exist.`, {
        objectName,
        id,
      });
    }

    return record;
  }

  private async getActiveRecord(
    objectName: string,
    id: string,
  ): Promise<StoredObjectRecord | undefined> {
    this.index.getObject(objectName);
    const record = await this.storage.read(objectName, id);
    if (record === null || record.meta.deletedAt !== undefined) {
      return undefined;
    }

    return cloneJson(record);
  }

  private recordOperation(
    operation: LocalOperationKind,
    objectName: string,
    record: StoredObjectRecord,
    context: RuntimeContext,
    details: OperationLogDetails = {},
    queue = true,
  ): void {
    const localOperation = this.operationLog.record(
      operation,
      objectName,
      record,
      context,
      details,
    );
    if (queue) {
      this.syncQueue.enqueue(localOperation);
    }
  }

  private nextCommandTransactionId(): string {
    return `cmd-txn-${this.nextTransactionId++}`;
  }

  private async commitStorageWrites(writes: PlannedObjectWrite[]): Promise<void> {
    if (writes.length === 0) {
      return;
    }

    if (writes.length > 1) {
      if (
        this.storage.supportsTransactions !== true ||
        this.storage.commitTransaction === undefined
      ) {
        throw new StorageError(
          "Multi-record command transaction is unsupported by the configured storage backend.",
          {
            writeCount: writes.length,
          },
        );
      }

      await this.storage.commitTransaction(
        writes.map((write) => ({
          operation: write.operation,
          objectName: write.objectName,
          record: write.record,
        })),
      );
      return;
    }

    const write = writes[0];
    if (write === undefined) {
      return;
    }

    if (write.operation === "create") {
      await this.storage.create(write.objectName, write.record);
      return;
    }

    if (write.operation === "delete") {
      await this.storage.delete(write.objectName, write.record);
      return;
    }

    await this.storage.update(write.objectName, write.record);
  }
}

interface OrderedCollectionWriteEntry {
  write: PlannedObjectWrite;
  index: number;
}

interface OrderedCollectionMove {
  recordId: string;
  patch: Record<string, JsonValue>;
  authority: ObjectStoreWriteAuthority;
  /** Index of the requested write this move is a consequence of. */
  originIndex: number;
}

interface OrderedCollectionAnchor {
  recordId: string;
  position: number;
  /** The position the record held in this scope before the write, if it held one. */
  previousPosition: number | undefined;
  authority: ObjectStoreWriteAuthority;
  originIndex: number;
}

interface OrderedCollectionRemoval {
  position: number;
  authority: ObjectStoreWriteAuthority;
  originIndex: number;
}

/**
 * Works out how the untouched siblings of an ordered collection have to move so
 * that the requested writes hold their requested positions.
 *
 * It is deliberately pure and total: it decides positions and never decides
 * authorisation, and when the request cannot be satisfied it returns no moves
 * so the ordinary constraint check refuses the transaction. Fail closed —
 * "cannot be arranged" must surface as `ADL_RUNTIME_CONSTRAINT_ORDERED_*`, not
 * as a silently different arrangement.
 */
function planOrderedCollectionMoves(
  constraint: ResolvedOrderedObjectConstraint,
  liveRecords: StoredObjectRecord[],
  entries: OrderedCollectionWriteEntry[],
): OrderedCollectionMove[] {
  const scopeFields = [...constraint.scopeFields, constraint.parentField];
  const writtenIds = new Set(entries.map((entry) => entry.write.record.meta.guid));
  const anchorsByScope = new Map<string, OrderedCollectionAnchor[]>();
  const removalsByScope = new Map<string, OrderedCollectionRemoval[]>();

  for (const entry of entries) {
    const { write } = entry;
    if (write.operation === "delete") {
      if (constraint.compaction !== "onDelete") {
        continue;
      }
      const scopeKey = orderedScopeKey(write.existing, scopeFields);
      const position = orderedPosition(write.existing, constraint);
      if (scopeKey === undefined || position === undefined) {
        continue;
      }
      pushInto(removalsByScope, scopeKey, {
        position,
        authority: write.authority,
        originIndex: entry.index,
      });
      continue;
    }

    if (constraint.reorder !== "shift") {
      continue;
    }
    const scopeKey = orderedScopeKey(write.record, scopeFields);
    const position = orderedPosition(write.record, constraint);
    if (scopeKey === undefined || position === undefined) {
      continue;
    }
    // A record arriving from another parent has no previous position here, so
    // it is an insertion into this scope rather than a move within it.
    const previousPosition =
      write.operation === "update" && orderedScopeKey(write.existing, scopeFields) === scopeKey
        ? orderedPosition(write.existing, constraint)
        : undefined;
    pushInto(anchorsByScope, scopeKey, {
      recordId: write.record.meta.guid,
      position,
      previousPosition,
      authority: write.authority,
      originIndex: entry.index,
    });
  }

  const moves: OrderedCollectionMove[] = [];
  for (const scopeKey of new Set([...removalsByScope.keys(), ...anchorsByScope.keys()])) {
    const anchors = anchorsByScope.get(scopeKey) ?? [];
    const removals = removalsByScope.get(scopeKey) ?? [];
    const siblings = liveRecords
      .filter(
        (record) =>
          !writtenIds.has(record.meta.guid) &&
          record.meta.deletedAt === undefined &&
          orderedScopeKey(record, scopeFields) === scopeKey &&
          orderedPosition(record, constraint) !== undefined,
      )
      .map((record) => ({
        recordId: record.meta.guid,
        position: orderedPosition(record, constraint) as number,
      }))
      .sort(
        (left, right) =>
          left.position - right.position || left.recordId.localeCompare(right.recordId),
      );

    const original = new Map(siblings.map((sibling) => [sibling.recordId, sibling.position]));
    const working = new Map(original);
    const causes = new Map<string, { authority: ObjectStoreWriteAuthority; originIndex: number }>();
    // Every requested position is reserved before anything is arranged, so a
    // sibling is never shifted onto a slot another write in this transaction
    // asked for.
    const claimed = new Map<number, string>();
    for (const anchor of anchors) {
      claimed.set(anchor.position, anchor.recordId);
    }

    compactOrderedScope(working, removals, causes);
    for (const anchor of anchors) {
      shiftOrderedScopeForAnchor(constraint, working, claimed, anchor, causes);
    }

    for (const [recordId, position] of working) {
      if (original.get(recordId) === position) {
        continue;
      }
      const cause = causes.get(recordId);
      moves.push({
        recordId,
        patch: { [constraint.positionField]: position },
        authority: cause?.authority ?? "caller",
        originIndex: cause?.originIndex ?? 0,
      });
    }
  }

  return moves;
}

/**
 * Closes the holes left by the records this transaction removes.
 *
 * A sibling moves down by the number of removed positions below it, which
 * closes exactly the holes the removals made, keeps every pre-existing gap, and
 * is order-independent for several removals at once.
 */
function compactOrderedScope(
  working: Map<string, number>,
  removals: OrderedCollectionRemoval[],
  causes: Map<string, { authority: ObjectStoreWriteAuthority; originIndex: number }>,
): void {
  if (removals.length === 0) {
    return;
  }

  for (const [recordId, position] of [...working]) {
    const below = removals.filter((removal) => removal.position < position);
    if (below.length === 0) {
      continue;
    }
    working.set(recordId, position - below.length);
    const cause = below[0];
    if (cause !== undefined) {
      recordOrderedCause(causes, recordId, cause);
    }
  }
}

/**
 * Moves the block of siblings the anchor displaces one slot away from the slot
 * the anchor vacated, which is the smallest rearrangement that leaves the
 * anchor where it was asked to be.
 *
 * The block ends at the first free slot, so a move up stops at the slot the
 * record itself vacated and an insertion stops at the first gap — a contiguous
 * collection stays contiguous and an existing gap absorbs the shift instead of
 * being pushed along. An anchor already sitting on its requested position moves
 * nothing, which is what makes replaying a reorder converge.
 */
function shiftOrderedScopeForAnchor(
  constraint: ResolvedOrderedObjectConstraint,
  working: Map<string, number>,
  claimed: Map<number, string>,
  anchor: OrderedCollectionAnchor,
  causes: Map<string, { authority: ObjectStoreWriteAuthority; originIndex: number }>,
): void {
  if (!Number.isInteger(anchor.position) || anchor.position < constraint.minPosition) {
    return;
  }
  if (anchor.previousPosition === anchor.position) {
    return;
  }

  const step =
    anchor.previousPosition !== undefined && anchor.previousPosition < anchor.position ? -1 : 1;
  const pending: Array<[string, number]> = [];
  let slot = anchor.position;
  // The walk consumes one distinct occupied slot per step, so it always ends;
  // the counter only guarantees that an unreachable case arranges nothing
  // rather than half a block.
  let guard = working.size + 1;

  for (;;) {
    if (guard <= 0) {
      return;
    }
    guard -= 1;
    const occupant = findOrderedOccupant(working, slot);
    if (occupant === undefined) {
      const claimant = claimed.get(slot);
      const displaced =
        pending.length > 0 &&
        ((claimant !== undefined && claimant !== anchor.recordId) || slot < constraint.minPosition);
      if (displaced) {
        // The block has nowhere to go that another write has not already
        // claimed, so nothing is moved and the duplicate is refused.
        return;
      }
      break;
    }

    pending.push([occupant, slot + step]);
    slot += step;
  }

  for (const [recordId, position] of pending) {
    working.set(recordId, position);
    recordOrderedCause(causes, recordId, anchor);
  }
}

function recordOrderedCause(
  causes: Map<string, { authority: ObjectStoreWriteAuthority; originIndex: number }>,
  recordId: string,
  cause: { authority: ObjectStoreWriteAuthority; originIndex: number },
): void {
  const existing = causes.get(recordId);
  if (existing === undefined) {
    causes.set(recordId, { authority: cause.authority, originIndex: cause.originIndex });
    return;
  }
  // Several writes can displace one sibling. The move is then planned under the
  // narrowest authority of any of them, never the widest.
  causes.set(recordId, {
    authority:
      existing.authority === "caller" || cause.authority === "caller" ? "caller" : "command",
    originIndex: Math.min(existing.originIndex, cause.originIndex),
  });
}

function findOrderedOccupant(working: Map<string, number>, slot: number): string | undefined {
  for (const [recordId, position] of working) {
    if (position === slot) {
      return recordId;
    }
  }

  return undefined;
}

/**
 * The "last admin standing" guard.
 *
 * A create can only add a record, never remove one, so it can never reduce a
 * scope's guarded-role count and is skipped. For an update or a delete, the
 * check fires only when the write's *existing* record held the guarded role —
 * a write that never held it has nothing to protect — and only when the final
 * state no longer holds it in the same scope: deleted outright, demoted to an
 * unguarded value, or moved to a different scope key. An update that keeps the
 * record's guarded role (including a demotion between two guarded values, such
 * as `Admin` to `Owner` when both are declared) leaves the scope's count
 * unchanged and is never checked.
 *
 * `finalRecords` already reflects every write in this transaction — deletes
 * removed and updates applied — so the remaining count is exactly what the
 * transaction would leave behind.
 */
function requireProtectedRoleConstraint(
  constraint: ResolvedProtectedRoleObjectConstraint,
  write: PlannedObjectWrite,
  finalRecords: StoredObjectRecord[],
  object: ResolvedObject,
  issues: RuntimeValidationIssue[],
): void {
  if (write.operation === "create") {
    return;
  }

  const existing = write.existing;
  if (!recordHoldsProtectedRole(existing, constraint)) {
    return;
  }

  const scopeKey = orderedScopeKey(existing, constraint.scopeFields);
  if (scopeKey === undefined) {
    return;
  }

  const stillGuarded =
    write.operation === "update" &&
    orderedScopeKey(write.record, constraint.scopeFields) === scopeKey &&
    recordHoldsProtectedRole(write.record, constraint);
  if (stillGuarded) {
    return;
  }

  const remaining = finalRecords.filter(
    (candidate) =>
      candidate.meta.guid !== existing.meta.guid &&
      orderedScopeKey(candidate, constraint.scopeFields) === scopeKey &&
      recordHoldsProtectedRole(candidate, constraint),
  ).length;

  if (remaining < constraint.minCount) {
    issues.push({
      code: "ADL_RUNTIME_CONSTRAINT_PROTECTED_ROLE",
      message: `Constraint '${constraint.name}' requires at least ${constraint.minCount} record(s) with '${constraint.roleField}' in [${constraint.roleValues.map((value) => JSON.stringify(value)).join(", ")}] on object '${object.name}'.`,
      path: `values.${constraint.roleField}`,
      field: constraint.roleField,
    });
  }
}

function recordHoldsProtectedRole(
  record: StoredObjectRecord,
  constraint: ResolvedProtectedRoleObjectConstraint,
): boolean {
  return constraint.roleValues.some((value) =>
    jsonValuesEqual(record.values[constraint.roleField], value),
  );
}

function orderedScopeKey(record: StoredObjectRecord, scopeFields: string[]): string | undefined {
  if (hasMissingConstraintValue(record, scopeFields)) {
    return undefined;
  }

  return JSON.stringify(scopeFields.map((field) => record.values[field] ?? null));
}

function orderedPosition(
  record: StoredObjectRecord,
  constraint: ResolvedOrderedObjectConstraint,
): number | undefined {
  const position = record.values[constraint.positionField];
  if (typeof position !== "number" || !Number.isInteger(position)) {
    return undefined;
  }

  return position < constraint.minPosition ? undefined : position;
}

function pushInto<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, [value]);
    return;
  }

  existing.push(value);
}

/**
 * Drops the discard licence a refusal left on a record.
 *
 * The key is removed rather than set to `undefined`: it is an optional field
 * under `exactOptionalPropertyTypes`, and a persisted `syncRejectedCreate:
 * undefined` would be a third state between "refused create" and "not one".
 */
function withoutRejectedCreate<T extends PlatformRecordMetadata>(meta: T): T {
  if (meta.syncRejectedCreate === undefined) {
    return meta;
  }

  const { syncRejectedCreate: _spent, ...rest } = meta;
  return rest as T;
}

/**
 * One committed write as the authority must be told about it.
 *
 * A create sends the record's values rather than the caller's input, so the
 * authority re-plans from what was actually stored — defaults, computed inputs
 * and prepared values included. An update or delete sends the revision it was
 * planned against, which is what turns a write the authority has since changed
 * into a visible conflict rather than a silent overwrite.
 */
function toBatchWrite(write: PlannedObjectWrite): LocalBatchWrite {
  if (write.operation === "create") {
    return {
      operation: "create",
      objectName: write.objectName,
      recordId: write.record.meta.guid,
      values: cloneJson(write.record.values),
    };
  }

  if (write.operation === "delete") {
    return {
      operation: "delete",
      objectName: write.objectName,
      recordId: write.record.meta.guid,
      baseRevision: write.existing.meta.revision,
    };
  }

  return {
    operation: "update",
    objectName: write.objectName,
    recordId: write.record.meta.guid,
    patch: cloneJson(write.patch),
    baseRevision: write.existing.meta.revision,
  };
}

function stateProperty(currentState: string | undefined): { currentState: string } | {} {
  return currentState === undefined ? {} : { currentState };
}

function hasComputedField(object: ResolvedObject, fieldName: string): boolean {
  return object.computedFields.some((field) => field.name === fieldName);
}

/**
 * Reads the numeric sequence out of an existing record's own `AUTO_ID` field
 * value, for `mintAutoIdValue` to find the next one. A value that is not a
 * string, does not start with `prefix`, or whose remainder is not entirely
 * digits is a foreign or hand-entered value, not part of this field's minted
 * sequence — it is ignored rather than let it corrupt the count.
 */
function parseAutoIdSequence(value: JsonValue | undefined, prefix: string): number | undefined {
  if (typeof value !== "string" || !value.startsWith(prefix)) {
    return undefined;
  }

  const suffix = value.slice(prefix.length);
  if (!/^[0-9]+$/.test(suffix)) {
    return undefined;
  }

  const parsed = Number.parseInt(suffix, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sortRecords(
  records: StoredObjectRecord[],
  sort: RuntimeSearchQuery["sort"],
): StoredObjectRecord[] {
  if (sort === undefined || sort.length === 0) {
    return records;
  }

  return [...records].sort((left, right) => {
    for (const sortItem of sort) {
      const comparison = compareValues(left.values[sortItem.field], right.values[sortItem.field]);
      if (comparison !== 0) {
        return sortItem.direction === "asc" ? comparison : -comparison;
      }
    }

    return 0;
  });
}

function compareValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (left === right) {
    return 0;
  }

  if (left === undefined || left === null) {
    return 1;
  }

  if (right === undefined || right === null) {
    return -1;
  }

  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

function hasMissingConstraintValue(record: StoredObjectRecord, fields: string[]): boolean {
  return fields.some((field) => {
    const value = record.values[field];
    return value === undefined || value === null || value === "";
  });
}

function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * How demanding a mode is about when its accepted writes reach the authority.
 * `onlineRequired` outranks `localFirst` because a write it accepted may not
 * wait for the next connection; the non-queueing modes rank below both, so a
 * command that touches none of the queueing modes never enters the queue.
 */
function commandModeRank(mode: SyncMode): number {
  if (mode === "onlineRequired") return 2;
  if (mode === "localFirst") return 1;
  return 0;
}
