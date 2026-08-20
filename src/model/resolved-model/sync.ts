import type { ResolvedExpression } from "./expression.js";

export type RuntimeChannel = "ui" | "api" | "sync" | "import" | "test";
export type SyncMode = "localFirst" | "cacheReadonly" | "onlineRequired" | "localPrivate";
export type SyncScope =
  | "all"
  | "currentUser"
  | "assignedToUser"
  | "ownedByUser"
  | "currentContext"
  | "allAvailableContexts"
  | "recent"
  | "custom";
export type ConflictStrategy = "serverWins" | "clientWins" | "stateTransitionWins" | "manual";
/**
 * A record's device-local synchronisation state. Every value has a producer:
 *
 * - `local` — the record has no delivery path at all, because its object's sync
 *   mode is not queueable. It is not waiting for anything.
 * - `pending` — a local write was accepted and queued, and the authority has not
 *   answered it yet.
 * - `synced` — the authority's accepted state, either written by the authority
 *   itself or reconciled onto the device from it.
 * - `conflict` — the authority answered the operation covering this record with
 *   a conflict, and no strategy or person has resolved it yet.
 * - `rejected` — the authority refused the operation covering this record. The
 *   record is still here, and this is what says so.
 *
 * It is device-local in both directions: a client never asserts it to the
 * authority, and never adopts one the authority sent.
 */
export type SyncStatus = "local" | "pending" | "synced" | "conflict" | "rejected";
/**
 * `command` is the whole of a model-declared command, not one of its writes. A
 * command's steps commit in one transaction, and replaying them as separate
 * per-record operations destroys that transaction across the sync boundary: a
 * step writing into a context an earlier step established has no context to
 * write into, and a batch lands partially. The command kind is what lets the
 * queue carry the transaction rather than its pieces.
 *
 * `batch` is the same idea for a transaction no command declares: an edit
 * surface's staged child changes, which the user made as one act of editing and
 * which must therefore land as one. It differs from `command` in what crosses
 * the wire. A command is re-executed from its input, because a command exists in
 * the model and the authority can run it again. A batch has no such declaration,
 * so it crosses as the writes themselves — each one still checked server-side by
 * the same policy, validation, scope and constraint path an individual intent
 * takes, but all of them inside one transaction.
 */
export type LocalOperationKind =
  | "create"
  | "update"
  | "delete"
  | "transition"
  | "command"
  | "batch";
export type LocalOperationStatus = "pending" | "sent" | "accepted" | "rejected" | "conflict";
/**
 * Audit stays per record: a command is audited as the writes it made, step by
 * step, and so is a batch. Only the queue needs the transaction as one thing.
 */
export type AuditOperation = Exclude<LocalOperationKind, "command" | "batch"> | "read" | "search";
export interface ResolvedSyncPolicy {
  object: string;
  mode: SyncMode;
  scope: SyncScope;
  window?: ResolvedSyncWindow;
  /**
   * The record predicate a `custom` sync scope selects by. It is an ordinary
   * `ResolvedExpression` evaluated against the record's own values and the
   * runtime context, not a second expression dialect. Only `custom` carries
   * one, and `custom` may not be declared without one: a scope the runtime
   * cannot honour is refused at validation rather than left to select nothing.
   */
  predicate?: ResolvedExpression;
  conflict: ConflictStrategy;
}
export type ResolvedObjectSyncPolicy = Omit<ResolvedSyncPolicy, "object">;
export interface ResolvedSyncWindow {
  field: string;
  days?: number;
  limit?: number;
  /**
   * Whether this window was written by the author (`"authored"`) or implied
   * by a bare `SCOPE recent` with no declared `WINDOW` (`"impliedByScope"`,
   * a 30-day `_updatedAt` default). `recent` is the one scope that implies a
   * window; every other scope bounds nothing unless the model says so. This
   * lets a resolved model, or a human reading a dumped one, tell an
   * intentional bound from a default without already knowing `recent`'s
   * special case.
   */
  windowSource: "authored" | "impliedByScope";
}
export interface ResolvedObjectAuditPolicy {
  enabled: boolean;
  operations: AuditOperation[];
}
export interface ResolvedAuditModel {
  enabled: boolean;
  operations: AuditOperation[];
  metadataFields: string[];
}
export interface PartialSyncPolicyModel {
  object: string;
  mode?: SyncMode;
  scope?: SyncScope;
  window?: PartialSyncWindowModel;
  predicate?: ResolvedExpression;
  conflict?: ConflictStrategy;
}
export type PartialObjectSyncPolicyModel = Omit<PartialSyncPolicyModel, "object">;
export interface PartialSyncWindowModel {
  field?: string;
  days?: number;
  limit?: number;
}
export interface PartialObjectAuditPolicyModel {
  enabled?: boolean;
  operations?: AuditOperation[];
}
