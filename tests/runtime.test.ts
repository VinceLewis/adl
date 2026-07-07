import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  LifecycleError,
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

const runtimePartialModel = {
  app: {
    name: "RuntimeDemo",
  },
  roles: [{ name: "Admin" }, { name: "Requester" }, { name: "Approver" }, { name: "Viewer" }],
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
          name: "allowViewerSearchUsers",
          effect: "allow",
          principal: { match: "specific", roles: ["Viewer"] },
          action: "search",
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
          name: "allowApproverApprovePurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Approver"] },
          action: "transition",
          state: "Submitted",
          lifecycleAction: "approve",
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
