import type {
  JsonValue,
  LocalCommandRecordId,
  StoredObjectRecord,
} from "../model/resolved-model.js";

/**
 * The id the originating device already holds for one record a command created.
 *
 * It is the same contract a create intent's `recordId` carries, applied per
 * step and per iteration item: untrusted input, shape-checked, refused when
 * already taken, and never an assertion about revision, actor, timestamps,
 * state or scope.
 */
export type AuthorityCommandRecordId = LocalCommandRecordId;

export type AuthorityOperationIntent =
  | {
      operationId: string;
      kind: "create";
      objectName: string;
      /**
       * The id the originating client already holds for this record. It is
       * required: an authority-minted id would come back naming a record the
       * client does not have, stranding the local row it was replayed from. The
       * id is untrusted input — shape-checked, refused when already taken, and
       * never an assertion about revision, actor, timestamps, state or scope.
       */
      recordId: string;
      values: Record<string, JsonValue>;
      selectedContexts?: Record<string, string>;
    }
  | {
      operationId: string;
      kind: "update";
      objectName: string;
      recordId: string;
      patch: Record<string, JsonValue>;
      baseRevision: string;
      selectedContexts?: Record<string, string>;
    }
  | {
      operationId: string;
      kind: "delete";
      objectName: string;
      recordId: string;
      baseRevision: string;
      selectedContexts?: Record<string, string>;
    }
  | {
      operationId: string;
      kind: "transition";
      objectName: string;
      recordId: string;
      actionName: string;
      baseRevision: string;
      selectedContexts?: Record<string, string>;
    }
  | {
      operationId: string;
      kind: "command";
      commandName: string;
      input: Record<string, JsonValue>;
      /**
       * The ids the originating device minted for every record this command
       * creates, in planned order. Required for the same reason a create
       * intent's `recordId` is: the authority re-executes the command, so
       * without them every created record would be named server-side and arrive
       * beside the local row rather than onto it.
       *
       * The manifest must describe exactly the creates the re-execution plans,
       * in the same order. A divergence is refused rather than patched over: an
       * id adopted against a different write than the one it names is worse than
       * no id at all.
       */
      recordIds: AuthorityCommandRecordId[];
      selectedContexts?: Record<string, string>;
    }
  | {
      operationId: string;
      kind: "batch";
      /**
       * The writes of one ad-hoc transaction, in the order the device planned
       * them, applied here inside a single authority transaction.
       *
       * A batch has no model declaration to re-execute, so unlike a command it
       * crosses the wire as its writes. That is a difference in payload, never in
       * trust: each write goes through the ordinary runtime create/update/delete
       * path, so policy, validation, lifecycle, scope and constraints all run
       * server-side, a create's supplied id is shape-checked and refused when
       * taken, and an update or delete whose base revision is stale is a conflict.
       * The only thing the batch adds is that none of them lands unless all do.
       */
      writes: AuthorityBatchWrite[];
      selectedContexts?: Record<string, string>;
    };

export type AuthorityBatchWrite =
  | { operation: "create"; objectName: string; recordId: string; values: Record<string, JsonValue> }
  | {
      operation: "update";
      objectName: string;
      recordId: string;
      patch: Record<string, JsonValue>;
      baseRevision: string;
    }
  | { operation: "delete"; objectName: string; recordId: string; baseRevision: string };

export type AuthorityOutcome =
  | { status: "accepted"; operationId: string; records: StoredObjectRecord[] }
  | { status: "rejected"; operationId: string; code: string; message: string }
  | {
      status: "conflict";
      operationId: string;
      code: "ADL_SYNC_CONFLICT";
      message: string;
      recovery: "serverWins" | "clientWins" | "stateTransitionWins";
    }
  | {
      status: "manualResolution";
      operationId: string;
      code: "ADL_SYNC_MANUAL_RESOLUTION";
      message: string;
      recovery: "manual";
    };

export interface AuthorityBootstrapRequest {
  selectedContexts?: Record<string, string>;
  cursor?: string;
  limit?: number;
}

export interface AuthorityBootstrapRecord {
  objectName: string;
  record: StoredObjectRecord;
}

/** A cursor is opaque and only advances within the dataset already policy-shaped for this request. */
export interface AuthorityBootstrapResponse {
  records: AuthorityBootstrapRecord[];
  nextCursor?: string;
}

export interface AuthoritySession {
  userId: string;
  expiresAt?: Date;
}

/** Provider boundary: session tokens establish identity only, never ADL roles. */
export interface AuthoritySessionAdapter {
  verify(sessionToken: string | undefined): Promise<AuthoritySession | null>;
}

export interface AuthorityOutcomeStore {
  /** Outcomes are bound to the authenticated actor that submitted the intent. */
  get(operationId: string, actorId: string): Promise<AuthorityOutcome | null>;
  put(outcome: AuthorityOutcome, actorId: string): Promise<void>;
}
