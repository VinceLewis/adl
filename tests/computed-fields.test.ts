import { describe, expect, it } from "vitest";
import {
  ApplicationRuntime,
  MODEL_VALIDATION_CODES,
  RuntimeValidationError,
  resolveApplicationModel,
  validateApplicationModel,
} from "../src/index.js";
import type { PartialApplicationModel, RuntimeContext } from "../src/index.js";

const context: RuntimeContext = {
  userId: "admin-1",
  roles: ["Admin"],
  channel: "api",
  now: new Date("2026-07-17T09:00:00.000Z"),
};

describe("computed fields and read-model expressions", () => {
  it("evaluates computed fields on create, read, and search in dependency order", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(lineItemModel()));

    const created = await runtime.create(
      "LineItem",
      { UnitPrice: 12.5, Quantity: 4, Discount: 5 },
      context,
    );
    const read = await runtime.read("LineItem", created.meta.guid, context);
    const search = await runtime.search("LineItem", undefined, context);

    expect(created.values).toMatchObject({ Gross: 50, Net: 45 });
    expect(read?.values).toMatchObject({ Gross: 50, Net: 45 });
    expect(search[0]?.values).toMatchObject({ Gross: 50, Net: 45 });
  });

  it("rejects direct writes to computed fields on create and update", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(lineItemModel()));

    await expect(
      runtime.create("LineItem", { UnitPrice: 10, Quantity: 2, Gross: 20 }, context),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_COMPUTED_FIELD_WRITE" })],
    });

    const created = await runtime.create("LineItem", { UnitPrice: 10, Quantity: 2 }, context);

    await expect(
      runtime.update("LineItem", created.meta.guid, { Net: 10 }, context),
    ).rejects.toBeInstanceOf(RuntimeValidationError);
    await expect(
      runtime.update("LineItem", created.meta.guid, { Net: 10 }, context),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "ADL_RUNTIME_COMPUTED_FIELD_WRITE" })],
    });
  });

  it("detects computed-field dependency cycles during model validation", () => {
    const model = resolveApplicationModel({
      ...lineItemModel(),
      objects: [
        {
          name: "Cycle",
          fields: [{ name: "Base", type: "number" }],
          computedFields: [
            {
              name: "A",
              type: "number",
              expression: { kind: "field", field: "B" },
            },
            {
              name: "B",
              type: "number",
              expression: { kind: "field", field: "A" },
            },
          ],
        },
      ],
      policies: [
        {
          name: "CyclePolicy",
          object: "Cycle",
          rules: [
            {
              name: "allowAdmin",
              effect: "allow",
              principal: { match: "specific", roles: ["Admin"] },
              action: "*",
            },
          ],
        },
      ],
    });

    expect(validateApplicationModel(model)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: MODEL_VALIDATION_CODES.COMPUTED_FIELD_CYCLE,
          message: expect.stringContaining("A -> B -> A"),
        }),
      ]),
    );
  });

  it("evaluates read-model expression fields against projected row values", async () => {
    const runtime = new ApplicationRuntime(resolveApplicationModel(lineItemModel()));
    await runtime.create("LineItem", { UnitPrice: 10, Quantity: 3, Discount: 2 }, context);

    const result = await runtime.executeReadModel("LineItemSummary", context);

    expect(result.rows.map((row) => row.values)).toEqual([
      {
        Quantity: 3,
        Net: 28,
        NetWithTax: 33.6,
      },
    ]);
  });
});

function lineItemModel(): PartialApplicationModel {
  return {
    app: { name: "ComputedFields" },
    roles: [{ name: "Admin" }],
    objects: [
      {
        name: "LineItem",
        fields: [
          { name: "UnitPrice", type: "number", required: true },
          { name: "Quantity", type: "number", required: true },
          { name: "Discount", type: "number", defaultValue: 0 },
        ],
        computedFields: [
          {
            name: "Gross",
            type: "number",
            expression: {
              kind: "binary",
              operator: "*",
              left: { kind: "field", field: "UnitPrice" },
              right: { kind: "field", field: "Quantity" },
            },
          },
          {
            name: "Net",
            type: "number",
            expression: {
              kind: "binary",
              operator: "-",
              left: { kind: "field", field: "Gross" },
              right: { kind: "field", field: "Discount" },
            },
          },
        ],
      },
    ],
    readModels: [
      {
        name: "LineItemSummary",
        sources: [{ name: "line", object: "LineItem" }],
        fields: [
          { name: "Quantity", source: "line", field: "Quantity" },
          { name: "Net", source: "line", field: "Net" },
          {
            name: "NetWithTax",
            type: "number",
            expression: {
              kind: "binary",
              operator: "*",
              left: { kind: "field", field: "Net" },
              right: { kind: "literal", value: 1.2 },
            },
          },
        ],
      },
    ],
    policies: [
      {
        name: "LineItemPolicy",
        object: "LineItem",
        rules: [
          {
            name: "allowAdmin",
            effect: "allow",
            principal: { match: "specific", roles: ["Admin"] },
            action: "*",
          },
        ],
      },
    ],
  };
}
