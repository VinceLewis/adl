import type { AuthorityDeviceSession } from "../server/http-authority-transport.js";
import type { SyncRecoveryChoice, SyncRecoveryItem } from "../server/sync-client.js";
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
export const ADL_REGISTER_PASSKEY_EVENT = "adl-register-passkey";
export const ADL_PASSKEY_SIGN_IN_EVENT = "adl-passkey-sign-in";
export const ADL_REFRESH_DEVICES_EVENT = "adl-refresh-devices";
export const ADL_REVOKE_DEVICE_EVENT = "adl-revoke-device";

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
