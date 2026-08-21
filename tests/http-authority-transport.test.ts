import { describe, expect, it } from "vitest";
import {
  AuthorityTransportError,
  BrowserAuthorityCredentialStore,
  HttpAuthorityTransport,
  InMemoryAuthorityCredentialStore,
} from "../src/index.js";
import type { AuthorityCredentialStore, AuthorityOperationIntent } from "../src/index.js";

/**
 * The browser-facing transport carries exactly two credentials — the Phase 42
 * session cookie and the double-submit CSRF token — and nothing the server
 * derives for itself. A transport failure must surface as an error, never as a
 * fabricated outcome that a caller could mistake for a durable verdict.
 */

interface RecordedRequest {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  headers: Headers;
  bodyText: string;
  body: Record<string, unknown>;
}

type Responder = (request: RecordedRequest, index: number) => Response | Promise<Response>;

function recordingFetch(responder: Responder): {
  calls: RecordedRequest[];
  fetchImpl: typeof globalThis.fetch;
} {
  const calls: RecordedRequest[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const parsed: unknown = bodyText === "" ? {} : JSON.parse(bodyText);
    const recorded: RecordedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method,
      credentials: init?.credentials,
      headers: new Headers(init?.headers),
      bodyText,
      body: parsed as Record<string, unknown>,
    };
    calls.push(recorded);
    return responder(recorded, calls.length - 1);
  };
  return { calls, fetchImpl };
}

function jsonResponse(body: unknown, status = 200, setCookies: readonly string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

const sessionCookie =
  "__Host-adl_session=session-token-value; Path=/; Secure; HttpOnly; SameSite=Strict";
const csrfCookie = "__Host-adl_csrf=csrf-token-value; Path=/; Secure; SameSite=Strict";

const createIntent: AuthorityOperationIntent = {
  operationId: "op-1",
  kind: "create",
  objectName: "Gig",
  recordId: "gig-friday-rehearsal",
  values: { Band: "band-1", Title: "Friday rehearsal" },
  selectedContexts: { Band: "band-1" },
};

describe("HttpAuthorityTransport sign-in", () => {
  it("sends the account proof as a header and returns the server-derived identity", async () => {
    const { calls, fetchImpl } = recordingFetch(() =>
      jsonResponse({ userId: "user-42", expiresAt: "2026-07-30T12:00:00.000Z" }, 201, [
        sessionCookie,
        csrfCookie,
      ]),
    );
    const credentials = new InMemoryAuthorityCredentialStore();
    const transport = new HttpAuthorityTransport({
      baseUrl: "https://authority.test/",
      credentials,
      fetch: fetchImpl,
      origin: "https://app.test",
    });

    const identity = await transport.signIn("proof-alex@example.test");

    expect(identity).toEqual({
      userId: "user-42",
      expiresAt: new Date("2026-07-30T12:00:00.000Z"),
    });
    const [call] = calls;
    expect(call?.url).toBe("https://authority.test/v1/session/issue");
    expect(call?.method).toBe("POST");
    expect(call?.credentials).toBe("include");
    expect(call?.headers.get("x-adl-account-proof")).toBe("proof-alex@example.test");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.headers.get("origin")).toBe("https://app.test");
    // The browser is untrusted: nothing identity-, role- or time-shaped is sent.
    expect(call?.body).toEqual({});
    expect(Object.keys(call?.body ?? {})).toEqual([]);
    for (const forbidden of ["userId", "role", "roles", "actor", "revision", "timestamp"])
      expect(call?.bodyText).not.toContain(forbidden);
  });

  it("does not report a session when sign-in fails", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: "authentication_failed" }, 401),
    );
    const transport = new HttpAuthorityTransport({
      baseUrl: "https://authority.test",
      credentials: new InMemoryAuthorityCredentialStore(),
      fetch: fetchImpl,
    });
    await expect(transport.signIn("proof-alex@example.test")).rejects.toMatchObject({
      name: "AuthorityTransportError",
      status: 401,
      code: "authentication_failed",
    });
    // A 401 on /v1/session/current is the "no session yet" answer, not a failure.
    await expect(transport.currentSession()).resolves.toBeNull();
  });
});

describe("HttpAuthorityTransport sync routes", () => {
  it("posts JSON with the stored CSRF token and includes credentials", async () => {
    const { calls, fetchImpl } = recordingFetch((request) =>
      request.url.endsWith("/v1/sync/bootstrap")
        ? jsonResponse({ records: [], nextCursor: "cursor-2" })
        : jsonResponse({ status: "accepted", operationId: "op-1", records: [] }),
    );
    const credentials = new InMemoryAuthorityCredentialStore();
    credentials.capture([sessionCookie, csrfCookie]);
    const transport = new HttpAuthorityTransport({
      baseUrl: "https://authority.test",
      credentials,
      fetch: fetchImpl,
    });

    const page = await transport.bootstrap(undefined, {
      selectedContexts: { Band: "band-1" },
      cursor: "cursor-1",
      limit: 25,
    });
    const outcome = await transport.replay(undefined, createIntent);

    expect(page).toEqual({ records: [], nextCursor: "cursor-2" });
    expect(outcome).toEqual({ status: "accepted", operationId: "op-1", records: [] });
    const [bootstrapCall, replayCall] = calls;
    expect(bootstrapCall?.url).toBe("https://authority.test/v1/sync/bootstrap");
    expect(replayCall?.url).toBe("https://authority.test/v1/sync/replay");
    for (const call of [bootstrapCall, replayCall]) {
      expect(call?.method).toBe("POST");
      expect(call?.credentials).toBe("include");
      expect(call?.headers.get("content-type")).toBe("application/json");
      expect(call?.headers.get("x-adl-csrf-token")).toBe("csrf-token-value");
      expect(call?.headers.get("cookie")).toContain("__Host-adl_session=session-token-value");
      expect(call?.headers.get("cookie")).toContain("__Host-adl_csrf=csrf-token-value");
      expect(call?.headers.get("x-adl-account-proof")).toBeNull();
    }
    expect(bootstrapCall?.body).toEqual({
      selectedContexts: { Band: "band-1" },
      cursor: "cursor-1",
      limit: 25,
    });
    expect(replayCall?.body).toEqual(createIntent);
  });

  it("omits absent bootstrap request fields rather than sending nulls", async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ records: [] }));
    const transport = new HttpAuthorityTransport({
      baseUrl: "https://authority.test",
      credentials: new InMemoryAuthorityCredentialStore(),
      fetch: fetchImpl,
    });
    await transport.bootstrap(undefined);
    expect(calls[0]?.body).toEqual({});
    // No credential is available yet, so no CSRF header is invented.
    expect(calls[0]?.headers.get("x-adl-csrf-token")).toBeNull();
    expect(calls[0]?.headers.get("cookie")).toBeNull();
  });
});

describe("authority credential stores", () => {
  it("captures, replays, and clears cookies for non-browser callers", async () => {
    const responses: Response[] = [
      jsonResponse({ userId: "user-42" }, 201, [sessionCookie, csrfCookie]),
      jsonResponse({ records: [] }),
      jsonResponse({ signedOut: true }, 200, [
        "__Host-adl_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
        "__Host-adl_csrf=; Path=/; Secure; SameSite=Strict; Max-Age=0",
      ]),
      jsonResponse({ records: [] }),
    ];
    const { calls, fetchImpl } = recordingFetch((_request, index) => {
      const response = responses[index];
      if (response === undefined) throw new Error("Unexpected extra request.");
      return response;
    });
    const credentials = new InMemoryAuthorityCredentialStore();
    const transport = new HttpAuthorityTransport({
      baseUrl: "https://authority.test",
      credentials,
      fetch: fetchImpl,
    });

    await transport.signIn("proof-alex@example.test");
    expect(credentials.csrfToken()).toBe("csrf-token-value");
    expect(credentials.cookieHeader()).toBe(
      "__Host-adl_session=session-token-value; __Host-adl_csrf=csrf-token-value",
    );

    await transport.bootstrap(undefined);
    expect(calls[1]?.headers.get("cookie")).toBe(
      "__Host-adl_session=session-token-value; __Host-adl_csrf=csrf-token-value",
    );

    await transport.signOut();
    // A cleared cookie is dropped, not replayed as an empty value.
    expect(credentials.csrfToken()).toBeUndefined();
    expect(credentials.cookieHeader()).toBeUndefined();
    await transport.bootstrap(undefined);
    expect(calls[3]?.headers.get("cookie")).toBeNull();
    expect(calls[3]?.headers.get("x-adl-csrf-token")).toBeNull();
  });

  it("reads only the CSRF cookie in a browser and never sends a cookie header", async () => {
    const globalWithDocument = globalThis as unknown as { document?: { cookie: string } };
    const original = globalWithDocument.document;
    try {
      globalWithDocument.document = {
        cookie: "__Host-adl_session=unreadable; __Host-adl_csrf=csrf-token-value",
      };
      const credentials: AuthorityCredentialStore = new BrowserAuthorityCredentialStore();
      // The session cookie is HttpOnly, so it is not even visible here.
      expect(credentials.cookieHeader()).toBeUndefined();
      expect(credentials.csrfToken()).toBe("csrf-token-value");
      credentials.capture([sessionCookie]);
      expect(credentials.cookieHeader()).toBeUndefined();

      const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ records: [] }));
      const transport = new HttpAuthorityTransport({
        baseUrl: "https://authority.test",
        credentials,
        fetch: fetchImpl,
      });
      await transport.bootstrap(undefined);
      expect(calls[0]?.headers.get("cookie")).toBeNull();
      expect(calls[0]?.headers.get("x-adl-csrf-token")).toBe("csrf-token-value");

      globalWithDocument.document = { cookie: "" };
      expect(new BrowserAuthorityCredentialStore().csrfToken()).toBeUndefined();
    } finally {
      if (original === undefined) delete globalWithDocument.document;
      else globalWithDocument.document = original;
    }
  });
});

describe("HttpAuthorityTransport failure handling", () => {
  it("throws rather than fabricating an outcome when the server cannot be reached", async () => {
    const { fetchImpl } = recordingFetch(() => {
      throw new TypeError("fetch failed");
    });
    const transport = new HttpAuthorityTransport({
      baseUrl: "https://authority.test",
      credentials: new InMemoryAuthorityCredentialStore(),
      fetch: fetchImpl,
    });

    const replayed = await transport
      .replay(undefined, createIntent)
      .catch((error: unknown) => error);
    expect(replayed).toBeInstanceOf(AuthorityTransportError);
    // Status 0 marks "no verdict was reached", distinct from any HTTP status.
    expect(replayed).toMatchObject({ status: 0 });
    expect(replayed).not.toMatchObject({ status: "rejected" });
    await expect(transport.bootstrap(undefined)).rejects.toBeInstanceOf(AuthorityTransportError);
  });

  it("throws with the rejecting status for every non-2xx response", async () => {
    for (const [status, code] of [
      [401, "unauthenticated"],
      [403, "csrf_denied"],
      [429, "rate_limited"],
      [500, "request_rejected"],
    ] as const) {
      const { fetchImpl } = recordingFetch(() => jsonResponse({ error: code }, status));
      const transport = new HttpAuthorityTransport({
        baseUrl: "https://authority.test",
        credentials: new InMemoryAuthorityCredentialStore(),
        fetch: fetchImpl,
      });
      await expect(transport.replay(undefined, createIntent)).rejects.toMatchObject({
        name: "AuthorityTransportError",
        status,
        code,
      });
      await expect(transport.bootstrap(undefined)).rejects.toMatchObject({ status });
    }
  });

  it("treats a non-JSON success body as a transport failure", async () => {
    const { fetchImpl } = recordingFetch(
      () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const transport = new HttpAuthorityTransport({
      baseUrl: "https://authority.test",
      credentials: new InMemoryAuthorityCredentialStore(),
      fetch: fetchImpl,
    });
    await expect(transport.bootstrap(undefined)).rejects.toMatchObject({ status: 502 });
    await expect(transport.signIn("proof-alex@example.test")).rejects.toMatchObject({
      status: 502,
    });
  });

  describe("passkey ceremonies", () => {
    it("sends the invite token only when there is one, and never sends a challenge", async () => {
      const { calls, fetchImpl } = recordingFetch(() =>
        jsonResponse({ challengeId: "challenge-1", options: { challenge: "AQID" } }),
      );
      const transport = new HttpAuthorityTransport({
        baseUrl: "https://authority.test",
        credentials: new InMemoryAuthorityCredentialStore(),
        fetch: fetchImpl,
      });

      await transport.beginPasskeyRegistration();
      await transport.beginPasskeyRegistration("invite-token-value");
      await transport.beginPasskeyAuthentication();

      expect(calls.map((call) => call.url)).toEqual([
        "https://authority.test/v1/webauthn/register/begin",
        "https://authority.test/v1/webauthn/register/begin",
        "https://authority.test/v1/webauthn/authenticate/begin",
      ]);
      expect(calls[0]?.body).toEqual({});
      expect(calls[1]?.body).toEqual({ inviteToken: "invite-token-value" });
      // The challenge is the server's to choose; the client never proposes one.
      for (const call of calls) expect(call.bodyText).not.toContain("challenge");
    });

    it("refuses a ceremony start that carries no usable options", async () => {
      for (const body of [{}, { challengeId: "challenge-1" }, { challengeId: 1, options: {} }]) {
        const { fetchImpl } = recordingFetch(() => jsonResponse(body));
        const transport = new HttpAuthorityTransport({
          baseUrl: "https://authority.test",
          credentials: new InMemoryAuthorityCredentialStore(),
          fetch: fetchImpl,
        });
        await expect(transport.beginPasskeyAuthentication()).rejects.toBeInstanceOf(
          AuthorityTransportError,
        );
      }
    });

    it("re-supplies the invite token at finish, because only its hash was stored", async () => {
      const { calls, fetchImpl } = recordingFetch(() =>
        jsonResponse({ userId: "user-1", invite: "membershipGranted" }, 201, [
          sessionCookie,
          csrfCookie,
        ]),
      );
      const credentials = new InMemoryAuthorityCredentialStore();
      const transport = new HttpAuthorityTransport({
        baseUrl: "https://authority.test",
        credentials,
        fetch: fetchImpl,
      });

      const outcome = await transport.finishPasskeyRegistration({
        challengeId: "challenge-1",
        response: { id: "credential-1" },
        inviteToken: "invite-token-value",
      });

      expect(outcome).toEqual({ userId: "user-1", invite: "membershipGranted" });
      expect(calls[0]?.body).toEqual({
        challengeId: "challenge-1",
        response: { id: "credential-1" },
        inviteToken: "invite-token-value",
      });
      // A completed ceremony issues an ordinary opaque session, exactly as a
      // proof would, so the jar picks the cookies up unchanged.
      expect(credentials.csrfToken()).toBe("csrf-token-value");
    });

    it("ignores an invite outcome it does not recognise rather than inventing one", async () => {
      const { fetchImpl } = recordingFetch(() =>
        jsonResponse({ userId: "user-1", invite: "somethingElse" }, 201),
      );
      const transport = new HttpAuthorityTransport({
        baseUrl: "https://authority.test",
        credentials: new InMemoryAuthorityCredentialStore(),
        fetch: fetchImpl,
      });

      expect(
        await transport.finishPasskeyRegistration({
          challengeId: "challenge-1",
          response: {},
        }),
      ).toEqual({ userId: "user-1" });
    });

    it("surfaces a refused assertion as an error, never as a session", async () => {
      const { fetchImpl } = recordingFetch(() =>
        jsonResponse({ error: "ADL_PASSKEY_ASSERTION_INVALID" }, 401),
      );
      const transport = new HttpAuthorityTransport({
        baseUrl: "https://authority.test",
        credentials: new InMemoryAuthorityCredentialStore(),
        fetch: fetchImpl,
      });

      await expect(
        transport.finishPasskeyAuthentication({ challengeId: "challenge-1", response: {} }),
      ).rejects.toMatchObject({ status: 401, code: "ADL_PASSKEY_ASSERTION_INVALID" });
    });
  });
});

describe("HttpAuthorityTransport readiness", () => {
  function readinessTransport(responder: Responder): HttpAuthorityTransport {
    return new HttpAuthorityTransport({
      baseUrl: "https://authority.test",
      credentials: new InMemoryAuthorityCredentialStore(),
      fetch: recordingFetch(responder).fetchImpl,
    });
  }

  it("reads a self-service deployment's disclosure off /readyz", async () => {
    const transport = readinessTransport(() =>
      jsonResponse({
        status: "ready",
        identityVerification: {
          mode: "passkey",
          verifier: "passkey",
          bypassed: false,
          selfServiceRegistration: true,
        },
      }),
    );

    await expect(transport.readiness()).resolves.toMatchObject({
      ready: true,
      mode: "passkey",
      selfServiceRegistration: true,
    });
  });

  /*
   * Fail closed, four ways. A missing flag must never be read as permission,
   * and neither must a truthy non-boolean an unrelated authority happened to
   * put there.
   */
  it.each([
    ["absent", { mode: "passkey", verifier: "passkey", bypassed: false }],
    [
      "false",
      { mode: "passkey", verifier: "passkey", bypassed: false, selfServiceRegistration: false },
    ],
    [
      "a truthy non-boolean",
      { mode: "passkey", verifier: "passkey", bypassed: false, selfServiceRegistration: "yes" },
    ],
    ["a missing verification object", undefined],
  ])("reads %s as no self-service", async (_label, identityVerification) => {
    const transport = readinessTransport(() =>
      jsonResponse({
        status: "ready",
        ...(identityVerification === undefined ? {} : { identityVerification }),
      }),
    );

    await expect(transport.readiness()).resolves.toMatchObject({
      selfServiceRegistration: false,
    });
  });

  it("surfaces an unreachable authority as an error rather than a permissive default", async () => {
    const transport = readinessTransport(() => {
      throw new TypeError("network down");
    });

    // The caller (`createAuthoritySync`) leaves the fail-closed initial state
    // in place when this throws, so an authority nobody can reach never grows
    // a create-an-account route.
    await expect(transport.readiness()).rejects.toBeInstanceOf(AuthorityTransportError);
  });
});
