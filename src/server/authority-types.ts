import type { JsonValue, StoredObjectRecord } from "../model/resolved-model.js";

export type AuthorityOperationIntent =
  | {
      operationId: string;
      kind: "create";
      objectName: string;
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
      selectedContexts?: Record<string, string>;
    };

export type AuthorityOutcome =
  | { status: "accepted"; operationId: string; records: StoredObjectRecord[] }
  | { status: "rejected"; operationId: string; code: string; message: string }
  | { status: "conflict"; operationId: string; code: "ADL_SYNC_CONFLICT"; message: string }
  | {
      status: "manualResolution";
      operationId: string;
      code: "ADL_SYNC_MANUAL_RESOLUTION";
      message: string;
    };

export interface AuthoritySession {
  userId: string;
  expiresAt?: Date;
}

/** Provider boundary: session tokens establish identity only, never ADL roles. */
export interface AuthoritySessionAdapter {
  verify(sessionToken: string | undefined): Promise<AuthoritySession | null>;
}

export interface AuthorityOutcomeStore {
  get(operationId: string): Promise<AuthorityOutcome | null>;
  put(outcome: AuthorityOutcome): Promise<void>;
}
