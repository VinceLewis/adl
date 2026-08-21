import { describe, expect, it } from "vitest";
import {
  AuthorityConfigurationError,
  AuthorityService,
  BypassIdentityVerifier,
  InMemoryAuthorityIdentitySessionStore,
  InMemoryObjectStorageBackend,
  OpaqueSessionAdapter,
  UnconfiguredUpstreamIdentityVerifier,
  createAuthorityHttpHandler,
  describeIdentityVerification,
  loadAuthorityConfiguration,
  resolveApplicationModel,
  resolveSelfServiceRegistration,
  selectUpstreamIdentityVerifier,
} from "../src/index.js";
import type {
  AuthorityConfiguration,
  AuthorityIdentityVerificationMode,
  SecurityLogEvent,
  SecurityLogger,
  UpstreamIdentityVerifier,
} from "../src/index.js";

/**
 * The Phase 46 identity boundary: the switch defaults to the bypass, turning it
 * on never silently downgrades to the bypass, and whichever verifier is active
 * is disclosed at startup and on `/readyz` without ever exposing a proof value.
 */

const baseEnvironment: Record<string, string | undefined> = {
  ADL_ENV: "test",
  ADL_DATABASE_URL: "postgresql://authority.test/adl",
  ADL_ALLOWED_ORIGINS: "https://app.test",
  ADL_UPSTREAM_IDENTITY_ISSUER: "https://identity.test",
  ADL_UPSTREAM_IDENTITY_AUDIENCE: "adl-test",
};

const productionEnvironment: Record<string, string | undefined> = {
  ...baseEnvironment,
  ADL_ENV: "production",
  ADL_COOKIE_SECURE: "true",
};

const accountProof = "proof-alex@example.test";
/** Control characters that real PostgreSQL refuses in a text identity key. */
const NUL = String.fromCharCode(0);
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
const DELETE = String.fromCharCode(0x7f);

const configuration: AuthorityConfiguration = {
  environment: "test",
  databaseUrl: "postgresql://authority.test/adl",
  allowedOrigins: ["https://app.test"],
  cookieName: "__Host-adl_session",
  csrfCookieName: "__Host-adl_csrf",
  sessionTtlMinutes: 480,
  maxRequestBytes: 4_096,
  upstreamIdentity: { issuer: "https://identity.test", audience: "adl-test" },
  identityVerification: { mode: "bypass" },
  rateLimits: {
    accountProof: 10,
    webauthn: 10,
    selfRegistration: 10,
    session: 10,
    invite: 10,
    bootstrap: 10,
    replay: 10,
    report: 10,
    administration: 10,
  },
};

const model = resolveApplicationModel({
  app: { name: "Identity switch fixture", startView: "DocumentList" },
  objects: [
    {
      name: "Document",
      fields: [{ name: "Title", type: "text" }],
      views: [{ name: "DocumentList", kind: "list", fields: ["Title"], actions: ["read"] }],
    },
  ],
});

function withMode(mode: AuthorityIdentityVerificationMode): AuthorityConfiguration {
  return { ...configuration, identityVerification: { mode } };
}

function issueRequest(proof: string): Request {
  return new Request("https://app.test/v1/session/issue", {
    method: "POST",
    headers: {
      origin: "https://app.test",
      "content-type": "application/json",
      "x-adl-account-proof": proof,
    },
    body: "{}",
  });
}

function fixture(mode: AuthorityIdentityVerificationMode) {
  const config = withMode(mode);
  const sessions = new OpaqueSessionAdapter(new InMemoryAuthorityIdentitySessionStore(), {
    newId: (() => {
      let number = 0;
      return () => `id-${++number}`;
    })(),
    newToken: (() => {
      let number = 0;
      return () => `token-${++number}`.padEnd(48, "x");
    })(),
  });
  const entries: SecurityLogEvent[] = [];
  const logger: SecurityLogger = { write: (event) => entries.push(event) };
  // No provider implementation is injected, which is the real Phase 46 state:
  // switching the mode to `upstream` must fail closed rather than fall back.
  const identityVerifier = selectUpstreamIdentityVerifier(config);
  return {
    entries,
    identityVerifier,
    handle: createAuthorityHttpHandler({
      configuration: config,
      sessions,
      authority: new AuthorityService(model, new InMemoryObjectStorageBackend(), sessions),
      identityVerifier,
      logger,
      clientKey: () => "identity-switch-client",
      newCsrfToken: () => "csrf-token-value".padEnd(48, "c"),
    }),
  };
}

describe("authority identity verification configuration", () => {
  it("defaults the switch to the bypass and accepts only the two declared modes", () => {
    expect(loadAuthorityConfiguration(baseEnvironment).identityVerification).toEqual({
      mode: "bypass",
    });
    expect(
      loadAuthorityConfiguration({ ...baseEnvironment, ADL_IDENTITY_VERIFICATION: "" })
        .identityVerification.mode,
    ).toBe("bypass");
    expect(
      loadAuthorityConfiguration({ ...baseEnvironment, ADL_IDENTITY_VERIFICATION: "   " })
        .identityVerification.mode,
    ).toBe("bypass");
    expect(
      loadAuthorityConfiguration({ ...baseEnvironment, ADL_IDENTITY_VERIFICATION: " upstream " })
        .identityVerification.mode,
    ).toBe("upstream");
    for (const invalid of ["Bypass", "UPSTREAM", "oidc", "off", "true"]) {
      expect(() =>
        loadAuthorityConfiguration({ ...baseEnvironment, ADL_IDENTITY_VERIFICATION: invalid }),
      ).toThrow(AuthorityConfigurationError);
    }
  });

  /*
   * The deployment control may only ever *restrict*. The negative rows below
   * are the point of the whole design: no accepted value of any environment
   * variable makes self-service effective for a model that did not declare it.
   */
  it("defaults the self-service ceiling to 'model' and accepts only 'model' or 'off'", () => {
    expect(loadAuthorityConfiguration(baseEnvironment).selfServiceRegistration).toBe("model");
    expect(
      loadAuthorityConfiguration({ ...baseEnvironment, ADL_SELF_SERVICE_REGISTRATION: "" })
        .selfServiceRegistration,
    ).toBe("model");
    expect(
      loadAuthorityConfiguration({ ...baseEnvironment, ADL_SELF_SERVICE_REGISTRATION: "  off  " })
        .selfServiceRegistration,
    ).toBe("off");
    // Deliberately including `on`, `true`, `yes` and `1`: there is no value
    // that turns self-service on against the model's wishes, and an operator
    // who tries must be told so rather than silently ignored.
    for (const invalid of ["on", "true", "yes", "1", "Model", "OFF", "enabled"]) {
      expect(() =>
        loadAuthorityConfiguration({
          ...baseEnvironment,
          ADL_SELF_SERVICE_REGISTRATION: invalid,
        }),
      ).toThrow(AuthorityConfigurationError);
    }
  });

  it("parses ADL_RATE_SELF_REGISTRATION and defaults it to 5", () => {
    expect(loadAuthorityConfiguration(baseEnvironment).rateLimits.selfRegistration).toBe(5);
    expect(
      loadAuthorityConfiguration({ ...baseEnvironment, ADL_RATE_SELF_REGISTRATION: "2" }).rateLimits
        .selfRegistration,
    ).toBe(2);
    expect(() =>
      loadAuthorityConfiguration({ ...baseEnvironment, ADL_RATE_SELF_REGISTRATION: "0" }),
    ).toThrow(AuthorityConfigurationError);
  });

  it.each([
    ["selfService", undefined, "passkey", true],
    ["selfService", "off", "passkey", false],
    ["selfService", "model", "passkey", true],
    ["selfService", undefined, "bypass", false],
    ["selfService", undefined, "upstream", false],
    ["inviteOnly", undefined, "passkey", false],
    ["inviteOnly", "off", "passkey", false],
    [undefined, undefined, "passkey", false],
    [undefined, "model", "passkey", false],
    [undefined, "off", "passkey", false],
  ])(
    "resolves model=%s env=%s mode=%s to selfServiceRegistration=%s",
    (registration, ceiling, mode, expected) => {
      const declared = resolveApplicationModel({
        app: {
          name: "Registration fixture",
          startView: "DocumentList",
          ...(registration === undefined
            ? {}
            : { registration: registration as "selfService" | "inviteOnly" }),
        },
        objects: [
          {
            name: "Document",
            fields: [{ name: "Title", type: "text" }],
            views: [{ name: "DocumentList", kind: "list", fields: ["Title"] }],
          },
        ],
      });
      const resolved = resolveSelfServiceRegistration(
        {
          ...configuration,
          identityVerification: { mode: mode as AuthorityIdentityVerificationMode },
          ...(ceiling === undefined ? {} : { selfServiceRegistration: ceiling as "model" | "off" }),
        },
        declared,
      );

      expect(resolved.selfServiceRegistrationEnabled).toBe(expected);
      expect(
        describeIdentityVerification(resolved, new BypassIdentityVerifier())
          .selfServiceRegistration,
      ).toBe(expected);
    },
  );

  it("makes the bypass unreachable in production, with no acknowledgement escape hatch", () => {
    expect(() => loadAuthorityConfiguration(productionEnvironment)).toThrow(
      AuthorityConfigurationError,
    );
    // Phase 46 let an operator acknowledge the bypass in production because no
    // real verifier existed yet. One does now, so the acknowledgement is gone
    // and a production bypass is refused however it is stated.
    for (const acknowledgement of ["true", "false", "TRUE", "1"]) {
      expect(() =>
        loadAuthorityConfiguration({
          ...productionEnvironment,
          ADL_IDENTITY_BYPASS_ACKNOWLEDGED: acknowledgement,
        }),
      ).toThrow(AuthorityConfigurationError);
    }
    expect(
      loadAuthorityConfiguration({
        ...productionEnvironment,
        ADL_IDENTITY_VERIFICATION: "upstream",
      }).identityVerification.mode,
    ).toBe("upstream");
    expect(
      loadAuthorityConfiguration({
        ...productionEnvironment,
        ADL_IDENTITY_VERIFICATION: "passkey",
        ADL_WEBAUTHN_RP_ID: "app.test",
      }).identityVerification.mode,
    ).toBe("passkey");
  });
});

describe("upstream identity verifier selection", () => {
  it("uses the bypass while the switch is off, even when a provider is available", () => {
    const provider: UpstreamIdentityVerifier = {
      name: "provider",
      verify: async () => ({ subject: "alex@example.test" }),
    };
    const selected = selectUpstreamIdentityVerifier(withMode("bypass"), { upstream: provider });
    expect(selected).toBeInstanceOf(BypassIdentityVerifier);
    expect(selected.name).toBe("bypass");
    expect(describeIdentityVerification(withMode("bypass"), selected)).toEqual({
      mode: "bypass",
      verifier: "bypass",
      bypassed: true,
      selfServiceRegistration: false,
    });
  });

  it("uses the injected provider once the switch is on", () => {
    const provider: UpstreamIdentityVerifier = {
      name: "provider",
      verify: async () => ({ subject: "alex@example.test" }),
    };
    const selected = selectUpstreamIdentityVerifier(withMode("upstream"), { upstream: provider });
    expect(selected).toBe(provider);
    expect(describeIdentityVerification(withMode("upstream"), selected)).toEqual({
      mode: "upstream",
      verifier: "provider",
      bypassed: false,
      selfServiceRegistration: false,
    });
  });

  it("fails closed rather than falling back to the bypass when no provider is supplied", async () => {
    const selected = selectUpstreamIdentityVerifier(withMode("upstream"));
    expect(selected).toBeInstanceOf(UnconfiguredUpstreamIdentityVerifier);
    expect(selected).not.toBeInstanceOf(BypassIdentityVerifier);
    expect(selected.name).toBe("upstream-unconfigured");
    await expect(selected.verify(accountProof, configuration.upstreamIdentity)).resolves.toBeNull();
    expect(describeIdentityVerification(withMode("upstream"), selected)).toEqual({
      mode: "upstream",
      verifier: "upstream-unconfigured",
      bypassed: false,
      selfServiceRegistration: false,
    });
  });
});

describe("BypassIdentityVerifier", () => {
  // Typed through the interface, exactly as the HTTP edge calls it.
  const verifier: UpstreamIdentityVerifier = new BypassIdentityVerifier();

  it("accepts the supplied proof as the identity subject", async () => {
    await expect(verifier.verify(accountProof, configuration.upstreamIdentity)).resolves.toEqual({
      subject: accountProof,
    });
    await expect(
      verifier.verify(`  ${accountProof}  `, configuration.upstreamIdentity),
    ).resolves.toEqual({ subject: accountProof });
    await expect(verifier.verify("a".repeat(320), configuration.upstreamIdentity)).resolves.toEqual(
      { subject: "a".repeat(320) },
    );
  });

  it("refuses a proof that could not be a usable identity key", async () => {
    const unusable = [
      "",
      "   ",
      "\t\n",
      "a".repeat(321),
      // A NUL byte in a text key is rejected by real PostgreSQL, so it must
      // never reach identity storage through the bypass.
      `alex${NUL}@example.test`,
      `alex${UNIT_SEPARATOR}@example.test`,
      `alex${DELETE}@example.test`,
      "alex\n@example.test",
    ];
    for (const proof of unusable) {
      await expect(verifier.verify(proof, configuration.upstreamIdentity)).resolves.toBeNull();
    }
  });
});

describe("identity switch over the authority HTTP edge", () => {
  it("issues a session from an account proof and discloses the bypass on /readyz", async () => {
    const { handle, entries } = fixture("bypass");
    const issued = await handle(issueRequest(accountProof));
    expect(issued.status).toBe(201);
    expect(await issued.json()).toEqual({
      userId: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(issued.headers.get("set-cookie")).toContain("__Host-adl_session=");

    const ready = await handle(new Request("https://app.test/readyz"));
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: "ready",
      identityVerification: {
        mode: "bypass",
        verifier: "bypass",
        bypassed: true,
        selfServiceRegistration: false,
      },
    });

    // The startup security log states the active boundary exactly once.
    expect(entries.filter((entry) => entry.event === "identity_verification_configured")).toEqual([
      expect.objectContaining({
        event: "identity_verification_configured",
        outcome: "allowed",
        mode: "bypass",
        verifier: "bypass",
        bypassed: true,
      }),
    ]);
    expect(JSON.stringify(entries)).not.toContain(accountProof);
  });

  it("rejects an unverifiable proof and issues no session once the switch is on", async () => {
    const { handle, entries } = fixture("upstream");
    const rejected = await handle(issueRequest(accountProof));
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: "authentication_failed" });
    expect(rejected.headers.get("set-cookie")).toBeNull();

    const ready = await handle(new Request("https://app.test/readyz"));
    expect(await ready.json()).toEqual({
      status: "ready",
      identityVerification: {
        mode: "upstream",
        verifier: "upstream-unconfigured",
        bypassed: false,
        selfServiceRegistration: false,
      },
    });
    expect(entries[0]).toMatchObject({
      event: "identity_verification_configured",
      mode: "upstream",
      verifier: "upstream-unconfigured",
      bypassed: false,
      selfServiceRegistration: false,
    });
    expect(JSON.stringify(entries)).not.toContain(accountProof);
  });

  it("refuses an unusable proof under the bypass without logging it", async () => {
    // A NUL-bearing proof cannot reach the handler at all: the HTTP layer
    // refuses it as a header value, so that guard is proven directly against
    // BypassIdentityVerifier above. An over-long proof does reach the verifier.
    expect(() => issueRequest(`alex${NUL}@example.test-padding`)).toThrow();
    const { handle, entries } = fixture("bypass");
    const crafted = `over-long-proof-${"a".repeat(400)}`;
    const response = await handle(issueRequest(crafted));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication_failed" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(entries)).not.toContain(crafted);
    expect(JSON.stringify(entries)).not.toContain("over-long-proof");
  });
});
