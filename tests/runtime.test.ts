import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  HookError,
  LifecycleError,
  MASKED_POLICY_FIELD_VALUE,
  ModelValidationError,
  PolicyDeniedError,
  RuntimeValidationError,
  resolveApplicationModel,
} from "../src/index.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

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
      syncStatus: "local",
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
  });
});

function createRuntime(): ApplicationRuntime {
  return new ApplicationRuntime(resolveApplicationModel(runtimePartialModel));
}
