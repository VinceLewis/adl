import {
  connectBrowserAuthority,
  describeAuthorityFailure,
  watchAuthorityReconnect,
} from "./authority-sync.js";
import type {
  BrowserAuthorityConfiguration,
  BrowserAuthorityConnection,
} from "./authority-sync.js";
import { SIGNED_OUT_IDENTITY } from "./offline-session.js";
import type { ApplicationRuntime } from "../runtime/application-runtime.js";
import type { RuntimeContext } from "../runtime/runtime-types.js";

/**
 * The shell surface the startup wiring needs. `adl-app` satisfies it; a test
 * supplies a minimal stand-in, so the startup sequence can be exercised without
 * mounting the whole component tree.
 */
export interface AuthorityStartupHost {
  context: RuntimeContext;
  authority?: unknown;
  refreshAuthorityState(): void;
  refreshFromRuntime(): void | Promise<void>;
}

/**
 * Attaches the authority bridge to the shell. The bridge exists even with no
 * session, so the user is shown a sign-in surface rather than a blank page, and
 * the seeded demo identity is replaced by the server-derived one as soon as
 * there is a session. Every failure is a single warning and a fall back to
 * local behaviour: an unreachable authority must never leave a blank page.
 */
export async function connectAuthority(
  app: AuthorityStartupHost,
  runtime: ApplicationRuntime,
  authority: BrowserAuthorityConfiguration | null,
): Promise<BrowserAuthorityConnection | undefined> {
  if (authority === null) {
    return undefined;
  }

  try {
    const connection = await connectBrowserAuthority(runtime, authority, {
      getContext: () => app.context,
      onChange: () => {
        applySessionIdentity(app, connection.session.userId);
        app.refreshAuthorityState();
      },
    });
    app.authority = connection;
    applySessionIdentity(app, connection.session.userId);

    try {
      await connection.synchronize(app.context);
    } finally {
      // Registered even when the first sync fails: reconnect is how a browser
      // that started offline recovers its queued work.
      watchAuthorityReconnect(
        connection,
        () => app.context,
        () => app.refreshFromRuntime(),
      );
    }

    return connection;
  } catch (error) {
    console.warn(
      `ADL authority sync is unavailable; continuing with local data: ${describeAuthorityFailure(error)}`,
    );
    return undefined;
  }
}

/**
 * Applies the identity the bridge reports to the shell's context.
 *
 * The browser still never chooses a user id: the id here is either
 * server-derived from a live session or the one the authority last confirmed
 * on this device, cached so an offline reload does not lose it.
 *
 * When there is neither, the app runs as {@link SIGNED_OUT_IDENTITY} rather
 * than keeping the demo identity it started with. That fallback was the defect:
 * `LOCAL_DEMO_IDENTITY` names a purely local demo device, it matches no
 * membership, and leaving it in place when a real session is expected made the
 * app look signed in as something that is not an account.
 */
export function applySessionIdentity(app: AuthorityStartupHost, userId: string | undefined): void {
  const identity = userId ?? SIGNED_OUT_IDENTITY;
  if (identity !== app.context.userId) {
    app.context = { ...app.context, userId: identity };
  }
}
