import type { SyncRecoveryChoice, SyncRecoveryItem } from "../server/sync-client.js";

/**
 * The seam between the browser shell and the authority connection. `adl-app`
 * and the session/recovery components depend on this interface only, so no UI
 * component imports the HTTP transport, and a local demo with no authority
 * configured simply has no bridge and renders no session chrome at all.
 */
export interface AdlAuthorityBridge {
  readonly session: AdlSessionState;
  readonly invite: AdlInviteState;
  /** Settled operations still awaiting a strategy or a person. */
  readonly recovery: SyncRecoveryItem[];
  signIn(accountProof: string): Promise<void>;
  signOut(): Promise<void>;
  claimInvite(inviteToken: string): Promise<void>;
  resolveRecovery(queueId: string, choice: SyncRecoveryChoice): Promise<void>;
}

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
  /** In flight, so the surface can disable its controls. */
  busy: boolean;
  /** Credential-free failure text for the last attempt. */
  error?: string;
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

export interface SignInDetail {
  accountProof: string;
}

export interface ClaimInviteDetail {
  inviteToken: string;
}

export interface ResolveRecoveryDetail {
  queueId: string;
  choice: SyncRecoveryChoice;
}

export const RECOVERY_CHOICE_LABELS: Record<SyncRecoveryChoice, string> = {
  keepServer: "Keep the server version",
  resubmitMine: "Resubmit my change",
};

/** Terminal-verdict wording, so a rejection does not read as a choice. */
export const RECOVERY_ACKNOWLEDGE_LABEL = "Dismiss";

export function describeRecoveryItem(item: SyncRecoveryItem): string {
  const operation =
    item.operation === "create"
      ? "Create"
      : item.operation === "delete"
        ? "Delete"
        : item.operation === "transition"
          ? "Transition"
          : "Update";
  return `${operation} ${item.objectName}`;
}
