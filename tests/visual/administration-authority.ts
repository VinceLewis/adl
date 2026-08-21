import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ApplicationRuntime,
  AuthorityAccessLifecycleService,
  AuthorityAdministrationService,
  AuthorityReportingService,
  AuthorityService,
  InMemoryAuthorityAccessStore,
  InMemoryAuthorityAdministrationStore,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
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

/**
 * A throwaway authority for the Playwright administration project.
 *
 * The reason this project exists is the same one that produced the passkey
 * project: `npm run verify:push` screenshots the reference app with **no
 * authority configured**, so none of the authority chrome renders there and a
 * green visual run proves nothing about it. The administration surfaces are
 * authority chrome, so without a server behind them they would ship unseen.
 *
 * Deliberate test wiring, and nothing else:
 *
 * 1. **In-memory stores.** The administration surfaces' correctness against real
 *    PostgreSQL is proven in `tests/integration/`. What only a browser can prove
 *    is that the real components, the real bridge and the real HTTP edge produce
 *    a usable operator surface together. Requiring Docker to screenshot a page
 *    would be the wrong trade.
 * 2. **An `https://` Request URL over a plain HTTP socket**, exactly as the
 *    passkey harness does: the edge refuses a non-HTTPS request, and in
 *    deployment TLS terminates at a trusted proxy ahead of the process.
 * 3. **The identity bypass**, so the operator signs in by typing a proof rather
 *    than by completing a WebAuthn ceremony. The bypass is refused outright in
 *    production; here it keeps the spec about administration rather than about
 *    identity, which the passkey project already covers.
 * 4. **A seeded band administrator**, provisioned under the same `bypass`
 *    verifier and subject the sign-in form will send, so signing in lands on an
 *    identity that already manages a context. This mirrors the out-of-band
 *    first-admin step the production runbook documents.
 *
 * The retention status this harness returns is a fixture: retention itself is
 * proven against real PostgreSQL, and what the screenshot has to show is that
 * the surface presents it as read-only metadata with no way to trigger a run.
 */

export const ADMINISTRATION_AUTHORITY_PORT = 8789;
export const ADMINISTRATION_APP_PORT = 5373;
export const ADMINISTRATION_APP_ORIGIN = `http://localhost:${ADMINISTRATION_APP_PORT}`;

/** At least the authority's own minimum proof length, and stable across runs. */
export const ADMINISTRATION_ACCOUNT_PROOF = "visual-band-administrator";

export interface AdministrationAuthorityHarness {
  server: Server;
  /** The authority's own security log, captured per test by the evidence fixture. */
  recorder: RecordingSecurityLogger;
  port: number;
  /** The band the seeded administrator manages, for assertions in the spec. */
  bandId: string;
  bandName: string;
  /** The seeded administrator's server-derived user id. */
  adminUserId: string;
  /** A second member, so membership review has somebody to show and revoke. */
  memberUserId: string;
  close(): Promise<void>;
}

export async function startAdministrationAuthority(): Promise<AdministrationAuthorityHarness> {
  const model = loadAuthorityModel("src/reference/giggle-band");
  const configuration: AuthorityConfiguration = resolveSessionLifetime(
    {
      environment: "test",
      databaseUrl: "postgresql://unused/unused",
      allowedOrigins: [ADMINISTRATION_APP_ORIGIN],
      cookieName: "__Host-adl_session",
      csrfCookieName: "__Host-adl_csrf",
      sessionTtlMinutes: 60,
      maxRequestBytes: 65_536,
      upstreamIdentity: { issuer: "https://issuer.test", audience: "adl" },
      identityVerification: { mode: "bypass" },
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
  const administrationStore = new InMemoryAuthorityAdministrationStore();
  const reporting = new AuthorityReportingService(model, storage, sessions, administrationStore);

  // The seeded band, its administrator, and a second member to review. The
  // administrator is provisioned under `bypass` with the exact subject the
  // sign-in form sends, so the session the spec obtains is theirs.
  const systemContext: RuntimeContext = { userId: "system", roles: ["SystemAdmin"], channel: "ui" };
  const runtime = new ApplicationRuntime(model, { storage });
  const admin = await sessions.provisionIdentity("bypass", ADMINISTRATION_ACCOUNT_PROOF);
  const member = await sessions.provisionIdentity("bypass", "visual-band-member");
  const bandName = "The Alphas";
  const band = await runtime.create("Band", { Name: bandName }, systemContext);
  const bandId = band.meta.guid;
  const bandContext: RuntimeContext = { ...systemContext, selectedContexts: { Band: bandId } };
  await runtime.create(
    "BandMember",
    { User: admin.userId, Band: bandId, Role: "BandAdmin" },
    bandContext,
  );
  await runtime.create(
    "BandMember",
    { User: member.userId, Band: bandId, Role: "BandMember" },
    bandContext,
  );
  // Something for the reports to actually return.
  await runtime.create(
    "Event",
    {
      Band: bandId,
      EventType: "Gig",
      Date: "2026-08-14",
      Title: "Canal Street headline",
      VenueName: "Canal Street Rooms",
    },
    bandContext,
  );
  // A member the operator can end sessions for, with a session to end.
  await sessions.issueSession(member.userId);

  const administration = new AuthorityAdministrationService(
    model,
    storage,
    accessLifecycle,
    administrationStore,
    administrationStore,
    async () => ({ ready: true, recoveryRequired: false }),
    () => new Date(),
    undefined,
    // Metadata only, and read-only: there is deliberately no counterpart that
    // runs retention from a browser session.
    async () => ({
      scheduled: true,
      intervalMinutes: 1_440,
      legalHold: false,
      minimumRetentionDays: 365,
      sessionRetentionDays: 30,
      challengeRetentionDays: 1,
      lastRun: {
        runId: "retention-visual-fixture",
        startedAt: "2026-07-30T02:00:00.000Z",
        finishedAt: "2026-07-30T02:00:04.000Z",
        outcome: "completed",
        dryRun: false,
        held: false,
        effectiveCutoff: "2025-07-30T02:00:00.000Z",
        prunedRuntimeAudit: 128,
        prunedOutcomes: 96,
        prunedSessions: 12,
        prunedChallenges: 41,
        prunedTotal: 277,
      },
    }),
  );

  // Captured rather than printed. Without this the authority's structured log
  // goes to `console.info` in the Playwright worker, interleaved with the
  // reporter and attributed to no test (see security-operations.ts).
  const recorder = new RecordingSecurityLogger();

  const handle = createAuthorityHttpHandler({
    logger: recorder,
    configuration,
    authority,
    sessions,
    identityVerifier: selectUpstreamIdentityVerifier(configuration),
    accessLifecycle,
    reporting,
    administration,
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
    // Bound by name: the page fetches `http://localhost`, which on a dual-stack
    // host can resolve to ::1 first.
    server.listen(ADMINISTRATION_AUTHORITY_PORT, "localhost", () => settle());
  });

  setActiveAuthorityRecorder(recorder, `http://localhost:${ADMINISTRATION_AUTHORITY_PORT}`);

  return {
    server,
    recorder,
    port: (server.address() as AddressInfo).port,
    bandId,
    bandName,
    adminUserId: admin.userId,
    memberUserId: member.userId,
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
