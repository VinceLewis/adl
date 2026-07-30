import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { Pool } from "pg";
import {
  AuthorityConfigurationError,
  PostgresObjectStorageBackend,
  RuntimeStartupError,
  noopRuntimeLogger,
  resolveApplicationModel,
  runRuntimeStartupCompatibilityChecks,
} from "../../src/index.js";
import type {
  ObjectStorageBackend,
  PostgresQueryable,
  ResolvedApplicationModel,
  RuntimeStartupDiagnostic,
  StoredObjectRecord,
} from "../../src/index.js";
// The composed entrypoint pulls in `node:fs`, `node:http` and `pg`; it is
// deliberately kept out of the browser-safe barrel.
import { createAuthorityProcess } from "../../src/server/authority-entrypoint.js";
import { faultyPool, resetProjections } from "./pg-harness.js";

/**
 * Phase 51, server side: model migration of the accepted-record projection,
 * proven against real PostgreSQL.
 *
 * Every claim this phase makes is a claim about what is *in the database* after
 * something happened — a record rewritten, a metadata row advanced, or, in the
 * case that matters most, neither of those because a fault rolled the whole
 * thing back. A fake `pg` cannot prove any of it: rollback, the atomicity of a
 * `begin`/`commit` pair on one pinned connection, and the nullability of
 * `model_fingerprint` are all real-backend behaviour. So each test here seeds
 * rows with SQL, runs the real guard, and reads the rows back with SQL.
 */

const applicationId = "model-migration";
const processApplicationId = "model-migration-process";
const OLD_VERSION = "1.0.0";
const NEW_VERSION = "1.1.0";
/** Well-formed but belonging to no model here: a fingerprint that must not match. */
const FOREIGN_FINGERPRINT = `sha256-${"0".repeat(64)}`;
/**
 * Seeded into a record so a disclosure assertion has something specific to look
 * for. If this string ever reaches a diagnostic, log line or error message, the
 * metadata-only boundary has been broken.
 */
const SECRET_VALUE = "Kestrel-Room-Backstage-7741";

const gigViews = [{ name: "GigList", kind: "list" as const, fields: ["Title"], actions: ["read"] }];
const gigPolicies = [
  {
    name: "GigPolicy",
    object: "Gig",
    rules: [
      {
        name: "read",
        effect: "allow" as const,
        principal: { match: "authenticated" as const },
        action: "read" as const,
      },
    ],
  },
];

/** The model that wrote the persisted state: `Venue`, `LegacyNote`, schema 1. */
const oldModel = resolveApplicationModel({
  modelVersion: OLD_VERSION,
  app: { name: "Migration fixture", startView: "GigList" },
  roles: [{ name: "Member" }],
  objects: [
    {
      name: "Gig",
      fields: [
        { name: "Title", type: "text", required: true },
        { name: "Venue", type: "text" },
        { name: "LegacyNote", type: "text" },
      ],
      views: gigViews,
    },
    { name: "Band", fields: [{ name: "Name", type: "text", required: true }] },
  ],
  policies: gigPolicies,
});

/**
 * The model being deployed. It renames a field, adds one with a default, drops
 * one, and bumps the object's schema version — and declares the hop that gets
 * persisted records there.
 */
const newModel = resolveApplicationModel({
  modelVersion: NEW_VERSION,
  app: { name: "Migration fixture", startView: "GigList" },
  roles: [{ name: "Member" }],
  objects: [
    {
      name: "Gig",
      schemaVersion: 2,
      fields: [
        { name: "Title", type: "text", required: true },
        { name: "VenueName", type: "text" },
        { name: "PayoutCents", type: "number" },
      ],
      views: gigViews,
    },
    { name: "Band", fields: [{ name: "Name", type: "text", required: true }] },
  ],
  policies: gigPolicies,
  migrations: [
    {
      from: OLD_VERSION,
      to: NEW_VERSION,
      objects: [
        {
          object: "Gig",
          schemaVersion: 2,
          steps: [
            { kind: "renameField", from: "Venue", to: "VenueName" },
            { kind: "addField", field: "PayoutCents", defaultValue: 0 },
            { kind: "dropField", field: "LegacyNote" },
          ],
        },
      ],
    },
  ],
});

/**
 * A later model whose only declared hop starts somewhere the persisted state
 * never was. Nothing reaches `1.0.0`, so this must refuse rather than guess.
 */
const unreachableModel = resolveApplicationModel({
  modelVersion: "3.0.0",
  app: { name: "Migration fixture", startView: "GigList" },
  roles: [{ name: "Member" }],
  objects: [
    {
      name: "Gig",
      fields: [
        { name: "Title", type: "text", required: true },
        { name: "Venue", type: "text" },
        { name: "LegacyNote", type: "text" },
      ],
      views: gigViews,
    },
    { name: "Band", fields: [{ name: "Name", type: "text", required: true }] },
  ],
  policies: gigPolicies,
  migrations: [{ from: "2.0.0", to: "3.0.0", objects: [] }],
});

let pool: Pool;
/** An ADL project on disk, so the entrypoint compiles a real model from source. */
let projectRoot: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: inject("pgUrl"), max: 8 });
  await applyFingerprintMigration();
  projectRoot = writeMigrationProject();
});

afterAll(async () => {
  await pool.end();
  rmSync(projectRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetProjections(pool);
});

describe("model fingerprint column against real PostgreSQL", () => {
  it("exposes a nullable model_fingerprint column on the models projection", async () => {
    const column = await pool.query<{ data_type: string; is_nullable: string }>(
      "select data_type, is_nullable from information_schema.columns where table_name = 'adl_authority_models' and column_name = 'model_fingerprint'",
    );
    expect(column.rows[0]).toEqual({ data_type: "text", is_nullable: "YES" });
  });

  it("round-trips version and fingerprint, including the null-fingerprint case", async () => {
    await withPinnedStorage(newModel, async (storage) => {
      await storage.writeApplicationMetadata({
        modelVersion: NEW_VERSION,
        modelFingerprint: newModel.modelFingerprint,
      });
      expect(await storage.readApplicationMetadata()).toEqual({
        modelVersion: NEW_VERSION,
        modelFingerprint: newModel.modelFingerprint,
      });
      expect(await storedMetadata()).toEqual({
        model_version: NEW_VERSION,
        model_fingerprint: newModel.modelFingerprint,
      });

      // State written before fingerprints existed: the column is null in SQL,
      // and the field is absent — not null — in the read model, because the
      // guard distinguishes "no fingerprint" from "a fingerprint that differs".
      await storage.writeApplicationMetadata({ modelVersion: OLD_VERSION });
      expect(await storage.readApplicationMetadata()).toEqual({ modelVersion: OLD_VERSION });
      expect(await storedMetadata()).toEqual({
        model_version: OLD_VERSION,
        model_fingerprint: null,
      });
    });
  });
});

describe("accepted-record migration against real PostgreSQL", () => {
  it("migrates every record and advances the metadata row in one commit, losing nothing", async () => {
    await seedMetadata(OLD_VERSION, oldModel.modelFingerprint);
    const gigs = [gigRecord("gig-1", "Kestrel Room"), gigRecord("gig-2", SECRET_VALUE)];
    for (const gig of gigs) await seedRecord("Gig", gig);
    const band = bandRecord();
    await seedRecord("Band", band);

    const diagnostics = await withPinnedStorage(newModel, (storage) =>
      runRuntimeStartupCompatibilityChecks(newModel, storage, noopRuntimeLogger, {
        applyMigrations: true,
      }),
    );

    expect(diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    const applied = diagnostics.find((entry) => entry.code === "ADL_MODEL_MIGRATION_APPLIED");
    expect(applied).toMatchObject({ severity: "info", expected: NEW_VERSION, actual: OLD_VERSION });
    // Only the two Gigs changed: an object no step mentions is not rewritten.
    expect(applied?.message).toContain("2 record(s) changed");

    // Read the rows back out of PostgreSQL rather than trusting the return
    // value: the claim is about what a next process would find.
    for (const gig of gigs) {
      const stored = await storedRecord("Gig", gig.meta.guid);
      expect(stored?.values).toEqual({
        Title: gig.values.Title,
        VenueName: gig.values.Venue,
        PayoutCents: 0,
      });
      expect(stored?.values.Venue).toBeUndefined();
      expect(stored?.values.LegacyNote).toBeUndefined();
      expect(stored?.meta.schemaVersion).toBe(2);
      // A migration is nobody's edit: revision, actor and timestamps survive it,
      // so it neither breaks optimistic concurrency nor forges an audit trail.
      expect(stored?.meta).toMatchObject({
        guid: gig.meta.guid,
        object: "Gig",
        revision: gig.meta.revision,
        createdAt: gig.meta.createdAt,
        createdBy: gig.meta.createdBy,
        updatedAt: gig.meta.updatedAt,
        updatedBy: gig.meta.updatedBy,
      });
    }

    // Untouched object, byte-identical.
    expect(await storedRecord("Band", band.meta.guid)).toEqual(band);

    expect(await storedMetadata()).toEqual({
      model_version: NEW_VERSION,
      model_fingerprint: newModel.modelFingerprint,
    });
    expect(await recordCount()).toBe(3);

    // The state is now genuinely readable by the deployed model: a second pass
    // with migrations switched off finds nothing left to complain about.
    const second = await withPinnedStorage(newModel, (storage) =>
      runRuntimeStartupCompatibilityChecks(newModel, storage, noopRuntimeLogger),
    );
    expect(second).toEqual([]);
  });

  /**
   * The most important test in this file. Phase 44's atomicity has to survive
   * migration: a fault after the record rewrites and before the metadata row
   * lands must leave the projection exactly as it was, not half-migrated. Only
   * real PostgreSQL can prove that, and only on one pinned connection — the
   * `begin` and the `commit` must be the same session's.
   */
  it("rolls back a mid-migration fault and leaves the projection byte-for-byte unchanged", async () => {
    await seedMetadata(OLD_VERSION, oldModel.modelFingerprint);
    const gigs = [gigRecord("gig-1", "Kestrel Room"), gigRecord("gig-2", SECRET_VALUE)];
    for (const gig of gigs) await seedRecord("Gig", gig);
    const band = bandRecord();
    await seedRecord("Band", band);
    const before = await allRecordRows();

    // Fault on the metadata write, which the migration issues last: the record
    // rewrites have already succeeded inside the transaction by then, so only a
    // real rollback can restore them.
    const failure = await runFaultyMigration((sql) =>
      sql.startsWith("insert into adl_authority_models"),
    );

    expect(failure).toBeInstanceOf(RuntimeStartupError);
    const diagnostics = (failure as RuntimeStartupError).diagnostics;
    expect(diagnostics.map((entry) => entry.code)).toContain("ADL_MIGRATION_FAILED");
    const failed = diagnostics.find((entry) => entry.code === "ADL_MIGRATION_FAILED");
    expect(failed?.severity).toBe("error");
    expect(failed?.message).toContain("rolled back");
    // Metadata only: the fault is reduced to an error name, and no record value
    // reaches the diagnostic that describes the failure.
    expect(JSON.stringify(diagnostics)).not.toContain(SECRET_VALUE);

    // The whole point: unmigrated records *and* the old metadata row.
    expect(await allRecordRows()).toEqual(before);
    for (const gig of gigs) {
      const stored = await storedRecord("Gig", gig.meta.guid);
      expect(stored).toEqual(gig);
      expect(stored?.values.Venue).toBe(gig.values.Venue);
      expect(stored?.values.VenueName).toBeUndefined();
      expect(stored?.meta.schemaVersion).toBe(1);
    }
    expect(await storedRecord("Band", band.meta.guid)).toEqual(band);
    expect(await storedMetadata()).toEqual({
      model_version: OLD_VERSION,
      model_fingerprint: oldModel.modelFingerprint,
    });
    expect(await recordCount()).toBe(3);
  });

  /**
   * The companion to the test above, and the reason it can be trusted. Faulting
   * on `commit` means every rewrite in the migration has already been issued and
   * accepted by PostgreSQL — so the pre-migration state that comes back
   * afterwards can only be the work of a real rollback, not of writes that never
   * ran.
   */
  it("rolls back after every rewrite has been issued, when the commit itself fails", async () => {
    await seedMetadata(OLD_VERSION, oldModel.modelFingerprint);
    const gigs = [gigRecord("gig-1", "Kestrel Room"), gigRecord("gig-2", SECRET_VALUE)];
    for (const gig of gigs) await seedRecord("Gig", gig);
    await seedRecord("Band", bandRecord());
    const before = await allRecordRows();

    const failure = await runFaultyMigration((sql) => sql === "commit");

    expect(failure).toBeInstanceOf(RuntimeStartupError);
    expect((failure as RuntimeStartupError).diagnostics.map((entry) => entry.code)).toContain(
      "ADL_MIGRATION_FAILED",
    );
    expect(await allRecordRows()).toEqual(before);
    expect(await storedMetadata()).toEqual({
      model_version: OLD_VERSION,
      model_fingerprint: oldModel.modelFingerprint,
    });
    expect(await recordCount()).toBe(3);
  });

  it("refuses fail-closed when no declared migration reaches the persisted version", async () => {
    await seedMetadata(OLD_VERSION, oldModel.modelFingerprint);
    const gig = gigRecord("gig-1", SECRET_VALUE);
    await seedRecord("Gig", gig);
    const before = await allRecordRows();

    const diagnostics = await expectRefusal(unreachableModel);
    expect(diagnostics.map((entry) => entry.code)).toContain(
      "ADL_PERSISTED_MODEL_VERSION_MISMATCH",
    );
    expect(JSON.stringify(diagnostics)).not.toContain(SECRET_VALUE);

    expect(await allRecordRows()).toEqual(before);
    expect(await storedMetadata()).toEqual({
      model_version: OLD_VERSION,
      model_fingerprint: oldModel.modelFingerprint,
    });
  });

  it("refuses persisted state from a later model and leaves it alone", async () => {
    await seedMetadata("2.0.0", FOREIGN_FINGERPRINT);
    const gig = gigRecord("gig-1", SECRET_VALUE);
    await seedRecord("Gig", gig);
    const before = await allRecordRows();

    const diagnostics = await expectRefusal(newModel);
    expect(diagnostics.map((entry) => entry.code)).toContain(
      "ADL_MIGRATION_PERSISTED_VERSION_AHEAD",
    );

    expect(await allRecordRows()).toEqual(before);
    expect(await storedMetadata()).toEqual({
      model_version: "2.0.0",
      model_fingerprint: FOREIGN_FINGERPRINT,
    });
  });

  /**
   * The case that used to pass in silence. The declared version is unchanged, so
   * no migration can be selected — but the content that wrote this state is not
   * the content now running, so none can be assumed unnecessary either.
   */
  it("refuses an unchanged version whose fingerprint disagrees, and touches nothing", async () => {
    await seedMetadata(NEW_VERSION, FOREIGN_FINGERPRINT);
    const gig = gigRecord("gig-1", SECRET_VALUE);
    await seedRecord("Gig", gig);
    const before = await allRecordRows();

    const diagnostics = await expectRefusal(newModel);
    const stale = diagnostics.find(
      (entry) => entry.code === "ADL_PERSISTED_MODEL_FINGERPRINT_STALE",
    );
    expect(stale).toMatchObject({
      severity: "error",
      expected: newModel.modelFingerprint,
      actual: FOREIGN_FINGERPRINT,
    });

    expect(await allRecordRows()).toEqual(before);
    expect(await storedMetadata()).toEqual({
      model_version: NEW_VERSION,
      model_fingerprint: FOREIGN_FINGERPRINT,
    });
  });

  /**
   * A null fingerprint is state written before the column existed, not a
   * mismatch. Refusing it would make adopting the guard a breaking change, so it
   * is backfilled with a warning instead.
   */
  it("backfills a null fingerprint at a matching version rather than refusing", async () => {
    await seedMetadata(NEW_VERSION, null);
    const gig = gigRecord("gig-1", "Kestrel Room");
    await seedRecord("Gig", { ...gig, meta: { ...gig.meta, schemaVersion: 2 } });

    const diagnostics = await withPinnedStorage(newModel, (storage) =>
      runRuntimeStartupCompatibilityChecks(newModel, storage, noopRuntimeLogger, {
        applyMigrations: true,
      }),
    );

    expect(diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(diagnostics.map((entry) => entry.code)).toContain(
      "ADL_PERSISTED_MODEL_FINGERPRINT_MISSING",
    );
    expect(await storedMetadata()).toEqual({
      model_version: NEW_VERSION,
      model_fingerprint: newModel.modelFingerprint,
    });
    // A backfill is not a migration: the record is untouched.
    expect(await storedRecord("Gig", gig.meta.guid)).toEqual({
      ...gig,
      meta: { ...gig.meta, schemaVersion: 2 },
    });
  });
});

describe("authority process startup against real PostgreSQL", () => {
  it("refuses to start on an unreachable persisted version, disclosing nothing", async () => {
    // `giggle-band` resolves to the default version and declares no migration,
    // so nothing reaches the persisted `0.0.1`.
    await seedMetadata("0.0.1", FOREIGN_FINGERPRINT, processApplicationId);
    await seedRecord(
      "Band",
      {
        meta: bandRecord().meta,
        values: { Name: SECRET_VALUE },
      },
      processApplicationId,
    );
    const before = await allRecordRows(processApplicationId);

    const databaseUrl = inject("pgUrl");
    let thrown: unknown;
    await createAuthorityProcess({
      environment: processEnvironment(
        processApplicationId,
        "src/reference/giggle-band",
        await freePort(),
      ),
    }).catch((error: unknown) => {
      thrown = error;
    });

    expect(thrown).toBeInstanceOf(AuthorityConfigurationError);
    const message = (thrown as Error).message;
    expect(message).toContain("left unchanged");
    expect(message).toContain("ADL_PERSISTED_MODEL_VERSION_MISMATCH");
    // Metadata only: no accepted-record value, no session token, no connection
    // string, and no credential from the environment it was configured with.
    expect(message).not.toContain(SECRET_VALUE);
    expect(message).not.toContain(databaseUrl);
    expect(message).not.toContain("postgres");
    expect(message).not.toContain("adl_authority_");
    expect(message).not.toMatch(/[a-z]{4,}:\/\//u);

    expect(await allRecordRows(processApplicationId)).toEqual(before);
    expect(await storedMetadata(processApplicationId)).toEqual({
      model_version: "0.0.1",
      model_fingerprint: FOREIGN_FINGERPRINT,
    });
  });

  /**
   * The full round trip: a projection at the older version, a deployed ADL
   * project that declares the hop, and a process that starts, serves and leaves
   * correctly shaped records behind.
   */
  it("starts against an older projection, migrates it, and serves the migrated records", async () => {
    await seedMetadata(OLD_VERSION, FOREIGN_FINGERPRINT, processApplicationId);
    const gig = gigRecord("gig-round-trip", SECRET_VALUE);
    // The deployed project's `Gig` has no `LegacyNote`; the persisted record
    // carries one, exactly as a real older install would.
    await seedRecord("Gig", gig, processApplicationId);

    const environment = processEnvironment(processApplicationId, projectRoot, await freePort());
    // The migration announces itself on the process log. That line is part of
    // the disclosure boundary, so it is captured and inspected here rather than
    // taken on trust.
    const { result: started, lines } = await capturingConsole(() =>
      createAuthorityProcess({ environment }),
    );
    try {
      expect(started.model.modelVersion).toBe(NEW_VERSION);
      const address = await started.listen();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const ready = await fetch(`${baseUrl}/readyz`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({ status: "ready" });

      const migrationLines = lines.filter((line) => line.includes("authority_model_migration"));
      expect(migrationLines).toHaveLength(1);
      expect(migrationLines[0]).toContain("ADL_MODEL_MIGRATION_APPLIED");
      // Metadata only: a code, a version and a count. No accepted-record value,
      // audit payload, token or connection string.
      expect(lines.join("\n")).not.toContain(SECRET_VALUE);
      expect(lines.join("\n")).not.toContain(environment.ADL_DATABASE_URL);
      expect(lines.join("\n")).not.toContain("LegacyNote");

      const stored = await storedRecord("Gig", gig.meta.guid, processApplicationId);
      expect(stored?.values).toEqual({
        Title: gig.values.Title,
        VenueName: SECRET_VALUE,
        PayoutCents: 0,
      });
      expect(stored?.meta.revision).toBe(gig.meta.revision);
      expect(await recordCount(processApplicationId)).toBe(1);
      expect(await storedMetadata(processApplicationId)).toEqual({
        model_version: NEW_VERSION,
        model_fingerprint: started.model.modelFingerprint,
      });

      // Readable through the process's own storage path, under the model it is
      // now serving, with no compatibility complaint left.
      await withPinnedStorage(
        started.model,
        async (storage) => {
          expect(
            await runRuntimeStartupCompatibilityChecks(started.model, storage, noopRuntimeLogger),
          ).toEqual([]);
          const read = await storage.read("Gig", gig.meta.guid);
          expect(read?.values.VenueName).toBe(SECRET_VALUE);
        },
        processApplicationId,
      );
    } finally {
      await started.close();
    }
  });
});

/**
 * Applies `0007_model_fingerprint.sql`, the real migration file, because the
 * shared harness does not yet list it. `add column if not exists` is idempotent,
 * so this stays correct once the harness does.
 */
async function applyFingerprintMigration(): Promise<void> {
  await pool.query(
    readFileSync(
      resolve(process.cwd(), "src/server/migrations/0007_model_fingerprint.sql"),
      "utf8",
    ),
  );
}

/**
 * The migration boundary is a `begin`/`commit` pair, so it must run on one
 * pinned client. On an unpinned pool those statements can land on different
 * connections and lose atomicity entirely — which is exactly what the entrypoint
 * takes care to avoid.
 */
async function withPinnedStorage<T>(
  model: ResolvedApplicationModel,
  run: (storage: ObjectStorageBackend) => Promise<T>,
  application = applicationId,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(
      new PostgresObjectStorageBackend(client as unknown as PostgresQueryable, application, model),
    );
  } finally {
    client.release();
  }
}

/**
 * Runs the migrating guard over a real pinned connection whose chosen statement
 * throws, and returns whatever it threw. The fault is injected at the driver
 * boundary, so PostgreSQL still executes a real `begin`, real writes and a real
 * `rollback` — which is the only way this proves anything about atomicity.
 */
async function runFaultyMigration(shouldFail: (sql: string) => boolean): Promise<unknown> {
  const client = await faultyPool(pool, shouldFail).connect();
  let failure: unknown;
  try {
    const storage = new PostgresObjectStorageBackend(
      client as unknown as PostgresQueryable,
      applicationId,
      newModel,
    );
    await runRuntimeStartupCompatibilityChecks(newModel, storage, noopRuntimeLogger, {
      applyMigrations: true,
    }).catch((error: unknown) => {
      failure = error;
    });
  } finally {
    client.release();
  }
  return failure;
}

/** Runs the guard expecting a refusal, and returns the diagnostics it refused with. */
async function expectRefusal(model: ResolvedApplicationModel): Promise<RuntimeStartupDiagnostic[]> {
  let thrown: unknown;
  await withPinnedStorage(model, (storage) =>
    runRuntimeStartupCompatibilityChecks(model, storage, noopRuntimeLogger, {
      applyMigrations: true,
    }).catch((error: unknown) => {
      thrown = error;
      return [];
    }),
  );
  expect(thrown).toBeInstanceOf(RuntimeStartupError);
  return (thrown as RuntimeStartupError).diagnostics;
}

/**
 * Collects what the process wrote to its structured log while `run` was in
 * flight. `StructuredSecurityLogger` defaults to `console.info`, so this is the
 * real log line an operator would read, not a restatement of it.
 */
async function capturingConsole<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]): void => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  try {
    return { result: await run(), lines };
  } finally {
    console.info = original;
  }
}

function processEnvironment(
  application: string,
  modelPath: string,
  port: number,
): Record<string, string> {
  return {
    ADL_ENV: "test",
    ADL_DATABASE_URL: inject("pgUrl"),
    ADL_ALLOWED_ORIGINS: "https://app.test",
    ADL_UPSTREAM_IDENTITY_ISSUER: "https://identity.test",
    ADL_UPSTREAM_IDENTITY_AUDIENCE: "adl-test",
    ADL_APPLICATION_ID: application,
    ADL_MODEL_PATH: modelPath,
    ADL_HOST: "127.0.0.1",
    ADL_PORT: String(port),
  };
}

/**
 * An ADL project that declares its own `MODEL_VERSION` and the `MIGRATION` that
 * reaches it, written to a temporary directory so the entrypoint compiles it
 * from source the way a deployment would.
 */
function writeMigrationProject(): string {
  const root = mkdtempSync(join(tmpdir(), "adl-migration-project-"));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "app.yaml"),
    [
      "name: Migration round trip",
      "id: migration-round-trip",
      "",
      "sources:",
      "  - domain.adl",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(root, "domain.adl"),
    [
      "APP 'Migration round trip'",
      "  START_VIEW GigList",
      `  MODEL_VERSION '${NEW_VERSION}'`,
      "END.APP",
      "",
      "ROLE Member",
      "",
      "OBJECT Gig",
      "  DISPLAY Title",
      "  FIELD Title TEXT REQUIRED",
      "  FIELD VenueName TEXT",
      "  FIELD PayoutCents NUMBER",
      "",
      "  VIEW GigList LIST",
      "    FIELDS Title VenueName",
      "    ACTIONS read search",
      "  END.VIEW",
      "END.OBJECT",
      "",
      "POLICY GigPolicy ON Gig",
      "  RULE allowAuthenticatedReadGigs ALLOW READ AUTHENTICATED",
      "  RULE allowAuthenticatedSearchGigs ALLOW SEARCH AUTHENTICATED",
      "END.POLICY",
      "",
      `MIGRATION FROM '${OLD_VERSION}' TO '${NEW_VERSION}'`,
      "  OBJECT Gig",
      "    RENAME FIELD Venue TO VenueName",
      "    ADD FIELD PayoutCents DEFAULT 0",
      "    DROP FIELD LegacyNote",
      "  END.OBJECT",
      "END.MIGRATION",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

function gigRecord(id: string, venue: string): StoredObjectRecord {
  return {
    meta: {
      guid: id,
      object: "Gig",
      schemaVersion: 1,
      revision: `rev-${id}`,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user-seed",
      updatedAt: "2026-01-02T00:00:00.000Z",
      updatedBy: "user-seed",
      syncStatus: "synced",
    },
    values: { Title: `Gig ${id}`, Venue: venue, LegacyNote: "superseded" },
  };
}

function bandRecord(): StoredObjectRecord {
  return {
    meta: {
      guid: "band-1",
      object: "Band",
      schemaVersion: 1,
      revision: "rev-band-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "user-seed",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "user-seed",
      syncStatus: "synced",
    },
    values: { Name: "The Kestrels" },
  };
}

async function seedMetadata(
  modelVersion: string,
  modelFingerprint: string | null,
  application = applicationId,
): Promise<void> {
  await pool.query(
    "insert into adl_authority_models (application_id, model_version, model_fingerprint, resolved_model) values ($1, $2, $3, $4::jsonb)",
    [application, modelVersion, modelFingerprint, JSON.stringify({ modelVersion })],
  );
}

async function seedRecord(
  objectName: string,
  record: StoredObjectRecord,
  application = applicationId,
): Promise<void> {
  await pool.query(
    "insert into adl_authority_records (application_id, object_name, record_id, revision, deleted_at, record) values ($1, $2, $3, $4, null, $5::jsonb)",
    [application, objectName, record.meta.guid, record.meta.revision, JSON.stringify(record)],
  );
}

async function storedRecord(
  objectName: string,
  recordId: string,
  application = applicationId,
): Promise<StoredObjectRecord | null> {
  const result = await pool.query<{ record: StoredObjectRecord }>(
    "select record from adl_authority_records where application_id = $1 and object_name = $2 and record_id = $3",
    [application, objectName, recordId],
  );
  return result.rows[0]?.record ?? null;
}

/** Every record row, ordered, for a byte-for-byte before/after comparison. */
async function allRecordRows(
  application = applicationId,
): Promise<Array<{ object_name: string; record_id: string; revision: string; record: unknown }>> {
  const result = await pool.query<{
    object_name: string;
    record_id: string;
    revision: string;
    record: unknown;
  }>(
    "select object_name, record_id, revision, record::text as record from adl_authority_records where application_id = $1 order by object_name, record_id",
    [application],
  );
  return result.rows;
}

async function storedMetadata(
  application = applicationId,
): Promise<{ model_version: string; model_fingerprint: string | null } | null> {
  const result = await pool.query<{ model_version: string; model_fingerprint: string | null }>(
    "select model_version, model_fingerprint from adl_authority_models where application_id = $1",
    [application],
  );
  return result.rows[0] ?? null;
}

async function recordCount(application = applicationId): Promise<number> {
  const result = await pool.query<{ n: number }>(
    "select count(*)::int n from adl_authority_records where application_id = $1",
    [application],
  );
  return result.rows[0]?.n ?? 0;
}

/** Reserve an ephemeral port, then release it for the process under test. */
async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  const probe = createServer();
  return new Promise((settle) => {
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => settle(port));
    });
  });
}
