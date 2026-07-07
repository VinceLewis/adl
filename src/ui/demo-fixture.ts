import {
  ApplicationRuntime,
  IndexedDbObjectStorageBackend,
  resolveApplicationModel,
} from "../index.js";
import type {
  ObjectStorageBackend,
  PartialApplicationModel,
  ResolvedApplicationModel,
  RuntimeContext,
} from "../index.js";

export const BROWSER_DEMO_DATABASE_NAME = "adl-browser-runtime-demo";

export const browserDemoContext: RuntimeContext = {
  userId: "admin-ui",
  roles: ["Admin"],
  channel: "ui",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

export const browserDemoPartialModel = {
  app: {
    name: "ADL Runtime Demo",
    startView: "UserList",
    theme: "CorporateLight",
  },
  roles: [{ name: "Admin" }, { name: "Viewer" }, { name: "Requester" }, { name: "Approver" }],
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
        { name: "SystemRole", type: "text", defaultValue: "Standard" },
        { name: "SecretNote", type: "text" },
        { name: "Status", type: "text", required: true },
      ],
      lifecycle: {
        name: "UserLifecycle",
        stateField: "Status",
        initialState: "Draft",
        states: [{ name: "Draft" }, { name: "Active" }, { name: "Suspended", terminal: true }],
        actions: [
          {
            name: "activate",
            label: "Activate",
            from: "Draft",
            to: "Active",
            policyRefs: ["UserPolicy"],
          },
          {
            name: "suspend",
            label: "Suspend",
            from: "Active",
            to: "Suspended",
            policyRefs: ["UserPolicy"],
          },
        ],
      },
      views: [
        {
          name: "UserList",
          kind: "list",
          fields: ["Name", "Email", "Phone", "SystemRole", "Status"],
          searchFields: ["Name", "Email"],
          actions: ["create", "read"],
        },
        {
          name: "UserForm",
          kind: "form",
          fields: ["Name", "Email", "Phone", "Active", "SystemRole", "SecretNote", "Status"],
          actions: ["save", "delete"],
        },
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
            label: "Submit",
            from: "Draft",
            to: "Submitted",
            policyRefs: ["PurchaseOrderPolicy"],
          },
          {
            name: "approve",
            label: "Approve",
            from: "Submitted",
            to: "Approved",
            policyRefs: ["PurchaseOrderPolicy"],
          },
        ],
      },
      views: [
        {
          name: "PurchaseOrderList",
          kind: "list",
          fields: ["PONumber", "Supplier", "Value", "Status"],
          searchFields: ["PONumber", "Supplier"],
          actions: ["create", "read"],
        },
        {
          name: "PurchaseOrderForm",
          kind: "form",
          fields: ["PONumber", "Supplier", "Value", "Status", "InternalNotes", "ApprovalComment"],
          actions: ["save", "delete"],
        },
      ],
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
          name: "maskAdminUserEmailRead",
          effect: "mask",
          principal: { match: "specific", roles: ["Admin"] },
          action: "read",
          fields: ["Email"],
        },
        {
          name: "hideAdminUserSecretNoteRead",
          effect: "hidden",
          principal: { match: "specific", roles: ["Admin"] },
          action: "read",
          fields: ["SecretNote"],
        },
        {
          name: "readonlyAdminSystemRoleUpdate",
          effect: "readonly",
          principal: { match: "specific", roles: ["Admin"] },
          action: "update",
          fields: ["SystemRole"],
        },
        {
          name: "allowViewerSearchUsers",
          effect: "allow",
          principal: { match: "specific", roles: ["Viewer"] },
          action: "search",
        },
        {
          name: "allowViewerReadUsers",
          effect: "allow",
          principal: { match: "specific", roles: ["Viewer"] },
          action: "read",
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
          name: "allowRequesterReadPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Requester", "Approver"] },
          action: "read",
        },
        {
          name: "allowRequesterSearchPurchaseOrder",
          effect: "allow",
          principal: { match: "specific", roles: ["Requester", "Approver"] },
          action: "search",
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

export function createBrowserDemoModel(): ResolvedApplicationModel {
  return resolveApplicationModel(browserDemoPartialModel);
}

export function createBrowserDemoRuntime(storage?: ObjectStorageBackend): ApplicationRuntime {
  return new ApplicationRuntime(createBrowserDemoModel(), {
    ...(storage === undefined ? {} : { storage }),
  });
}

export function createPersistentBrowserDemoRuntime(
  model: ResolvedApplicationModel = createBrowserDemoModel(),
): ApplicationRuntime {
  return new ApplicationRuntime(model, {
    storage: new IndexedDbObjectStorageBackend({
      databaseName: BROWSER_DEMO_DATABASE_NAME,
    }),
  });
}

export async function seedBrowserDemoRuntime(
  runtime: ApplicationRuntime,
  context: RuntimeContext = browserDemoContext,
): Promise<void> {
  await runtime.create(
    "User",
    {
      Name: "Ada Lovelace",
      Email: "ada@example.com",
      Phone: "020 7946 0100",
      SystemRole: "Standard",
      SecretNote: "Founder account",
    },
    context,
  );

  const activeUser = await runtime.create(
    "User",
    {
      Name: "Grace Hopper",
      Email: "grace@example.com",
      Phone: "020 7946 0110",
      SystemRole: "Operator",
      SecretNote: "Legacy import",
    },
    context,
  );
  await runtime.transition("User", activeUser.meta.guid, "activate", context);

  await runtime.create(
    "PurchaseOrder",
    {
      PONumber: "PO-100",
      Supplier: "Acme Supplies",
      Value: 1250,
      InternalNotes: "Preferred supplier",
    },
    context,
  );

  const submittedOrder = await runtime.create(
    "PurchaseOrder",
    {
      PONumber: "PO-200",
      Supplier: "Northwind",
      Value: 4200,
      InternalNotes: "Awaiting approver review",
    },
    context,
  );
  await runtime.transition("PurchaseOrder", submittedOrder.meta.guid, "submit", context);
}

export async function seedBrowserDemoRuntimeIfEmpty(
  runtime: ApplicationRuntime,
  model: ResolvedApplicationModel = createBrowserDemoModel(),
  context: RuntimeContext = browserDemoContext,
): Promise<boolean> {
  for (const object of model.objects) {
    const records = await runtime.search(
      object.name,
      {
        includeDeleted: true,
        limit: 1,
      },
      context,
    );

    if (records.length > 0) {
      return false;
    }
  }

  await seedBrowserDemoRuntime(runtime, context);
  return true;
}
