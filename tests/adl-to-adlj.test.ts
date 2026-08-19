import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compileAdl } from "../src/compiler/compile-adl.js";
import { compileAdlj } from "../src/compiler/compile-adlj.js";
import {
  importAdlAsAdlj,
  partialApplicationModelToAdljSource,
} from "../src/compiler/adl-to-adlj.js";
import type { PartialApplicationModel } from "../src/model/resolved-model.js";

function readExample(name: string): string {
  return readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");
}

describe("partialApplicationModelToAdljSource", () => {
  it("converts a hand-built PartialApplicationModel's computed field, object validation, and policy condition to infix strings", () => {
    const model: PartialApplicationModel = {
      app: { name: "Widgets" },
      objects: [
        {
          name: "Widget",
          fields: [{ name: "Count", type: "number", required: true }],
          computedFields: [
            {
              name: "IsPlentiful",
              type: "boolean",
              expression: {
                kind: "binary",
                operator: ">=",
                left: { kind: "field", field: "Count" },
                right: { kind: "literal", value: 10 },
              },
            },
          ],
          validations: [
            {
              name: "countNonNegative",
              expression: {
                kind: "binary",
                operator: ">=",
                left: { kind: "field", field: "Count" },
                right: { kind: "literal", value: 0 },
              },
              message: "Count must not be negative.",
            },
          ],
        },
      ],
      policies: [
        {
          name: "WidgetPolicy",
          object: "Widget",
          rules: [
            {
              name: "allowReadPlentiful",
              effect: "allow",
              principal: { match: "everyone" },
              action: "read",
              condition: {
                kind: "binary",
                operator: ">=",
                left: { kind: "field", field: "Count" },
                right: { kind: "literal", value: 10 },
              },
            },
          ],
        },
      ],
    };

    const document = partialApplicationModelToAdljSource(model);

    expect(document.objects[0]?.computedFields?.[0]).toEqual({
      name: "IsPlentiful",
      type: "boolean",
      expression: "Count >= 10",
    });
    expect(document.objects[0]?.validations?.[0]).toEqual({
      name: "countNonNegative",
      expression: "Count >= 0",
      message: "Count must not be negative.",
    });
    expect(document.policies?.[0]?.rules?.[0]?.condition).toBe("Count >= 10");
  });
});

describe("importAdlAsAdlj", () => {
  it("compiles clean .adl source and converts it to an AdljSourceDocument", () => {
    const result = importAdlAsAdlj(readExample("task-tracker.adl"));

    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.document).toBeDefined();
    expect(result.document?.app.name).toBe("TaskTracker");
  });

  it("returns diagnostics without a document when .adl source has errors", () => {
    const result = importAdlAsAdlj(`APP Broken
END.APP

OBJECT Thing
  VALIDATE bad NotAField > 0
END.OBJECT
`);

    expect(result.diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(result.document).toBeUndefined();
  });

  it("round-trips task-tracker.adl through .adlj to an identical resolved model", () => {
    const adlResult = compileAdl(readExample("task-tracker.adl"));
    expect(adlResult.diagnostics).toEqual([]);

    const imported = importAdlAsAdlj(readExample("task-tracker.adl"));
    expect(imported.diagnostics).toEqual([]);
    expect(imported.document).toBeDefined();

    const adljResult = compileAdlj(JSON.stringify(imported.document));
    expect(adljResult.diagnostics).toEqual([]);

    expect(adljResult.model).toEqual(adlResult.model);
  });
});
