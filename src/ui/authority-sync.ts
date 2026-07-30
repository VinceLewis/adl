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
import type { AdlAuthorityBridge, AdlInviteState, AdlSessionState } from "./authority-bridge.js";

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

  // An unreachable authority must not be read as a verified one: the session is
  // reported unavailable and the deployment is still treated as development.
  let session: AdlSessionState = { status: "unavailable", developmentMode: true, busy: false };
  let invite: AdlInviteState = { status: "idle" };
  let recovery: SyncRecoveryItem[] = client.listRecovery();

  try {
    const readiness = await transport.readiness();
    const identity = await transport.currentSession();
    session = {
      status: identity === null ? "signedOut" : "signedIn",
      ...(identity === null ? {} : { userId: identity.userId }),
      developmentMode: readiness.bypassed,
      busy: false,
    };
  } catch (error) {
    session = {
      status: "unavailable",
      developmentMode: true,
      busy: false,
      error: describeAuthorityFailure(error),
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
     */
    async synchronize(context: RuntimeContext): Promise<void> {
      await client.reconcile(undefined, context);
      await client.bootstrap(undefined, context);
      await client.applyAutomaticRecovery(undefined, context);
      recovery = client.listRecovery();
    },

    async signIn(accountProof: string): Promise<void> {
      await withBusy(async () => {
        const identity = await transport.signIn(accountProof);
        session = {
          status: "signedIn",
          userId: identity.userId,
          developmentMode: session.developmentMode,
          busy: false,
        };
        await connection.synchronize(options.getContext());
      });
    },

    async signOut(): Promise<void> {
      await withBusy(async () => {
        await transport.signOut();
        session = {
          status: "signedOut",
          developmentMode: session.developmentMode,
          busy: false,
        };
        invite = { status: "idle" };
      });
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

  async function withBusy(action: () => Promise<void>): Promise<void> {
    session = { ...session, busy: true };
    delete session.error;
    await options.onChange();
    try {
      await action();
    } catch (error) {
      session = { ...session, busy: false, error: describeAuthorityFailure(error) };
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
