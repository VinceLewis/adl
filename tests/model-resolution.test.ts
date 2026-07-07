import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ADL_MODEL_VERSION,
  DEFAULT_LIFECYCLE_STATE_FIELD,
  DEFAULT_OBJECT_SCHEMA_VERSION,
  DEFAULT_SYNC_MODE,
  DEFAULT_THEME_NAME,
  SYSTEM_ID_FIELD,
  resolveApplicationModel,
  toStorageName,
} from "../src/index.js";
import type { PartialApplicationModel, ResolvedApplicationModel } from "../src/index.js";

const minimalModel = {
  app: {
    name: "CareOps",
  },
  roles: [{ name: "Admin" }],
  objects: [
    {
      name: "PatientRecord",
      businessKey: "PatientNumber",
      displayField: "Name",
      fields: [
        { name: "PatientNumber", type: "text", required: true, autoId: { prefix: "PAT-", pad: 6 } },
        { name: "Name", type: "text", required: true },
        { name: "DateOfBirth", type: "date" },
      ],
      lifecycle: {
        name: "PatientLifecycle",
        states: [{ name: "Draft" }, { name: "Active" }, { name: "Archived", terminal: true }],
        actions: [
          {
            name: "activate",
            from: "Draft",
            to: "Active",
            policyRefs: ["PatientActivationPolicy"],
          },
        ],
      },
    },
  ],
  policies: [
    {
      name: "PatientActivationPolicy",
      object: "PatientRecord",
      rules: [
        {
          name: "allowAdminActivation",
          effect: "allow",
          principal: { match: "specific", roles: ["Admin"] },
          action: "transition",
          lifecycleAction: "activate",
        },
      ],
    },
  ],
} satisfies PartialApplicationModel;

describe("resolveApplicationModel", () => {
  it("exports importable resolved model types", () => {
    const resolved = resolveApplicationModel(minimalModel);

    expectTypeOf(resolved).toEqualTypeOf<ResolvedApplicationModel>();
    expect(resolved.modelVersion).toBe(ADL_MODEL_VERSION);
  });

  it("resolves a minimal hardcoded partial model with explicit defaults", () => {
    const resolved = resolveApplicationModel(minimalModel);
    const patient = resolved.objects[0];

    expect(patient).toMatchObject({
      name: "PatientRecord",
      schemaVersion: DEFAULT_OBJECT_SCHEMA_VERSION,
      tableName: "patient_record",
      systemIdField: SYSTEM_ID_FIELD,
      businessKey: "PatientNumber",
      displayField: "Name",
    });
    expect(patient?.metadataFields.map((field) => field.name)).toEqual([
      "_guid",
      "_object",
      "_schemaVersion",
      "_revision",
      "_state",
      "_createdAt",
      "_createdBy",
      "_updatedAt",
      "_updatedBy",
      "_deletedAt",
      "_deletedBy",
      "_syncStatus",
    ]);
    expect(patient?.fields.map((field) => [field.name, field.storageName])).toEqual([
      ["PatientNumber", "patient_number"],
      ["Name", "name"],
      ["DateOfBirth", "date_of_birth"],
    ]);
    expect(patient?.lifecycle).toMatchObject({
      name: "PatientLifecycle",
      stateField: DEFAULT_LIFECYCLE_STATE_FIELD,
      initialState: "Draft",
    });
    expect(patient?.views.map((view) => [view.name, view.kind])).toEqual([
      ["PatientRecordList", "list"],
      ["PatientRecordForm", "form"],
    ]);
    expect(patient?.sync.mode).toBe(DEFAULT_SYNC_MODE);
    expect(patient?.policies).toEqual(["PatientRecordDefaultDeny", "PatientActivationPolicy"]);
    expect(resolved.policies[0]).toMatchObject({
      name: "PatientRecordDefaultDeny",
      object: "PatientRecord",
      defaultEffect: "deny",
      rules: [],
    });
    expect(resolved.app).toEqual({
      name: "CareOps",
      startView: "PatientRecordList",
      theme: DEFAULT_THEME_NAME,
    });
    expect(resolved.themes[0]?.name).toBe(DEFAULT_THEME_NAME);
    expect(resolved.sync).toEqual([
      {
        object: "PatientRecord",
        mode: "localFirst",
        scope: "all",
        conflict: "manual",
      },
    ]);
    expect(resolved.audit.enabled).toBe(true);
    expect(resolved.operationLog.operations).toEqual(["create", "update", "delete", "transition"]);
  });

  it("produces deterministic output for the same input", () => {
    const first = resolveApplicationModel(minimalModel);
    const second = resolveApplicationModel(minimalModel);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("honours explicit storage, schema, view, sync, and theme overrides", () => {
    const resolved = resolveApplicationModel({
      modelVersion: "custom-model-version",
      app: {
        name: "Ops",
        startView: "TicketBoard",
        theme: "OpsTheme",
      },
      objects: [
        {
          name: "Ticket",
          schemaVersion: 3,
          tableName: "support_ticket",
          fields: [{ name: "Ticket ID", storageName: "ticket_id", type: "text" }],
          policies: ["ExternallyDefinedTicketPolicy"],
          views: [{ name: "TicketBoard", kind: "grid", fields: ["Ticket ID"] }],
          sync: { mode: "onlineRequired", scope: "assignedToUser", conflict: "serverWins" },
        },
      ],
      themes: [{ name: "OpsTheme", tokens: { density: "compact", nav: "top" } }],
    });

    expect(resolved.modelVersion).toBe("custom-model-version");
    expect(resolved.objects[0]).toMatchObject({
      schemaVersion: 3,
      tableName: "support_ticket",
      policies: ["TicketDefaultDeny", "ExternallyDefinedTicketPolicy"],
      views: [{ name: "TicketBoard", kind: "grid", fields: ["Ticket ID"] }],
      sync: { mode: "onlineRequired", scope: "assignedToUser", conflict: "serverWins" },
    });
    expect(resolved.themes.find((theme) => theme.name === "OpsTheme")?.tokens).toMatchObject({
      density: "compact",
      nav: "top",
      colorPrimary: "#155EEF",
    });
  });

  it("normalises storage names deterministically", () => {
    expect(toStorageName("PurchaseOrder")).toBe("purchase_order");
    expect(toStorageName("Purchase Order.Status")).toBe("purchase_order_status");
    expect(toStorageName("123 Value")).toBe("_123_value");
  });
});
