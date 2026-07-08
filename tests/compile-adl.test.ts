import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  MODEL_VALIDATION_CODES,
  PolicyDeniedError,
  compileAdl,
  validateApplicationModel,
} from "../src/index.js";
import type { RuntimeContext } from "../src/index.js";

const adminContext: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

const operatorContext: RuntimeContext = {
  userId: "operator-1",
  roles: ["Operator"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

const clerkContext: RuntimeContext = {
  userId: "clerk-1",
  roles: ["Clerk"],
  channel: "api",
  now: new Date("2026-07-07T08:00:00.000Z"),
};

describe("compileAdl", () => {
  it("compiles the User ADL example into the runtime resolved model shape", async () => {
    const result = compileAdl(readExample("user.adl"));
    const user = result.model.objects.find((object) => object.name === "User");
    const theme = result.model.themes.find((candidate) => candidate.name === "DirectoryTheme");

    expect(result.diagnostics).toEqual([]);
    expect(validateApplicationModel(result.model)).toEqual([]);
    expect(result.model.app).toEqual({
      name: "UserDirectory",
      theme: "DirectoryTheme",
      startView: "UserList",
    });
    expect(theme).toMatchObject({
      name: "DirectoryTheme",
      base: "CorporateLight",
      tokens: {
        colorPrimary: "#155EEF",
        density: "compact",
        radius: "medium",
        nav: "side",
      },
    });
    expect(user?.fields.find((field) => field.name === "Email")).toMatchObject({
      type: "text",
      required: true,
      validators: [{ kind: "email" }],
    });
    expect(user?.lifecycle?.actions.find((action) => action.name === "activate")).toMatchObject({
      policyRefs: ["UserActivatePolicy"],
    });

    const runtime = new ApplicationRuntime(result.model);
    const created = await runtime.create(
      "User",
      { Name: "Ada Lovelace", Email: "ada@example.com" },
      adminContext,
    );

    expect(created.values).toMatchObject({
      Name: "Ada Lovelace",
      Email: "ada@example.com",
      Active: true,
      Status: "Draft",
    });
  });

  it("compiles the PurchaseOrder example with lifecycle, policy, sync, and theme declarations", () => {
    const result = compileAdl(readExample("purchase-order.adl"));
    const purchaseOrder = result.model.objects.find((object) => object.name === "PurchaseOrder");
    const policyNames = result.model.policies.map((policy) => policy.name);

    expect(result.diagnostics).toEqual([]);
    expect(purchaseOrder).toMatchObject({
      businessKey: "PONumber",
      displayField: "Supplier",
      sync: {
        mode: "localFirst",
        scope: "assignedToUser",
        conflict: "stateTransitionWins",
      },
    });
    expect(purchaseOrder?.fields.find((field) => field.name === "PONumber")?.autoId).toEqual({
      prefix: "PO-",
      pad: 6,
    });
    expect(purchaseOrder?.views.find((view) => view.name === "PurchaseOrderList")?.sort).toEqual([
      { field: "PONumber", direction: "asc" },
    ]);
    expect(policyNames).toEqual(
      expect.arrayContaining([
        "PurchaseOrderPolicy",
        "PurchaseOrderSubmitPolicy",
        "PurchaseOrderApprovePolicy",
      ]),
    );
    expect(
      result.model.policies
        .find((policy) => policy.name === "PurchaseOrderPolicy")
        ?.rules.find(
          (rule) =>
            rule.effect === "hidden" &&
            rule.action === "read" &&
            rule.fields.includes("InternalNotes"),
        ),
    ).toMatchObject({
      effect: "hidden",
      action: "read",
      fields: ["InternalNotes"],
      principal: { roles: ["Requester"] },
    });
  });

  it("normalizes context-aware sync scope spellings", () => {
    const result = compileAdl(`APP DatasetScopes
END.APP

OBJECT BandEvent
  FIELD Band TEXT
  SYNC LOCAL_FIRST SCOPE ALL_AVAILABLE_CONTEXTS
END.OBJECT

OBJECT UserPreference
  FIELD Name TEXT
  SYNC LOCAL_PRIVATE SCOPE CurrentUser
END.OBJECT
`);

    expect(result.diagnostics).toEqual([]);
    expect(result.model.objects.map((object) => [object.name, object.sync])).toEqual([
      [
        "BandEvent",
        {
          mode: "localFirst",
          scope: "allAvailableContexts",
          conflict: "manual",
        },
      ],
      [
        "UserPreference",
        {
          mode: "localPrivate",
          scope: "currentUser",
          conflict: "manual",
        },
      ],
    ]);
  });

  it("enforces parser-generated inline lifecycle action policies at runtime", async () => {
    const result = compileAdl(`APP TicketDesk
  START_VIEW TicketList
END.APP

ROLE Operator
ROLE Clerk

OBJECT Ticket
  DISPLAY Title
  FIELD Title TEXT REQUIRED
  FIELD Status TEXT REQUIRED

  LIFECYCLE TicketLifecycle FIELD Status INITIAL Draft
    STATE Draft
    STATE Open

    ACTION open FROM Draft TO Open LABEL 'Open'
      ALLOW ROLE Operator
    END.ACTION
  END.LIFECYCLE

  VIEW TicketList LIST
    FIELDS Title Status
    SEARCH Title
    ACTIONS create read
  END.VIEW

  VIEW TicketForm FORM
    FIELDS Title Status
    ACTIONS save open
  END.VIEW
END.OBJECT

POLICY TicketPolicy ON Ticket
  ALLOW CREATE ROLE Operator Clerk
  ALLOW READ ROLE Operator Clerk
  ALLOW SEARCH ROLE Operator Clerk
END.POLICY
`);

    expect(result.diagnostics).toEqual([]);
    expect(
      result.model.policies.find((policy) => policy.name === "TicketOpenPolicy"),
    ).toMatchObject({
      object: "Ticket",
      rules: [
        expect.objectContaining({
          effect: "allow",
          action: "transition",
          state: ["Draft"],
          lifecycleAction: "open",
          principal: expect.objectContaining({ roles: ["Operator"] }),
        }),
      ],
    });

    const runtime = new ApplicationRuntime(result.model);
    const operatorTicket = await runtime.create("Ticket", { Title: "Printer" }, operatorContext);
    const clerkTicket = await runtime.create("Ticket", { Title: "Monitor" }, clerkContext);

    await expect(
      runtime.transition("Ticket", clerkTicket.meta.guid, "open", clerkContext),
    ).rejects.toBeInstanceOf(PolicyDeniedError);

    const opened = await runtime.transition(
      "Ticket",
      operatorTicket.meta.guid,
      "open",
      operatorContext,
    );
    expect(opened.values.Status).toBe("Open");
  });

  it("returns structured validation diagnostics for parsed but invalid models", () => {
    const result = compileAdl(`APP Broken
  START_VIEW BrokenList
END.APP

OBJECT Broken
  FIELD Name TEXT

  VIEW BrokenList LIST
    FIELDS Missing
  END.VIEW
END.OBJECT
`);

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: MODEL_VALIDATION_CODES.VIEW_FIELD_UNKNOWN,
          path: "objects[0].views[0].fields[0]",
        }),
      ]),
    );
  });
});

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}
