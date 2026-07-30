import {
  AuthorityTransportError,
  HttpAuthorityTransport,
} from "../server/http-authority-transport.js";
import { AuthoritySyncClient } from "../server/sync-client.js";
import type { AuthorityOutcome } from "../server/authority-types.js";
import type { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";

/**
 * Browser-side authority wiring. Sync is opt-in: without a configured base URL
 * the browser stays a purely local IndexedDB demo and makes no network calls.
 * The identity always comes from the server session; the client never chooses a
 * user id, role, audit actor, accepted revision, or timestamp.
 */
export interface BrowserAuthorityConfiguration {
  /** Authority origin, for example `https://authority.example`. */
  baseUrl: string;
  /** Upstream account proof used only when no session cookie already exists. */
  accountProof: string | undefined;
}

/**
 * Reads the opt-in configuration. Returns null when no base URL is configured,
 * which is the normal `npm run dev` and visual-test state.
 */
export function readBrowserAuthorityConfiguration(
  env: Record<string, string | undefined>,
  search: string,
): BrowserAuthorityConfiguration | null {
  const baseUrl = trimmedValue(env.VITE_ADL_AUTHORITY_URL);
  if (baseUrl === undefined) {
    return null;
  }

  // A `?account=` parameter overrides the build-time proof so one deployment can
  // be driven as different subjects until Phase 47 adds a real sign-in screen.
  const requested = trimmedValue(new URLSearchParams(search).get("account") ?? undefined);
  return {
    baseUrl,
    accountProof: requested ?? trimmedValue(env.VITE_ADL_ACCOUNT_PROOF),
  };
}

export interface BrowserAuthorityConnection {
  /** Server-derived identity for `RuntimeContext.userId`. */
  userId: string;
  transport: HttpAuthorityTransport;
  client: AuthoritySyncClient;
  /** Applies every permitted page and returns how many records were reconciled. */
  bootstrap(context: RuntimeContext): Promise<number>;
  /** Replays the local-first queue; local-private work never enters that queue. */
  reconcile(context: RuntimeContext): Promise<AuthorityOutcome[]>;
}

/**
 * Establishes a session for this browser. An existing session cookie is reused
 * before an account proof is spent, so a reload does not re-issue a session.
 * The session token itself is HttpOnly and unreadable here, which is why every
 * call passes `undefined` as the token: the user agent attaches the cookie.
 */
export async function connectBrowserAuthority(
  runtime: ApplicationRuntime,
  configuration: BrowserAuthorityConfiguration,
): Promise<BrowserAuthorityConnection> {
  const transport = new HttpAuthorityTransport({ baseUrl: configuration.baseUrl });
  const existing = await transport.currentSession();
  const identity =
    existing ??
    (configuration.accountProof === undefined
      ? null
      : await transport.signIn(configuration.accountProof));

  if (identity === null) {
    throw new Error(
      "The authority server has no session for this browser and no account proof was configured.",
    );
  }

  const client = new AuthoritySyncClient(runtime, transport);
  return {
    userId: identity.userId,
    transport,
    client,
    async bootstrap(context: RuntimeContext): Promise<number> {
      const response = await client.bootstrap(undefined, context);
      return response.records.length;
    },
    async reconcile(context: RuntimeContext): Promise<AuthorityOutcome[]> {
      return client.reconcile(undefined, context);
    },
  };
}

/**
 * Drains the offline queue and refreshes the dataset when the browser comes
 * back online. Reconcile runs before bootstrap so local work is judged by the
 * authority before its accepted state is read back. The handler never throws:
 * a failed reconnect is a warning, and the queue survives for the next attempt.
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
        const context = getContext();
        await connection.reconcile(context);
        await connection.bootstrap(context);
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

function trimmedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}
