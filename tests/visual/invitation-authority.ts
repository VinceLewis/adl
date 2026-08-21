import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ApplicationRuntime,
  AuthorityAccessLifecycleService,
  AuthorityService,
  InMemoryAuthorityAccessStore,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  resolveSessionLifetime,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type { AuthorityConfiguration, RuntimeContext } from "../../src/index.js";
import { createAuthorityHttpHandler } from "../../src/server/authority-http.js";
import { loadAuthorityModel } from "../../src/server/authority-entrypoint.js";
import {
  RecordingSecurityLogger,
  clearActiveAuthorityRecorder,
  setActiveAuthorityRecorder,
} from "./support/authority-log.js";

/**
 * A throwaway authority serving **Jointly Care**, for the invitation project.
 *
 * Phase 107's inventory run found that Phase 105's defect — an enabled `Accept`
 * button whose click the server refuses — was not reachable from the existing
 * suite at all: no spec drove Jointly Care against an authority, so no request
 * was made and the gates had nothing to see. This harness is what makes the
 * question askable. Its exact words were "the layer is ready for it, but it
 * cannot find what nobody asks it to look at."
 *
 * The seeded state is the one thing this file exists for: an identity that is a
 * member of **nothing**, holding one `pending` `CircleInvite`. Every other
 * authority harness in this suite seeds a member or an administrator, which is
 * precisely the caller whose path already worked.
 *
 * Wiring choices follow `administration-authority.ts` verbatim and for the same
 * reasons — in-memory stores (correctness against real PostgreSQL is
 * `tests/integration/`'s job), an `https://` request URL over a plain socket
 * because the edge refuses non-HTTPS and TLS terminates at a proxy in
 * deployment, and the identity bypass so signing in is a typed proof rather
 * than a WebAuthn ceremony the passkey project already covers.
 */

export const INVITATION_AUTHORITY_PORT = 8790;
export const INVITATION_APP_PORT = 5473;
export const INVITATION_APP_ORIGIN = `http://localhost:${INVITATION_APP_PORT}`;

/** At least the authority's own minimum proof length, and stable across runs. */
export const INVITEE_ACCOUNT_PROOF = "visual-circle-invitee";
export const OWNER_ACCOUNT_PROOF = "visual-circle-owner";

export interface InvitationAuthorityHarness {
  server: Server;
  recorder: RecordingSecurityLogger;
  port: number;
  circleId: string;
  circleName: string;
  /** The invitee's server-derived user id. A member of nothing. */
  inviteeUserId: string;
  /** The circle's owner, who sent the invitation. */
  ownerUserId: string;
  inviteRecordId: string;
  inviteeEmail: string;
  /** Reads the invitation back out of the authority's own storage. */
  readInviteStatus(): Promise<string | undefined>;
  /** Whether the authority holds a `CircleMember` row for the invitee. */
  inviteeIsMember(): Promise<boolean>;
  close(): Promise<void>;
}

export async function startInvitationAuthority(): Promise<InvitationAuthorityHarness> {
  const model = loadAuthorityModel("src/reference/jointly-care");
  const configuration: AuthorityConfiguration = resolveSessionLifetime(
    {
      environment: "test",
      databaseUrl: "postgresql://unused/unused",
      allowedOrigins: [INVITATION_APP_ORIGIN],
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

  const systemContext: RuntimeContext = { userId: "system", roles: ["SystemAdmin"], channel: "ui" };
  const runtime = new ApplicationRuntime(model, { storage });
  const owner = await sessions.provisionIdentity("bypass", OWNER_ACCOUNT_PROOF);
  const invitee = await sessions.provisionIdentity("bypass", INVITEE_ACCOUNT_PROOF);

  const circleName = "Mum's Care Circle";
  const inviteeEmail = "alex@example.com";
  const circle = await runtime.create(
    "Circle",
    { Name: circleName, Description: "Coordinating care visits.", Owner: owner.userId },
    systemContext,
  );
  const circleId = circle.meta.guid;
  const circleContext: RuntimeContext = {
    ...systemContext,
    selectedContexts: { Circle: circleId },
  };
  await runtime.create(
    "CircleMember",
    { Circle: circleId, User: owner.userId, Role: "CircleOwner", JoinedAt: "2026-06-01" },
    circleContext,
  );
  // The whole point of this harness. The invitee joins nothing here; only this
  // record puts the circle within their reach, and only while it stays
  // `pending`.
  const invite = await runtime.create(
    "CircleInvite",
    {
      Circle: circleId,
      InvitedBy: owner.userId,
      Invitee: invitee.userId,
      InviteeEmail: inviteeEmail,
      Status: "pending",
      SentAt: "2026-08-14",
    },
    circleContext,
  );

  const recorder = new RecordingSecurityLogger();
  const handle = createAuthorityHttpHandler({
    logger: recorder,
    configuration,
    authority,
    sessions,
    identityVerifier: selectUpstreamIdentityVerifier(configuration),
    accessLifecycle,
  });

  const server = createServer(async (incoming, outgoing) => {
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
    server.listen(INVITATION_AUTHORITY_PORT, "localhost", () => settle());
  });

  setActiveAuthorityRecorder(recorder, `http://localhost:${INVITATION_AUTHORITY_PORT}`);

  return {
    server,
    recorder,
    port: (server.address() as AddressInfo).port,
    circleId,
    circleName,
    inviteeUserId: invitee.userId,
    ownerUserId: owner.userId,
    inviteRecordId: invite.meta.guid,
    inviteeEmail,
    // Read through the authority's own storage, not through a response body:
    // an outcome is the server describing its work, and the record is the work.
    readInviteStatus: async () => {
      const record = await storage.read("CircleInvite", invite.meta.guid);
      return record?.values.Status as string | undefined;
    },
    inviteeIsMember: async () => {
      const memberObject = model.objects.find((object) => object.name === "CircleMember");
      if (memberObject === undefined) throw new Error("Jointly Care declares no CircleMember.");
      const members = await storage.search({ object: memberObject, fields: [] });
      return members.some((member) => member.values.User === invitee.userId);
    },
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
