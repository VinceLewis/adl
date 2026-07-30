import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  InMemoryObjectStorageBackend,
  MODEL_MIGRATION_CODES,
  ParseError,
  RUNTIME_STARTUP_COMPATIBILITY_CODES,
  RuntimeStartupError,
  compareModelVersions,
  compileAdl,
  isValidModelVersion,
  migratePersistedRecords,
  migrateStoredRecord,
  migrateSyncState,
  noopRuntimeLogger,
  planModelMigration,
  resolveApplicationModel,
  runRuntimeStartupCompatibilityChecks,
  validateApplicationModel,
} from "../src/index.js";
import type {
  JsonValue,
  LocalOperation,
  ModelMigrationPlan,
  ObjectStorageBackend,
  ObjectStorageSearchRequest,
  PartialApplicationModel,
  PartialModelMigrationModel,
  PersistedApplicationMetadata,
  PersistedObjectRecord,
  PersistedSyncState,
  ResolvedApplicationModel,
  ResolvedModelMigrationStep,
  RuntimeContext,
  StoredObjectRecord,
  SyncQueueEntry,
} from "../src/index.js";

const fixedNow = new Date("2026-07-07T08:00:00.000Z");

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: fixedNow,
};

const STALE_FINGERPRINT = "sha256-0000000000000000000000000000000000000000000000000000000000000000";

const COMMIT_FAILURE_DETAIL = "connection to db.internal:5432 lost while writing gig-1";

describe("MIGRATION declarations", () => {
  it("compiles APP MODEL_VERSION and a MIGRATION block into the partial and resolved model", () => {
    const result = compileAdl(migrationAdlSource());

    expect(result.partialModel.modelVersion).toBe("1.1.0");
    expect(result.partialModel.migrations).toEqual([
      {
        from: "1.0.0",
        to: "1.1.0",
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
    ]);
    // A declared version wins over the platform default, which is the whole
    // point of the directive: without it a content change stays invisible.
    expect(result.model.modelVersion).toBe("1.1.0");
    expect(result.model.migrations).toEqual(result.partialModel.migrations);
  });

  it("compiles a field-only MIGRATION with no diagnostics at all", () => {
    const result = compileAdl(
      migrationAdlSource({
        declareSchemaVersion: false,
        steps: [
          "    RENAME FIELD Venue TO VenueName",
          "    ADD FIELD PayoutCents DEFAULT 0",
          "    DROP FIELD LegacyNote",
        ],
      }),
    );

    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);
    expect(result.model.migrations[0]?.objects[0]).toEqual({
      object: "Gig",
      steps: [
        { kind: "renameField", from: "Venue", to: "VenueName" },
        { kind: "addField", field: "PayoutCents", defaultValue: 0 },
        { kind: "dropField", field: "LegacyNote" },
      ],
    });
  });

  it("carries the declared migration through to a fingerprinted resolved model", () => {
    const result = compileAdl(migrationAdlSource({ declareSchemaVersion: false }));

    expect(result.model.modelFingerprint).toMatch(/^sha256-[0-9a-f]{64}$/u);
    expect(planModelMigration(result.model, "1.0.0")).toMatchObject({
      status: "migrate",
      plan: { from: "1.0.0", to: "1.1.0" },
    });
  });

  it("preserves the order in which steps were declared", () => {
    const result = compileAdl(
      migrationAdlSource({
        steps: [
          "    DROP FIELD LegacyNote",
          "    RENAME FIELD Venue TO VenueName",
          "    ADD FIELD PayoutCents DEFAULT 0",
        ],
      }),
    );

    expect(result.model.migrations[0]?.objects[0]?.steps.map((step) => step.kind)).toEqual([
      "dropField",
      "renameField",
      "addField",
    ]);
  });

  it("refuses ADD FIELD without a DEFAULT", () => {
    // A record that silently gained `null` where the model says the field is
    // required would fail validation on its next write, so the default is part
    // of the syntax rather than an option.
    const source = migrationAdlSource({ steps: ["    ADD FIELD PayoutCents"] });

    expect(() => compileAdl(source)).toThrow(ParseError);
    expect(() => compileAdl(source)).toThrow(/DEFAULT/u);
  });

  it("refuses RENAME FIELD without a target", () => {
    expect(() => compileAdl(migrationAdlSource({ steps: ["    RENAME FIELD Venue"] }))).toThrow(
      ParseError,
    );
  });

  it("refuses an unknown MIGRATION OBJECT directive", () => {
    expect(() => compileAdl(migrationAdlSource({ steps: ["    ALTER FIELD Venue"] }))).toThrow(
      ParseError,
    );
  });

  it("refuses a MIGRATION that is never closed", () => {
    expect(() => compileAdl(migrationAdlSource().replace("END.MIGRATION", ""))).toThrow(ParseError);
  });
});

describe("compareModelVersions", () => {
  it("treats missing components as zero, so '1.2' and '1.2.0' are the same version", () => {
    expect(compareModelVersions("1.2", "1.2.0")).toBe(0);
    expect(compareModelVersions("1.2.0", "1.2")).toBe(0);
    expect(compareModelVersions("1", "1.0.0.0")).toBe(0);
  });

  it("orders component-wise rather than lexically", () => {
    // Lexically "1.10.0" precedes "1.9.0"; numerically it does not.
    expect(compareModelVersions("1.9.0", "1.10.0")).toBeLessThan(0);
    expect(compareModelVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareModelVersions("2.0.0", "10.0.0")).toBeLessThan(0);
  });

  it("orders a major bump ahead of any minor or patch", () => {
    expect(compareModelVersions("1.99.99", "2")).toBeLessThan(0);
    expect(compareModelVersions("2", "1.99.99")).toBeGreaterThan(0);
  });

  it("sorts a release history into ascending order", () => {
    const sorted = ["2.0.0", "1.0.0", "1.10.0", "1.2", "1.2.1", "1.9.0"].sort(compareModelVersions);

    expect(sorted).toEqual(["1.0.0", "1.2", "1.2.1", "1.9.0", "1.10.0", "2.0.0"]);
  });

  it("accepts one to four dotted numeric components and nothing else", () => {
    expect(isValidModelVersion("1")).toBe(true);
    expect(isValidModelVersion("1.2.3.4")).toBe(true);
    expect(isValidModelVersion("1.2.3.4.5")).toBe(false);
    expect(isValidModelVersion("1.2.3-beta")).toBe(false);
    expect(isValidModelVersion("v1.2.3")).toBe(false);
    expect(isValidModelVersion("")).toBe(false);
    expect(isValidModelVersion(1.2)).toBe(false);
    expect(isValidModelVersion(undefined)).toBe(false);
  });
});

describe("planModelMigration", () => {
  it("reports persisted state at the model's own version as current", () => {
    expect(planModelMigration(createMigrationModel(), "1.1.0")).toEqual({ status: "current" });
  });

  it("plans a single hop", () => {
    const model = createMigrationModel();
    const planned = planModelMigration(model, "1.0.0");

    expect(planned.status).toBe("migrate");
    expect(requirePlan(planned)).toEqual({
      from: "1.0.0",
      to: "1.1.0",
      steps: model.migrations,
    });
  });

  it("chains multiple hops in order", () => {
    const model = createMigrationModel({
      modelVersion: "3.0.0",
      migrations: [
        renameMigration("1.0.0", "2.0.0", "Venue", "Place"),
        renameMigration("2.0.0", "3.0.0", "Place", "VenueName"),
      ],
    });

    const plan = requirePlan(planModelMigration(model, "1.0.0"));

    expect(plan.from).toBe("1.0.0");
    expect(plan.to).toBe("3.0.0");
    expect(plan.steps.map((step) => `${step.from}->${step.to}`)).toEqual([
      "1.0.0->2.0.0",
      "2.0.0->3.0.0",
    ]);
  });

  it("chooses the shortest route when a model declares two", () => {
    // The long way round is declared first, so a declaration-order walk would
    // take it and rename the same field twice. Breadth-first takes the direct hop.
    const model = createMigrationModel({
      modelVersion: "3.0.0",
      migrations: [
        renameMigration("1.0.0", "2.0.0", "Venue", "Place"),
        renameMigration("2.0.0", "3.0.0", "Place", "VenueName"),
        renameMigration("1.0.0", "3.0.0", "Venue", "VenueName"),
      ],
    });

    const plan = requirePlan(planModelMigration(model, "1.0.0"));

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ from: "1.0.0", to: "3.0.0" });

    const migrated = migrateStoredRecord(
      createGigRecord({ values: { Title: "Opening night", Venue: "The Fillmore" } }),
      "Gig",
      plan,
    );

    expect(migrated?.values).toEqual({ Title: "Opening night", VenueName: "The Fillmore" });
  });

  it("still reaches the model when only the long route is declared", () => {
    const model = createMigrationModel({
      modelVersion: "3.0.0",
      migrations: [
        renameMigration("2.0.0", "3.0.0", "Place", "VenueName"),
        renameMigration("1.0.0", "2.0.0", "Venue", "Place"),
      ],
    });

    expect(requirePlan(planModelMigration(model, "1.0.0")).steps).toHaveLength(2);
  });

  it("refuses a persisted version no declared chain reaches, without destroying anything", () => {
    const planned = planModelMigration(createMigrationModel(), "0.9.0");

    expect(planned).toEqual({
      status: "refused",
      diagnostic: {
        severity: "error",
        code: MODEL_MIGRATION_CODES.VERSION_UNREACHABLE,
        message: expect.stringContaining("no declared migration reaches it"),
        path: "metadata.modelVersion",
        expected: "1.1.0",
        actual: "0.9.0",
      },
    });
  });

  it("refuses a partial chain that stops short of the model's version", () => {
    const model = createMigrationModel({
      modelVersion: "3.0.0",
      migrations: [renameMigration("1.0.0", "2.0.0", "Venue", "Place")],
    });

    expect(planModelMigration(model, "1.0.0")).toMatchObject({
      status: "refused",
      diagnostic: { code: MODEL_MIGRATION_CODES.VERSION_UNREACHABLE },
    });
  });

  it("refuses when the model declares no migrations at all", () => {
    const model = createMigrationModel({ migrations: [] });

    expect(planModelMigration(model, "1.0.0")).toMatchObject({
      status: "refused",
      diagnostic: { code: MODEL_MIGRATION_CODES.VERSION_UNREACHABLE },
    });
  });

  it("refuses persisted state that is ahead of this model", () => {
    // An older process silently reading newer records is how a downgrade
    // destroys data it does not understand.
    const planned = planModelMigration(createMigrationModel(), "2.0.0");

    expect(planned).toEqual({
      status: "refused",
      diagnostic: {
        severity: "error",
        code: MODEL_MIGRATION_CODES.PERSISTED_AHEAD,
        message: expect.stringContaining("later than this application's version"),
        path: "metadata.modelVersion",
        expected: "1.1.0",
        actual: "2.0.0",
      },
    });
  });

  it("refuses a version ahead even when a migration away from it is declared", () => {
    const model = createMigrationModel({
      migrations: [renameMigration("2.0.0", "1.1.0", "VenueName", "Venue")],
    });

    expect(planModelMigration(model, "2.0.0")).toMatchObject({
      status: "refused",
      diagnostic: { code: MODEL_MIGRATION_CODES.PERSISTED_AHEAD },
    });
  });

  it("is a pure decision that reads no storage and rewrites nothing", () => {
    const model = createMigrationModel();

    expect(planModelMigration(model, "1.0.0")).toEqual(planModelMigration(model, "1.0.0"));
    expect(model.migrations).toHaveLength(1);
  });
});

describe("migrateStoredRecord", () => {
  it("carries a renamed field's value and keeps field order stable", () => {
    const record = createGigRecord({
      values: { Title: "Opening night", Venue: "The Fillmore", Notes: "Load in at 17:00" },
    });

    const migrated = migrateStoredRecord(record, "Gig", singleHopPlan([renameStep()]));

    expect(migrated?.values).toEqual({
      Title: "Opening night",
      VenueName: "The Fillmore",
      Notes: "Load in at 17:00",
    });
    // Rebuilt in order rather than deleted and re-added, so the canonical form
    // of a record stays stable across a rename.
    expect(Object.keys(migrated?.values ?? {})).toEqual(["Title", "VenueName", "Notes"]);
  });

  it("leaves a record without the renamed field alone", () => {
    const record = createGigRecord({ values: { Title: "Opening night" } });

    expect(migrateStoredRecord(record, "Gig", singleHopPlan([renameStep()]))).toBeUndefined();
  });

  it("backfills an added field only where it is absent", () => {
    const plan = singleHopPlan([{ kind: "addField", field: "PayoutCents", defaultValue: 0 }]);
    const withoutField = createGigRecord({ values: { Title: "Opening night" } });
    const withField = createGigRecord({
      guid: "gig-2",
      values: { Title: "Second night", PayoutCents: 150_000 },
    });

    expect(migrateStoredRecord(withoutField, "Gig", plan)?.values).toEqual({
      Title: "Opening night",
      PayoutCents: 0,
    });
    // Already present, so nothing changed at all and the record is not rewritten.
    expect(migrateStoredRecord(withField, "Gig", plan)).toBeUndefined();
  });

  it("gives each backfilled record its own copy of a structured default", () => {
    const plan = singleHopPlan([
      { kind: "addField", field: "Contacts", defaultValue: { primary: null } },
    ]);
    const first = migrateStoredRecord(createGigRecord({ values: { Title: "A" } }), "Gig", plan);
    const second = migrateStoredRecord(
      createGigRecord({ guid: "gig-2", values: { Title: "B" } }),
      "Gig",
      plan,
    );

    expect(first?.values["Contacts"]).toEqual({ primary: null });
    expect(second?.values["Contacts"]).not.toBe(first?.values["Contacts"]);
  });

  it("removes a dropped field", () => {
    const record = createGigRecord({
      values: { Title: "Opening night", LegacyNote: "migrated from the spreadsheet" },
    });

    const migrated = migrateStoredRecord(
      record,
      "Gig",
      singleHopPlan([{ kind: "dropField", field: "LegacyNote" }]),
    );

    expect(migrated?.values).toEqual({ Title: "Opening night" });
    expect(migrated?.values).not.toHaveProperty("LegacyNote");
  });

  it("bumps the record's schema version when the hop declares one", () => {
    const record = createGigRecord({ values: { Title: "Opening night", Venue: "The Fillmore" } });

    const migrated = migrateStoredRecord(record, "Gig", singleHopPlan([renameStep()], 2));

    expect(record.meta.schemaVersion).toBe(1);
    expect(migrated?.meta.schemaVersion).toBe(2);
  });

  it("bumps the schema version even when no field step applies", () => {
    const record = createGigRecord({ values: { Title: "Opening night" } });

    expect(
      migrateStoredRecord(record, "Gig", singleHopPlan([renameStep()], 2))?.meta,
    ).toMatchObject({ schemaVersion: 2 });
  });

  it("returns undefined for an object no hop mentions", () => {
    const record = createGigRecord({ values: { Title: "Opening night", Venue: "The Fillmore" } });

    expect(migrateStoredRecord(record, "Note", singleHopPlan([renameStep()], 2))).toBeUndefined();
  });

  it("preserves revision, actors and timestamps, because a migration is nobody's edit", () => {
    const record = createGigRecord({
      values: { Title: "Opening night", Venue: "The Fillmore", LegacyNote: "old" },
    });

    const migrated = migrateStoredRecord(
      record,
      "Gig",
      singleHopPlan(
        [
          renameStep(),
          { kind: "addField", field: "PayoutCents", defaultValue: 0 },
          { kind: "dropField", field: "LegacyNote" },
        ],
        2,
      ),
    );

    expect(migrated?.meta).toEqual({ ...record.meta, schemaVersion: 2 });
    expect(migrated?.meta.revision).toBe(record.meta.revision);
    expect(migrated?.meta.createdBy).toBe("band-seed");
    expect(migrated?.meta.updatedBy).toBe("band-seed");
    expect(migrated?.meta.createdAt).toBe(fixedNow.toISOString());
    expect(migrated?.meta.updatedAt).toBe(fixedNow.toISOString());
    expect(migrated?.meta.syncStatus).toBe(record.meta.syncStatus);
  });

  it("does not mutate the record it was given", () => {
    const record = createGigRecord({ values: { Title: "Opening night", Venue: "The Fillmore" } });

    migrateStoredRecord(record, "Gig", singleHopPlan([renameStep()], 2));

    expect(record.values).toEqual({ Title: "Opening night", Venue: "The Fillmore" });
    expect(record.meta.schemaVersion).toBe(1);
  });

  it("applies every hop of a chain in order", () => {
    const model = createMigrationModel({
      modelVersion: "3.0.0",
      migrations: [
        renameMigration("1.0.0", "2.0.0", "Venue", "Place"),
        renameMigration("2.0.0", "3.0.0", "Place", "VenueName"),
      ],
    });
    const plan = requirePlan(planModelMigration(model, "1.0.0"));

    const migrated = migrateStoredRecord(
      createGigRecord({ values: { Title: "Opening night", Venue: "The Fillmore" } }),
      "Gig",
      plan,
    );

    expect(migrated?.values).toEqual({ Title: "Opening night", VenueName: "The Fillmore" });
  });

  it("returns only the records a plan changed", () => {
    const plan = singleHopPlan([renameStep()], 2);
    const persisted: PersistedObjectRecord[] = [
      {
        objectName: "Gig",
        record: createGigRecord({ values: { Title: "Opening night", Venue: "The Fillmore" } }),
      },
      {
        objectName: "Note",
        record: createGigRecord({ guid: "note-1", object: "Note", values: { Body: "unrelated" } }),
      },
    ];

    const changed = migratePersistedRecords(persisted, plan);

    expect(changed).toHaveLength(1);
    expect(changed[0]?.objectName).toBe("Gig");
    expect(changed[0]?.record.values).toEqual({
      Title: "Opening night",
      VenueName: "The Fillmore",
    });
  });

  it("uses the record's own object metadata to decide which hop applies", () => {
    // Record metadata wins over the store it was found in, matching the startup
    // guard, which reports a disagreement between the two as its own error.
    const changed = migratePersistedRecords(
      [
        {
          objectName: "MisfiledStore",
          record: createGigRecord({ values: { Title: "Opening night", Venue: "The Fillmore" } }),
        },
      ],
      singleHopPlan([renameStep()], 2),
    );

    expect(changed).toHaveLength(1);
    expect(changed[0]?.objectName).toBe("MisfiledStore");
    expect(changed[0]?.record.values).toEqual({
      Title: "Opening night",
      VenueName: "The Fillmore",
    });
  });
});

describe("migrateSyncState", () => {
  const plan = singleHopPlan(
    [
      renameStep(),
      { kind: "addField", field: "PayoutCents", defaultValue: 0 },
      { kind: "dropField", field: "LegacyNote" },
    ],
    2,
  );

  it("renames and drops a pending operation's patch fields", () => {
    const state = createSyncState([
      createLocalOperation({
        patch: { Venue: "The Fillmore", LegacyNote: "old", Title: "Opening night" },
      }),
    ]);

    const migrated = migrateSyncState(state, plan);

    expect(migrated.operations[0]?.patch).toEqual({
      VenueName: "The Fillmore",
      Title: "Opening night",
    });
    expect(migrated.modelVersion).toBe("1.1.0");
  });

  it("does not backfill an added field into a patch", () => {
    // A patch is a set of changes, not a whole record: a default written into it
    // would assert a change the user never made.
    const state = createSyncState([createLocalOperation({ patch: { Venue: "The Fillmore" } })]);

    const migrated = migrateSyncState(state, plan);

    expect(migrated.operations[0]?.patch).toEqual({ VenueName: "The Fillmore" });
    expect(migrated.operations[0]?.patch).not.toHaveProperty("PayoutCents");
  });

  it("returns an operation with no patch unchanged, by identity", () => {
    const operation = createLocalOperation({ opId: "op-delete", operation: "delete" });

    expect(migrateSyncState(createSyncState([operation]), plan).operations[0]).toBe(operation);
  });

  it("returns an operation the plan does not touch unchanged, by identity", () => {
    const operation = createLocalOperation({
      opId: "op-note",
      object: "Note",
      patch: { Body: "unrelated" },
    });

    expect(migrateSyncState(createSyncState([operation]), plan).operations[0]).toBe(operation);
  });

  it("preserves everything about an operation except its patch", () => {
    const operation = createLocalOperation({ patch: { Venue: "The Fillmore" } });
    const migrated = migrateSyncState(createSyncState([operation]), plan).operations[0];

    expect(migrated).toEqual({ ...operation, patch: { VenueName: "The Fillmore" } });
    expect(migrated?.baseRevision).toBe(operation.baseRevision);
    expect(migrated?.status).toBe("pending");
    expect(migrated?.contextSnapshot).toEqual(operation.contextSnapshot);
  });

  it("migrates the patch a queue entry will actually replay to the authority", () => {
    // A queue entry embeds its own copy of the operation, and the queue is what
    // is replayed, so leaving it at the old field names would send the authority
    // a patch naming a field the model no longer has.
    const state = createSyncState([
      createLocalOperation({ patch: { Venue: "The Fillmore", LegacyNote: "old" } }),
    ]);

    const migrated = migrateSyncState(state, plan);

    expect(migrated.queue[0]?.operation.patch).toEqual({ VenueName: "The Fillmore" });
    expect(migrated.queue[0]?.queueId).toBe("queue-op-1");
  });

  it("never adds or removes an operation or a queue entry", () => {
    const operations = [
      createLocalOperation({ patch: { Venue: "The Fillmore" } }),
      createLocalOperation({ opId: "op-2", operation: "delete" }),
      createLocalOperation({ opId: "op-3", object: "Note", patch: { Body: "unrelated" } }),
    ];
    const state = createSyncState(operations);

    const migrated = migrateSyncState(state, plan);

    expect(migrated.operations).toHaveLength(operations.length);
    expect(migrated.operations.map((entry) => entry.opId)).toEqual(
      operations.map((entry) => entry.opId),
    );
    expect(migrated.queue).toHaveLength(state.queue.length);
    expect(migrated.queue.map((entry) => entry.queueId)).toEqual(
      state.queue.map((entry) => entry.queueId),
    );
    expect(migrated.queue.map((entry) => entry.operation.opId)).toEqual(
      operations.map((entry) => entry.opId),
    );
    // No audit event, operation-log entry or queue entry is ever fabricated here.
    expect(migrated.queue.every((entry) => entry.recovery === undefined)).toBe(true);
  });

  it("does not mutate the state it was given", () => {
    const state = createSyncState([createLocalOperation({ patch: { Venue: "The Fillmore" } })]);

    migrateSyncState(state, plan);

    expect(state.modelVersion).toBe("1.0.0");
    expect(state.operations[0]?.patch).toEqual({ Venue: "The Fillmore" });
  });
});

describe("runRuntimeStartupCompatibilityChecks over persisted records", () => {
  it("migrates records and metadata together when a declared path exists", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage);

    const diagnostics = await runRuntimeStartupCompatibilityChecks(
      model,
      storage,
      noopRuntimeLogger,
      { applyMigrations: true },
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "info",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_APPLIED,
        expected: "1.1.0",
        actual: "1.0.0",
      }),
    ]);
    await expect(storage.readApplicationMetadata()).resolves.toEqual({
      modelVersion: "1.1.0",
      modelFingerprint: model.modelFingerprint,
    });
    await expect(storage.read("Gig", "gig-1")).resolves.toEqual({
      meta: expect.objectContaining({ schemaVersion: 2, revision: "rev-seeded" }),
      values: { Title: "Opening night", VenueName: "The Fillmore", PayoutCents: 0 },
    });
  });

  it("refuses a persisted version with no declared path and leaves records and metadata untouched", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage, { modelVersion: "0.9.0" });
    const before = await snapshot(storage);

    const error = await captureStartupError(model, storage);

    expect(error).toBeInstanceOf(RuntimeStartupError);
    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: MODEL_MIGRATION_CODES.VERSION_UNREACHABLE,
        expected: "1.1.0",
        actual: "0.9.0",
      }),
    );
    // Fail closed, never destroy: persisted data outlives the process that
    // could not read it.
    await expect(snapshot(storage)).resolves.toEqual(before);
    expect(JSON.stringify(error.diagnostics)).not.toContain("The Fillmore");
  });

  it("refuses persisted state that is ahead and leaves records and metadata untouched", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage, { modelVersion: "2.5.0" });
    const before = await snapshot(storage);

    const error = await captureStartupError(model, storage);

    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: MODEL_MIGRATION_CODES.PERSISTED_AHEAD,
        expected: "1.1.0",
        actual: "2.5.0",
      }),
    );
    await expect(snapshot(storage)).resolves.toEqual(before);
  });

  it("refuses a stale fingerprint under an unchanged version and leaves everything untouched", async () => {
    // The case that used to pass in silence: the version matches, so no
    // migration can be selected, and none can be assumed unnecessary either.
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await storage.create("Gig", createGigRecord({ schemaVersion: 2, values: { Title: "Night" } }));
    await storage.writeApplicationMetadata({
      modelVersion: "1.1.0",
      modelFingerprint: STALE_FINGERPRINT,
    });
    const before = await snapshot(storage);

    const error = await captureStartupError(model, storage);

    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_FINGERPRINT_STALE,
        path: "metadata.modelFingerprint",
        expected: model.modelFingerprint,
        actual: STALE_FINGERPRINT,
      }),
    );
    await expect(snapshot(storage)).resolves.toEqual(before);
  });

  it("plans without rewriting when applyMigrations is off", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage);
    const before = await snapshot(storage);

    const error = await captureStartupError(model, storage, { applyMigrations: false });

    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_VERSION_MISMATCH,
        expected: "1.1.0",
        actual: "1.0.0",
      }),
    );
    // Asking whether state is readable must never rewrite it as a side effect,
    // even when the answer is "yes, once this plan has been applied".
    await expect(snapshot(storage)).resolves.toEqual(before);
    // The plan exists and is appliable; only this caller declined to apply it.
    expect(planModelMigration(model, "1.0.0").status).toBe("migrate");
  });

  it("defaults to planning rather than applying", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage);
    const before = await snapshot(storage);

    await expect(
      runRuntimeStartupCompatibilityChecks(model, storage, noopRuntimeLogger),
    ).rejects.toBeInstanceOf(RuntimeStartupError);

    await expect(snapshot(storage)).resolves.toEqual(before);
  });

  it("rolls back and reports ADL_MIGRATION_FAILED when the commit fails", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new CommitFailingStorageBackend();
    await seedLegacyState(storage);
    const before = await snapshot(storage);

    const error = await captureStartupError(model, storage);

    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: MODEL_MIGRATION_CODES.FAILED,
        path: "metadata.modelVersion",
        expected: "1.1.0",
        actual: "1.0.0",
      }),
    );
    await expect(snapshot(storage)).resolves.toEqual(before);
  });

  it("reduces a storage fault to its name so a diagnostic cannot disclose data", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new CommitFailingStorageBackend();
    await seedLegacyState(storage);

    const error = await captureStartupError(model, storage);
    const failure = error.diagnostics.find(
      (diagnostic) => diagnostic.code === MODEL_MIGRATION_CODES.FAILED,
    );

    expect(failure?.message).toContain("was rolled back");
    expect(failure?.message).not.toContain(COMMIT_FAILURE_DETAIL);
    expect(failure?.message).not.toContain("The Fillmore");
  });

  it("refuses a non-transactional backend rather than migrating write by write", async () => {
    // A half-applied migration is the one outcome no diagnostic can describe
    // honestly afterwards.
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const inner = new InMemoryObjectStorageBackend();
    await seedLegacyState(inner);
    const storage = new NonTransactionalStorageBackend(inner);
    const before = await snapshot(inner);

    const error = await captureStartupError(model, storage);

    expect(error.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: MODEL_MIGRATION_CODES.FAILED,
        message: expect.stringContaining("transactional storage backend"),
      }),
    );
    await expect(snapshot(inner)).resolves.toEqual(before);
  });

  it("writes version and fingerprint metadata for a store that has neither", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await storage.create("Gig", createGigRecord({ schemaVersion: 2, values: { Title: "Night" } }));

    await expect(
      runRuntimeStartupCompatibilityChecks(model, storage, noopRuntimeLogger, {
        applyMigrations: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        severity: "warning",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_VERSION_MISSING,
      }),
    ]);
    await expect(storage.readApplicationMetadata()).resolves.toEqual({
      modelVersion: "1.1.0",
      modelFingerprint: model.modelFingerprint,
    });
  });
});

describe("ApplicationRuntime over migrated storage", () => {
  it("migrates persisted records on whenReady and then reads them normally", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage);

    const runtime = new ApplicationRuntime(model, { storage });

    await expect(runtime.whenReady()).resolves.toBeUndefined();
    expect(runtime.getStartupDiagnostics()).toEqual([
      expect.objectContaining({
        severity: "info",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MIGRATION_APPLIED,
      }),
    ]);

    const record = await runtime.read("Gig", "gig-1", adminContext);

    expect(record).not.toBeNull();
    if (record === null) {
      throw new Error("Expected the migrated record to be readable.");
    }
    expect(record.values).toEqual({
      Title: "Opening night",
      VenueName: "The Fillmore",
      PayoutCents: 0,
    });
    expect(record.meta.schemaVersion).toBe(2);
    // No data loss: this is the same record, not a replacement for it.
    expect(record.meta.guid).toBe("gig-1");
    expect(record.meta.revision).toBe("rev-seeded");
    expect(record.meta.createdBy).toBe("band-seed");
    expect(record.meta.createdAt).toBe(fixedNow.toISOString());
  });

  it("keeps every migrated record, not only the one that is read back", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage);
    await storage.create(
      "Gig",
      createGigRecord({
        guid: "gig-2",
        values: { Title: "Second night", Venue: "Great American", PayoutCents: 150_000 },
      }),
    );

    const runtime = new ApplicationRuntime(model, { storage });
    await runtime.whenReady();

    const found = await runtime.search("Gig", undefined, adminContext);

    expect(found.map((record) => record.meta.guid).sort()).toEqual(["gig-1", "gig-2"]);
    expect(found.find((record) => record.meta.guid === "gig-2")?.values).toEqual({
      Title: "Second night",
      VenueName: "Great American",
      // Already carried a payout, so the backfill left it alone.
      PayoutCents: 150_000,
    });
  });

  it("continues to serve writes after a migration, at the migrated schema version", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage);

    const runtime = new ApplicationRuntime(model, { storage });
    await runtime.whenReady();

    const created = await runtime.create(
      "Gig",
      { Title: "Third night", VenueName: "Bimbo's", PayoutCents: 1 },
      adminContext,
    );

    expect(created.meta.schemaVersion).toBe(2);
    await expect(runtime.read("Gig", "gig-1", adminContext)).resolves.toMatchObject({
      values: { VenueName: "The Fillmore" },
    });
  });

  it("refuses to open storage whose version no migration reaches", async () => {
    const model = createMigrationModel({ objectSchemaVersion: 2 });
    const storage = new InMemoryObjectStorageBackend();
    await seedLegacyState(storage, { modelVersion: "0.9.0" });
    const before = await snapshot(storage);

    const runtime = new ApplicationRuntime(model, { storage });

    await expect(runtime.whenReady()).rejects.toBeInstanceOf(RuntimeStartupError);
    await expect(runtime.read("Gig", "gig-1", adminContext)).rejects.toBeInstanceOf(
      RuntimeStartupError,
    );
    await expect(snapshot(storage)).resolves.toEqual(before);
  });
});

class CommitFailingStorageBackend extends InMemoryObjectStorageBackend {
  override async commitTransaction(): Promise<void> {
    // A real driver's message can name hosts, statements and record values; the
    // diagnostic must reduce this to the fault's name.
    throw new Error(COMMIT_FAILURE_DETAIL);
  }
}

/** Deliberately exposes no `commitTransaction`, like a store that cannot commit atomically. */
class NonTransactionalStorageBackend implements ObjectStorageBackend {
  readonly supportsTransactions = false;

  constructor(private readonly inner: InMemoryObjectStorageBackend) {}

  create(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.inner.create(objectName, record);
  }

  read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    return this.inner.read(objectName, id);
  }

  update(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.inner.update(objectName, record);
  }

  delete(objectName: string, tombstone: StoredObjectRecord): Promise<void> {
    return this.inner.delete(objectName, tombstone);
  }

  search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]> {
    return this.inner.search(request);
  }

  listRecords(): Promise<PersistedObjectRecord[]> {
    return this.inner.listRecords();
  }

  readApplicationMetadata(): Promise<PersistedApplicationMetadata | null> {
    return this.inner.readApplicationMetadata();
  }

  writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void> {
    return this.inner.writeApplicationMetadata(metadata);
  }
}

function migrationAdlSource(
  options: { steps?: string[]; declareSchemaVersion?: boolean } = {},
): string {
  const steps = options.steps ?? [
    "    RENAME FIELD Venue TO VenueName",
    "    ADD FIELD PayoutCents DEFAULT 0",
    "    DROP FIELD LegacyNote",
  ];

  return [
    "APP GigBook",
    "  MODEL_VERSION '1.1.0'",
    "  START_VIEW GigList",
    "END.APP",
    "",
    "ROLE Admin",
    "",
    "OBJECT Gig",
    "  KEY Title",
    "  DISPLAY Title",
    "",
    "  FIELD Title TEXT REQUIRED",
    "  FIELD VenueName TEXT",
    "  FIELD PayoutCents NUMBER",
    "",
    "  VIEW GigList LIST",
    "    FIELDS Title VenueName",
    "    ACTIONS create read",
    "  END.VIEW",
    "END.OBJECT",
    "",
    "POLICY GigPolicy ON Gig",
    "  ALLOW * ROLE Admin",
    "END.POLICY",
    "",
    "MIGRATION FROM '1.0.0' TO '1.1.0'",
    "  OBJECT Gig",
    ...(options.declareSchemaVersion === false ? [] : ["    SCHEMA_VERSION 2"]),
    ...steps,
    "  END.OBJECT",
    "END.MIGRATION",
    "",
  ].join("\n");
}

function createMigrationModel(
  options: {
    modelVersion?: string;
    migrations?: PartialModelMigrationModel[];
    objectSchemaVersion?: number;
  } = {},
): ResolvedApplicationModel {
  const partial: PartialApplicationModel = {
    modelVersion: options.modelVersion ?? "1.1.0",
    app: { name: "GigBook" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Gig",
        businessKey: "Title",
        displayField: "Title",
        ...(options.objectSchemaVersion === undefined
          ? {}
          : { schemaVersion: options.objectSchemaVersion }),
        fields: [
          { name: "Title", type: "text", required: true },
          { name: "VenueName", type: "text" },
          { name: "PayoutCents", type: "number" },
        ],
      },
    ],
    policies: [
      {
        name: "GigPolicy",
        object: "Gig",
        rules: [
          {
            name: "allowAdminGigOps",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
    migrations: options.migrations ?? [
      {
        from: "1.0.0",
        to: "1.1.0",
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
  };

  return resolveApplicationModel(partial);
}

function renameMigration(
  from: string,
  to: string,
  fieldFrom: string,
  fieldTo: string,
): PartialModelMigrationModel {
  return {
    from,
    to,
    objects: [{ object: "Gig", steps: [{ kind: "renameField", from: fieldFrom, to: fieldTo }] }],
  };
}

function renameStep(): ResolvedModelMigrationStep {
  return { kind: "renameField", from: "Venue", to: "VenueName" };
}

function singleHopPlan(
  steps: ResolvedModelMigrationStep[],
  schemaVersion?: number,
): ModelMigrationPlan {
  return {
    from: "1.0.0",
    to: "1.1.0",
    steps: [
      {
        from: "1.0.0",
        to: "1.1.0",
        objects: [
          { object: "Gig", ...(schemaVersion === undefined ? {} : { schemaVersion }), steps },
        ],
      },
    ],
  };
}

function createGigRecord(
  options: {
    guid?: string;
    object?: string;
    schemaVersion?: number;
    values?: Record<string, JsonValue>;
  } = {},
): StoredObjectRecord {
  return {
    meta: {
      guid: options.guid ?? "gig-1",
      object: options.object ?? "Gig",
      schemaVersion: options.schemaVersion ?? 1,
      revision: "rev-seeded",
      createdAt: fixedNow.toISOString(),
      createdBy: "band-seed",
      updatedAt: fixedNow.toISOString(),
      updatedBy: "band-seed",
      syncStatus: "synced",
    },
    values: options.values ?? { Title: "Opening night" },
  };
}

function createLocalOperation(
  overrides: Partial<LocalOperation> & { patch?: Record<string, JsonValue> } = {},
): LocalOperation {
  const { patch, ...rest } = overrides;

  return {
    opId: "op-1",
    object: "Gig",
    recordId: "gig-1",
    baseRevision: "rev-seeded",
    operation: "update",
    createdAt: fixedNow.toISOString(),
    createdBy: "admin-1",
    contextSnapshot: { roles: ["Admin"], channel: "ui" },
    status: "pending",
    ...rest,
    ...(patch === undefined ? {} : { patch }),
  };
}

function createSyncState(operations: LocalOperation[]): PersistedSyncState {
  const queue: SyncQueueEntry[] = operations.map((operation) => ({
    queueId: `queue-${operation.opId}`,
    operation,
    objectSync: { mode: "localFirst", scope: "all", conflict: "manual" },
  }));

  return { modelVersion: "1.0.0", queue, operations };
}

async function seedLegacyState(
  storage: ObjectStorageBackend,
  options: { modelVersion?: string } = {},
): Promise<void> {
  await storage.create(
    "Gig",
    createGigRecord({
      values: {
        Title: "Opening night",
        Venue: "The Fillmore",
        LegacyNote: "migrated from the spreadsheet",
      },
    }),
  );
  await storage.writeApplicationMetadata({
    modelVersion: options.modelVersion ?? "1.0.0",
    modelFingerprint: STALE_FINGERPRINT,
  });
}

async function snapshot(storage: ObjectStorageBackend): Promise<{
  metadata: PersistedApplicationMetadata | null;
  records: PersistedObjectRecord[];
}> {
  return {
    metadata: await storage.readApplicationMetadata(),
    records: await storage.listRecords(),
  };
}

async function captureStartupError(
  model: ResolvedApplicationModel,
  storage: ObjectStorageBackend,
  options: { applyMigrations?: boolean } = { applyMigrations: true },
): Promise<RuntimeStartupError> {
  try {
    await runRuntimeStartupCompatibilityChecks(model, storage, noopRuntimeLogger, options);
  } catch (error) {
    if (error instanceof RuntimeStartupError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the startup compatibility checks to refuse.");
}

function requirePlan(result: ReturnType<typeof planModelMigration>): ModelMigrationPlan {
  if (result.status !== "migrate") {
    throw new Error(`Expected a migration plan, got '${result.status}'.`);
  }

  return result.plan;
}
