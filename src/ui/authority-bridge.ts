import type { LocalOperationKind } from "../model/resolved-model.js";
import type {
  AuthorityDeviceSession,
  AuthorityReportPage,
} from "../server/http-authority-transport.js";
import type {
  SyncDeliveryItem,
  SyncRecoveryChoice,
  SyncRecoveryItem,
} from "../server/sync-client.js";
import { titleCaseIdentifier } from "./components/html.js";
import type { OfflineGraceState } from "./offline-session.js";

/**
 * The seam between the browser shell and the authority connection. `adl-app`
 * and the session/recovery components depend on this interface only, so no UI
 * component imports the HTTP transport, and a local demo with no authority
 * configured simply has no bridge and renders no session chrome at all.
 */
export interface AdlAuthorityBridge {
  readonly session: AdlSessionState;
  readonly invite: AdlInviteState;
  /** The caller's own active sessions, loaded on demand. */
  readonly devices: AdlDeviceState;
  /** Settled operations still awaiting a strategy or a person. */
  readonly recovery: SyncRecoveryItem[];
  /**
   * Accepted writes that have not reached the authority. Unlike `recovery`
   * these carry no verdict and are still queued: the user is being told the
   * work has not landed, not asked to choose a winner.
   */
  readonly undelivered: SyncDeliveryItem[];
  signIn(accountProof: string): Promise<void>;
  /**
   * Registers an authenticator. With no invite token the caller must already
   * hold a session and is adding another authenticator to their own identity;
   * with one, the authority decides from the invite whether this admits a new
   * member or re-links an existing identity that lost every authenticator.
   */
  registerPasskey(inviteToken?: string): Promise<void>;
  /** Signs in with a registered authenticator. The authority verifies the assertion. */
  signInWithPasskey(): Promise<void>;
  signOut(): Promise<void>;
  /** Loads the caller's own active sessions. Online-only; there is nothing cached to show. */
  refreshDevices(): Promise<void>;
  /**
   * Ends one of the caller's own sessions. Revocation is the compensating
   * control for a grace measured in weeks, so it must reach the authority
   * rather than being recorded locally for later.
   */
  revokeDevice(sessionId: string): Promise<void>;
  claimInvite(inviteToken: string): Promise<void>;
  resolveRecovery(queueId: string, choice: SyncRecoveryChoice): Promise<void>;
  /**
   * Sends every queued operation whose mode does not permit it to wait. Called
   * after a write rather than only on reconnect, because an `onlineRequired`
   * write was accepted on the premise that the authority is reachable now.
   *
   * Returns how many operations the authority answered, so a caller can refresh
   * the records those answers changed and do nothing at all when there was
   * nothing to send.
   */
  deliverPending(): Promise<number>;
  /** Sends one undelivered operation again under its original operation id. */
  retryDelivery(queueId: string): Promise<void>;

  /**
   * Operational review for the business context currently selected. Every read
   * behind this goes through an existing Phase 43 endpoint, and the server keeps
   * deriving identity, role and scope: the browser adds no authority, holds no
   * operational credential, and never decides what a caller may see.
   */
  readonly administration: AdlAdministrationState;
  /** Loads every administration status surface for the selected context. */
  loadAdministration(): Promise<void>;
  /** Loads the next page of one review list, using the cursor the server returned. */
  loadMoreAdministration(list: AdlAdministrationListName): Promise<void>;
  /** Executes one named read model as a report. */
  runReport(readModelName: string): Promise<void>;
  /** Loads the next page of the report currently shown. */
  loadMoreReport(): Promise<void>;
  /** Exports the named report as CSV and offers it as a download. */
  exportReport(readModelName: string): Promise<void>;
  /** Ends every session of a member of the administered context. */
  revokeMemberSessions(userId: string): Promise<void>;
}

export type AdlAdministrationListName = "accessAudit" | "runtimeAudit" | "memberships" | "invites";

/**
 * One bounded review list as the surface holds it. `nextCursor` is the server's
 * own opaque cursor, passed back untouched — the browser neither composes nor
 * interprets one.
 */
export interface AdlAdministrationList {
  entries: Array<Record<string, unknown>>;
  nextCursor?: string;
  /** True while another page is being fetched, so the control can be disabled. */
  loadingMore?: boolean;
}

export type AdlAdministrationStatus =
  | "unavailable"
  | "idle"
  | "loading"
  | "loaded"
  | "offline"
  | "error";

/**
 * Administration view state.
 *
 * `unavailable` means there is no business context selected to administer — not
 * that the caller lacks permission. Permission is never reported: a caller the
 * authority refuses sees the same empty lists as one whose context genuinely has
 * nothing in it, because a denied row and an absent row must stay
 * indistinguishable.
 */
export interface AdlAdministrationState {
  status: AdlAdministrationStatus;
  /** The context being administered, when one is selected. */
  contextName?: string;
  contextId?: string;
  accessAudit: AdlAdministrationList;
  runtimeAudit: AdlAdministrationList;
  memberships: AdlAdministrationList;
  invites: AdlAdministrationList;
  /** Restore-verification status: flags, never counts of anything protected. */
  recovery?: Record<string, unknown>;
  /** Retention windows, schedule, and what the last run did. Read-only. */
  retention?: Record<string, unknown> | null;
  /** The report currently shown, if any. */
  report?: AuthorityReportPage;
  /** The read model that report came from, kept so paging and export agree on it. */
  reportName?: string;
  reportStatus?: "idle" | "running" | "exporting" | "ready" | "error";
  /** Credential-free text for the last failure or confirmation. */
  message?: string;
}

/** An administration list with nothing in it yet. */
export const EMPTY_ADMINISTRATION_LIST: AdlAdministrationList = { entries: [] };

export type AdlSessionStatus = "signedOut" | "signedIn" | "unavailable";

export interface AdlSessionState {
  status: AdlSessionStatus;
  /** Server-derived. The browser never asserts an identity of its own. */
  userId?: string;
  /**
   * True when the authority reports a bypassed identity verifier. The sign-in
   * surface must say so: a deployment that accepts an unverified subject is a
   * development mode and must never look like a verified sign-in.
   */
  developmentMode: boolean;
  /**
   * The authority's own identity-verification mode, read from `/readyz`. The
   * surface uses it only to offer the right way in — a passkey deployment has
   * no account proof to type — and it never widens what the client may do.
   */
  identityMode: string;
  /** False when the platform has no WebAuthn support, so the surface can say so. */
  passkeySupported: boolean;
  /** In flight, so the surface can disable its controls. */
  busy: boolean;
  /** Credential-free failure text for the last attempt. */
  error?: string;
  /** Credential-free confirmation text for the last successful ceremony. */
  notice?: string;
  /**
   * How much of the declared offline grace this device has left since its last
   * successful authentication. It gates **sync only** — the app stays fully
   * usable offline either side of it — and it is an affordance, not an
   * enforcement point: the authority independently refuses an expired session.
   */
  grace: OfflineGraceState;
}

export interface AdlDeviceState {
  status: "idle" | "loading" | "loaded" | "offline" | "error";
  /** The caller's own active sessions, newest first. Never anyone else's. */
  devices: AuthorityDeviceSession[];
  message?: string;
}

export interface AdlInviteState {
  status: "idle" | "claiming" | "accepted" | "rejected" | "offline";
  message?: string;
}

/**
 * Mirrors the authority's own minimum account-proof length. The server remains
 * authoritative and rejects a short proof itself; this only lets the sign-in
 * surface say so before spending a request.
 */
export const AUTHORITY_MINIMUM_ACCOUNT_PROOF_LENGTH = 16;

/** Mirrors the authority's minimum invite-token length for the same reason. */
export const AUTHORITY_MINIMUM_INVITE_TOKEN_LENGTH = 32;

export const ADL_SIGN_IN_EVENT = "adl-sign-in";
export const ADL_SIGN_OUT_EVENT = "adl-sign-out";
export const ADL_CLAIM_INVITE_EVENT = "adl-claim-invite";
export const ADL_RESOLVE_RECOVERY_EVENT = "adl-resolve-recovery";
export const ADL_RETRY_DELIVERY_EVENT = "adl-retry-delivery";
export const ADL_REGISTER_PASSKEY_EVENT = "adl-register-passkey";
export const ADL_PASSKEY_SIGN_IN_EVENT = "adl-passkey-sign-in";
export const ADL_REFRESH_DEVICES_EVENT = "adl-refresh-devices";
export const ADL_REVOKE_DEVICE_EVENT = "adl-revoke-device";
export const ADL_LOAD_ADMINISTRATION_EVENT = "adl-load-administration";
export const ADL_LOAD_MORE_ADMINISTRATION_EVENT = "adl-load-more-administration";
export const ADL_RUN_REPORT_EVENT = "adl-run-report";
export const ADL_LOAD_MORE_REPORT_EVENT = "adl-load-more-report";
export const ADL_EXPORT_REPORT_EVENT = "adl-export-report";
export const ADL_REVOKE_MEMBER_SESSIONS_EVENT = "adl-revoke-member-sessions";

/** The identity-verification mode in which the passkey surface is the way in. */
export const PASSKEY_IDENTITY_MODE = "passkey";

export interface SignInDetail {
  accountProof: string;
}

export interface RegisterPasskeyDetail {
  /** Absent when an already signed-in person is adding another authenticator. */
  inviteToken?: string;
}

export interface ClaimInviteDetail {
  inviteToken: string;
}

export interface RevokeDeviceDetail {
  sessionId: string;
}

export interface LoadMoreAdministrationDetail {
  list: AdlAdministrationListName;
}

export interface RunReportDetail {
  readModelName: string;
}

export interface RevokeMemberSessionsDetail {
  userId: string;
}

export interface ResolveRecoveryDetail {
  queueId: string;
  choice: SyncRecoveryChoice;
}

export interface RetryDeliveryDetail {
  queueId: string;
}

export const RECOVERY_CHOICE_LABELS: Record<SyncRecoveryChoice, string> = {
  keepServer: "Keep the server version",
  resubmitMine: "Resubmit my change",
};

/** Terminal-verdict wording, so a rejection does not read as a choice. */
export const RECOVERY_ACKNOWLEDGE_LABEL = "Dismiss";

/**
 * Wording for an undelivered write. It states what is true — the change is
 * saved here and the server has not received it — rather than implying the work
 * was lost or that the server refused it.
 */
export const DELIVERY_UNDELIVERED_LABEL = "Saved here, not yet sent to the server";
export const DELIVERY_RETRY_LABEL = "Try sending again";

export function describeRecoveryItem(item: SyncRecoveryItem): string {
  return describeSyncItem(item);
}

export function describeDeliveryItem(item: SyncDeliveryItem): string {
  return describeSyncItem(item);
}

/**
 * Names the change a person is being asked about.
 *
 * A command is named by the command, never by its object. For a command entry
 * `objectName`/`recordId` name the *representative* record the whole command is
 * filed under — the object whose sync mode decided how it was delivered — and
 * not the subject of the change. Rendering them would tell someone that their
 * refused `CreateBand` was a rejected "Update BandMember", which is a change
 * they never made against a record they may not even recognise.
 *
 * The record count is part of the name for the same reason. A command succeeds
 * or fails as one transaction, so one entry stands for every record it wrote;
 * saying so is what stops one verdict reading as a verdict against one record
 * while the rest of the command silently went through.
 */
function describeSyncItem(item: SyncRecoveryItem | SyncDeliveryItem): string {
  if (item.operation !== "command") {
    return `${describeOperationKind(item.operation)} ${item.objectName}`;
  }

  const name = item.commandLabel ?? describeCommandName(item.commandName);
  const recordCount = item.recordCount ?? 0;

  return recordCount > 1 ? `${name} ${describeRecordCoverage(recordCount)}` : name;
}

/**
 * The declared label is preferred, then the command's own name title-cased.
 * A command entry always carries one of them; the bare "Command" is there so a
 * malformed entry still reads as what it is instead of borrowing the
 * representative record's object name.
 */
function describeCommandName(commandName: string | undefined): string {
  return commandName === undefined || commandName.length === 0
    ? OPERATION_KIND_LABELS.command
    : titleCaseIdentifier(commandName);
}

/** Plain and countable: one change on screen, and how far it reaches. */
function describeRecordCoverage(recordCount: number): string {
  return `— one command covering ${recordCount} records`;
}

function describeOperationKind(operation: SyncRecoveryItem["operation"]): string {
  return OPERATION_KIND_LABELS[operation];
}

/**
 * Exhaustive over `LocalOperationKind` on purpose. This was a chain of ternaries
 * falling back to "Update", so `command` — added when a command became one queue
 * entry — would have been labelled as an update of the representative record.
 * A map makes the next new kind a compile error rather than a quiet mislabel.
 */
const OPERATION_KIND_LABELS: Record<LocalOperationKind, string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  transition: "Transition",
  command: "Command",
};
