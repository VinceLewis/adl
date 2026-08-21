import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ApplicationRuntime,
  AuthorityAccessLifecycleService,
  AuthorityService,
  InMemoryAuthorityAccessStore,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  InMemoryWebAuthnCredentialStore,
  OpaqueSessionAdapter,
  PasskeyIdentityService,
  resolveApplicationModel,
  resolveSelfServiceRegistration,
  resolveSessionLifetime,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type { AuthorityConfiguration, RuntimeContext } from "../../src/index.js";
import { createAuthorityHttpHandler } from "../../src/server/authority-http.js";
import {
  RecordingSecurityLogger,
  clearActiveAuthorityRecorder,
  setActiveAuthorityRecorder,
} from "./support/authority-log.js";
import { loadAuthorityModel } from "../../src/server/authority-entrypoint.js";
import { SimpleWebAuthnLibrary } from "../../src/server/simplewebauthn-adapter.js";

/**
 * A throwaway authority for the Playwright passkey project.
 *
 * Three deliberate pieces of test wiring, and nothing else:
 *
 * 1. **In-memory stores.** The ceremony's correctness against real PostgreSQL
 *    is proven in `tests/integration/authority-passkey-identity.test.ts`. What
 *    this project proves is different and cannot be proven there: that a real
 *    Chromium, the real WebAuthn API, the real browser bridge and the real HTTP
 *    edge complete a ceremony end to end. Requiring Docker for
 *    `npm run verify:push` to screenshot a page would be the wrong trade.
 * 2. **An `https://` Request URL over a plain HTTP socket.** The edge refuses a
 *    non-HTTPS request, correctly. In deployment TLS terminates at a trusted
 *    proxy ahead of the process; here the local listener plays that part, the
 *    way `HttpAuthorityTransport`'s `forwardedProto` option does for the
 *    integration suite.
 * 3. **A seeded first administrator.** Somebody has to exist before anybody can
 *    be *invited*, and the invite tests need one. The stated reason used to be
 *    "registration is never anonymous"; since Phase 99 that is no longer true
 *    for a model declaring `REGISTRATION SELF_SERVICE`, which Giggle Band now
 *    does — the self-registration test below needs no seeded anybody. The
 *    administrator stays for the invite and recovery paths, and it still
 *    mirrors an out-of-band step rather than a capability the edge exposes.
 *
 * The WebAuthn implementation is the real `SimpleWebAuthnLibrary`: every
 * signature Chromium's virtual authenticator produces is verified for real.
 *
 * `localhost` is used rather than `127.0.0.1` because an IP address is not a
 * valid WebAuthn relying party id, and because a browser treats `localhost` as
 * a secure context, so `__Host-` Secure cookies are stored there.
 */

export const PASSKEY_AUTHORITY_PORT = 8788;
export const PASSKEY_APP_PORT = 5273;
export const PASSKEY_APP_ORIGIN = `http://localhost:${PASSKEY_APP_PORT}`;
export const PASSKEY_RELYING_PARTY_ID = "localhost";

export interface PasskeyAuthorityHarness {
  server: Server;
  /** The authority's own security log, captured per test by the evidence fixture. */
  recorder: RecordingSecurityLogger;
  port: number;
  /** A fresh single-use invitation for a first-time member. */
  invite(): Promise<string>;
  /** A recipient-bound invitation that re-admits an identity that lost its devices. */
  recoveryInvite(userId: string): Promise<string>;
  close(): Promise<void>;
}

export async function startPasskeyAuthority(): Promise<PasskeyAuthorityHarness> {
  // The reference app the browser is running, read from the same ADL sources,
  // so a bootstrap after sign-in is model-compatible rather than a second model.
  const model = loadAuthorityModel("src/reference/giggle-band");
  // Derived from the model's declared offline grace exactly as the entrypoint
  // derives it, so the browser sees the real session lifetime and the real
  // persistent cookies rather than a shorter fixture value.
  const configuration: AuthorityConfiguration = resolveSessionLifetime(
    {
      environment: "test",
      databaseUrl: "postgresql://unused/unused",
      allowedOrigins: [PASSKEY_APP_ORIGIN],
      cookieName: "__Host-adl_session",
      csrfCookieName: "__Host-adl_csrf",
      sessionTtlMinutes: 60,
      maxRequestBytes: 65_536,
      upstreamIdentity: { issuer: "https://issuer.test", audience: "adl" },
      identityVerification: { mode: "passkey" },
      webauthn: {
        relyingPartyId: PASSKEY_RELYING_PARTY_ID,
        relyingPartyName: "ADL passkey fixture",
        origins: [PASSKEY_APP_ORIGIN],
        challengeTtlSeconds: 300,
      },
      rateLimits: {
        accountProof: 500,
        webauthn: 500,
        selfRegistration: 500,
        session: 500,
        invite: 500,
        bootstrap: 500,
        replay: 500,
        report: 500,
        administration: 500,
      },
    },
    model,
  );
  // Composed exactly as `createAuthorityProcess` composes it: the model
  // declares whether strangers may register, and the deployment ceiling may
  // only restrict that. Nothing is faked — Giggle Band's own `domain.adlj`
  // carries the declaration.
  const resolved = resolveSelfServiceRegistration(configuration, model);

  const storage = new InMemoryObjectStorageBackend();
  const sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore(), {
    sessionTtlMs: configuration.sessionTtlMinutes * 60_000,
  });
  const authority = new AuthorityService(model, storage, sessions);
  const accessLifecycle = new AuthorityAccessLifecycleService(
    model,
    storage,
    sessions,
    new InMemoryAuthorityAccessStore(storage),
  );
  const passkeys = new PasskeyIdentityService(
    configuration.webauthn!,
    sessions,
    new InMemoryWebAuthnCredentialStore(),
    new SimpleWebAuthnLibrary(),
    {
      accessLifecycle,
      selfServiceRegistration: resolved.selfServiceRegistrationEnabled === true,
    },
  );

  // The out-of-band first administrator. Their identity is linked under a
  // `seed` provider, which is exactly the point of the link table: an identity
  // is not tied to the mechanism that first named it, so this administrator
  // could later register a passkey of their own without changing user id.
  const systemContext: RuntimeContext = { userId: "system", roles: ["SystemAdmin"], channel: "ui" };
  const runtime = new ApplicationRuntime(model, { storage });
  const admin = await sessions.provisionIdentity("seed", "first-administrator");
  const band = await runtime.create("Band", { Name: "Alpha" }, systemContext);
  const bandId = band.meta.guid;
  await runtime.create(
    "BandMember",
    { User: admin.userId, Band: bandId, Role: "BandAdmin" },
    { ...systemContext, selectedContexts: { Band: bandId } },
  );
  const adminSession = await sessions.issueSession(admin.userId);

  // Captured rather than printed. Without this the authority's structured log
  // goes to `console.info` in the Playwright worker, interleaved with the
  // reporter and attributed to no test (see security-operations.ts).
  const recorder = new RecordingSecurityLogger();

  const handle = createAuthorityHttpHandler({
    logger: recorder,
    configuration: resolved,
    authority,
    sessions,
    identityVerifier: selectUpstreamIdentityVerifier(configuration),
    passkeys,
    accessLifecycle,
  });

  const server = createServer(async (incoming, outgoing) => {
    // TLS is terminated by the local listener, as a trusted proxy would.
    const request = new Request(`https://localhost${incoming.url ?? "/"}`, {
      method: incoming.method,
      headers: toHeaders(incoming.headers),
      ...(incoming.method === "GET" || incoming.method === "HEAD" ? {} : { body: incoming }),
      duplex: "half",
    } as unknown as RequestInit);
    const startedAt = Date.now();
    try {
      const result = await handle(request);
      recorder.writeHarnessEvent({
        event: "http_request",
        outcome: result.status >= 500 ? "failed" : "allowed",
        endpoint: new URL(request.url).pathname,
        status: result.status,
        method: incoming.method ?? "",
        durationMs: Date.now() - startedAt,
        occurredAt: new Date().toISOString(),
      });
      const headers: Record<string, string | string[]> = Object.fromEntries(
        result.headers.entries(),
      );
      const setCookies = (
        result.headers as Headers & { getSetCookie?: () => string[] }
      ).getSetCookie?.();
      if (setCookies !== undefined) headers["set-cookie"] = setCookies;
      outgoing.writeHead(result.status, headers);
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      // Never swallowed. Before this, a genuine unhandled exception in the
      // authority became an opaque 500 with the stack trace destroyed, and no
      // browser test looked at the status. It is now a recorded `failed`
      // outcome, which the evidence gate fails the test on.
      recorder.writeHarnessEvent({
        event: "http_request_unhandled_error",
        outcome: "failed",
        endpoint: new URL(request.url).pathname,
        status: 500,
        reason: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? "") : "",
        occurredAt: new Date().toISOString(),
      });
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end('{"error":"internal_error"}');
    }
  });

  await new Promise<void>((settle, fail) => {
    server.once("error", fail);
    // Bound by name, not by 127.0.0.1: the page fetches `http://localhost`, and
    // on a dual-stack host that can resolve to ::1 first.
    server.listen(PASSKEY_AUTHORITY_PORT, "localhost", () => settle());
  });

  const createInvite = async (recipientUserId?: string): Promise<string> =>
    (
      await accessLifecycle.createInvite(adminSession.sessionToken, {
        contextName: "Band",
        contextId: bandId,
        role: "BandMember",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        ...(recipientUserId === undefined ? {} : { recipientUserId }),
      })
    ).inviteToken;

  setActiveAuthorityRecorder(recorder, `http://localhost:${PASSKEY_AUTHORITY_PORT}`);

  return {
    server,
    recorder,
    port: (server.address() as AddressInfo).port,
    invite: () => createInvite(),
    recoveryInvite: (userId: string) => createInvite(userId),
    close: () =>
      new Promise<void>((settle) => {
        clearActiveAuthorityRecorder();
        server.close(() => settle());
      }),
  };
}

function toHeaders(source: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}
