import {
  AuthorityTransportError,
  HttpAuthorityTransport,
} from "../server/http-authority-transport.js";
import { AuthoritySyncClient } from "../server/sync-client.js";
import type { SyncRecoveryChoice, SyncRecoveryItem } from "../server/sync-client.js";
import type { AuthorityOutcome } from "../server/authority-types.js";
import type { HttpAuthorityTransportOptions } from "../server/http-authority-transport.js";
import type { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";
import type {
  AdlAuthorityBridge,
  AdlDeviceState,
  AdlInviteState,
  AdlSessionState,
} from "./authority-bridge.js";
import { evaluateOfflineGrace, shouldRotateSession } from "./offline-session.js";
import type {
  OfflineGraceState,
  PersistedSessionIdentity,
  SessionIdentityStorage,
} from "./offline-session.js";
import { BrowserWebAuthnClient, WebAuthnCancelledError } from "./webauthn-client.js";
import type { WebAuthnBrowserClient } from "./webauthn-client.js";

/**
 * Browser-side authority wiring. Sync is opt-in: without a configured base URL
 * the browser stays a purely local IndexedDB demo, makes no network calls, and
 * renders no session chrome at all. The identity always comes from the server
 * session; the client never chooses a user id, role, audit actor, accepted
 * revision, or timestamp.
 */
export interface BrowserAuthorityConfiguration {
  /** Authority origin, for example `https://authority.example`. */
  baseUrl: string;
  /**
   * Transport wiring for non-browser callers — integration tests and tooling
   * that must supply their own cookie jar, fetch and origin because no user
   * agent is doing it for them. A browser leaves this unset and gets the
   * `__Host-` cookie behaviour. This is test wiring, not a second transport.
   */
  transport?: Omit<HttpAuthorityTransportOptions, "baseUrl">;
  /**
   * The authenticator seam. A browser leaves this unset and gets the platform
   * WebAuthn API; tests inject a software authenticator, because there is no
   * user agent to prompt. Test wiring, not a second client.
   */
  webauthn?: WebAuthnBrowserClient;
  /**
   * Where the server-derived identity and the grace clock are remembered
   * between loads. Without it the connection still works, but a reload with no
   * connection cannot know who is using the app — which is the defect this was
   * added to close.
   */
  identityStorage?: SessionIdentityStorage;
}

/**
 * Reads the opt-in configuration. Returns null when no base URL is configured,
 * which is the normal `npm run dev` and visual-test state.
 *
 * Phase 46's `VITE_ADL_ACCOUNT_PROOF` and `?account=` development configuration
 * are deliberately gone: a person now establishes identity by signing in
 * through the UI, so a build-time or URL-borne account proof would be a second,
 * weaker way in.
 */
export function readBrowserAuthorityConfiguration(
  env: Record<string, string | undefined>,
): BrowserAuthorityConfiguration | null {
  const baseUrl = trimmedValue(env.VITE_ADL_AUTHORITY_URL);
  return baseUrl === undefined ? null : { baseUrl };
}

export interface BrowserAuthorityConnection extends AdlAuthorityBridge {
  transport: HttpAuthorityTransport;
  client: AuthoritySyncClient;
  /** Applies every permitted page and returns how many records were reconciled. */
  bootstrap(context: RuntimeContext): Promise<number>;
  /** Replays the local-first queue; local-private work never enters that queue. */
  reconcile(context: RuntimeContext): Promise<AuthorityOutcome[]>;
  /** Replay, then read back accepted state, then apply every automatic recovery. */
  synchronize(context: RuntimeContext): Promise<void>;
}

export interface BrowserAuthorityOptions {
  /** The context the app is currently operating in, read at call time. */
  getContext(): RuntimeContext;
  /** Invoked whenever session, invite or recovery state changed and the shell must re-render. */
  onChange(): void | Promise<void>;
  /** Injectable clock. The grace is measured in weeks, so tests cannot wait it out. */
  now?: () => Date;
}

/**
 * Establishes the browser's connection to the authority. An existing session
 * cookie is reused, so a reload does not force a new sign-in. When there is no
 * session the connection still exists — signed out — so the shell can render a
 * sign-in surface instead of failing to start. The session token itself is
 * HttpOnly and unreadable here, which is why every call passes `undefined` as
 * the token: the user agent attaches the cookie.
 */
export async function connectBrowserAuthority(
  runtime: ApplicationRuntime,
  configuration: BrowserAuthorityConfiguration,
  options: BrowserAuthorityOptions,
): Promise<BrowserAuthorityConnection> {
  const transport = new HttpAuthorityTransport({
    baseUrl: configuration.baseUrl,
    ...configuration.transport,
  });
  const client = new AuthoritySyncClient(runtime, transport);
  const webauthn = configuration.webauthn ?? new BrowserWebAuthnClient();
  const storage = configuration.identityStorage;
  const now = options.now ?? (() => new Date());
  const offlineGraceDays = runtime.model.app.offlineGraceDays;

  /*
   * Read before anything is attempted over the network. This is what makes a
   * reload with no connection keep the user's own identity instead of falling
   * back to a demo one, so it must not depend on a request succeeding. A
   * storage failure is survivable: the app runs signed out rather than not at
   * all.
   */
  let persisted: PersistedSessionIdentity | null = null;
  try {
    persisted = (await storage?.read()) ?? null;
  } catch (error) {
    console.warn(
      `ADL could not read the cached session identity: ${describeAuthorityFailure(error)}`,
    );
  }
  let grace: OfflineGraceState = evaluateOfflineGrace(persisted, offlineGraceDays, now());

  // An unreachable authority must not be read as a verified one: the session is
  // reported unavailable and the deployment is still treated as development.
  let session: AdlSessionState = {
    status: "unavailable",
    developmentMode: true,
    identityMode: "unknown",
    passkeySupported: webauthn.available(),
    busy: false,
    // The cached identity stands in while the authority is unreachable, so the
    // person keeps reading their own data. It is never sent as proof.
    ...(persisted === null ? {} : { userId: persisted.userId }),
    grace,
  };
  let invite: AdlInviteState = { status: "idle" };
  let devices: AdlDeviceState = { status: "idle", devices: [] };
  let recovery: SyncRecoveryItem[] = client.listRecovery();
  let readinessAnswered = false;

  try {
    /*
     * Readiness is applied as soon as it answers, before the session call. It
     * is a GET outside the CSRF and session surface, so a caller with no
     * session can still learn how this deployment verifies identity — and an
     * authority that is reachable but cannot answer for a session must still be
     * able to offer the right way back in. Folding both into one assignment
     * left `identityMode` at "unknown" whenever the session call failed.
     */
    const readiness = await transport.readiness();
    readinessAnswered = true;
    session = {
      ...session,
      developmentMode: readiness.bypassed,
      identityMode: readiness.mode,
    };
    const identity = await transport.currentSession();
    if (identity !== null) {
      // A verified session is a successful authentication, so the grace
      // restarts here — and the server-derived identity always wins over the
      // cached one.
      await recordAuthenticated(identity.userId);
      // Decided on connect rather than per call: a device that opens the app at
      // all keeps restarting its grace, without a session write per sync.
      await rotate();
    } else {
      // The authority is reachable and says there is no session. The cached
      // identity is dropped rather than kept as a shadow account: the person
      // must sign in, and until they do the app must not operate as them.
      await forgetIdentity();
    }
    session = {
      ...session,
      status: identity === null ? "signedOut" : "signedIn",
      ...(identity === null ? {} : { userId: identity.userId }),
      busy: false,
      grace,
    };
    if (identity === null) delete session.userId;
  } catch (error) {
    session = {
      ...session,
      status: "unavailable",
      // An authority that never answered must not be read as a verified one.
      // One that *did* answer readiness has already stated whether it is
      // bypassed, and that answer stands even if the session call then failed —
      // forcing it back to true would be a false development warning.
      developmentMode: readinessAnswered ? session.developmentMode : true,
      error: describeAuthorityFailure(error),
      grace,
    };
  }

  const connection: BrowserAuthorityConnection = {
    transport,
    client,
    get session() {
      return session;
    },
    get invite() {
      return invite;
    },
    get devices() {
      return devices;
    },
    get recovery() {
      return recovery;
    },

    async bootstrap(context: RuntimeContext): Promise<number> {
      const response = await client.bootstrap(undefined, context);
      return response.records.length;
    },

    async reconcile(context: RuntimeContext): Promise<AuthorityOutcome[]> {
      return client.reconcile(undefined, context);
    },

    /**
     * Order matters. Replay first so local work is judged before accepted state
     * is read back; bootstrap next so every conflicted record holds the
     * authority's version; automatic recovery last, because `serverWins` relies
     * on that replacement having happened and `clientWins` rebases on the
     * revision bootstrap just wrote.
     *
     * The grace gate sits in front of all of it. Outside the grace this is a
     * refusal to *attempt* sync, which is neither a transport failure nor a
     * verdict: every queued entry keeps its place, nothing is marked rejected,
     * and local reads and writes are untouched. The authority refuses an
     * expired session independently, so skipping this check gains a client
     * nothing.
     */
    async synchronize(context: RuntimeContext): Promise<void> {
      grace = evaluateOfflineGrace(persisted, offlineGraceDays, now());
      if (grace.status === "expired") {
        session = { ...session, grace };
        return;
      }

      await client.reconcile(undefined, context);
      await client.bootstrap(undefined, context);
      await client.applyAutomaticRecovery(undefined, context);
      recovery = client.listRecovery();
      // A completed sync is a successful contact, so the clock restarts. Past
      // the halfway point it also rotates, which is what restarts the session
      // the authority holds rather than only the client's belief about it.
      if (shouldRotateSession(persisted, offlineGraceDays, now())) {
        await rotate();
      } else if (persisted !== null) {
        await recordAuthenticated(persisted.userId);
      }
      session = { ...session, grace };
    },

    async signIn(accountProof: string): Promise<void> {
      await withBusy(async () => {
        const identity = await transport.signIn(accountProof);
        await recordAuthenticated(identity.userId);
        session = { ...session, status: "signedIn", userId: identity.userId, busy: false, grace };
        await connection.synchronize(options.getContext());
      });
    },

    /**
     * Runs a registration ceremony. The authority issues the challenge and
     * decides everything that follows: whether this admits a new member, adds
     * an authenticator to an existing identity, or re-links an identity that
     * lost every authenticator. The browser only carries the options to the
     * platform authenticator and the response back, and holds neither the
     * challenge nor the invite token beyond the call.
     */
    async registerPasskey(inviteToken?: string): Promise<void> {
      await withBusy(async () => {
        const start = await transport.beginPasskeyRegistration(inviteToken);
        const response = await webauthn.create(start.options);
        const outcome = await transport.finishPasskeyRegistration({
          challengeId: start.challengeId,
          response,
          ...(inviteToken === undefined ? {} : { inviteToken }),
        });
        await recordAuthenticated(outcome.userId);
        session = {
          ...session,
          status: "signedIn",
          userId: outcome.userId,
          busy: false,
          grace,
          notice:
            outcome.invite === "identityRecovered"
              ? "This device is registered and your existing access was restored."
              : outcome.invite === "membershipGranted"
                ? "This device is registered and the invitation was accepted."
                : "This device is registered.",
        };
        await connection.synchronize(options.getContext());
      });
    },

    /** Signs in with a registered authenticator; the authority verifies the assertion. */
    async signInWithPasskey(): Promise<void> {
      await withBusy(async () => {
        const start = await transport.beginPasskeyAuthentication();
        const response = await webauthn.get(start.options);
        const identity = await transport.finishPasskeyAuthentication({
          challengeId: start.challengeId,
          response,
        });
        await recordAuthenticated(identity.userId);
        session = { ...session, status: "signedIn", userId: identity.userId, busy: false, grace };
        await connection.synchronize(options.getContext());
      });
    },

    async signOut(): Promise<void> {
      await withBusy(async () => {
        await transport.signOut();
        // Signing out forgets the cached identity too. Leaving it behind would
        // keep the app reading that person's data on a device they just said
        // they were done with.
        await forgetIdentity();
        session = { ...session, status: "signedOut", busy: false, grace };
        delete session.userId;
        delete session.notice;
        invite = { status: "idle" };
        devices = { status: "idle", devices: [] };
      });
    },

    /**
     * Loads the caller's own active sessions. Online-only and never cached:
     * a stale list would invite someone to believe they had revoked a device
     * when they had not.
     */
    async refreshDevices(): Promise<void> {
      if (!isOnline(options.getContext())) {
        devices = {
          status: "offline",
          devices: [],
          message: "Your devices can only be listed while connected to the authority server.",
        };
        await options.onChange();
        return;
      }

      devices = { status: "loading", devices: devices.devices };
      await options.onChange();
      try {
        devices = { status: "loaded", devices: await transport.listSessions() };
      } catch (error) {
        devices = { status: "error", devices: [], message: describeAuthorityFailure(error) };
      }
      await options.onChange();
    },

    /**
     * Ends one of the caller's own sessions, then reloads the list from the
     * authority rather than removing the row locally: the server decides what
     * is still active, and revocation must be seen to have happened there.
     */
    async revokeDevice(sessionId: string): Promise<void> {
      if (!isOnline(options.getContext())) {
        devices = {
          ...devices,
          status: "offline",
          message: "Revoking a device needs a connection to the authority server.",
        };
        await options.onChange();
        return;
      }

      devices = { ...devices, status: "loading" };
      await options.onChange();
      try {
        await transport.revokeSession(sessionId);
      } catch (error) {
        devices = { ...devices, status: "error", message: describeAuthorityFailure(error) };
        await options.onChange();
        return;
      }
      await connection.refreshDevices();
    },

    /**
     * Online-only and server-authoritative. An offline attempt is refused here
     * rather than queued: no membership may be pre-granted, and no claim may be
     * cached for later replay. The newly permitted context only appears after
     * the bootstrap that follows the server's confirmation.
     */
    async claimInvite(inviteToken: string): Promise<void> {
      if (!isOnline(options.getContext())) {
        invite = {
          status: "offline",
          message: "Claiming an invitation needs a connection to the authority server.",
        };
        await options.onChange();
        return;
      }

      invite = { status: "claiming" };
      await options.onChange();
      try {
        const result = await transport.claimInvite(inviteToken);
        if (result.status === "accepted") {
          await connection.synchronize(options.getContext());
          invite = { status: "accepted", message: "The invitation was accepted." };
        } else {
          invite = { status: "rejected", message: `The invitation was refused (${result.code}).` };
        }
      } catch (error) {
        invite = { status: "rejected", message: describeAuthorityFailure(error) };
      }
      await options.onChange();
    },

    /**
     * Applies one user resolution. `keepServer` is followed by a bootstrap so
     * "keep the server version" is actually true locally rather than merely
     * dropping the queued operation.
     */
    async resolveRecovery(queueId: string, choice: SyncRecoveryChoice): Promise<void> {
      const context = options.getContext();
      try {
        await client.resolveRecovery(undefined, context, queueId, choice);
        if (choice === "keepServer") {
          await client.bootstrap(undefined, context);
        }
      } catch (error) {
        session = { ...session, error: describeAuthorityFailure(error) };
      }
      recovery = client.listRecovery();
      await options.onChange();
    },
  };

  return connection;

  /**
   * Records a successful authentication: the server-derived identity is cached
   * and the grace clock restarts from now. This is the only writer of the
   * cached identity, and it only ever writes an id the authority just reported.
   */
  async function recordAuthenticated(userId: string): Promise<void> {
    const identity: PersistedSessionIdentity = { userId, lastVerifiedAt: now().toISOString() };
    persisted = identity;
    grace = evaluateOfflineGrace(identity, offlineGraceDays, now());
    try {
      await storage?.write(identity);
    } catch (error) {
      // The session is still live in this tab; only the next reload loses it.
      console.warn(
        `ADL could not persist the session identity: ${describeAuthorityFailure(error)}`,
      );
    }
  }

  /** Drops the cached identity, so the app stops operating as that person. */
  async function forgetIdentity(): Promise<void> {
    persisted = null;
    grace = evaluateOfflineGrace(null, offlineGraceDays, now());
    try {
      await storage?.clear();
    } catch (error) {
      console.warn(
        `ADL could not clear the cached session identity: ${describeAuthorityFailure(error)}`,
      );
    }
  }

  /**
   * Restarts the grace server-side as well as locally. A rotation presents no
   * credential — it exchanges a still-valid session for a fresh one — so a
   * session the authority has already expired or revoked is refused here, and
   * that refusal is not an error worth surfacing: the next call reports the
   * signed-out state properly.
   */
  async function rotate(): Promise<void> {
    try {
      await transport.rotateSession();
      if (session.userId !== undefined) await recordAuthenticated(session.userId);
      else if (persisted !== null) await recordAuthenticated(persisted.userId);
    } catch (error) {
      console.warn(
        `ADL could not rotate the authority session: ${describeAuthorityFailure(error)}`,
      );
    }
  }

  async function withBusy(action: () => Promise<void>): Promise<void> {
    session = { ...session, busy: true };
    delete session.error;
    delete session.notice;
    await options.onChange();
    try {
      await action();
    } catch (error) {
      // Dismissing the platform prompt is a choice, not a failure, so it leaves
      // the surface exactly as it was rather than reporting an error.
      session =
        error instanceof WebAuthnCancelledError
          ? { ...session, busy: false }
          : { ...session, busy: false, error: describeAuthorityFailure(error) };
    }
    session = { ...session, busy: false };
    recovery = client.listRecovery();
    await options.onChange();
  }
}

/**
 * Drains the offline queue and refreshes the dataset when the browser comes
 * back online. The handler never throws: a failed reconnect is a warning, and
 * the queue survives for the next attempt.
 */
export function watchAuthorityReconnect(
  connection: BrowserAuthorityConnection,
  getContext: () => RuntimeContext,
  onSynced: () => void | Promise<void>,
): () => void {
  let running = false;
  const handler = (): void => {
    if (running) {
      return;
    }

    running = true;
    void (async () => {
      try {
        await connection.synchronize(getContext());
        await onSynced();
      } catch (error) {
        console.warn(
          `ADL authority sync could not complete after reconnect: ${describeAuthorityFailure(error)}`,
        );
      } finally {
        running = false;
      }
    })();
  };

  globalThis.addEventListener?.("online", handler);
  return () => {
    globalThis.removeEventListener?.("online", handler);
  };
}

/** Concise, credential-free failure text. Proofs, cookies and tokens are never included. */
export function describeAuthorityFailure(error: unknown): string {
  if (error instanceof AuthorityTransportError) {
    return `${error.message} [status ${error.status}${error.code === undefined ? "" : `, ${error.code}`}]`;
  }

  return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

function isOnline(context: RuntimeContext): boolean {
  if (context.online !== undefined) {
    return context.online;
  }

  return globalThis.navigator?.onLine ?? true;
}

function trimmedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
