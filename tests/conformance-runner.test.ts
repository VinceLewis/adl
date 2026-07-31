import { describe, expect, it } from "vitest";
import { runConformanceCase } from "../src/index.js";
import type {
  AuthorityConformanceCase,
  ModelMigrationConformanceCase,
  PartialApplicationModel,
  RuntimeConformanceCase,
} from "../src/index.js";

/**
 * The Phase 52 runner extensions, each shown to *discriminate*.
 *
 * An assertion that cannot fail is worse than none: it reads as coverage while
 * constraining nothing. Every extension here is therefore exercised twice —
 * once where it must pass and once where it must fail — because the whole point
 * of the phase is that the corpus previously contained five cases pinning a
 * revision format, and three that could not tell `localPrivate` from
 * `localFirst` at all.
 */

const adminContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "ui" as const,
};

const syncModel: PartialApplicationModel = {
  app: { name: "RunnerSync" },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "LocalFirstItem",
      fields: [{ name: "Name", type: "text", required: true }],
      sync: { mode: "localFirst", scope: "all" },
    },
    {
      name: "LocalPrivateItem",
      fields: [{ name: "Name", type: "text", required: true }],
      sync: { mode: "localPrivate", scope: "all" },
    },
    {
      name: "CacheReadonlyItem",
      fields: [{ name: "Name", type: "text", required: true }],
      sync: { mode: "cacheReadonly", scope: "all" },
    },
  ],
  policies: ["LocalFirstItem", "LocalPrivateItem", "CacheReadonlyItem"].map((objectName) => ({
    name: `${objectName}Policy`,
    object: objectName,
    rules: [
      {
        name: `allowAdmin${objectName}`,
        effect: "allow" as const,
        principal: { match: "specific" as const, roles: ["Admin"] },
        action: "*" as const,
      },
    ],
  })),
};

const authorityModel: PartialApplicationModel = {
  app: { name: "RunnerAuthority" },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "Note",
      fields: [{ name: "Title", type: "text", required: true }],
      sync: { mode: "localFirst", scope: "all", conflict: "serverWins" },
    },
  ],
  policies: [
    {
      name: "NotePolicy",
      object: "Note",
      rules: [
        {
          name: "allowAuthenticatedNote",
          effect: "allow",
          principal: { match: "authenticated" },
          action: "*",
        },
      ],
    },
  ],
};

const gigV100: PartialApplicationModel = {
  modelVersion: "1.0.0",
  app: { name: "RunnerGig" },
  objects: [{ name: "Gig", fields: [{ name: "Venue", type: "text" }] }],
};

const gigV110: PartialApplicationModel = {
  modelVersion: "1.1.0",
  app: { name: "RunnerGig" },
  objects: [{ name: "Gig", schemaVersion: 2, fields: [{ name: "VenueName", type: "text" }] }],
  migrations: [
    {
      from: "1.0.0",
      to: "1.1.0",
      objects: [
        {
          object: "Gig",
          schemaVersion: 2,
          steps: [{ kind: "renameField", from: "Venue", to: "VenueName" }],
        },
      ],
    },
  ],
};

const legacyGigRecord = {
  objectName: "Gig",
  record: {
    meta: {
      guid: "gig-legacy",
      object: "Gig",
      schemaVersion: 1,
      revision: "seed-a",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "seed",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "seed",
      syncStatus: "synced" as const,
    },
    values: { Venue: "The Roxy" },
  },
};

describe("authority setup outcomes", () => {
  const collidingCreate = (
    expect?: "accepted" | "rejected" | "conflict" | "manualResolution",
  ): AuthorityConformanceCase => ({
    id: "runner.authority.setup-outcome",
    title: "A refused seed must not pass unnoticed",
    specRef: "runtime-semantics#crud-and-search",
    operation: "authorityReplay",
    model: authorityModel,
    input: {
      setup: [
        {
          intent: {
            operationId: "op-first",
            kind: "create",
            objectName: "Note",
            recordId: "note-1",
            values: { Title: "Original" },
          },
        },
        {
          ...(expect === undefined ? {} : { expect }),
          intent: {
            operationId: "op-collide",
            kind: "create",
            objectName: "Note",
            recordId: "note-1",
            values: { Title: "Intruder" },
          },
        },
      ],
      intent: {
        operationId: "op-probe",
        kind: "create",
        objectName: "Note",
        recordId: "note-2",
        values: { Title: "Probe" },
      },
    },
    expected: { ok: true, result: { status: "accepted" } },
  });

  it("fails a case whose seed was refused without saying so", async () => {
    const result = await runConformanceCase(collidingCreate());

    expect(result.pass).toBe(false);
    expect(JSON.stringify(result.actual)).toContain("was 'rejected', expected 'accepted'");
  });

  it("passes once the case declares that it is deliberately seeding a refusal", async () => {
    const result = await runConformanceCase(collidingCreate("rejected"));

    expect(result.pass).toBe(true);
  });

  it("fails a case that declares the wrong seeded status", async () => {
    const result = await runConformanceCase(collidingCreate("conflict"));

    expect(result.pass).toBe(false);
  });
});

describe("authority setup aliases", () => {
  const updateWith = (baseRevision: unknown): AuthorityConformanceCase => ({
    id: "runner.authority.base-revision",
    title: "A successful update needs the record's current revision",
    specRef: "runtime-semantics#crud-and-search",
    operation: "authorityReplay",
    model: authorityModel,
    input: {
      setup: [
        {
          alias: "seeded",
          intent: {
            operationId: "op-create",
            kind: "create",
            objectName: "Note",
            recordId: "note-1",
            values: { Title: "Before" },
          },
        },
      ],
      intent: {
        operationId: "op-update",
        kind: "update",
        objectName: "Note",
        recordId: "note-1",
        patch: { Title: "After" },
        baseRevision,
      } as AuthorityConformanceCase["input"]["intent"],
    },
    expected: {
      ok: true,
      result: {
        status: "accepted",
        records: [{ object: "Note", recordId: "note-1", values: { Title: "After" } }],
      },
    },
  });

  it("resolves a seeded outcome's revision without the case naming its format", async () => {
    const result = await runConformanceCase(updateWith({ $ref: "seeded.records.0.meta.revision" }));

    expect(result.pass).toBe(true);
  });

  it("still conflicts when the base revision is not the current one", async () => {
    // Proves the $ref above resolved to something real: an unresolved ref would
    // land here too, so the accepted case is only meaningful next to this one.
    const result = await runConformanceCase(updateWith("not-the-current-revision"));

    expect(result.pass).toBe(false);
    expect(JSON.stringify(result.actual)).toContain("conflict");
  });
});

describe("syncWrite", () => {
  const write = (
    objectName: string,
    queue: Array<Record<string, string>>,
  ): RuntimeConformanceCase => ({
    id: `runner.syncwrite.${objectName}`,
    title: "A local write, its decision, and the queue it left behind",
    specRef: "runtime-semantics#sync-modes",
    operation: "syncWrite",
    model: syncModel,
    input: {
      objectName,
      write: "create",
      values: { Name: "Item" },
      context: adminContext,
    },
    expected: {
      ok: true,
      result: {
        decision: {
          allowed: true,
          mode: objectName === "LocalFirstItem" ? "localFirst" : "localPrivate",
        },
        write: { status: "written" },
        queue,
      },
    },
  });

  it("shows a localFirst write in the sync queue", async () => {
    const result = await runConformanceCase(
      write("LocalFirstItem", [{ objectName: "LocalFirstItem", operation: "create" }]),
    );

    expect(result.pass).toBe(true);
  });

  it("shows a localPrivate write leaving the queue empty", async () => {
    const result = await runConformanceCase(write("LocalPrivateItem", []));

    expect(result.pass).toBe(true);
  });

  it("fails a localFirst write asserted to leave the queue empty", async () => {
    // This is the discrimination that makes localPrivate contractual: a runtime
    // implementing it as an alias for localFirst fails exactly here.
    const result = await runConformanceCase(write("LocalFirstItem", []));

    expect(result.pass).toBe(false);
  });

  it("reports a refused write and the queue it did not grow", async () => {
    const result = await runConformanceCase({
      id: "runner.syncwrite.cache-readonly",
      title: "A cacheReadonly write is refused and queues nothing",
      specRef: "runtime-semantics#sync-modes",
      operation: "syncWrite",
      model: syncModel,
      input: {
        objectName: "CacheReadonlyItem",
        write: "create",
        values: { Name: "Item" },
        context: adminContext,
      },
      expected: {
        ok: true,
        result: {
          decision: { allowed: false, mode: "cacheReadonly", readonly: true, queueable: false },
          write: { status: "refused", code: "ADL_SYNC_POLICY_DENIED" },
          queue: [],
        },
      },
    });

    expect(result.pass).toBe(true);
  });
});

describe("literal record seeding and the delete setup step", () => {
  const cacheReadonlySeed = {
    objectName: "CacheReadonlyItem",
    record: {
      meta: {
        guid: "cached-1",
        object: "CacheReadonlyItem",
        schemaVersion: 1,
        revision: "seed-a",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "seed",
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "seed",
        syncStatus: "synced" as const,
      },
      values: { Name: "Cached" },
    },
  };

  it("reads a record no write path could have created", async () => {
    const result = await runConformanceCase({
      id: "runner.records.cache-readonly-read",
      title: "cacheReadonly records are readable once seeded",
      specRef: "runtime-semantics#sync-modes",
      operation: "read",
      model: syncModel,
      records: [cacheReadonlySeed],
      input: { objectName: "CacheReadonlyItem", id: "cached-1", context: adminContext },
      expected: {
        ok: true,
        result: { objectName: "CacheReadonlyItem", values: { Name: "Cached" } },
      },
    });

    expect(result.pass).toBe(true);
  });

  it("returns nothing for the same read without the seed", async () => {
    const result = await runConformanceCase({
      id: "runner.records.cache-readonly-unseeded",
      title: "The seed is what makes the record present",
      specRef: "runtime-semantics#sync-modes",
      operation: "read",
      model: syncModel,
      input: { objectName: "CacheReadonlyItem", id: "cached-1", context: adminContext },
      expected: { ok: true, result: { values: { Name: "Cached" } } },
    });

    expect(result.pass).toBe(false);
  });

  it("seeds a tombstone through the delete step and shows it in storage", async () => {
    const result = await runConformanceCase({
      id: "runner.setup.delete-step",
      title: "A deleted record is a tombstone in storage",
      specRef: "runtime-semantics#crud-and-search",
      operation: "readPersistedRecords",
      model: syncModel,
      setup: [
        {
          operation: "create",
          alias: "doomed",
          objectName: "LocalFirstItem",
          values: { Name: "Doomed" },
          context: adminContext,
        },
        {
          operation: "delete",
          objectName: "LocalFirstItem",
          id: { $ref: "doomed.meta.guid" },
          context: adminContext,
        },
      ],
      input: { context: adminContext },
      expected: {
        ok: true,
        result: {
          records: [{ objectName: "LocalFirstItem", recordId: "$doomed", deleted: true }],
        },
      },
    });

    expect(result.pass).toBe(true);
  });

  it("fails when the same record is asserted to be live", async () => {
    const result = await runConformanceCase({
      id: "runner.setup.delete-step-discriminates",
      title: "The tombstone flag is not decorative",
      specRef: "runtime-semantics#crud-and-search",
      operation: "readPersistedRecords",
      model: syncModel,
      setup: [
        {
          operation: "create",
          alias: "doomed",
          objectName: "LocalFirstItem",
          values: { Name: "Doomed" },
          context: adminContext,
        },
        {
          operation: "delete",
          objectName: "LocalFirstItem",
          id: { $ref: "doomed.meta.guid" },
          context: adminContext,
        },
      ],
      input: { context: adminContext },
      expected: {
        ok: true,
        result: { records: [{ objectName: "LocalFirstItem", deleted: false }] },
      },
    });

    expect(result.pass).toBe(false);
  });
});

describe("migration storage selection", () => {
  const migrationCase = (
    storage: ModelMigrationConformanceCase["input"]["storage"],
  ): ModelMigrationConformanceCase => ({
    id: `runner.migration.${storage ?? "default"}`,
    title: "A migration over the selected storage behaviour",
    specRef: "runtime-semantics#model-migration",
    operation: "migratePersistedState",
    model: gigV110,
    input: {
      persistedModel: gigV100,
      records: [legacyGigRecord],
      applyMigrations: true,
      ...(storage === undefined ? {} : { storage }),
    },
    expected: {
      ok: true,
      result: {
        diagnostics: [{ severity: "info", code: "ADL_MODEL_MIGRATION_APPLIED" }],
        metadata: { modelVersion: "1.1.0" },
        records: [{ objectName: "Gig", schemaVersion: 2, values: { VenueName: "The Roxy" } }],
      },
    },
  });

  it("migrates over the default transactional backend", async () => {
    const result = await runConformanceCase(migrationCase(undefined));

    expect(result.pass).toBe(true);
  });

  it("refuses and leaves state untouched when the commit fails", async () => {
    const result = await runConformanceCase(migrationCase("failingCommit"));

    expect(result.pass).toBe(false);
    expect(result.actual.ok).toBe(false);
    expect(JSON.stringify(result.actual)).toContain("ADL_MIGRATION_FAILED");
    // The fail-closed half: the legacy field is still there under the old name.
    expect(JSON.stringify(result.actual)).toContain("The Roxy");
    expect(JSON.stringify(result.actual)).toContain('"Venue"');
  });

  it("refuses a backend that cannot commit atomically", async () => {
    const result = await runConformanceCase(migrationCase("nonTransactional"));

    expect(result.pass).toBe(false);
    expect(result.actual.ok).toBe(false);
    expect(JSON.stringify(result.actual)).toContain("ADL_MIGRATION_FAILED");
  });
});
