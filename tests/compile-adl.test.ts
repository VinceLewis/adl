import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  MODEL_VALIDATION_CODES,
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
