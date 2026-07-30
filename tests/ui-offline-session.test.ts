// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  resolveApplicationModel,
} from "../src/index.js";
import { connectBrowserAuthority } from "../src/ui/authority-sync.js";
import { LOCAL_DEMO_IDENTITY } from "../src/ui/demo-fixture.js";
import {
  evaluateOfflineGrace,
  InMemorySessionIdentityStorage,
  shouldRotateSession,
  SIGNED_OUT_IDENTITY,
} from "../src/ui/offline-session.js";
import type { SessionIdentityStorage } from "../src/ui/offline-session.js";
import { connectAuthority } from "../src/ui/session-startup.js";
import type { AuthorityStartupHost } from "../src/ui/session-startup.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

/**
 * Phase 50. The defect this closes: a signed-in user who reloaded the app while
 * offline lost their identity. Nothing persisted it, `/v1/session/current`
 * could not be reached, and the context kept its cold-start value — so every
 * membership, which is keyed on the real user id, stopped matching and the
 * person's own cached data became unreadable to them.
 *
 * The rule the rest of these cases defend: the grace gates **sync only**. Local
 * reads and local-first writes work offline indefinitely, inside the grace and
 * outside it, and a grace-expired sync is a refusal to *attempt* sync — neither
 * a transport failure nor a verdict, so nothing queued is lost.
 */

const partialModel: PartialApplicationModel = {
  app: { name: "OfflineSessionFixture", startView: "GigList", offlineGraceDays: 30 },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "Gig",
      businessKey: "Title",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      views: [{ name: "GigList", kind: "list", fields: ["Title"] }],
    },
  ],
  policies: [
    {
      name: "GigPolicy",
      object: "Gig",
      rules: [
        {
          name: "adminAll",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
  ],
};

const model = resolveApplicationModel(partialModel);
const SIGNED_IN_USER = "user-casey";
const SIGNED_IN_AT = new Date("2026-07-01T09:00:00.000Z");

describe("offline session identity", () => {
  it("keeps the signed-in identity when the app reloads offline", async () => {
    const storage = new InMemorySessionIdentityStorage();
    const host = startupHost();

    // First run: online, signed in. The server-derived identity is adopted and
    // remembered.
    await connectAuthority(host, newRuntime(), {
      baseUrl: "https://authority.example",
      transport: { fetch: authorityFetch({ signedIn: true }), origin: "https://app.example" },
      identityStorage: storage,
    });
    expect(host.context.userId).toBe(SIGNED_IN_USER);

    // Second run: the same device, reloaded with no connection at all.
    const reloaded = startupHost();
    await connectAuthority(reloaded, newRuntime(), {
      baseUrl: "https://authority.example",
      transport: { fetch: offlineFetch(), origin: "https://app.example" },
      identityStorage: storage,
    });

    expect(reloaded.context.userId).toBe(SIGNED_IN_USER);
    expect(reloaded.context.userId).not.toBe(LOCAL_DEMO_IDENTITY);
  });

  /*
   * The other half of the same defect. With an authority configured and nobody
   * signed in, the app must not keep operating as the local demo device: that
   * identity names a demo, not an account, and leaving it in place made a
   * signed-out browser look signed in as something that is not a person.
   */
  it("never operates as the local demo identity when an authority is configured", async () => {
    const host = startupHost();

    await connectAuthority(host, newRuntime(), {
      baseUrl: "https://authority.example",
      transport: { fetch: authorityFetch({ signedIn: false }), origin: "https://app.example" },
      identityStorage: new InMemorySessionIdentityStorage(),
    });

    expect(host.context.userId).toBe(SIGNED_OUT_IDENTITY);
    expect(host.context.userId).not.toBe(LOCAL_DEMO_IDENTITY);
  });

  it("drops the cached identity when the authority says the session is gone", async () => {
    const storage = await storedIdentity(SIGNED_IN_AT);
    const host = startupHost();

    await connectAuthority(host, newRuntime(), {
      baseUrl: "https://authority.example",
      transport: { fetch: authorityFetch({ signedIn: false }), origin: "https://app.example" },
      identityStorage: storage,
    });

    expect(await storage.read()).toBeNull();
    expect(host.context.userId).toBe(SIGNED_OUT_IDENTITY);
  });

  it("syncs without a fresh logon inside the grace and restarts it from that contact", async () => {
    const storage = await storedIdentity(SIGNED_IN_AT);
    const calls: string[] = [];
    // Twenty days in: inside the 30-day grace and past its halfway point, so
    // this contact should also rotate.
    const now = new Date(SIGNED_IN_AT.getTime() + 20 * 24 * 60 * 60 * 1000);

    const connection = await connectBrowserAuthority(
      newRuntime(),
      {
        baseUrl: "https://authority.example",
        transport: {
          fetch: authorityFetch({ signedIn: true, calls }),
          origin: "https://app.example",
        },
        identityStorage: storage,
      },
      { getContext: () => adminContext(), onChange: () => {}, now: () => now },
    );
    await connection.synchronize(adminContext());

    expect(connection.session.status).toBe("signedIn");
    expect(connection.session.grace.status).toBe("withinGrace");
    expect(calls).toContain("/v1/sync/bootstrap");
    expect(calls).toContain("/v1/session/rotate");
    // The clock restarted from this contact rather than from the old sign-in.
    expect((await storage.read())?.lastVerifiedAt).toBe(now.toISOString());
  });

  it("refuses to attempt a sync outside the grace, and keeps the queue", async () => {
    const storage = await storedIdentity(SIGNED_IN_AT);
    const calls: string[] = [];
    const now = new Date(SIGNED_IN_AT.getTime() + 31 * 24 * 60 * 60 * 1000);
    const runtime = newRuntime();

    const connection = await connectBrowserAuthority(
      runtime,
      {
        baseUrl: "https://authority.example",
        // Offline as well as out of grace: the refusal must come from the gate,
        // not from a failed request.
        transport: { fetch: offlineFetch(calls), origin: "https://app.example" },
        identityStorage: storage,
      },
      { getContext: () => adminContext(), onChange: () => {}, now: () => now },
    );

    calls.length = 0;
    await connection.synchronize(adminContext());

    expect(connection.session.grace.status).toBe("expired");
    // Not attempted at all, so nothing was sent and nothing was settled.
    expect(calls).toEqual([]);
    // The cached identity survives, so local work continues as the same person.
    expect(connection.session.userId).toBe(SIGNED_IN_USER);
    expect((await storage.read())?.userId).toBe(SIGNED_IN_USER);
  });

  /*
   * The whole point of the requirement. A phase that accidentally gates local
   * reads or writes on the grace has failed it, so this is asserted rather than
   * assumed from "nothing in the runtime consults a session".
   */
  it("leaves local reads and local-first writes working outside the grace", async () => {
    const storage = await storedIdentity(SIGNED_IN_AT);
    const now = new Date(SIGNED_IN_AT.getTime() + 90 * 24 * 60 * 60 * 1000);
    const runtime = newRuntime();
    const context = adminContext();

    const connection = await connectBrowserAuthority(
      runtime,
      {
        baseUrl: "https://authority.example",
        transport: { fetch: offlineFetch(), origin: "https://app.example" },
        identityStorage: storage,
      },
      { getContext: () => context, onChange: () => {}, now: () => now },
    );
    await connection.synchronize(context);

    expect(connection.session.grace.status).toBe("expired");
    const created = await runtime.create("Gig", { Title: "Written well past the grace" }, context);
    expect(created.values.Title).toBe("Written well past the grace");
    expect(await runtime.read("Gig", created.meta.guid, context)).not.toBeNull();
  });

  it("forgets the cached identity on sign-out", async () => {
    const storage = await storedIdentity(SIGNED_IN_AT);
    const connection = await connectBrowserAuthority(
      newRuntime(),
      {
        baseUrl: "https://authority.example",
        transport: { fetch: authorityFetch({ signedIn: true }), origin: "https://app.example" },
        identityStorage: storage,
      },
      { getContext: () => adminContext(), onChange: () => {} },
    );

    await connection.signOut();

    expect(await storage.read()).toBeNull();
    expect(connection.session.userId).toBeUndefined();
    expect(connection.session.grace.status).toBe("noIdentity");
  });
});

describe("offline grace evaluation", () => {
  const identity = { userId: SIGNED_IN_USER, lastVerifiedAt: SIGNED_IN_AT.toISOString() };

  it("distinguishes never-authenticated from a grace that ran out", () => {
    expect(evaluateOfflineGrace(null, 30, SIGNED_IN_AT).status).toBe("noIdentity");
    expect(evaluateOfflineGrace(identity, 30, days(29)).status).toBe("withinGrace");
    expect(evaluateOfflineGrace(identity, 30, days(31)).status).toBe("expired");
  });

  it("reports when the grace runs out, to the same instant every time", () => {
    const state = evaluateOfflineGrace(identity, 30, days(1));
    expect(state.expiresAt).toBe(days(30).toISOString());
    expect(state.lastVerifiedAt).toBe(SIGNED_IN_AT.toISOString());
    expect(state.offlineGraceDays).toBe(30);
  });

  /* A corrupt record must narrow what a device may do, never widen it. */
  it("treats an unreadable timestamp as no grace rather than an unlimited one", () => {
    const corrupt = { userId: SIGNED_IN_USER, lastVerifiedAt: "not a date" };

    expect(evaluateOfflineGrace(corrupt, 30, SIGNED_IN_AT).status).toBe("expired");
    expect(shouldRotateSession(corrupt, 30, SIGNED_IN_AT)).toBe(true);
  });

  it("rotates only past the halfway point of the grace", () => {
    expect(shouldRotateSession(identity, 30, days(14))).toBe(false);
    expect(shouldRotateSession(identity, 30, days(16))).toBe(true);
    // Nothing cached yet, so the next successful contact must establish one.
    expect(shouldRotateSession(null, 30, days(1))).toBe(true);
  });
});

function days(count: number): Date {
  return new Date(SIGNED_IN_AT.getTime() + count * 24 * 60 * 60 * 1000);
}

async function storedIdentity(lastVerifiedAt: Date): Promise<SessionIdentityStorage> {
  const storage = new InMemorySessionIdentityStorage();
  await storage.write({ userId: SIGNED_IN_USER, lastVerifiedAt: lastVerifiedAt.toISOString() });
  return storage;
}

function adminContext(): RuntimeContext {
  return { userId: SIGNED_IN_USER, roles: ["Admin"], channel: "ui" };
}

function startupHost(): AuthorityStartupHost {
  return {
    context: { userId: LOCAL_DEMO_IDENTITY, roles: ["Admin"], channel: "ui" },
    refreshAuthorityState: () => {},
    refreshFromRuntime: () => {},
  };
}

function newRuntime(): ApplicationRuntime {
  return new ApplicationRuntime(model, { storage: new InMemoryObjectStorageBackend() });
}

/** Answers the handful of calls the startup sequence makes. */
function authorityFetch(options: { signedIn: boolean; calls?: string[] }): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    options.calls?.push(path);
    if (path === "/readyz")
      return json({
        status: "ready",
        identityVerification: { mode: "passkey", verifier: "passkey", bypassed: false },
      });
    if (path === "/v1/session/current")
      return options.signedIn
        ? json({ userId: SIGNED_IN_USER })
        : json({ error: "unauthenticated" }, 401);
    if (path === "/v1/session/rotate") return json({ expiresAt: "2026-09-01T09:00:00.000Z" });
    if (path === "/v1/session/sign-out") return json({ signedOut: true });
    if (path === "/v1/sync/bootstrap") return json({ records: [] });
    return json({ error: "not_found" }, 404);
  }) as typeof globalThis.fetch;
}

/** Every call fails at the transport, exactly as it does with no connection. */
function offlineFetch(calls?: string[]): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    calls?.push(new URL(typeof input === "string" ? input : input.toString()).pathname);
    throw new TypeError("Failed to fetch");
  }) as typeof globalThis.fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
