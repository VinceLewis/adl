import { describe, expect, it } from "vitest";
import { runConformanceCase } from "../src/index.js";
import type {
  AuthorityConformanceCase,
  JsonValue,
  ModelMigrationConformanceCase,
  PartialApplicationModel,
  RuntimeConformanceCase,
  SyncReconcileConformanceCase,
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

/**
 * Two commands over the same objects: one whose steps are queueable, one whose
 * single step is refused before it commits. `syncWrite` performs only
 * create/update/delete/transition, so neither the one-entry guarantee nor the
 * "a refused command queues nothing" guarantee had any way into the corpus.
 */
const commandSyncModel: PartialApplicationModel = {
  app: { name: "RunnerCommandSync" },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "Item",
      fields: [{ name: "Name", type: "text", required: true }],
      sync: { mode: "localFirst", scope: "all" },
    },
    {
      name: "Locked",
      fields: [{ name: "Name", type: "text", required: true }],
      sync: { mode: "cacheReadonly", scope: "all" },
    },
  ],
  commands: [
    {
      name: "PairItems",
      label: "Pair two items",
      inputs: [{ name: "Name", type: "text", required: true }],
      steps: [
        {
          name: "first",
          action: "create",
          object: "Item",
          values: { Name: { kind: "input", name: "Name" } },
        },
        {
          name: "second",
          action: "create",
          object: "Item",
          values: { Name: { kind: "literal", value: "Second" } },
        },
      ],
    },
    {
      name: "WriteLocked",
      label: "Write a cached record",
      inputs: [{ name: "Name", type: "text", required: true }],
      steps: [
        {
          name: "lock",
          action: "create",
          object: "Locked",
          values: { Name: { kind: "input", name: "Name" } },
        },
      ],
    },
  ],
  policies: ["Item", "Locked"].map((objectName) => ({
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

describe("syncCommand", () => {
  const pairItems = (queue: JsonValue[]): RuntimeConformanceCase => ({
    id: "runner.synccommand.pair-items",
    title: "A locally executed command and the queue it left behind",
    specRef: "runtime-semantics#command-replay",
    operation: "syncCommand",
    model: commandSyncModel,
    input: { commandName: "PairItems", input: { Name: "First" }, context: adminContext },
    expected: {
      ok: true,
      result: {
        command: "PairItems",
        execution: {
          status: "executed",
          steps: [
            { step: "first", objectName: "Item", recordId: "$first" },
            { step: "second", objectName: "Item", recordId: "$second" },
          ],
        },
        queue,
      },
    },
  });

  const oneCommandEntry = [
    {
      objectName: "Item",
      operation: "command",
      recordId: "$first",
      mode: "localFirst",
      command: {
        name: "PairItems",
        input: { Name: "First" },
        recordIds: [
          { step: "first", objectName: "Item", recordId: "$first" },
          { step: "second", objectName: "Item", recordId: "$second" },
        ],
        records: [
          { objectName: "Item", recordId: "$first" },
          { objectName: "Item", recordId: "$second" },
        ],
      },
    },
  ];

  it("reports a command as one queue entry naming every record it wrote", async () => {
    const result = await runConformanceCase(pairItems(oneCommandEntry));

    expect(result.pass).toBe(true);
  });

  it("fails the same command asserted to have queued its steps separately", async () => {
    // The discrimination that makes the one-entry guarantee contractual: a
    // runtime that queued a command's writes individually — the shape that loses
    // the transaction across the sync boundary — fails exactly here.
    const result = await runConformanceCase(
      pairItems([
        { objectName: "Item", operation: "create" },
        { objectName: "Item", operation: "create" },
      ]),
    );

    expect(result.pass).toBe(false);
  });

  it("fails a command entry asserted to carry no command", async () => {
    const result = await runConformanceCase(
      pairItems([{ objectName: "Item", operation: "command", command: "$absent" }]),
    );

    expect(result.pass).toBe(false);
  });

  it("fails a manifest whose ids name the wrong steps", async () => {
    // Without this, "recordIds are reported" would be satisfied by any two ids
    // in any order, and the manifest's whole purpose is that order.
    const result = await runConformanceCase(
      pairItems([
        {
          objectName: "Item",
          operation: "command",
          command: {
            recordIds: [
              { step: "first", objectName: "Item", recordId: "$second" },
              { step: "second", objectName: "Item", recordId: "$first" },
            ],
          },
        },
      ]),
    );

    expect(result.pass).toBe(false);
  });

  it("fails an ordinary create asserted to carry a command", async () => {
    const result = await runConformanceCase({
      id: "runner.synccommand.ordinary-create",
      title: "A direct create is not a command",
      specRef: "runtime-semantics#command-replay",
      operation: "syncWrite",
      model: commandSyncModel,
      input: {
        objectName: "Item",
        write: "create",
        values: { Name: "First" },
        context: adminContext,
      },
      expected: {
        ok: true,
        result: {
          queue: [{ objectName: "Item", operation: "command", command: { name: "PairItems" } }],
        },
      },
    });

    expect(result.pass).toBe(false);
  });

  const refusedCommand = (execution: Record<string, string>): RuntimeConformanceCase => ({
    id: "runner.synccommand.refused",
    title: "A command refused before it commits queues nothing",
    specRef: "runtime-semantics#command-replay",
    operation: "syncCommand",
    model: commandSyncModel,
    input: { commandName: "WriteLocked", input: { Name: "Nope" }, context: adminContext },
    expected: { ok: true, result: { command: "WriteLocked", execution, queue: [] } },
  });

  it("reports a refused command and the queue it did not grow", async () => {
    const result = await runConformanceCase(
      refusedCommand({ status: "refused", code: "ADL_SYNC_POLICY_DENIED" }),
    );

    expect(result.pass).toBe(true);
  });

  it("fails the same refusal asserted to have executed", async () => {
    const result = await runConformanceCase(refusedCommand({ status: "executed" }));

    expect(result.pass).toBe(false);
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

/**
 * The Phase 58 runner extension, shown to discriminate on each claim it exists
 * to make.
 *
 * `syncReconcile` is the first operation that joins the queue to the wire, so
 * everything it reports is new to the corpus: which records a verdict settles,
 * whether an entry survives it, and what a resubmission clears. Each is
 * exercised once where it must pass and once where it must fail — an assertion
 * about a record's sync state that cannot fail would read as coverage for
 * exactly the field this phase exists because nothing was writing.
 */
const recordSyncModel: PartialApplicationModel = {
  app: { name: "RunnerRecordSync" },
  objects: [
    {
      name: "Note",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      constraints: [{ name: "UniqueNoteTitle", kind: "unique" as const, fields: ["Title"] }],
      sync: { mode: "localFirst", scope: "all", conflict: "serverWins" },
    },
    {
      name: "Tag",
      displayField: "Label",
      fields: [
        {
          name: "Note",
          type: "text",
          required: true,
          lookup: { targetObject: "Note", displayField: "Title" },
        },
        { name: "Label", type: "text", required: true },
      ],
      sync: { mode: "localFirst", scope: "all" },
    },
    {
      name: "Draft",
      displayField: "Title",
      fields: [{ name: "Title", type: "text", required: true }],
      sync: { mode: "localPrivate", scope: "all" },
    },
  ],
  commands: [
    {
      name: "FileNote",
      label: "File a note",
      inputs: [{ name: "Title", type: "text", required: true }],
      steps: [
        {
          name: "createNote",
          action: "create",
          object: "Note",
          values: { Title: { kind: "input", name: "Title" } },
        },
        {
          name: "createTag",
          action: "create",
          object: "Tag",
          values: {
            Note: { kind: "stepMeta", step: "createNote", property: "guid" },
            Label: { kind: "literal", value: "filed" },
          },
        },
      ],
    },
  ],
  policies: ["Note", "Tag", "Draft"].map((objectName) => ({
    name: `${objectName}Policy`,
    object: objectName,
    rules: [
      {
        name: `allowAuthenticated${objectName}`,
        effect: "allow" as const,
        principal: { match: "authenticated" as const },
        action: "*" as const,
      },
    ],
  })),
};

const deviceContext = { userId: "user-1", roles: [], channel: "ui" as const, online: true };

describe("syncReconcile", () => {
  const refusedCommand = (result: JsonValue): SyncReconcileConformanceCase => ({
    id: "runner.syncreconcile.refused-command",
    title: "A command the authority refuses, and what it left on the device",
    specRef: "runtime-semantics#what-a-verdict-covers",
    operation: "syncReconcile",
    model: recordSyncModel,
    input: {
      authoritySetup: [
        {
          intent: {
            operationId: "op-seed-note",
            kind: "create",
            objectName: "Note",
            recordId: "note-existing",
            values: { Title: "Set list" },
          },
        },
      ],
      device: [
        {
          operation: "executeCommand",
          commandName: "FileNote",
          input: { Title: "Set list" },
          context: deviceContext,
        },
      ],
      context: deviceContext,
    },
    expected: { ok: true, result },
  });

  const bothRejected = {
    outcomes: [{ status: "rejected", code: "ADL_RUNTIME_VALIDATION_FAILED" }],
    records: [
      { objectName: "Note", recordId: "$createNote", syncStatus: "rejected" },
      { objectName: "Tag", recordId: "$createTag", syncStatus: "rejected" },
    ],
  };

  it("settles every record a refused command wrote", async () => {
    const result = await runConformanceCase(refusedCommand(bothRejected as unknown as JsonValue));

    expect(result.pass).toBe(true);
  });

  it("fails the same refusal asserted to have settled only the record its entry names", async () => {
    // The discrimination the phase turns on: a runtime that marked only the
    // record its queue entry is filed under — the shape that leaves a refused
    // command's other rows indistinguishable from unsent work — fails here.
    const result = await runConformanceCase(
      refusedCommand({
        records: [
          { objectName: "Note", recordId: "$createNote", syncStatus: "rejected" },
          { objectName: "Tag", recordId: "$createTag", syncStatus: "pending" },
        ],
      } as unknown as JsonValue),
    );

    expect(result.pass).toBe(false);
  });

  it("fails a refused entry asserted to have left the queue", async () => {
    const result = await runConformanceCase(refusedCommand({ queue: [] } as unknown as JsonValue));

    expect(result.pass).toBe(false);
  });

  const conflicted = (
    resolve: SyncReconcileConformanceCase["input"]["resolve"],
    result: JsonValue,
  ): SyncReconcileConformanceCase => ({
    id: "runner.syncreconcile.conflict",
    title: "A queued update the authority answers with a conflict",
    specRef: "runtime-semantics#record-sync-state",
    operation: "syncReconcile",
    model: recordSyncModel,
    input: {
      authoritySetup: [
        {
          alias: "seeded",
          intent: {
            operationId: "op-seed-note",
            kind: "create",
            objectName: "Note",
            recordId: "note-1",
            values: { Title: "Original" },
          },
        },
      ],
      deviceBootstrap: true,
      device: [
        {
          operation: "update",
          objectName: "Note",
          id: "note-1",
          patch: { Title: "Device edit" },
          context: deviceContext,
        },
      ],
      concurrent: [
        {
          intent: {
            operationId: "op-other-client",
            kind: "update",
            objectName: "Note",
            recordId: "note-1",
            patch: { Title: "Server edit" },
            // A `$ref` stands in for the revision the seed produced; the runner
            // resolves it before the intent reaches the authority.
            baseRevision: { $ref: "seeded.records.0.meta.revision" },
          } as unknown as AuthorityConformanceCase["input"]["intent"],
        },
      ],
      ...(resolve === undefined ? {} : { resolve }),
      context: deviceContext,
    },
    expected: { ok: true, result },
  });

  it("leaves a conflicted record in conflict, with the entry holding the verdict", async () => {
    const result = await runConformanceCase(
      conflicted(undefined, {
        outcomes: [{ status: "conflict", code: "ADL_SYNC_CONFLICT" }],
        queue: [{ recovery: { status: "conflict", strategy: "serverWins" } }],
        records: [{ recordId: "note-1", syncStatus: "conflict" }],
      } as unknown as JsonValue),
    );

    expect(result.pass).toBe(true);
  });

  it("fails the same conflict asserted to have left the record pending", async () => {
    // Without this, "the record is in conflict" would be satisfied by a runtime
    // that recorded nothing at all and left the write looking unsent.
    const result = await runConformanceCase(
      conflicted(undefined, {
        records: [{ recordId: "note-1", syncStatus: "pending" }],
      } as unknown as JsonValue),
    );

    expect(result.pass).toBe(false);
  });

  it("clears the verdict when the resubmission is accepted", async () => {
    const result = await runConformanceCase(
      conflicted("resubmitMine", {
        outcomes: [{ status: "conflict" }, { status: "accepted" }],
        queue: [],
        records: [{ recordId: "note-1", syncStatus: "synced", values: { Title: "Device edit" } }],
      } as unknown as JsonValue),
    );

    expect(result.pass).toBe(true);
  });

  it("fails that resubmission asserted to leave the earlier verdict behind", async () => {
    const result = await runConformanceCase(
      conflicted("resubmitMine", {
        records: [{ recordId: "note-1", syncStatus: "conflict" }],
      } as unknown as JsonValue),
    );

    expect(result.pass).toBe(false);
  });
});

describe("persisted sync state", () => {
  const persisted = (objectName: string, syncStatus: string): RuntimeConformanceCase => ({
    id: `runner.persisted.${objectName}`,
    title: "The sync state a local write leaves on the record in storage",
    specRef: "runtime-semantics#record-sync-state",
    operation: "readPersistedRecords",
    model: recordSyncModel,
    setup: [
      {
        operation: "create",
        alias: "written",
        objectName,
        values: { Title: "Set list" },
        context: deviceContext,
      },
    ],
    input: { context: deviceContext },
    expected: { ok: true, result: { records: [{ objectName, syncStatus }] } },
  });

  it("reports a queued write as pending", async () => {
    const result = await runConformanceCase(persisted("Note", "pending"));

    expect(result.pass).toBe(true);
  });

  it("reports a write with no delivery path as local", async () => {
    const result = await runConformanceCase(persisted("Draft", "local"));

    expect(result.pass).toBe(true);
  });

  it("fails a queued write asserted to be local", async () => {
    // The two states differ in exactly one observable way, and it is this one: a
    // runtime that wrote `local` for everything — the behaviour before this
    // phase — passes the second case above and fails here.
    const result = await runConformanceCase(persisted("Note", "local"));

    expect(result.pass).toBe(false);
  });
});
