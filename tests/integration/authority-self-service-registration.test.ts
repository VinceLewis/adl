import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  ApplicationRuntime,
  AuthorityAccessLifecycleService,
  AuthorityService,
  AuthorityTransportError,
  HttpAuthorityTransport,
  InMemoryAuthorityCredentialStore,
  OpaqueSessionAdapter,
  PasskeyIdentityService,
  PolicyDeniedError,
  PostgresAuthorityAccessStore,
  PostgresAuthorityIdentitySessionStore,
  PostgresAuthorityUnitOfWork,
  PostgresContextMembershipIndex,
  PostgresObjectStorageBackend,
  PostgresWebAuthnCredentialStore,
  resolveSelfServiceRegistration,
  resolveSessionLifetime,
  selectUpstreamIdentityVerifier,
} from "../../src/index.js";
import type {
  AuthorityConfiguration,
  AuthorityOutcome,
  ResolvedApplicationModel,
} from "../../src/index.js";
import { createAuthorityNodeServer } from "../../src/server/authority-node.js";
import { loadAuthorityModel } from "../../src/server/authority-entrypoint.js";
import { SimpleWebAuthnLibrary } from "../../src/server/simplewebauthn-adapter.js";
import { authorityPool, resetProjections, seedApplication } from "./pg-harness.js";
import { SoftwareAuthenticator } from "./webauthn-authenticator.js";

/**
 * Phase 99's acceptance test, and it is deliberately the whole product path
 * rather than a slice of it: a brand-new database, a person who has never
 * existed, self-registers over the real HTTP edge with a real WebAuthn
 * ceremony, runs `CreateBand`, and is a `BandAdmin` of their own band --
 * with no invitation token, no seed script and no operator SQL anywhere in it.
 *
 * It serves the **real Giggle Band model**, not a fixture. A fixture with a
 * hand-written `CreateBand`-shaped command would prove something about the
 * fixture; what has to be true is that the shipped application works.
 *
 * `AGENTS.md` requires real PostgreSQL for any authority claim, and this file
 * is the reason: the founder membership is written by a transaction-local
 * `ESTABLISHES CONTEXT` inside a unit of work, and an in-memory fake would
 * prove nothing about whether the object-scope gate really accepts it.
 */

const csrf = "csrf-value".padEnd(48, "s");
const origin = "https://app.test";
const relyingPartyId = "app.test";

let pool: Pool;
let giggleModel: ResolvedApplicationModel;
/** The identical application, with the one declaration flipped. */
let inviteOnlyModel: ResolvedApplicationModel;

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  giggleModel = loadAuthorityModel("src/reference/giggle-band");
  inviteOnlyModel = {
    ...giggleModel,
    app: { ...giggleModel.app, registration: "inviteOnly" },
  };
});

afterAll(async () => {
  await pool.end();
});

interface Deployment {
  baseUrl: string;
  applicationId: string;
  close(): Promise<void>;
}

/**
 * Composed the way `createAuthorityProcess` composes it, including both model
 * reconciliations, so what is under test is the real resolution rather than a
 * boolean the test chose.
 */
async function startDeployment(options: {
  applicationId: string;
  model: ResolvedApplicationModel;
  ceiling?: "model" | "off";
  selfRegistrationLimit?: number;
}): Promise<Deployment> {
  const { applicationId, model } = options;
  const base: AuthorityConfiguration = {
    environment: "test",
    databaseUrl: "postgresql://ignored/adl",
    allowedOrigins: [origin],
    cookieName: "__Host-adl_session",
    csrfCookieName: "__Host-adl_csrf",
    sessionTtlMinutes: 480,
    maxRequestBytes: 65_536,
    upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
    identityVerification: { mode: "passkey" },
    ...(options.ceiling === undefined ? {} : { selfServiceRegistration: options.ceiling }),
    webauthn: {
      relyingPartyId,
      relyingPartyName: "ADL self-service slice",
      origins: [origin],
      challengeTtlSeconds: 300,
    },
    rateLimits: {
      accountProof: 500,
      webauthn: 500,
      selfRegistration: options.selfRegistrationLimit ?? 500,
      session: 500,
      invite: 500,
      bootstrap: 500,
      replay: 500,
      report: 500,
      administration: 500,
    },
  };
  const configuration = resolveSelfServiceRegistration(resolveSessionLifetime(base, model), model);

  const sessions = new OpaqueSessionAdapter(
    new PostgresAuthorityIdentitySessionStore(authorityPool(pool), applicationId),
  );
  const storage = new PostgresObjectStorageBackend(authorityPool(pool), applicationId, model);
  const membershipIndex = new PostgresContextMembershipIndex(authorityPool(pool), applicationId);
  const accessLifecycle = new AuthorityAccessLifecycleService(
    model,
    storage,
    sessions,
    new PostgresAuthorityAccessStore(authorityPool(pool), applicationId, model),
    { membershipIndex },
  );
  const server = createAuthorityNodeServer({
    configuration,
    sessions,
    authority: new AuthorityService(model, storage, sessions, {
      unitOfWork: new PostgresAuthorityUnitOfWork(authorityPool(pool), applicationId, model),
      membershipIndex,
    }),
    accessLifecycle,
    passkeys: new PasskeyIdentityService(
      configuration.webauthn as NonNullable<AuthorityConfiguration["webauthn"]>,
      sessions,
      new PostgresWebAuthnCredentialStore(authorityPool(pool), applicationId),
      new SimpleWebAuthnLibrary(),
      {
        accessLifecycle,
        selfServiceRegistration: configuration.selfServiceRegistrationEnabled === true,
      },
    ),
    identityVerifier: selectUpstreamIdentityVerifier(configuration),
    readiness: async () => ({ ready: true }),
    logger: { write: () => undefined },
    newCsrfToken: () => csrf,
    clientKey: () => `self-service-${applicationId}`,
  });
  const baseUrl: string = await new Promise((done) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      done(`http://127.0.0.1:${address.port}`);
    });
  });
  await seedApplication(pool, applicationId, model.modelVersion);
  return {
    baseUrl,
    applicationId,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** A caller with no user agent: real transport, real socket, its own cookie jar. */
function stranger(deployment: Deployment): HttpAuthorityTransport {
  return new HttpAuthorityTransport({
    baseUrl: deployment.baseUrl,
    credentials: new InMemoryAuthorityCredentialStore(),
    origin,
    forwardedProto: "https",
  });
}

function authenticator(): SoftwareAuthenticator {
  return new SoftwareAuthenticator({ rpId: relyingPartyId, origin, backedUp: true });
}

/** The whole registration ceremony, with no invite token anywhere in it. */
async function selfRegister(
  deployment: Deployment,
  transport: HttpAuthorityTransport = stranger(deployment),
): Promise<{ transport: HttpAuthorityTransport; userId: string }> {
  const device = authenticator();
  const start = await transport.beginPasskeyRegistration(undefined);
  const response = await device.register(start.options);
  const outcome = await transport.finishPasskeyRegistration({
    challengeId: start.challengeId,
    response,
  });
  return { transport, userId: outcome.userId };
}

async function refusalOf(action: () => Promise<unknown>): Promise<AuthorityTransportError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AuthorityTransportError) return error;
    throw error;
  }
  throw new Error("The authority accepted a call it must have refused.");
}

async function countRows(table: string, applicationId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `select count(*)::int as count from ${table} where application_id = $1`,
    [applicationId],
  );
  return result.rows[0]?.count ?? 0;
}

async function recordsOf(
  applicationId: string,
  objectName: string,
): Promise<{ recordId: string; values: Record<string, string> }[]> {
  const result = await pool.query<{
    record_id: string;
    record: { values: Record<string, string> };
  }>(
    "select record_id, record from adl_authority_records where application_id = $1 and object_name = $2 and deleted_at is null order by record_id",
    [applicationId, objectName],
  );
  return result.rows.map((row) => ({ recordId: row.record_id, values: row.record.values }));
}

function requireAccepted(outcome: AuthorityOutcome): AuthorityOutcome {
  if (outcome.status !== "accepted")
    throw new Error(`Expected an accepted outcome, got ${JSON.stringify(outcome)}`);
  return outcome;
}

describe("self-service registration over a real socket and real PostgreSQL", () => {
  let deployment: Deployment;

  beforeAll(async () => {
    deployment = await startDeployment({
      applicationId: "self-service-open",
      model: giggleModel,
    });
  });
  afterAll(async () => {
    await deployment.close();
  });
  beforeEach(async () => {
    await resetProjections(pool);
    await seedApplication(pool, deployment.applicationId, giggleModel.modelVersion);
  });

  it("mints exactly one identity, link, credential and session for a caller with neither a session nor an invite, and no membership at all", async () => {
    const { transport, userId } = await selfRegister(deployment);

    expect(userId).toMatch(/^user-/u);
    expect(await countRows("adl_authority_identities", deployment.applicationId)).toBe(1);
    expect(await countRows("adl_authority_identity_links", deployment.applicationId)).toBe(1);
    expect(await countRows("adl_authority_webauthn_credentials", deployment.applicationId)).toBe(1);
    expect(await countRows("adl_authority_sessions", deployment.applicationId)).toBe(1);
    // The claim the whole design rests on: a self-registered identity holds
    // nothing. No membership record exists anywhere in the projection, and the
    // membership index the context service reads has nothing in it either.
    expect(await recordsOf(deployment.applicationId, "BandMember")).toEqual([]);
    expect(await countRows("adl_authority_context_memberships", deployment.applicationId)).toBe(0);
    // No access-audit row either: a self-registration has no context, and the
    // durable record of it is the identity row itself.
    expect(await countRows("adl_authority_access_audit_events", deployment.applicationId)).toBe(0);

    await expect(transport.currentSession()).resolves.toMatchObject({ userId });
    const bootstrap = await transport.bootstrap(undefined, {});
    expect(bootstrap.records).toEqual([]);
  });

  /*
   * Acceptance criterion 6, and the answer to "a door into a room with nothing
   * in it". The real `CreateBand` from the real Giggle Band model, replayed by
   * the identity that just registered itself.
   */
  it("lets that identity run CreateBand and come out a BandAdmin of its own band", async () => {
    const { transport, userId } = await selfRegister(deployment);

    const outcome = requireAccepted(
      await transport.replay(undefined, {
        operationId: "op-first-band",
        kind: "command",
        commandName: "CreateBand",
        input: { Name: "The Newcomers" },
        recordIds: [
          { step: "createBand", objectName: "Band", recordId: "band-first" },
          { step: "createFounderMembership", objectName: "BandMember", recordId: "member-first" },
        ],
      }),
    );
    expect(outcome.status).toBe("accepted");

    // Read out of the projection, not out of the response.
    const bands = await recordsOf(deployment.applicationId, "Band");
    expect(bands).toEqual([
      expect.objectContaining({
        recordId: "band-first",
        values: expect.objectContaining({ Name: "The Newcomers", CreatedBy: userId }),
      }),
    ]);
    const members = await recordsOf(deployment.applicationId, "BandMember");
    expect(members).toEqual([
      expect.objectContaining({
        recordId: "member-first",
        values: expect.objectContaining({ User: userId, Band: "band-first", Role: "BandAdmin" }),
      }),
    ]);

    // And the next bootstrap puts them inside it.
    const bootstrap = await transport.bootstrap(undefined, {
      selectedContexts: { Band: "band-first" },
    });
    const byObject = bootstrap.records.filter(
      (record) => record.objectName === "Band" || record.objectName === "BandMember",
    );
    expect(byObject.filter((record) => record.objectName === "Band")).toHaveLength(1);
    expect(byObject.filter((record) => record.objectName === "BandMember")).toHaveLength(1);
  });

  /*
   * Phase 101's property, asserted rather than assumed. Before that phase both
   * apps granted SEARCH and READ on the whole `User` object to any
   * AUTHENTICATED caller -- which self-service registration would have turned
   * into an open directory of every user's name and email address.
   */
  it("leaves a member-less self-registered identity unable to read anyone's email or enumerate users", async () => {
    const { transport, userId } = await selfRegister(deployment);

    // Somebody else, already in the directory, with a real email address.
    const runtime = new ApplicationRuntime(giggleModel, {
      storage: new PostgresObjectStorageBackend(
        authorityPool(pool),
        deployment.applicationId,
        giggleModel,
      ),
    });
    const other = await runtime.create(
      "User",
      { Name: "Riley Stone", Email: "riley@example.com" },
      { userId: "seed-system", roles: ["SystemAdmin"], channel: "api" },
    );

    // The self-registered caller, holding an identity and nothing else. This
    // is the real enforcement path the authority runs, over the real
    // projection: `ObjectStore` read/search and the field-shaping read.
    const newcomer = { userId, roles: [], channel: "api" as const };

    await expect(runtime.search("User", {}, newcomer)).rejects.toBeInstanceOf(PolicyDeniedError);
    await expect(runtime.read("User", other.meta.guid, newcomer)).rejects.toBeInstanceOf(
      PolicyDeniedError,
    );

    /*
     * The field-scoped grant is the *only* thing that survives, and asserting
     * on the rendered result rather than on the absence of an exception is the
     * point: every path that turns a stored id into a name degrades silently
     * on refusal, so "no throw" would also be satisfied by rendering the raw
     * `user-...` id.
     */
    const label = await runtime.readFieldsForDisplay(
      "User",
      other.meta.guid,
      ["Name", "Email"],
      newcomer,
    );
    expect(label?.values).toEqual({ Name: "Riley Stone" });
    // The *values* carry a real name and no raw id. (`meta.guid` is of course
    // the record's own `user-...` id and is allowed to be; the disclosure
    // question is about what a surface would render.)
    expect(JSON.stringify(label?.values)).not.toContain("@");
    expect(JSON.stringify(label?.values)).not.toContain("user-");

    // Nothing of anybody's is reachable from a bootstrap either: the identity
    // is a member of no context, so every scoped object is out of reach and
    // `User` itself carries no whole-record grant at all.
    const bootstrap = await transport.bootstrap(undefined, {});
    expect(bootstrap.records).toEqual([]);
    expect(JSON.stringify(bootstrap)).not.toContain("@");
  });

  it("charges anonymous account creation its own bucket, leaving the invited ceremony's allowance alone", async () => {
    const limited = await startDeployment({
      applicationId: "self-service-limited",
      model: giggleModel,
      selfRegistrationLimit: 1,
    });
    try {
      await selfRegister(limited);
      const refused = await refusalOf(() => stranger(limited).beginPasskeyRegistration(undefined));
      expect(refused.status).toBe(429);
      expect(refused.code).toBe("rate_limited");

      // The ceremony bucket is untouched, so a caller presenting a (here
      // invalid) invite still reaches the ceremony rather than the limiter --
      // proving the two buckets are distinct rather than the whole surface
      // being throttled.
      const invited = await refusalOf(() =>
        stranger(limited).beginPasskeyRegistration("not-a-real-invite".padEnd(48, "x")),
      );
      expect(invited.status).toBe(401);
      expect(invited.code).toBe("ADL_PASSKEY_INVITE_INVALID");
    } finally {
      await limited.close();
    }
  });
});

/*
 * The two refusals. Both must be the identical `401 ADL_PASSKEY_UNAUTHORIZED`
 * that an invite-only deployment has always produced: a caller must not be
 * able to tell whether the model declined or the operator did.
 */
describe("self-service registration refused", () => {
  it("refuses the identical anonymous ceremony when the served model declares INVITE_ONLY", async () => {
    const deployment = await startDeployment({
      applicationId: "self-service-invite-only",
      model: inviteOnlyModel,
    });
    try {
      await resetProjections(pool);
      await seedApplication(pool, deployment.applicationId, inviteOnlyModel.modelVersion);

      const refused = await refusalOf(() =>
        stranger(deployment).beginPasskeyRegistration(undefined),
      );
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("ADL_PASSKEY_UNAUTHORIZED");
      expect(await countRows("adl_authority_identities", deployment.applicationId)).toBe(0);
      expect(await countRows("adl_authority_webauthn_challenges", deployment.applicationId)).toBe(
        0,
      );
    } finally {
      await deployment.close();
    }
  });

  it("refuses it again when the model permits it but the deployment is switched off", async () => {
    const deployment = await startDeployment({
      applicationId: "self-service-off",
      model: giggleModel,
      ceiling: "off",
    });
    try {
      await resetProjections(pool);
      await seedApplication(pool, deployment.applicationId, giggleModel.modelVersion);

      const refused = await refusalOf(() =>
        stranger(deployment).beginPasskeyRegistration(undefined),
      );
      expect(refused.status).toBe(401);
      expect(refused.code).toBe("ADL_PASSKEY_UNAUTHORIZED");
      expect(await countRows("adl_authority_identities", deployment.applicationId)).toBe(0);
    } finally {
      await deployment.close();
    }
  });
});
