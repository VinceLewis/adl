import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  HookError,
  InMemoryObjectStorageBackend,
  LifecycleError,
  MASKED_POLICY_FIELD_VALUE,
  ModelValidationError,
  PolicyDeniedError,
  RUNTIME_STARTUP_COMPATIBILITY_CODES,
  RuntimeValidationError,
  RuntimeStartupError,
  RuntimeContextError,
  StorageError,
  SyncPolicyError,
  compileAdl,
  compileAdlj,
  resolveApplicationModel,
} from "../src/index.js";
import type {
  ObjectStorageBackend,
  ObjectStorageSearchRequest,
  PartialApplicationModel,
  PersistedApplicationMetadata,
  PersistedObjectRecord,
  ReadModelSourceScope,
  ResolvedExpression,
  ResolvedObject,
  RuntimeContext,
  StoredObjectRecord,
  SyncMode,
  SyncScope,
} from "../src/index.js";
import { bandContextPartialModel } from "./fixtures/band-context-model.js";

const fixedNow = new Date("2026-07-07T08:00:00.000Z");

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: fixedNow,
};

const requesterContext: RuntimeContext = {
  userId: "requester-1",
  roles: ["Requester"],
  channel: "api",
  now: fixedNow,
};

const approverContext: RuntimeContext = {
  userId: "approver-1",
  roles: ["Approver"],
  channel: "api",
  now: fixedNow,
};

const viewerContext: RuntimeContext = {
  userId: "viewer-1",
  roles: ["Viewer"],
  channel: "api",
  now: fixedNow,
};

const offlineAdminContext: RuntimeContext = {
  ...adminContext,
  online: false,
};

const emailOnlyViewerContext: RuntimeContext = {
  userId: "email-viewer-1",
  roles: ["EmailOnlyViewer"],
  channel: "api",
  now: fixedNow,
};

const runtimePartialModel = {
  app: {
    name: "RuntimeDemo",
  },
  roles: [
    { name: "Admin" },
    { name: "Requester" },
    { name: "Approver" },
    { name: "Viewer" },
    { name: "EmailOnlyViewer" },
  ],
  objects: [
    {
      name: "User",
      businessKey: "Email",
      displayField: "Name",
      fields: [
        { name: "Name", type: "text", required: true },
        {
          name: "Email",
          type: "text",
          required: true,
          validators: [{ kind: "email" }],
        },
        { name: "Phone", type: "text" },
        { name: "Active", type: "boolean", defaultValue: true },
      ],
    },
    {
      name: "PurchaseOrder",
      businessKey: "PONumber",
      displayField: "Supplier",
      fields: [
        { name: "PONumber", type: "text", required: true },
        { name: "Supplier", type: "text", required: true },
        { name: "Value", type: "number", required: true, validators: [{ kind: "min", value: 0 }] },
        { name: "Status", type: "text", required: true },
        { name: "InternalNotes", type: "text" },
        { name: "ApprovalComment", type: "text" },
      ],
      lifecycle: {
        name: "PurchaseOrderLifecycle",
        stateField: "Status",
        initialState: "Draft",
        states: [
          { name: "Draft" },
          { name: "Submitted" },
          { name: "Approved", terminal: true },
          { name: "Cancelled", terminal: true },
        ],
        actions: [
          {
            name: "submit",
            from: "Draft",
            to: "Submitted",
            policyRefs: ["PurchaseOrderPolicy"],
            hooks: {
              before: ["hooks.purchaseOrder.beforeSubmit"],
              after: ["hooks.purchaseOrder.afterSubmit"],
            },
          },
          {
            name: "approve",
            from: "Submitted",
            to: "Approved",
            policyRefs: ["PurchaseOrderPolicy"],
          },
        ],
      },
    },
    {
      name: "ServiceAccount",
      businessKey: "AccountNumber",
      displayField: "Name",
      fields: [
        { name: "AccountNumber", type: "text", required: true },
        { name: "Name", type: "text", required: true },
        { name: "Status", type: "text", required: true },
      ],
      lifecycle: {
        name: "ServiceAccountLifecycle",
        stateField: "Status",
        initialState: "Draft",
        states: [{ name: "Draft" }, { name: "Active" }, { name: "Suspended" }],
        actions: [
          {
            name: "activate",
            from: "Draft",
            to: "Active",
            policyRefs: ["ServiceAccountPolicy"],
            hooks: {
              before: ["hooks.serviceAccount.beforeActivate"],
              after: ["hooks.serviceAccount.afterActivate"],
              onError: ["hooks.serviceAccount.onActivateError"],
            },
          },
          {
            name: "suspend",
            from: "Active",
            to: "Suspended",
            policyRefs: ["ServiceAccountPolicy"],
          },
        ],
      },
    },
  ],
  policies: [
    {
      name: "UserPolicy",
      object: "User",
      rules: [
        {
          name: "allowAdminAllUserOps",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
        {
          name: "allowViewerReadUsers",
          effect: "allow",
          principal: { match: "specific", roles: ["Viewer"] },
          action: "read",
        },
        {
          name: "maskViewerUserEmailRead",
          effect: "mask",
          principal: { match: "specific", roles: ["Viewer"] },
          action: "read",
          fields: ["Email"],
        },
        {
          name: "hideViewerUserPhoneRead",
          effect: "hidden",
          principal: { match: "specific", roles: ["Viewer"] },
          action: "read",
          fields: ["Phone"],
        },
        {
          name: "allowViewerSearchUsers",
          effect: "allow",
          principal: { match: "specific", roles: ["Viewer"] },
          action: "search",
        },
        {
          name: "allowEmailOnlyViewerUserEmailReadField",
          effect: "allow",
          principal: { match: "specific", roles: ["EmailOnlyViewer"] },
          action: "read",
          fields: ["Email"],
        },
      ],
    },
    {
      name: "PurchaseOrderPolicy",
      object: "PurchaseOrder",
      rules: [
        {
          name: "allowAdminAllPurchaseOrderOps",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
        {
          name: "allowRequesterCreateDraftPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Requester"] },
          action: "create",
          state: "Draft",
        },
        {
          name: "allowRequesterReadPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Requester"] },
          action: "read",
        },
        {
          name: "allowRequesterSearchPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Requester"] },
          action: "search",
        },
        {
          name: "allowRequesterUpdateDraftPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Requester"] },
          action: "update",
          state: "Draft",
        },
        {
          name: "readonlyRequesterInternalNotes",
          effect: "readonly",
          principal: { match: "specific", roles: ["Requester"] },
          action: "update",
          state: "Draft",
          fields: ["InternalNotes"],
        },
        {
          name: "denyRequesterApprovalCommentUpdate",
          effect: "deny",
          principal: { match: "specific", roles: ["Requester"] },
          action: "update",
          state: "Draft",
          fields: ["ApprovalComment"],
        },
        {
          name: "allowRequesterSubmitPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Requester"] },
          action: "transition",
          state: "Draft",
          lifecycleAction: "submit",
        },
        {
          name: "allowApproverReadSubmittedPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Approver"] },
          action: "read",
          state: "Submitted",
        },
        {
          name: "allowApproverReadApprovedPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Approver"] },
          action: "read",
          state: "Approved",
        },
        {
          name: "allowApproverApprovePurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Approver"] },
          action: "transition",
          state: "Submitted",
          lifecycleAction: "approve",
        },
      ],
    },
    {
      name: "ServiceAccountPolicy",
      object: "ServiceAccount",
      rules: [
        {
          name: "allowAdminAllServiceAccountOps",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    },
  ],
} satisfies PartialApplicationModel;

describe("ApplicationRuntime", () => {
  it("validates the resolved model before runtime startup", () => {
    const invalid = resolveApplicationModel({
      ...runtimePartialModel,
      app: {
        name: "InvalidRuntimeDemo",
        startView: "MissingStartView",
      },
    });

    expect(() => new ApplicationRuntime(invalid)).toThrow(ModelValidationError);
  });

  it("creates, reads, searches, updates, and deletes User records", async () => {
    const runtime = createRuntime();

    const created = await runtime.create(
      "User",
      { Name: "Ada Lovelace", Email: "ada@example.com", Phone: "123" },
      adminContext,
    );
    expect(created.values).toMatchObject({
      Name: "Ada Lovelace",
      Email: "ada@example.com",
      Phone: "123",
      Active: true,
    });
    expect(created.meta).toMatchObject({
      object: "User",
      schemaVersion: 1,
      createdBy: "admin-1",
      // Queued by this same write and unanswered, which is what `pending` means.
      syncStatus: "pending",
    });

    const read = await runtime.read("User", created.meta.guid, adminContext);
    expect(read?.values.Email).toBe("ada@example.com");

    const search = await runtime.search(
      "User",
      { text: "ada", fields: ["Name", "Email"] },
      adminContext,
    );
    expect(search.map((record) => record.meta.guid)).toEqual([created.meta.guid]);

    const updated = await runtime.update("User", created.meta.guid, { Phone: "456" }, adminContext);
    expect(updated.values.Phone).toBe("456");
    expect(updated.meta.revision).not.toBe(created.meta.revision);

    const deleted = await runtime.delete("User", created.meta.guid, adminContext);
    expect(deleted.meta.deletedAt).toBe(fixedNow.toISOString());
    await expect(runtime.read("User", created.meta.guid, adminContext)).resolves.toBeNull();
  });

  it("denies unauthorized direct runtime updates by policy", async () => {
    const runtime = createRuntime();
    const created = await runtime.create(
      "User",
      { Name: "Grace Hopper", Email: "grace@example.com" },
      adminContext,
    );

    await expect(
      runtime.objectStore.update("User", created.meta.guid, { Phone: "999" }, viewerContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("returns explainable default-deny decisions", () => {
    const runtime = createRuntime();

    const decision = runtime.policyEngine.evaluate(
      {
        objectName: "User",
        action: "update",
      },
      viewerContext,
    );

    expect(decision).toEqual({
      effect: "deny",
      reasons: [
        {
          policyName: "UserDefaultDeny",
          effect: "deny",
          message: "No policy rule allowed update; default deny applies.",
        },
      ],
    });
  });

  it("lists available contexts and resolves a valid selected context", async () => {
    const seeded = await createSeededBandRuntime();

    const available = await seeded.runtime.listAvailableContexts("Band", seeded.musicianContext);
    expect(
      available.map((context) => ({
        id: context.id,
        label: context.label,
        roles: context.roles,
      })),
    ).toEqual([
      {
        id: seeded.firstBand.meta.guid,
        label: "The Alphas",
        roles: ["BandAdmin"],
      },
      {
        id: seeded.secondBand.meta.guid,
        label: "The Betas",
        roles: ["BandMember"],
      },
    ]);

    expect(seeded.firstBandContext.roles).toEqual([]);
    expect(seeded.firstBandContext.selectedContexts).toEqual({
      Band: seeded.firstBand.meta.guid,
    });
    expect(seeded.firstBandContext.contextRoles).toEqual([
      expect.objectContaining({
        context: "Band",
        contextId: seeded.firstBand.meta.guid,
        role: "BandAdmin",
      }),
    ]);
  });

  it("rejects an invalid selected context", async () => {
    const seeded = await createSeededBandRuntime();

    await expect(
      seeded.runtime.withSelectedContext("Band", "missing-band", seeded.musicianContext),
    ).rejects.toBeInstanceOf(RuntimeContextError);
  });

  it("keeps context Admin separate from global Admin", async () => {
    const seeded = await createSeededBandRuntime();

    const updated = await seeded.runtime.update(
      "Gig",
      seeded.firstGig.meta.guid,
      { Venue: "Updated Hall" },
      seeded.firstBandContext,
    );
    expect(updated.values.Venue).toBe("Updated Hall");

    await expect(
      seeded.runtime.update(
        "Gig",
        seeded.secondGig.meta.guid,
        { Venue: "Member should not update" },
        seeded.secondBandContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const decision = seeded.runtime.policyEngine.evaluate(
      {
        objectName: "Gig",
        action: "update",
        record: seeded.secondGig,
        currentState: "Draft",
      },
      seeded.secondBandContext,
    );

    expect(seeded.secondBandContext.roles).toEqual([]);
    expect(decision.effect).toBe("deny");
  });

  it("filters scoped reads and searches by runtime context", async () => {
    const seeded = await createSeededBandRuntime();

    await expect(
      seeded.runtime.read("Gig", seeded.secondGig.meta.guid, seeded.firstBandContext),
    ).rejects.toMatchObject({
      decision: {
        reasons: [
          expect.objectContaining({
            policyName: "GigContextScope",
            ruleName: "requireRuntimeContextScope",
          }),
        ],
      },
    });

    const firstBandSearch = await seeded.runtime.search("Gig", undefined, seeded.firstBandContext);
    expect(firstBandSearch.map((record) => record.meta.guid)).toEqual([seeded.firstGig.meta.guid]);

    const allContextRoles = await seeded.runtime.contextService.resolveContextRoles(
      "Band",
      seeded.musicianContext,
    );
    const allAvailableContext: RuntimeContext = {
      ...seeded.musicianContext,
      contextRoles: allContextRoles,
    };
    const allAvailableSearch = await seeded.runtime.search("Gig", undefined, allAvailableContext);

    expect(allAvailableSearch.map((record) => record.meta.guid)).toEqual([
      seeded.firstGig.meta.guid,
      seeded.secondGig.meta.guid,
    ]);
  });

  it("executes all-context read models with projection, sorting, and joined labels", async () => {
    const seeded = await createSeededBandRuntime();
    await seeded.runtime.create(
      "Gig",
      {
        Band: seeded.firstBand.meta.guid,
        Date: "2026-07-15",
        Venue: "Early Hall",
      },
      seeded.firstBandContext,
    );

    const result = await seeded.runtime.executeReadModel("UpcomingGigsByBand", {
      ...seeded.musicianContext,
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    });

    expect(result.rows.map((row) => row.values)).toEqual([
      {
        GigDate: "2026-07-15",
        Venue: "Early Hall",
        BandName: "The Alphas",
      },
      {
        GigDate: "2026-08-01",
        Venue: "Alpha Hall",
        BandName: "The Alphas",
      },
      {
        GigDate: "2026-08-02",
        Venue: "Beta Hall",
        BandName: "The Betas",
      },
    ]);
    expect(result.rows[0]?.sources).toMatchObject({
      gig: { objectName: "Gig" },
      band: { objectName: "Band", recordId: seeded.firstBand.meta.guid },
    });
  });

  it("executes current-context read models without crossing selected context scope", async () => {
    const partialModel = createBandRuntimePartialModel();
    partialModel.readModels = [
      ...(partialModel.readModels ?? []),
      {
        name: "CurrentBandGigs",
        context: { mode: "required", context: "Band" },
        sources: [{ name: "gig", object: "Gig", scope: "currentContext" }],
        fields: [
          { name: "GigDate", source: "gig", field: "Date" },
          { name: "Venue", source: "gig", field: "Venue" },
        ],
        sort: [{ field: "GigDate", direction: "asc" }],
      },
    ];
    const seeded = await createSeededBandRuntime(partialModel);

    const result = await seeded.runtime.executeReadModel(
      "CurrentBandGigs",
      seeded.firstBandContext,
    );

    expect(result.rows.map((row) => row.values)).toEqual([
      {
        GigDate: "2026-08-01",
        Venue: "Alpha Hall",
      },
    ]);
  });

  it("filters read-model sources by current user and shapes projected fields by policy", async () => {
    const runtime = new ApplicationRuntime(
      resolveApplicationModel({
        ...runtimePartialModel,
        readModels: [
          {
            name: "CurrentUserDirectoryEntry",
            sources: [{ name: "user", object: "User", scope: "currentUser" }],
            fields: [
              { name: "Name", source: "user", field: "Name" },
              { name: "Email", source: "user", field: "Email" },
              { name: "Phone", source: "user", field: "Phone" },
            ],
            sort: [{ field: "Name", direction: "asc" }],
          },
        ],
      }),
    );
    await runtime.create(
      "User",
      { Name: "Ada Lovelace", Email: "ada@example.com", Phone: "123" },
      adminContext,
    );
    const grace = await runtime.create(
      "User",
      { Name: "Grace Hopper", Email: "grace@example.com", Phone: "456" },
      adminContext,
    );

    const result = await runtime.executeReadModel("CurrentUserDirectoryEntry", {
      ...viewerContext,
      userId: grace.meta.guid,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.values).toEqual({
      Name: "Grace Hopper",
      Email: MASKED_POLICY_FIELD_VALUE,
    });
  });

  it("limits local dataset reads to current-context records", async () => {
    const seeded = await createSeededBandRuntime(
      createBandDatasetPartialModel({
        gigSyncScope: "currentContext",
        readModelSourceScope: "currentContext",
      }),
    );

    const dataset = await seeded.runtime.evaluateOfflineDataset(seeded.firstBandContext);
    const gigRecords = dataset.records.filter((record) => record.objectName === "Gig");
    const search = await seeded.runtime.searchLocalDataset(
      "Gig",
      undefined,
      seeded.firstBandContext,
    );

    expect(gigRecords.map((record) => record.recordId)).toEqual([seeded.firstGig.meta.guid]);
    expect(search.map((record) => record.meta.guid)).toEqual([seeded.firstGig.meta.guid]);
    await expect(
      seeded.runtime.isRecordInOfflineDataset(
        "Gig",
        seeded.secondGig.meta.guid,
        seeded.firstBandContext,
      ),
    ).resolves.toBe(false);
  });

  it("includes all-available-context records required by read-model sources", async () => {
    const seeded = await createSeededBandRuntime(
      createBandDatasetPartialModel({
        gigSyncScope: "currentContext",
        readModelSourceScope: "allAvailableContexts",
      }),
    );
    const selectedBaseContext: RuntimeContext = {
      ...seeded.musicianContext,
      selectedContexts: { Band: seeded.firstBand.meta.guid },
    };

    const dataset = await seeded.runtime.evaluateOfflineDataset(selectedBaseContext);
    const gigRecords = dataset.records.filter((record) => record.objectName === "Gig");
    const secondGig = gigRecords.find((record) => record.recordId === seeded.secondGig.meta.guid);
    const search = await seeded.runtime.searchLocalDataset("Gig", undefined, selectedBaseContext);

    expect(new Set(gigRecords.map((record) => record.recordId))).toEqual(
      new Set([seeded.firstGig.meta.guid, seeded.secondGig.meta.guid]),
    );
    expect(secondGig?.reasons).toContainEqual({
      kind: "readModelSource",
      readModel: "UpcomingGigsByBand",
      source: "gig",
      sourceScope: "allAvailableContexts",
      mode: "localFirst",
    });
    expect(search.map((record) => record.meta.guid)).toEqual([
      seeded.firstGig.meta.guid,
      seeded.secondGig.meta.guid,
    ]);
  });

  it("evaluates current-user dataset records independently of read authorization", async () => {
    const runtime = new ApplicationRuntime(
      resolveApplicationModel({
        ...runtimePartialModel,
        objects: runtimePartialModel.objects.map((object) =>
          object.name === "User"
            ? {
                ...object,
                sync: { mode: "localFirst", scope: "currentUser" },
              }
            : object,
        ),
        readModels: [
          {
            name: "CurrentUserDirectoryEntry",
            sources: [{ name: "user", object: "User", scope: "currentUser" }],
            fields: [
              { name: "Name", source: "user", field: "Name" },
              { name: "Email", source: "user", field: "Email" },
              { name: "Phone", source: "user", field: "Phone" },
            ],
          },
        ],
      }),
    );
    await runtime.create(
      "User",
      { Name: "Ada Lovelace", Email: "ada@example.com", Phone: "123" },
      adminContext,
    );
    const grace = await runtime.create(
      "User",
      { Name: "Grace Hopper", Email: "grace@example.com", Phone: "456" },
      adminContext,
    );

    const dataset = await runtime.evaluateOfflineDataset({
      ...viewerContext,
      userId: grace.meta.guid,
    });
    const search = await runtime.searchLocalDataset("User", undefined, {
      ...viewerContext,
      userId: grace.meta.guid,
    });

    expect(dataset.records.filter((record) => record.objectName === "User")).toEqual([
      {
        objectName: "User",
        recordId: grace.meta.guid,
        reasons: [
          { kind: "objectSync", mode: "localFirst", scope: "currentUser" },
          {
            kind: "readModelSource",
            readModel: "CurrentUserDirectoryEntry",
            source: "user",
            sourceScope: "currentUser",
            mode: "localFirst",
          },
        ],
      },
    ]);
    expect(search).toHaveLength(1);
    expect(search[0]?.values).toEqual({
      Name: "Grace Hopper",
      Email: MASKED_POLICY_FIELD_VALUE,
      Active: true,
    });
  });

  /**
   * Phase 62. `custom` used to return `false` unconditionally, so a model that
   * declared it compiled, validated, and held zero records on every device
   * without saying so. It now selects by its declared predicate, evaluated as
   * an ordinary `ResolvedExpression` against the record's own values and the
   * runtime context — not a second expression dialect.
   */
  it("selects offline dataset records by a declared custom sync predicate", async () => {
    const runtime = new ApplicationRuntime(
      resolveApplicationModel({
        ...runtimePartialModel,
        objects: runtimePartialModel.objects.map((object) =>
          object.name === "PurchaseOrder"
            ? {
                ...object,
                sync: {
                  mode: "localFirst",
                  scope: "custom",
                  predicate: {
                    kind: "binary",
                    operator: "or",
                    left: {
                      kind: "binary",
                      operator: "==",
                      left: { kind: "field", field: "Supplier" },
                      right: { kind: "literal", value: "Acme" },
                    },
                    right: {
                      kind: "binary",
                      operator: "==",
                      left: { kind: "field", field: "InternalNotes" },
                      right: { kind: "runtime", property: "userId" },
                    },
                  },
                },
              }
            : object,
        ),
      } as PartialApplicationModel),
    );

    const bySupplier = await runtime.create(
      "PurchaseOrder",
      { PONumber: "PO-1", Supplier: "Acme", Value: 10, Status: "Draft" },
      adminContext,
    );
    const byRuntimeUser = await runtime.create(
      "PurchaseOrder",
      {
        PONumber: "PO-2",
        Supplier: "Globex",
        Value: 20,
        Status: "Draft",
        InternalNotes: adminContext.userId,
      },
      adminContext,
    );
    await runtime.create(
      "PurchaseOrder",
      { PONumber: "PO-3", Supplier: "Initech", Value: 30, Status: "Draft" },
      adminContext,
    );

    const dataset = await runtime.evaluateOfflineDataset(adminContext);
    const orders = dataset.records.filter((record) => record.objectName === "PurchaseOrder");

    expect(new Set(orders.map((record) => record.recordId))).toEqual(
      new Set([bySupplier.meta.guid, byRuntimeUser.meta.guid]),
    );
    expect(orders[0]?.reasons).toEqual([
      { kind: "objectSync", mode: "localFirst", scope: "custom" },
    ]);

    // The predicate is evaluated against the runtime context of the device
    // asking, so a different signed-in user holds a different dataset from the
    // same records and the same model.
    const otherUserDataset = await runtime.evaluateOfflineDataset({
      ...adminContext,
      userId: "admin-2",
    });

    expect(
      otherUserDataset.records
        .filter((record) => record.objectName === "PurchaseOrder")
        .map((record) => record.recordId),
    ).toEqual([bySupplier.meta.guid]);
  });

  /**
   * Phase 64. A sync scope selects a context; a window and a predicate bound how
   * much of it a device keeps. Before this they were alternatives — a window was
   * refused on any scope but `recent` — so "my records, recent" could only be
   * had by widening from one user's records to every available context's.
   */
  it("bounds a current-user sync scope by a declared window", async () => {
    const seeded = await createBoundedUserScopeRuntime({
      window: { field: "Date", days: 30 },
    });

    const dataset = await seeded.runtime.evaluateOfflineDataset(seeded.alexContext);
    const entries = dataset.records.filter((record) => record.objectName === "TimeEntry");

    expect(new Set(entries.map((record) => record.recordId))).toEqual(
      new Set([
        seeded.alexRecent.meta.guid,
        seeded.alexMiddle.meta.guid,
        seeded.alexOldest.meta.guid,
      ]),
    );
    // The scope still selects the context half: none of Blake's records are here.
    expect(entries.map((record) => record.reasons)).toEqual(
      entries.map(() => [{ kind: "objectSync", mode: "localFirst", scope: "currentUser" }]),
    );
    // And the window still bounds it: the entry outside the day span is gone.
    expect(entries.map((record) => record.recordId)).not.toContain(
      seeded.alexOutsideWindow.meta.guid,
    );
  });

  /**
   * The defect this phase was most likely to introduce. `LIMIT` ranks records
   * against each other, and the candidate set used to be filtered by available
   * contexts regardless of the declared scope — invisible while a limit could
   * only accompany `recent`, whose context half is exactly that. Ranking one
   * user's records against every other user's would leave Alex holding Blake's
   * newest entries and none of their own.
   */
  it("ranks a declared limit within the object's own context scope, not across users", async () => {
    const seeded = await createBoundedUserScopeRuntime({
      window: { field: "Date", days: 30, limit: 2 },
    });

    const alexDataset = await seeded.runtime.evaluateOfflineDataset(seeded.alexContext);
    const blakeDataset = await seeded.runtime.evaluateOfflineDataset(seeded.blakeContext);

    // Blake's entries are all newer than Alex's, so a limit ranked across users
    // would give Alex an empty dataset and Blake the same two records twice.
    expect(
      alexDataset.records
        .filter((record) => record.objectName === "TimeEntry")
        .map((record) => record.recordId),
    ).toEqual([seeded.alexRecent.meta.guid, seeded.alexMiddle.meta.guid].sort());
    expect(
      blakeDataset.records
        .filter((record) => record.objectName === "TimeEntry")
        .map((record) => record.recordId),
    ).toEqual([seeded.blakeRecent.meta.guid, seeded.blakeMiddle.meta.guid].sort());
  });

  it("applies a window and a predicate declared on the same sync scope", async () => {
    const seeded = await createBoundedUserScopeRuntime({
      window: { field: "Date", days: 30 },
      predicate: {
        kind: "binary",
        operator: "==",
        left: { kind: "field", field: "Billable" },
        right: { kind: "literal", value: true },
      },
    });

    const dataset = await seeded.runtime.evaluateOfflineDataset(seeded.alexContext);
    const entries = dataset.records.filter((record) => record.objectName === "TimeEntry");

    // `alexMiddle` is inside the window and fails the predicate; `alexOutsideWindow`
    // satisfies the predicate and falls outside the window. Both bounds are
    // declared, so both must pass.
    expect(entries.map((record) => record.recordId)).toEqual(
      [seeded.alexRecent.meta.guid, seeded.alexOldest.meta.guid].sort(),
    );
  });

  /**
   * Phase 63's rule, re-proven now that a bound no longer implies a scope: a
   * read-model source widens the *context* an object is held for and never the
   * bound. Blake's entry reaches Alex's device through a cross-user source, and
   * an entry outside the window reaches it by no route at all.
   */
  it("keeps a bound on a current-user scope gating every route into the dataset", async () => {
    const seeded = await createBoundedUserScopeRuntime({
      window: { field: "Date", days: 30 },
      withCrossUserReadModel: true,
    });

    const dataset = await seeded.runtime.evaluateOfflineDataset(seeded.alexContext);
    const entries = new Map(
      dataset.records
        .filter((record) => record.objectName === "TimeEntry")
        .map((record) => [record.recordId, record.reasons] as const),
    );

    expect(entries.get(seeded.blakeRecent.meta.guid)).toEqual([
      {
        kind: "readModelSource",
        readModel: "TeamTimeEntries",
        source: "entry",
        sourceScope: "all",
        mode: "localFirst",
        boundedBy: "window",
      },
    ]);
    expect(entries.has(seeded.alexOutsideWindow.meta.guid)).toBe(false);
    expect(entries.has(seeded.blakeOutsideWindow.meta.guid)).toBe(false);
  });

  /**
   * A limit ranks an object's own selection. A record another route admits is
   * not ranked against that selection, because evicting it would make a limit
   * narrow the context — which no bound may do. Blake's entries are held by the
   * cross-user source alone, and Alex's `LIMIT 2` does not evict them.
   */
  it("does not rank records another route admits against the object's own limit", async () => {
    const seeded = await createBoundedUserScopeRuntime({
      window: { field: "Date", days: 30, limit: 2 },
      withCrossUserReadModel: true,
    });

    const dataset = await seeded.runtime.evaluateOfflineDataset(seeded.alexContext);
    const entries = dataset.records
      .filter((record) => record.objectName === "TimeEntry")
      .map((record) => record.recordId);

    expect(new Set(entries)).toEqual(
      new Set([
        seeded.alexRecent.meta.guid,
        seeded.alexMiddle.meta.guid,
        seeded.blakeRecent.meta.guid,
        seeded.blakeMiddle.meta.guid,
        seeded.blakeOldest.meta.guid,
      ]),
    );
    // Alex's own oldest entry is inside the window and still evicted by the
    // limit, so the limit has not simply stopped applying.
    expect(entries).not.toContain(seeded.alexOldest.meta.guid);
  });

  it("denies writes and transitions outside the selected object scope", async () => {
    const seeded = await createSeededBandRuntime();

    await expect(
      seeded.runtime.create(
        "Gig",
        {
          Band: seeded.secondBand.meta.guid,
          Date: "2026-09-01",
          Venue: "Wrong context venue",
        },
        seeded.firstBandContext,
      ),
    ).rejects.toMatchObject({
      decision: {
        reasons: [
          expect.objectContaining({
            policyName: "GigContextScope",
            ruleName: "requireRuntimeContextScope",
          }),
        ],
      },
    });

    await expect(
      seeded.runtime.delete("Gig", seeded.secondGig.meta.guid, seeded.firstBandContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    await expect(
      seeded.runtime.transition(
        "Gig",
        seeded.secondGig.meta.guid,
        "publish",
        seeded.firstBandContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const published = await seeded.runtime.transition(
      "Gig",
      seeded.firstGig.meta.guid,
      "publish",
      seeded.firstBandContext,
    );
    expect(published.values.Status).toBe("Published");
  });

  it("enforces validation and field-level readonly policy", async () => {
    const runtime = createRuntime();

    await expect(runtime.create("User", { Name: "No Email" }, adminContext)).rejects.toBeInstanceOf(
      RuntimeValidationError,
    );

    const purchaseOrder = await runtime.create(
      "PurchaseOrder",
      {
        PONumber: "PO-100",
        Supplier: "Acme Supplies",
        Value: 125,
        InternalNotes: "Initial note",
      },
      requesterContext,
    );

    await expect(
      runtime.update(
        "PurchaseOrder",
        purchaseOrder.meta.guid,
        { InternalNotes: "Requester changed the note" },
        requesterContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("lets field-level policy restrict row-level policy with explicit deny precedence", async () => {
    const runtime = createRuntime();
    const purchaseOrder = await runtime.create(
      "PurchaseOrder",
      {
        PONumber: "PO-110",
        Supplier: "Acme Supplies",
        Value: 125,
      },
      requesterContext,
    );

    const decision = runtime.policyEngine.evaluate(
      {
        objectName: "PurchaseOrder",
        action: "update",
        field: "ApprovalComment",
        record: purchaseOrder,
        currentState: "Draft",
      },
      requesterContext,
    );

    expect(decision).toMatchObject({
      effect: "deny",
      reasons: [
        {
          policyName: "PurchaseOrderPolicy",
          ruleName: "denyRequesterApprovalCommentUpdate",
          effect: "deny",
        },
      ],
    });
    await expect(
      runtime.update(
        "PurchaseOrder",
        purchaseOrder.meta.guid,
        { ApprovalComment: "Requester should not set this" },
        requesterContext,
      ),
    ).rejects.toMatchObject({
      decision: {
        effect: "deny",
        reasons: [
          expect.objectContaining({
            policyName: "PurchaseOrderPolicy",
            ruleName: "denyRequesterApprovalCommentUpdate",
            effect: "deny",
          }),
        ],
      },
    });
  });

  it("masks and hides fields in read and search output", async () => {
    const runtime = createRuntime();
    const created = await runtime.create(
      "User",
      {
        Name: "Dorothy Vaughan",
        Email: "dorothy@example.com",
        Phone: "020 7946 0199",
      },
      adminContext,
    );

    const read = await runtime.read("User", created.meta.guid, viewerContext);
    expect(read?.values.Email).toBe(MASKED_POLICY_FIELD_VALUE);
    expect(read?.values).not.toHaveProperty("Phone");

    const search = await runtime.search(
      "User",
      { text: "dorothy", fields: ["Name", "Email"] },
      viewerContext,
    );
    expect(search).toHaveLength(1);
    expect(search[0]?.values.Email).toBe(MASKED_POLICY_FIELD_VALUE);
    expect(search[0]?.values).not.toHaveProperty("Phone");
  });

  it("does not let field-level read policy expand a missing row-level read grant", async () => {
    const runtime = createRuntime();
    const created = await runtime.create(
      "User",
      {
        Name: "Mary Jackson",
        Email: "mary@example.com",
        Phone: "020 7946 0188",
      },
      adminContext,
    );

    const fieldDecision = runtime.policyEngine.evaluate(
      {
        objectName: "User",
        action: "read",
        field: "Email",
        record: created,
      },
      emailOnlyViewerContext,
    );
    expect(fieldDecision.effect).toBe("allow");

    const shaped = runtime.policyEngine.applyReadPolicy("User", created, emailOnlyViewerContext);
    expect(shaped.values).toEqual({});
    await expect(
      runtime.read("User", created.meta.guid, emailOnlyViewerContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("transitions lifecycle state through allowed actions and hooks", async () => {
    const runtime = createRuntime();
    const hookCalls: string[] = [];
    runtime.registerHook("hooks.purchaseOrder.beforeSubmit", () => {
      hookCalls.push("beforeSubmit");
    });
    runtime.registerHook("hooks.purchaseOrder.afterSubmit", () => {
      hookCalls.push("afterSubmit");
    });
    const purchaseOrder = await runtime.create(
      "PurchaseOrder",
      { PONumber: "PO-200", Supplier: "Northwind", Value: 500 },
      requesterContext,
    );

    expect(purchaseOrder.values.Status).toBe("Draft");
    expect(purchaseOrder.meta.state).toBe("Draft");

    const submitted = await runtime.transition(
      "PurchaseOrder",
      purchaseOrder.meta.guid,
      "submit",
      requesterContext,
    );
    expect(submitted.values.Status).toBe("Submitted");
    expect(submitted.meta.state).toBe("Submitted");
    expect(hookCalls).toEqual(["beforeSubmit", "afterSubmit"]);

    const approved = await runtime.transition(
      "PurchaseOrder",
      purchaseOrder.meta.guid,
      "approve",
      approverContext,
    );
    expect(approved.values.Status).toBe("Approved");
    expect(approved.meta.state).toBe("Approved");
  });

  it("allows Draft to Active and Active to Suspended transitions with ordered hooks", async () => {
    const runtime = createRuntime();
    const hookCalls: string[] = [];
    runtime.registerHook("hooks.serviceAccount.beforeActivate", (event) => {
      hookCalls.push(`before:${event.fromState}->${event.toState}:${event.record.values.Status}`);
      expect(
        runtime.operationLog
          .getOperations()
          .filter((operation) => operation.operation === "transition"),
      ).toHaveLength(0);
    });
    runtime.registerHook("hooks.serviceAccount.afterActivate", (event) => {
      hookCalls.push(`after:${event.fromState}->${event.toState}:${event.record.values.Status}`);
      expect(runtime.auditService.getEvents().at(-1)).toMatchObject({
        operation: "transition",
        lifecycleAction: "activate",
        fromState: "Draft",
        toState: "Active",
      });
      expect(runtime.operationLog.getOperations().at(-1)).toMatchObject({
        operation: "transition",
        lifecycleAction: "activate",
        fromState: "Draft",
        toState: "Active",
      });
    });
    const serviceAccount = await runtime.create(
      "ServiceAccount",
      { AccountNumber: "SA-100", Name: "Primary account" },
      adminContext,
    );

    expect(serviceAccount.values.Status).toBe("Draft");

    const active = await runtime.transition(
      "ServiceAccount",
      serviceAccount.meta.guid,
      "activate",
      adminContext,
    );
    expect(active.values.Status).toBe("Active");
    expect(active.meta.state).toBe("Active");
    expect(hookCalls).toEqual(["before:Draft->Active:Draft", "after:Draft->Active:Active"]);

    const suspended = await runtime.transition(
      "ServiceAccount",
      serviceAccount.meta.guid,
      "suspend",
      adminContext,
    );
    expect(suspended.values.Status).toBe("Suspended");
    expect(suspended.meta.state).toBe("Suspended");
  });

  it("runs error hooks and does not persist when a before hook fails", async () => {
    const runtime = createRuntime();
    const hookCalls: string[] = [];
    runtime.registerHook("hooks.serviceAccount.beforeActivate", () => {
      hookCalls.push("beforeActivate");
      throw new Error("blocked by hook");
    });
    runtime.registerHook("hooks.serviceAccount.onActivateError", (event) => {
      hookCalls.push(`onActivateError:${event.record.values.Status}`);
    });
    const serviceAccount = await runtime.create(
      "ServiceAccount",
      { AccountNumber: "SA-200", Name: "Hook failure account" },
      adminContext,
    );

    await expect(
      runtime.transition("ServiceAccount", serviceAccount.meta.guid, "activate", adminContext),
    ).rejects.toBeInstanceOf(HookError);

    expect(hookCalls).toEqual(["beforeActivate", "onActivateError:Draft"]);
    await expect(
      runtime.read("ServiceAccount", serviceAccount.meta.guid, adminContext),
    ).resolves.toMatchObject({
      values: {
        Status: "Draft",
      },
    });
    expect(runtime.auditService.getEvents().map((event) => event.operation)).toEqual(["create"]);
    expect(runtime.operationLog.getOperations().map((operation) => operation.operation)).toEqual([
      "create",
    ]);
  });

  it("rejects invalid lifecycle transitions", async () => {
    const runtime = createRuntime();
    const purchaseOrder = await runtime.create(
      "PurchaseOrder",
      { PONumber: "PO-300", Supplier: "Contoso", Value: 250 },
      requesterContext,
    );

    await expect(
      runtime.transition("PurchaseOrder", purchaseOrder.meta.guid, "approve", approverContext),
    ).rejects.toBeInstanceOf(LifecycleError);
  });

  it("enforces state-specific update policy and lifecycle action policy", async () => {
    const runtime = createRuntime();
    const purchaseOrder = await runtime.create(
      "PurchaseOrder",
      { PONumber: "PO-350", Supplier: "Contoso", Value: 250 },
      requesterContext,
    );

    await expect(
      runtime.update(
        "PurchaseOrder",
        purchaseOrder.meta.guid,
        { Status: "Submitted" },
        requesterContext,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "ADL_RUNTIME_LIFECYCLE_STATE_DIRECT_UPDATE",
          field: "Status",
        }),
      ],
    });

    await expect(
      runtime.transition("PurchaseOrder", purchaseOrder.meta.guid, "submit", approverContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const submitted = await runtime.transition(
      "PurchaseOrder",
      purchaseOrder.meta.guid,
      "submit",
      requesterContext,
    );

    await expect(
      runtime.update(
        "PurchaseOrder",
        submitted.meta.guid,
        { Supplier: "Changed after submit" },
        requesterContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("records local-first operations in the operation log and sync queue", async () => {
    const runtime = createSyncModeRuntime("localFirst");
    const item = await runtime.create("SyncItem", { Name: "Queued local item" }, adminContext);

    await runtime.update("SyncItem", item.meta.guid, { Name: "Updated queued item" }, adminContext);
    await runtime.delete("SyncItem", item.meta.guid, adminContext);

    expect(runtime.operationLog.getOperations().map((operation) => operation.operation)).toEqual([
      "create",
      "update",
      "delete",
    ]);
    expect(runtime.syncQueue.getEntries().map((entry) => entry.operation.operation)).toEqual([
      "create",
      "update",
      "delete",
    ]);
    expect(runtime.syncQueue.getEntries().map((entry) => entry.objectSync.mode)).toEqual([
      "localFirst",
      "localFirst",
      "localFirst",
    ]);
  });

  it("blocks cache-readonly writes while allowing cached reads", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const model = resolveApplicationModel(createSyncModePartialModel("cacheReadonly"));
    const syncObject = requireResolvedObject(model.objects[0]);
    const cachedRecord = createStoredSyncRecord(syncObject);
    await storage.create("SyncItem", cachedRecord);
    const runtime = new ApplicationRuntime(model, { storage });

    await expect(runtime.read("SyncItem", cachedRecord.meta.guid, adminContext)).resolves.toEqual(
      cachedRecord,
    );
    await expect(
      runtime.create("SyncItem", { Name: "Blocked cache write" }, adminContext),
    ).rejects.toBeInstanceOf(SyncPolicyError);
    expect(runtime.operationLog.getOperations()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("includes cache-readonly cached records in local dataset reads", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const model = resolveApplicationModel(createSyncModePartialModel("cacheReadonly"));
    const syncObject = requireResolvedObject(model.objects[0]);
    const cachedRecord = createStoredSyncRecord(syncObject);
    await storage.create("SyncItem", cachedRecord);
    const runtime = new ApplicationRuntime(model, { storage });

    const dataset = await runtime.evaluateOfflineDataset(adminContext);
    const search = await runtime.searchLocalDataset("SyncItem", undefined, adminContext);

    expect(dataset.records).toEqual([
      {
        objectName: "SyncItem",
        recordId: cachedRecord.meta.guid,
        reasons: [{ kind: "objectSync", mode: "cacheReadonly", scope: "all" }],
      },
    ]);
    expect(search).toEqual([cachedRecord]);
    await expect(
      runtime.create("SyncItem", { Name: "Still blocked" }, adminContext),
    ).rejects.toBeInstanceOf(SyncPolicyError);
  });

  it("excludes online-required records from offline datasets while preserving read and write gates", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const model = resolveApplicationModel(createSyncModePartialModel("onlineRequired"));
    const syncObject = requireResolvedObject(model.objects[0]);
    const cachedRecord = createStoredSyncRecord(syncObject);
    await storage.create("SyncItem", cachedRecord);
    const runtime = new ApplicationRuntime(model, { storage });

    await expect(runtime.read("SyncItem", cachedRecord.meta.guid, adminContext)).resolves.toEqual(
      cachedRecord,
    );
    await expect(runtime.searchLocalDataset("SyncItem", undefined, adminContext)).resolves.toEqual(
      [],
    );
    await expect(
      runtime.create("SyncItem", { Name: "Offline item" }, offlineAdminContext),
    ).rejects.toBeInstanceOf(SyncPolicyError);
  });

  it("stores application model metadata and opens compatible persisted records", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const model = resolveApplicationModel(createSyncModePartialModel("cacheReadonly"));
    const syncObject = requireResolvedObject(model.objects[0]);
    const cachedRecord = createStoredSyncRecord(syncObject);
    await storage.create("SyncItem", cachedRecord);

    const runtime = new ApplicationRuntime(model, { storage });

    await expect(runtime.whenReady()).resolves.toBeUndefined();
    await expect(storage.readApplicationMetadata()).resolves.toEqual({
      modelVersion: model.modelVersion,
      modelFingerprint: model.modelFingerprint,
    });
    expect(runtime.getStartupDiagnostics()).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_VERSION_MISSING,
      }),
    ]);
    await expect(runtime.read("SyncItem", cachedRecord.meta.guid, adminContext)).resolves.toEqual(
      cachedRecord,
    );
  });

  it("returns structured diagnostics for incompatible persisted object schema versions", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const model = resolveApplicationModel(createSyncModePartialModel("cacheReadonly"));
    const syncObject = requireResolvedObject(model.objects[0]);
    const baseRecord = createStoredSyncRecord(syncObject);
    const cachedRecord = {
      ...baseRecord,
      meta: {
        ...baseRecord.meta,
        schemaVersion: syncObject.schemaVersion + 1,
      },
    };
    // Deliberately without a fingerprint: this is state persisted before
    // fingerprints existed, which is warned about and backfilled rather than
    // refused, so the schema-version error below is still the blocking one.
    await storage.writeApplicationMetadata({ modelVersion: model.modelVersion });
    await storage.create("SyncItem", cachedRecord);

    const runtime = new ApplicationRuntime(model, { storage });

    await expect(runtime.whenReady()).rejects.toMatchObject({
      code: "ADL_RUNTIME_STARTUP_COMPATIBILITY_FAILED",
      diagnostics: [
        expect.objectContaining({
          severity: "warning",
          code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_FINGERPRINT_MISSING,
        }),
        expect.objectContaining({
          severity: "error",
          code: RUNTIME_STARTUP_COMPATIBILITY_CODES.RECORD_SCHEMA_VERSION_MISMATCH,
          objectName: "SyncItem",
          recordId: cachedRecord.meta.guid,
          expected: syncObject.schemaVersion,
          actual: syncObject.schemaVersion + 1,
        }),
      ],
    });
    await expect(
      runtime.read("SyncItem", cachedRecord.meta.guid, adminContext),
    ).rejects.toBeInstanceOf(RuntimeStartupError);
  });

  it("returns structured diagnostics for incompatible persisted application model versions", async () => {
    const storage = new InMemoryObjectStorageBackend();
    const model = resolveApplicationModel(createSyncModePartialModel("cacheReadonly"));
    await storage.writeApplicationMetadata({ modelVersion: "0.0.1" });

    const runtime = new ApplicationRuntime(model, { storage });

    await expect(runtime.whenReady()).rejects.toMatchObject({
      diagnostics: [
        expect.objectContaining({
          severity: "error",
          code: RUNTIME_STARTUP_COMPATIBILITY_CODES.MODEL_VERSION_MISMATCH,
          expected: model.modelVersion,
          actual: "0.0.1",
        }),
      ],
    });
  });

  it("checks policy before sync mode blocks writes", async () => {
    const runtime = createSyncModeRuntime("cacheReadonly");

    await expect(
      runtime.create("SyncItem", { Name: "Denied before sync" }, viewerContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);
  });

  it("blocks online-required writes while offline", async () => {
    const runtime = createSyncModeRuntime("onlineRequired");

    await expect(
      runtime.create("SyncItem", { Name: "Offline item" }, offlineAdminContext),
    ).rejects.toMatchObject({
      decision: {
        mode: "onlineRequired",
        online: false,
        allowed: false,
      },
    });
    expect(runtime.operationLog.getOperations()).toEqual([]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("allows local-private writes without adding them to the sync queue", async () => {
    const runtime = createSyncModeRuntime("localPrivate");
    const item = await runtime.create("SyncItem", { Name: "Private item" }, adminContext);

    await runtime.update("SyncItem", item.meta.guid, { Name: "Private update" }, adminContext);

    expect(runtime.operationLog.getOperations().map((operation) => operation.operation)).toEqual([
      "create",
      "update",
    ]);
    expect(runtime.syncQueue.getEntries()).toEqual([]);
  });

  it("records audit events and local operation log entries", async () => {
    const runtime = createRuntime();
    const user = await runtime.create(
      "User",
      { Name: "Katherine Johnson", Email: "katherine@example.com" },
      adminContext,
    );
    await runtime.update("User", user.meta.guid, { Phone: "555" }, adminContext);
    await runtime.delete("User", user.meta.guid, adminContext);

    const purchaseOrder = await runtime.create(
      "PurchaseOrder",
      { PONumber: "PO-400", Supplier: "Globex", Value: 750 },
      requesterContext,
    );
    await runtime.transition("PurchaseOrder", purchaseOrder.meta.guid, "submit", requesterContext);

    expect(runtime.auditService.getEvents().map((event) => event.operation)).toEqual([
      "create",
      "update",
      "delete",
      "create",
      "transition",
    ]);
    expect(runtime.auditService.getEvents().at(-1)).toMatchObject({
      object: "PurchaseOrder",
      recordId: purchaseOrder.meta.guid,
      operation: "transition",
      lifecycleAction: "submit",
      fromState: "Draft",
      toState: "Submitted",
      actorId: "requester-1",
      before: expect.objectContaining({
        Status: "Draft",
      }),
      after: expect.objectContaining({
        Status: "Submitted",
      }),
      metadata: expect.objectContaining({
        state: "Submitted",
      }),
    });
    expect(runtime.operationLog.getOperations().map((operation) => operation.operation)).toEqual([
      "create",
      "update",
      "delete",
      "create",
      "transition",
    ]);
    expect(runtime.operationLog.getOperations().at(-1)).toMatchObject({
      operation: "transition",
      lifecycleAction: "submit",
      fromState: "Draft",
      toState: "Submitted",
      status: "pending",
    });
    expect(runtime.syncQueue.getEntries().map((entry) => entry.operation.operation)).toEqual([
      "create",
      "update",
      "delete",
      "create",
      "transition",
    ]);
  });

  it("executes a command that creates a parent record and links an existing child atomically", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createCommandWorkflowModel()));
    const setList = await runtime.create("SetList", { Name: "Festival opener" }, adminContext);

    const result = await runtime.executeCommand(
      "CreateEventWithSetList",
      { EventName: "Launch show", SetList: setList.meta.guid },
      adminContext,
    );

    expect(result.steps.map((step) => [step.step, step.objectName])).toEqual([
      ["createEvent", "Event"],
      ["linkSetList", "EventSetList"],
    ]);
    expect(result.steps[1]?.record.values).toMatchObject({
      Event: result.steps[0]?.recordId,
      SetList: setList.meta.guid,
      Position: 1,
    });
    // Every step is still logged for local history; the command entry that
    // follows them is the one the sync queue carries, so the authority is told
    // about the transaction rather than about its two writes.
    expect(runtime.operationLog.getOperations().slice(-3)).toMatchObject([
      {
        operation: "create",
        object: "Event",
        commandName: "CreateEventWithSetList",
        commandStep: "createEvent",
        commandTransactionId: "cmd-txn-1",
      },
      {
        operation: "create",
        object: "EventSetList",
        commandName: "CreateEventWithSetList",
        commandStep: "linkSetList",
        commandTransactionId: "cmd-txn-1",
      },
      {
        operation: "command",
        commandName: "CreateEventWithSetList",
        commandTransactionId: "cmd-txn-1",
        command: {
          name: "CreateEventWithSetList",
          recordIds: [
            { step: "createEvent", objectName: "Event", recordId: result.steps[0]?.recordId },
            {
              step: "linkSetList",
              objectName: "EventSetList",
              recordId: result.steps[1]?.recordId,
            },
          ],
        },
      },
    ]);
    // One queue entry for the whole command, never one per step.
    expect(
      runtime.syncQueue
        .getEntries()
        .filter((entry) => entry.operation.commandTransactionId === "cmd-txn-1")
        .map((entry) => entry.operation.operation),
    ).toEqual(["command"]);
  });

  it("updates records in two object collections as one command intent", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createCommandWorkflowModel()));
    const user = await runtime.create(
      "User",
      { Name: "Grace Hopper", Email: "grace@example.com" },
      adminContext,
    );
    const setList = await runtime.create("SetList", { Name: "Original set" }, adminContext);

    await runtime.executeCommand(
      "RenameUserAndSetList",
      {
        User: user.meta.guid,
        UserName: "Rear Admiral Hopper",
        SetList: setList.meta.guid,
        SetListName: "Compiler classics",
      },
      adminContext,
    );

    await expect(runtime.read("User", user.meta.guid, adminContext)).resolves.toMatchObject({
      values: { Name: "Rear Admiral Hopper" },
    });
    await expect(runtime.read("SetList", setList.meta.guid, adminContext)).resolves.toMatchObject({
      values: { Name: "Compiler classics" },
    });
    expect(runtime.auditService.getEvents().slice(-2)).toMatchObject([
      {
        operation: "update",
        object: "User",
        commandName: "RenameUserAndSetList",
        commandStep: "renameUser",
        commandTransactionId: "cmd-txn-1",
      },
      {
        operation: "update",
        object: "SetList",
        commandName: "RenameUserAndSetList",
        commandStep: "renameSetList",
        commandTransactionId: "cmd-txn-1",
      },
    ]);
  });

  it("rejects multi-record commands when the backend does not support transactions", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createCommandWorkflowModel()), {
      storage: new NonTransactionalMemoryBackend(),
    });
    const setList = await runtime.create("SetList", { Name: "Backend unsupported" }, adminContext);

    await expect(
      runtime.executeCommand(
        "CreateEventWithSetList",
        { EventName: "Blocked show", SetList: setList.meta.guid },
        adminContext,
      ),
    ).rejects.toMatchObject({
      code: "ADL_STORAGE_ERROR",
      message: "Multi-record command transaction is unsupported by the configured storage backend.",
    });

    await expect(runtime.search("Event", {}, adminContext)).resolves.toHaveLength(0);
    await expect(runtime.search("EventSetList", {}, adminContext)).resolves.toHaveLength(0);
    expect(runtime.operationLog.getOperations()).toHaveLength(1);
  });

  it("reads an existing record and seeds a new one from it, overriding one field rather than copying it", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createCommandReadStepModel()));
    const source = await runtime.create(
      "Event",
      {
        VenueName: "The Forum",
        ContactName: "Jamie Rivera",
        AmountCents: 250000,
        EventDate: "2026-01-10",
      },
      adminContext,
    );

    const result = await runtime.executeCommand(
      "DuplicateEvent",
      { SourceEventId: source.meta.guid, NewDate: "2026-03-20" },
      adminContext,
    );

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.objectName).toBe("Event");
    expect(result.steps[0]?.recordId).not.toBe(source.meta.guid);
    // VenueName, ContactName and AmountCents are copied from the record the
    // READ step bound; EventDate comes from the command's own input instead
    // of the source record, proving a later step can override rather than
    // blindly copy a field the READ step made available.
    expect(result.steps[0]?.record.values).toMatchObject({
      VenueName: "The Forum",
      ContactName: "Jamie Rivera",
      AmountCents: 250000,
      EventDate: "2026-03-20",
    });

    // The READ step writes nothing of its own, so it produces neither a
    // per-step operation-log entry nor a step count on the command wrapper:
    // only the one write the command actually made is logged, alongside the
    // seed record's own create and the command's wrapper entry.
    expect(runtime.operationLog.getOperations().map((operation) => operation.operation)).toEqual([
      "create",
      "create",
      "command",
    ]);
  });

  it("fails the whole command when the READ step's target record does not exist", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createCommandReadStepModel()));

    await expect(
      runtime.executeCommand(
        "DuplicateEvent",
        { SourceEventId: "missing-event", NewDate: "2026-03-20" },
        adminContext,
      ),
    ).rejects.toBeInstanceOf(StorageError);

    await expect(runtime.search("Event", {}, adminContext)).resolves.toHaveLength(0);
  });

  it("fails the whole command when the READ step is denied by the caller's read policy", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createCommandReadStepModel()));
    const source = await runtime.create(
      "Event",
      {
        VenueName: "The Forum",
        ContactName: "Jamie Rivera",
        AmountCents: 250000,
        EventDate: "2026-01-10",
      },
      adminContext,
    );
    const outsiderContext: RuntimeContext = {
      userId: "outsider-1",
      roles: ["Outsider"],
      channel: "api",
      now: fixedNow,
    };

    await expect(
      runtime.executeCommand(
        "DuplicateEvent",
        { SourceEventId: source.meta.guid, NewDate: "2026-03-20" },
        outsiderContext,
      ),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    // Nothing was written: the source record is still the only one, and the
    // read policy denial reached before any write was planned.
    await expect(runtime.search("Event", {}, adminContext)).resolves.toHaveLength(1);
  });
});

describe("AUTO_ID minting (Phase 74)", () => {
  it("mints PREFIX/PAD values in order when no explicit value is supplied", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createAutoIdModel()));

    const first = await runtime.create("Invoice", { Branch: "Denver", Amount: 10 }, adminContext);
    const second = await runtime.create("Invoice", { Branch: "Denver", Amount: 20 }, adminContext);
    const third = await runtime.create("Invoice", { Branch: "Denver", Amount: 30 }, adminContext);

    expect(first.values.InvoiceNumber).toBe("INV-0001");
    expect(second.values.InvoiceNumber).toBe("INV-0002");
    expect(third.values.InvoiceNumber).toBe("INV-0003");
  });

  it("respects an explicit caller-supplied value instead of minting one", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createAutoIdModel()));

    const supplied = await runtime.create(
      "Invoice",
      { Branch: "Denver", Amount: 10, InvoiceNumber: "LEGACY-42" },
      adminContext,
    );
    expect(supplied.values.InvoiceNumber).toBe("LEGACY-42");

    // Minting still resumes from the highest number it can find, ignoring the
    // foreign, non-prefixed value rather than letting it corrupt the sequence.
    const minted = await runtime.create("Invoice", { Branch: "Denver", Amount: 20 }, adminContext);
    expect(minted.values.InvoiceNumber).toBe("INV-0001");
  });

  it("gives each SCOPE value its own independent sequence", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createAutoIdModel()));

    const denver1 = await runtime.create("Invoice", { Branch: "Denver", Amount: 10 }, adminContext);
    const austin1 = await runtime.create("Invoice", { Branch: "Austin", Amount: 10 }, adminContext);
    const denver2 = await runtime.create("Invoice", { Branch: "Denver", Amount: 20 }, adminContext);
    const austin2 = await runtime.create("Invoice", { Branch: "Austin", Amount: 20 }, adminContext);

    expect(denver1.values.InvoiceNumber).toBe("INV-0001");
    expect(austin1.values.InvoiceNumber).toBe("INV-0001");
    expect(denver2.values.InvoiceNumber).toBe("INV-0002");
    expect(austin2.values.InvoiceNumber).toBe("INV-0002");
  });

  it("does not reuse a deleted record's minted number", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createAutoIdModel()));

    const first = await runtime.create("Invoice", { Branch: "Denver", Amount: 10 }, adminContext);
    expect(first.values.InvoiceNumber).toBe("INV-0001");

    await runtime.delete("Invoice", first.meta.guid, adminContext);

    const second = await runtime.create("Invoice", { Branch: "Denver", Amount: 20 }, adminContext);
    expect(second.values.InvoiceNumber).toBe("INV-0002");
  });

  it("mints for a command CREATE step exactly as it does for a direct create", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(createAutoIdModel()));

    await runtime.create("Invoice", { Branch: "Denver", Amount: 10 }, adminContext);

    const result = await runtime.executeCommand(
      "CreateInvoiceViaCommand",
      { Branch: "Denver" },
      adminContext,
    );

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.record.values.InvoiceNumber).toBe("INV-0002");
  });

  it("compiles a REQUIRED AUTO_ID field with no DEFAULT cleanly and mints it at runtime", async () => {
    // Proves the Phase 72 refusal (ADL_AUTO_ID_NO_DEFAULT) is gone and the
    // construct it used to refuse is now fully functional, through both the
    // .adl and .adlj front ends.
    const adlResult = compileAdl(`APP AutoIdNoDefaultRuntime
END.APP

ROLE Admin

OBJECT Item
  FIELD Code TEXT REQUIRED AUTO_ID
  FIELD Label TEXT
END.OBJECT

POLICY ItemPolicy ON Item
  RULE allowAdminAllItemOps ALLOW * ROLE Admin
END.POLICY
`);
    expect(adlResult.diagnostics).toEqual([]);

    const adljResult = compileAdlj(
      JSON.stringify({
        app: { name: "AutoIdNoDefaultRuntime" },
        // Declared explicitly (both empty) to match what .adl always resolves
        // for undeclared contexts/readModels — see
        // learnings/implementation/adlj-json-authoring-surface.md.
        contexts: [],
        readModels: [],
        roles: [{ name: "Admin" }],
        objects: [
          {
            name: "Item",
            fields: [
              { name: "Code", type: "text", required: true, autoId: {} },
              { name: "Label", type: "text" },
            ],
          },
        ],
        policies: [
          {
            name: "ItemPolicy",
            object: "Item",
            rules: [
              {
                name: "allowAdminAllItemOps",
                effect: "allow",
                principal: { match: "specific", roles: ["Admin"] },
                action: "*",
              },
            ],
          },
        ],
      }),
    );
    expect(adljResult.diagnostics).toEqual([]);
    expect(adljResult.model).toEqual(adlResult.model);

    // Both front ends resolve to the same model, but exercise each compiled
    // result directly through its own runtime rather than assuming one
    // stands in for the other.
    const adlRuntime = new ApplicationRuntime(adlResult.model);
    const createdViaAdl = await adlRuntime.create("Item", { Label: "First" }, adminContext);
    expect(createdViaAdl.values.Code).toBe("1");

    const adljRuntime = new ApplicationRuntime(adljResult.model);
    const createdViaAdlj = await adljRuntime.create("Item", { Label: "First" }, adminContext);
    expect(createdViaAdlj.values.Code).toBe("1");
  });
});

function createAutoIdModel(): PartialApplicationModel {
  return {
    app: { name: "AutoIdDemo" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "Invoice",
        businessKey: "InvoiceNumber",
        displayField: "InvoiceNumber",
        fields: [
          {
            name: "InvoiceNumber",
            type: "text",
            required: true,
            autoId: { prefix: "INV-", pad: 4, scopeField: "Branch" },
          },
          { name: "Branch", type: "text", required: true },
          { name: "Amount", type: "number" },
        ],
      },
    ],
    commands: [
      {
        name: "CreateInvoiceViaCommand",
        label: "Create invoice via command",
        inputs: [{ name: "Branch", type: "text", required: true }],
        steps: [
          {
            name: "invoice",
            action: "create",
            object: "Invoice",
            authority: "command",
            values: {
              Branch: { kind: "input", name: "Branch" },
            },
          },
        ],
      },
    ],
    policies: [
      {
        name: "InvoicePolicy",
        object: "Invoice",
        rules: [
          {
            name: "allowAdminInvoiceOps",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  } satisfies PartialApplicationModel;
}

function createRuntime(): ApplicationRuntime {
  return new ApplicationRuntime(resolveApplicationModel(runtimePartialModel));
}

function createSyncModeRuntime(mode: SyncMode): ApplicationRuntime {
  return new ApplicationRuntime(resolveApplicationModel(createSyncModePartialModel(mode)));
}

function createCommandWorkflowModel(): PartialApplicationModel {
  return {
    app: {
      name: "CommandWorkflowDemo",
    },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "User",
        businessKey: "Email",
        displayField: "Name",
        fields: [
          { name: "Name", type: "text", required: true },
          { name: "Email", type: "text", required: true },
        ],
      },
      {
        name: "SetList",
        businessKey: "Name",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "Event",
        businessKey: "Name",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
      },
      {
        name: "EventSetList",
        businessKey: "Event",
        displayField: "Event",
        fields: [
          {
            name: "Event",
            type: "text",
            required: true,
            lookup: { targetObject: "Event", displayField: "Name" },
          },
          {
            name: "SetList",
            type: "text",
            required: true,
            lookup: { targetObject: "SetList", displayField: "Name" },
          },
          { name: "Position", type: "number", required: true },
        ],
        constraints: [
          {
            name: "uniqueSetListPerEvent",
            kind: "unique",
            fields: ["SetList"],
            scopeFields: ["Event"],
          },
          {
            name: "orderedSetLists",
            kind: "ordered",
            parentField: "Event",
            positionField: "Position",
            minPosition: 1,
          },
        ],
      },
    ],
    commands: [
      {
        name: "CreateEventWithSetList",
        inputs: [
          { name: "EventName", type: "text", required: true },
          { name: "SetList", type: "text", required: true },
        ],
        steps: [
          {
            name: "createEvent",
            action: "create",
            object: "Event",
            authority: "command",
            values: {
              Name: { kind: "input", name: "EventName" },
            },
          },
          {
            name: "linkSetList",
            action: "create",
            object: "EventSetList",
            authority: "command",
            values: {
              Event: { kind: "stepMeta", step: "createEvent", property: "guid" },
              SetList: { kind: "input", name: "SetList" },
              Position: { kind: "literal", value: 1 },
            },
          },
        ],
      },
      {
        name: "RenameUserAndSetList",
        inputs: [
          { name: "User", type: "text", required: true },
          { name: "UserName", type: "text", required: true },
          { name: "SetList", type: "text", required: true },
          { name: "SetListName", type: "text", required: true },
        ],
        steps: [
          {
            name: "renameUser",
            action: "update",
            object: "User",
            authority: "command",
            recordId: { kind: "input", name: "User" },
            patch: {
              Name: { kind: "input", name: "UserName" },
            },
          },
          {
            name: "renameSetList",
            action: "update",
            object: "SetList",
            authority: "command",
            recordId: { kind: "input", name: "SetList" },
            patch: {
              Name: { kind: "input", name: "SetListName" },
            },
          },
        ],
      },
    ],
    policies: ["User", "SetList", "Event", "EventSetList"].map((object) => ({
      name: `${object}Policy`,
      object,
      rules: [
        {
          name: `allowAdmin${object}Ops`,
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "*",
        },
      ],
    })),
  };
}

function createCommandReadStepModel(): PartialApplicationModel {
  return {
    app: { name: "CommandReadStepDemo" },
    roles: [{ name: "Admin" }, { name: "Outsider" }],
    objects: [
      {
        name: "Event",
        businessKey: "VenueName",
        displayField: "VenueName",
        fields: [
          { name: "VenueName", type: "text", required: true },
          { name: "ContactName", type: "text", required: true },
          { name: "AmountCents", type: "number", required: true },
          { name: "EventDate", type: "date", required: true },
        ],
      },
    ],
    commands: [
      {
        name: "DuplicateEvent",
        label: "Duplicate event",
        inputs: [
          { name: "SourceEventId", type: "text", required: true },
          { name: "NewDate", type: "date", required: true },
        ],
        steps: [
          {
            name: "source",
            action: "read",
            object: "Event",
            recordId: { kind: "input", name: "SourceEventId" },
          },
          {
            name: "duplicate",
            action: "create",
            object: "Event",
            authority: "command",
            values: {
              VenueName: { kind: "stepField", step: "source", field: "VenueName" },
              ContactName: { kind: "stepField", step: "source", field: "ContactName" },
              AmountCents: { kind: "stepField", step: "source", field: "AmountCents" },
              // Deliberately from the command's own input, not `STEP source FIELD
              // EventDate` — proving a later step can override rather than
              // blindly copy a field the READ step made available.
              EventDate: { kind: "input", name: "NewDate" },
            },
          },
        ],
      },
    ],
    policies: [
      {
        name: "EventPolicy",
        object: "Event",
        rules: [
          {
            name: "allowAdminEventOps",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  };
}

class NonTransactionalMemoryBackend implements ObjectStorageBackend {
  readonly supportsTransactions = false;

  private readonly delegate = new InMemoryObjectStorageBackend();

  create(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.delegate.create(objectName, record);
  }

  read(objectName: string, id: string): Promise<StoredObjectRecord | null> {
    return this.delegate.read(objectName, id);
  }

  update(objectName: string, record: StoredObjectRecord): Promise<void> {
    return this.delegate.update(objectName, record);
  }

  delete(objectName: string, tombstone: StoredObjectRecord): Promise<void> {
    return this.delegate.delete(objectName, tombstone);
  }

  search(request: ObjectStorageSearchRequest): Promise<StoredObjectRecord[]> {
    return this.delegate.search(request);
  }

  listRecords(): Promise<PersistedObjectRecord[]> {
    return this.delegate.listRecords();
  }

  readApplicationMetadata(): Promise<PersistedApplicationMetadata | null> {
    return this.delegate.readApplicationMetadata();
  }

  writeApplicationMetadata(metadata: PersistedApplicationMetadata): Promise<void> {
    return this.delegate.writeApplicationMetadata(metadata);
  }
}

async function createSeededBandRuntime(partialModel = createBandRuntimePartialModel()): Promise<{
  runtime: ApplicationRuntime;
  musicianContext: RuntimeContext;
  firstBandContext: RuntimeContext;
  secondBandContext: RuntimeContext;
  firstBand: StoredObjectRecord;
  secondBand: StoredObjectRecord;
  firstGig: StoredObjectRecord;
  secondGig: StoredObjectRecord;
}> {
  const runtime = new ApplicationRuntime(resolveApplicationModel(partialModel));
  const systemContext: RuntimeContext = {
    userId: "system-admin",
    roles: ["SystemAdmin"],
    channel: "api",
    now: fixedNow,
  };

  const musician = await runtime.create(
    "User",
    { Name: "Casey Morgan", Email: "casey@example.com" },
    systemContext,
  );
  const firstBand = await runtime.create("Band", { Name: "The Alphas" }, systemContext);
  const secondBand = await runtime.create("Band", { Name: "The Betas" }, systemContext);

  await runtime.create(
    "BandMember",
    { User: musician.meta.guid, Band: firstBand.meta.guid, Role: "BandAdmin" },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  await runtime.create(
    "BandMember",
    { User: musician.meta.guid, Band: secondBand.meta.guid, Role: "BandMember" },
    contextForBand(systemContext, secondBand.meta.guid),
  );

  const firstGig = await runtime.create(
    "Gig",
    {
      Band: firstBand.meta.guid,
      Date: "2026-08-01",
      Venue: "Alpha Hall",
    },
    contextForBand(systemContext, firstBand.meta.guid),
  );
  const secondGig = await runtime.create(
    "Gig",
    {
      Band: secondBand.meta.guid,
      Date: "2026-08-02",
      Venue: "Beta Hall",
    },
    contextForBand(systemContext, secondBand.meta.guid),
  );

  const musicianContext: RuntimeContext = {
    userId: musician.meta.guid,
    roles: [],
    channel: "api",
    now: fixedNow,
  };

  return {
    runtime,
    musicianContext,
    firstBandContext: await runtime.withSelectedContext(
      "Band",
      firstBand.meta.guid,
      musicianContext,
    ),
    secondBandContext: await runtime.withSelectedContext(
      "Band",
      secondBand.meta.guid,
      musicianContext,
    ),
    firstBand,
    secondBand,
    firstGig,
    secondGig,
  };
}

function contextForBand(context: RuntimeContext, bandId: string): RuntimeContext {
  return {
    ...context,
    selectedContexts: {
      ...(context.selectedContexts ?? {}),
      Band: bandId,
    },
  };
}

function createBandRuntimePartialModel(): PartialApplicationModel {
  return {
    ...bandContextPartialModel,
    roles: [
      { name: "SystemAdmin" },
      { name: "BandMember" },
      { name: "BandAdmin", inherits: ["BandMember"] },
    ],
    objects: bandContextPartialModel.objects.map((object) =>
      object.name === "Gig"
        ? {
            ...object,
            fields: [...(object.fields ?? []), { name: "Status", type: "text", required: true }],
            lifecycle: {
              name: "GigLifecycle",
              stateField: "Status",
              initialState: "Draft",
              states: [{ name: "Draft" }, { name: "Published" }],
              actions: [
                {
                  name: "publish",
                  from: "Draft",
                  to: "Published",
                  policyRefs: ["GigPolicy"],
                },
              ],
            },
          }
        : object,
    ),
    policies: [
      {
        name: "UserBandRuntimePolicy",
        object: "User",
        rules: [
          {
            name: "allowSystemAdminAllUserOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
        ],
      },
      {
        name: "BandRuntimePolicy",
        object: "Band",
        rules: [
          {
            name: "allowSystemAdminAllBandOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
          {
            name: "allowBandMemberReadBand",
            effect: "allow",
            principal: { match: "specific", roles: ["BandMember"] },
            action: "read",
          },
        ],
      },
      {
        name: "BandMemberRuntimePolicy",
        object: "BandMember",
        rules: [
          {
            name: "allowSystemAdminAllBandMemberOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
        ],
      },
      {
        name: "GigPolicy",
        object: "Gig",
        rules: [
          {
            name: "allowSystemAdminAllGigOps",
            effect: "allow",
            principal: { match: "specific", roles: ["SystemAdmin"] },
            action: "*",
          },
          {
            name: "allowBandMemberReadGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandMember"] },
            action: "read",
          },
          {
            name: "allowBandMemberSearchGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandMember"] },
            action: "search",
          },
          {
            name: "allowBandAdminCreateDraftGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "create",
            state: "Draft",
          },
          {
            name: "allowBandAdminUpdateDraftGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "update",
            state: "Draft",
          },
          {
            name: "allowBandAdminDeleteGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "delete",
          },
          {
            name: "allowBandAdminPublishGig",
            effect: "allow",
            principal: { match: "specific", roles: ["BandAdmin"] },
            action: "transition",
            state: "Draft",
            lifecycleAction: "publish",
          },
        ],
      },
    ],
  };
}

function createBandDatasetPartialModel(options: {
  gigSyncScope: SyncScope;
  readModelSourceScope: ReadModelSourceScope;
}): PartialApplicationModel {
  const partial = createBandRuntimePartialModel();

  return {
    ...partial,
    objects: partial.objects.map((object) => {
      if (object.name === "User") {
        return {
          ...object,
          sync: { mode: "localFirst", scope: "currentUser" },
        };
      }

      if (object.name === "Band") {
        return {
          ...object,
          sync: { mode: "localFirst", scope: "allAvailableContexts" },
        };
      }

      if (object.name === "BandMember") {
        return {
          ...object,
          sync: { mode: "localFirst", scope: "allAvailableContexts" },
        };
      }

      if (object.name === "Gig") {
        return {
          ...object,
          sync: { mode: "localFirst", scope: options.gigSyncScope },
        };
      }

      return object;
    }),
    readModels: (partial.readModels ?? []).map((readModel) => ({
      ...readModel,
      sources: readModel.sources.map((source) => ({
        ...source,
        scope: options.readModelSourceScope,
      })),
    })),
  };
}

interface BoundedUserScopeOptions {
  window?: { field: string; days?: number; limit?: number };
  predicate?: ResolvedExpression;
  withCrossUserReadModel?: boolean;
}

/**
 * A model whose bounded object declares a *context* scope of `currentUser` and,
 * independently, a bound. Phase 62 could not express this at all, and the pair
 * is what every Phase 64 dataset test needs: two users' records, so a limit that
 * ranks across users is visible, and one record each side of the day span.
 */
function createBoundedUserScopePartialModel(
  options: BoundedUserScopeOptions,
): PartialApplicationModel {
  return {
    app: { name: "BoundedUserScope" },
    roles: [{ name: "Member" }],
    policies: [
      {
        name: "UserPolicy",
        object: "User",
        rules: [
          {
            name: "allowMemberAllUserOps",
            effect: "allow",
            principal: { match: "specific", roles: ["Member"] },
            action: "*",
          },
        ],
      },
      {
        name: "TimeEntryPolicy",
        object: "TimeEntry",
        rules: [
          {
            name: "allowMemberAllTimeEntryOps",
            effect: "allow",
            principal: { match: "specific", roles: ["Member"] },
            action: "*",
          },
        ],
      },
    ],
    objects: [
      {
        name: "User",
        businessKey: "Email",
        displayField: "Name",
        fields: [
          { name: "Name", type: "text", required: true },
          { name: "Email", type: "text", required: true },
        ],
        sync: { mode: "localFirst", scope: "currentUser" },
      },
      {
        name: "TimeEntry",
        displayField: "Title",
        fields: [
          {
            name: "User",
            type: "text",
            required: true,
            lookup: { targetObject: "User", displayField: "Name" },
          },
          { name: "Date", type: "date", required: true },
          { name: "Title", type: "text", required: true },
          { name: "Billable", type: "boolean", defaultValue: true },
        ],
        sync: {
          mode: "localFirst",
          scope: "currentUser",
          ...(options.window === undefined ? {} : { window: options.window }),
          ...(options.predicate === undefined ? {} : { predicate: options.predicate }),
        },
      },
    ],
    ...(options.withCrossUserReadModel === true
      ? {
          readModels: [
            {
              name: "TeamTimeEntries",
              sources: [{ name: "entry", object: "TimeEntry", scope: "all" }],
              fields: [
                { name: "Title", source: "entry", field: "Title" },
                { name: "Date", source: "entry", field: "Date" },
              ],
            },
          ],
        }
      : {}),
  } as PartialApplicationModel;
}

async function createBoundedUserScopeRuntime(options: BoundedUserScopeOptions): Promise<{
  runtime: ApplicationRuntime;
  alexContext: RuntimeContext;
  blakeContext: RuntimeContext;
  alexRecent: StoredObjectRecord;
  alexMiddle: StoredObjectRecord;
  alexOldest: StoredObjectRecord;
  alexOutsideWindow: StoredObjectRecord;
  blakeRecent: StoredObjectRecord;
  blakeMiddle: StoredObjectRecord;
  blakeOldest: StoredObjectRecord;
  blakeOutsideWindow: StoredObjectRecord;
}> {
  const runtime = new ApplicationRuntime(
    resolveApplicationModel(createBoundedUserScopePartialModel(options)),
  );
  const seedContext: RuntimeContext = {
    userId: "seed-1",
    roles: ["Member"],
    channel: "api",
    now: fixedNow,
  };

  const alex = await runtime.create(
    "User",
    { Name: "Alex", Email: "alex@example.com" },
    seedContext,
  );
  const blake = await runtime.create(
    "User",
    { Name: "Blake", Email: "blake@example.com" },
    seedContext,
  );

  const entry = async (
    user: StoredObjectRecord,
    date: string,
    title: string,
    billable: boolean,
  ): Promise<StoredObjectRecord> =>
    runtime.create(
      "TimeEntry",
      { User: user.meta.guid, Date: date, Title: title, Billable: billable },
      seedContext,
    );

  // Blake's entries are all newer than Alex's. `fixedNow` is 2026-07-07, so
  // everything dated in June is inside a 30-day window and the January entries
  // are outside it.
  const alexOutsideWindow = await entry(alex, "2026-01-05", "Alex January", true);
  const alexOldest = await entry(alex, "2026-06-10", "Alex oldest", true);
  const alexMiddle = await entry(alex, "2026-06-11", "Alex middle", false);
  const alexRecent = await entry(alex, "2026-06-12", "Alex recent", true);
  const blakeOutsideWindow = await entry(blake, "2026-01-06", "Blake January", true);
  const blakeOldest = await entry(blake, "2026-06-20", "Blake oldest", true);
  const blakeMiddle = await entry(blake, "2026-06-21", "Blake middle", true);
  const blakeRecent = await entry(blake, "2026-06-22", "Blake recent", true);

  return {
    runtime,
    alexContext: { userId: alex.meta.guid, roles: ["Member"], channel: "api", now: fixedNow },
    blakeContext: { userId: blake.meta.guid, roles: ["Member"], channel: "api", now: fixedNow },
    alexRecent,
    alexMiddle,
    alexOldest,
    alexOutsideWindow,
    blakeRecent,
    blakeMiddle,
    blakeOldest,
    blakeOutsideWindow,
  };
}

function createSyncModePartialModel(mode: SyncMode): PartialApplicationModel {
  return {
    app: {
      name: "SyncModeRuntime",
    },
    roles: [{ name: "Admin" }, { name: "Viewer" }],
    objects: [
      {
        name: "SyncItem",
        businessKey: "Name",
        displayField: "Name",
        fields: [{ name: "Name", type: "text", required: true }],
        sync: { mode },
      },
    ],
    policies: [
      {
        name: "SyncItemPolicy",
        object: "SyncItem",
        rules: [
          {
            name: "allowAdminSyncItemOps",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
          {
            name: "allowViewerSyncItemRead",
            effect: "allow",
            principal: { match: "specific", roles: ["Viewer"] },
            action: "read",
          },
        ],
      },
    ],
  };
}

function createStoredSyncRecord(object: ResolvedObject): StoredObjectRecord {
  return {
    meta: {
      guid: "sync-item-1",
      object: object.name,
      schemaVersion: object.schemaVersion,
      revision: "rev-seeded",
      createdAt: fixedNow.toISOString(),
      createdBy: "sync-seed",
      updatedAt: fixedNow.toISOString(),
      updatedBy: "sync-seed",
      syncStatus: "synced",
    },
    values: {
      Name: "Cached item",
    },
  };
}

function requireResolvedObject(object: ResolvedObject | undefined): ResolvedObject {
  if (object === undefined) {
    throw new Error("Expected resolved sync test object.");
  }

  return object;
}
